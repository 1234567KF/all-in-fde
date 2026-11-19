/** 把归一化会话组装成可查询的账本：按轮/任务/技能/子代理/模型/日期聚合。 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert, costOf, idleRatesAt, mediaPrice, ratesAt, resolveEntry } from './price.mjs';

const dshCostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const epochFile = join(dshCostRoot, 'data', 'epoch.json');

function loadEpoch() {
  if (!existsSync(epochFile)) return null;
  try {
    const data = JSON.parse(readFileSync(epochFile, 'utf8'));
    return Number.isFinite(data.resetAt) ? data : null;
  } catch {
    return null;
  }
}

/** 只保留 epoch 之后的调用；有调用的会话才留下。 */
function filterSession(session, resetAt) {
  const calls = (session.calls || []).filter((call) => call.time >= resetAt);
  if (!calls.length) return null;
  const turns = (session.turns || []).filter((turn) => (turn.end ?? session.header?.lastEventAt ?? 0) >= resetAt);
  const tools = (session.tools || []).filter((tool) => (tool.start ?? tool.time ?? 0) >= resetAt);
  const compactions = (session.compactions || []).filter((compaction) => compaction.time >= resetAt);
  return {
    ...session,
    calls,
    turns,
    tools,
    compactions,
    extras: {},
    header: {
      ...session.header,
      createdAt: Math.max(session.header?.createdAt ?? 0, resetAt),
      lastEventAt: session.header?.lastEventAt ?? resetAt,
    },
  };
}

const SKILL_BASE = '(未加载技能)';

function sumTokens() {
  return { miss: 0, hit: 0, write: 0, out: 0 };
}

function addTokens(target, source) {
  target.miss += source.miss || 0;
  target.hit += source.hit || 0;
  target.write += source.write || 0;
  target.out += source.out || 0;
}

function emptyBucket() {
  return { calls: 0, cost: 0, idleCost: 0, tokens: sumTokens(), cacheSaved: 0, costParts: { miss: 0, hit: 0, out: 0 } };
}

function addBucket(target, call) {
  target.calls += 1;
  target.cost += call.cost ?? 0;
  target.idleCost += call.idleCost ?? 0;
  target.cacheSaved += call.cacheSaved ?? 0;
  target.costParts.miss += call.costParts?.miss ?? 0;
  target.costParts.hit += call.costParts?.hit ?? 0;
  target.costParts.out += call.costParts?.out ?? 0;
  addTokens(target.tokens, call);
}

export function hitRate(tokens) {
  const context = (tokens.hit || 0) + (tokens.miss || 0);
  return context > 0 ? tokens.hit / context : null;
}

