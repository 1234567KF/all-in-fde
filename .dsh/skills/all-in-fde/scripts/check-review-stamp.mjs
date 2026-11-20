#!/usr/bin/env node
/**
 * 核验戳检查：校验采集表 xlsx 中指定 sheet 的「客户核验」列是否全部为已核验。
 *
 * 用法：
 *   node scripts/check-review-stamp.mjs <xlsx文件> [--sheets S0,S3,S5,S7,S13]
 *
 * 退出码：0 全部已核验；1 有未核验项；2 参数/文件错误。
 *
 * 依赖：openpyxl（Python）或 xlsx（Node）。优先用 Node xlsx 库，
 * 若不可用则回退到 Python openpyxl。两者都没有时退出 2。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const xlsxPath = argv.find((a) => !a.startsWith('--'));
if (!xlsxPath || !existsSync(xlsxPath)) {
  console.error('用法：node scripts/check-review-stamp.mjs <xlsx文件> [--sheets S0,S3,S5,S7,S13]');
  process.exit(2);
}

const sheetsArg = arg('sheets', 'S0,S3,S5,S7,S13');
const targetSheets = sheetsArg.split(',').map((s) => s.trim()).filter(Boolean);

// 尝试用 Python openpyxl 读取
const pyScript = `
import sys, json
try:
    from openpyxl import load_workbook
except ImportError:
    print(json.dumps({"error": "openpyxl not installed"}))
    sys.exit(2)

wb = load_workbook(sys.argv[1], read_only=True, data_only=True)
sheets = sys.argv[2].split(',')
result = {}
for name in sheets:
    if name not in wb.sheetnames:
        result[name] = {"status": "missing", "unstamped": []}
        continue
    ws = wb[name]
    # 找「客户核验」列：遍历首行找包含"核验"或"审定"的列
    header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), None)
    stamp_col = None
    if header_row:
        for i, cell in enumerate(header_row):
            if cell and ('核验' in str(cell) or '审定' in str(cell)):
                stamp_col = i
                break
    if stamp_col is None:
        result[name] = {"status": "no_stamp_column", "unstamped": []}
        continue
    unstamped = []
    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        val = row[stamp_col] if stamp_col < len(row) else None
        val_str = str(val).strip() if val else ''
        if val_str == '' or val_str in ('未核验', 'N', 'n', '否', 'NO'):
            unstamped.append(row_idx)
    result[name] = {"status": "ok" if not unstamped else "unstamped", "unstamped": unstamped}
print(json.dumps(result))
`;

const absPath = resolve(xlsxPath);
const py = spawnSync('python', ['-c', pyScript, absPath, sheetsArg], { encoding: 'utf8', timeoutMs: 30000 });

if (py.status === 2 || py.stderr?.includes('openpyxl not installed')) {
  // 回退：尝试 python3
  const py3 = spawnSync('python3', ['-c', pyScript, absPath, sheetsArg], { encoding: 'utf8', timeoutMs: 30000 });
  if (py3.status !== 0) {
    console.error('ERROR 需要 Python + openpyxl 来读取 xlsx。安装：pip install openpyxl');
    process.exit(2);
  }
  var output = py3.stdout;
} else if (py.status !== 0) {
  console.error(`ERROR Python 执行失败：${py.stderr}`);
  process.exit(2);
} else {
  var output = py.stdout;
}

let result;
try {
  result = JSON.parse(output.trim());
} catch (e) {
  console.error(`ERROR 无法解析 Python 输出：${e.message}`);
  process.exit(2);
}

if (result.error) {
  console.error(`ERROR ${result.error}`);
  process.exit(2);
}

let hasUnstamped = false;
for (const [sheet, info] of Object.entries(result)) {
  if (!targetSheets.includes(sheet)) continue;
  if (info.status === 'missing') {
    console.warn(`WARN  sheet ${sheet} 不存在于 xlsx 中`);
    continue;
  }
  if (info.status === 'no_stamp_column') {
    console.warn(`WARN  sheet ${sheet} 没有找到「客户核验」列`);
    continue;
  }
  if (info.status === 'unstamped') {
    hasUnstamped = true;
    console.error(`FAIL  ${sheet}：${info.unstamped.length} 行未核验（行号：${info.unstamped.join(', ')}）`);
  } else {
    console.log(`PASS  ${sheet}：全部已核验`);
  }
}

if (hasUnstamped) {
  console.error('\n核验戳不完整，不许进下一阶段。请补盖核验戳并如实标注补盖日期。');
  process.exit(1);
}

console.log('\n核验戳检查通过。');
