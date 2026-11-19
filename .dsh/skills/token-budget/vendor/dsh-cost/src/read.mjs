/**
 * 读取 DSH 会话日志（session.v4.jsonl.zstd），归一化成计费所需的记录。
 *
 * 数据源事实（已在本机验证）：
 * - assistant/message.data.usage = 提供方返回的精确用量
 *   { inputTokens(未命中缓存), cacheReadTokens(命中), cacheWriteTokens, outputTokens, totalTokens }
 * - step/start + step/end = 单步墙钟；tool/call + tool/result = 工具耗时
 * - turn/start + turn/end = 单轮边界
 * - session 头 = cwd / parentSession / delegationDepth / origin / isSeeded
 * - compaction/summary.data.usage = 压缩调用本身的精确用量（不在 assistant/message 里）
 * - subagent/catalog（父会话）+ subagent/descriptor（子会话）= 子代理归属与标签
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SKIP_PROMPT = /^(<system-reminder>|This is an automatically generated checkpoint)/;

export function listSessionFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'session.v4.jsonl.zstd') out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

export function parseJsonLines(text) {
  const events = [];
  let bad = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      bad += 1;
    }
  }
  return { events, bad };
}

function textOf(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** 一轮的归属标签：#task=xxx #arm=B #run=3（也接受中文冒号与空格分隔）。 */
export function parseTags(prompt) {
  const tags = {};
  const re = /#(task|arm|run)\s*[:=：]\s*([A-Za-z0-9_.:@-]+)/gi;
  let match;
  while ((match = re.exec(prompt || '')) !== null) tags[match[1].toLowerCase()] = match[2];
  return tags;
}

