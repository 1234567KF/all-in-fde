#!/usr/bin/env node
/**
 * 清理临时产物。
 *
 * 用法：
 *   node scripts/clean-tmp.mjs                  只列出内容与体积，不删除
 *   node scripts/clean-tmp.mjs --all            清空 .tmp/
 *   node scripts/clean-tmp.mjs --older-than 7   只清 7 天前的内容
 *   node scripts/clean-tmp.mjs --legacy         连仓库根的旧式 .tmp-* 目录一起处理
 *   node scripts/clean-tmp.mjs --all --legacy   全部清掉
 */
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmpRoot = join(repoRoot, '.tmp');
const KEEP = new Set(['README.md']);

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  const v = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : null;
};

const all = flag('--all');
const withLegacy = flag('--legacy');
const olderThan = opt('--older-than');
const dryRun = !all && olderThan === null;

function sizeOf(path) {
  const st = statSync(path);
  if (st.isFile()) return st.size;
  let total = 0;
  const rec = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) rec(p);
      else if (entry.isFile()) total += statSync(p).size;
    }
  };
  rec(path);
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const roots = [tmpRoot];
if (withLegacy) {
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('.tmp-')) roots.push(join(repoRoot, entry.name));
  }
}

const cutoff = olderThan === null ? null : Date.now() - olderThan * 24 * 60 * 60 * 1000;
let freed = 0;
let removed = 0;

for (const root of roots) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    const rel = path.replace(repoRoot + '\\', '').replace(repoRoot + '/', '');
    if (KEEP.has(entry.name)) continue;

    const st = statSync(path);
    const bytes = sizeOf(path);
    const ageDays = ((Date.now() - st.mtimeMs) / 86400000).toFixed(1);
    const expired = cutoff === null || st.mtimeMs < cutoff;

    if (dryRun) {
      console.log(`  ${rel.padEnd(46)} ${mb(bytes).padStart(9)}  ${ageDays} 天`);
      continue;
    }
    if (!expired) {
      console.log(`  保留 ${rel}（${ageDays} 天，未到期）`);
      continue;
    }
    rmSync(path, { recursive: true, force: true });
    freed += bytes;
    removed += 1;
    console.log(`  删除 ${rel}（${mb(bytes)}）`);
  }
}

if (dryRun) {
  const total = roots.reduce((sum, root) => {
    try {
      return sum + readdirSync(root).filter((n) => !KEEP.has(n)).reduce((s, n) => s + sizeOf(join(root, n)), 0);
    } catch {
      return sum;
    }
  }, 0);
  console.log(`\n合计 ${mb(total)}。加 --all 清空，或 --older-than <天> 只清旧的。`);
} else {
  console.log(`\n删除 ${removed} 项，释放 ${mb(freed)}。`);
}
