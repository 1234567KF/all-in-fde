#!/usr/bin/env node
/**
 * 校验证据文件：shape、by.kind 约束、ID 全集、mode 一致性。
 *
 * 用法：node scripts/verify-evidence.mjs [证据目录] [--strict]
 * 默认：.fde/evidence
 * 退出码：0 通过；1 有错误。
 *
 * 与 docs/证据schema与门禁ID对照.md 保持一致。schema 管形状，本脚本管「ID 全集」与「门级一致性」。
 *
 * v0.4.0 起额外守两条（来自一次真实事故）：
 *  - E6-9（验收卡）只能是 card/human 产出，且必须带 signature；
 *    脚本产出的 E6 里 E6-9 只能是 SKIP 或 FAIL，不许 PASS。
 *  - 一条门一个文件：同 gate+target 多份且 revision 相同 → 重复证据。
 *    默认只是 WARN（兼容历史），加 --strict 变 ERROR（交付/CI 用）。
 *
 * v0.7.1 起把 E2.5 封版门纳入执法：识别 E2.5-*.json 与 5 个 item ID，
 *  gate=PASS 必须带封版人签名（signature.by），堵住「未封版也过 --strict」。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const argDir = argv.find((a) => !a.startsWith('--'));
const target = argDir ? resolve(argDir) : join(process.cwd(), '.fde', 'evidence');

// 一条 check 日志的有效期：引用更早的日志给今天的票背书不算证据
const FRESH_MS = 20 * 60 * 1000;
const evPath = (p) => (isAbsolute(p) ? p : resolve(process.cwd(), p));

const GATE_IDS = {
  E0: ['E0-1', 'E0-2', 'E0-3', 'E0-4', 'E0-5', 'E0-6'],
  'E2.5': ['E2.5-1', 'E2.5-2', 'E2.5-3', 'E2.5-4', 'E2.5-5'],
  E5: ['E5-1', 'E5-2', 'E5-3', 'E5-4', 'E5-5', 'E5-6', 'E5-7', 'E5-8', 'E5-9'],
  E6: ['E6-1', 'E6-2', 'E6-3', 'E6-4', 'E6-5', 'E6-6', 'E6-7', 'E6-8', 'E6-9', 'E6-10'],
  E7: ['E7-1', 'E7-2', 'E7-3', 'E7-4', 'E7-5', 'E7-6'],
};
const REQUIRED_ENVELOPE = ['schema', 'gate', 'revision', 'mode', 'by', 'started_at', 'finished_at', 'summary', 'items'];

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

if (!existsSync(target)) {
  console.log(`无证据目录：${target}（没有证据不判错误，由调用方决定是否缺证据）`);
  process.exit(0);
}

const files = readdirSync(target).filter((f) => /^E(?:[0567]|2\.5)-.+\.json$/.test(f)).sort();
if (files.length === 0) {
  console.log(`证据目录为空：${target}`);
  process.exit(0);
}

/** gate+target -> 已见 revision 集合 */
const seen = new Map();
let latest = new Map(); // gate+target -> 最大 revision 的文件

