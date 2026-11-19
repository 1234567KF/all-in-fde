/** 报表渲染：全部输出 Markdown，便于直接粘贴到文档/PPT 或保存为 .md。 */
import { fmtDuration, fmtInt, fmtMoney, fmtPct, fmtTime } from './price.mjs';
import { SKILL_BASE, hitRate } from './model.mjs';

const pct = (part, whole) => (whole > 0 ? fmtPct(part / whole) : '—');

export function viewOf(ledger, { workspace, days, now = Date.now() } = {}) {
  const cutoff = days ? now - days * 86400000 : 0;
  const sessions = ledger.sessions.filter((session) => {
    if (workspace && !String(session.workspace || '').includes(workspace) && !String(session.cwd || '').includes(workspace)) return false;
    return (session.lastEventAt ?? 0) >= cutoff;
  });
  const calls = sessions.flatMap((session) => session.calls.filter((call) => call.time >= cutoff));
  const tokens = { miss: 0, hit: 0, write: 0, out: 0 };
  const totals = { sessions: sessions.length, calls: 0, cost: 0, idleCost: 0, cacheSaved: 0, peakCost: 0, unknownModelCalls: 0, tokens, wallMs: 0, activeMs: 0, llmMs: 0, toolMs: 0, turns: 0, steps: 0, costParts: { miss: 0, hit: 0, out: 0 } };
  for (const session of sessions) {
    totals.calls += session.totals.calls;
    totals.cost += session.totals.cost;
    totals.idleCost += session.totals.idleCost;
    totals.cacheSaved += session.totals.cacheSaved;
    totals.peakCost += session.totals.peakCost;
    totals.unknownModelCalls += session.calls.filter((call) => call.unknownModel).length;
    for (const call of session.calls) {
      totals.costParts.miss += call.costParts?.miss ?? 0;
      totals.costParts.hit += call.costParts?.hit ?? 0;
      totals.costParts.out += call.costParts?.out ?? 0;
    }
    totals.wallMs += session.totals.wallMs;
    totals.activeMs += session.totals.activeMs;
    totals.llmMs += session.totals.llmMs;
    totals.toolMs += session.totals.toolMs;
    totals.turns += session.totals.turns;
    totals.steps += session.totals.steps;
    tokens.miss += session.totals.tokens.miss;
    tokens.hit += session.totals.tokens.hit;
    tokens.write += session.totals.tokens.write;
    tokens.out += session.totals.tokens.out;
  }

  const daysMap = new Map();
  const models = new Map();
  const skills = new Map();
  for (const session of sessions) {
    for (const call of session.calls) {
      if (call.time < cutoff) continue;
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: ledger.pricing.peakRule.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(call.time));
      const day = daysMap.get(key) || { date: key, calls: 0, cost: 0, tokens: { miss: 0, hit: 0, write: 0, out: 0 }, peakCost: 0 };
      day.calls += 1;
      day.cost += call.cost ?? 0;
      day.tokens.miss += call.miss;
      day.tokens.hit += call.hit;
      day.tokens.out += call.out;
      if (call.peak) day.peakCost += call.cost ?? 0;
      daysMap.set(key, day);

      const modelKey = call.model ?? '(unknown)';
      const model = models.get(modelKey) || { model: modelKey, label: call.modelLabel ?? modelKey, calls: 0, cost: 0, tokens: { miss: 0, hit: 0, write: 0, out: 0 }, peakCost: 0 };
      model.calls += 1;
      model.cost += call.cost ?? 0;
      model.tokens.miss += call.miss;
      model.tokens.hit += call.hit;
      model.tokens.out += call.out;
      if (call.peak) model.peakCost += call.cost ?? 0;
      models.set(modelKey, model);

      const skillKey = call.activeSkill || SKILL_BASE;
      const skill = skills.get(skillKey) || { name: skillKey, calls: 0, cost: 0, tokens: { miss: 0, hit: 0, write: 0, out: 0 }, sessions: new Set(), turns: new Set() };
      skill.calls += 1;
      skill.cost += call.cost ?? 0;
      skill.tokens.miss += call.miss;
      skill.tokens.hit += call.hit;
      skill.tokens.out += call.out;
      skill.sessions.add(session.id);
      if (call.turn !== null) skill.turns.add(`${session.id}:${call.turn}`);
      skills.set(skillKey, skill);
    }
  }

  const rootTurns = [];
  for (const session of sessions) {
    if (session.parent) continue;
    for (const turn of session.turns) {
      if (turn.start < cutoff) continue;
      rootTurns.push({ session, turn });
    }
  }
  const tasks = new Map();
  for (const { session, turn } of rootTurns) {
    const key = turn.task || '(未标注)';
    const task = tasks.get(key) || { task: key, turns: 0, cost: 0, tokens: { miss: 0, hit: 0, write: 0, out: 0 }, sessions: new Set(), arms: new Set(), runs: new Set(), lastAt: 0, subagentsCost: 0 };
    task.turns += 1;
    task.cost += turn.totalCost;
    task.tokens.miss += turn.tokens.miss + turn.subagentsTokens.miss;
    task.tokens.hit += turn.tokens.hit + turn.subagentsTokens.hit;
    task.tokens.out += turn.tokens.out + turn.subagentsTokens.out;
    task.sessions.add(session.id);
    if (turn.arm) task.arms.add(turn.arm);
    if (turn.run) task.runs.add(turn.run);
    task.lastAt = Math.max(task.lastAt, turn.end);
    task.subagentsCost += turn.subagentsCost;
    tasks.set(key, task);
  }

  // 技能“调用轮”口径：只把真正调用了技能的轮次计入，多技能平均分摊。
  const skillsInvoked = new Map();
  const skillsInChildren = new Set();
  for (const session of sessions) {
    if (!session.parent) continue;
    for (const turn of session.turns) for (const name of turn.skills) skillsInChildren.add(name);
  }
  for (const { session, turn } of rootTurns) {
    const names = turn.skills.length ? turn.skills : [SKILL_BASE];
    const share = turn.totalCost / names.length;
    for (const name of names) {
      const entry = skillsInvoked.get(name) || { name, turns: 0, cost: 0, sessions: new Set() };
      entry.turns += 1;
      entry.cost += share;
      entry.sessions.add(session.id);
      skillsInvoked.set(name, entry);
    }
  }

  const blindSpots = { titleRequests: 0, searchRequests: 0, searchCalls: 0, fetchCalls: 0, retries: 0, attemptsFailed: 0, noUsageMessages: 0 };
  for (const session of sessions) {
    for (const key of ['titleRequests', 'searchRequests', 'searchCalls', 'fetchCalls', 'retries', 'attemptsFailed']) {
      blindSpots[key] += session.extras?.[key] ?? 0;
    }
    for (const warning of session.warnings || []) {
      const match = /(\d+) 条 assistant/.exec(warning);
      if (match) blindSpots.noUsageMessages += Number(match[1]);
    }
  }

  const media = (ledger.media || []).filter((record) => {
    if (record.ts < cutoff) return false;
    if (!workspace) return true;
    return String(record.workspace || '').includes(workspace);
  });
  const mediaCost = media.reduce((sum, record) => sum + (record.cost ?? 0), 0);
  totals.mediaCost = mediaCost;
  totals.cost += mediaCost;
  for (const record of media) {
    if (!record.task) continue;
    const task = tasks.get(record.task);
    if (task) task.cost += record.cost ?? 0;
  }

  return { sessions, calls, totals, days: daysMap, models, skills, skillsInvoked, skillsInChildren, tasks, rootTurns, cutoff, blindSpots, media };
}

