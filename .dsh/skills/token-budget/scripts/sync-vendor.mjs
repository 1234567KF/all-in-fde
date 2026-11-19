#!/usr/bin/env node
/** 把 tools/dsh-cost 的代码同步到技能自带 vendor/dsh-cost（不含 data/reports）。 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { basename } from 'node:path';
import { repoRoot, skillRoot } from './lib/common.mjs';

const source = resolve(repoRoot, 'tools', 'dsh-cost');
const dest = join(skillRoot, 'vendor', 'dsh-cost');

function main() {
  if (!existsSync(join(source, 'bin', 'dsh-cost.mjs'))) throw new Error(`找不到 dsh-cost 源：${source}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const item of ['bin', 'src', 'bench', 'scripts', 'pricing.json', 'README.md']) {
    const from = join(source, item);
    if (existsSync(from)) cpSync(from, join(dest, item), { recursive: true, force: true });
  }
  writeFileSync(
    join(dest, 'SOURCE.json'),
    JSON.stringify({ syncedAt: new Date().toISOString(), source: 'tools/dsh-cost' }, null, 2),
  );
  console.log(`已同步 vendor：${dest}`);
}

if (process.argv[1] && basename(process.argv[1]) === 'sync-vendor.mjs') {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
