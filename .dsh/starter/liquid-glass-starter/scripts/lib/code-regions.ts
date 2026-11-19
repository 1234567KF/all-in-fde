// 代码区块（region）解析引擎 —— Tier 1 特性剥离与 Tier 2 模块卸载共用的基础原语。
//
// 设计依据：模板仓库设计书 §3.2 + 实施计划 §2/§3（两者都不随脚手架分发）。
//
// 支持 4 种宿主语法的整行标记（标记行独占一行，不参与语言语义）：
//   - TS / TSX 顶层语句： `// #region <id>`        / `// #endregion <id>`
//   - JSX 子节点：        `{/* #region <id> */}`    / `{/* #endregion <id> */}`
//   - Markdown：          `<!-- region:<id> -->`   / `<!-- endregion:<id> -->`
//   - dotenv / shell：    `# region:<id>`          / `# endregion:<id>`
//
// 规则：
//   1. 严格配对、快速失败：不配对 / 闭合 id 不匹配 / 同 id 自嵌套 → RegionParseError（带 1-based 行号），
//      绝不回退到启发式猜测；
//   2. 允许不同 id 嵌套（外层 feature:demo、内层 feature:notification），剥离任一层内层内容都会消失；
//   3. 一个文件允许多个同 id 区块（顺序出现，不得互相嵌套）。
//
// 零依赖纯函数模块，模板与生成项目都保留（`remove:module` 依赖它）。
//

/** 一条区块记录；行号均为 1-based，`depth` 从 0 开始（最外层为 0）。 */
export interface RegionInfo {
  id: string
  startLine: number
  endLine: number
  depth: number
}

export type RegionParseErrorCode =
  "unclosed" | "unexpected-close" | "mismatched-close" | "self-nested"

/** 解析失败：`line` 为 1-based 行号，`message` 已包含行号与具体原因。 */
export class RegionParseError extends Error {
  readonly line: number
  readonly code: RegionParseErrorCode

  constructor(message: string, line: number, code: RegionParseErrorCode) {
    super(message)
    this.name = "RegionParseError"
    this.line = line
    this.code = code
  }
}

type MarkerKind = "open" | "close"

interface Marker {
  kind: MarkerKind
  id: string
}

/** 容器区块（gen:module 首次生成 Business 菜单分组时的外层包裹）。 */
export const GROUP_REGION_PREFIX = "gen:group:"
/** 业务模块区块；容器内不再含任何此类区块时容器整体收起。 */
export const MODULE_REGION_PREFIX = "module:"

/**
 * 整行识别开/闭标记。允许两侧空白（JSX/markdown 中的缩进、行尾空格、CRLF 的 `\r`），
 * 但标记必须独占一行：行内其他字符一律视为普通代码。
 */