export function renderOverview(ledger, view, { title = 'Token 账单' } = {}) {
  const t = view.totals;
  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> 价格版本 ${ledger.pricing.version}（${ledger.pricing.displayCurrency}）｜生成于 ${fmtTime(Date.now(), ledger.pricing.peakRule.timezone)}｜口径：提供方返回的精确 usage，不含无法观测的隐藏调用`);
  if (ledger.epoch?.resetAt) {
    lines.push(`> 计费起点：${fmtTime(ledger.epoch.resetAt, ledger.pricing.peakRule.timezone)}（此前的调用已排除）`);
  }
  lines.push('');
  lines.push('## 总账');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('| --- | --- |');
  lines.push(`| 总会话 / 计费调用 | ${fmtInt(t.sessions)} / ${fmtInt(t.calls)} |`);
  lines.push(`| 总轮次 / 总步数 | ${fmtInt(t.turns)} / ${fmtInt(t.steps)} |`);
  lines.push(`| **总花费** | **${fmtMoney(t.cost)}** |`);
  lines.push(`| 若全部在低谷时段 | ${fmtMoney(t.idleCost)} |`);
  lines.push(`| 其中高峰时段花费 | ${fmtMoney(t.peakCost)}（${pct(t.peakCost, t.cost)}） |`);
  if (t.mediaCost) lines.push(`| 其中媒体生成（按张/按次） | ${fmtMoney(t.mediaCost)} |`);
  if (t.unknownModelCalls) lines.push(`| 未定价调用 | ${fmtInt(t.unknownModelCalls)} 次（价格表缺该 provider/model） |`);
  lines.push(`| 输入未命中缓存 | ${fmtInt(t.tokens.miss)} tokens |`);
  lines.push(`| 输入命中缓存 | ${fmtInt(t.tokens.hit)} tokens |`);
  lines.push(`| 输出 | ${fmtInt(t.tokens.out)} tokens |`);
  lines.push(`| 缓存命中率 | ${fmtPct(hitRate(t.tokens))} |`);
  lines.push(`| 缓存省下的钱 | ${fmtMoney(t.cacheSaved)}（相对全部未命中） |`);
  lines.push(`| 平均每轮 | ${fmtMoney(t.cost / Math.max(1, t.turns))} |`);
  lines.push(`| 平均每次调用 | ${fmtMoney(t.cost / Math.max(1, t.calls))} |`);
  lines.push(`| 累计活跃 / LLM / 工具 | ${fmtDuration(t.activeMs)} / ${fmtDuration(t.llmMs)} / ${fmtDuration(t.toolMs)} |`);
  lines.push('');

  lines.push('## 成本构成');
  lines.push('');
  lines.push('| 构成 | 金额 | 占比 |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| 输入·未命中缓存 | ${fmtMoney(t.costParts.miss)} | ${pct(t.costParts.miss, t.cost)} |`);
  lines.push(`| 输入·命中缓存 | ${fmtMoney(t.costParts.hit)} | ${pct(t.costParts.hit, t.cost)} |`);
  lines.push(`| 输出 | ${fmtMoney(t.costParts.out)} | ${pct(t.costParts.out, t.cost)} |`);
  if (t.mediaCost) lines.push(`| 媒体生成 | ${fmtMoney(t.mediaCost)} | ${pct(t.mediaCost, t.cost)} |`);
  lines.push('');
  lines.push('> 输出单价通常是未命中的 4 倍；长文任务的钱主要花在“写”上，而不是“读”上。缓存把输入单价压到 1/50，所以真正要盯的是输出量和缓存失效。');
  lines.push('');

  lines.push('## 按日');
  lines.push('');
  lines.push('| 日期 | 调用 | 花费 | 未命中 | 命中 | 输出 | 命中率 | 高峰占比 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const day of [...view.days.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(`| ${day.date} | ${fmtInt(day.calls)} | ${fmtMoney(day.cost)} | ${fmtInt(day.tokens.miss)} | ${fmtInt(day.tokens.hit)} | ${fmtInt(day.tokens.out)} | ${fmtPct(hitRate(day.tokens))} | ${pct(day.peakCost, day.cost)} |`);
  }
  lines.push('');

  lines.push('## 按工作区');
  lines.push('');
  lines.push('| 工作区 | 会话 | 花费 | 命中率 |');
  lines.push('| --- | ---: | ---: | ---: |');
  const byWorkspace = new Map();
  for (const session of view.sessions) {
    const key = session.workspace || '(未知)';
    const entry = byWorkspace.get(key) || { cost: 0, calls: 0, tokens: { miss: 0, hit: 0 }, sessions: 0 };
    entry.cost += session.totals.cost;
    entry.calls += session.totals.calls;
    entry.tokens.miss += session.totals.tokens.miss;
    entry.tokens.hit += session.totals.tokens.hit;
    entry.sessions += 1;
    byWorkspace.set(key, entry);
  }
  for (const [key, entry] of [...byWorkspace].sort((a, b) => b[1].cost - a[1].cost)) {
    lines.push(`| ${key} | ${entry.sessions} | ${fmtMoney(entry.cost)} | ${fmtPct(hitRate(entry.tokens))} |`);
  }
  lines.push('');

  lines.push('## 按模型');
  lines.push('');
  lines.push('| 模型 | 调用 | 花费 | 未命中 | 命中 | 命中率 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const model of [...view.models.values()].sort((a, b) => b.cost - a.cost)) {
    lines.push(`| ${model.label} | ${fmtInt(model.calls)} | ${fmtMoney(model.cost)} | ${fmtInt(model.tokens.miss)} | ${fmtInt(model.tokens.hit)} | ${fmtPct(hitRate(model.tokens))} |`);
  }
  lines.push('');

  lines.push('## 最贵的 10 轮');
  lines.push('');
  lines.push('| 时间 | 工作区 | 轮 | 花费 | 命中率 | 输出 | 技能 | 提示 |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | --- | --- |');
  const topTurns = view.rootTurns
    .slice()
    .sort((a, b) => b.turn.totalCost - a.turn.totalCost)
    .slice(0, 10);
  for (const { session, turn } of topTurns) {
    lines.push(`| ${fmtTime(turn.start, ledger.pricing.peakRule.timezone)} | ${session.workspace ?? ''} | ${turn.turn} | ${fmtMoney(turn.totalCost)} | ${fmtPct(hitRate(turn.tokens))} | ${fmtInt(turn.tokens.out)} | ${(turn.skills.join(',') || '—')} | ${escapeCell(turn.promptPreview || '(自动续跑)')} |`);
  }
  lines.push('');

  lines.push('## 技能成本');
  lines.push('');
  lines.push('| 技能 | 调用轮 | 生效期间成本 | 占比 | 调用轮成本 | 命中率 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  const skillRows = [...view.skills.values()]
    .map((active) => ({ active, invoked: view.skillsInvoked.get(active.name) }))
    .sort((a, b) => b.active.cost - a.active.cost);
  for (const { active, invoked } of skillRows) {
    const invokedLabel = invoked?.turns ? fmtInt(invoked.turns) : view.skillsInChildren.has(active.name) ? '子代理' : '0';
    lines.push(`| ${active.name} | ${invokedLabel} | ${fmtMoney(active.cost)} | ${pct(active.cost, t.cost)} | ${fmtMoney(invoked?.cost ?? 0)} | ${fmtPct(hitRate(active.tokens))} |`);
  }
  lines.push('');
  lines.push('> “生效期间成本”算技能加载后到下一个技能加载前的全部调用；“调用轮成本”只算真正执行了 `skill` 工具的轮次。两者差距大，说明技能被加载后长期占用上下文。');
  lines.push('');

  const withChildren = view.sessions.filter((session) => session.children.length > 0 && !session.parent);
  if (withChildren.length) {
    lines.push('## 子代理开销');
    lines.push('');
    lines.push('| 父会话 | 子代理 | 花费 | 占比 | 会话数 |');
    lines.push('| --- | --- | ---: | ---: | ---: |');
    for (const session of withChildren) {
      for (const child of session.children) {
        lines.push(`| ${escapeCell(session.title || session.id.slice(0, 16))} | ${escapeCell(child.agentLabel || child.title || child.id.slice(0, 16))} | ${fmtMoney(child.subtree.cost)} | ${pct(child.subtree.cost, t.cost)} | ${child.subtree.sessions} |`);
      }
    }
    lines.push('');
  }

  if (view.media.length) {
    lines.push('## 媒体生成（按张/按次）');
    lines.push('');
    lines.push('| 时间 | Provider/模型 | 规格 | 数量 | 单价 | 花费 | 任务 | 备注 |');
    lines.push('| --- | --- | --- | ---: | ---: | ---: | --- | --- |');
    for (const record of view.media.sort((a, b) => a.ts - b.ts)) {
      lines.push(`| ${fmtTime(record.ts, ledger.pricing.peakRule.timezone)} | ${record.provider}/${record.model} | ${record.variant || '—'} | ${fmtInt(record.quantity || 1)} | ${record.unitPrice ?? '待填'} | ${fmtMoney(record.cost, { currency: ledger.pricing.displayCurrency })} | ${record.task || '—'} | ${escapeCell(record.note || '')} |`);
    }
    lines.push('');
  }

  lines.push('## 未计入的隐藏调用（日志无精确 usage）');
  lines.push('');
  const b = view.blindSpots || ledger.blindSpots;
  lines.push(`- 标题生成请求：${fmtInt(b.titleRequests)} 次`);
  lines.push(`- 联网搜索请求：${fmtInt(b.searchRequests)} 次（另有 web_search 工具调用 ${fmtInt(b.searchCalls)} 次、web_fetch ${fmtInt(b.fetchCalls)} 次，按次计费约 ${fmtMoney((b.searchCalls + b.fetchCalls) * ledger.pricing.extras.web_search_per_call)}）`);
  lines.push(`- LLM 重试：${fmtInt(b.retries)} 次；失败尝试：${fmtInt(b.attemptsFailed)} 次`);
  lines.push(`- 无 usage 的 assistant 消息：${fmtInt(b.noUsageMessages)} 条`);
  lines.push('');
  lines.push('> 隐藏调用通常是“零头”，但重试和压缩会让账单明显偏离；精确对账时以平台账单为准。');
  lines.push('');
  lines.push('## 口径');
  lines.push('');
  lines.push('- `输入(未命中)` = `usage.inputTokens`，按未命中单价计；`输入(命中)` = `usage.cacheReadTokens`，按命中单价计；`输出` = `usage.outputTokens`。');
  lines.push('- 金额 = 未命中×未命中单价 + 命中×命中单价 + 输出×输出单价，单位元/百万 tokens。');
  lines.push('- 高峰：北京时间工作日 09:00-12:00、14:00-18:00；其余时段单价减半。节假日表在 `pricing.json` 的 `peakRule.holidays` 中维护。');
  lines.push('- 压缩（compaction）调用计入发起它的那一轮；子代理成本计入父会话中发起它的那一轮。');
  return lines.join('\n');
}

