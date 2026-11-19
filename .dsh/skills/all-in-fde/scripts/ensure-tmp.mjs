#!/usr/bin/env node
/**
 * 在当前工作区准备临时产物目录 `.fde-tmp/`，并确保它不被 git 跟踪。
 *
 * 用法：
 *   node scripts/ensure-tmp.mjs               在当前工作区准备（默认 cwd）
 *   node scripts/ensure-tmp.mjs --dir <路径>   指定工作区
 *
 * 做的事（全部幂等，重复跑不重复写）：
 *   1. 建 `<工作区>/.fde-tmp/` 与其中的 README.md；
 *   2. 向上找最近的 `.git`，把相对路径写进 `<git-dir>/info/exclude`；
 *   3. 不动 `.gitignore`——那是对方仓库的版本控制内容，改了会进提交。
 *
 * 支持普通仓库、`.git` 为文件的 worktree/submodule（看 gitdir / commondir）。
 * 非 git 目录只建目录，跳过排除。
 *
 * 退出码：0 就绪；1 出错。
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep, isAbsolute } from 'node:path';

const argv = process.argv.slice(2);
const i = argv.indexOf('--dir');
const workspace = resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd());
const tmpDir = join(workspace, '.fde-tmp');

const README = `# .fde-tmp

- all-in-fde 的临时产物区：截图、trace、日志、草稿、临时导出。
- 可整目录删除：node scripts/clean-tmp.mjs --older-than 7
- 已被本机 git 本地排除（.git/info/exclude），不会进版本库。
`;

function findRepoRoot(start) {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveGitDir(repoRoot) {
  const dotGit = join(repoRoot, '.git');
  const st = statSync(dotGit);
  if (st.isDirectory()) return dotGit;
  const text = readFileSync(dotGit, 'utf8');
  const m = text.match(/^gitdir:\s*(.+)$/m);
  if (!m) return null;
  let dir = m[1].trim();
  if (!isAbsolute(dir)) dir = resolve(repoRoot, dir);
  const common = join(dir, 'commondir');
  if (existsSync(common)) {
    const rel = readFileSync(common, 'utf8').trim();
    dir = isAbsolute(rel) ? rel : resolve(dir, rel);
  }
  return dir;
}

mkdirSync(tmpDir, { recursive: true });
if (!existsSync(join(tmpDir, 'README.md'))) writeFileSync(join(tmpDir, 'README.md'), README);
console.log(`临时目录就绪：${tmpDir}`);

const repoRoot = findRepoRoot(workspace);
if (!repoRoot) {
  console.log('不是 git 仓库，跳过排除（临时目录依然可用）。');
  process.exit(0);
}

const gitDir = resolveGitDir(repoRoot);
if (!gitDir) {
  console.log('未能解析 git 目录，跳过排除。');
  process.exit(0);
}

const pattern = relative(repoRoot, tmpDir).split(sep).join('/') + '/';
const infoDir = join(gitDir, 'info');
const excludePath = join(infoDir, 'exclude');
mkdirSync(infoDir, { recursive: true });

const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
const existing = current.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
if (existing.includes(pattern)) {
  console.log(`已排除：${pattern}（在 ${excludePath}）`);
  process.exit(0);
}

const block = `${current && !current.endsWith('\n') ? '\n' : ''}\n# all-in-fde 临时产物（本地排除，不进版本库）\n${pattern}\n`;
writeFileSync(excludePath, current + block);
console.log(`已写入本地排除：${pattern} → ${excludePath}`);