export function priceSession(raw, pricing) {
  const calls = raw.calls.map((call) => {
    const resolved = resolveEntry(pricing, call.provider, call.model);
    const rates = resolved ? ratesAt(pricing, resolved, call.time, call.miss + call.hit) : null;
    const idle = resolved ? idleRatesAt(pricing, resolved, call.miss + call.hit) : null;
    const costNative = rates ? costOf(call, rates, pricing.tokenUnit ?? 1e6) : null;
    const idleNative = idle ? costOf(call, idle, pricing.tokenUnit ?? 1e6) : null;
    const unit = pricing.tokenUnit ?? 1e6;
    const part = (quantity, rate) => (rates && rate ? convert((quantity * rate) / unit, rates.currency, pricing) : 0);
    return {
      ...call,
      costNative,
      cost: costNative === null ? null : convert(costNative, rates.currency, pricing),
      idleCost: idleNative === null ? null : convert(idleNative, idle.currency, pricing),
      cacheSaved: rates ? convert((call.hit * (rates.miss - rates.hit)) / unit, rates.currency, pricing) : 0,
      costParts: { miss: part(call.miss, rates?.miss), hit: part(call.hit, rates?.hit), out: part(call.out, rates?.output) },
      currency: rates?.currency ?? null,
      peak: rates ? rates.peak : null,
      tier: rates?.tier ?? null,
      modelLabel: rates?.label ?? call.model,
      unknownModel: !rates,
      activeSkill: null,
    };
  });

  // 技能归因：会话内“最近一次加载的技能”持续生效，直到下一个技能被加载。
  const skills = [...raw.skills].sort((a, b) => a.seq - b.seq);
  let active = null;
  let cursor = 0;
  for (const call of [...calls].sort((a, b) => a.seq - b.seq)) {
    while (cursor < skills.length && skills[cursor].seq < call.seq) {
      active = skills[cursor].name;
      cursor += 1;
    }
    call.activeSkill = active;
  }

  const turnList = raw.turns.map((turn) => ({
    ...turn,
    tokens: sumTokens(),
    cost: 0,
    idleCost: 0,
    cacheSaved: 0,
    calls: 0,
    skills: skills.filter((skill) => skill.turn === turn.turn).map((skill) => skill.name),
    children: [],
    subagentsCost: 0,
    subagentsTokens: sumTokens(),
    totalCost: 0,
  }));
  const turnByNumber = new Map(turnList.map((turn) => [turn.turn, turn]));
  const orphans = [];
  for (const call of calls) {
    const turn = turnByNumber.get(call.turn);
    if (!turn) {
      orphans.push(call);
      continue;
    }
    turn.calls += 1;
    turn.cost += call.cost ?? 0;
    turn.idleCost += call.idleCost ?? 0;
    turn.cacheSaved += call.cacheSaved ?? 0;
    addTokens(turn.tokens, call);
  }

  // 任务标签：一旦出现，后续轮次继承，多轮任务只标一次。
  let sticky = { task: null, arm: null, run: null };
  for (const turn of turnList) {
    sticky = {
      task: turn.tags.task ?? sticky.task,
      arm: turn.tags.arm ?? sticky.arm,
      run: turn.tags.run ?? sticky.run,
    };
    turn.task = sticky.task;
    turn.arm = sticky.arm;
    turn.run = sticky.run;
    turn.totalCost = turn.cost;
  }

  const totals = emptyBucket();
  for (const call of calls) addBucket(totals, call);
  const bySeq = new Map(calls.map((call) => [call.seq, call]));
  const compactions = (raw.compactions || []).map((compaction) => ({ ...compaction, ...(bySeq.get(compaction.seq) || {}) }));

  return {
    ...raw.header,
    parent: null,
    children: [],
    calls,
    turns: turnList,
    tools: raw.tools,
    skills,
    subagents: raw.subagents,
    compactions,
    orphanCalls: orphans,
    extras: raw.extras,
    warnings: raw.warnings,
    totals: {
      ...totals,
      turns: turnList.length,
      steps: turnList.reduce((sum, turn) => sum + turn.steps, 0),
      llmMs: turnList.reduce((sum, turn) => sum + turn.llmMs, 0),
      toolMs: turnList.reduce((sum, turn) => sum + turn.toolMs, 0),
      wallMs: Math.max(0, (raw.header.lastEventAt ?? 0) - (raw.header.createdAt ?? 0)),
      activeMs: turnList.reduce((sum, turn) => sum + Math.max(0, turn.end - turn.start), 0),
      peakCost: calls.filter((call) => call.peak).reduce((sum, call) => sum + (call.cost ?? 0), 0),
      subagentSessions: 0,
    },
    subtree: { cost: 0, tokens: sumTokens(), calls: 0, sessions: 1 },
  };
}

/** 子会话成本向上汇总；同一笔钱只在上层出现一次。 */
function rollup(session, seen = new Set()) {
  if (seen.has(session.id)) return session.subtree;
  seen.add(session.id);
  let cost = session.totals.cost;
  let calls = session.totals.calls;
  const tokens = { ...session.totals.tokens };
  let sessions = 1;
  for (const child of session.children) {
    const sub = rollup(child, seen);
    cost += sub.cost;
    calls += sub.calls;
    tokens.miss += sub.tokens.miss;
    tokens.hit += sub.tokens.hit;
    tokens.write += sub.tokens.write;
    tokens.out += sub.tokens.out;
    sessions += sub.sessions;
  }
  session.subtree = { cost, tokens, calls, sessions };
  session.totals.subagentSessions = sessions - 1;
  return session.subtree;
}

