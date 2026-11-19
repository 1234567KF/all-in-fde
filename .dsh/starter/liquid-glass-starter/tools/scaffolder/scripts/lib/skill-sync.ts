/**
 * 技能自更新：把**正在运行的这份技能**同步到模板缓存里的版本。
 *
 * 自包含约束：skill 官方安装方式是 `npx giget .../tools/scaffolder`，
 * 只安装 skill 子树，因此本文件不得 import skill 目录之外的任何相对路径。
 *
 * 纯文件操作，不打印、不退出：跳过条件、变更清单与 exit 3 重启协议都由调用方
 * （scaffold.ts）决定，这样本模块可以被单测直接驱动。
 */

import fs from "fs"
import path from "path"

export interface SkillDiff {
  /** 两侧都有但内容不同 */
  changed: string[]
  /** 只在源侧有 */
  added: string[]
  /** 只在目标侧有：上游已删除的孤儿，必须物理删掉而不是留着 */
  removed: string[]
}

/** 相对路径统一 posix：Windows 上 path.relative 返回反斜杠，跨平台比对前必须归一。 */
function collectFiles(root: string, dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(root, abs, out)
    else out.push(path.relative(root, abs).replaceAll("\\", "/"))
  }
}

function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const out: string[] = []
  collectFiles(root, root, out)
  return out.sort()
}

export function diffSkillTrees(
  sourceRoot: string,
  targetRoot: string
): SkillDiff {
  const targetFiles = new Set(listFiles(targetRoot))
  const diff: SkillDiff = { changed: [], added: [], removed: [] }

  for (const rel of listFiles(sourceRoot)) {
    if (!targetFiles.has(rel)) {
      diff.added.push(rel)
      continue
    }
    targetFiles.delete(rel)
    const same = fs
      .readFileSync(path.join(sourceRoot, rel))
      .equals(fs.readFileSync(path.join(targetRoot, rel)))
    if (!same) diff.changed.push(rel)
  }

  diff.removed = [...targetFiles].sort()
  return diff
}

export function isEmptyDiff(diff: SkillDiff): boolean {
  return (
    diff.changed.length === 0 &&
    diff.added.length === 0 &&
    diff.removed.length === 0
  )
}

/** 删掉孤儿文件后留下的空目录（自底向上），技能根自身始终保留。 */
function pruneEmptyDirs(root: string): void {
  const walk = (dir: string): boolean => {
    let empty = true
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (walk(abs)) fs.rmdirSync(abs)
        else empty = false
      } else {
        empty = false
      }
    }
    return empty
  }
  walk(root)
}

export function syncSkillTree(
  sourceRoot: string,
  targetRoot: string
): SkillDiff {
  const diff = diffSkillTrees(sourceRoot, targetRoot)

  for (const rel of [...diff.changed, ...diff.added]) {
    const dest = path.join(targetRoot, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(sourceRoot, rel), dest)
  }
  for (const rel of diff.removed) {
    fs.rmSync(path.join(targetRoot, rel), { force: true })
  }
  pruneEmptyDirs(targetRoot)

  return diff
}