export function stripTags(prompt) {
  return String(prompt || '').replace(/#(task|arm|run)\s*[:=：]\s*[A-Za-z0-9_.:@-]+/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * 会话日志是首尾相接的多个 zstd 帧（每条事件一帧），整文件单帧解压会报
 * "Unknown frame descriptor"。这里按帧魔数切分逐帧解压再拼接；单帧文件走同一路径也成立。
 */
function decompressSessionLog(buf) {
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const marks = [];
  let cursor = 0;
  while ((cursor = buf.indexOf(magic, cursor)) !== -1) {
    marks.push(cursor);
    cursor += 1;
  }
  marks.push(buf.length);
  const parts = [];
  let k = 0;
  while (k < marks.length - 1) {
    let done = false;
    for (let m = k + 1; m < marks.length; m += 1) {
      try {
        const text = zlib.zstdDecompressSync(buf.subarray(marks[k], marks[m])).toString('utf8');
        if (!text.endsWith('\n') && marks[m] !== buf.length) continue;
        parts.push(text);
        k = m;
        done = true;
        break;
      } catch {
        // 该边界落在帧内部，换下一个候选
      }
    }
    if (!done) break;
  }
  return parts.join('');
}

export function readSessionFile(file) {
  const warnings = [];
  let text;
  try {
    text = decompressSessionLog(fs.readFileSync(file));
  } catch (error) {
    return { id: path.basename(path.dirname(file)), file, warnings: [`解压失败：${error.message}`], calls: [], turns: [], tools: [], skills: [], subagents: [], compactions: [], extras: {} };
  }
  const { events, bad } = parseJsonLines(text);
  if (bad) warnings.push(`${bad} 行无法解析（可能正在写入），已跳过`);
  const header = events.find((event) => event.type === 'session');
  if (!header) warnings.push('缺少 session 头');

  const id = header?.id || path.basename(path.dirname(file));
  const createdAt = header?.createdAt ?? events[0]?.time ?? null;
  const titleEvent = [...events].reverse().find((event) => event.type === 'session/title');
  const title = titleEvent?.data?.title ?? null;
  const descriptor = events.find((event) => event.type === 'subagent/descriptor');

  // ---- 轮边界 ----
  const turns = new Map();
  let openTurn = null;
  for (const event of events) {
    if (event.type === 'turn/start') {
      openTurn = { turn: event.data.turn, seqStart: event.seq, start: event.time, end: null, seqEnd: null, reason: null, prompts: [] };
      turns.set(event.data.turn, openTurn);
    } else if (event.type === 'turn/end') {
      const turn = turns.get(event.data.turn) || openTurn;
      if (turn) {
        turn.end = event.time;
        turn.seqEnd = event.seq;
        turn.reason = event.data.reason?.kind ?? 'unknown';
      }
      openTurn = null;
    } else if (event.type === 'user/message') {
      const data = event.data || {};
      const content = data.content ?? data.message?.content;
      const role = data.role ?? data.message?.role;
      const body = textOf(content);
      if (role !== 'user' || SKIP_PROMPT.test(body) || data.source?.kind !== 'user') continue;
      const turn = turns.get(data.turn) || openTurn;
      if (turn && body.trim()) turn.prompts.push(body.trim());
    }
  }
  const lastEventTime = events.length ? events[events.length - 1].time : createdAt;

  // ---- 步骤耗时 ----
  const steps = new Map(); // key `${turn}:${step}`
  for (const event of events) {
    if (event.type === 'step/start') steps.set(`${event.data.turn}:${event.data.step}`, { turn: event.data.turn, step: event.data.step, start: event.time, end: null });
    else if (event.type === 'step/end') {
      const step = steps.get(`${event.data.turn}:${event.data.step}`);
      if (step) step.end = event.time;
    }
  }

  // ---- LLM 计费调用 ----
  const calls = [];
  let noUsage = 0;
  for (const event of events) {
    if (event.type !== 'assistant/message') continue;
    const data = event.data || {};
    const usage = data.usage;
    if (!usage) {
      noUsage += 1;
      continue;
    }
    // 分叉/种子会话会复制父会话的历史事件；只统计新建之后真正发生的调用。
    if (header?.isSeeded && createdAt !== null && event.time < createdAt) continue;
    calls.push({
      kind: 'assistant',
      seq: event.seq,
      turn: data.turn ?? null,
      step: data.step ?? null,
      time: event.time,
      provider: data.message?.source?.provider ?? null,
      model: data.message?.source?.model ?? null,
      miss: usage.inputTokens ?? 0,
      hit: usage.cacheReadTokens ?? 0,
      write: usage.cacheWriteTokens ?? 0,
      out: usage.outputTokens ?? 0,
    });
  }

  // ---- 压缩调用（独立计费，不在 assistant/message 中）----
  const compactions = [];
  for (const event of events) {
    if (event.type !== 'compaction/summary') continue;
    const data = event.data || {};
    if (!data.usage) continue;
    const usage = data.usage;
    const record = {
      kind: 'compaction',
      seq: event.seq,
      turn: data.turn ?? turnOfSeq(turns, event.seq),
      step: null,
      time: event.time,
      provider: data.provider ?? null,
      model: data.model ?? null,
      miss: usage.inputTokens ?? 0,
      hit: usage.cacheReadTokens ?? 0,
      write: usage.cacheWriteTokens ?? 0,
      out: usage.outputTokens ?? 0,
      shadowedTokens: data.shadowedTokenCount ?? null,
    };
    compactions.push(record);
    calls.push(record);
  }

  // ---- 工具 ----
  const toolByCallId = new Map();
  const tools = [];
  const skills = [];
  for (const event of events) {
    if (event.type === 'tool/call') {
      const data = event.data || {};
      const args = safeJson(data.arguments);
      if (data.name === 'skill') {
        skills.push({ turn: data.turn, seq: event.seq, time: event.time, name: args?.name ?? '(未解析)' });
      }
      const record = { seq: event.seq, turn: data.turn, step: data.step, name: data.name, start: event.time, end: null, ok: null };
      tools.push(record);
      toolByCallId.set(data.callId, record);
    } else if (event.type === 'tool/result') {
      const callId = event.data?.message?.toolCallId;
      const record = toolByCallId.get(callId);
      if (record) {
        record.end = event.time;
        record.ok = event.data?.message?.isError === true ? false : true;
      }
    }
  }
  for (const tool of tools) if (tool.end === null) tool.end = null; // 未完成的工具调用不参与耗时统计
  for (const tool of tools) {
    if (tool.end === null) {
      tool.ms = 0;
      continue;
    }
    const step = steps.get(`${tool.turn}:${tool.step}`);
    const cap = step?.end ? Math.max(0, step.end - step.start) : 30 * 60 * 1000;
    tool.ms = Math.min(Math.max(0, tool.end - tool.start), cap);
  }

  // ---- 子代理 ----
  const subagents = [];
  for (const event of events) {
    if (event.type === 'subagent/catalog') {
      subagents.push({
        seq: event.seq,
        turn: turnOfSeq(turns, event.seq),
        childId: event.data?.childId ?? null,
        label: event.data?.label ?? null,
        createdAt: event.data?.childCreatedAt ?? null,
        mode: event.data?.mode ?? null,
      });
    }
  }

  // ---- 无法精确计费的附属调用（只计数，不混入精确账单）----
  const extras = {
    titleRequests: events.filter((event) => event.type === 'session/title-llm-request').length,
    searchRequests: events.filter((event) => event.type === 'web/deepseek-search-llm-request').length,
    searchCalls: tools.filter((tool) => tool.name === 'web_search').length,
    fetchCalls: tools.filter((tool) => tool.name === 'web_fetch').length,
    retries: events.filter((event) => event.type === 'llm/retry').length,
    attemptsFailed: events.filter((event) => event.type === 'assistant/attempt' && JSON.stringify(event.data).includes('"kind":"error"')).length,
  };
  if (noUsage) warnings.push(`${noUsage} 条 assistant 消息没有 usage（失败/中断的调用，可能仍被计费）`);

  const turnsOut = [...turns.values()].map((turn) => {
    const prompt = turn.prompts[0] ?? '';
    const turnSteps = [...steps.values()].filter((step) => step.turn === turn.turn);
    const turnTools = tools.filter((tool) => tool.turn === turn.turn);
    const stepMs = turnSteps.reduce((sum, step) => sum + Math.min(Math.max(0, (step.end ?? lastEventTime) - step.start), 30 * 60 * 1000), 0);
    const toolMs = turnTools.reduce((sum, tool) => sum + (tool.ms || 0), 0);
    return {
      turn: turn.turn,
      seqStart: turn.seqStart,
      seqEnd: turn.seqEnd,
      start: turn.start,
      end: turn.end ?? Math.min(lastEventTime, turn.start + 30 * 60 * 1000),
      open: turn.end === null,
      reason: turn.reason,
      prompt,
      promptPreview: stripTags(prompt).slice(0, 120),
      tags: parseTags(prompt),
      steps: turnSteps.length,
      stepMs,
      toolMs,
      llmMs: Math.max(0, stepMs - toolMs),
    };
  }).sort((a, b) => a.turn - b.turn);

  return {
    id,
    file,
    warnings,
    header: {
      id,
      cwd: header?.cwd ?? null,
      workspace: header?.cwd ? path.basename(header.cwd) : null,
      origin: header?.origin ?? 'user',
      parentId: header?.parentSession ?? null,
      depth: header?.delegationDepth ?? 0,
      preset: header?.agentPreset ?? null,
      seeded: header?.isSeeded === true,
      createdAt,
      lastEventAt: lastEventTime,
      title,
      agentLabel: descriptor?.data?.label ?? null,
      model: calls.find((call) => call.model)?.model ?? null,
    },
    calls,
    turns: turnsOut,
    tools,
    skills,
    subagents,
    compactions,
    extras,
  };
}

function turnOfSeq(turns, seq) {
  for (const turn of turns.values()) {
    const end = turn.seqEnd ?? Number.MAX_SAFE_INTEGER;
    if (seq >= turn.seqStart && seq <= end) return turn.turn;
  }
  return null;
}

/** 兼容 Windows 文件名：会话 id 只含字母数字和短横线。 */
export function safeName(id) {
  return String(id).replace(/[^A-Za-z0-9_.-]/g, '_');
}
