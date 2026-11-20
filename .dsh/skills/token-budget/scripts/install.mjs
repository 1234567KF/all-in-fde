#!/usr/bin/env node
/**
 * install — 安装 token-budget 的 dsh-cost 依赖，并把技能挂到 .dsh/skills/token-budget。
 *
 * 用法：
 *   node scripts/install.mjs [--home DIR] [--dry-run]
 *   node scripts/install.mjs --remove
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { repoRoot, skillRoot } from './lib/common.mjs';

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const remove = has('--remove');
const dryRun = has('--dry-run');
const home = resolve(valueOf('--home') || process.env.DSH_COST_HOME || join(homedir(), '.dsh', 'dsh-cost'));

// 技能是否已经躺在某个 .dsh/skills 下（下载即用的常见形态）。是的话它就是运行时，不需要再建联接。
const skillParent = dirname(skillRoot);
const skillGrand = dirname(skillParent);
const inPlace = basename(skillParent) === 'skills' && basename(skillGrand) === '.dsh';
const link = inPlace ? skillRoot : join(repoRoot, '.dsh', 'skills', 'token-budget');

const SOURCE_CANDIDATES = [join(repoRoot, 'tools', 'dsh-cost'), join(skillRoot, 'vendor', 'dsh-cost')];

function findSource() {
  const found = SOURCE_CANDIDATES.find((dir) => existsSync(join(dir, 'bin', 'dsh-cost.mjs')));
  if (!found) throw new Error('找不到 dsh-cost 源。请确认 skills/token-budget/vendor/dsh-cost 或 tools/dsh-cost 存在。');
  return found;
}

function removeLink() {
  if (inPlace) {
    console.log(`技能就在运行时目录 ${skillRoot}，没有可移除的联接`);
    return;
  }
  if (!existsSync(link)) {
    console.log('没有需要移除的技能联接');
    return;
  }
  if (process.platform === 'win32') rmdirSync(link);
  else unlinkSync(link);
  console.log(`已移除 ${link}（技能目录和 ${home} 未删除）`);
}

function installDshCost(source) {
  if (resolve(source) === resolve(home)) {
    console.log(`dsh-cost 已在目标位置：${home}`);
    return;
  }
  mkdirSync(home, { recursive: true });
  for (const dir of ['bin', 'src', 'bench', 'scripts']) {
    const from = join(source, dir);
    if (existsSync(from)) cpSync(from, join(home, dir), { recursive: true, force: true });
  }
  for (const file of ['pricing.json', 'README.md']) {
    const from = join(source, file);
    if (existsSync(from)) cpSync(from, join(home, file), { force: true });
  }
  if (!existsSync(join(home, 'data')) && existsSync(join(source, 'data'))) {
    cpSync(join(source, 'data'), join(home, 'data'), { recursive: true, force: true });
    console.log('已迁移账本数据');
  }
  if (!existsSync(join(home, 'reports')) && existsSync(join(source, 'reports'))) {
    cpSync(join(source, 'reports'), join(home, 'reports'), { recursive: true, force: true });
    console.log('已迁移报表');
  }
  const meta = JSON.parse(readFileSync(join(skillRoot, 'META.json'), 'utf8'));
  writeFileSync(
    join(home, 'install.json'),
    JSON.stringify({ installedAt: new Date().toISOString(), skillVersion: meta.version, source, skillRoot }, null, 2),
  );
  console.log(`dsh-cost 已安装：${home}`);
}

function linkSkill() {
  if (inPlace) {
    console.log(`技能已在 ${skillRoot} 就位，跳过联接`);
    return;
  }
  if (!existsSync(join(repoRoot, '.dsh'))) {
    console.log('当前不是 DSH 工作区（没有 .dsh），跳过技能联接；把 skills/token-budget 复制到 ~/.dsh/skills 即可。');
    return;
  }
  mkdirSync(dirname(link), { recursive: true });
  if (existsSync(link)) {
    console.log(`技能联接已存在：${link}`);
    return;
  }
  symlinkSync(skillRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`技能已挂载：${link} -> ${skillRoot}`);
}

function main() {
  if (remove) {
    removeLink();
    return;
  }
  const source = findSource();
  if (dryRun) {
    console.log(`dsh-cost 源：${source}`);
    console.log(`安装到：${home}`);
    console.log(inPlace ? `技能位置：${skillRoot}（就位，不需联接）` : `技能联接：${link}`);
    return;
  }
  installDshCost(source);
  linkSkill();
  console.log('完成。重启 DSH 或等技能目录刷新后即可使用 token-budget。');
}

if (process.argv[1] && basename(process.argv[1]) === 'install.mjs') {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
