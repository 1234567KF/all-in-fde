#!/usr/bin/env node
/**
 * install — 把本技能挂到 .dsh/skills/token-budget，供 DSH 发现。
 * 用法：node scripts/install.mjs [--remove]
 */
import { existsSync, mkdirSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { basename } from 'node:path';
import { repoRoot, skillRoot } from './lib/common.mjs';

const link = join(repoRoot, '.dsh', 'skills', 'token-budget');
const remove = process.argv.includes('--remove');

function main() {
  if (remove) {
    if (existsSync(link)) {
      if (process.platform === 'win32') rmdirSync(link);
      else unlinkSync(link);
      console.log(`已移除 ${link}（技能目录未删除）`);
    } else {
      console.log('没有需要移除的联接');
    }
    return;
  }
  mkdirSync(dirname(link), { recursive: true });
  if (existsSync(link)) {
    console.log(`已存在：${link}`);
    return;
  }
  symlinkSync(skillRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`已创建：${link} -> ${skillRoot}`);
  console.log('重启 DSH 或等技能目录刷新后即可在技能列表看到 token-budget。');
}

if (process.argv[1] && basename(process.argv[1]) === 'install.mjs') {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
