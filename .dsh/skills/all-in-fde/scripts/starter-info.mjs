#!/usr/bin/env node
/**
 * 解析并校验脚手架坐标。起架第一步跑它，不许跳过。
 *
 * 用法：
 *   node scripts/starter-info.mjs                 打印生效的坐标与来源
 *   node scripts/starter-info.mjs --check-reach   顺带探测仓库可达性（失败即退出码 2）
 *   node scripts/starter-info.mjs --json          机器可读输出（给 E3 证据用）
 *
 * 查找顺序（先命中先用）：
 *   1. <工作区>/.fde/starter.json       项目级，随项目走
 *   2. <DSH_HOME>/all-in-fde/starter.json 本机级，团队默认
 *   3. 环境变量 FDE_STARTER_JSON         指向任意 JSON 文件
 *
 * 都没有时退出码 3，并打印「必须先问人要坐标」——这是刻意的：没有坐标时
 * 唯一正确的动作是停下来问，而不是按默认栈自建。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);

function findScaffolder(starterDir) {
  const skillsDir = join(starterDir, 'skills');
  if (!existsSync(skillsDir)) return null;
  for (const e of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(skillsDir, e.name, 'scripts', 'scaffold.ts');
    if (existsSync(p)) return p;
  }
  return null;
}

const workspace = process.cwd();
const candidates = [
  { source: 'workspace', path: join(workspace, '.fde', 'starter.json') },
  { source: 'machine', path: join(homedir(), '.dsh', 'all-in-fde', 'starter.json') },
  { source: 'env', path: process.env.FDE_STARTER_JSON || '' },
].filter((c) => c.path);

let found = null;
for (const c of candidates) {
  if (existsSync(c.path)) {
    try {
      found = { ...c, data: JSON.parse(readFileSync(c.path, 'utf8').replace(/^\uFEFF/, '')) };
      break;
    } catch (e) {
      console.error(`配置解析失败：${c.path}\n${e.message}`);
      process.exit(1);
    }
  }
}

// 兜底：技能自带的脚手架副本（.dsh/starter/liquid-glass-starter），开箱即用
if (!found) {
  const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const bundled = resolve(skillRoot, '..', '..', 'starter', 'liquid-glass-starter');
  if (existsSync(join(bundled, 'package.json'))) {
    const scanner = findScaffolder(bundled);
    found = {
      source: 'bundled',
      path: bundled,
      data: {
        name: 'liquid-glass-starter（仓库自带）',
        localPath: bundled,
        ref: 'bundled',
        installCmd: 'bun install',
        scaffoldCmd: scanner
          ? `bun run ${scanner} --name <name> --target <dir> --type monorepo --db drizzle`
          : undefined,
        moduleCmd: 'bun run gen:module --name <module>',
        checkCmd: 'bun run check',
      },
    };
  }
}

if (!found) {
  console.error('未找到脚手架坐标。');
  console.error('必须先问人：用哪个脚手架、仓库地址、分支、生成命令、模块命令、门禁命令。');
  console.error('拿到后写进 <工作区>/.fde/starter.json（项目级）或 ~/.dsh/all-in-fde/starter.json（本机级）。');
  console.error('没有坐标时不许按默认栈自建；确需自建，就在 E3 证据里写 skipped 与原因。');
  process.exit(3);
}

const s = found.data;
if (!s.localPath && !s.repo) {
  console.error(`配置缺字段：localPath 或 repo 二选一（${found.path}）`);
  process.exit(1);
}
const required = ['name'];
const missing = required.filter((k) => !s[k]);
if (missing.length) {
  console.error(`配置缺字段：${missing.join(', ')}（${found.path}）`);
  process.exit(1);
}

if (flag('--json')) {
  console.log(JSON.stringify({ ...s, _source: found.source, _path: found.path }, null, 2));
} else {
  console.log(`脚手架：${s.name}`);
  if (s.localPath) console.log(`本机副本：${s.localPath}`);
  if (s.repo) console.log(`仓库：${s.repo}  分支：${s.ref}`);
  console.log(`来源：${found.source}（${found.path}）`);
  if (s.fetch?.git) console.log(`取法一：${s.fetch.git}`);
  if (s.fetch?.archive) console.log(`取法二：${s.fetch.archive}`);
  if (s.scaffoldCmd) console.log(`起架：${s.scaffoldCmd}`);
  if (s.webAppsCmd) console.log(`多端：${s.webAppsCmd}`);
  if (s.moduleCmd) console.log(`模块：${s.moduleCmd}`);
  if (s.checkCmd) console.log(`门禁：${s.checkCmd}`);
}

if (flag('--check-reach')) {
  if (s.localPath) {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    if (!existsSync(join(s.localPath, 'package.json'))) {
      console.error(`本机副本不可用：${s.localPath}`);
      process.exit(2);
    }
    console.log(`本机副本就绪：${s.localPath}（离线可用）`);
    process.exit(0);
  }
  const url = s.fetch?.archive || s.repo;
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`可达：${url}`);
  } catch (e) {
    console.error(`不可达：${url}（${e.message}）`);
    console.error('起架将退化为手写：请在 E3 证据记 skipped 与原因，并在 brief 写明改用哪套栈。');
    process.exit(2);
  }
}
