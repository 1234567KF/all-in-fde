#!/usr/bin/env node
/**
 * 生成 skills/skills.json：从各技能的 META.json 汇总版本、许可、上游、文件数和内容指纹。
 *
 * 用法：
 *   node scripts/sync-index.mjs          重写 skills/skills.json
 *   node scripts/sync-index.mjs --check  只比对，不一致时退出码 1
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(repoRoot, 'skills');
const indexPath = join(skillsDir, 'skills.json');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'output', 'uploads']);
const checkOnly = process.argv.includes('--check');

function collectFiles(dir, list = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectFiles(join(dir, entry.name), list);
    } else if (entry.isFile()) {
      list.push(join(dir, entry.name));
    }
  }
  return list;
}

function fingerprint(dir) {
  const files = collectFiles(dir).sort((a, b) => (a < b ? -1 : 1));
  let bytes = 0;
  const hashes = [];
  for (const file of files) {
    const buf = readFileSync(file);
    bytes += buf.length;
    const rel = relative(dir, file).split(sep).join('/');
    hashes.push(`${rel}\0${createHash('sha256').update(buf).digest('hex')}`);
  }
  const sha256 = createHash('sha256').update(hashes.join('\n')).digest('hex');
  return { files: files.length, bytes, sha256 };
}

const skills = [];
for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
  const dir = join(skillsDir, entry.name);
  const metaPath = join(dir, 'META.json');
  if (!existsSync(metaPath)) {
    console.warn(`跳过 ${entry.name}：没有 META.json`);
    continue;
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const fp = fingerprint(dir);
  skills.push({
    name: meta.name || entry.name,
    version: meta.version,
    license: meta.license,
    redistributable: meta.redistributable === true,
    description: meta.description || '',
    entry: meta.entry || 'SKILL.md',
    upstream: meta.upstream || null,
    files: fp.files,
    bytes: fp.bytes,
    sha256: fp.sha256,
  });
}

skills.sort((a, b) => (a.name < b.name ? -1 : 1));

const totalBytes = skills.reduce((sum, s) => sum + s.bytes, 0);
const payload = {
  schemaVersion: 1,
  totalSkills: skills.length,
  totalFiles: skills.reduce((sum, s) => sum + s.files, 0),
  totalBytes,
  skills,
};
const text = `${JSON.stringify(payload, null, 2)}\n`;

if (checkOnly) {
  const current = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  if (current !== text) {
    console.error('skills.json 与当前技能目录不一致，运行 node scripts/sync-index.mjs 重新生成');
    process.exit(1);
  }
  console.log('skills.json 已是最新');
  process.exit(0);
}

writeFileSync(indexPath, text, 'utf8');
console.log(`已写入 skills/skills.json：${skills.length} 个技能，${payload.totalFiles} 个文件，${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
for (const s of skills) {
  console.log(`  ${s.name.padEnd(18)} ${String(s.version).padEnd(10)} ${s.license.padEnd(12)} ${(s.bytes / 1024 / 1024).toFixed(1)} MB`);
}
