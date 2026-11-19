#!/usr/bin/env node
/**
 * 当前工作空间的计费看板。
 * 用法：node scripts/stat.mjs [--workspace 名称]
 * 输出：<当前工作空间>/.dsh/dsh-cost/dashboard.html
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { dshCostDataDir, dshCostHome, requireDshCost } from './lib/dsh-cost.mjs';

function readEpoch() {
  if (!dshCostDataDir) return null;
  const file = join(dshCostDataDir, 'epoch.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const home = requireDshCost();
  const cwd = resolve(process.cwd());
  const args = process.argv.slice(2);
  const flag = args.indexOf('--workspace');
  const workspace = flag >= 0 && args[flag + 1] ? args[flag + 1] : basename(cwd);
  const epoch = readEpoch();
  const scoped = epoch?.mode === 'workspace-from-time' && epoch.workspace === workspace;
  const outDir = join(cwd, '.dsh', 'dsh-cost');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'dashboard.html');
  const cli = join(home, 'bin', 'dsh-cost.mjs');
  const cliArgs = [cli, 'dashboard', '--workspace', workspace, '--out', out, '--data', dshCostDataDir];
  if (!scoped) cliArgs.push('--all');
  const result = spawnSync(process.execPath, cliArgs, { stdio: 'inherit', cwd });
  if (result.status !== 0) {
    console.error(`生成失败：${workspace}`);
    process.exit(result.status || 1);
  }
  console.log(`工作空间：${workspace}`);
  console.log(`看板：${out}`);
  console.log(scoped ? '范围：当前工作空间，按已有计费起点' : '范围：当前工作空间全部历史');
}

if (process.argv[1] && basename(process.argv[1]) === 'stat.mjs') {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