export function renderTurns(ledger, view, { limit = 200 } = {}) {
  const rows = view.rootTurns
    .map(({ session, turn }) => {
      const tokens = {
        miss: turn.tokens.miss + turn.subagentsTokens.miss,
        hit: turn.tokens.hit + turn.subagentsTokens.hit,
        out: turn.tokens.out + turn.subagentsTokens.out,
      };
      return {
        session,
        turn,
        tokens,
        cost: turn.totalCost,
        preview: turn.promptPreview || (turn.prompt ? '' : '(自动续跑)'),
        skills: turn.skills || [],
      };
    })
    .sort((a, b) => b.turn.start - a.turn.start)
    .slice(0, limit);
  const lines = ['# 指令明细', '', '> 每一行是一条人类指令（轮）；点击列宽有限，完整内容用 `dashboard` 网页看。', ''];
  lines.push('| 时间 | 会话 | 轮 | 指令 | 步 | 未命中 | 命中 | 输出 | 命中率 | 花费 |');
  lines.push('| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of rows) {
    const turn = row.turn;
    lines.push(
      `| ${fmtTime(turn.start, ledger.pricing.peakRule.timezone)} | ${escapeCell(row.session.title || row.session.id.slice(0, 12))} | ${turn.turn} | ${escapeCell(row.preview)} | ${turn.steps} | ${fmtInt(row.tokens.miss)} | ${fmtInt(row.tokens.hit)} | ${fmtInt(row.tokens.out)} | ${fmtPct(hitRate(row.tokens))} | ${fmtMoney(row.cost)} |`,
    );
  }
  lines.push('');
  lines.push('> 完整的提示词、技能、子代理花费用：`node dsh-cost.mjs dashboard` 生成网页。');
  return lines.join('\n');
}

