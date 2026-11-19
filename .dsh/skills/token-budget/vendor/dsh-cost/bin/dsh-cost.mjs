#!/usr/bin/env node
/**
 * dsh-cost — DSH 会话精准计费与 A/B 验证
 *
 *   node dsh-cost.mjs sync                  # 增量读取 ~/.dsh/sessions
 *   node dsh-cost.mjs report                # 总账
 *   node dsh-cost.mjs session <id前缀>      # 单会话逐轮
 *   node dsh-cost.mjs tasks                 # 任务账本
 *   node dsh-cost.mjs skills                # 技能成本
 *   node dsh-cost.mjs tree                  # 子代理成本树
 *   node dsh-cost.mjs compare --task doc-01 # A/B 对比
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { listSessionFiles, readSessionFile, safeName } from '../src/read.mjs';
import { convert, fmtInt, fmtMoney, fmtTime, loadPricing, mediaPrice } from '../src/price.mjs';
import { buildLedger } from '../src/model.mjs';
import { renderOverview, renderPrice, renderSession, renderSessions, renderSkills, renderTasks, renderTree, renderTurns, viewOf } from '../src/report.mjs';
import { renderDashboard } from '../src/dashboard.mjs';
import { compareTask, renderCompare } from '../src/ab.mjs';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULTS = {
  data: path.join(HERE, 'data'),
  pricing: path.join(HERE, 'pricing.json'),
  sessionsRoot: path.join(os.homedir(), '.dsh', 'sessions'),
};

function parse() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      data: { type: 'string' },
      pricing: { type: 'string' },
      'sessions-root': { type: 'string' },
      force: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      days: { type: 'string' },
      workspace: { type: 'string' },
      out: { type: 'string' },
      limit: { type: 'string' },
      calls: { type: 'boolean', default: false },
      sessions: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      task: { type: 'string' },
      base: { type: 'string', default: 'A' },
      cand: { type: 'string', default: 'B' },
      judgments: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      qty: { type: 'string' },
      variant: { type: 'string' },
      amount: { type: 'string' },
      session: { type: 'string' },
      turn: { type: 'string' },
      note: { type: 'string' },
      interval: { type: 'string', default: '60' },
      since: { type: 'string' },
      at: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      'no-sync': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  return { values, command: positionals[0] ?? 'help', args: positionals.slice(1) };
}

const opts = parse();
const dataDir = path.resolve(opts.values.data ?? DEFAULTS.data);
const pricingFile = path.resolve(opts.values.pricing ?? DEFAULTS.pricing);
const sessionsRoot = path.resolve(opts.values['sessions-root'] ?? DEFAULTS.sessionsRoot);

function findCurrentSession(preferredId) {
  const all = listSessionFiles(sessionsRoot);
  const envId = preferredId || process.env.DSH_SESSION_ID;
  const ordered = [];
  if (envId) {
    const hit = all.find((file) => path.basename(path.dirname(file)) === envId);
    if (hit) ordered.push(hit);
    else if (preferredId) throw new Error(`找不到会话：${preferredId}`);
  }
  const rest = all
    .filter((file) => path.basename(path.dirname(file)).startsWith('session-') && !ordered.includes(file))
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((item) => item.file);
  ordered.push(...rest);
  for (const file of ordered.slice(0, 3)) {
    try {
      const session = readSessionFile(file);
      if (session?.header?.id) return { id: session.header.id, createdAt: session.header.createdAt, file };
    } catch {}
  }
  return null;
}

function loadEpoch() {
  const file = path.join(dataDir, 'epoch.json');
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Number.isFinite(data.resetAt) ? data : null;
  } catch {
    return null;
  }
}

function pruneScope(epoch) {
  const mode = epoch?.mode;
  if (mode === 'from-session' && !epoch.sessionId) return 0;
  if (mode !== 'from-session' && mode !== 'workspace-from-time') return 0;
  if (mode === 'workspace-from-time' && !epoch.workspace) return 0;
  const sessionsDir = path.join(dataDir, 'sessions');
  if (!fs.existsSync(sessionsDir)) return 0;
  const indexPath = path.join(dataDir, 'index.json');
  const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : { sessions: {} };
  const entries = fs
    .readdirSync(sessionsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        return { name, session: JSON.parse(fs.readFileSync(path.join(sessionsDir, name), 'utf8')) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  let allowed;
  if (mode === 'workspace-from-time') {
    allowed = new Set(
      entries
        .filter(
          (entry) =>
            entry.session?.header?.workspace === epoch.workspace &&
            (entry.session?.calls || []).some((call) => call.time >= epoch.resetAt),
        )
        .map((entry) => entry.session.header.id),
    );
  } else {
    allowed = new Set([epoch.sessionId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of entries) {
        const id = entry.session?.header?.id;
        const parent = entry.session?.header?.parentId;
        if (id && parent && allowed.has(parent) && !allowed.has(id)) {
          allowed.add(id);
          changed = true;
        }
      }
    }
  }
  let removed = 0;
  for (const entry of entries) {
    const id = entry.session?.header?.id;
    if (!id || allowed.has(id)) continue;
    fs.rmSync(path.join(sessionsDir, entry.name), { force: true });
    delete index.sessions[id];
    removed += 1;
  }
  if (removed) fs.writeFileSync(indexPath, JSON.stringify({ ...index, updatedAt: Date.now() }, null, 2));
  return removed;
}

function syncSessions({ force = false, quiet = false, sinceMs, onlyId, ignoreEpoch = false } = {}) {
  const sessionsDir = path.join(dataDir, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const epoch = ignoreEpoch ? null : loadEpoch();
  const cutoff = sinceMs ?? (epoch?.resetAt ? epoch.resetAt - 10 * 60 * 1000 : 0);
  const only = onlyId;
  const indexPath = path.join(dataDir, 'index.json');
  const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : { sessions: {} };
  const files = listSessionFiles(sessionsRoot).filter((file) => !only || path.basename(path.dirname(file)) === only);
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const file of files) {
    const id = path.basename(path.dirname(file));
    const stat = fs.statSync(file);
    if (cutoff && stat.mtimeMs < cutoff) {
      skipped += 1;
      continue;
    }
    const outFile = path.join(sessionsDir, `${safeName(id)}.json`);
    const previous = index.sessions[id];
    if (!force && previous && previous.mtimeMs === stat.mtimeMs && previous.size === stat.size && fs.existsSync(outFile)) {
      skipped += 1;
      continue;
    }
    const session = readSessionFile(file);
    if (session.warnings.some((warning) => warning.startsWith('解压失败'))) {
      failed += 1;
      if (!quiet) console.error(`! ${id}: ${session.warnings[0]}`);
      continue;
    }
    session.file = path.relative(sessionsRoot, file);
    fs.writeFileSync(outFile, JSON.stringify(session));
    index.sessions[id] = { file: session.file, mtimeMs: stat.mtimeMs, size: stat.size, lastEventAt: session.header.lastEventAt, syncedAt: Date.now() };
    updated += 1;
  }
  fs.writeFileSync(indexPath, JSON.stringify({ version: 1, sessionsRoot, updatedAt: Date.now(), sessions: index.sessions }, null, 2));
  const pruned = pruneScope(epoch);
  if (!quiet) console.log(`同步完成：扫描 ${files.length} 个会话，更新 ${updated}，跳过 ${skipped}，失败 ${failed}${pruned ? `，清理范围外 ${pruned}` : ''}`);
  return { updated, skipped, failed, total: files.length };
}

function loadSessions() {
  const sessionsDir = path.join(dataDir, 'sessions');
  if (!fs.existsSync(sessionsDir)) return [];
  return fs
    .readdirSync(sessionsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(sessionsDir, name), 'utf8')))
    .filter((session) => session.header && session.header.id);
}

function loadMedia() {
  const file = path.join(dataDir, 'media.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadLedger({ sync = true, all = false } = {}) {
  if (sync && !opts.values['no-sync']) syncSessions({ quiet: true, ignoreEpoch: all });
  const sessions = loadSessions();
  if (!sessions.length) {
    console.error(`没有会话数据。先运行：node ${path.relative(process.cwd(), path.join(HERE, 'bin', 'dsh-cost.mjs'))} sync`);
    process.exit(2);
  }
  return buildLedger(sessions, loadPricing(pricingFile), loadMedia(), { ignoreEpoch: all });
}

function output(markdown, { json } = {}) {
  if (json) return;
  process.stdout.write(`${markdown.trimEnd()}\n`);
  if (opts.values.out) {
    const outFile = path.resolve(opts.values.out);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${markdown.trimEnd()}\n`);
    console.error(`已写入 ${outFile}`);
  }
}

function viewOptions() {
  return {
    workspace: opts.values.workspace,
    days: opts.values.days ? Number(opts.values.days) : undefined,
  };
}

switch (opts.command) {
  case 'sync': {
    const sinceMs = opts.values.since ? Date.parse(opts.values.since) : undefined;
    syncSessions({ force: opts.values.force, quiet: opts.values.quiet, sinceMs, ignoreEpoch: Boolean(opts.values.all) });
    break;
  }
  case 'reset': {
    const current = opts.values.at ? null : findCurrentSession(opts.values.session);
    const at = opts.values.at ? (opts.values.at === 'now' ? Date.now() : Date.parse(opts.values.at)) : current?.createdAt ?? Date.now();
    if (!Number.isFinite(at)) fail('--at 不是合法时间');
    if (opts.values['dry-run']) {
      console.log(`将重置到：${new Date(at).toLocaleString('zh-CN')}${current ? `（会话 ${current.id}）` : '（指定时间）'}`);
      console.log(`将删除：${dataDir}\\sessions、squeeze、index.json、media.jsonl、watch-status.json、watch.log，以及 ${path.join(path.dirname(dataDir), 'reports')}`);
      break;
    }
    const reportsDir = path.join(path.dirname(dataDir), 'reports');
    for (const target of [path.join(dataDir, 'sessions'), path.join(dataDir, 'squeeze'), reportsDir]) {
      fs.rmSync(target, { recursive: true, force: true });
    }
    for (const file of ['index.json', 'media.jsonl', 'watch-status.json', 'watch.log', 'watch-console.log']) {
      fs.rmSync(path.join(dataDir, file), { force: true });
    }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'epoch.json'),
      JSON.stringify(
        {
          resetAt: at,
          resetAtIso: new Date(at).toISOString(),
          sessionId: current?.id ?? null,
          mode: current ? 'from-session' : 'from-time',
          note: opts.values.note ?? 'manual reset',
        },
        null,
        2,
      ),
    );
    const result = syncSessions({
      force: true,
      quiet: true,
      onlyId: current?.id,
      sinceMs: current ? 0 : at - 10 * 60 * 1000,
    });
    console.log(`计费起点：${new Date(at).toLocaleString('zh-CN')}${current ? `（会话 ${current.id}）` : '（指定时间）'}`);
    console.log(`同步范围内的会话：扫描 ${result.total}，更新 ${result.updated}，跳过 ${result.skipped}，失败 ${result.failed}`);
    console.log('运行 report 生成新账单；此前的旧会话已清除。');
    break;
  }
  case 'watch': {
    const intervalSec = Math.max(10, Number(opts.values.interval ?? 60) || 60);
    const statusFile = path.join(dataDir, 'watch-status.json');
    const logFile = path.join(dataDir, 'watch.log');
    fs.mkdirSync(dataDir, { recursive: true });
    let busy = false;
    let debounce = null;
    const status = { startedAt: Date.now(), pid: process.pid, intervalSec, sessionsRoot, lastSyncAt: null, lastError: null };
    const write = () => fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
    const tick = () => {
      if (busy) return;
      busy = true;
      const started = Date.now();
      try {
        const result = syncSessions({ quiet: true });
        Object.assign(status, result, { lastSyncAt: Date.now(), tookMs: Date.now() - started, lastError: null });
      } catch (error) {
        status.lastError = String(error?.message || error);
        status.lastSyncAt = Date.now();
      } finally {
        busy = false;
      }
      write();
      try {
        if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.1`);
      } catch {}
      fs.appendFileSync(
        logFile,
        `${new Date().toISOString()} sessions=${status.total ?? '-'} updated=${status.updated ?? '-'} skipped=${status.skipped ?? '-'} failed=${status.failed ?? '-'} ms=${status.tookMs ?? '-'}${status.lastError ? ` error=${status.lastError}` : ''}\n`,
      );
    };
    tick();
    setInterval(tick, intervalSec * 1000);
    try {
      fs.watch(sessionsRoot, { recursive: true }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(tick, 3000);
      });
    } catch (error) {
      status.watchError = String(error?.message || error);
      write();
    }
    console.log(`dsh-cost watch 已启动：每 ${intervalSec}s 增量同步一次，状态见 ${statusFile}`);
    break;
  }
  case 'status': {
    const statusFile = path.join(dataDir, 'watch-status.json');
    if (!fs.existsSync(statusFile)) {
      console.log('watch 未运行（没有 watch-status.json）。手动同步可用：dsh-cost sync');
      break;
    }
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    let alive = false;
    try {
      process.kill(status.pid, 0);
      alive = true;
    } catch (error) {
      alive = error?.code === 'EPERM';
    }
    console.log(`${alive ? '运行中' : '已停止（状态文件是上次运行留下的）'}｜PID：${status.pid}`);
    console.log(`启动：${new Date(status.startedAt).toLocaleString('zh-CN')}`);
    console.log(`最近同步：${status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('zh-CN') : '—'}`);
    console.log(`最近结果：扫描 ${status.total ?? '—'}，更新 ${status.updated ?? '—'}，跳过 ${status.skipped ?? '—'}，失败 ${status.failed ?? '—'}，耗时 ${status.tookMs ?? '—'}ms`);
    if (status.lastError) console.log(`最近错误：${status.lastError}`);
    break;
  }
  case 'scope': {
    const at = opts.values.at ? (opts.values.at === 'now' ? Date.now() : Date.parse(opts.values.at)) : Date.now();
    if (!Number.isFinite(at)) fail('--at 不是合法时间');
    const workspace = opts.values.workspace;
    const sessionArg = opts.values.session;
    if (opts.values.all) {
      fs.rmSync(path.join(dataDir, 'epoch.json'), { force: true });
      syncSessions({ force: true, quiet: false, ignoreEpoch: true });
      console.log('已取消计费起点：之后 report 默认统计全部历史。');
      break;
    }
    if (sessionArg) {
      const current = findCurrentSession(sessionArg);
      if (!current) fail(`找不到会话：${sessionArg}`);
      const resetAt = opts.values.at ? at : current.createdAt;
      fs.writeFileSync(
        path.join(dataDir, 'epoch.json'),
        JSON.stringify({ resetAt, resetAtIso: new Date(resetAt).toISOString(), sessionId: current.id, mode: 'from-session', note: opts.values.note ?? 'scope session' }, null, 2),
      );
      syncSessions({ force: true, quiet: false, onlyId: current.id, sinceMs: 0 });
      console.log(`计费范围：会话 ${current.id}，起点 ${new Date(resetAt).toLocaleString('zh-CN')}`);
      break;
    }
    if (!workspace) fail('用法：scope --workspace <名称> [--at ISO] | scope --session <id> | scope --all');
    fs.writeFileSync(
      path.join(dataDir, 'epoch.json'),
      JSON.stringify({ resetAt: at, resetAtIso: new Date(at).toISOString(), mode: 'workspace-from-time', workspace, note: opts.values.note ?? 'scope workspace' }, null, 2),
    );
    syncSessions({ force: true, quiet: false, sinceMs: at - 10 * 60 * 1000 });
    console.log(`计费范围：工作空间 ${workspace}，起点 ${new Date(at).toLocaleString('zh-CN')}`);
    break;
  }
  case 'turns': {
    const ledger = loadLedger({ all: Boolean(opts.values.all) });
    const view = viewOf(ledger, viewOptions());
    output(renderTurns(ledger, view, { limit: opts.values.limit ? Number(opts.values.limit) : 200 }));
    break;
  }
  case 'dashboard': {
    const ledger = loadLedger({ all: Boolean(opts.values.all) });
    const view = viewOf(ledger, viewOptions());
    const out = path.resolve(opts.values.out ?? path.join(path.dirname(dataDir), 'reports', 'dashboard.html'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderDashboard(ledger, view), 'utf8');
    console.log(`已生成看板：${out}`);
    console.log('用浏览器直接打开；数据更新后重跑本命令即可，不调用模型、不产生 token。');
    break;
  }
  case 'report': {
    const ledger = loadLedger({ all: Boolean(opts.values.all) });
    const view = viewOf(ledger, viewOptions());
    let markdown = renderOverview(ledger, view);
    if (opts.values.sessions) markdown += `\n\n${renderSessions(ledger, view)}`;
    if (view.tasks.size && [...view.tasks.keys()].some((key) => key !== '(未标注)')) markdown += `\n\n${renderTasks(ledger, view)}`;
    if (opts.values.json) {
      process.stdout.write(JSON.stringify({ generatedAt: Date.now(), pricing: ledger.pricing.version, totals: view.totals, days: [...view.days.values()], models: [...view.models.values()] }, null, 2));
    } else output(markdown);
    break;
  }
  case 'sessions': {
    const ledger = loadLedger({ all: Boolean(opts.values.all) });
    output(renderSessions(ledger, viewOf(ledger, viewOptions())));
    break;
  }
  case 'session': {
    const needle = opts.args[0];
    if (!needle) fail('用法：session <会话 id 或前缀>');
    const ledger = loadLedger({ all: Boolean(opts.values.all) });
    const session = ledger.sessions.find((candidate) => candidate.id === needle) || ledger.sessions.find((candidate) => candidate.id.startsWith(needle) || candidate.id.includes(needle));
    if (!session) fail(`找不到会话：${needle}`);
    output(renderSession(ledger, session, { withCalls: opts.values.calls }));
    break;
  }
  case 'tasks': {
    const ledger = loadLedger({ all: Boolean(opts.values.all) });
    output(renderTasks(ledger, viewOf(ledger, viewOptions())));
    break;
  }
  case 'skills': {
    const ledger = loadLedger({ all: Boolean(opts.values.all) });
    output(renderSkills(ledger, viewOf(ledger, viewOptions())));
    break;
  }
  case 'tree': {
    const ledger = loadLedger({ all: Boolean(opts.values.all) });
    output(renderTree(ledger));
    break;
  }
  case 'price': {
    output(renderPrice({ pricing: loadPricing(pricingFile) }));
    break;
  }
  case 'media': {
    const sub = opts.args[0] ?? 'list';
    if (sub === 'add') {
      const pricing = loadPricing(pricingFile);
      if (!opts.values.provider || !opts.values.model) fail('用法：media add --provider minimax-cn --model image-01 --qty 1 [--variant 1k] [--amount 0.2] [--session id] [--turn 3] [--task doc-01]');
      const record = {
        id: randomUUID(),
        ts: Date.now(),
        provider: opts.values.provider,
        model: opts.values.model,
        variant: opts.values.variant,
        quantity: Number(opts.values.qty ?? 1),
        amount: opts.values.amount === undefined ? undefined : Number(opts.values.amount),
        sessionId: opts.values.session,
        turn: opts.values.turn === undefined ? undefined : Number(opts.values.turn),
        task: opts.values.task,
        note: opts.values.note,
      };
      const priced = mediaPrice(pricing, record);
      const cost = priced ? convert(priced.costNative, priced.currency, pricing) : null;
      fs.mkdirSync(dataDir, { recursive: true });
      fs.appendFileSync(path.join(dataDir, 'media.jsonl'), `${JSON.stringify(record)}\n`);
      console.log(`已记录：${record.provider}/${record.model} × ${record.quantity}${record.variant ? ` (${record.variant})` : ''} = ${fmtMoney(cost, { currency: pricing.displayCurrency })}`);
      if (cost === null) console.log('提示：价格表里该模型单价为空，先用 --amount 传实际金额，或在 pricing.json 的 media 段填单价。');
      break;
    }
    const ledger = loadLedger({ all: Boolean(opts.values.all) });
    const media = ledger.media || [];
    if (opts.values.json) {
      process.stdout.write(JSON.stringify(media, null, 2));
      break;
    }
    console.log('| 时间 | Provider/模型 | 规格 | 数量 | 花费 | 任务 | 备注 |');
    console.log('| --- | --- | --- | ---: | ---: | --- | --- |');
    for (const record of media) {
      console.log(`| ${fmtTime(record.ts, ledger.pricing.peakRule.timezone)} | ${record.provider}/${record.model} | ${record.variant || '—'} | ${fmtInt(record.quantity || 1)} | ${fmtMoney(record.cost, { currency: ledger.pricing.displayCurrency })} | ${record.task || '—'} | ${record.note || ''} |`);
    }
    if (!media.length) console.log('\n还没有媒体记录。用 `media add` 添加。');
    break;
  }
  case 'compare': {
    if (!opts.values.task) fail('用法：compare --task <任务标签> [--base A] [--cand B] [--judgments bench/judgments.json]');
    const ledger = loadLedger({ all: Boolean(opts.values.all) });
    const defaultJudgments = path.join(HERE, 'bench', 'judgments.json');
    const judgmentsFile = opts.values.judgments ?? (fs.existsSync(defaultJudgments) ? defaultJudgments : undefined);
    const result = compareTask(ledger, { task: opts.values.task, base: opts.values.base, cand: opts.values.cand, judgmentsFile });
    if (opts.values.json) process.stdout.write(JSON.stringify(result, null, 2));
    else output(renderCompare(result, ledger));
    break;
  }
  case 'help':
  default: {
    process.stdout.write(`dsh-cost — DSH 精准计费 / A-B 验证

用法：
  node dsh-cost.mjs sync [--force] [--since ISO]      增量同步会话日志
  node dsh-cost.mjs reset [--at ISO] [--session ID] [--note TEXT]  清空账本/报表，只统计此后的调用
  node dsh-cost.mjs scope --workspace all-in-fde [--at ISO]         计费范围：本工作空间全部会话
  node dsh-cost.mjs scope --session ID [--at ISO]                   计费范围：单个会话
  node dsh-cost.mjs scope --all                                     取消起点，默认统计全部历史
  node dsh-cost.mjs watch [--interval 60]             后台常驻，按间隔/文件变化增量同步
  node dsh-cost.mjs status                        查看 watch 最近一次同步状态
  node dsh-cost.mjs report [--all] [--days 30] [--workspace all-in-fde] [--sessions] [--out FILE]
  node dsh-cost.mjs turns [--all] [--limit 200] [--workspace all-in-fde]  每条人类指令的明细
  node dsh-cost.mjs dashboard [--all] [--workspace all-in-fde] [--out FILE]  生成本地 HTML 看板
  node dsh-cost.mjs sessions [--all] [--workspace all-in-fde]
  node dsh-cost.mjs session <id前缀> [--all] [--calls]    单会话逐轮账单
  node dsh-cost.mjs tasks [--all]                  任务账本（按 #task 标签）
  node dsh-cost.mjs skills [--all]                 技能成本
  node dsh-cost.mjs tree [--all]                   子代理成本树
  node dsh-cost.mjs price                          当前价格表（多 provider / 多币种 / 按张）
  node dsh-cost.mjs media                          媒体生成记录
  node dsh-cost.mjs media add --provider minimax-cn --model image-01 --qty 1 [--variant 1k] [--amount 0.2] [--session id] [--task doc-01]
  node dsh-cost.mjs compare --task doc-01 [--base A] [--cand B] [--judgments FILE]

全局参数：
  --all                 忽略 epoch 重置起点，读取全部历史会话
  --data DIR            数据目录（默认 ./data）
  --pricing FILE        价格表（默认 ./pricing.json）
  --sessions-root DIR   会话根目录（默认 ~/.dsh/sessions）
  --no-sync             不自动同步
`);
    break;
  }
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
