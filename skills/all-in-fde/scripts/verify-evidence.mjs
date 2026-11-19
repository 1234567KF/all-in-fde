#!/usr/bin/env node
/**
 * 校验证据文件：shape、by.kind 约束、ID 全集、mode 一致性。
 *
 * 用法：node scripts/verify-evidence.mjs [证据目录]
 * 默认：.fde/evidence
 * 退出码：0 通过；1 有错误。
 *
 * 与 docs/证据schema与门禁ID对照.md 保持一致。schema 管形状，本脚本管「ID 全集」与「门级一致性」。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? resolve(process.argv[2]) : join(process.cwd(), '.fde', 'evidence');

const GATE_IDS = {
  E0: ['E0-1', 'E0-2', 'E0-3', 'E0-4', 'E0-5', 'E0-6'],
  E5: ['E5-1', 'E5-2', 'E5-3', 'E5-4', 'E5-5', 'E5-6', 'E5-7', 'E5-8', 'E5-9'],
  E6: ['E6-1', 'E6-2', 'E6-3', 'E6-4', 'E6-5', 'E6-6', 'E6-7', 'E6-8', 'E6-9', 'E6-10'],
  E7: ['E7-1', 'E7-2', 'E7-3', 'E7-4', 'E7-5', 'E7-6'],
};
const REQUIRED_ENVELOPE = ['schema', 'gate', 'revision', 'mode', 'by', 'started_at', 'finished_at', 'summary', 'items'];

const errors = [];
const err = (m) => errors.push(m);

if (!existsSync(target)) {
  console.log(`无证据目录：${target}（没有证据不判错误，由调用方决定是否缺证据）`);
  process.exit(0);
}

const files = readdirSync(target).filter((f) => /^E[0567]-.+\.json$/.test(f)).sort();
if (files.length === 0) {
  console.log(`证据目录为空：${target}`);
  process.exit(0);
}

let latest = new Map(); // gate -> 最大 revision 的文件
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
    err(`${f}: gate 不是 E0/E5/E6/E7`);
    continue;
  }
  // 信封必填
  for (const k of REQUIRED_ENVELOPE) {
    if (e[k] === undefined || e[k] === null || e[k] === '') err(`${f}: 缺字段 ${k}`);
  }
  if (e.schema !== 'fde.evidence/v1') err(`${f}: schema 应为 fde.evidence/v1`);
  // by.kind 约束
  const kind = e.by && e.by.kind;
  if (kind === 'script') {
    if (e.cmd === undefined || e.exit === undefined) err(`${f}: script 证据缺 cmd/exit`);
  } else if (kind === 'card' || kind === 'human') {
    if (!e.signature || !e.signature.by || !e.signature.choice) err(`${f}: ${kind} 证据缺 signature`);
  } else {
    err(`${f}: by.kind 非法`);
  }
  // items
  const ids = (e.items || []).map((i) => i.id);
  const want = GATE_IDS[gate];
  for (const id of want) if (!ids.includes(id)) err(`${f}: 缺 item ${id}`);
  for (const id of ids) if (!want.includes(id)) err(`${f}: 非法 item ${id}`);
  if (new Set(ids).size !== ids.length) err(`${f}: item id 重复`);
  // 门级 mode 与条目一致
  const itemModes = new Set((e.items || []).map((i) => i.mode));
  if (e.mode === 'PASS' && itemModes.has('FAIL')) err(`${f}: 门 mode=PASS 但有条目 FAIL`);
  if (e.mode === 'PASS' && itemModes.has('SKIP') && gate !== 'E0') err(`${f}: ${gate} 不允许 SKIP 冒充 PASS`);
  if (!['PASS', 'FAIL', 'SKIP'].includes(e.mode)) err(`${f}: 非法 mode`);
  // 取最大 revision
  const prev = latest.get(gate);
  if (!prev || (e.revision || 0) > (prev.e.revision || 0)) latest.set(gate, { f, e });
}

if (errors.length) {
  for (const m of errors) console.error(`ERROR ${m}`);
  console.error(`\n失败：${errors.length} 处`);
  process.exit(1);
}
const summary = [...latest.entries()].map(([g, { f }]) => `${g}(${f})`).join(' ');
console.log(`通过：${files.length} 份证据，门级状态：${summary || '无'}`);
