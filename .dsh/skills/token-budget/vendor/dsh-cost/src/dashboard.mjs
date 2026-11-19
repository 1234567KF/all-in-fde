/** 生成本地可视化看板：单文件 HTML，无外部依赖，不调用模型。 */
import { readFileSync } from 'node:fs';
import { hitRate } from './model.mjs';
import { fmtInt, fmtMoney, fmtPct, fmtTime } from './price.mjs';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function sessionDetail(session) {
  const callsByTurn = new Map();
  for (const call of session.calls || []) {
    const key = call.turn ?? null;
    if (!callsByTurn.has(key)) callsByTurn.set(key, []);
    callsByTurn.get(key).push({
      seq: call.seq,
      kind: call.kind || 'assistant',
      step: call.step,
      time: call.time,
      provider: call.provider,
      model: call.model,
      miss: call.miss,
      hit: call.hit,
      out: call.out,
      cost: call.cost,
      peak: call.peak,
      activeSkill: call.activeSkill || null,
    });
  }
  const turns = (session.turns || []).map((turn) => ({
    turn: turn.turn,
    start: turn.start,
    end: turn.end,
    prompt: turn.prompt || '',
    preview: turn.promptPreview || (turn.prompt ? '' : '(自动续跑)'),
    task: turn.task || '',
    arm: turn.arm || '',
    run: turn.run || '',
    skills: turn.skills || [],
    steps: turn.steps,
    calls: turn.calls,
    wallMs: Math.max(0, turn.end - turn.start),
    cost: turn.totalCost,
    ownCost: turn.cost,
    subagentCost: turn.subagentsCost,
    tokens: {
      miss: turn.tokens.miss,
      hit: turn.tokens.hit,
      out: turn.tokens.out,
    },
    subagentTokens: turn.subagentsTokens,
    childIds: (turn.children || []).map((child) => child.id),
    callRows: callsByTurn.get(turn.turn) || [],
  }));
  return {
    id: session.id,
    title: session.title || session.agentLabel || session.id,
    agentLabel: session.agentLabel || null,
    workspace: session.workspace,
    origin: session.origin,
    depth: session.depth,
    parentId: session.parentId || null,
    start: session.createdAt,
    model: session.model,
    preset: session.preset,
    cost: session.subtree.cost,
    ownCost: session.totals.cost,
    calls: session.subtree.calls,
    turns: session.totals.turns,
    tokens: session.subtree.tokens,
    hitRate: hitRate(session.subtree.tokens),
    childIds: (session.children || []).map((child) => child.id),
    turnRows: turns,
  };
}

