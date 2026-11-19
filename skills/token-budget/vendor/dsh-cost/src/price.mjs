/** 计价：多 provider / 多币种 / 阶梯价 / 峰谷 / 按张计费。 */
import fs from 'node:fs';

let DISPLAY_CURRENCY = 'CNY';
export function setDisplayCurrency(currency) {
  DISPLAY_CURRENCY = currency;
}

export function loadPricing(file) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!cfg.providers && !cfg.media) throw new Error(`价格表不完整：${file}`);
  cfg.displayCurrency ||= 'CNY';
  cfg.fx ||= { CNY: 1, USD: 7.1 };
  if (!(cfg.displayCurrency in cfg.fx)) throw new Error(`fx 缺少显示币种：${cfg.displayCurrency}`);
  setDisplayCurrency(cfg.displayCurrency);
  return cfg;
}

export function convert(amount, from, cfg) {
  if (amount === null || amount === undefined) return null;
  const rate = cfg.fx[from];
  if (!rate) return null;
  return (amount * rate) / cfg.fx[cfg.displayCurrency];
}

/** 精确匹配 provider/model，其次通配，最后按 provider 的别名解析。 */
export function resolveEntry(cfg, provider, model) {
  if (!model) return null;
  const providers = cfg.providers || {};
  const route = cfg.providerAliases?.[provider] ?? provider;
  const exact = providers[route]?.models?.[model];
  if (exact) return { provider: route, model, entry: exact, matched: route === provider ? 'exact' : 'provider-alias' };
  const wildcard = providers['*']?.models?.[model];
  if (wildcard) return { provider: '*', model, entry: wildcard, matched: 'wildcard-model' };
  for (const [providerKey, profile] of Object.entries(providers)) {
    if (profile.aliases?.[model] && profile.models?.[profile.aliases[model]]) {
      const alias = profile.aliases[model];
      return { provider: providerKey, model: alias, entry: profile.models[alias], matched: 'alias' };
    }
  }
  return null;
}

const formatterCache = new Map();
function partsAt(timeMs, timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  const parts = {};
  for (const part of formatter.formatToParts(new Date(timeMs))) parts[part.type] = part.value;
  return parts;
}

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function toMinutes(hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 60 + minute;
}

/** 是否处于高峰时段。第二参数可以是整张价格表，也可以是某个 provider 的 peakRule。 */
export function peakInfo(timeMs, cfgOrRule) {
  const rule = cfgOrRule.peakRule ?? cfgOrRule;
  const parts = partsAt(timeMs, rule.timezone);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = WEEKDAY[parts.weekday] ?? null;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const holiday = (rule.holidays || []).includes(date);
  const inWindow = (rule.windows || []).some(([from, to]) => minutes >= toMinutes(from) && minutes < toMinutes(to));
  const workday = (rule.weekdays || [1, 2, 3, 4, 5]).includes(weekday);
  return { peak: workday && !holiday && inWindow, date, minutes, weekday, holiday };
}

/** 单价（原生币种）。peak 与 idle 相同表示该 provider 不分时段。 */
export function ratesAt(cfg, resolved, timeMs, inputTokens = 0) {
  if (!resolved) return null;
  const rule = cfg.providers?.[resolved.provider]?.peakRule ?? cfg;
  const { peak } = peakInfo(timeMs, rule);
  const rates = bucketFor(cfg, resolved, peak, inputTokens);
  return rates ? { ...rates, peak } : null;
}

/** 低谷单价，用于“如果全部安排在低谷”的反事实。 */
export function idleRatesAt(cfg, resolved, inputTokens = 0) {
  if (!resolved) return null;
  const rates = bucketFor(cfg, resolved, false, inputTokens);
  return rates ? { ...rates, peak: false } : null;
}

function bucketFor(cfg, resolved, peak, inputTokens) {
  const entry = resolved.entry;
  let bucket = peak ? entry.peak : entry.idle;
  let tier = null;
  if (Array.isArray(entry.tiers)) {
    for (const candidate of [...entry.tiers].sort((a, b) => a.above - b.above)) {
      if (inputTokens > candidate.above) {
        bucket = { ...bucket, ...(peak ? candidate.peak : candidate.idle) };
        tier = candidate.above;
      }
    }
  }
  if (!bucket) return null;
  return {
    provider: resolved.provider,
    model: resolved.model,
    label: entry.label || resolved.model,
    currency: entry.currency || cfg.displayCurrency,
    tier,
    ...bucket,
  };
}

/** 单次 token 调用金额（原生币种）。 */
export function costOf(usage, rates, unit = 1e6) {
  if (!rates) return null;
  return (
    ((usage.miss || 0) * rates.miss + (usage.hit || 0) * rates.hit + (usage.write || 0) * rates.write + (usage.out || 0) * rates.output) /
    unit
  );
}

/** 按张/按次计费：quantity × 单价。 */
export function mediaPrice(cfg, record) {
  const key = `${record.provider}/${record.model}`;
  const def = cfg.media?.[key] || cfg.media?.[`*/${record.model}`];
  if (!def) return null;
  const variant = record.variant || 'default';
  const unitPrice = record.unitPrice ?? def.variants?.[variant] ?? def.variants?.default ?? def.price ?? null;
  const costNative = record.amount ?? (unitPrice === null ? null : unitPrice * (record.quantity ?? 1));
  if (costNative === null) {
    return { ...record, unitPrice: null, costNative: null, currency: def.currency || cfg.displayCurrency, billing: def.billing || 'image', label: def.label || record.model };
  }
  return {
    ...record,
    currency: record.currency || def.currency || cfg.displayCurrency,
    unitPrice,
    costNative,
    billing: def.billing || 'image',
    label: def.label || record.model,
  };
}

export function fmtMoney(value, { sign = false, currency = DISPLAY_CURRENCY } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : `${currency} `;
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 3 : 4;
  const text = abs.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (sign && value !== 0) return `${value > 0 ? '+' : '-'}${symbol}${text}`;
  return `${value < 0 ? '-' : ''}${symbol}${text}`;
}

export function fmtInt(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

export function fmtPct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function fmtDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m${String(rest).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
}

export function fmtTime(timeMs, timeZone = 'Asia/Shanghai') {
  if (!timeMs) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timeMs));
}
