/**
 * `LONG_FILE_RATCHET` 条目剪枝与新增（scaffold / `remove:module` / `remove:web` / `add:web` 共用）。
 *
 * **唯一实现**：scaffold 把本文件跟 `arch-check.ts` 一起 stamp 进目标项目，剪枝时动态
 * import 目标项目这一份，技能内不再 vendored 副本（两份实现是一条平行维护轴）。
 *
 * 解析目标项目 `scripts/arch-check.ts` 里的 `LONG_FILE_RATCHET` 字面量，删掉指向
 * 「目标项目里已不存在文件」的条目，避免生成项目跑 `bun run arch:check` 时报
 * `overlong-ratchet-missing`。
 *
 * 为什么需要：`LONG_FILE_RATCHET` 的基线按模板 demo 页路径写死；scaffold 的
 * `--clean-demo` 会删除这些 demo 页，`--include-ci` / `--mode add-ci` 又可能把模板
 * arch-check.ts 覆盖回目标项目；`remove:module` 卸载模块后也可能让条目失效。
 * `add:web` 克隆默认端时反过来需要**新增**条目——克隆来的超长页在新端路径下没有
 * 基线，不补就立刻报 `file-too-long`。
 *
 * 依赖 arch-check.ts 的两个固定形态（改动需同步本 helper）：
 *   1. `const LONG_FILE_RATCHET` 字面量后紧跟对象；
 *   2. 条目为单行 `"<相对路径>": <行数>,`。
 * 注意：`LONG_FILE_RATCHET` 数据本身仍内联在 `scripts/arch-check.ts`——
 * add-ci 模式只 stamp arch-check.ts，不能给它引入新的 import 依赖。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

/**
 * 剪掉 arch-check.ts 中指向「目标项目里已不存在文件」的 450 行棘轮条目。
 *
 * @param root 目标项目根目录（需含 `scripts/arch-check.ts`；不存在时静默返回）
 */
export function pruneMissingLongFileRatchet(root: string): void {
  const archCheckPath = path.join(root, "scripts", "arch-check.ts")
  if (!existsSync(archCheckPath)) return

  const source = readFileSync(archCheckPath, "utf8")
  const located = locateRatchetBlock(source)
  if (!located) return
  const { openIndex, closeIndex } = located

  const block = source.slice(openIndex, closeIndex + 1)
  let pruned = 0
  const prunedBlock = block.replace(
    /^[ \t]*"([^"]+)"[ \t]*:[ \t]*\d+,[ \t]*\r?\n/gm,
    (line, relPath: string) => {
      if (existsSync(path.join(root, relPath))) return line
      pruned += 1
      return ""
    }
  )
  if (pruned === 0) return

  writeFileSync(
    archCheckPath,
    source.slice(0, openIndex) +
      prunedBlock.replace(/^\{\s*\}$/, "{}") +
      source.slice(closeIndex + 1)
  )
  // 进度诊断走 stderr：add:web --json 的 stdout 只放结果，供脚手架解析。
  console.error(
    `   Pruned ${pruned} stale LONG_FILE_RATCHET entr${pruned === 1 ? "y" : "ies"} from scripts/arch-check.ts`
  )
}

/** 定位 LONG_FILE_RATCHET 对象字面量的起止下标（含花括号）；形态不符时返回 null。 */
function locateRatchetBlock(
  source: string
): { openIndex: number; closeIndex: number } | null {
  const markerIndex = source.indexOf("const LONG_FILE_RATCHET")
  const openIndex = markerIndex >= 0 ? source.indexOf("{", markerIndex) : -1
  // 首个 { 之后的 } 即对象闭合（棘轮键名与数值都不含 }），比匹配换行更耐格式化。
  const closeIndex = openIndex >= 0 ? source.indexOf("}", openIndex) : -1
  if (openIndex < 0 || closeIndex <= openIndex) return null
  return { openIndex, closeIndex }
}

