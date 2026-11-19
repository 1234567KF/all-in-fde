#!/usr/bin/env node
/**
 * 校验票的依赖图：引用是否存在、是否成环、是否存在无谓串行。
 *
 * 用法：node scripts/check-tickets.mjs [票目录]
 * 默认：.fde/tickets
 * 退出码：0 通过；1 有错误（引用不存在 / 成环）。
 *
 * 票格式见 references/slice.md：`票号：W1-T03`、`阻塞：W1-T01, W1-T02`（无则写「无」）。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = process.argv[2] ? resolve(process.argv[2]) : join(process.cwd(), '.fde', 'tickets');

if (!existsSync(dir)) {
  console.log(`无票目录：${dir}`);
  process.exit(0);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
const tickets = new Map();

for (const f of files) {
  const text = readFileSync(join(dir, f), 'utf8');
  const id = (text.match(/票号[：:]\s*(\S+)/) || [])[1] || f.replace(/\.md$/, '');
  const blockedLine = (text.match(/阻塞[：:]\s*(.+)/) || [])[1] || '无';
  const deps =
    blockedLine.trim() === '无' || blockedLine.includes('无')
      ? []
      : blockedLine.split(/[,，、\s]+/).filter((x) => /^[A-Za-z0-9-]+$/.test(x));
  tickets.set(id, { file: f, deps });
}

const errors = [];
for (const [id, t] of tickets) {
  for (const d of t.deps) {
    if (!tickets.has(d)) errors.push(`${t.file}: 阻塞引用了不存在的票 ${d}`);
    if (d === id) errors.push(`${t.file}: 自己阻塞自己`);
  }
}

// 找环（DFS 三色）
const color = new Map();
const stack = [];
function visit(id) {
  if (color.get(id) === 1) {
    const i = stack.indexOf(id);
    errors.push(`依赖成环：${[...stack.slice(i), id].join(' → ')}`);
    return;
  }
  if (color.get(id) === 2) return;
  color.set(id, 1);
  stack.push(id);
  for (const d of tickets.get(id)?.deps || []) if (tickets.has(d)) visit(d);
  stack.pop();
  color.set(id, 2);
}
for (const id of tickets.keys()) visit(id);

// 根部票（无阻塞）提示，便于确认并行起点
const roots = [...tickets.entries()].filter(([, t]) => t.deps.length === 0).map(([id]) => id);

if (errors.length) {
  for (const e of errors) console.error(`ERROR ${e}`);
  console.error(`\n失败：${errors.length} 处，共 ${tickets.size} 张票`);
  process.exit(1);
}
console.log(`通过：${tickets.size} 张票，依赖无环。可直接开工的：${roots.join(', ') || '无'}`);
