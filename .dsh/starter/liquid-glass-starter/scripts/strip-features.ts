// Tier 1 系统可选特性剥离执行器（template-only，剥离后自清理）。
//
// 设计依据：模板仓库设计书 §5 + 实施计划 §6（两者都不随脚手架分发）。
//
// 职责（声明式清单在 ./features.ts）：
//   1. 删除 files（web / api / shared 三段，目标项目缺少某端时自动跳过）；
//   2. 写入 replaceFiles 精简占位内容（demo 的 DashboardPage）；
//   3. 对「被移除特性」的 regionFiles 执行 stripRegions；
//   4. 对「保留特性」的 regionFiles 执行 unwrapRegions（生成项目不留 feature:* 标记）；
//   5. 自清理 features.ts / strip-features.ts / strip-features.test.ts 与 package.json 引用；
//   6. 可选写 JSON 报告（scaffold 据此在 bun install 后跑 imports:prune + eslint --fix）。
//
// 安全约束：
//   - 所有路径先解析再校验必须位于 --root 内（拒绝 `..` 越界）；
//   - 全部计算在内存中完成、再一次性落盘：区块解析失败不会产生半成品；
//   - 只在 --root 指向的副本上工作，禁止对模板仓库本体执行剥离（测试只在 mkdtemp 副本上跑）。

import fs from "node:fs"
import path from "node:path"

import {
  FEATURE_IDS,
  type FeatureFileGroups,
  type FeatureId,
  type FeatureManifest,
  FEATURES,
} from "./features"
import {
  listRegions,
  RegionParseError,
  stripRegions,
  unwrapRegions,
} from "./lib/code-regions"

/** 模板仓库中 web 源码目录前缀；flat 项目由 --web-root 重映射到 frontend/src。 */
const WEB_PREFIX = "apps/web/src/"
/** 目标项目没有 apps/api 时，api 段与 apps/api/** regionFiles 自动跳过。 */
const API_PREFIX = "apps/api/"
/** 目标项目没有 packages/ 时，shared 段与 packages/** regionFiles 自动跳过。 */
const SHARED_PREFIX = "packages/"
/** 写完后由本执行器删除的模板专属文件。 */
export const SELF_FILES = [
  "scripts/features.ts",
  "scripts/strip-features.ts",
  "scripts/strip-features.test.ts",
] as const

export interface StripFeaturesOptions {
  /** 目标项目根目录，默认 process.cwd() */
  root?: string
  /** web 源码相对路径，默认 apps/web/src；flat 项目传 frontend/src */
  webRoot?: string
  /** 要剥离的特性 id（空数组 = 全部保留，仅去标记） */
  remove?: readonly string[]
  /** 测试用：不删除 features.ts / strip-features.ts / strip-features.test.ts */
  keepSelf?: boolean
  /** JSON 报告路径（相对 root 或绝对路径） */
  reportPath?: string
  /** 只计算并打印计划，不落盘（CLI --list） */
  dryRun?: boolean
}

export interface StripFeaturesResult {
  root: string
  webRoot: string
  removed: FeatureId[]
  retained: FeatureId[]
  /** 已删除（或 dry-run 下计划删除）的仓库相对路径，目录只记一条 */
  deleted: string[]
  /** 内容被区块剥离 / 去标记改写过的文件 */
  modified: string[]
  /** 被 replaceFiles 覆盖写入的文件 */
  replaced: string[]
  /** 自清理删除的模板专属文件 */
  selfDeleted: string[]
  /** 非致命提示：清单文件在目标项目中不存在（幂等 / 异构模板） */
  warnings: string[]
}

/** 特性 id → 区块 id（feature:audit-log 等）。 */
export function featureRegionId(id: FeatureId): string {
  return `feature:${id}`
}

/** 校验并归一化 --web-root（必须是 root 内的相对路径）。 */
export function normalizeWebRoot(raw: string): string {
  const normalized = raw
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
  if (!normalized) throw new Error("--web-root 不能为空")
  if (path.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(
      `--web-root 必须是项目内的相对路径（不允许绝对路径或 '..'）：${raw}`
    )
  }
  return normalized
}