function buildData(ledger, view) {
  const turns = view.rootTurns.map(({ session, turn }) => {
    const tokens = {
      miss: turn.tokens.miss + turn.subagentsTokens.miss,
      hit: turn.tokens.hit + turn.subagentsTokens.hit,
      out: turn.tokens.out + turn.subagentsTokens.out,
    };
    return {
      time: turn.start,
      end: turn.end,
      sessionId: session.id,
      sessionTitle: session.title || session.agentLabel || session.id,
      workspace: session.workspace,
      turn: turn.turn,
      prompt: turn.prompt || '',
      preview: turn.promptPreview || (turn.prompt ? '' : '(自动续跑)'),
      task: turn.task || '',
      arm: turn.arm || '',
      run: turn.run || '',
      skills: turn.skills || [],
      steps: turn.steps,
      calls: turn.calls,
      wallMs: Math.max(0, turn.end - turn.start),
      cost: turn.totalCost,
      ownCost: turn.cost,
      subagentCost: turn.subagentsCost,
      tokens,
      hitRate: hitRate(tokens),
    };
  });
  turns.sort((a, b) => b.time - a.time);

  const sessions = view.sessions
    .filter((session) => !session.parent)
    .map((session) => ({
      id: session.id,
      title: session.title || session.agentLabel || session.id,
      workspace: session.workspace,
      start: session.createdAt,
      cost: session.subtree.cost,
      ownCost: session.totals.cost,
      turns: session.totals.turns,
      calls: session.subtree.calls,
      tokens: session.subtree.tokens,
      hitRate: hitRate(session.subtree.tokens),
      children: session.children.length,
    }))
    .sort((a, b) => b.start - a.start);

  const details = {};
  for (const session of view.sessions) details[session.id] = sessionDetail(session);

  return {
    generatedAt: Date.now(),
    scope: ledger.epoch
      ? `${ledger.epoch.mode === 'workspace-from-time' ? `工作空间 ${ledger.epoch.workspace}` : '单会话'}，起点 ${new Date(ledger.epoch.resetAt).toLocaleString('zh-CN')}`
      : '全部历史',
    totals: {
      sessions: view.totals.sessions,
      calls: view.totals.calls,
      turns: view.totals.turns,
      cost: view.totals.cost,
      tokens: view.totals.tokens,
      hitRate: hitRate(view.totals.tokens),
      peakCost: view.totals.peakCost,
      mediaCost: view.totals.mediaCost || 0,
    },
    days: [...view.days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    models: [...view.models.values()].sort((a, b) => b.cost - a.cost),
    sessions,
    details,
    turns,
  };
}

function ssrParts(data) {
  const total = data.totals;
  const costNote = total.peakCost ? `其中高峰 ${fmtMoney(total.peakCost)}（${fmtPct(total.peakCost / total.cost)}）` : '无高峰花费';
  const maxDay = Math.max(...data.days.map((day) => day.cost), 0.000001);
  const bars = data.days
    .map((day) => `<div class="bar" title="${esc(day.date)} ${fmtMoney(day.cost)}"><i style="height:${Math.max(2, Math.round((day.cost / maxDay) * 72))}px"></i><span>${esc(day.date.slice(5))}</span></div>`)
    .join('');
  const rows = data.turns
    .slice(0, 300)
    .map((turn) => `<tr><td>${fmtTime(turn.time, 'Asia/Shanghai')}</td><td>${esc(turn.sessionTitle)}</td><td class="num">${turn.turn}</td><td><div class="prompt">${esc(turn.preview || turn.prompt.slice(0, 90) || '(自动续跑)')}</div></td><td class="num">${turn.steps}</td><td class="num">${fmtInt(turn.tokens.miss)}</td><td class="num">${fmtInt(turn.tokens.hit)}</td><td class="num">${fmtInt(turn.tokens.out)}</td><td class="num">${fmtPct(turn.hitRate)}</td><td class="num">${fmtMoney(turn.cost)}</td></tr>`)
    .join('');
  const sessions = data.sessions
    .map((session) => `<tr><td>${fmtTime(session.start, 'Asia/Shanghai')}</td><td>${esc(session.title)}</td><td>${esc(session.workspace || '')}</td><td class="num">${session.turns}</td><td class="num">${fmtInt(session.calls)}</td><td class="num">${fmtMoney(session.cost)}</td><td class="num">${fmtPct(session.hitRate)}</td><td class="num">${session.children || '—'}</td></tr>`)
    .join('');
  const details = data.turns
    .map((turn) => `<details><summary>${fmtTime(turn.time, 'Asia/Shanghai')} · ${esc(turn.sessionTitle)} · 第 ${turn.turn} 轮 · ${fmtMoney(turn.cost)}</summary><pre>${esc(turn.prompt || '(没有提示词)')}</pre><div class="meta">${turn.steps} 步 · 未命中 ${fmtInt(turn.tokens.miss)} · 命中 ${fmtInt(turn.tokens.hit)} · 输出 ${fmtInt(turn.tokens.out)}${turn.subagentCost ? ` · 子代理 ${fmtMoney(turn.subagentCost)}` : ''}</div></details>`)
    .join('');
  return {
    __SSR_COST__: fmtMoney(total.cost),
    __SSR_COST_NOTE__: costNote,
    __SSR_TURNS__: fmtInt(total.turns),
    __SSR_CALLS_NOTE__: `${fmtInt(total.calls)} 次模型调用`,
    __SSR_OUT__: fmtInt(total.tokens.out),
    __SSR_OUT_NOTE__: `未命中 ${fmtInt(total.tokens.miss)} · 命中 ${fmtInt(total.tokens.hit)}`,
    __SSR_HIT__: fmtPct(total.hitRate),
    __SSR_HIT_NOTE__: '命中输入 / 全部输入',
    __SSR_PEAK__: total.cost ? fmtPct(total.peakCost / total.cost) : '—',
    __SSR_BARS__: bars,
    __SSR_ROWS__: rows,
    __SSR_SESSIONS__: sessions,
    __SSR_DETAILS__: details,
    __SSR_COUNT__: `${data.turns.length} 条`,
  };
}

export function renderDashboard(ledger, view) {
  const data = buildData(ledger, view);
  const template = readFileSync(new URL('./dashboard.html', import.meta.url), 'utf8');
  let html = template.replace('__DSH_COST_DATA__', () => safeJson(data));
  for (const [key, value] of Object.entries(ssrParts(data))) html = html.replaceAll(key, () => value);
  return html;
}

export { buildData as buildDashboardData };