for (const f of files) {
  const raw = readFileSync(join(target, f), 'utf8');
  let e;
  try {
    e = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (errMsg) {
    err(`${f}: 不是合法 JSON：${errMsg.message}`);
    continue;
  }
  const gate = e.gate;
  if (!GATE_IDS[gate]) {
    err(`${f}: gate 不是 E0/E2.5/E5/E6/E7`);
    continue;
  }
  for (const k of REQUIRED_ENVELOPE) {
    if (e[k] === undefined || e[k] === null || e[k] === '') err(`${f}: 缺字段 ${k}`);
  }
  if (e.schema !== 'fde.evidence/v1') err(`${f}: schema 应为 fde.evidence/v1`);

  const kind = e.by && e.by.kind;
  if (kind === 'script') {
    if (e.cmd === undefined || e.exit === undefined) err(`${f}: script 证据缺 cmd/exit`);
  } else if (kind === 'card' || kind === 'human') {
    if (!e.signature || !e.signature.by || !e.signature.choice) err(`${f}: ${kind} 证据缺 signature`);
  } else {
    err(`${f}: by.kind 非法`);
  }

  const ids = (e.items || []).map((i) => i.id);
  const want = GATE_IDS[gate];
  for (const id of want) if (!ids.includes(id)) err(`${f}: 缺 item ${id}`);
  for (const id of ids) if (!want.includes(id)) err(`${f}: 非法 item ${id}`);
  if (new Set(ids).size !== ids.length) err(`${f}: item id 重复`);

  // E6-9 只能由验收卡产出
  if (gate === 'E6') {
    const card = (e.items || []).find((i) => i.id === 'E6-9');
    if (card && card.mode === 'PASS' && kind !== 'card' && kind !== 'human') {
      err(`${f}: E6-9 判 PASS 但 by.kind=${kind}；验收卡必须由 card-evidence.mjs 产出（带 signature）`);
    }
    if (card && card.mode === 'PASS' && (kind === 'card' || kind === 'human') && !e.signature?.by) {
      err(`${f}: E6-9 判 PASS 但没有点选人签名`);
    }
  }

  // E2.5 封版门：需求对齐权归人，封版必须有具名封版人（v0.7.1 起脚本执法）
  if (gate === 'E2.5') {
    if (e.mode === 'PASS' && !e.signature?.by) {
      err(`${f}: E2.5 判 PASS 但没有封版人签名（signature.by）；封版是人的决策，不许脚本自封`);
    }
    const coverage = (e.items || []).find((i) => i.id === 'E2.5-5');
    if (coverage && coverage.mode === 'PASS' && !coverage.observed) {
      warn(`${f}: E2.5-5 判 PASS 但无 observed；应附 spec-coverage 差集报告摘要或 S15 豁免理由`);
    }
  }

  // E5-2 时效与 E5-9 时序：v0.4.1 起由脚本兜底（此前只写在手册里）
  if (gate === 'E5') {
    const msg = (m) => (strict ? err(m) : warn(m));
    const byId = (id) => (e.items || []).find((i) => i.id === id);

    const e52 = byId('E5-2');
    if (e52) {
      const logs = (e52.evidence || [])
        .map(evPath)
        .filter((p) => existsSync(p) && /\.(log|txt|md)$/i.test(p));
      if (logs.length === 0) {
        msg(`${f}: E5-2 没有可核对的 check 日志（引用 ${JSON.stringify(e52.evidence || [])}）；记本次运行的日志路径`);
      } else {
        const started = Date.parse(e.started_at);
        const newest = Math.max(...logs.map((p) => statSync(p).mtimeMs));
        const lag = Number.isFinite(started) ? Math.abs(newest - started) : NaN;
        if (Number.isFinite(lag) && lag > FRESH_MS) {
          msg(
            `${f}: E5-2 的日志与 started_at 相差 ${Math.round(lag / 60000)} 分钟，超出 20 分钟窗口；旧日志不能给本票背书`
          );
        }
      }
    }

    const e59 = byId('E5-9');
    if (e59) {
      const refs = (e59.evidence || []).map(evPath);
      if (refs.length === 0 || !refs.some((p) => existsSync(p))) {
        msg(`${f}: E5-9 指向的复核记录不存在（${JSON.stringify(e59.evidence || [])}）；先复核、后出证据`);
      } else {
        const finished = Date.parse(e.finished_at);
        const newest = Math.max(
          ...refs.filter((p) => existsSync(p)).map((p) => statSync(p).mtimeMs)
        );
        if (Number.isFinite(finished) && newest > finished + 60_000) {
          msg(
            `${f}: E5-9 的复核记录晚于证据落盘 ${Math.round((newest - finished) / 60000)} 分钟；顺序应是先复核、后出证据`
          );
        }
      }
    }

    // E5-2 squeeze 软检：日志超 200 行建议压缩（WARN，不阻断）
    const e52sq = byId('E5-2');
    if (e52sq) {
      const logs = (e52sq.evidence || [])
        .map(evPath)
        .filter((p) => existsSync(p) && /\.(log|txt)$/i.test(p));
      for (const logPath of logs) {
        try {
          const lines = readFileSync(logPath, 'utf8').split('\n').length;
          if (lines > 200) {
            const squeezed = logPath.replace(/\.(log|txt)$/i, '.squeezed.$1');
            if (!existsSync(squeezed)) {
              warn(`${f}: E5-2 引用的日志 ${logPath} 有 ${lines} 行但未压缩；建议用 squeeze.mjs 压缩后贴压缩版`);
            }
          }
        } catch {}
      }
    }
  }

  const itemModes = new Set((e.items || []).map((i) => i.mode));
  if (e.mode === 'PASS' && itemModes.has('FAIL')) err(`${f}: 门 mode=PASS 但有条目 FAIL`);
  if (e.mode === 'PASS' && itemModes.has('SKIP') && gate !== 'E0') err(`${f}: ${gate} 不允许 SKIP 冒充 PASS`);
  if (!['PASS', 'FAIL', 'SKIP'].includes(e.mode)) err(`${f}: 非法 mode`);

  // 一条门一个文件：同 gate+target+revision 重复
  const key = `${gate}::${e.target || ''}`;
  if (!seen.has(key)) seen.set(key, []);
  const keySeen = seen.get(key);
  const dup = keySeen.find((x) => (x.revision || 0) === (e.revision || 0));
  if (dup) {
    const msg = `${f}: 与 ${dup.file} 同为 ${gate}/${e.target || '(空)'} revision=${e.revision}，属重复证据；覆盖同名文件，或升 revision 并写 supersedes`;
    if (strict) err(msg);
    else warn(msg);
  }
  keySeen.push({ file: f, revision: e.revision || 0 });

  const prev = latest.get(key);
  if (!prev || (e.revision || 0) > (prev.e.revision || 0)) latest.set(key, { f, e });
}

for (const w of warnings) console.warn(`WARN  ${w}`);

if (errors.length) {
  for (const m of errors) console.error(`ERROR ${m}`);
  console.error(`\n失败：${errors.length} 处`);
  process.exit(1);
}
const summary = [...latest.entries()]
  .map(([k, { f, e }]) => `${k.replace('::', '/')}(${f}, ${e.mode})`)
  .join(' ');
console.log(`通过：${files.length} 份证据，门级状态：${summary || '无'}`);
if (!strict && warnings.length) {
  console.log(`提示：${warnings.length} 条 WARN 未阻断；交付前用 --strict 复跑。`);
}