/** 清单里以 apps/web/src/ 开头的路径 → <webRoot>/ 剩余部分；其余原样返回。 */
export function remapWebPath(relPath: string, webRoot: string): string {
  const normalized = relPath.replace(/\\/g, "/")
  if (normalized === WEB_PREFIX.slice(0, -1)) return webRoot
  if (normalized.startsWith(WEB_PREFIX)) {
    return `${webRoot}/${normalized.slice(WEB_PREFIX.length)}`
  }
  return normalized
}

/** 解析 root 相对路径并校验不越界；返回绝对路径。 */
function resolveInsideRoot(root: string, relPath: string): string {
  const absolute = path.resolve(root, relPath)
  const relative = path.relative(root, absolute)
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`路径越界（必须位于项目根目录内）：${relPath}`)
  }
  return absolute
}

/** 目标项目是否存在该「端」；不存在时整段跳过（flat / Go / Kotlin 项目）。 */
function hasEnd(root: string, relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/")
  if (normalized === "apps/api" || normalized.startsWith(API_PREFIX)) {
    return fs.existsSync(path.join(root, "apps", "api"))
  }
  if (normalized === "packages" || normalized.startsWith(SHARED_PREFIX)) {
    return fs.existsSync(path.join(root, "packages"))
  }
  return true
}

/** 删除端分组（web 重映射、api/shared 缺端跳过），返回待删除相对路径。 */
function planDeletes(
  root: string,
  webRoot: string,
  groups: FeatureFileGroups,
  warnings: string[]
): string[] {
  const planned: string[] = []
  const add = (relPath: string): void => {
    const normalized = relPath.replace(/\\/g, "/")
    const absolute = resolveInsideRoot(root, normalized)
    if (fs.existsSync(absolute)) {
      planned.push(normalized)
    } else {
      warnings.push(`清单文件不存在（已跳过）：${normalized}`)
    }
  }

  for (const relPath of groups.web ?? []) add(remapWebPath(relPath, webRoot))
  for (const relPath of groups.api ?? []) {
    if (hasEnd(root, relPath)) add(relPath)
  }
  for (const relPath of groups.shared ?? []) {
    if (hasEnd(root, relPath)) add(relPath)
  }
  return planned
}

/** 收集 replaceFiles（web 重映射、api/shared 缺端跳过）。 */
function planReplacements(
  root: string,
  webRoot: string,
  features: readonly FeatureManifest[]
): Array<{ rel: string; content: string }> {
  const planned: Array<{ rel: string; content: string }> = []
  for (const feature of features) {
    const groups = feature.replaceFiles
    if (!groups) continue
    for (const [relPath, content] of Object.entries(groups.web ?? {})) {
      planned.push({ rel: remapWebPath(relPath, webRoot), content })
    }
    for (const [relPath, content] of Object.entries(groups.api ?? {})) {
      if (hasEnd(root, relPath)) planned.push({ rel: relPath, content })
    }
    for (const [relPath, content] of Object.entries(groups.shared ?? {})) {
      if (hasEnd(root, relPath)) planned.push({ rel: relPath, content })
    }
  }
  return planned
}

/**
 * 收集所有 regionFiles → 涉及的特性集合。
 *
 * 同一文件可被多个特性列出（App.tsx / menu-config.ts / query-keys.ts ...）；
 * 拆分后逐文件「先剥离移除特性、再去标记保留特性」，嵌套区块自然得到交集语义。
 */
function collectRegionFiles(
  root: string,
  webRoot: string
): Array<{ rel: string; ids: FeatureId[] }> {
  const files = new Map<string, FeatureId[]>()
  for (const id of FEATURE_IDS) {
    for (const relPath of FEATURES[id].regionFiles) {
      const rel = remapWebPath(relPath, webRoot)
      if (!hasEnd(root, rel)) continue
      const ids = files.get(rel) ?? []
      if (!ids.includes(id)) ids.push(id)
      files.set(rel, ids)
    }
  }
  return [...files.entries()].map(([rel, ids]) => ({ rel, ids }))
}