export function renderSessions(ledger, view) {
  const lines = ['## 会话列表', '', '> 每行只算该会话自身的调用；子代理单列。父会话合计（含子代理）用 `tree` 看。', '', '| 会话 | 工作区 | 开始 | 花费 | 轮 | 命中率 | 标题 |', '| --- | --- | --- | ---: | ---: | ---: | --- |'];
  const rows = view.sessions
    .filter((session) => !session.parent)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  for (const session of rows) {
    lines.push(`| ${session.id.slice(0, 18)} | ${session.workspace ?? ''} | ${fmtTime(session.createdAt, ledger.pricing.peakRule.timezone)} | ${fmtMoney(session.totals.cost)} | ${session.totals.turns} | ${fmtPct(hitRate(session.totals.tokens))} | ${escapeCell(session.title || '')} |`);
    for (const child of session.children) {
      lines.push(`| ↳ ${child.id.slice(0, 16)} | ${child.workspace ?? ''} | ${fmtTime(child.createdAt, ledger.pricing.peakRule.timezone)} | ${fmtMoney(child.totals.cost)} | ${child.totals.turns} | ${fmtPct(hitRate(child.totals.tokens))} | ${escapeCell(child.agentLabel || child.title || '')} |`);
    }
  }
  return lines.join('\n');
}

