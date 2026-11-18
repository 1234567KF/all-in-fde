#!/usr/bin/env node
/**
 * 校验 skills/ 下的技能目录是否满足 docs/skill-spec.md 与 docs/versioning.md。
 *
 * 用法：node scripts/check-skills.mjs
 * 退出码：0 通过（可能有警告），1 有错误。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(repoRoot, 'skills');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'output', 'uploads']);
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const REQUIRED = ['SKILL.md', 'META.json', 'PROVENANCE.md', 'CHANGELOG.md'];
const META_FIELDS = ['name', 'version', 'entry', 'description', 'license', 'redistributable'];

const errors = [];
const warnings = [];
const err = (skill, msg) => errors.push(`[${skill}] ${msg}`);
const warn = (skill, msg) => warnings.push(`[${skill}] ${msg}`);

function readFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = {};
  let currentKey = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indented = /^\s+/.test(rawLine);
    const kv = rawLine.match(/^\s*([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (indented && currentKey) {
      const nested = fm[currentKey];
      if (nested && typeof nested === 'object') {
        nested[key] = value.replace(/^["']|["']$/g, '').trim();
      }
      continue;
    }
    currentKey = key;
    const clean = value.replace(/^["']|["']$/g, '').trim();
    fm[key] = clean === '' ? {} : clean;
  }
  return fm;
}

function firstChangelogVersion(text) {
  const match = text.match(/^##\s*\[([^\]]+)\]/m);
  return match ? match[1].trim() : null;
}

function walk(dir, acc = { files: 0, bytes: 0 }) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      acc.files += 1;
      acc.bytes += statSync(join(dir, entry.name)).size;
    }
  }
  return acc;
}

const entries = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
  .map((e) => e.name)
  .sort();

if (entries.length === 0) {
  console.error('skills/ 下没有技能目录');
  process.exit(1);
}

const seen = new Map();
const index = {};

for (const skill of entries) {
  const dir = join(skillsDir, skill);
  for (const file of REQUIRED) {
    if (!existsSync(join(dir, file))) err(skill, `缺少必需文件 ${file}`);
  }

  const metaPath = join(dir, 'META.json');
  if (!existsSync(metaPath)) continue;

  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (e) {
    err(skill, `META.json 不是合法 JSON：${e.message}`);
    continue;
  }

  for (const field of META_FIELDS) {
    if (meta[field] === undefined || meta[field] === null || meta[field] === '') {
      err(skill, `META.json 缺少字段 ${field}`);
    }
  }

  if (meta.name && meta.name !== skill) {
    err(skill, `META.json 的 name（${meta.name}）与目录名不一致`);
  }
  if (seen.has(meta.name)) {
    err(skill, `技能名 ${meta.name} 与 ${seen.get(meta.name)} 重复`);
  }
  seen.set(meta.name, skill);

  if (meta.version && !SEMVER.test(meta.version)) {
    err(skill, `版本号 ${meta.version} 不是语义化版本`);
  }

  if (meta.redistributable === true && (!meta.license || meta.license === 'UNLICENSED')) {
    err(skill, '标记为可分发，但没有许可证');
  }
  if (meta.license === 'UNLICENSED') {
    warn(skill, '许可证未声明，公开仓库前必须处理（见 NOTICE.md）');
  }
  if (existsSync(join(dir, 'LICENSE')) === false && meta.license && meta.license !== 'UNLICENSED') {
    warn(skill, `META.json 声明 ${meta.license}，但目录内没有 LICENSE 文件`);
  }

  const skillMdPath = join(dir, 'SKILL.md');
  if (existsSync(skillMdPath)) {
    const text = readFileSync(skillMdPath, 'utf8');
    const fm = readFrontmatter(text);
    if (!fm) {
      err(skill, 'SKILL.md 缺少 frontmatter');
    } else {
      if (!fm.name) err(skill, 'SKILL.md frontmatter 缺少 name');
      if (!fm.description) err(skill, 'SKILL.md frontmatter 缺少 description');
      if (fm.name && fm.name !== skill) {
        warn(skill, `SKILL.md 的 name 是 ${fm.name}，与目录名不一致（需在 PROVENANCE.md 说明）`);
      }
      const fmVersion = fm.metadata && typeof fm.metadata === 'object' ? fm.metadata.version : null;
      if (fmVersion && meta.version && fmVersion !== meta.version) {
        err(skill, `SKILL.md 的 metadata.version（${fmVersion}）与 META.json（${meta.version}）不一致`);
      }
    }
  }

  const changelogPath = join(dir, 'CHANGELOG.md');
  if (existsSync(changelogPath)) {
    const top = firstChangelogVersion(readFileSync(changelogPath, 'utf8'));
    if (!top) {
      err(skill, 'CHANGELOG.md 顶部没有 ## [版本号] 记录');
    } else if (meta.version && top !== meta.version) {
      err(skill, `CHANGELOG.md 顶部版本（${top}）与 META.json（${meta.version}）不一致`);
    }
  }

  const size = walk(dir);
  if (size.bytes > 50 * 1024 * 1024) {
    warn(skill, `目录体积 ${(size.bytes / 1024 / 1024).toFixed(1)} MB，超过 50 MB，确认是否必要`);
  }
  index[skill] = { version: meta.version, license: meta.license, redistributable: meta.redistributable };
}

const indexPath = join(skillsDir, 'skills.json');
if (existsSync(indexPath)) {
  try {
    const json = JSON.parse(readFileSync(indexPath, 'utf8'));
    const listed = json.skills || [];
    const listedNames = new Set(listed.map((s) => s.name));
    for (const skill of Object.keys(index)) {
      const item = listed.find((s) => s.name === skill);
      if (!item) {
        err(skill, 'skills.json 缺少该技能，运行 node scripts/sync-index.mjs');
      } else if (item.version !== index[skill].version) {
        err(skill, `skills.json 版本（${item.version}）与 META.json（${index[skill].version}）不一致`);
      }
    }
    for (const item of listed) {
      if (!index[item.name]) {
        err(item.name, 'skills.json 里有该技能，但目录不存在');
      }
    }
    if (listedNames.size !== listed.length) {
      warn('skills.json', '存在重复条目');
    }
  } catch (e) {
    err('skills.json', `解析失败：${e.message}`);
  }
} else {
  warn('skills.json', '尚未生成，运行 node scripts/sync-index.mjs');
}

for (const skill of entries) {
  const skillMd = join(skillsDir, skill, 'SKILL.md');
  if (existsSync(skillMd) && readFileSync(skillMd, 'utf8').trim() === '') {
    err(skill, 'SKILL.md 为空');
  }
}

for (const line of warnings) console.warn(`WARN  ${line}`);
for (const line of errors) console.error(`ERROR ${line}`);

const summary = `${entries.length} 个技能，${errors.length} 个错误，${warnings.length} 个警告`;
if (errors.length > 0) {
  console.error(`\n失败：${summary}`);
  process.exit(1);
}
console.log(`通过：${summary}`);
