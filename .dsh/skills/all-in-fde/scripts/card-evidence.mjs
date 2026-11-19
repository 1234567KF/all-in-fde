#!/usr/bin/env node
/**
 * 验收卡 → E6 证据（人点选的唯一合法落盘路径）。
 *
 * 背景：E6-9「验收卡」必须是人点选的结果。此前没有可执行路径，
 * 导致 agent 要么手写 JSON、要么把「AI 跑通了链路」当成「人确认了」。
 * 本脚本把「填好的卡片 Markdown」转成带 signature 的 E6 证据，并强制：
 *   - 卡片必须有 3–5 行可判定项；
 *   - 任一项未点选 → 拒绝封卡（退出 1）；
 *   - 任一项「有问题」→ E6-9 记 FAIL，门级 FAIL；
 *   - 其余 9 项（E6-1..8、E6-10）只能来自脚本跑出来的 E6 证据，不许卡片编造。
 *
 * 卡片格式（.fde/cards/E6-01.md）：
 *
 *   # 验收卡 · E6
 *   卡号：E6-01
 *
 *   | # | 看什么 | 怎么走 | 结果 |
 *   | --- | --- | --- | --- |
 *   | 1 | 主链可演示 | 建批次→发码→导出 CSV | ☑ 通过 |
 *   | 2 | 数据手工验算 | 已发码数 = CSV 行数 | ☑ 通过 |
 *   | 3 | 权限 | viewer 登录看不到账号管理 | ☑ 通过 |
 *
 * 结果列认：☑ / ✅ / [x] = 通过；☐ / [ ] = 未点选；☒ / ❌ / 含「有问题」= 有问题。
 *
 * 用法：
 *   node scripts/card-evidence.mjs \
 *     --card .fde/cards/E6-01.md \
 *     --from .fde/evidence/E6-coldstart.json \
 *     --by "张三" \
 *     [--out .fde/evidence/E6-01.json]
 *
 * --from 是脚本产出的 E6 证据（含 E6-1..E6-8、E6-10）。没有它就先跑冷启动，
 * 不接受「卡片直接编出全部十项」。
 *
 * 退出码：0 写出证据（PASS 或 FAIL 都写）；1 参数/格式/未点选错误。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const cardPath = arg('card');
const fromPath = arg('from');
const by = arg('by');
if (!cardPath || !fromPath || !by) {
  console.error('用法：node scripts/card-evidence.mjs --card <卡片.md> --from <脚本E6.json> --by <点选人> [--out <输出>]');
  process.exit(1);
}

const PASS_MARKS = ['☑', '✅', '✔', '[x]', '[X]'];
const PENDING_MARKS = ['☐', '⬜', '[ ]'];
const FAIL_MARKS = ['☒', '❌', '[!]'];

function readText(p) {
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

const cardAbs = resolve(cardPath);
const fromAbs = resolve(fromPath);
for (const [label, p] of [['卡片', cardAbs], ['脚本证据', fromAbs]]) {
  if (!existsSync(p)) {
    console.error(`ERROR 找不到${label}：${p}`);
    process.exit(1);
  }
}

const cardText = readText(cardAbs);
const cardId = (cardText.match(/卡号[：:]\s*(\S+)/) || [])[1] || 'E6-01';

// ── 解析卡片表格 ──────────────────────────────────────────────────────────────
const rows = [];
for (const line of cardText.split(/\r?\n/)) {
  const t = line.trim();
  if (!t.startsWith('|')) continue;
  const cells = t.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length < 4) continue;
  if (/^[-:\s]+$/.test(cells.join(''))) continue; // 分隔行
  if (cells[0] === '#' || cells[0].includes('看什么')) continue; // 表头
  rows.push({ id: cells[0], title: cells[1], how: cells[2], result: cells[3] });
}

if (rows.length < 3 || rows.length > 5) {
  console.error(`ERROR 卡片应含 3–5 项可判定条目，实际 ${rows.length} 项（每项要指到可打开的东西）`);
  process.exit(1);
}

let pending = 0;
const problems = [];
const checked = [];
for (const r of rows) {
  const res = r.result;
  // 判定顺序：明确失败标记 → 明确通过标记 → 未点选 → 文字「有问题」。
  // 顺序很重要：老卡片把「☐ 通过 ☐ 有问题：____」写在同一格，
  // 先看 ☐ 才能判成「未点选」而不是误判成「有问题」。
  const hasFailMark = FAIL_MARKS.some((m) => res.includes(m));
  const hasPassMark = PASS_MARKS.some((m) => res.includes(m));
  const hasPendingMark = PENDING_MARKS.some((m) => res.includes(m)) || res.trim() === '';
  const isFail = hasFailMark || (!hasPassMark && !hasPendingMark && res.includes('有问题'));
  const isPass = !isFail && hasPassMark;
  if (isFail) {
    problems.push(`${r.id} ${r.title}：${res.replace(/^[^：:]*[：:]/, '').trim() || '有问题'}`);
  } else if (isPass) {
    checked.push(`${r.id} ${r.title}`);
  } else if (hasPendingMark || !isPass) {
    pending += 1;
  } else {
    console.error(`ERROR 第 ${r.id} 行的结果无法判定：「${res}」；用 ☑ 通过 / ☐ 未点选 / ☒ 有问题：…`);
    process.exit(1);
  }
}

if (pending > 0) {
  console.error(`ERROR 还有 ${pending} 项未点选，不能封卡。卡片：${cardPath}`);
  process.exit(1);
}

// ── 读脚本证据，取 E6-1..8、E6-10 ────────────────────────────────────────────
let scripted;
try {
  scripted = JSON.parse(readText(fromAbs));
} catch (e) {
  console.error(`ERROR 脚本证据不是合法 JSON：${e.message}`);
  process.exit(1);
}
if (scripted.gate !== 'E6') {
  console.error(`ERROR --from 必须是 E6 证据，实际 gate=${scripted.gate}`);
  process.exit(1);
}
const REQUIRED = ['E6-1', 'E6-2', 'E6-3', 'E6-4', 'E6-5', 'E6-6', 'E6-7', 'E6-8', 'E6-10'];
const scriptedById = new Map((scripted.items || []).map((i) => [i.id, i]));
const missing = REQUIRED.filter((id) => !scriptedById.has(id));
if (missing.length) {
  console.error(`ERROR 脚本证据缺 ${missing.join(', ')}；先跑冷启动脚本再封卡`);
  process.exit(1);
}

// ── 组 E6 证据 ───────────────────────────────────────────────────────────────
const now = new Date();
const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  .toISOString()
  .slice(0, 19)
  .replace('T', ' ');

const cardPass = problems.length === 0;
const e6_9 = cardPass
  ? {
      id: 'E6-9',
      mode: 'PASS',
      observed: `验收卡 ${cardId}：${checked.length} 项全部通过（${checked.join('；')}）`,
      evidence: [cardPath],
    }
  : {
      id: 'E6-9',
      mode: 'FAIL',
      observed: `验收卡 ${cardId} 有问题：${problems.join('；')}`,
      evidence: [cardPath],
    };

const items = [...REQUIRED.map((id) => scriptedById.get(id)), e6_9].sort(
  (a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1])
);

const outPath = resolve(arg('out', join('.fde', 'evidence', `E6-${cardId}.json`)));
mkdirSync(dirname(outPath), { recursive: true });

let revision = 1;
let supersedes = null;
if (existsSync(outPath)) {
  try {
    const prev = JSON.parse(readText(outPath));
    revision = (prev.revision || 0) + 1;
    supersedes = prev;
  } catch {
    /* 旧文件坏了就不管，直接覆盖 */
  }
}

const evidence = {
  schema: 'fde.evidence/v1',
  gate: 'E6',
  target: cardId,
  revision,
  supersedes: supersedes ? { revision: supersedes.revision, mode: supersedes.mode, at: supersedes.finished_at } : null,
  mode: cardPass ? 'PASS' : 'FAIL',
  by: { kind: 'card', id: 'card-evidence.mjs' },
  started_at: scripted.started_at || localISO,
  finished_at: localISO,
  cmd: `node scripts/card-evidence.mjs --card ${cardPath} --from ${fromPath} --by ${by}`,
  exit: cardPass ? 0 : 1,
  artifact: [cardPath, fromPath],
  summary: cardPass
    ? `验收卡 ${checked.length} 项通过，E6 十项全过`
    : `验收卡 ${problems.length} 项有问题，E6 不通过`,
  items,
  signature: {
    by,
    choice: cardPass ? 'PASS' : 'FAIL',
    at: localISO,
    card: cardPath,
    items: rows.map((r) => ({ id: r.id, title: r.title, result: r.result })),
  },
};

writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');

if (!cardPass) {
  console.error(`验收未通过，已写 FAIL 证据：${outPath}`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`已写验收证据：${outPath}（${checked.length} 项通过，签名 ${by}）`);
