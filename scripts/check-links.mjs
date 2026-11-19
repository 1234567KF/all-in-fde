#!/usr/bin/env node
/**
 * 检查 Markdown 里的相对链接是否可达。外链与锚点不检查。
 *
 * 用法：node scripts/check-links.mjs [目录或文件...]
 * 默认范围：docs/ 与 .dsh/skills/all-in-fde；第三方技能见 --all
 * 退出码：0 全通；1 有死链。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targets = argv.length ? argv : [join(repoRoot, 'docs'), join(repoRoot, '.dsh', 'skills', 'all-in-fde')];
const SKIP = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__']);

function walk(target, acc) {
  if (!existsSync(target)) return acc;
  const st = statSync(target);
  if (st.isFile()) {
    if (extname(target).toLowerCase() === '.md') acc.push(target);
    return acc;
  }
  for (const e of readdirSync(target, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = join(target, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(full, acc);
    } else if (extname(e.name).toLowerCase() === '.md') {
      acc.push(full);
    }
  }
  return acc;
}

const files = [];
for (const t of targets) walk(resolve(t), files);

const dead = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const re = /\[[^\]]*\]\((<[^>]+>|[^)\s]+)\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let href = m[1].replace(/^<|>$/g, '').trim();
    if (!href || /^(https?:|mailto:|#)/i.test(href)) continue;
    href = href.split('#')[0];
    if (!href) continue;
    const target = resolve(dirname(file), href);
    if (!existsSync(target)) {
      const line = text.slice(0, m.index).split('\n').length;
      dead.push({ file: relative(repoRoot, file).split(sep).join('/'), line, href });
    }
  }
}

if (dead.length === 0) {
  console.log(`通过：${files.length} 份 Markdown，相对链接全部可达`);
  process.exit(0);
}
for (const d of dead) console.error(`ERROR ${d.file}:${d.line}  ->  ${d.href}`);
console.error(`\n失败：${dead.length} 条死链`);
process.exit(1);
