#!/usr/bin/env node
/**
 * plan — token-budget 任务入口：判断类型、峰谷、读取策略、子代理与预算。
 * 用法：node skills/token-budget/scripts/plan.mjs --task "用户原话" [--type auto|doc|code|ppt|research] [--json]
 */
import { basename, join } from 'node:path';
import { classifyTask, formatMoney, latestContextTokens, parseCli, peakContext, printJson, recentAverage, skillRoot, splitList } from './lib/common.mjs';

const TYPES = new Set(['doc', 'code', 'ppt', 'research']);
const PLAYBOOK = {
  doc: 'references/playbook-doc.md',
  code: 'references/playbook-code.md',
  ppt: 'references/playbook-ppt.md',
  research: 'references/playbook-research.md',
};
const READ_STRATEGY = {
  doc: '先生成大纲/章节索引，再按节读；对话只留路径、结论和 diff，不贴全文',
  code: 'glob/grep 定位 → map/signatures → 只读相关行区间；同一文件不重复整读',
  ppt: '先定模板/页数/素材清单，再用脚本生成；对话只留文件路径、页数和摘要',
  research: '先列问题清单，子代理并行取证；主线程只做综合，不搬运原文',
};
const TURNS = { doc: 6, code: 8, ppt: 10, research: 8 };

export async function buildPlan({ task, type, now = Date.now(), files = [], contextTokens = null }) {
  const resolvedType = TYPES.has(type) ? type : classifyTask(task);
  const peak = await peakContext(now);
  const avg = recentAverage();
  const turns = TURNS[resolvedType];
  const estimate = avg ? avg.costPerTurn * turns : null;
  const subagents =
    resolvedType === 'research' ||
    resolvedType === 'ppt' ||
    files.length > 2 ||
    String(task).length > 120 ||
    (resolvedType === 'doc' && /审阅|审核|核对|一致性|多章|全文/.test(task));
  const detected = contextTokens === null || contextTokens === undefined ? latestContextTokens() : null;
  const contextTokensNum = Number(contextTokens ?? detected?.tokens) || null;
  const contextSource = contextTokens !== null && contextTokens !== undefined ? 'cli' : detected ? 'dsh-projcache' : null;
  const contextWarning =
    contextTokensNum === null ? null : contextTokensNum > 200000 ? '上下文 >200k，先落文件/压缩，再继续' : contextTokensNum > 120000 ? '上下文 >120k，优先按节读、清工具结果' : null;
  let effort = 'medium';
  if (resolvedType === 'code') effort = /架构|设计|方案|评审|疑难|性能|兼容/i.test(task) ? 'high' : 'low';
  if (resolvedType === 'doc') effort = /审阅|审核|评审|核对|一致性|合同|法律/i.test(task) ? 'high' : 'medium';
  if (resolvedType === 'ppt') effort = 'low';
  if (resolvedType === 'research') effort = 'high';

  return {
    task: String(task || ''),
    type: resolvedType,
    typeLabel: { doc: '长文/文档', code: 'IT/游戏开发', ppt: 'PPT/演示', research: '调研/对比' }[resolvedType],
    peak: peak.peak,
    peakLabel: peak.label,
    nextIdle: peak.nextIdle,
    model: 'deepseek-flash',
    modelNote: /架构|高难度|关键决策|疑难/i.test(task) ? '如判断失误代价高，可升 deepseek-v4-pro，但先确认质量收益' : '默认 flash；不要中途频繁换模型',
    effort,
    readStrategy: READ_STRATEGY[resolvedType],
    contextTokens: contextTokensNum,
    contextSource,
    contextWarning,
    subagents,
    maxReturn: 1500,
    compression: '仅日志/JSON/命令输出，且必须可逆；代码、文档正文、交付物不压',
    budget: {
      turns,
      costPerTurn: avg?.costPerTurn ?? null,
      estimate,
      note: avg ? `按最近报表平均每轮 ${formatMoney(avg.costPerTurn)} 估算` : '缺少历史账单，仅为轮次参考',
    },
    playbook: PLAYBOOK[resolvedType],
    redlines: [
      '不压缩源代码、文档正文、合同、交付物',
      '同一段内容只允许一个压缩器，不叠加',
      '不改 system prompt/tools 前缀，不在会话中途频繁换模型',
      '子代理只回 ≤1500 token，详细内容写文件',
      '交付质量优先；省 token 不是目标',
    ],
    next: {
      brief: `node "${join(skillRoot, 'scripts', 'brief.mjs')}" --goal "<子任务>" --inputs "<文件>" --max-return 1500`,
      squeeze: `node "${join(skillRoot, 'scripts', 'squeeze.mjs')}" "<日志或JSON文件>" --level medium --out "<压缩文件>"`,
      verify: `node "${join(skillRoot, 'scripts', 'verify.mjs')}" --task "<#task 标签>"`,
    },
  };
}

function renderMarkdown(plan) {
  const lines = [];
  lines.push('# token-budget 计划');
  lines.push('');
  lines.push(`- 任务类型：**${plan.type}**（${plan.typeLabel}）`);
  lines.push(`- 当前时段：${plan.peakLabel}`);
  lines.push(`- 模型/effort：${plan.model} / ${plan.effort}（${plan.modelNote}）`);
  lines.push(`- 读取策略：${plan.readStrategy}`);
  if (plan.contextWarning) lines.push(`- 上下文提醒：${plan.contextWarning}`);
  lines.push(`- 子代理：${plan.subagents ? '建议使用' : '非必需'}；返回上限 ${plan.maxReturn} tokens`);
  lines.push(`- 压缩：${plan.compression}`);
  lines.push(`- 预算参考：约 ${plan.budget.turns} 轮${plan.budget.estimate === null ? '' : ` × ${formatMoney(plan.budget.costPerTurn)} ≈ ${formatMoney(plan.budget.estimate)}`}`);
  lines.push(`- Playbook：\`${plan.playbook}\``);
  lines.push('');
  lines.push('## 执行顺序');
  lines.push('1. 先读对应的 playbook，再开始动手。');
  lines.push(`2. 需要拆子代理时：\`${plan.next.brief}\``);
  lines.push(`3. 需要处理长日志/JSON 时：\`${plan.next.squeeze}\``);
  lines.push(`4. 交付后做 A/B 或对账：\`${plan.next.verify}\``);
  lines.push('');
  lines.push('## 红线');
  for (const line of plan.redlines) lines.push(`- ${line}`);
  lines.push('');
  lines.push('> 这是流程建议，不是内容标准；领域技能（all-in-md、PPT、编码）的规则优先。');
  return lines.join('\n');
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const task = String(cli.task || cli._.join(' ') || '').trim();
  if (!task) {
    console.error('用法：node skills/token-budget/scripts/plan.mjs --task "用户任务" [--type doc|code|ppt|research] [--files a,b] [--json]');
    process.exit(2);
  }
  const plan = await buildPlan({
    task,
    type: cli.type === 'auto' ? undefined : cli.type,
    now: cli.now ? Date.parse(cli.now) : Date.now(),
    files: splitList(cli.files),
    contextTokens: cli['context-tokens'] ? Number(cli['context-tokens']) : null,
  });
  if (cli.json) printJson(plan);
  else process.stdout.write(`${renderMarkdown(plan)}\n`);
}

if (process.argv[1] && basename(process.argv[1]) === 'plan.mjs') {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
