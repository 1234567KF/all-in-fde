/** A/B 对比：同一任务在“不用技能”和“用技能”两组下的成本、缓存、质量。 */
import fs from 'node:fs';
import { fmtDuration, fmtInt, fmtMoney, fmtPct, fmtTime } from './price.mjs';
import { hitRate } from './model.mjs';

function runOf(session, turn) {
  const tokens = {
    miss: turn.tokens.miss + turn.subagentsTokens.miss,
    hit: turn.tokens.hit + turn.subagentsTokens.hit,
    write: turn.tokens.write + turn.subagentsTokens.write,
    out: turn.tokens.out + turn.subagentsTokens.out,
  };
  return {
    sessionId: session.id,
    title: session.title,
    workspace: session.workspace,
    turn: turn.turn,
    arm: turn.arm,
    run: turn.run,
    time: turn.start,
    end: turn.end,
    cost: turn.totalCost,
    tokens,
    steps: turn.steps,
    calls: turn.calls,
    wallMs: Math.max(0, turn.end - turn.start),
    subagentsCost: turn.subagentsCost,
    skills: turn.skills,
    turns: 1,
    sessionIds: new Set([session.id]),
  };
}

/** 同一 #run 标签跨轮、跨会话（返工）合并成一次“运行”。 */
export function collectRuns(ledger, task) {
  const groups = new Map();
  for (const session of ledger.roots) {
    for (const turn of session.turns) {
      if (turn.task !== task || !turn.arm) continue;
      const key = `${turn.arm}:${turn.run || `${session.id}:${turn.turn}`}`;
      const current = groups.get(key);
      if (!current) {
        groups.set(key, runOf(session, turn));
        continue;
      }
      current.cost += turn.totalCost;
      current.tokens.miss += turn.tokens.miss + turn.subagentsTokens.miss;
      current.tokens.hit += turn.tokens.hit + turn.subagentsTokens.hit;
      current.tokens.write += turn.tokens.write + turn.subagentsTokens.write;
      current.tokens.out += turn.tokens.out + turn.subagentsTokens.out;
      current.steps += turn.steps;
      current.calls += turn.calls;
      current.subagentsCost += turn.subagentsCost;
      current.wallMs += Math.max(0, turn.end - turn.start);
      current.end = Math.max(current.end, turn.end);
      current.turns += 1;
      current.sessionIds.add(session.id);
    }
  }
  return [...groups.values()].sort((a, b) => a.time - b.time);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bootstrapSavings(pairs, iterations = 10000) {
  const random = mulberry32(20261118);
  const values = [];
  for (let i = 0; i < iterations; i += 1) {
    let base = 0;
    let cand = 0;
    for (let j = 0; j < pairs.length; j += 1) {
      const pick = pairs[Math.floor(random() * pairs.length)];
      base += pick.base.cost;
      cand += pick.cand.cost;
    }
    if (base > 0) values.push(1 - cand / base);
  }
  values.sort((a, b) => a - b);
  const at = (q) => values[Math.min(values.length - 1, Math.max(0, Math.floor(q * values.length)))];
  return { low: at(0.025), high: at(0.975), mid: at(0.5) };
}

export function compareTask(ledger, { task, base = 'A', cand = 'B', judgmentsFile } = {}) {
  const all = collectRuns(ledger, task);
  const baseRuns = all.filter((run) => run.arm === base);
  const candRuns = all.filter((run) => run.arm === cand);
  const warnings = [];
  if (!baseRuns.length || !candRuns.length) {
    return { task, base, cand, baseRuns, candRuns, pairs: [], warnings: ['某一分支没有带标签的轮次'], complete: false };
  }

  const runKeys = (runs) => runs.every((run) => run.run) && new Set(runs.map((run) => run.run)).size === runs.length;
  let pairs = [];
  let pairedBy = 'time-order';
  if (runKeys(baseRuns) && runKeys(candRuns)) {
    const baseMap = new Map(baseRuns.map((run) => [run.run, run]));
    const candMap = new Map(candRuns.map((run) => [run.run, run]));
    for (const key of [...new Set([...baseMap.keys(), ...candMap.keys()])].sort()) {
      if (!baseMap.has(key) || !candMap.has(key)) {
        warnings.push(`run=${key} 只出现在一组，已跳过`);
        continue;
      }
      pairs.push({ key, base: baseMap.get(key), cand: candMap.get(key) });
    }
    pairedBy = 'run-tag';
  } else {
    const count = Math.min(baseRuns.length, candRuns.length);
    for (let i = 0; i < count; i += 1) pairs.push({ key: String(i + 1), base: baseRuns[i], cand: candRuns[i] });
    if (baseRuns.length !== candRuns.length) warnings.push('两组轮次数不一致，按时间顺序配对，多余的轮次被忽略');
    warnings.push('未提供 #run= 标签，按时间顺序配对；建议每次运行加 #run=<id> 以避免错配');
  }

  const baseCosts = baseRuns.map((run) => run.cost);
  const candCosts = candRuns.map((run) => run.cost);
  const baseMean = mean(baseCosts);
  const candMean = mean(candCosts);
  const aggregateSavings = baseMean > 0 ? 1 - candMean / baseMean : 0;
  const deltas = pairs.map((pair) => pair.cand.cost - pair.base.cost);
  const ratioDeltas = pairs.map((pair) => (pair.base.cost > 0 ? 1 - pair.cand.cost / pair.base.cost : 0));
  const ci = bootstrapSavings(pairs);
  const wins = pairs.filter((pair) => pair.cand.cost < pair.base.cost).length;

  const judgments = judgmentsFile ? loadJudgments(judgmentsFile) : new Map();
  const judge = (run) => judgments.get(`${task}|${run.arm}|${run.run}`) ?? null;
  const baseJudge = baseRuns.map(judge);
  const candJudge = candRuns.map(judge);
  const haveQuality = baseJudge.every(Boolean) && candJudge.every(Boolean);
  const accepted = (list) => list.filter((entry) => entry?.accepted).length;
  const baseAccepted = accepted(baseJudge);
  const candAccepted = accepted(candJudge);
  const quality = haveQuality
    ? {
        baseAccepted,
        candAccepted,
        baseRate: baseAccepted / Math.max(1, baseRuns.length),
        candRate: candAccepted / Math.max(1, candRuns.length),
        baseCostPerAccepted: baseAccepted ? baseMean * baseRuns.length / baseAccepted : null,
        candCostPerAccepted: candAccepted ? candMean * candRuns.length / candAccepted : null,
      }
    : null;

  let verdict = '证据不足';
  let reason = '';
  if (pairs.length < 4) {
    reason = `只有 ${pairs.length} 对样本；至少 4 对才值得看，8 对以上才比较稳。`;
  } else if (ci.low > 0 && aggregateSavings >= 0.1) {
    if (quality && quality.candRate < quality.baseRate) {
      verdict = '省了 token，但质量下降';
      reason = '候选组的交付合格率低于基线，节省不成立。';
    } else if (!quality) {
      verdict = '成本显著下降（质量未判定）';
      reason = `配对节省 ${fmtPct(aggregateSavings)}，95% 置信区间 ${fmtPct(ci.low)} ~ ${fmtPct(ci.high)}，整段区间都在 0 以上；但没有质量判定，不能算“真实节省”。`;
    } else {
      verdict = '证据支持真实节省';
      reason = `配对节省 ${fmtPct(aggregateSavings)}，95% 置信区间 ${fmtPct(ci.low)} ~ ${fmtPct(ci.high)}，整段区间都在 0 以上，且质量不降。`;
    }
  } else if (aggregateSavings > 0) {
    verdict = '方向可能节省，但不显著';
    reason = `点估计节省 ${fmtPct(aggregateSavings)}，但 95% 置信区间 ${fmtPct(ci.low)} ~ ${fmtPct(ci.high)} 跨过 0；可能只是波动。`;
  } else {
    verdict = '未观察到节省';
    reason = `候选组平均成本更高（${fmtPct(-aggregateSavings)}）。`;
  }

  return {
    task,
    base,
    cand,
    baseRuns,
    candRuns,
    pairs,
    pairedBy,
    stats: {
      n: pairs.length,
      baseMean,
      candMean,
      baseMedian: median(baseCosts),
      candMedian: median(candCosts),
      aggregateSavings,
      meanRatioSavings: mean(ratioDeltas),
      deltaMean: mean(deltas),
      ci,
      wins,
      winRate: pairs.length ? wins / pairs.length : 0,
      baseHit: hitRate(sumTokens(baseRuns)),
      candHit: hitRate(sumTokens(candRuns)),
      baseOut: sumTokens(baseRuns).out,
      candOut: sumTokens(candRuns).out,
      baseSteps: baseRuns.reduce((sum, run) => sum + run.steps, 0),
      candSteps: candRuns.reduce((sum, run) => sum + run.steps, 0),
      baseWall: baseRuns.reduce((sum, run) => sum + run.wallMs, 0),
      candWall: candRuns.reduce((sum, run) => sum + run.wallMs, 0),
    },
    quality,
    verdict,
    reason,
    warnings,
    complete: true,
  };
}

function sumTokens(runs) {
  return runs.reduce(
    (acc, run) => ({
      miss: acc.miss + run.tokens.miss,
      hit: acc.hit + run.tokens.hit,
      out: acc.out + run.tokens.out,
    }),
    { miss: 0, hit: 0, out: 0 },
  );
}

export function loadJudgments(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.judgments || [];
  const map = new Map();
  for (const entry of list) map.set(`${entry.task}|${entry.arm}|${entry.run}`, entry);
  return map;
}

export function renderCompare(result, ledger) {
  const tz = ledger.pricing.peakRule.timezone;
  const lines = [];
  lines.push(`# 成本对比：${result.task}`);
  lines.push('');
  if (!result.complete) {
    lines.push(`- 基线 ${result.base}：${result.baseRuns.length} 轮｜候选 ${result.cand}：${result.candRuns.length} 轮`);
    lines.push('');
    for (const warning of result.warnings) lines.push(`- ${warning}`);
    lines.push('');
    lines.push('提示：把标签写在提示词第一行，例如 `#task=doc-review-01 #arm=A #run=1`，跑完一组再跑另一组。');
    return lines.join('\n');
  }
  lines.push(`- 基线 ${result.base}：${result.baseRuns.length} 轮｜候选 ${result.cand}：${result.candRuns.length} 轮｜配对方式：${result.pairedBy === 'run-tag' ? '#run 标签' : '时间顺序'}`);
  lines.push(`- 判定：**${result.verdict}**`);
  lines.push(`- 理由：${result.reason}`);
  lines.push('');
  const s = result.stats;
  lines.push('## 汇总');
  lines.push('');
  lines.push('| 指标 | 基线 | 候选 | 变化 |');
  lines.push('| --- | ---: | ---: | ---: |');
  lines.push(`| 平均每轮成本 | ${fmtMoney(s.baseMean)} | ${fmtMoney(s.candMean)} | ${fmtPct(s.aggregateSavings)} |`);
  lines.push(`| 中位数成本 | ${fmtMoney(s.baseMedian)} | ${fmtMoney(s.candMedian)} | — |`);
  lines.push(`| 缓存命中率 | ${fmtPct(s.baseHit)} | ${fmtPct(s.candHit)} | — |`);
  lines.push(`| 输出 tokens | ${fmtInt(s.baseOut)} | ${fmtInt(s.candOut)} | — |`);
  lines.push(`| 步数合计 | ${fmtInt(s.baseSteps)} | ${fmtInt(s.candSteps)} | — |`);
  lines.push(`| 墙钟合计 | ${fmtDuration(s.baseWall)} | ${fmtDuration(s.candWall)} | — |`);
  lines.push('');
  lines.push(`- 配对节省：均值 ${fmtPct(s.meanRatioSavings)}｜95% CI ${fmtPct(s.ci.low)} ~ ${fmtPct(s.ci.high)}（bootstrap，1 万次）`);
  lines.push(`- 候选更便宜的轮次：${s.wins}/${s.n}（${fmtPct(s.winRate)}）`);
  if (result.quality) {
    lines.push('');
    lines.push('## 质量门');
    lines.push('');
    lines.push(`- 合格率：基线 ${fmtPct(result.quality.baseRate)}（${result.quality.baseAccepted}/${result.baseRuns.length}）｜候选 ${fmtPct(result.quality.candRate)}（${result.quality.candAccepted}/${result.candRuns.length}）`);
    lines.push(`- 每个合格交付物成本：基线 ${fmtMoney(result.quality.baseCostPerAccepted)}｜候选 ${fmtMoney(result.quality.candCostPerAccepted)}`);
  } else {
    lines.push('');
    lines.push('- 质量门：没有对应的质量判定（或判定为空），当前只比较 token 成本，不能宣称“真实节省”。');
  }
  lines.push('');
  lines.push('## 逐对明细');
  lines.push('');
  lines.push('| # | 时间 | 基线成本 | 候选成本 | 节省 | 基线命中率 | 候选命中率 | 基线输出 | 候选输出 |');
  lines.push('| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const pair of result.pairs) {
    const saved = pair.base.cost > 0 ? 1 - pair.cand.cost / pair.base.cost : 0;
    lines.push(`| ${pair.key} | ${fmtTime(pair.base.time, tz)} | ${fmtMoney(pair.base.cost)} | ${fmtMoney(pair.cand.cost)} | ${fmtPct(saved)} | ${fmtPct(hitRate(pair.base.tokens))} | ${fmtPct(hitRate(pair.cand.tokens))} | ${fmtInt(pair.base.tokens.out)} | ${fmtInt(pair.cand.tokens.out)} |`);
  }
  lines.push('');
  if (result.warnings.length) {
    lines.push('## 注意');
    lines.push('');
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }
  lines.push('');
  lines.push(`> 判读规则：n≥4 才看；95% CI 上限 < 0 且节省 ≥10%，同时质量不下降，才算“真实节省”。n=8 通常只能可靠识别 25%~30% 以上的差异。`);
  return lines.join('\n');
}
