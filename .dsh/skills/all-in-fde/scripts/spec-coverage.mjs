#!/usr/bin/env node
/**
 * spec 覆盖率核验：检查 spec 目录中的 AC/BR/REQ/页面编号与采集表的双向差集。
 *
 * 用法：
 *   node scripts/spec-coverage.mjs <spec目录> <采集表.xlsx> [--json]
 *
 * 退出码：0 差集为空；1 有未覆盖项；2 参数/文件错误。
 *
 * 原理：
 *   - 从 spec/*.md 中提取所有 REQ-/AC-/BR- 编号和页面 ID
 *   - 从采集表 xlsx 的 S7/S11 等 sheet 中提取对应编号
 *   - 输出双向差集报告
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const jsonOnly = argv.includes('--json');
const args = argv.filter((a) => !a.startsWith('--'));

if (args.length < 2) {
  console.error('用法：node scripts/spec-coverage.mjs <spec目录> <采集表.xlsx> [--json]');
  process.exit(2);
}

const specDir = resolve(args[0]);
const xlsxPath = resolve(args[1]);

if (!existsSync(specDir)) {
  console.error(`ERROR spec 目录不存在：${specDir}`);
  process.exit(2);
}
if (!existsSync(xlsxPath)) {
  console.error(`ERROR 采集表不存在：${xlsxPath}`);
  process.exit(2);
}

// ── 从 spec 文件中提取编号 ───────────────────────────────────────────────────
function extractIds(dir) {
  const ids = { REQ: new Set(), AC: new Set(), BR: new Set(), pages: new Set() };
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(/\bREQ-[A-Z0-9]+/gi)) ids.REQ.add(m[0].toUpperCase());
    for (const m of text.matchAll(/\bAC-[A-Z0-9]+/gi)) ids.AC.add(m[0].toUpperCase());
    for (const m of text.matchAll(/\bBR-[A-Z0-9]+/gi)) ids.BR.add(m[0].toUpperCase());
    // 页面 ID：匹配 "页面ID: xxx" 或 "pageId: xxx" 或 "# xxx" 标题模式
    for (const m of text.matchAll(/(?:页面\s*ID|pageId|page[_-]?id)[：:\s]+([A-Za-z0-9_-]+)/gi)) {
      ids.pages.add(m[1]);
    }
  }
  return ids;
}

// ── 从采集表提取编号（Python openpyxl） ──────────────────────────────────────
const pyScript = `
import sys, json, re
try:
    from openpyxl import load_workbook
except ImportError:
    print(json.dumps({"error": "openpyxl not installed"}))
    sys.exit(2)

wb = load_workbook(sys.argv[1], read_only=True, data_only=True)
result = {"REQ": [], "AC": [], "BR": [], "pages": []}

# S7 页面 → pages + REQ
if "S7" in wb.sheetnames:
    ws = wb["S7"]
    for row in ws.iter_rows(min_row=2, values_only=True):
        for cell in row:
            if cell:
                s = str(cell)
                for m in re.finditer(r'REQ-[A-Za-z0-9]+', s): result["REQ"].append(m.group().upper())
                for m in re.finditer(r'[A-Za-z][A-Za-z0-9_-]{2,}', s):
                    if not m.group().startswith(('REQ','AC','BR','EB','ST','FLD')):
                        result["pages"].append(m.group())

# S11 验收 → AC
if "S11" in wb.sheetnames:
    ws = wb["S11"]
    for row in ws.iter_rows(min_row=2, values_only=True):
        for cell in row:
            if cell:
                for m in re.finditer(r'AC-[A-Za-z0-9]+', str(cell)): result["AC"].append(m.group().upper())

# S6 业务规则 → BR
if "S6" in wb.sheetnames:
    ws = wb["S6"]
    for row in ws.iter_rows(min_row=2, values_only=True):
        for cell in row:
            if cell:
                for m in re.finditer(r'BR-[A-Za-z0-9]+', str(cell)): result["BR"].append(m.group().upper())

# 去重
for k in result: result[k] = list(set(result[k]))
print(json.dumps(result))
`;

const py = spawnSync('python', ['-c', pyScript, xlsxPath], { encoding: 'utf8', timeoutMs: 30000 });
let xlsxIds;
if (py.status !== 0) {
  const py3 = spawnSync('python3', ['-c', pyScript, xlsxPath], { encoding: 'utf8', timeoutMs: 30000 });
  if (py3.status !== 0) {
    console.error('ERROR 需要 Python + openpyxl。安装：pip install openpyxl');
    process.exit(2);
  }
  xlsxIds = JSON.parse(py3.stdout.trim());
} else {
  xlsxIds = JSON.parse(py.stdout.trim());
}

if (xlsxIds.error) {
  console.error(`ERROR ${xlsxIds.error}`);
  process.exit(2);
}

// ── 计算双向差集 ─────────────────────────────────────────────────────────────
const specIds = extractIds(specDir);
const report = {};
let totalGaps = 0;

for (const kind of ['REQ', 'AC', 'BR']) {
  const specSet = specIds[kind];
  const xlsxSet = new Set(xlsxIds[kind] || []);
  const inSpecNotXlsx = [...specSet].filter((id) => !xlsxSet.has(id));
  const inXlsxNotSpec = [...xlsxSet].filter((id) => !specSet.has(id));
  report[kind] = { inSpecNotXlsx, inXlsxNotSpec };
  totalGaps += inSpecNotXlsx.length + inXlsxNotSpec.length;
}

// pages 只做简单比对
const specPages = specIds.pages;
const xlsxPages = new Set(xlsxIds.pages || []);
report.pages = {
  inSpecNotXlsx: [...specPages].filter((p) => !xlsxPages.has(p)),
  inXlsxNotSpec: [...xlsxPages].filter((p) => !specPages.has(p)),
};
totalGaps += report.pages.inSpecNotXlsx.length + report.pages.inXlsxNotSpec.length;

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(totalGaps > 0 ? 1 : 0);
}

if (totalGaps === 0) {
  console.log('PASS  spec 覆盖率检查通过：AC/BR/REQ/页面 双向差集均为空。');
  process.exit(0);
}

console.error(`FAIL  spec 覆盖率检查发现 ${totalGaps} 处缺口：\n`);
for (const [kind, gap] of Object.entries(report)) {
  if (gap.inSpecNotXlsx.length) {
    console.error(`  ${kind} 在 spec 中但不在采集表中（${gap.inSpecNotXlsx.length}）：`);
    for (const id of gap.inSpecNotXlsx) console.error(`    - ${id}`);
  }
  if (gap.inXlsxNotSpec.length) {
    console.error(`  ${kind} 在采集表中但不在 spec 中（${gap.inXlsxNotSpec.length}）：`);
    for (const id of gap.inXlsxNotSpec) console.error(`    - ${id}`);
  }
}
console.error('\n差集非空不许封版，除非 S15 记了豁免理由。');
process.exit(1);
