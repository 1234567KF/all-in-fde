#!/usr/bin/env node
/**
 * 对外产物净化检查：技能交付物里不许出现内网地址、本地绝对路径、内部仓库/项目名。
 *
 * 用法：
 *   node scripts/check-public-artifacts.mjs            # 检查默认范围（对外产物：skills/all-in-fde）
 *   node scripts/check-public-artifacts.mjs <路径...>   # 指定文件或目录
 *   node scripts/check-public-artifacts.mjs --all       # 顺带扫 skills/ 下的全部技能（第三方技能会有误报）
 *
 * 退出码：0 干净；1 有命中。
 *
 * 二进制文件（.xlsx/.docx/.png 等）不扫——压缩格式里搜不到明文。这类产物必须由生成脚本产出，
 * 脚本本身在扫描范围内，等于间接把关。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TEXT_EXT = new Set([
  '.md', '.txt', '.py', '.mjs', '.js', '.cjs', '.json', '.yml', '.yaml',
  '.html', '.css', '.sh', '.ps1', '.csv', '.toml',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'output']);

const RULES = [
  { id: 'IP-01 内网地址', re: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g },
  { id: 'PATH-01 本地绝对路径', re: /\b[A-Za-z]:\\[^\s"'`，。；)）]+/g },
  { id: 'PATH-02 家目录路径', re: /(?:\/Users\/|\/home\/)[^\s"'`，。；)）]+/g },
  { id: 'REPO-01 内部命名空间', re: /\b(?:wecode|sanlunxuanpin|slxp)\b/gi },
  { id: 'PROJ-01 内部项目名', re: /三轮选品|liquid-glass|all-in-mvp|kf-mvp-|\bqoder\b/gi },
  { id: 'SKILL-01 内部技能名', re: /wecode-project-scaffolder|business-feature-builder|skill-design-expert/gi },
  { id: 'CMD-01 内部命令名', re: /\bgen:module\b|\badd:web\b|\bremove:module\b/g },
];

const argv = process.argv.slice(2);
const all = argv.includes('--all');
const targets = argv.filter((a) => !a.startsWith('--'));
if (all) {
  targets.push(join(repoRoot, 'skills'));
}
if (targets.length === 0) {
  targets.push(
    join(repoRoot, 'skills', 'all-in-fde'),
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