const ENTRY_LINE_RE = /^([ \t]*"([^"]+)"[ \t]*:[ \t]*)(\d+)(,[ \t]*)$/

/** 行数口径同 `wc -l`（与 arch-check.ts 的 countLines 一致）：末尾换行不额外计行。 */
export function countRatchetLines(content: string): number {
  if (content === "") return 0
  const lines = content.split("\n")
  return content.endsWith("\n") ? lines.length - 1 : lines.length
}

/**
 * 读出当前 `LONG_FILE_RATCHET` 条目（posix 相对路径 → 基线行数）。
 * `add:web` 克隆默认端时据此为新端补基线；文件或常量不存在时返回空对象。
 */
export function readLongFileRatchetEntries(root: string): Record<string, number> {
  const archCheckPath = path.join(root, "scripts", "arch-check.ts")
  if (!existsSync(archCheckPath)) return {}
  const source = readFileSync(archCheckPath, "utf8")
  const located = locateRatchetBlock(source)
  if (!located) return {}
  const block = source.slice(located.openIndex, located.closeIndex + 1)
  const entries: Record<string, number> = {}
  for (const line of block.split("\n")) {
    const matched = line.match(ENTRY_LINE_RE)
    if (matched) entries[matched[2]] = Number(matched[3])
  }
  return entries
}

/**
 * 新增 / 下调 `LONG_FILE_RATCHET` 条目（`add:web` 克隆默认端时用）。
 *
 * 棘轮语义「只许减不许增」：已存在的 key 取**较小值**，不会把基线抬高。
 * 新 key 按单行 `  "<相对路径>": <行数>,` 追加到对象闭合前；prune 折叠出的 `{}`
 * 形态会被展开成多行。
 *
 * @param root 目标项目根目录（需含 `scripts/arch-check.ts`；不存在时静默返回 0）
 * @param entries 相对路径 → 行数；调用方负责把路径归一成 posix
 * @returns 实际发生变化的条目数（新增 + 下调）
 */
export function upsertLongFileRatchetEntries(
  root: string,
  entries: Record<string, number>
): number {
  const archCheckPath = path.join(root, "scripts", "arch-check.ts")
  if (!existsSync(archCheckPath)) return 0

  const source = readFileSync(archCheckPath, "utf8")
  const located = locateRatchetBlock(source)
  if (!located) return 0
  const { openIndex, closeIndex } = located

  const lines = source.slice(openIndex, closeIndex + 1).split("\n")
  const present = new Set<string>()
  let changed = 0
  let indent = "  "

  for (let i = 0; i < lines.length; i++) {
    const matched = lines[i].match(ENTRY_LINE_RE)
    if (!matched) continue
    present.add(matched[2])
    indent = matched[1].slice(0, matched[1].indexOf('"'))
    const want = entries[matched[2]]
    if (want !== undefined && want < Number(matched[3])) {
      lines[i] = `${matched[1]}${want}${matched[4]}`
      changed += 1
    }
  }

  const additions = Object.entries(entries)
    .filter(([relPath]) => !present.has(relPath))
    .map(([relPath, count]) => `${indent}"${relPath}": ${count},`)
  changed += additions.length

  if (changed === 0) return 0

  const closeLine = lines.findIndex((line) => line.trim() === "}")
  let nextBlock: string
  if (closeLine >= 0) {
    lines.splice(closeLine, 0, ...additions)
    nextBlock = lines.join("\n")
  } else {
    // prune 把空对象折叠成了 "{}"，没有独立的闭合行，需要展开
    nextBlock = `{\n${additions.join("\n")}\n}`
  }

  writeFileSync(
    archCheckPath,
    source.slice(0, openIndex) + nextBlock + source.slice(closeIndex + 1)
  )
  console.error(
    `   Upserted ${changed} LONG_FILE_RATCHET entr${changed === 1 ? "y" : "ies"} in scripts/arch-check.ts`
  )
  return changed
}
