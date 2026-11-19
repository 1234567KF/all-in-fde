#!/usr/bin/env node
/**
 * 首次安装：检查 bun → 在本地脚手架里 bun install → bun run check。
 *
 * 用法：
 *   node scripts/bootstrap.mjs              安装并自检（已装过会跳过 install）
 *   node scripts/bootstrap.mjs --force      强制重装依赖
 *   node scripts/bootstrap.mjs --check-only 只跑自检
 *
 * 退出码：0 就绪；1 自检失败；2 缺前置（bun 未安装）。
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const starter = join(repoRoot, '.dsh', 'starter', 'liquid-glass-starter');
const argv = process.argv.slice(2);
const force = argv.includes('--force');
const checkOnly = argv.includes('--check-only');

// 先找 ~/.bun/bin，再退回 PATH：PATH 里可能是一个受执行策略拦截的 bun.ps1
function resolveBun() {
  const exe = process.platform === 'win32' ? 'bun.exe' : 'bun';
  const candidates = [
    process.env.BUN_INSTALL ? join(process.env.BUN_INSTALL, 'bin', exe) : null,
    join(homedir(), '.bun', 'bin', exe),
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  return 'bun';
}

function sh(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  return r.status ?? 1;
}

if (!existsSync(join(starter, 'package.json'))) {
  console.error(`找不到本地脚手架：${starter}`);
  console.error('仓库应在 .dsh/starter/liquid-glass-starter 带一份完整模板。');
  process.exit(1);
}

const bun = resolveBun();
if (spawnSync(bun, ['--version']).status !== 0) {
  console.error('缺少 bun。先安装，再重跑本脚本：');
  console.error('  Windows: powershell -c "irm bun.sh/install.ps1 | iex"');
  console.error('  macOS/Linux: curl -fsSL https://bun.sh/install | bash');
  console.error('装完请新开一个终端（PATH 需要刷新）。');
  process.exit(2);
}

if (!checkOnly) {
  const needsInstall = force || !existsSync(join(starter, 'node_modules'));
  if (needsInstall) {
    const code = sh(bun, ['install'], starter);
    if (code !== 0) {
      console.error('bun install 失败；先修依赖再继续。');
      process.exit(1);
    }
  } else {
    console.log('依赖已存在，跳过 bun install（要重装加 --force）。');
  }
}

console.log('\n自检：bun run check');
const code = sh(bun, ['run', 'check'], starter);
if (code !== 0) {
  console.error('自检未通过。空模板都不绿，先修，再起项目。');
  process.exit(1);
}
console.log('\n就绪。新建会话选「FDE 主控」开始。');
