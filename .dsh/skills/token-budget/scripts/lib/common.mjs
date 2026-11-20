/** 共用工具：路径、参数、峰谷、任务分类。无第三方依赖。 */
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dshCostHome, dshCostReportsDir, repoRoot, tokenBudgetRoot } from './dsh-cost.mjs';

export { repoRoot };
export const skillRoot = tokenBudgetRoot;
export const dshCostRoot = dshCostHome;

export function parseCli(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      opts._.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i += 1;
      }
    } else {
      opts._.push(arg);
    }
  }
  return opts;
}

export function stripBom(text) {
  return text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readText(file) {
  return stripBom(readFileSync(file, 'utf8'));
}

export function readJson(file) {
  return JSON.parse(readText(file));
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export function writeText(file, text) {
  ensureDir(dirname(file));
  writeFileSync(file, text, 'utf8');
}

export function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(/[,;，；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatMoney(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 3 : 4;
  return `¥${abs.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function classifyTask(text) {
  const value = String(text || '');
  if (/ppt|幻灯片|演示文稿|演示|课件|deck|slides?|汇报材料/i.test(value)) return 'ppt';
  // IT 系统/平台/模块开发优先于文档（"做个合同审批系统"是 code 不是 doc）
  if (/(?:做|建|开发|实现|搭建|写|弄|搞).*(?:系统|平台|应用|模块|功能|页面|后台|管理|crm|erp|oa|saas|工具)/i.test(value) || /(?:系统|平台|应用|模块|功能|页面|后台).*(?:做|建|开发|实现|搭建|写|弄|搞)/i.test(value)) return 'code';
  if (/标书|专利|软著|团标|申报|白皮书|合同|文档|审阅|审核|扩写|润色|改写|校对|一致性|docx|word|报告/i.test(value)) return 'doc';
  if (/代码|开发|编程|游戏|unity|unreal|ue[45]|接口|api|bug|测试|重构|架构|数据库|前端|后端|脚本|部署/i.test(value)) return 'code';
  if (/调研|研究|对比|选型|竞品|文献|综述/i.test(value)) return 'research';
  return 'doc';
}

export async function peakContext(now = Date.now()) {
  if (!dshCostHome) {
    return { available: false, peak: null, label: 'dsh-cost 未安装（运行 scripts/install.mjs）', nextIdle: null };
  }
  const priceFile = join(dshCostHome, 'pricing.json');
  const priceModule = join(dshCostHome, 'src', 'price.mjs');
  if (!existsSync(priceFile) || !existsSync(priceModule)) {
    return { available: false, peak: null, label: '价格表不可用', nextIdle: null };
  }
  try {
    const mod = await import(pathToFileURL(priceModule).href);
    const cfg = mod.loadPricing(priceFile);
    const info = mod.peakInfo(now, cfg);
    if (!info.peak) {
      return { available: true, peak: false, label: '低谷（单价约为高峰一半）', nextIdle: null, date: info.date };
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: cfg.peakRule.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(now));
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
    const current = hour * 60 + minute;
    const toMinutes = (hhmm) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const window = (cfg.peakRule.windows || []).find(([from, to]) => current >= toMinutes(from) && current < toMinutes(to));
    const end = window?.[1] ?? '18:00';
    return { available: true, peak: true, label: `高峰（单价 2 倍），${end} 后转低谷`, nextIdle: end, date: info.date };
  } catch (error) {
    return { available: false, peak: null, label: `峰谷判断失败：${error.message}`, nextIdle: null };
  }
}

/** 读取 DSH 最近的上下文压力（session_projcache），用于自动提醒；读不到返回 null。 */
export function latestContextTokens() {
  const dir = join(homedir(), '.dsh', 'storages', 'session_projcache', 'sessions');
  if (!existsSync(dir)) return null;
  let files;
  try {
    files = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({ name, mtimeMs: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 5);
  } catch {
    return null;
  }
  for (const file of files) {
    try {
      const data = readJson(join(dir, file.name));
      const pressure = data.record?.rows?.contextPressure?.val;
      const tokens = pressure?.pressureTokens ?? pressure?.surfaceTokens;
      if (Number.isFinite(tokens)) return { tokens, file: file.name };
    } catch {}
  }
  return null;
}

export function recentAverage() {
  if (!dshCostReportsDir) return null;
  const file = join(dshCostReportsDir, 'summary.json');
  if (!existsSync(file)) return null;
  try {
    const data = readJson(file);
    const totals = data.totals || {};
    if (!totals.turns || !totals.cost) return null;
    return { costPerTurn: totals.cost / totals.turns, turns: totals.turns, cost: totals.cost, generatedAt: data.generatedAt };
  } catch {
    return null;
  }
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
