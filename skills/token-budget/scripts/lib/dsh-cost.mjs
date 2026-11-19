/** 解析 dsh-cost 依赖：环境变量 → 用户安装目录 → 技能自带 vendor → 仓库 tools。 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const tokenBudgetRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'tools', 'dsh-cost', 'pricing.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start, '..', '..');
}

export const repoRoot = findRepoRoot(tokenBudgetRoot);

const candidates = [
  { source: 'env', dir: process.env.DSH_COST_HOME },
  { source: 'user', dir: join(homedir(), '.dsh', 'dsh-cost') },
  { source: 'tools', dir: join(repoRoot, 'tools', 'dsh-cost') },
  { source: 'vendor', dir: join(tokenBudgetRoot, 'vendor', 'dsh-cost') },
].filter((item) => item.dir);

const found = candidates.find(
  (item) => existsSync(join(item.dir, 'bin', 'dsh-cost.mjs')) && existsSync(join(item.dir, 'pricing.json')),
);

export const dshCostHome = found?.dir ?? null;
export const dshCostSource = found?.source ?? null;
export const dshCostRoot = dshCostHome;
export const dshCostDataDir = dshCostHome ? join(dshCostHome, 'data') : null;
export const dshCostReportsDir = dshCostHome ? join(dshCostHome, 'reports') : null;

export function requireDshCost() {
  if (!dshCostHome) {
    throw new Error(
      '找不到 dsh-cost。运行 `node scripts/install.mjs` 安装依赖，或设置 DSH_COST_HOME 指向 dsh-cost 目录。',
    );
  }
  return dshCostHome;
}
