#!/usr/bin/env node
/** 检查 token-budget 与 dsh-cost 的绑定状态。 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { dshCostDataDir, dshCostHome, dshCostReportsDir, dshCostSource, requireDshCost, tokenBudgetRoot } from './lib/dsh-cost.mjs';

function count(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => name.endsWith('.json')).length;
}

function main() {
  const report = {
    skillRoot: tokenBudgetRoot,
    dshCostHome,
    source: dshCostSource,
    bin: dshCostHome ? existsSync(join(dshCostHome, 'bin', 'dsh-cost.mjs')) : false,
    pricing: dshCostHome ? existsSync(join(dshCostHome, 'pricing.json')) : false,
    sessions: count(dshCostDataDir ? join(dshCostDataDir, 'sessions') : ''),
    epoch: dshCostDataDir && existsSync(join(dshCostDataDir, 'epoch.json'))
      ? JSON.parse(readFileSync(join(dshCostDataDir, 'epoch.json'), 'utf8'))
      : null,
    summary: dshCostReportsDir ? existsSync(join(dshCostReportsDir, 'summary.json')) : false,
  };
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`技能：${report.skillRoot}`);
  console.log(`dsh-cost：${report.dshCostHome ?? '未找到'}（${report.source ?? '—'}）`);
  console.log(`bin：${report.bin ? '✓' : '✗'}｜pricing：${report.pricing ? '✓' : '✗'}`);
  console.log(`账本会话：${report.sessions}｜epoch：${report.epoch ? report.epoch.resetAtIso : '无'}｜summary：${report.summary ? '✓' : '✗'}`);
  if (!report.bin || !report.pricing) {
    console.error('依赖未绑定。运行：node scripts/install.mjs');
    process.exit(1);
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'doctor.mjs') {
  try {
    requireDshCost();
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
