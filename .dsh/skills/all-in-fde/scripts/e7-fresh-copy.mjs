#!/usr/bin/env node
/**
 * E7 干净目录复跑：把项目复制到新目录（不带依赖、不带数据库、不带 .git），
 * 再按 README 装与起，避免「在自己机器上复跑」的假绿。
 *
 * 用法：
 *   node scripts/e7-fresh-copy.mjs [--src .] [--out .fde-tmp/e7-run] [--run] [--json]
 *
 *   --src   源目录，默认当前目录
 *   --out   目标目录，默认 .fde-tmp/e7-<时间戳>
 *   --run   复制后执行 `<pm> install` 与 `<pm> run check`（默认 bun）
 *   --json  只打印 JSON 结果（便于贴进 E7 证据 artifact）
 *
 * 不复制：.git、node_modules、dist、data、.fde-tmp、.cache、*.db*
 *
 * 退出码：0 复制成功且（如 --run）安装与门禁都过；1 有步骤失败。
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const src = resolve(arg('src', '.'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
// 默认放到项目**同级目录**：fs.cpSync 不允许把目录复制进自身子树，
// 所以副本不能落在 <src>/.fde-tmp 里。
const out = resolve(arg('out', join(dirname(src), `${basename(src)}-e7-${stamp}`)));
const pm = arg('pm', 'bun');
const runIt = flag('run');
const jsonOnly = flag('json');

const isInside = (child, parent) => child === parent || child.startsWith(parent + sep);
if (isInside(out, src)) {
  console.error(
    `ERROR 副本目录不能放在项目内（${out}）；fs.cpSync 不允许复制到自身子树。\n` +
      `      用默认值（项目同级 ${join(dirname(src), basename(src) + '-e7-<时间>')}）或 --out 指定项目外目录。`
  );
  process.exit(1);
}

const SKIP_SEGMENTS = new Set(['.git', 'node_modules', 'dist', '.fde-tmp', '.cache', 'coverage', '.turbo']);
const skipFile = (p) => /\.(db|sqlite|sqlite3)$/i.test(p) || /\.(db|sqlite)-(shm|wal)$/i.test(p);

function shouldSkip(rel) {
  const segs = rel.split('/');
  if (segs.some((s) => SKIP_SEGMENTS.has(s))) return true;
  if (rel === 'apps/api/data' || rel.startsWith('apps/api/data/')) return true;
  if (skipFile(rel)) return true;
  return false;
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, {
    recursive: true,
    dereference: false,
    filter: (p) => {
      const rel = p.slice(from.length + 1).split('\\').join('/');
      if (!rel) return true;
      return !shouldSkip(rel);
    },
  });
}

if (!existsSync(src)) {
  console.error(`ERROR 源目录不存在：${src}`);
  process.exit(1);
}
if (existsSync(out) && statSync(out).isDirectory()) {
  rmSync(out, { recursive: true, force: true }); // 允许重跑同一路径
}
copyDir(src, out);

const result = { src, out, copiedAt: new Date().toISOString(), installExit: null, checkExit: null, pm };

if (runIt) {
  const which = spawnSync(pm, ['--version'], { encoding: 'utf8' });
  if (which.status !== 0) {
    console.error(`ERROR 找不到包管理器 ${pm}；用 --pm 指定，或先装 bun`);
    process.exit(1);
  }
  const install = spawnSync(pm, ['install'], { cwd: out, encoding: 'utf8', stdio: 'inherit' });
  result.installExit = install.status ?? 1;
  if (result.installExit === 0) {
    const check = spawnSync(pm, ['run', 'check'], { cwd: out, encoding: 'utf8', stdio: 'inherit' });
    result.checkExit = check.status ?? 1;
  }
}

if (jsonOnly) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`已复制到：${out}`);
  if (runIt) {
    console.log(`install 退出：${result.installExit}；check 退出：${result.checkExit}`);
  } else {
    console.log('下一步（在副本目录里执行，别回原目录）：');
    console.log(`  cd "${out}"`);
    console.log(`  ${pm} install && ${pm} run check`);
    console.log('  然后按 README 起服务、冒烟、验证回滚；把副本路径与退出码写进 E7-1/E7-2。');
  }
}

// 任何非 0 退出都算失败：只认 `!== 1` 会把 127/2 之类的失败当成成功
const ok = [result.installExit, result.checkExit].every((c) => c === null || c === 0);
process.exit(ok ? 0 : 1);
