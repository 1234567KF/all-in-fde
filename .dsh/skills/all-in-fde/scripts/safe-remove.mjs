#!/usr/bin/env node
/**
 * 删除前的断言：确认目标目录「可以安全删除」，再删。
 *
 * 背景：一次合并事故里，agent 为了删旧目录做了「改名 + 换位」，范围包含了
 * 当前 shell 所在的工作区树，误删了工作区根文件，靠 git 对象库才恢复。
 * 事后结论：`rm -rf` 之前必须能回答两个问题——
 *   1. 目标树里每个文件是否都已在 git 里？没入库的文件删了就真没了。
 *   2. 目标目录是不是谁的工作目录（含当前进程）？
 *
 * 用法：
 *   node scripts/safe-remove.mjs <目录>           只体检，不删
 *   node scripts/safe-remove.mjs <目录> --yes     体检通过后真删
 *   node scripts/safe-remove.mjs <目录> --yes --force  体检不通过也删（自担风险，打印被忽略的项）
 *
 * 退出码：0 可删/已删；1 拒绝删除（列出原因）；2 参数错误。
 */
import { existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, isAbsolute } from 'node:path';

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith('--'));
const yes = argv.includes('--yes');
const force = argv.includes('--force');

if (!target) {
  console.error('用法：node scripts/safe-remove.mjs <目录> [--yes] [--force]');
  process.exit(2);
}
const abs = resolve(target);
if (!existsSync(abs)) {
  console.error(`目录不存在：${abs}`);
  process.exit(2);
}
if (!statSync(abs).isDirectory()) {
  console.error(`不是目录：${abs}（单个文件的删除请人工确认）`);
  process.exit(2);
}

const problems = [];
const notes = [];

// 1. 不能是当前目录或它的祖先
const cwd = process.cwd();
const inside = (child, parent) => child === parent || child.startsWith(parent + '/') || child.startsWith(parent + '\\');
if (inside(cwd, abs)) {
  problems.push(`目标是当前工作目录或其祖先（cwd=${cwd}）；先 cd 到别处再删`);
}

// 2. 不能在别的进程的工作目录里（尽力而为：Windows 下无法枚举别的进程 cwd，只提示）
notes.push('无法枚举其他进程的工作目录；删前请确认没有服务/编辑器停在目标树里');

// 3. 未入库文件
function listFiles(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (git.status !== 0) {
  problems.push('没有 git：无法证明文件已入库；确需删除请用 --force，并先自行备份');
} else {
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', abs], {
    encoding: 'utf8',
    cwd: dirname(abs),
  });
  const list = (untracked.stdout || '').trim().split('\n').filter(Boolean);
  if (untracked.status !== 0) {
    problems.push(`git ls-files 失败：${(untracked.stderr || '').trim()}`);
  } else if (list.length) {
    problems.push(`${list.length} 个文件未入库，删了就找不回：\n  ${list.slice(0, 10).join('\n  ')}${list.length > 10 ? '\n  …' : ''}`);
  }
  const dirty = spawnSync('git', ['status', '--porcelain', '--', abs], { encoding: 'utf8', cwd: dirname(abs) });
  const changes = (dirty.stdout || '').trim().split('\n').filter(Boolean);
  if (changes.length) notes.push(`${changes.length} 个文件有未提交改动（已入库，可恢复，但会被一并删掉）`);
}

const files = listFiles(abs);
console.log(`目标：${abs}`);
console.log(`文件数：${files.length}`);
for (const n of notes) console.log(`NOTE  ${n}`);

if (problems.length) {
  for (const p of problems) console.error(`BLOCK ${p}`);
  if (!force) {
    console.error('\n拒绝删除。处理办法：先把文件提交进 git，或换一个不覆盖当前工作目录的路径；确需强删加 --force。');
    process.exit(1);
  }
  console.error('\n--force：忽略上述阻断，继续删除。');
}

if (!yes) {
  console.log('\n体检结束（未删除）。确认无误后加 --yes 执行。');
  process.exit(problems.length ? 1 : 0);
}

rmSync(abs, { recursive: true, force: true });
console.log(`已删除：${abs}`);