function matchMarker(line: string): Marker | null {
  const text = line.trim()
  if (text === "") return null

  // Markdown：<!-- region:id --> / <!-- endregion:id -->
  let matched = /^<!--\s*region:(\S+)\s*-->$/.exec(text)
  if (matched) return { kind: "open", id: matched[1] }
  matched = /^<!--\s*endregion:(\S+)\s*-->$/.exec(text)
  if (matched) return { kind: "close", id: matched[1] }

  // JSX：{/* #region id */} / {/* #endregion id */}
  matched = /^\{\s*\/\*\s*#region\s+(\S+)\s*\*\/\s*\}$/.exec(text)
  if (matched) return { kind: "open", id: matched[1] }
  matched = /^\{\s*\/\*\s*#endregion\s+(\S+)\s*\*\/\s*\}$/.exec(text)
  if (matched) return { kind: "close", id: matched[1] }

  // TS / JS：// #region id / // #endregion id（`//#region` 同样识别）
  matched = /^\/\/\s*#region\s+(\S+)$/.exec(text)
  if (matched) return { kind: "open", id: matched[1] }
  matched = /^\/\/\s*#endregion\s+(\S+)$/.exec(text)
  if (matched) return { kind: "close", id: matched[1] }

  // dotenv / shell：# region:id / # endregion:id
  matched = /^#\s*region:(\S+)$/.exec(text)
  if (matched) return { kind: "open", id: matched[1] }
  matched = /^#\s*endregion:(\S+)$/.exec(text)
  if (matched) return { kind: "close", id: matched[1] }

  return null
}

/**
 * 严格解析源码中的全部区块。
 *
 * @throws {RegionParseError} 开/闭不配对、闭合 id 不匹配、同 id 自嵌套
 */
export function parseRegions(source: string): RegionInfo[] {
  const lines = source.split("\n")
  const stack: Array<{ id: string; startLine: number }> = []
  const regions: RegionInfo[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const marker = matchMarker(lines[index])
    if (!marker) continue
    const lineNo = index + 1

    if (marker.kind === "open") {
      const selfNested = stack.find((open) => open.id === marker.id)
      if (selfNested) {
        throw new RegionParseError(
          `第 ${lineNo} 行：区块 "${marker.id}" 在自身内部再次开启（同 id 自嵌套非法，上一处开启于第 ${selfNested.startLine} 行）`,
          lineNo,
          "self-nested"
        )
      }
      stack.push({ id: marker.id, startLine: lineNo })
      continue
    }

    const top = stack[stack.length - 1]
    if (!top) {
      throw new RegionParseError(
        `第 ${lineNo} 行：关闭标记 "${marker.id}" 没有对应的开始标记`,
        lineNo,
        "unexpected-close"
      )
    }
    if (top.id !== marker.id) {
      throw new RegionParseError(
        `第 ${lineNo} 行：关闭标记 "${marker.id}" 与第 ${top.startLine} 行开始的区块 "${top.id}" 不配对`,
        lineNo,
        "mismatched-close"
      )
    }
    stack.pop()
    regions.push({
      id: top.id,
      startLine: top.startLine,
      endLine: lineNo,
      depth: stack.length,
    })
  }

  const unclosed = stack[0]
  if (unclosed) {
    throw new RegionParseError(
      `第 ${unclosed.startLine} 行：区块 "${unclosed.id}" 缺少关闭标记`,
      unclosed.startLine,
      "unclosed"
    )
  }

  // 不同 id 嵌套时关闭顺序与开启顺序相反，按起始行恢复「出现顺序」。
  regions.sort((left, right) => left.startLine - right.startLine)
  return regions
}

/** 文件内全部区块 id（含重复；按出现顺序）。解析失败抛 RegionParseError。 */
export function listRegions(source: string): string[] {
  return parseRegions(source).map((region) => region.id)
}

/** 把 1-based 的闭区间 [startLine, endLine] 标记为待删除行。 */
function markLineRange(
  removedLines: Set<number>,
  startLine: number,
  endLine: number
): void {
  for (let line = startLine; line <= endLine; line += 1) removedLines.add(line)
}

/** 删除指定行（1-based），其余行（含行尾 `\r` 等原始字符）逐字节保留。 */
function removeLines(source: string, removedLines: Set<number>): string {
  return source
    .split("\n")
    .filter((_, index) => !removedLines.has(index + 1))
    .join("\n")
}

/**
 * 删除区块后的空白规范化（`stripRegions` / `stripEmptyGroupRegions` 共用）：
 *   1. 连续 `\n{3,}` 收敛为 `\n\n`；
 *   2. 原文件以 `\n` 结尾 → 结果恰好一个结尾换行；否则结果不带结尾换行；结果为空返回 `""`。
 * 目的：让「插入区块 → 剥离区块」逐字节往返（gen:module ⇄ remove:module）。
 */
function normalizeAfterDeletion(source: string, result: string): string {
  // 按文件主 EOL 规范化：CRLF 文件的空行是 "\r\n\r\n\r\n"，只处理 "\n" 会漏收敛，
  // 末尾还会残留孤立的 "\r"。LF 文件行为与旧实现完全一致（8 个注册文件逐字节往返不变）。
  const eol = source.includes("\r\n") ? "\r\n" : "\n"
  const body = result
    .replace(/(?:\r?\n){3,}/g, `${eol}${eol}`)
    .replace(/(?:\r?\n)+$/, "")
    // 删除行后可能残留原 CRLF 的孤立 "\r"（无对应 "\n"）
    .replace(/\r$/, "")
  if (body === "") return ""
  return /(?:\r?\n)$/.test(source) ? `${body}${eol}` : body
}

/**
 * 删除所有 id === target 的区块（含标记行本身），并规范化删除后残留的多余空行。
 *
 * 目标 id 不存在 → 原样返回（不做任何规范化，保证幂等与不破坏无关文件）。
 */
export function stripRegions(source: string, target: string): string {
  const regions = parseRegions(source).filter((region) => region.id === target)
  if (regions.length === 0) return source

  const removedLines = new Set<number>()
  for (const region of regions)
    markLineRange(removedLines, region.startLine, region.endLine)
  return normalizeAfterDeletion(source, removeLines(source, removedLines))
}

/**
 * 只删除标记行、保留区块内容（scaffold 对「保留特性」去标记用）。
 * 目标 id 不存在 → 原样返回。删除后不做空白规范化（标记行独占一行，删除不会产生新空行）。
 */
export function unwrapRegions(source: string, target: string): string {
  const regions = parseRegions(source).filter((region) => region.id === target)
  if (regions.length === 0) return source

  const removedLines = new Set<number>()
  for (const region of regions) {
    removedLines.add(region.startLine)
    removedLines.add(region.endLine)
  }
  return removeLines(source, removedLines)
}

/**
 * 收起「业务模块全部卸载后」的空容器区块：id 以 `gen:group:` 开头、且内部不含任何
 * `module:*` 区块的区块整体删除（含标记行）。应在 stripRegions 之后调用。
 *
 * 目标不存在 / 容器内仍有模块 → 原样返回；删除后按 stripRegions 同一规则做空白规范化。
 */
export function stripEmptyGroupRegions(source: string): string {
  const regions = parseRegions(source)
  const moduleRegions = regions.filter((region) =>
    region.id.startsWith(MODULE_REGION_PREFIX)
  )
  const emptyGroups = regions.filter(
    (region) =>
      region.id.startsWith(GROUP_REGION_PREFIX) &&
      !moduleRegions.some(
        (moduleRegion) =>
          moduleRegion.startLine > region.startLine &&
          moduleRegion.endLine < region.endLine
      )
  )
  if (emptyGroups.length === 0) return source

  const removedLines = new Set<number>()
  for (const group of emptyGroups)
    markLineRange(removedLines, group.startLine, group.endLine)
  return normalizeAfterDeletion(source, removeLines(source, removedLines))
}