/** 当前会话及其子代理/孙代理的 id 集合。 */
function descendantIds(rawSessions, rootId) {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const session of rawSessions) {
      const id = session.header?.id;
      const parent = session.header?.parentId;
      if (id && parent && ids.has(parent) && !ids.has(id)) {
        ids.add(id);
        changed = true;
      }
    }
  }
  return ids;
}

export function buildLedger(rawSessions, pricing, mediaRecords = []) {
  const epoch = loadEpoch();
  const resetAt = epoch?.resetAt ?? 0;
  const scopeIds =
    epoch?.mode === 'from-session' && epoch.sessionId ? descendantIds(rawSessions, epoch.sessionId) : null;
  const scopedSessions = scopeIds ? rawSessions.filter((session) => scopeIds.has(session.header?.id)) : rawSessions;
  const sessionsInScope = resetAt
    ? scopedSessions.map((session) => filterSession(session, resetAt)).filter(Boolean)
    : scopedSessions;
  const mediaInScope = resetAt ? mediaRecords.filter((record) => (record.ts ?? 0) >= resetAt) : mediaRecords;
  const priced = sessionsInScope.map((raw) => priceSession(raw, pricing));
  const byId = new Map(priced.map((session) => [session.id, session]));

  for (const session of priced) {
    if (!session.parentId) continue;
    const parent = byId.get(session.parentId);
    if (!parent) continue;
    session.parent = parent;
    parent.children.push(session);
  }
  for (const session of priced) session.children.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  for (const session of priced) {
    if (!session.parent) rollup(session);
  }

  // 子代理成本挂到父会话的发起轮次
  for (const session of priced) {
    if (!session.parent) continue;
    const parent = session.parent;
    const catalog = (parent.subagents || []).find((entry) => entry.childId === session.id);
    let turn = catalog?.turn ? parent.turns.find((candidate) => candidate.turn === catalog.turn) : null;
    if (!turn) {
      const createdAt = session.createdAt ?? 0;
      turn = parent.turns.find((candidate) => candidate.start <= createdAt && createdAt <= candidate.end);
    }
    if (!turn) continue;
    turn.children.push({
      id: session.id,
      label: catalog?.label ?? session.agentLabel ?? session.title ?? session.id,
      cost: session.subtree.cost,
      tokens: session.subtree.tokens,
      calls: session.subtree.calls,
      model: session.model,
    });
    turn.subagentsCost += session.subtree.cost;
    addTokens(turn.subagentsTokens, session.subtree.tokens);
    turn.totalCost += session.subtree.cost;
  }

  const roots = priced.filter((session) => !session.parent);
  const totals = {
    calls: 0,
    cost: 0,
    idleCost: 0,
    cacheSaved: 0,
    tokens: sumTokens(),
    peakCost: 0,
    unknownModelCalls: 0,
    sessions: priced.length,
    rootSessions: roots.length,
    turns: priced.reduce((sum, session) => sum + session.totals.turns, 0),
    steps: priced.reduce((sum, session) => sum + session.totals.steps, 0),
    wallMs: priced.reduce((sum, session) => sum + session.totals.wallMs, 0),
    llmMs: priced.reduce((sum, session) => sum + session.totals.llmMs, 0),
    toolMs: priced.reduce((sum, session) => sum + session.totals.toolMs, 0),
  };
  for (const session of priced) {
    totals.calls += session.totals.calls;
    totals.cost += session.totals.cost;
    totals.idleCost += session.totals.idleCost;
    totals.cacheSaved += session.totals.cacheSaved;
    addTokens(totals.tokens, session.totals.tokens);
    totals.peakCost += session.totals.peakCost;
    totals.unknownModelCalls += session.calls.filter((call) => call.unknownModel).length;
  }

  const days = new Map();
  const models = new Map();
  const skills = new Map();
  for (const session of priced) {
    for (const call of session.calls) {
      const date = dayKey(call.time, pricing.peakRule.timezone);
      const day = days.get(date) || { date, calls: 0, cost: 0, tokens: sumTokens(), peakCost: 0 };
      day.calls += 1;
      day.cost += call.cost ?? 0;
      addTokens(day.tokens, call);
      if (call.peak) day.peakCost += call.cost ?? 0;
      days.set(date, day);

      const modelKey = call.model ?? '(unknown)';
      const model = models.get(modelKey) || { model: modelKey, label: call.modelLabel ?? modelKey, calls: 0, cost: 0, tokens: sumTokens(), peakCost: 0 };
      model.calls += 1;
      model.cost += call.cost ?? 0;
      addTokens(model.tokens, call);
      if (call.peak) model.peakCost += call.cost ?? 0;
      models.set(modelKey, model);

      const skillKey = call.activeSkill || SKILL_BASE;
      const skill = skills.get(skillKey) || { name: skillKey, calls: 0, cost: 0, tokens: sumTokens(), turns: new Set(), sessions: new Set() };
      skill.calls += 1;
      skill.cost += call.cost ?? 0;
      addTokens(skill.tokens, call);
      if (call.kind === 'assistant') {
        skill.turns.add(`${session.id}:${call.turn}`);
        skill.sessions.add(session.id);
      }
      skills.set(skillKey, skill);
    }
  }

  const tasks = new Map();
  for (const session of roots) {
    for (const turn of session.turns) {
      const key = turn.task || '(未标注)';
      const task = tasks.get(key) || {
        task: key,
        turns: 0,
        cost: 0,
        tokens: sumTokens(),
        peakCost: 0,
        sessions: new Set(),
        arms: new Set(),
        runs: new Set(),
        lastAt: 0,
        subagentsCost: 0,
        cacheSaved: 0,
        idleCost: 0,
      };
      task.turns += 1;
      task.cost += turn.totalCost;
      task.idleCost += turn.idleCost;
      task.cacheSaved += turn.cacheSaved;
      task.subagentsCost += turn.subagentsCost;
      addTokens(task.tokens, turn.tokens);
      addTokens(task.tokens, turn.subagentsTokens);
      task.sessions.add(session.id);
      if (turn.arm) task.arms.add(turn.arm);
      if (turn.run) task.runs.add(turn.run);
      task.lastAt = Math.max(task.lastAt, turn.end);
      if (turn.calls > 0) {
        const peakCost = session.calls.filter((call) => call.turn === turn.turn && call.peak).reduce((sum, call) => sum + (call.cost ?? 0), 0);
        task.peakCost += peakCost;
      }
      tasks.set(key, task);
    }
  }

  const blindSpots = { titleRequests: 0, searchRequests: 0, searchCalls: 0, fetchCalls: 0, retries: 0, attemptsFailed: 0, noUsageMessages: 0 };
  for (const session of priced) {
    for (const key of Object.keys(blindSpots)) {
      if (key === 'noUsageMessages') continue;
      blindSpots[key] += session.extras?.[key] ?? 0;
    }
    for (const warning of session.warnings || []) {
      const match = /(\d+) 条 assistant/.exec(warning);
      if (match) blindSpots.noUsageMessages += Number(match[1]);
    }
  }

  // 非 token 计费（生图/视频/按次）：来自 data/media.jsonl，独立于会话 usage。
  const media = mediaInScope.map((record) => {
    const pricedRecord = mediaPrice(pricing, record);
    const session = record.sessionId ? byId.get(record.sessionId) : null;
    if (!pricedRecord) {
      return { ...record, workspace: session?.workspace ?? null, label: record.model, cost: null, missingPrice: true, currency: pricing.displayCurrency };
    }
    return {
      ...pricedRecord,
      workspace: session?.workspace ?? null,
      cost: convert(pricedRecord.costNative, pricedRecord.currency, pricing),
    };
  });
  const mediaCost = media.reduce((sum, record) => sum + (record.cost ?? 0), 0);
  totals.mediaCost = mediaCost;
  totals.cost += mediaCost;
  for (const record of media) {
    if (!record.task) continue;
    const task = tasks.get(record.task);
    if (!task) continue;
    task.cost += record.cost ?? 0;
  }

  return { pricing, epoch, sessions: priced, roots, totals, days, models, skills, tasks, media, blindSpots };
}

export function dayKey(timeMs, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timeMs));
}

/** 一组调用的汇总（供 A/B 与报表复用）。 */
export function aggregateCalls(calls) {
  const bucket = emptyBucket();
  for (const call of calls) addBucket(bucket, call);
  return bucket;
}

export { SKILL_BASE };
