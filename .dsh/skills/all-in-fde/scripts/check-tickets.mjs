#!/usr/bin/env node
/**
 * 校验票的依赖图与票面纪律。
 *
 * 用法：node scripts/check-tickets.mjs [票目录]
 * 默认：.fde/tickets
 * 退出码：0 通过；1 有错误（引用不存在 / 成环 / 票面违规）。
 *
 * 票格式见 references/slice.md：`票号：W1-T03`、`阻塞：W1-T01, W1-T02`（无则写「无」）。
 *
 * v0.4.0 起额外校验票面纪律（来自一次真实返工）：
 *   - 三阶段只能是 ☑/☐，禁止 ◐/◑/~ 之类第三态（语义会变糊）；
 *   - 勾了「① AI 首轮」就必须有「交付回执」，否则等于没交；
 *   - 挂 REQ 超过 3 个不同前缀视为「批次票」，提示拆分（批次数 ≥3 模块演示不了）。
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
  const stageLine = (text.match(/三阶段[：:]\s*(.+)/) || [])[1] || '';
  const receipt = (text.match(/交付回执[：:]\s*([\s\S]*)$/) || [])[1] || '';
  const reqLine = (text.match(/挂 REQ[：:]\s*(.+)/) || [])[1] || '';
  tickets.set(id, { file: f, deps, stageLine, receipt: receipt.trim(), reqLine });
}

const errors = [];
const warnings = [];

for (const [id, t] of tickets) {
  for (const d of t.deps) {
    if (!tickets.has(d)) errors.push(`${t.file}: 阻塞引用了不存在的票 ${d}`);
    if (d === id) errors.push(`${t.file}: 自己阻塞自己`);
  }

  // 三阶段：禁止第三态
  if (t.stageLine) {
    const badMark = t.stageLine.match(/[◐◑◒◓⏳~]/);
    if (badMark) {
      errors.push(
        `${t.file}: 三阶段出现第三态「${badMark[0]}」；只能 ☑/☐，进度写在「交付回执」里`
      );
    }
    if (!/[☑☐]/.test(t.stageLine)) {
      errors.push(`${t.file}: 三阶段行没有 ☑/☐ 标记`);
    }
  } else {
    warnings.push(`${t.file}: 没有「三阶段」行`);
  }

  // 勾了 ① 就必须有回执
  const aiChecked = /①[^☐]*☑/.test(t.stageLine);
  if (aiChecked && !t.receipt) {
    errors.push(`${t.file}: 已勾「① AI 首轮」但「交付回执」为空`);
  }

  // 批次票宽度
  if (t.reqLine) {
    const prefixes = new Set(
      (t.reqLine.match(/REQ-[A-Z]+/g) || []).map((r) => r.replace(/^REQ-/, ''))
    );
    if (prefixes.size > 3) {
      warnings.push(
        `${t.file}: 挂了 ${prefixes.size} 个 REQ 前缀（${[...prefixes].join('/')}），像批次票；按「一条可演示路径」拆小`
      );
    }
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

const roots = [...tickets.entries()].filter(([, t]) => t.deps.length === 0).map(([id]) => id);

for (const w of warnings) console.warn(`WARN  ${w}`);

if (errors.length) {
  for (const e of errors) console.error(`ERROR ${e}`);
  console.error(`\n失败：${errors.length} 处，共 ${tickets.size} 张票`);
  process.exit(1);
}
console.log(
  `通过：${tickets.size} 张票，依赖无环，票面纪律合规。可直接开工的：${roots.join(', ') || '无'}`
);
