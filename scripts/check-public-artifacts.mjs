#!/usr/bin/env node
/**
 * 对外产物净化检查：技能交付物里不许出现内网地址、本地绝对路径、内部仓库/项目名。
 *
 * 用法：
 *   node scripts/check-public-artifacts.mjs            # 检查默认范围（对外产物：.dsh/skills/all-in-fde）
 *   node scripts/check-public-artifacts.mjs <路径...>   # 指定文件或目录
 *   node scripts/check-public-artifacts.mjs --all       # 顺带扫 .dsh/skills/ 下的全部技能（第三方技能会有误报）
 *
 * 退出码：0 干净；1 有命中。
 *
 * 二进制文件（.xlsx/.docx/.png 等）不扫——压缩格式里搜不到明文。这类产物必须由生成脚本产出，
 * 脚本本身在扫描范围内，等于间接把关。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TEXT_EXT = new Set([
  '.md', '.txt', '.py', '.mjs', '.js', '.cjs', '.json', '.yml', '.yaml',
  '.html', '.css', '.sh', '.ps1', '.csv', '.toml',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'output']);

// PATH-01 误报豁免：markdown 里用反引号写的正则字面量（如 `s:\-`），不是 Windows 路径。
const INLINE_CODE = /`[^`\n]*$/;

const RULES = [
  { id: 'IP-01 内网地址', re: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g },
  // Windows 盘符路径要求第二字符是反斜杠，排除 `s:\-` 这类正则字面量误报；
  // 同时允许前导空格/引号（`" D:\...` 形态在文档里常见）。
  { id: 'PATH-01 本地绝对路径', re: /\b[A-Za-z]:\\(?![\\\-])\S+/g, skipInCode: true },
  { id: 'PATH-02 家目录路径', re: /(?:\/Users\/|\/home\/)[^\s"'`，。；)）]+/g },
  // 敏感词表从本机文件读取（默认 ~/.dsh/all-in-fde/sensitive-patterns.json），
  // 探测器自身不含任何内部取值——此前正则以明文写在本文件里，等于自泄密。
  // 读不到文件时跳过这三类规则并 WARN，不阻断其余检查。
];

let sensitiveLoaded = false;
try {
  const sensPath = process.env.FDE_SENSITIVE_PATTERNS
    || join(homedir(), '.dsh', 'all-in-fde', 'sensitive-patterns.json');
  const sens = JSON.parse(readFileSync(sensPath, 'utf8').replace(/^\uFEFF/, ''));
  for (const r of sens.rules || []) {
    if (!r.id || !r.pattern) continue;
    RULES.push({ id: r.id, re: new RegExp(r.pattern, r.flags || 'gi') });
  }
  sensitiveLoaded = true;
} catch {
  console.warn('WARN 未加载敏感词表（~/.dsh/all-in-fde/sensitive-patterns.json 不存在或损坏）：命名空间/项目名/技能名三类规则本次跳过');
}

const argv = process.argv.slice(2);
const all = argv.includes('--all');
const targets = argv.filter((a) => !a.startsWith('--'));
// --all：扫全部技能；--repo：再顺带 docs/、README、SKILLS.md 与 scripts/（仓库自身的对外文档）
if (argv.includes('--repo')) {
  targets.push(join(repoRoot, 'docs'), join(repoRoot, 'scripts'));
  for (const f of ['README.md', 'SKILLS.md', 'INSTALL.md', 'CONTRIBUTING.md', 'NOTICE.md']) {
    if (existsSync(join(repoRoot, f))) targets.push(join(repoRoot, f));
  }
}
if (all || argv.includes('--repo')) {
  targets.push(join(repoRoot, '.dsh', 'skills'));
}
if (targets.length === 0) {
  targets.push(
    join(repoRoot, '.dsh', 'skills', 'all-in-fde'),
  );
}

function walk(target, acc) {
  if (!existsSync(target)) return acc;
  const st = statSync(target);
  if (st.isFile()) {
    acc.push(target);
    return acc;
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(target, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, acc);
    } else if (entry.isFile() && TEXT_EXT.has(extname(entry.name).toLowerCase())) {
      acc.push(full);
    }
  }
  return acc;
}

const files = [];
for (const t of targets) walk(resolve(t), files);

const hits = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      // PATH-01 豁免：位于行内反引号代码片段里的盘符形态（正则字面量 `s:\-`、`D:\...` 示例）不是真实路径
      if (rule.skipInCode && INLINE_CODE.test(text.slice(0, m.index))) continue;
      const line = text.slice(0, m.index).split('\n').length;
      hits.push({ file: relative(repoRoot, file).split(sep).join('/'), line, rule: rule.id, snippet: m[0].slice(0, 60) });
    }
  }
}

if (hits.length === 0) {
  console.log(`通过：${files.length} 个文本文件，无内网地址、本地路径与内部项目名`);
  process.exit(0);
}

for (const h of hits) {
  console.error(`ERROR ${h.file}:${h.line}  [${h.rule}]  ${h.snippet}`);
}
console.error(`\n失败：${hits.length} 处命中，共扫 ${files.length} 个文件`);
console.error('技能产物必须与内网、本机路径、具体项目无关；命中项改写成通用描述。');
process.exit(1);
