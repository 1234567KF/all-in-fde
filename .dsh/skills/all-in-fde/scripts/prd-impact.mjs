#!/usr/bin/env node
/**
 * PRD 变更影响分析：grep 全部 spec/tickets 中的指定章节或编号，
 * 输出「受影响文件 × 段落」清单。封版后改 PRD 必须先跑它。
 *
 * 用法：
 *   node scripts/prd-impact.mjs <章节或编号> [--spec-dir .fde/spec] [--tickets-dir .fde/tickets]
 *
 * 示例：
 *   node scripts/prd-impact.mjs §5.3
 *   node scripts/prd-impact.mjs REQ-C01
 *   node scripts/prd-impact.mjs "§5.3,§6.1"    # 逗号分隔多个
 *
 * 退出码：0 有结果或无匹配；1 参数错误。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const query = argv.find((a) => !a.startsWith('--'));
if (!query) {
  console.error('用法：node scripts/prd-impact.mjs <章节或编号> [--spec-dir DIR] [--tickets-dir DIR]');
  process.exit(1);
}

const specDir = resolve(arg('spec-dir', '.fde/spec'));
const ticketsDir = resolve(arg('tickets-dir', '.fde/tickets'));
const terms = query.split(',').map((t) => t.trim()).filter(Boolean);

if (terms.length === 0) {
  console.error('ERROR 未提供有效的章节或编号');
  process.exit(1);
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile() && e.name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

const files = [...walk(specDir), ...walk(ticketsDir)];
const hits = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (const term of terms) {
    // 转义正则特殊字符
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ file: relative(process.cwd(), file), line: i + 1, term, context: lines[i].trim().slice(0, 120) });
      }
      re.lastIndex = 0;
    }
  }
}

if (hits.length === 0) {
  console.log(`未找到任何文件引用 ${terms.join(', ')}`);
  process.exit(0);
}

// 按文件分组输出
const byFile = new Map();
for (const h of hits) {
  if (!byFile.has(h.file)) byFile.set(h.file, []);
  byFile.get(h.file).push(h);
}

console.log(`\n受影响文件：${byFile.size} 个，共 ${hits.length} 处引用\n`);
for (const [file, items] of byFile) {
  console.log(`📄 ${file}`);
  for (const item of items) {
    console.log(`   L${item.line}: [${item.term}] ${item.context}`);
  }
  console.log('');
}

console.log(`请将此清单作为重封版证据附件，并同步刷新受影响 spec 的版本号与 prd_refs 字段。`);
