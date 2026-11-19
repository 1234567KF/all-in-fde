#!/usr/bin/env node
/**
 * 清理工作区的临时产物目录 `.fde-tmp/`。
 *
 * 用法：
 *   node scripts/clean-tmp.mjs                    只列出内容与体积，不删除
 *   node scripts/clean-tmp.mjs --all              清空（保留 README.md）
 *   node scripts/clean-tmp.mjs --older-than 7     只删 7 天前的条目
 *   node scripts/clean-tmp.mjs --dir <路径>       指定目录（默认 <cwd>/.fde-tmp）
 *
 * 退出码：0 正常；2 目录不存在。
 */
import { readdirSync, statSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const dirOpt = opt('--dir', null);
const root = dirOpt ? resolve(dirOpt) : resolve(process.cwd(), '.fde-tmp');
const all = flag('--all');
const olderThanRaw = opt('--older-than', null);
const olderThan = olderThanRaw === null ? null : Number(olderThanRaw);
const dryRun = !all && olderThan === null;
const KEEP = new Set(['README.md']);

const README = [
  '# .fde-tmp',
  '',
  '- 本目录是 all-in-fde 的临时产物区，可整目录删除。',
  '- 默认保留 7 天：node scripts/clean-tmp.mjs --older-than 7',
  '- 建议把它加进 .gitignore。',
  '',
].join('\n');

if (!existsSync(root)) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'README.md'), README);
  console.log(`已创建 ${root}，并写入 README.md`);
  process.exit(0);
}
if (!existsSync(join(root, 'README.md'))) writeFileSync(join(root, 'README.md'), README);

// 返回体积 + 最新修改时间：目录的「年龄」按里面最新的文件算，
// 否则刚建的空目录永远算新的，旧内容永远清不掉。
function scan(p) {
  const st = statSync(p);
  if (st.isFile()) return { size: st.size, newest: st.mtimeMs };
  let size = 0;
  let newest = 0; // 目录自身 mtime 不算数，只看内容
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const r = scan(join(p, e.name));
    size += r.size;
    newest = Math.max(newest, r.newest);
  }
  return { size, newest: newest || st.mtimeMs };
}

const now = Date.now();
const entries = readdirSync(root, { withFileTypes: true })
  .filter((e) => !KEEP.has(e.name))
  .map((e) => {
    const p = join(root, e.name);
    const r = scan(p);
    return { name: e.name, path: p, size: r.size, mtime: r.newest };
  })
  .sort((a, b) => b.mtime - a.mtime);

const doomed = entries.filter((e) => {
  if (all) return true;
  if (olderThan !== null) return now - e.mtime > olderThan * 86400_000;
  return false;
});

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`目录：${root}`);
console.log(`共 ${entries.length} 项，合计 ${mb(entries.reduce((s, e) => s + e.size, 0))}`);

for (const e of entries) {
  const age = ((now - e.mtime) / 86400_000).toFixed(1);
  const mark = doomed.includes(e) ? '删除' : '保留';
  console.log(`  [${mark}] ${e.name}  ${mb(e.size)}  ${age} 天前`);
}

if (dryRun) {
  console.log('\n这是预览。要清理：--all 清空，或 --older-than <天数> 按时间清。');
  process.exit(0);
}

for (const e of doomed) rmSync(e.path, { recursive: true, force: true });
console.log(`\n已删除 ${doomed.length} 项。`);
