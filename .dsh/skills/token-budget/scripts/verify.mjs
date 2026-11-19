#!/usr/bin/env node
/**
 * verify — 复用 dsh-cost 的账本与 A/B 统计，输出“每合格交付物成本”对比。
 * 用法：node skills/token-budget/scripts/verify.mjs --task doc-review-01 [--base A] [--cand B] [--json]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dshCostRoot, parseCli, printJson, readJson } from './lib/common.mjs';
import { requireDshCost } from './lib/dsh-cost.mjs';

async function loadModules() {
  const pricePath = join(dshCostRoot, 'src', 'price.mjs');
  const modelPath = join(dshCostRoot, 'src', 'model.mjs');
  const abPath = join(dshCostRoot, 'src', 'ab.mjs');
  for (const file of [pricePath, modelPath, abPath]) {
    if (!existsSync(file)) throw new Error(`找不到 dsh-cost 模块：${file}`);
  }
  const [price, model, ab] = await Promise.all([
    import(pathToFileURL(pricePath).href),
    import(pathToFileURL(modelPath).href),
    import(pathToFileURL(abPath).href),
  ]);
  return { price, model, ab };
}

function loadSessions() {
  const dir = join(dshCostRoot, 'data', 'sessions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(join(dir, name)));
}

function loadMedia() {
  const file = join(dshCostRoot, 'data', 'media.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function main() {
  requireDshCost();
  const cli = parseCli(process.argv.slice(2));
  const task = String(cli.task || cli._[0] || '').trim();
  if (!task) {
    console.error('用法：node skills/token-budget/scripts/verify.mjs --task "<#task 标签>" [--base A] [--cand B] [--json]');
    process.exit(2);
  }
  const sessions = loadSessions();
  if (!sessions.length) {
    console.error('没有账本数据。先运行：node tools/dsh-cost/bin/dsh-cost.mjs sync');
    process.exit(2);
  }
  const { price, model, ab } = await loadModules();
  const pricing = price.loadPricing(join(dshCostRoot, 'pricing.json'));
  const ledger = model.buildLedger(sessions, pricing, loadMedia());
  const defaultJudgments = join(dshCostRoot, 'bench', 'judgments.json');
  const judgmentsFile = cli.judgments || (existsSync(defaultJudgments) ? defaultJudgments : undefined);
  const result = ab.compareTask(ledger, { task, base: cli.base || 'A', cand: cli.cand || 'B', judgmentsFile });
  if (cli.json) printJson(result);
  else process.stdout.write(`${ab.renderCompare(result, ledger)}\n`);
}

if (process.argv[1] && basename(process.argv[1]) === 'verify.mjs') {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
