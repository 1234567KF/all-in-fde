#!/usr/bin/env node
/**
 * E0 环境自检：运行时、git、端口、磁盘、模板。三态退出码：0=PASS，1=FAIL，2=SKIP（环境不具备）。
 *
 * 用法：node scripts/e0-selfcheck.mjs
 * 每项输出一行 PASS/FAIL/SKIP + 一句话；汇总退出码取最差（FAIL 优先于 SKIP 优先于 PASS）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statfsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const checks = [];
const run = (name, fn) => {
  try {
    const r = fn();
    checks.push([name, 'PASS', r]);
  } catch (e) {
    checks.push([name, 'FAIL', e.message || String(e)]);
  }
};
const skip = (name, why) => checks.push([name, 'SKIP', why]);

function version(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 10000 }).trim().split('\n')[0];
  } catch {
    return null;
  }
}

run('node', () => (version('node', ['--version']) ? `node ${version('node', ['--version'])}` : (() => { throw new Error('node 不可用'); })()));
run('bun', () => (version('bun', ['--version']) ? `bun ${version('bun', ['--version'])}` : (() => { throw new Error('bun 不可用'); })()));
run('git', () => (version('git', ['--version']) ? 'git 可用' : (() => { throw new Error('git 不可用'); })()));
if (typeof statfsSync === 'function') {
  run('磁盘', () => {
    const s = statfsSync(process.cwd());
    const freeGB = (s.bavail * s.bsize) / 1024 ** 3;
    if (freeGB < 2) throw new Error(`剩余 ${freeGB.toFixed(1)} GB，低于 2 GB`);
    return `剩余 ${freeGB.toFixed(1)} GB`;
  });
} else {
  skip('磁盘', '本平台不支持 statfs，需人工确认剩余空间');
}
// 脚手架可达：坐标缺失(3)或不可达(2)都记 SKIP，并提示 E3 要记 skipped
try {
  execFileSync(process.execPath, [join(skillRoot, 'scripts', 'starter-info.mjs'), '--check-reach'], {
    stdio: 'ignore',
    timeout: 20000,
  });
  checks.push(['脚手架可达', 'PASS', 'starter-info --check-reach 通过']);
} catch (e) {
  if (e.status === 3) skip('脚手架可达', '未配置坐标：起架前必须先问人，E3 记 skipped');
  else if (e.status === 2) skip('脚手架可达', '仓库不可达：起架将退化手写，E3 记 skipped');
  else throw e;
}

const rank = { PASS: 0, SKIP: 1, FAIL: 2 };
let worst = 0;
for (const [name, mode, msg] of checks) {
  console.log(`${mode.padEnd(4)} ${name}: ${msg}`);
  worst = Math.max(worst, rank[mode]);
}
process.exit(worst === 2 ? 1 : worst === 1 ? 2 : 0);
