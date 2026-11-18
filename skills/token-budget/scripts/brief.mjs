#!/usr/bin/env node
/**
 * brief — 生成子代理任务简报：目标、只读输入、边界、输出格式、返回上限。
 * 用法：node skills/token-budget/scripts/brief.mjs --goal "审阅第5章" --inputs "a.md,b.md" [--max-return 1500]
 */
import { basename } from 'node:path';
import { parseCli, printJson, splitList, writeText } from './lib/common.mjs';

export function buildBrief({ goal, inputs = [], constraints = [], output = 'Markdown 报告，写到文件', maxReturn = 1500, label = '子任务', model = '' }) {
  const limit = Math.min(4000, Math.max(500, Number(maxReturn) || 1500));
  const inputLines = inputs.length ? inputs.map((item) => `- \`${item}\``) : ['- （未指定，按目标自行定位；只读必要文件）'];
  const constraintLines = constraints.length ? constraints : ['只读，不改文件', '不读无关目录', '同一文件不重复整读'];
  return [
    `# 子代理任务简报：${label}`,
    '',
    '## 目标',
    goal || '（未填写）',
    '',
    '## 输入（只读）',
    ...inputLines,
    '',
    '## 边界',
    ...constraintLines.map((line) => `- ${line}`),
    '- 找不到就说找不到，不编造',
    '- 不把原文大段贴回主线程',
    '',
    '## 输出',
    output,
    '',
    '## 返回上限',
    `≤ ${limit} tokens。详细内容写到文件，回复只给：文件路径 + 3 条结论 + 未决问题（如有）。`,
    '',
    '## 禁止',
    '- 不贴全文、不重述输入',
    '- 不修改输入文件',
    '- 不扩大范围',
    ...(model ? ['', `## 模型`, model] : []),
  ].join('\n');
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const goal = String(cli.goal || cli._.join(' ') || '').trim();
  if (!goal) {
    console.error('用法：node skills/token-budget/scripts/brief.mjs --goal "子任务" --inputs "a,b" [--constraints "只读;不改文件"] [--max-return 1500] [--out brief.md]');
    process.exit(2);
  }
  const brief = buildBrief({
    goal,
    inputs: splitList(cli.inputs),
    constraints: splitList(cli.constraints),
    output: cli.output,
    maxReturn: cli['max-return'],
    label: cli.label,
    model: cli.model,
  });
  if (cli.out) {
    writeText(cli.out, `${brief}\n`);
    if (cli.json) printJson({ out: cli.out, maxReturn: Number(cli['max-return']) || 1500 });
    else console.log(`已写入 ${cli.out}`);
    return;
  }
  if (cli.json) printJson({ brief, maxReturn: Number(cli['max-return']) || 1500 });
  else process.stdout.write(`${brief}\n`);
}

if (process.argv[1] && basename(process.argv[1]) === 'brief.mjs') {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