export function renderSession(ledger, session, { withCalls = false } = {}) {
  const tz = ledger.pricing.peakRule.timezone;
  const lines = [];
  lines.push(`# 会话 ${session.id}`);
  lines.push('');
  lines.push(`- 标题：${session.agentLabel ? `${session.agentLabel} / ` : ''}${session.title || '—'}`);
  lines.push(`- 工作区：${session.cwd || '—'}`);
  lines.push(`- 模型：${session.model || '—'}｜预设：${session.preset || '—'}｜来源：${session.origin}${session.depth ? `（深度 ${session.depth}）` : ''}`);
  lines.push(`- 开始：${fmtTime(session.createdAt, tz)}｜跨度：${fmtDuration(session.totals.wallMs)}｜活跃：${fmtDuration(session.totals.activeMs)}`);
  lines.push(`- 花费：**${fmtMoney(session.subtree.cost)}**（含子代理 ${fmtMoney(session.subtree.cost - session.totals.cost)}）｜调用 ${session.totals.calls}｜轮 ${session.totals.turns}｜步 ${session.totals.steps}`);
  lines.push(`- Token：未命中 ${fmtInt(session.totals.tokens.miss)}｜命中 ${fmtInt(session.totals.tokens.hit)}｜输出 ${fmtInt(session.totals.tokens.out)}｜命中率 ${fmtPct(hitRate(session.totals.tokens))}`);
  lines.push(`- 缓存省下：${fmtMoney(session.totals.cacheSaved)}｜若全在低谷：${fmtMoney(session.totals.idleCost)}`);
  lines.push('');
  lines.push('| 轮 | 开始 | 墙钟 | 步 | 花费 | 未命中 | 命中 | 输出 | 命中率 | 子代理 | 任务 | 技能 | 提示 |');
  lines.push('| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |');
  for (const turn of session.turns) {
    lines.push(`| ${turn.turn} | ${fmtTime(turn.start, tz)} | ${fmtDuration(Math.max(0, turn.end - turn.start))} | ${turn.steps} | ${fmtMoney(turn.totalCost)} | ${fmtInt(turn.tokens.miss)} | ${fmtInt(turn.tokens.hit)} | ${fmtInt(turn.tokens.out)} | ${fmtPct(hitRate(turn.tokens))} | ${turn.subagentsCost ? fmtMoney(turn.subagentsCost) : '—'} | ${turn.task || '—'}${turn.arm ? `/${turn.arm}` : ''} | ${turn.skills.join(',') || '—'} | ${escapeCell(turn.promptPreview || '(自动续跑)')} |`);
  }
  lines.push('');
  if (session.children.length) {
    lines.push('## 子代理');
    lines.push('');
    for (const child of session.children) {
      lines.push(`- ${child.agentLabel || child.title || child.id}｜${fmtMoney(child.subtree.cost)}｜${child.subtree.sessions} 个会话｜${fmtDuration(child.totals.wallMs)}`);
    }
    lines.push('');
  }
  if (session.compactions.length) {
    lines.push('## 压缩');
    lines.push('');
    for (const compaction of session.compactions) {
      lines.push(`- 第 ${compaction.turn ?? '?'} 轮｜${fmtMoney(compaction.cost)}｜压缩后丢弃约 ${fmtInt(compaction.shadowedTokens)} tokens`);
    }
    lines.push('');
  }
  const sessionMedia = (ledger.media || []).filter((record) => record.sessionId === session.id);
  if (sessionMedia.length) {
    lines.push('## 媒体生成');
    lines.push('');
    for (const record of sessionMedia) {
      lines.push(`- ${record.provider}/${record.model}${record.variant ? ` ${record.variant}` : ''} × ${record.quantity || 1}｜${fmtMoney(record.cost, { currency: ledger.pricing.displayCurrency })}`);
    }
    lines.push('');
  }
  if (withCalls) {
    lines.push('## 逐次调用');
    lines.push('');
    lines.push('| # | 轮/步 | 时间 | 模型 | 未命中 | 命中 | 输出 | 单价档 | 花费 |');
    lines.push('| ---: | --- | --- | --- | ---: | ---: | ---: | --- | ---: |');
    for (const call of session.calls) {
      lines.push(`| ${call.seq} | ${call.turn ?? '—'}/${call.step ?? '—'} | ${fmtTime(call.time, tz)} | ${call.model ?? '—'} | ${fmtInt(call.miss)} | ${fmtInt(call.hit)} | ${fmtInt(call.out)} | ${call.peak === null ? '—' : call.peak ? '高峰' : '低谷'} | ${fmtMoney(call.cost)} |`);
    }
    lines.push('');
  }
  if (session.warnings.length) {
    lines.push('## 提醒');
    lines.push('');
    for (const warning of session.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function renderTasks(ledger, view) {
  const lines = ['# 任务账本', '', '> 任务标签写在提示词里：`#task=doc-01 #arm=B #run=3`。标签一旦出现，后续轮次自动继承。', ''];
  lines.push('| 任务 | 轮 | 花费 | 其中子代理 | 命中率 | 输出 | 分支 | 会话数 | 最后活动 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |');
  for (const task of [...view.tasks.values()].sort((a, b) => b.cost - a.cost)) {
    lines.push(`| ${task.task} | ${task.turns} | ${fmtMoney(task.cost)} | ${fmtMoney(task.subagentsCost)} | ${fmtPct(hitRate(task.tokens))} | ${fmtInt(task.tokens.out)} | ${[...task.arms].join(',') || '—'} | ${task.sessions.size} | ${fmtTime(task.lastAt, ledger.pricing.peakRule.timezone)} |`);
  }
  return lines.join('\n');
}

export function renderSkills(ledger, view) {
  const lines = ['# 技能成本', '', '> 两个口径：`生效期间` 算技能加载后到下一个技能加载前的全部调用（含它占用的上下文）；`调用轮` 只算真正执行了 `skill` 工具的轮次。', ''];
  lines.push('| 技能 | 调用轮 | 生效期间成本 | 占比 | 调用轮成本 | 会话 | 命中率 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  const rows = [...view.skills.values()]
    .map((active) => ({ active, invoked: view.skillsInvoked.get(active.name) }))
    .sort((a, b) => b.active.cost - a.active.cost);
  for (const { active, invoked } of rows) {
    const invokedLabel = invoked?.turns ? fmtInt(invoked.turns) : view.skillsInChildren.has(active.name) ? '子代理' : '0';
    lines.push(`| ${active.name} | ${invokedLabel} | ${fmtMoney(active.cost)} | ${fmtPct(active.cost / Math.max(1e-9, view.totals.cost))} | ${fmtMoney(invoked?.cost ?? 0)} | ${fmtInt(active.sessions.size)} | ${fmtPct(hitRate(active.tokens))} |`);
  }
  return lines.join('\n');
}

export function renderTree(ledger) {
  const lines = ['# 子代理成本树', ''];
  const render = (session, depth) => {
    const pad = '  '.repeat(depth);
    lines.push(`${pad}- ${session.agentLabel || session.title || session.id}｜${fmtMoney(session.subtree.cost)}｜${session.totals.calls} 次调用｜${fmtDuration(session.totals.wallMs)}`);
    for (const child of session.children) render(child, depth + 1);
  };
  for (const session of ledger.roots.sort((a, b) => b.subtree.cost - a.subtree.cost)) render(session, 0);
  return lines.join('\n');
}

export function renderPrice(ledger) {
  const cfg = ledger.pricing;
  const fx = Object.fromEntries(Object.entries(cfg.fx || {}).filter(([key]) => !key.startsWith('_')));
  const lines = ['# 价格表', '', `版本 ${cfg.version}｜显示币种 ${cfg.displayCurrency}｜汇率 ${JSON.stringify(fx)}`, ''];
  lines.push('## Token 模型');
  lines.push('');
  lines.push('| Provider | 模型 | 币种 | 档位 | 命中 | 未命中 | 输出 | 阶梯 |');
  lines.push('| --- | --- | --- | --- | ---: | ---: | ---: | --- |');
  for (const [provider, profile] of Object.entries(cfg.providers || {})) {
    for (const [name, model] of Object.entries(profile.models || {})) {
      const same = JSON.stringify(model.peak) === JSON.stringify(model.idle);
      lines.push(`| ${provider} | ${name} | ${model.currency} | ${same ? '统一' : '高峰'} | ${model.peak.hit} | ${model.peak.miss} | ${model.peak.output} | ${(model.tiers || []).map((tier) => `>${fmtInt(tier.above)}`).join(',') || '—'} |`);
      if (!same) lines.push(`| ${provider} | ${name} | ${model.currency} | 低谷 | ${model.idle.hit} | ${model.idle.miss} | ${model.idle.output} | — |`);
    }
  }
  lines.push('');
  lines.push('## 按张/按次（media）');
  lines.push('');
  lines.push('| Provider/模型 | 币种 | 计费 | 单价 |');
  lines.push('| --- | --- | --- | --- |');
  for (const [key, model] of Object.entries(cfg.media || {})) {
    const variants = Object.entries(model.variants || {}).map(([name, price]) => `${name}=${price === null ? '待填' : price}`).join('，');
    lines.push(`| ${key} | ${model.currency} | ${model.billing || 'image'} | ${variants || model.price || '待填'} |`);
  }
  return lines.join('\n');
}

function escapeCell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