/** 目标相对路径是否落在任一「整体删除」路径之下（精确文件或目录前缀）。 */
function isUnderDeletedPath(
  rel: string,
  deletedPaths: readonly string[]
): boolean {
  return deletedPaths.some(
    (deletedPath) => rel === deletedPath || rel.startsWith(`${deletedPath}/`)
  )
}

/** 对单个文件按「先剥离、后去标记」处理；返回新内容（无区块时原样返回）。 */
function transformFile(
  source: string,
  ids: readonly FeatureId[],
  removed: ReadonlySet<FeatureId>
): string {
  let next = source
  for (const id of FEATURE_IDS) {
    if (!ids.includes(id)) continue
    next = removed.has(id)
      ? stripRegions(next, featureRegionId(id))
      : unwrapRegions(next, featureRegionId(id))
  }
  return next
}

/**
 * 删除 package.json scripts 中对自清理文件的引用（否则生成项目 lint:scripts 会因
 * 文件不存在而失败）。无 package.json（flat 项目）时跳过。
 */
function cleanupPackageJson(root: string): boolean {
  const pkgPath = path.join(root, "package.json")
  if (!fs.existsSync(pkgPath)) return false
  let pkg: { scripts?: Record<string, unknown> }
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, unknown>
    }
  } catch {
    return false
  }
  const scripts = pkg.scripts
  if (!scripts || typeof scripts !== "object") return false

  let changed = false
  const selfFiles = new Set<string>(SELF_FILES)
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== "string") continue
    const tokens = value.split(/\s+/).filter(Boolean)
    const kept = tokens.filter((token) => !selfFiles.has(token))
    if (kept.length !== tokens.length) {
      scripts[name] = kept.join(" ")
      changed = true
    }
  }
  if (changed) fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  return changed
}

/**
 * 执行特性剥离。
 *
 * 计算与落盘分离：先完整计算（含区块解析，解析失败直接抛错），再统一删除 / 写入；
 * 计算阶段失败不会产生任何写操作。
 */
