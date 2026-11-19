#!/usr/bin/env node
/**
 * squeeze — 只压缩日志/JSON，原文落盘可 retrieve；拒绝代码/文档/交付物。
 * 用法：
 *   node squeeze.mjs app.log --type log --level medium --out app.squeezed.log --json
 *   node squeeze.mjs data.json --type json --out data.squeezed.json
 *   node squeeze.mjs retrieve <id>
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { dshCostDataDir } from './lib/dsh-cost.mjs';
import { ensureDir, parseCli, printJson, readText, stripBom, writeText } from './lib/common.mjs';

const LEVELS = {
  light: { maxLines: 200, maxLine: 800, jsonDepth: 6, arraySample: 8, stringLimit: 300 },
  medium: { maxLines: 120, maxLine: 400, jsonDepth: 4, arraySample: 5, stringLimit: 160 },
  aggressive: { maxLines: 60, maxLine: 200, jsonDepth: 2, arraySample: 3, stringLimit: 80 },
};
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.cs', '.c', '.cpp', '.h', '.hpp', '.php', '.rb', '.swift', '.kt', '.scala', '.sh', '.ps1', '.sql']);
const DOC_EXT = new Set(['.md', '.docx', '.doc', '.pdf', '.pptx', '.ppt', '.xlsx', '.xls']);
const KEEP_FULL_KEYS = new Set(['error', 'message', 'stack', 'status', 'code', 'detail', 'reason']);

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\]8;;.*?\x1b\\/g, '');
}

export function assertSafe({ file, force = false }) {
  if (!file) return;
  const ext = extname(file).toLowerCase();
  if (CODE_EXT.has(ext)) {
    throw new Error(`拒绝压缩 ${ext} 文件：源代码不允许有损压缩。请用 read 的 lines/signatures 模式，或显式 --force。`);
  }
  if (DOC_EXT.has(ext)) {
    throw new Error(`拒绝压缩 ${ext} 文件：文档正文/交付物不允许有损压缩。请分段读取，或显式 --force。`);
  }
  if (!force && ext && ext !== '.log' && ext !== '.json' && ext !== '.txt' && ext !== '.out') {
    throw new Error(`未识别的扩展名 ${ext}；只允许 .log/.json/.txt，或显式 --force。`);
  }
}

export function detectType({ file, explicit, text }) {
  if (explicit === 'log' || explicit === 'json') return explicit;
  const ext = file ? extname(file).toLowerCase() : '';
  if (ext === '.json') return 'json';
  if (ext === '.log') return 'log';
  const trimmed = String(text || '').trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {}
  }
  if (/^\s*(\d{4}-\d{2}-\d{2}[T ]|ERROR\b|FAIL\b|WARN\b|Traceback\b|panic:)/m.test(trimmed)) return 'log';
  return 'text';
}

export function compressLog(text, levelName = 'medium') {
  const cfg = LEVELS[levelName] || LEVELS.medium;
  const original = stripAnsi(String(text)).replace(/\r\n/g, '\n');
  const rawLines = original.split('\n').map((line) => line.replace(/\s+$/, ''));
  if (Buffer.byteLength(original, 'utf8') < 400) {
    return {
      text: original,
      stats: {
        type: 'log',
        level: levelName,
        origLines: rawLines.length,
        outLines: rawLines.length,
        origBytes: Buffer.byteLength(text, 'utf8'),
        outBytes: Buffer.byteLength(original, 'utf8'),
        skipped: 'too-small',
      },
    };
  }

  const compact = [];
  let blank = 0;
  let previous = null;
  let repeats = 0;
  const flushRepeats = () => {
    if (repeats > 0) compact.push(`  … 重复 ${repeats + 1} 行`);
    repeats = 0;
  };
  for (const line of rawLines) {
    if (line === '') {
      blank += 1;
      if (blank <= 1) compact.push('');
      continue;
    }
    blank = 0;
    if (line === previous) {
      repeats += 1;
      continue;
    }
    flushRepeats();
    compact.push(line);
    previous = line;
  }
  flushRepeats();

  const isStack = (line) => /^\s+at\s|^\s+from\s|^\s*File "/.test(line) || /^\s*\.{3}\s*\d+\s*more/.test(line);
  const folded = [];
  let stack = [];
  const flushStack = () => {
    if (!stack.length) return;
    if (stack.length <= 3) folded.push(...stack);
    else folded.push(stack[0], `  … ${stack.length - 2} 帧省略`, stack[stack.length - 1]);
    stack = [];
  };
  for (const line of compact) {
    if (isStack(line)) stack.push(line);
    else {
      flushStack();
      folded.push(line);
    }
  }
  flushStack();

  const isError = (line) => /\b(error|failed|failure|exception|fatal|panic|assert|denied|timeout|refused|cannot|not found)\b/i.test(line);
  const trimmedLines = folded.map((line) =>
    line.length > cfg.maxLine ? `${line.slice(0, cfg.maxLine)} …[+${line.length - cfg.maxLine} chars]` : line,
  );

  let selected = trimmedLines;
  if (trimmedLines.length > cfg.maxLines) {
    const headCount = Math.max(5, Math.floor(cfg.maxLines * 0.3));
    const tailCount = Math.max(5, Math.floor(cfg.maxLines * 0.5));
    const keep = new Set();
    for (let i = 0; i < headCount; i += 1) keep.add(i);
    for (let i = trimmedLines.length - tailCount; i < trimmedLines.length; i += 1) keep.add(i);
    const errorIndexes = [];
    trimmedLines.forEach((line, index) => {
      if (isError(line) && errorIndexes.length < 20) errorIndexes.push(index);
    });
    for (const index of errorIndexes) keep.add(index);
    const ordered = [...keep].sort((a, b) => a - b);
    const output = [];
    for (let i = 0; i < ordered.length; i += 1) {
      const index = ordered[i];
      if (i > 0 && index !== ordered[i - 1] + 1) {
        output.push(`… [省略 ${index - ordered[i - 1] - 1} 行]`);
      }
      output.push(trimmedLines[index]);
    }
    selected = output;
  }

  const header = `[squeeze log/${levelName}: 原始 ${rawLines.length} 行 → 保留 ${selected.length} 行]`;
  const result = `${header}\n${selected.join('\n')}`;
  return {
    text: result,
    stats: {
      type: 'log',
      level: levelName,
      origLines: rawLines.length,
      outLines: selected.length,
      origBytes: Buffer.byteLength(text, 'utf8'),
      outBytes: Buffer.byteLength(result, 'utf8'),
    },
  };
}

export function compressJson(text, levelName = 'medium') {
  const cfg = LEVELS[levelName] || LEVELS.medium;
  let parsed;
  try {
    parsed = JSON.parse(stripBom(String(text)));
  } catch (error) {
    throw new Error(`JSON 解析失败：${error.message}`);
  }

  const summarize = (value, depth, key) => {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'string' && !KEEP_FULL_KEYS.has(key) && value.length > cfg.stringLimit) {
        return `${value.slice(0, cfg.stringLimit)} …[+${value.length - cfg.stringLimit} chars]`;
      }
      return value;
    }
    if (depth >= cfg.jsonDepth) {
      if (Array.isArray(value)) return `[Array(${value.length})]`;
      return `[Object(${Object.keys(value).length} keys)]`;
    }
    if (Array.isArray(value)) {
      if (value.length > cfg.arraySample) {
        const sample = value.slice(0, cfg.arraySample).map((item) => summarize(item, depth + 1, key));
        return [...sample, `…(+${value.length - cfg.arraySample} more)`];
      }
      return value.map((item) => summarize(item, depth + 1, key));
    }
    const keys = Object.keys(value);
    const output = {};
    for (const itemKey of keys.slice(0, 15)) output[itemKey] = summarize(value[itemKey], depth + 1, itemKey);
    if (keys.length > 15) output._omitted_keys = keys.length - 15;
    return output;
  };

  const compressed = summarize(parsed, 0, '');
  const result = JSON.stringify(compressed, null, 2);
  return {
    text: result,
    stats: {
      type: 'json',
      level: levelName,
      origBytes: Buffer.byteLength(text, 'utf8'),
      outBytes: Buffer.byteLength(result, 'utf8'),
      jsonDepth: cfg.jsonDepth,
      arraySample: cfg.arraySample,
    },
  };
}

function storeRoot() {
  if (process.env.ALL_IN_FDE_SQUEEZE_DIR) return process.env.ALL_IN_FDE_SQUEEZE_DIR;
  if (dshCostDataDir) return join(dshCostDataDir, 'squeeze');
  return join(tmpdir(), 'token-budget-squeeze');
}

export function storeOriginal({ source, original, compressed, type, level }) {
  const root = storeRoot();
  ensureDir(root);
  const hash = createHash('sha256').update(original).digest('hex');
  const id = `${Date.now().toString(36)}-${hash.slice(0, 8)}`;
  const origPath = join(root, `${id}.orig`);
  writeText(origPath, original);
  const record = {
    id,
    ts: new Date().toISOString(),
    source: source ? basename(source) : '(stdin)',
    type,
    level,
    origBytes: Buffer.byteLength(original, 'utf8'),
    outBytes: Buffer.byteLength(compressed, 'utf8'),
    sha256: hash,
    origPath,
  };
  appendFileSync(join(root, 'index.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

function retrieve(id) {
  const indexFile = join(storeRoot(), 'index.jsonl');
  if (!existsSync(indexFile)) throw new Error('没有 squeeze 记录');
  const line = readFileSync(indexFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .reverse()
    .find((item) => {
      try {
        return JSON.parse(item).id === id;
      } catch {
        return false;
      }
    });
  if (!line) throw new Error(`找不到 id：${id}`);
  const record = JSON.parse(line);
  if (!existsSync(record.origPath)) throw new Error(`原文已不存在：${record.origPath}`);
  process.stdout.write(readFileSync(record.origPath, 'utf8'));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'retrieve') {
    const id = argv[1];
    if (!id) {
      console.error('用法：node squeeze.mjs retrieve <id>');
      process.exit(2);
    }
    retrieve(id);
    return;
  }

  const cli = parseCli(argv);
  const file = cli.file || cli._[0];
  const useStdin = Boolean(cli.stdin);
  if (!file && !useStdin) {
    console.error('用法：node squeeze.mjs <日志或JSON> [--type log|json] [--level medium] [--out 文件] [--json]');
    console.error('      node squeeze.mjs --stdin --type log');
    process.exit(2);
  }
  if (file) assertSafe({ file, force: Boolean(cli.force) });

  const original = useStdin ? stripBom(readFileSync(0, 'utf8')) : readText(file);
  const type = detectType({ file, explicit: cli.type, text: original });
  if (type === 'text') {
    throw new Error('识别为普通文本，拒绝压缩（可能改变语义）。只支持 log/json；如确认是日志，用 --type log。');
  }
  const level = LEVELS[cli.level] ? cli.level : 'medium';
  const result = type === 'json' ? compressJson(original, level) : compressLog(original, level);

  let record = null;
  if (!cli['no-store']) record = storeOriginal({ source: file, original, compressed: result.text, type, level });

  if (cli.out) {
    writeText(cli.out, result.text);
    const summary = { ...result.stats, id: record?.id ?? null, out: cli.out, retrieve: record ? `node squeeze.mjs retrieve ${record.id}` : null };
    if (cli.json) printJson(summary);
    else console.log(`已写入 ${cli.out}${record ? `；原文 id=${record.id}` : ''}`);
    return;
  }

  process.stdout.write(result.text.endsWith('\n') ? result.text : `${result.text}\n`);
  const ratio = result.stats.origBytes ? 1 - result.stats.outBytes / result.stats.origBytes : 0;
  console.error(`[squeeze] ${type}/${level}: ${result.stats.origBytes} → ${result.stats.outBytes} bytes（省 ${(ratio * 100).toFixed(1)}%）${record ? `；原文 id=${record.id}` : '；未存原文'}`);
}

if (process.argv[1] && basename(process.argv[1]) === 'squeeze.mjs') {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
