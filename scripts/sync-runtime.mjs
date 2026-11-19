#!/usr/bin/env node
/**
 * 在仓库副本 skills/ 与运行时目录 .dsh/skills/ 之间做单向同步。
 *
 * 默认方向：仓库 -> 运行时（部署）。加 --pull 反向（收回运行时改动）。
 *
 * 用法：
 *   node scripts/sync-runtime.mjs                 部署到项目级 .dsh/skills
 *   node scripts/sync-runtime.mjs --global        部署到全局 ~/.dsh/skills
 *   node scripts/sync-runtime.mjs --check         只检查差异，有差异退出码 1
 *   node scripts/sync-runtime.mjs --dry-run       只报告要动哪些文件
 *   node scripts/sync-runtime.mjs --pull          运行时 -> 仓库
 *   node scripts/sync-runtime.mjs --prune         删除仅存在于运行时的多余文件
 *
 * 永远跳过：node_modules、dist、output、uploads、screens、shots、缓存目录。
 */
import {
  readdirSync,
  readFileSync,
  statSync,
  lstatSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join, dirname, resolve, relative, sep, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoSkills = join(repoRoot, 'skills');

const SKIP = new Set([
  'node_modules', '.git', 'dist', 'output', 'uploads', 'screens', 'shots',
  '.cache', '__pycache__', '.venv', 'venv', 'tmp',
]);

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};

const check = flag('--check');
const dryRun = flag('--dry-run') || check;
const pull = flag('--pull');
const prune = flag('--prune');
const quiet = flag('--quiet');

const targetOpt = opt('--target');
const targetRoot = targetOpt
  ? (isAbsolute(targetOpt) ? targetOpt : resolve(repoRoot, targetOpt))
  : flag('--global')
    ? join(homedir(), '.dsh', 'skills')
    : join(repoRoot, '.dsh', 'skills');

const srcRoot = pull ? targetRoot : repoSkills;
const dstRoot = pull ? repoSkills : targetRoot;

if (!existsSync(srcRoot)) {
  console.error(`源目录不存在：${srcRoot}`);
  process.exit(2);
}

function walk(root) {
  const files = [];
  const links = [];
  const rec = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        // 目录联接 / 符号链接一律不跟进，避免写到链接目标所在的另一个仓库
        const rel = relative(root, join(dir, entry.name)).split(sep).join('/');
        links.push(rel);
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        rec(join(dir, entry.name));
      } else if (entry.isFile()) {
        files.push(relative(root, join(dir, entry.name)).split(sep).join('/'));
      }
    }
  };
  rec(root);
  return { files: files.sort(), links };
}

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const skills = readdirSync(srcRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !SKIP.has(e.name))
  .map((e) => e.name)
  .sort();

if (skills.length === 0) {
  console.error(`源目录下没有技能：${srcRoot}`);
  process.exit(2);
}

const totals = { copied: 0, unchanged: 0, extras: 0, pruned: 0, links: 0 };
const rows = [];

function syncOne(labelName, srcDir, dstDir) {
  const dstStat = existsSync(dstDir) ? lstatSync(dstDir) : null;
  if (dstStat && dstStat.isSymbolicLink()) {
    return { skill: labelName, skipped: true, reason: '运行时目录是链接（联接 / 符号链接），不写入', copied: 0, unchanged: 0, extras: 0, actions: [] };
  }

  const { files: srcFiles, links } = walk(srcDir);
  const srcSet = new Set(srcFiles);

  let copied = 0;
  let unchanged = 0;
  const actions = [];

  for (const rel of srcFiles) {
    const s = join(srcDir, rel);
    const d = join(dstDir, rel);
    let needsCopy = false;
    let reason = '';

    if (!existsSync(d)) {
      needsCopy = true;
      reason = 'new';
    } else {
      const ss = statSync(s);
      const ds = statSync(d);
      if (ss.size !== ds.size) {
        needsCopy = true;
        reason = 'size';
      } else if (check || Math.abs(ss.mtimeMs - ds.mtimeMs) > 2000) {
        if (sha(s) !== sha(d)) {
          needsCopy = true;
          reason = 'content';
        }
      }
    }

    if (needsCopy) {
      copied += 1;
      actions.push(`${reason === 'new' ? '+' : '~'} ${rel}`);
      if (!dryRun) {
        mkdirSync(dirname(d), { recursive: true });
        copyFileSync(s, d);
      }
    } else {
      unchanged += 1;
    }
  }

  const { files: dstFiles } = existsSync(dstDir) ? walk(dstDir) : { files: [] };
  const extras = dstFiles.filter((rel) => !srcSet.has(rel));

  if (prune && !dryRun) {
    for (const rel of extras) {
      rmSync(join(dstDir, rel), { force: true });
    }
  }

  totals.copied += copied;
  totals.unchanged += unchanged;
  totals.extras += extras.length;
  totals.links += links.length;
  totals.pruned += prune && !dryRun ? extras.length : 0;

  return { skill: labelName, copied, unchanged, extras: extras.length, actions, links };
}

for (const skill of skills) {
  rows.push(syncOne(skill, join(srcRoot, skill), join(dstRoot, skill)));
}

// 第二个同步面：bundles/（插件 bundle，如子代理预设）与 skills/ 同进同出。
const repoBundles = join(repoRoot, 'bundles');
const runtimeBundles = join(dirname(dstRoot), 'bundles');
const bundlesSrc = pull ? runtimeBundles : repoBundles;
const bundlesDst = pull ? repoBundles : runtimeBundles;

if (existsSync(bundlesSrc)) {
  const names = readdirSync(bundlesSrc, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP.has(e.name))
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    rows.push(syncOne(`bundles/${name}`, join(bundlesSrc, name), join(bundlesDst, name)));
  }
}

const label = pull ? '运行时 -> 仓库' : '仓库 -> 运行时';
const mode = check ? '检查' : dryRun ? '演练' : '同步';

if (!quiet) {
  console.log(`方向：${label}`);
  console.log(`源：${srcRoot}`);
  console.log(`目标：${dstRoot}`);
  console.log('');
  for (const row of rows) {
    if (row.skipped) {
      console.log(`  ${row.skill.padEnd(18)} 跳过：${row.reason}`);
      continue;
    }
    const extras = row.extras > 0 ? `，仅运行时 ${row.extras}` : '';
    console.log(`  ${row.skill.padEnd(18)} ${String(row.copied).padStart(4)} 变更 / ${row.unchanged} 未变${extras}`);
    if (row.links && row.links.length > 0) {
      console.log(`      ! 跳过链接：${row.links.join(', ')}`);
    }
    if (row.actions.length > 0 && row.actions.length <= 20) {
      for (const a of row.actions) console.log(`      ${a}`);
    } else if (row.actions.length > 20) {
      for (const a of row.actions.slice(0, 20)) console.log(`      ${a}`);
      console.log(`      … 另有 ${row.actions.length - 20} 个`);
    }
  }
  console.log('');
  console.log(`${mode}完成：${totals.copied} 个文件${dryRun ? '待处理' : '已写入'}，${totals.unchanged} 个未变${prune ? `，已清理 ${totals.pruned} 个多余文件` : ''}`);
}

if (check && totals.copied > 0) {
  console.error(`\n${label} 有 ${totals.copied} 个文件不一致，运行 node scripts/sync-runtime.mjs 同步`);
  process.exit(1);
}