export function stripFeatures(
  options: StripFeaturesOptions = {}
): StripFeaturesResult {
  const root = path.resolve(options.root ?? process.cwd())
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`目标项目目录不存在：${root}`)
  }
  const webRoot = normalizeWebRoot(options.webRoot ?? "apps/web/src")

  const unknown = (options.remove ?? []).filter(
    (id) => !FEATURE_IDS.includes(id as FeatureId)
  )
  if (unknown.length > 0) {
    throw new Error(
      `未知特性 id：${unknown.join(", ")}（可选：${FEATURE_IDS.join(", ")}）`
    )
  }
  const removed = FEATURE_IDS.filter((id) =>
    (options.remove ?? []).includes(id)
  )
  const retained = FEATURE_IDS.filter((id) => !removed.includes(id))
  const removedSet = new Set<FeatureId>(removed)
  const removedFeatures = FEATURE_IDS.filter((id) => removedSet.has(id)).map(
    (id) => FEATURES[id]
  )

  const warnings: string[] = []

  // ── 1. 计算 replaceFiles（删除之后再写入；同一路径以 replace 为准，避免二次执行重复删除）
  const replacements = planReplacements(root, webRoot, removedFeatures)
  const replacedSet = new Set(replacements.map((item) => item.rel))

  // ── 2. 计算待删除文件 / 目录 ───────────────────────────────────────────────
  const plannedDeletes: string[] = []
  for (const feature of removedFeatures) {
    plannedDeletes.push(...planDeletes(root, webRoot, feature.files, warnings))
  }
  const deleted = plannedDeletes.filter((rel) => !replacedSet.has(rel))

  // ── 3. 计算区块剥离 / 去标记后的内容（纯内存）─────────────────────────────
  const modified: Array<{ rel: string; content: string }> = []
  for (const { rel, ids } of collectRegionFiles(root, webRoot)) {
    // 将被整体删除或整体替换的文件无需做区块手术。
    // 注意删除项可能是目录（如 modules/notification），其下文件命中前缀时同样 skip，
    // 否则「先删目录、再写回 regionFile」会复活已删除模块里的单个文件。
    if (isUnderDeletedPath(rel, deleted) || replacedSet.has(rel)) continue
    const absolute = resolveInsideRoot(root, rel)
    if (!fs.existsSync(absolute)) continue

    const source = fs.readFileSync(absolute, "utf8")
    let next: string
    try {
      next = transformFile(source, ids, removedSet)
    } catch (error) {
      if (error instanceof RegionParseError) {
        throw new Error(`${rel}：${error.message}`, { cause: error })
      }
      throw error
    }
    if (next === source) continue

    // 容错检查：处理后不应再残留任何 feature:* 区块（未知特性 id 会在此暴露）。
    const leftovers = listRegions(next).filter((id) =>
      id.startsWith("feature:")
    )
    if (leftovers.length > 0) {
      warnings.push(`${rel} 残留特性区块：${leftovers.join(", ")}`)
    }
    modified.push({ rel, content: next })
  }

  // ── 4. 自清理计划 ─────────────────────────────────────────────────────────
  const selfPlanned = options.keepSelf
    ? []
    : SELF_FILES.filter((rel) => fs.existsSync(path.join(root, rel)))

  // ── 5. 落盘（dry-run 只返回计划）──────────────────────────────────────────
  if (!options.dryRun) {
    for (const rel of deleted) {
      fs.rmSync(path.join(root, rel), { recursive: true, force: true })
    }
    for (const replacement of replacements) {
      const absolute = resolveInsideRoot(root, replacement.rel)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, replacement.content)
    }
    for (const file of modified) {
      const absolute = resolveInsideRoot(root, file.rel)
      fs.writeFileSync(absolute, file.content)
    }
    for (const rel of selfPlanned) {
      fs.rmSync(path.join(root, rel), { force: true })
    }
    if (selfPlanned.length > 0) {
      const pkgChanged = cleanupPackageJson(root)
      if (pkgChanged) {
        // package.json 只清理了自身引用，不进入 modified（scaffold 只对 .ts/.tsx 做 prune）。
        warnings.push("已清理 package.json scripts 中对剥离器自身文件的引用")
      }
    }
  }

  const result: StripFeaturesResult = {
    root,
    webRoot,
    removed,
    retained,
    deleted,
    modified: modified.map((file) => file.rel),
    replaced: replacements.map((item) => item.rel),
    selfDeleted: selfPlanned,
    warnings,
  }

  if (options.reportPath && !options.dryRun) {
    const reportPath = path.isAbsolute(options.reportPath)
      ? options.reportPath
      : path.resolve(root, options.reportPath)
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`)
  }

  return result
}

// ── CLI ─────────────────────────────────────────────────────────────────────

interface CliOptions extends StripFeaturesOptions {
  list: boolean
  help: boolean
}

const HELP_TEXT = `用法：bun scripts/strip-features.ts [选项]

剥离模板中 Tier 1 可选特性（audit-log / notification / demo），
删除清单文件、剥离 feature:* 区块、对保留特性去标记，并自清理剥离器。

选项：
  --root <dir>         目标项目根目录（默认当前目录）
  --web-root <dir>     web 源码目录（monorepo: apps/web/src；flat: frontend/src）
  --remove <list>      逗号分隔的特性 id（audit-log,notification,demo）；
                       省略或空串 = 全部保留，只去除 feature:* 标记
  --list               只打印计划，不落盘
  --report <path>      写 JSON 报告（{ deleted, modified, replaced, ... }）
  --keep-self          测试用：不删除 features.ts / strip-features.ts / strip-features.test.ts
  --help, -h           显示本帮助
`

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { list: false, help: false }
  let removeRaw: string | undefined

  const takeValue = (flag: string, index: number): string => {
    const next = argv[index + 1]
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`${flag} 需要值`)
    }
    return next
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const equalIndex = arg.indexOf("=")
    const flag = equalIndex >= 0 ? arg.slice(0, equalIndex) : arg
    const inlineValue = equalIndex >= 0 ? arg.slice(equalIndex + 1) : undefined

    switch (flag) {
      case "--root":
        options.root = inlineValue ?? takeValue(flag, index++)
        break
      case "--web-root":
        options.webRoot = inlineValue ?? takeValue(flag, index++)
        break
      case "--remove":
        removeRaw = inlineValue ?? ""
        if (inlineValue === undefined) {
          const next = argv[index + 1]
          if (next !== undefined && !next.startsWith("--")) {
            removeRaw = next
            index += 1
          }
        }
        break
      case "--report":
        options.reportPath = inlineValue ?? takeValue(flag, index++)
        break
      case "--list":
        options.list = true
        break
      case "--keep-self":
        options.keepSelf = true
        break
      case "--help":
      case "-h":
        options.help = true
        break
      default:
        throw new Error(`未知参数：${arg}（--help 查看用法）`)
    }
  }

  options.dryRun = options.list
  if (removeRaw !== undefined && removeRaw.trim() !== "") {
    options.remove = removeRaw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  }
  return options
}

function printPlan(result: StripFeaturesResult): void {
  console.log("🧭 特性剥离计划（--list，不落盘）")
  console.log(`   Root:      ${result.root}`)
  console.log(`   Web Root:  ${result.webRoot}`)
  console.log(`   Remove:    ${result.removed.join(", ") || "(none)"}`)
  console.log(`   Retain:    ${result.retained.join(", ") || "(none)"}`)
  console.log(`   删除 ${result.deleted.length} 项：`)
  for (const rel of result.deleted) console.log(`     - ${rel}`)
  console.log(`   替换 ${result.replaced.length} 项：`)
  for (const rel of result.replaced) console.log(`     ~ ${rel}`)
  console.log(`   区块改写 ${result.modified.length} 个文件：`)
  for (const rel of result.modified) console.log(`     * ${rel}`)
  if (result.selfDeleted.length > 0) {
    console.log(`   自清理 ${result.selfDeleted.length} 个文件：`)
    for (const rel of result.selfDeleted) console.log(`     - ${rel}`)
  }
  if (result.warnings.length > 0) {
    console.log(`   ⚠️ ${result.warnings.length} 条提示：`)
    for (const warning of result.warnings) console.log(`     · ${warning}`)
  }
}

function printSummary(result: StripFeaturesResult, reportPath?: string): void {
  console.log("🧹 Tier 1 特性剥离完成")
  console.log(
    `   Remove:    ${result.removed.join(", ") || "(none)"}（保留去标记：${result.retained.join(", ") || "(none)"}）`
  )
  console.log(
    `   删除 ${result.deleted.length} 项 / 替换 ${result.replaced.length} 项 / 区块改写 ${result.modified.length} 个文件 / 自清理 ${result.selfDeleted.length} 个文件`
  )
  if (result.warnings.length > 0) {
    console.log(`   ⚠️ ${result.warnings.length} 条提示：`)
    for (const warning of result.warnings) console.log(`     · ${warning}`)
  }
  if (reportPath) console.log(`   Report:    ${reportPath}`)
}

function main(): void {
  let options: CliOptions
  try {
    options = parseCliArgs(Bun.argv.slice(2))
  } catch (error) {
    console.error(`❌ ${(error as Error).message}`)
    process.exit(1)
  }

  if (options.help) {
    console.log(HELP_TEXT)
    return
  }

  try {
    const result = stripFeatures(options)
    if (options.list) {
      printPlan(result)
    } else {
      printSummary(result, options.reportPath)
    }
  } catch (error) {
    console.error(`❌ 特性剥离失败：${(error as Error).message}`)
    process.exit(1)
  }
}

if (import.meta.main) {
  main()
}
