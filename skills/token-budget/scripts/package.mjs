#!/usr/bin/env node
/**
 * package — 生成免克隆安装包：token-budget 技能 + 内置 dsh-cost。
 * 用法：node scripts/package.mjs [--out DIR]
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { basename } from 'node:path';
import { repoRoot, skillRoot } from './lib/common.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const meta = JSON.parse(readFileSync(join(skillRoot, 'META.json'), 'utf8'));
const out = resolve(outIndex >= 0 ? args[outIndex + 1] : join(repoRoot, 'dist', `token-budget-${meta.version}`));

const dshCandidates = [join(repoRoot, 'tools', 'dsh-cost'), join(skillRoot, 'vendor', 'dsh-cost')];
const dshSource = dshCandidates.find((dir) => existsSync(join(dir, 'bin', 'dsh-cost.mjs')));

function copy(items, from, to) {
  for (const item of items) {
    const src = join(from, item);
    if (existsSync(src)) cpSync(src, join(to, item), { recursive: true, force: true });
  }
}

function main() {
  if (!dshSource) throw new Error('找不到 dsh-cost 源：tools/dsh-cost 或 vendor/dsh-cost');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  copy(['SKILL.md', 'META.json', 'PROVENANCE.md', 'CHANGELOG.md', 'LICENSE', 'README.md', 'references', 'scripts'], skillRoot, out);
  const vendor = join(out, 'vendor', 'dsh-cost');
  mkdirSync(vendor, { recursive: true });
  copy(['bin', 'src', 'bench', 'scripts', 'pricing.json', 'README.md'], dshSource, vendor);
  writeFileSync(
    join(out, 'INSTALL.md'),
    [
      '# token-budget 免克隆安装',
      '',
      '这个目录已包含 dsh-cost，不依赖 all-in-fde 仓库。',
      '',
      '```powershell',
      'node scripts/install.mjs',
      '```',
      '',
      '安装后：',
      '',
      '- dsh-cost 在 `~/.dsh/dsh-cost`（可用 `--home` 或 `DSH_COST_HOME` 改）',
      '- 技能挂到工作区 `.dsh/skills/token-budget`；没有工作区时，把本目录复制到 `~/.dsh/skills/token-budget`',
      '- 检查：`node scripts/doctor.mjs`',
      '',
      `版本：${meta.version}`,
      '',
    ].join('\n'),
  );
  console.log(`已生成：${out}`);
  console.log(`dsh-cost 源：${dshSource}`);
}

if (process.argv[1] && basename(process.argv[1]) === 'package.mjs') {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
