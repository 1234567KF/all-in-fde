import { execSync, spawnSync } from "child_process"
import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"

import { allocatePort } from "./lib/port-allocator"
import { diffSkillTrees, isEmptyDiff, syncSkillTree } from "./lib/skill-sync"
import {
  isExcludedFromTemplate,
  stripDashboardPreviewImage,
  stripTemplateOnlyMarkdownRegions,
} from "./lib/template-copy"
import {
  DEFAULT_WEB_APP_ID,
  validateWebAppFields,
  type AddWebAppResult,
} from "./lib/web-app"

/**
 * 棘轮 helper 用**目标项目自己的**那一份（零依赖纯 TS，与 arch-check.ts 配套 stamp）。
 *
 * 技能不再 vendored 一份：两份实现是一条平行维护轴，只能靠 parity 测试兜住。
 * 调用时目标项目已成形（init 全量复制 / add-ci 已 stamp），动态 import 即可。
 */
interface RatchetLib {
  pruneMissingLongFileRatchet: (root: string) => void
  readLongFileRatchetEntries: (root: string) => Record<string, number>
  upsertLongFileRatchetEntries: (
    root: string,
    entries: Record<string, number>
  ) => number
}

async function loadRatchetLib(root: string): Promise<RatchetLib | null> {
  const lib = path.join(root, "scripts", "lib", "long-file-ratchet.ts")
  if (!fs.existsSync(lib)) {
    console.warn(
      `⚠️  目标项目缺少 scripts/lib/long-file-ratchet.ts，跳过 450 行棘轮维护。`
    )
    console.warn(
      `   请从模板仓库补齐该文件后重跑，否则 bun run arch:check 可能报 overlong-ratchet-missing。`
    )
    return null
  }
  return (await import(pathToFileURL(lib).href)) as RatchetLib
}

async function pruneRatchet(root: string): Promise<void> {
  const mod = await loadRatchetLib(root)
  mod?.pruneMissingLongFileRatchet(root)
}

/**
 * add-ci 重新 stamp Dockerfile 后补回各端依赖层区块。
 * 模板原件只含默认端，不补的话容器里 bun install 解析不到其余 workspace。
 * 旧项目没有 add-web.ts 时跳过（单端项目本来也不需要）。
 */
async function repairWebAppDockerfile(root: string): Promise<void> {
  const script = path.join(root, "scripts", "add-web.ts")
  if (!fs.existsSync(script)) return
  const mod = (await import(pathToFileURL(script).href)) as {
    ensureWebAppDockerfileRegions: (root: string) => string[]
  }
  const added = mod.ensureWebAppDockerfileRegions(root)
  if (added.length > 0) {
    console.log(`   ✓ Dockerfile 补回端依赖层区块：${added.join("、")}`)
  }
}

// Helper function to read templates and substitute placeholders
function readTemplate(
  relativePath: string,
  replacements?: Record<string, string>
): string {
  const templatesDir = path.resolve(import.meta.dir, "..", "templates")
  const fullPath = path.join(templatesDir, relativePath)
  if (!fs.existsSync(fullPath)) {
    console.error(`Template not found: ${fullPath}`)
    process.exit(1)
  }
  let content = fs.readFileSync(fullPath, "utf8")
  if (replacements) {
    for (const [key, val] of Object.entries(replacements)) {
      content = content.replaceAll(`{{${key}}}`, val)
    }
  }
  return content
}

// Simple argument parser
const args = Bun.argv.slice(2)
const params: Record<string, string> = {}
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg.startsWith("--")) {
    const next = args[i + 1]
    if (next && !next.startsWith("--")) {
      params[arg.slice(2)] = next
      i++
    } else {
      params[arg.slice(2)] = "true"
    }
  }
}

const name = params["name"]
const target = params["target"]
const type = params["type"] || "monorepo"
const cleanDemo = params["clean-demo"] === "true"
const cleanAuditLog = params["clean-audit-log"] === "true"
// --clean-notifications：显式传 true/false 时直接采用；省略时 TTY 交互询问、非 TTY 默认 false。
const cleanNotificationsRaw = params["clean-notifications"]
if (
  cleanNotificationsRaw !== undefined &&
  cleanNotificationsRaw !== "true" &&
  cleanNotificationsRaw !== "false"
) {
  console.error(
    `Invalid --clean-notifications: ${cleanNotificationsRaw}. Allowed: true, false`
  )
  process.exit(1)
}
const updateOnly = params["update-only"] === "true"
const mode = params["mode"] || "init"
const includeCi = params["include-ci"] === "true"
const force = params["force"] === "true"
// 手动指定测试端口（跳过自动分配，仅走 registry 冲突检查）
const manualPortRaw = params["port"]
const manualPort = manualPortRaw ? parseInt(manualPortRaw, 10) : undefined
if (
  manualPortRaw &&
  (Number.isNaN(manualPort) || manualPort! < 1 || manualPort! > 65535)
) {
  console.error(`Invalid --port: ${manualPortRaw}`)
  process.exit(1)
}
// 完全跳过端口分配（保留模板默认 11070占位符）
const skipPortAlloc = !(params["allow-remote-ports"] === "true") && params["skip-port-alloc"] !== "false"
// 跳过技能自更新（离线钉版本 / 刻意保留本地改动时用）
const skipSkillUpdate = params["skip-skill-update"] === "true"
// add-web：新端的 Vite dev 端口（省略时取注册表最大值 +1）
const devPortRaw = params["dev-port"]
const devPort = devPortRaw ? parseInt(devPortRaw, 10) : undefined
if (devPortRaw && (Number.isNaN(devPort) || devPort! < 1 || devPort! > 65535)) {
  console.error(`Invalid --dev-port: ${devPortRaw}`)
  process.exit(1)
}

if (!["init", "add-ci", "add-web"].includes(mode)) {
  console.error(`Invalid --mode: ${mode}. Allowed: init, add-ci, add-web`)
  process.exit(1)
}

if (mode === "add-ci") {
  if (!target) {
    console.error("Missing required argument for add-ci mode: --target")
    process.exit(1)
  }
} else if (mode === "add-web") {
  const missing = ["target", "id", "title"].filter((k) => !params[k])
  if (missing.length > 0) {
    console.error(
      `Missing required arguments for add-web mode: ${missing.map((k) => `--${k}`).join(", ")}`
    )
    process.exit(1)
  }
} else if (!updateOnly && (!name || !target)) {
  console.error(
    "Missing required arguments: --name, --target (or use --update-only to refresh template cache)"
  )
  process.exit(1)
}

// ── 参数校验 / DB 选型归一化 ────────────────────────────────────────────────
// 必须放在 clone/pull、target 目录操作之前：参数不可能成功的调用不应产生任何副作用。
const VALID_TYPES = ["monorepo", "flat-go", "flat-java"] as const
type ScaffoldType = (typeof VALID_TYPES)[number]
if (!VALID_TYPES.includes(type as ScaffoldType)) {
  console.error(`Invalid --type: ${type}. Allowed: ${VALID_TYPES.join(", ")}`)
  process.exit(1)
}
// 多端只沉淀在 TS Monorepo：flat 模板没有 packages/ui、web-core 与端注册表。
if (mode === "add-web" && type !== "monorepo") {
  console.error(`❌ --mode add-web 只支持 --type monorepo（当前 ${type}）。`)
  process.exit(1)
}

// init 多端：默认端照常生成，其余端在 install 前走与 add-web 完全相同的 addWebApp。
interface ExtraWebAppInput {
  id: string
  title: string
  base?: string
  devPort?: number
  accessPermission?: boolean
  blank?: boolean
}
let extraWebApps: ExtraWebAppInput[] = []
// --web-apps-file 是 Windows 推荐入口：cmd.exe 不认单引号且会吃掉内层双引号，
// PowerShell 5.1 同样丢引号，JSON 直接进 argv 在这两种 shell 下必然解析失败。
let webAppsRaw: string | undefined = params["web-apps"]
let webAppsFlag = "--web-apps"
if (params["web-apps-file"] !== undefined) {
  webAppsFlag = "--web-apps-file"
  const file = path.resolve(params["web-apps-file"])
  try {
    webAppsRaw = fs.readFileSync(file, "utf8")
  } catch {
    console.error(`❌ 读不到 ${webAppsFlag} 指定的文件：${file}`)
    process.exit(1)
  }
}
if (webAppsRaw !== undefined) {
  if (mode !== "init" || type !== "monorepo") {
    console.error(`❌ ${webAppsFlag} 只能用于 --mode init --type monorepo。`)
    process.exit(1)
  }
  try {
    extraWebApps = JSON.parse(webAppsRaw) as ExtraWebAppInput[]
  } catch {
    console.error(`❌ ${webAppsFlag} 不是合法 JSON。`)
    process.exit(1)
  }
  if (!Array.isArray(extraWebApps)) {
    console.error(`❌ ${webAppsFlag} 必须是数组。`)
    process.exit(1)
  }
  // 语义校验必须在这里做完：多端循环位于模板复制 / 特性剥离 / CI stamping 之后，
  // 到那时才失败会留下无法用 add-web 补救的半成品项目。
  const seenIds = new Set<string>()
  for (const entry of extraWebApps) {
    if (typeof entry !== "object" || entry === null) {
      console.error(`❌ ${webAppsFlag} 的每个条目必须是对象。`)
      process.exit(1)
    }
    try {
      validateWebAppFields(entry)
    } catch (err) {
      console.error(`❌ ${webAppsFlag} 条目无效：${(err as Error).message}`)
      process.exit(1)
    }
    if (seenIds.has(entry.id)) {
      console.error(`❌ ${webAppsFlag} 里端 id "${entry.id}" 重复。`)
      process.exit(1)
    }
    seenIds.add(entry.id)
  }
}

const VALID_DBS = ["none", "drizzle", "gorm", "jpa"] as const
const DEFAULT_DB_BY_TYPE: Record<ScaffoldType, string> = {
  monorepo: "drizzle",
  "flat-go": "gorm",
  "flat-java": "jpa",
}
const explicitDb = params["db"]
let dbChoice = explicitDb ?? DEFAULT_DB_BY_TYPE[type as ScaffoldType]
if (!VALID_DBS.includes(dbChoice as (typeof VALID_DBS)[number])) {
  const fallback = DEFAULT_DB_BY_TYPE[type as ScaffoldType]
  console.warn(
    `⚠️ Warning: Unknown database option: --db ${dbChoice}. Falling back to '${fallback}'.`
  )
  dbChoice = fallback
}

// monorepo 模板内置 Drizzle + auth/user/notification 等 DB 模块，这些模块直接
// import apps/api/src/db；剥离 db 目录会生成无法编译的项目，因此直接 fail-fast。
if (type === "monorepo" && explicitDb === "none") {
  console.error(
    "❌ monorepo 模板内置 Drizzle + DB 模块（auth / user / notification），--db none 会生成无法编译的项目。"
  )
  console.error(
    "   请使用 --db drizzle（monorepo 默认）；如需纯 Mock 后端请选择 flat 模板。"
  )
  process.exit(1)
}
if (type === "monorepo" && dbChoice !== "drizzle") {
  console.warn(
    `⚠️ Warning: Selected --db ${dbChoice} is not supported for TS Monorepo. Falling back to 'drizzle'.`
  )
  dbChoice = "drizzle"
} else if (type === "flat-go" && dbChoice !== "none" && dbChoice !== "gorm") {
  console.warn(
    `⚠️ Warning: Selected --db ${dbChoice} is not supported for Go. Falling back to 'gorm'.`
  )
  dbChoice = "gorm"
} else if (type === "flat-java" && dbChoice !== "none" && dbChoice !== "jpa") {
  console.warn(
    `⚠️ Warning: Selected --db ${dbChoice} is not supported for Kotlin. Falling back to 'jpa'.`
  )
  dbChoice = "jpa"
}

// ── Mode Dispatch: add-web ──────────────────────────────────────────────────
// 只调目标项目自带的 scripts/add-web.ts，不读模板缓存，因此放在 clone/pull 之前：
// 追加端是纯本地操作，离线且无缓存时也必须可用。
if (mode === "add-web") {
  runAddWeb()
  process.exit(0)
}

// 本机完整模板副本：不再从远端 clone/pull，运行期零网络
const templateCachePath =
  process.env.FDE_STARTER_TEMPLATE ??
  path.resolve(import.meta.dir, "..", "..", "..")

if (!fs.existsSync(path.join(templateCachePath, "package.json"))) {
  console.error(`❌ 模板目录不可用：${templateCachePath}`)
  process.exit(1)
}
console.log(`📦 使用本机模板：${templateCachePath}`)
// ── 技能自更新 ───────────────────────────────────────────────────────────────
// 缓存刚 clone/pull 完，里面的 skills/project-scaffolder 就是与本次模板
// **同源同提交**的最新技能，直接复制即可，不需要再走一次 giget（再拉一次可能拿到
// 另一个提交，技能与它即将使用的模板就不同源了）。
//
// 同步后必须 exit 3 停下来：Bun 已把旧 scaffold.ts 载入内存，就地继续会变成
// 旧编排逻辑配新 templates/lib 的半新半旧状态。
const skillRoot = path.resolve(import.meta.dir, "..")
const cacheSkillRoot = path.join(
  templateCachePath,
  "skills",
  "project-scaffolder"
)
// pull 失败（离线）也照常同步：缓存里已有的版本仍可能比本地新。
if (!skipSkillUpdate && fs.existsSync(cacheSkillRoot)) {
  // 直接从缓存/仓库跑脚本时源即目标（realpath 覆盖软链接情形），自己覆盖自己无意义。
  const isSelf = fs.realpathSync(skillRoot) === fs.realpathSync(cacheSkillRoot)
  if (!isSelf && !isEmptyDiff(diffSkillTrees(cacheSkillRoot, skillRoot))) {
    const diff = syncSkillTree(cacheSkillRoot, skillRoot)
    console.log("\n📦 本地技能已同步到模板缓存版本：")
    for (const rel of diff.changed) console.log(`   ~ ${rel}`)
    for (const rel of diff.added) console.log(`   + ${rel}`)
    for (const rel of diff.removed) console.log(`   - ${rel}`)

    // 复核：同步后仍有差异说明覆盖没真正落盘（权限/占用），继续下去只会无限重跑。
    if (!isEmptyDiff(diffSkillTrees(cacheSkillRoot, skillRoot))) {
      console.error(
        `❌ 技能同步后仍与缓存不一致，请手动检查 ${skillRoot} 的写权限后重跑。`
      )
      process.exit(1)
    }

    console.log(
      `\n请重读 ${path.join(skillRoot, "SKILL.md")}（流程本身可能已变），再用**完全相同的参数**重跑一次；第二遍无差异会正常继续。`
    )
    console.log("SKILL_UPDATED: re-read SKILL.md and re-run the same command")
    process.exit(3)
  }
}

// Exit early if only updating template cache
if (updateOnly) {
  console.log("\n🎉 Template cache updated successfully!")
  process.exit(0)
}

const targetPath = path.resolve(target!)

// ── CI Stamping ─────────────────────────────────────────────────────────────
// Copies CI files from the template cache to the target project, replacing
// the token `liquid-glass-starter` with the actual project name inside a
// small whitelist of files. Used by both init (--include-ci) and add-ci mode.
const CI_FILES_ALL = [
  ".gitlab-ci.yml",
  "Dockerfile",
  "ci-tools/Dockerfile",
  // ci-tools/runtime.Dockerfile 产出 bun-runtime:alpine-3.20（已预装 libstdc++/ca-certificates/tzdata）
  "ci-tools/runtime.Dockerfile",
  "ci-tools/README.md",
  "deploy.sh",
  "compose.yml",
  "compose.test.yml",
  "compose.preprod.yml",
  ".dockerignore",
  // CI 引用的“质量门禁”脚本（跨项目通用，无需项目名替换）
  // ─ scripts/arch-check.ts             UI 层约束 + 页面 lazy 守护
  // ─ scripts/check-migration-staged.ts pre-commit 迁移拦截（要求 husky/pre-commit 启用）
  // ─ apps/api/scripts/migrate-check.ts drizzle journal/snapshot/drift 三方一致预检
  "scripts/arch-check.ts",
  // arch-check 的棘轮 helper（零依赖纯 TS）：scaffold 剪枝时动态 import 目标项目这一份，
  // 技能不再自带副本，因此必须跟 arch-check.ts 一起 stamp。
  "scripts/lib/long-file-ratchet.ts",
  "scripts/check-migration-staged.ts",
  "apps/api/scripts/migrate-check.ts",
  // Dockerfile builder 层单一构建入口（shared / api compile / web 三合一），
  // 避免 Dockerfile inline RUN 多步续行的转义 / 报错定位 / 层缓存失效坑。
  "scripts/build-server.sh",
]
const CI_FILES_REPLACE = new Set([
  ".gitlab-ci.yml",
  "Dockerfile",
  "deploy.sh",
  "compose.yml",
  "compose.test.yml",
  "compose.preprod.yml",
])

function stampCi(
  destRoot: string,
  projectName: string,
  opts: { force?: boolean } = {}
): void {
  const missingInTemplate: string[] = []
  for (const rel of CI_FILES_ALL) {
    if (!fs.existsSync(path.join(templateCachePath, rel)))
      missingInTemplate.push(rel)
  }
  if (missingInTemplate.length > 0) {
    console.error(
      `❌ Template cache is missing CI files: ${missingInTemplate.join(", ")}`
    )
    console.error(
      "   Run `bun run scaffold.ts --update-only` to refresh the template cache."
    )
    process.exit(1)
  }

  for (const rel of CI_FILES_ALL) {
    const src = path.join(templateCachePath, rel)
    const dest = path.join(destRoot, rel)
    const destDir = path.dirname(dest)
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

    if (CI_FILES_REPLACE.has(rel)) {
      const content = fs
        .readFileSync(src, "utf8")
        .replaceAll("liquid-glass-starter", projectName)
      fs.writeFileSync(dest, content)
    } else {
      fs.copyFileSync(src, dest)
    }
    // Preserve executable bit for shell scripts
    if (rel.endsWith(".sh")) {
      try {
        fs.chmodSync(dest, 0o755)
      } catch {
        /* best-effort */
      }
    }
    console.log(`   ✓ ${rel}`)
  }
  console.log(`✅ CI files stamped for project: ${projectName}`)
  void opts // reserved for future flags
}

/**
 * 询问是否剥离消息中心（--clean-notifications 未显式传入时）。
 *
 * 非 TTY（CI、管道、非交互测试）无法交互，按默认「保留」处理（false），避免脚本挂起。
 */
function resolveCleanNotifications(explicit: string | undefined): boolean {
  if (explicit === "true") return true
  if (explicit === "false") return false
  if (!process.stdin.isTTY) {
    console.log(
      "ℹ️  --clean-notifications 未指定且非交互终端：默认保留消息中心（false）。"
    )
    return false
  }
  const answer =
    prompt("是否剥离消息中心（通知 UI / SSE / /notifications API）？[y/N] ") ??
    ""
  const normalized = answer.trim().toLowerCase()
  return normalized === "y" || normalized === "yes" || normalized === "是"
}

/** strip-features.ts 写出的 JSON 报告结构（scaffold 只用 modified 做 install 后的 import 剪枝）。 */
interface StripFeaturesReport {
  deleted: string[]
  modified: string[]
  replaced: string[]
}

const STRIP_FEATURES_REPORT = ".strip-features-report.json"

function readStripReport(root: string): StripFeaturesReport | null {
  const reportPath = path.join(root, STRIP_FEATURES_REPORT)
  if (!fs.existsSync(reportPath)) return null
  try {
    return JSON.parse(
      fs.readFileSync(reportPath, "utf8")
    ) as StripFeaturesReport
  } catch {
    return null
  }
}

/** `imports:prune` 的补救命令（install 失败 / 自动剪枝失败时提示用户）。 */
function importsPruneHint(type: ScaffoldType, files: string[]): string {
  return type === "monorepo"
    ? `bun run imports:prune -- ${files.join(" ")}`
    : `bun scripts/prune-unused-imports.ts -- ${files.join(" ")}`
}

/**
 * 解析 node_modules/.bin 下的可执行文件。
 *
 * Windows 上 npm/pnpm 生成 `.cmd`，而 Bun 生成 `.exe`（另有 `.bunx` 元数据），
 * 不能只按 `.cmd` 探测；POSIX 直接使用无后缀文件。
 */
function resolveNodeBin(nodeModules: string, name: string): string | null {
  const binDir = path.join(nodeModules, ".bin")
  const candidates =
    process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name]
  for (const candidate of candidates) {
    const fullPath = path.join(binDir, candidate)
    if (fs.existsSync(fullPath)) return fullPath
  }
  return null
}

/** prettier 可执行文件路径：monorepo 在根 node_modules，flat 在 frontend/node_modules。 */
function prettierBinPath(root: string, type: ScaffoldType): string | null {
  const nodeModules =
    type === "monorepo"
      ? path.join(root, "node_modules")
      : path.join(root, "frontend", "node_modules")
  return resolveNodeBin(nodeModules, "prettier")
}

/**
 * prettier 的「工作区」：monorepo 直接在根目录跑；flat 项目根目录没有 node_modules
 * （root package.json 已删除），必须 cd frontend 并以 frontend 相对路径传参，
 * 否则 prettier-plugin-tailwindcss 无法按 cwd 解析。
 */
function prettierWorkspace(
  root: string,
  type: ScaffoldType,
  files: string[]
): { cwd: string; bin: string | null; args: string[] } {
  if (type === "monorepo") {
    return {
      cwd: root,
      bin: prettierBinPath(root, type),
      args: files,
    }
  }
  const frontendPrefix = "frontend/"
  return {
    cwd: path.join(root, "frontend"),
    bin: prettierBinPath(root, type),
    args: files.map((rel) =>
      rel.startsWith(frontendPrefix)
        ? rel.slice(frontendPrefix.length)
        : `../${rel}`
    ),
  }
}

/** prettier --write 的补救命令（相对 targetRoot 执行）。 */
function prettierWriteHint(
  root: string,
  type: ScaffoldType,
  files: string[]
): string {
  const workspace = prettierWorkspace(root, type, files)
  // bunx 会优先使用本地安装的 prettier，跨平台无需关心 .bin 后缀。
  const command = `bunx prettier --write ${workspace.args.join(" ")}`
  return type === "monorepo" ? command : `cd frontend && ${command}`
}

/** install 失败 / fatal 时打印的完整补救命令（prune → eslint → prettier）。 */
function formattingRemediationHints(
  root: string,
  type: ScaffoldType,
  tsFiles: string[],
  formatFiles: string[]
): string[] {
  const hints: string[] = []
  if (tsFiles.length > 0) {
    hints.push(importsPruneHint(type, tsFiles))
    hints.push(`bunx eslint --fix --no-cache ${tsFiles.join(" ")}`)
  }
  if (formatFiles.length > 0) {
    hints.push(prettierWriteHint(root, type, formatFiles))
  }
  return hints
}

/**
 * 安装依赖后清理特性剥离留下的格式漂移：
 *   1. `imports:prune`：TS organizeImports RemoveUnused 删除残留未使用 import / 成员（不重排）；
 *   2. `eslint --fix`：收敛 import 排序与规则可自动修复项；
 *   3. `prettier --write`：把被区块剥离改写的文件（.ts/.tsx/.md）规范成 Prettier 幂等形态。
 *
 * 为什么需要第 3 步：prune 后可能残留「多成员多行 import」这类非 Prettier 幂等形态
 * （例如 menu-config 删掉 Admin 分组后还剩 3 个 lucide 图标）。若生成项目首日不是
 * Prettier 幂等形态，`gen:module → remove:module` 往返时 gen 的 prettier 会折叠它，
 * remove 无法逐字节还原（设计书 §7.2 要求往返后除规格书归档外零 diff）。
 *
 * 全部步骤失败都不 fail-fast：只打印补救命令（生成项目其余门禁仍会暴露问题）。
 */
function cleanupStrippedFeatureFiles(
  root: string,
  type: ScaffoldType,
  tsFiles: string[],
  formatFiles: string[]
): void {
  if (tsFiles.length === 0 && formatFiles.length === 0) return

  if (tsFiles.length > 0) {
    console.log(
      `🧹 Pruning unused imports in ${tsFiles.length} stripped feature file(s)...`
    )
    if (type === "monorepo") {
      try {
        execSync(`bun run imports:prune -- ${tsFiles.join(" ")}`, {
          cwd: root,
          stdio: "inherit",
        })
        console.log("✅ Unused imports pruned.")
      } catch (error) {
        console.warn(
          `⚠️ imports:prune 失败（不阻塞脚手架）：${(error as Error).message}`
        )
        console.warn(
          `   稍后可手动运行：cd ${root} && ${importsPruneHint(type, tsFiles)}`
        )
      }
    } else if (
      fs.existsSync(path.join(root, "scripts", "prune-unused-imports.ts"))
    ) {
      try {
        execSync(
          `bun scripts/prune-unused-imports.ts -- ${tsFiles.join(" ")}`,
          {
            cwd: root,
            stdio: "inherit",
          }
        )
        console.log("✅ Unused imports pruned.")
      } catch (error) {
        console.warn(
          `⚠️ imports:prune 失败（不阻塞脚手架）：${(error as Error).message}`
        )
        console.warn(
          `   稍后可手动运行：cd ${root} && ${importsPruneHint(type, tsFiles)}`
        )
      }
    } else {
      console.warn(
        "⚠️ 未找到 scripts/prune-unused-imports.ts，跳过未使用 import 清理。"
      )
    }

    // eslint --fix 依赖根 node_modules（monorepo）；flat 项目没有根 eslint 配置，跳过。
    const eslintBin = resolveNodeBin(path.join(root, "node_modules"), "eslint")
    if (!eslintBin) {
      console.warn(
        "⚠️ 未找到根 node_modules/.bin/eslint（含 .exe/.cmd），跳过 eslint --fix（flat 项目无根 eslint 配置属预期）。"
      )
    } else {
      try {
        execSync(`"${eslintBin}" --fix --no-cache ${tsFiles.join(" ")}`, {
          cwd: root,
          stdio: "inherit",
        })
        console.log("✅ eslint --fix applied.")
      } catch (error) {
        console.warn(
          `⚠️ eslint --fix 未完全通过（不阻塞脚手架）：${(error as Error).message}`
        )
        console.warn(
          `   建议手动修复：cd ${root} && bunx eslint --fix --no-cache ${tsFiles.join(" ")}`
        )
      }
    }
  }

  // prettier --write：保证生成项目从首日就是 Prettier 幂等形态（gen/remove 逐字节往返的前提）。
  if (formatFiles.length > 0) {
    const workspace = prettierWorkspace(root, type, formatFiles)
    const prettierBin = workspace.bin
    if (!prettierBin) {
      console.warn(
        "⚠️ 未找到 prettier（node_modules/.bin 下无裸文件 / .exe / .cmd），跳过 prettier --write。"
      )
      console.warn(
        `   可稍后手动运行：cd ${root} && ${prettierWriteHint(root, type, formatFiles)}`
      )
      return
    }
    console.log(
      `🎨 Formatting ${formatFiles.length} stripped feature file(s) with prettier...`
    )
    try {
      execSync(`"${prettierBin}" --write ${workspace.args.join(" ")}`, {
        cwd: workspace.cwd,
        stdio: "inherit",
      })
      console.log("✅ prettier --write applied.")
    } catch (error) {
      console.warn(
        `⚠️ prettier --write 未完全通过（不阻塞脚手架）：${(error as Error).message}`
      )
      console.warn(
        `   建议手动格式化：cd ${root} && ${prettierWriteHint(root, type, formatFiles)}`
      )
    }
  }
}

// ── Port Stamping ───────────────────────────────────────────────────────────
// After stampCi(), replace the template-default port `11070` in the generated
// compose files and .gitlab-ci.yml with the project's allocated port. Called
// from both init(--include-ci) and add-ci flows unless --skip-port-alloc.
const PORT_STAMP_FILES = [
  "compose.yml",
  "compose.test.yml",
  "compose.preprod.yml",
  ".gitlab-ci.yml",
  "deploy.sh",
]

function stampPort(destRoot: string, port: number): void {
  for (const rel of PORT_STAMP_FILES) {
    const p = path.join(destRoot, rel)
    if (!fs.existsSync(p)) continue
    let content = fs.readFileSync(p, "utf8")
    // compose 里的 fallback：${WEB_PORT:-11070}
    content = content.replaceAll("${WEB_PORT:-11070}", `\${WEB_PORT:-${port}}`)
    // deploy.sh 首次部署 bootstrap 的 .env： WEB_PORT=11070
    content = content.replaceAll("WEB_PORT=11070", `WEB_PORT=${port}`)
    // .gitlab-ci.yml / deploy.sh 里的 URL：":11070"
    content = content.replaceAll(":11070", `:${port}`)
    fs.writeFileSync(p, content)
  }
}

// ── Mode Dispatch: add-ci ───────────────────────────────────────────────────
// Adds CI to an existing project without touching source code. Infers the
// project name from apps/web/package.json (monorepo) or frontend/package.json
// (flat). Performs structure sanity check and conflict detection.
if (mode === "add-ci") {
  console.log(`🔧 Adding CI to existing project:`)
  console.log(`   Target Path: ${targetPath}`)

  if (!fs.existsSync(targetPath)) {
    console.error(`❌ Target directory does not exist: ${targetPath}`)
    process.exit(1)
  }

  // Detect layout (monorepo vs flat) and infer project name.
  const monorepoWebPkg = path.join(targetPath, "apps", "web", "package.json")
  const flatFrontendPkg = path.join(targetPath, "frontend", "package.json")
  const rootPkg = path.join(targetPath, "package.json")

  let inferredName = params["name"]
  let layout: "monorepo" | "flat" | null = null
  if (fs.existsSync(monorepoWebPkg)) {
    layout = "monorepo"
    if (!inferredName && fs.existsSync(rootPkg)) {
      try {
        inferredName = JSON.parse(fs.readFileSync(rootPkg, "utf8")).name
      } catch {
        /* ignore */
      }
    }
    if (!inferredName) {
      try {
        inferredName = JSON.parse(fs.readFileSync(monorepoWebPkg, "utf8")).name
      } catch {
        /* ignore */
      }
    }
  } else if (fs.existsSync(flatFrontendPkg)) {
    layout = "flat"
    if (!inferredName) {
      try {
        const pkgName: string =
          JSON.parse(fs.readFileSync(flatFrontendPkg, "utf8")).name || ""
        inferredName = pkgName.replace(/-frontend$/, "")
      } catch {
        /* ignore */
      }
    }
  } else {
    console.error("❌ Could not detect project layout.")
    console.error(
      "   Expected either apps/web/package.json (monorepo) or frontend/package.json (flat)."
    )
    process.exit(1)
  }

  if (!inferredName) {
    console.error("❌ Could not infer project name. Pass --name explicitly.")
    process.exit(1)
  }

  // Structure sanity check (monorepo only — flat CI is not sedimented in this iteration).
  if (layout === "monorepo") {
    const requiredPaths = [
      "apps/api/src/index.ts",
      "apps/web/package.json",
      "packages/shared/package.json",
      "packages/ui/package.json",
      "packages/web-core/package.json",
      "web-apps.json",
    ]
    const missing = requiredPaths.filter(
      (p) => !fs.existsSync(path.join(targetPath, p))
    )
    if (missing.length > 0) {
      console.error(
        "❌ Project structure does not match monorepo CI expectations."
      )
      console.error("   Missing files:")
      for (const m of missing) console.error(`     - ${m}`)
      console.error(
        "   Fix the layout or use --force is not supported for structure mismatch."
      )
      process.exit(1)
    }
  } else {
    console.error(
      "❌ Flat layout CI is not sedimented yet. Only monorepo is supported in this iteration."
    )
    process.exit(1)
  }

  // Conflict detection
  const conflicts = CI_FILES_ALL.filter((rel) =>
    fs.existsSync(path.join(targetPath, rel))
  )
  if (conflicts.length > 0 && !force) {
    console.error("❌ CI files already exist:")
    for (const c of conflicts) console.error(`     - ${c}`)
    console.error("   Re-run with --force to overwrite.")
    process.exit(1)
  }

  console.log(`   Project Name: ${inferredName}`)
  console.log(`   Layout:       ${layout}`)
  if (conflicts.length > 0)
    console.log(
      `   Overwriting ${conflicts.length} existing CI file(s) (--force)`
    )

  // stamp 用模板原件覆盖 arch-check.ts / Dockerfile，而这两个文件带着项目自己的
  // 多端状态（克隆端的棘轮基线、web-app:<id> 依赖层区块）。先存后补，否则多端项目
  // add-ci 之后 arch:check 报 file-too-long、容器构建解析不到 workspace。
  const ratchet = await loadRatchetLib(targetPath)
  const savedRatchet = ratchet?.readLongFileRatchetEntries(targetPath) ?? {}
  stampCi(targetPath, inferredName, { force })
  if (ratchet && Object.keys(savedRatchet).length > 0) {
    ratchet.upsertLongFileRatchetEntries(targetPath, savedRatchet)
  }
  await pruneRatchet(targetPath)
  await repairWebAppDockerfile(targetPath)

  // ── Port allocation ───────────────────────────────────────────────────────
  if (skipPortAlloc) {
    console.log(
      "\n⚠️  --skip-port-alloc: 保留模板默认端口 11070，请人工修改 compose*.yml 与 .gitlab-ci.yml 中的端口。"
    )
  } else {
    try {
      const alloc = allocatePort(
        inferredName,
        manualPort != null ? { manualPort, source: "skill" } : {}
      )
      stampPort(targetPath, alloc.port)
      const label = alloc.reused
        ? "复用已分配"
        : manualPort != null
          ? "手动指定"
          : "自动分配"
      console.log(
        `\n✓ 已为 ${inferredName} ${label}测试端口 ${alloc.port}，测试 URL: http://192.0.2.10:${alloc.port}`
      )
      console.log(`   registry: ${alloc.registryPath}`)
    } catch (err) {
      console.error(`\n❌ 端口分配失败：${(err as Error).message}`)
      console.error(
        "   CI 文件已产出但保留模板默认 11070；可用 --skip-port-alloc 跳过，或修正 SSH 后重跑 --mode add-ci --force。"
      )
      process.exit(1)
    }
  }

  console.log("\n🎉 CI added successfully!")
  console.log("\nNext steps:")
  console.log(
    "  1. Review the generated .gitlab-ci.yml and adjust deployment variables."
  )
  console.log(
    "  2. Configure GitLab CI/CD Variables (see references/ci-guide.md)."
  )
  console.log("  3. Commit and push to trigger the first pipeline.")
  process.exit(0)
}

// ── Web 端追加（add-web 与 init 多端共用）─────────────────────────────────────

interface AddWebFields {
  id: string
  title: string
  base?: string
  devPort?: number
  restrictAccess?: boolean
  blank?: boolean
}

/**
 * 调**目标项目自己的** `scripts/add-web.ts` 增端（端样板 = 该项目默认端）。
 *
 * 技能不再自带端空壳：空壳是一条无门禁的平行维护轴，项目改了它不会跟上。
 * 缺该脚本说明目标项目版本过旧，明确报错而不是静默降级回空壳。
 *
 * 一律 `spawnSync(process.execPath, argv)`：中文标题与含空格路径经 cmd.exe
 * 会丢引号，字符串拼接在 Windows 上必炸；argv 直传无此问题。
 */
function addWebAppViaProject(
  root: string,
  fields: AddWebFields
): AddWebAppResult | null {
  if (!fs.existsSync(path.join(root, "scripts", "add-web.ts"))) {
    console.error(
      `❌ 目标项目缺少 scripts/add-web.ts：增端要克隆项目自己的默认端，旧版脚手架产物没有这个脚本。`
    )
    console.error(
      `   请用最新模板重新生成项目；已有项目可从模板仓库补齐 scripts/add-web.ts 后重试。`
    )
    return null
  }
  const argv = [
    "run",
    "scripts/add-web.ts",
    "--id",
    fields.id,
    "--title",
    fields.title,
    "--json",
  ]
  if (fields.base !== undefined) argv.push("--base", fields.base)
  if (fields.devPort !== undefined) argv.push("--dev-port", String(fields.devPort))
  if (fields.restrictAccess) argv.push("--access-permission")
  if (fields.blank) argv.push("--blank")

  const run = spawnSync(process.execPath, argv, { cwd: root, encoding: "utf8" })
  if (run.status !== 0) {
    const detail = (run.stderr || run.stdout || "").trim()
    console.error(`❌ 新增端 "${fields.id}" 失败：${detail}`)
    if (fields.blank && /参数 --blank 缺少取值|未知参数/.test(detail)) {
      console.error(
        "   目标项目的 scripts/add-web.ts 版本较旧，不支持 --blank；请从最新模板仓库同步 scripts/add-web.ts 后重试，或省略 --blank 再清理页面。"
      )
    }
    return null
  }
  try {
    return JSON.parse(run.stdout) as AddWebAppResult
  } catch {
    console.error(
      `❌ scripts/add-web.ts --json 的输出不是合法 JSON：${run.stdout.trim()}`
    )
    return null
  }
}

/** 克隆继承来的业务切片 / 页面清单：让团队有意识地决定删留，而不是静默带过去。 */
function printInheritedContent(result: AddWebAppResult): void {
  if (result.inheritedModules.length > 0) {
    console.log(
      `   📦 继承的业务模块切片（${result.inheritedModules.length} 个，随后自动剥离）：${result.inheritedModules.join("、")}`
    )
  }
  if (result.inheritedPages.length > 0) {
    console.log(
      `   📄 继承的页面（${result.inheritedPages.length} 项，请确认删留）：${result.inheritedPages.join("、")}`
    )
    console.log(
      "      手写的业务页没有 module:* 区块，不会被 --all-modules 剥掉，需人工删除。"
    )
  }
}

/**
 * 剥掉新端从默认端继承的业务模块切片（`remove:module --app <id> --all-modules`）。
 *
 * 必须在 install 之后：收尾的 imports:prune 依赖 TS 语言服务。
 * 探测到 0 个模块时脚本静默成功——init 的模板仓库本来就没有生成模块。
 */
function stripInheritedModules(root: string, appId: string): boolean {
  console.log(`\n🧹 Stripping inherited module slices from apps/${appId}...`)
  const run = spawnSync(
    process.execPath,
    [
      "run",
      "scripts/gen-module.ts",
      "--remove",
      "--app",
      appId,
      "--all-modules",
      "--force",
    ],
    { cwd: root, stdio: "inherit" }
  )
  return run.status === 0
}

/** 剥切片失败时的补救命令（端已成形，remove:web 是干净撤销路径）。 */
function stripModulesHint(appId: string): string {
  return `bun run remove:module --app ${appId} --all-modules --force`
}

/**
 * 新增端文件的 lint + 格式化。
 *
 * 克隆体逐字节等于默认端，但身份改写与注册区块插入可能让个别行超出 Prettier
 * 宽度；首日不收敛的话后续 `add:web → remove:web` 往返会因格式化产生无关 diff。
 * 失败不 fail-fast：只打印补救命令，`bun run check` 仍会暴露问题。
 */
function formatWebAppFiles(root: string, files: string[]): void {
  // 继承的业务切片随后会被 --all-modules 剥掉，克隆清单里那些路径已不存在。
  // eslint / prettier 遇到一个缺失路径就整批非零退出，会让其余文件全部漏格式化。
  const unique = [...new Set(files)].filter((rel) =>
    fs.existsSync(path.join(root, rel))
  )
  if (unique.length === 0) return
  const tsFiles = unique.filter((rel) => /\.tsx?$/.test(rel))
  // 只放 prettier 有解析器的扩展名：Dockerfile / svg 一个不认识就让整批返回非零。
  const prettierFiles = unique.filter((rel) =>
    /\.(tsx?|jsx?|json|css|html|md)$/.test(rel)
  )
  const steps: Array<[string, string[]]> = []
  if (tsFiles.length > 0) {
    steps.push(["eslint --fix", ["x", "eslint", "--fix", "--no-cache", ...tsFiles]])
  }
  if (prettierFiles.length > 0) {
    steps.push(["prettier --write", ["x", "prettier", "--write", ...prettierFiles]])
  }
  for (const [label, argv] of steps) {
    const run = spawnSync(process.execPath, argv, {
      cwd: root,
      encoding: "utf8",
    })
    if (run.status !== 0) {
      const stderr = (run.stderr || "").trim()
      if (stderr) console.warn(stderr)
      console.warn(
        `⚠️ ${label} 失败，请手动补跑：cd "${root}" && bun ${argv.join(" ")}`
      )
    }
  }
}

/** 新端生成后的准入授权提示（admin 由 ALL_PERMISSIONS 自动持有）。 */
function printAccessGrantHint(entry: {
  id: string
  accessPermission?: string
}): void {
  if (!entry.accessPermission) return
  const key = `APP_${entry.id.toUpperCase().replaceAll("-", "_")}`
  console.log(
    `\n🔐 已注册端准入权限 ${entry.accessPermission}（admin 自动持有）。`
  )
  console.log(
    `   其他角色需要进入本端时，在 packages/shared/src/permissions.ts 的 ROLE_PERMISSIONS 里加上 PERMISSIONS.${key}。`
  )
  console.log(
    "   注意：端准入只是体验层拦截，真正的越权防线仍是后端各路由的 requirePermission。"
  )
}

function runAddWeb(): void {
  const root = path.resolve(target!)
  const restrictAccess = params["access-permission"] === "true"
  const blank = params["blank"] === "true"
  try {
    validateWebAppFields({
      id: params["id"],
      title: params["title"],
      base: params["base"],
      devPort,
      accessPermission: restrictAccess,
      blank,
    })
  } catch (err) {
    console.error(`❌ 参数无效：${(err as Error).message}`)
    process.exit(1)
  }

  console.log("🔧 Adding a Web app:")
  console.log(`   Target Path: ${root}`)

  const result = addWebAppViaProject(root, {
    id: params["id"],
    title: params["title"],
    base: params["base"],
    devPort,
    restrictAccess,
    blank,
  })
  if (!result) process.exit(1)

  const { entry, createdFiles, modifiedFiles } = result
  console.log(
    `   ✓ apps/${entry.id}（${createdFiles.length} 个文件，${blank ? "极简独立空壳" : "克隆默认端"}）`
  )
  for (const rel of modifiedFiles) console.log(`   ✓ ${rel}`)
  printInheritedContent(result)

  console.log("\n📦 Installing dependencies...")
  const install = spawnSync(process.execPath, ["install"], {
    cwd: root,
    stdio: "inherit",
  })
  if (install.status !== 0) {
    console.error("❌ bun install 失败，端文件已生成但依赖未就绪。")
    console.error(
      blank
        ? `   修复后手动执行：cd "${root}" && bun install && bun run check`
        : `   修复后手动执行：cd "${root}" && bun install && ${stripModulesHint(entry.id)} && bun run check`
    )
    process.exit(1)
  }

  if (!blank && !stripInheritedModules(root, entry.id)) {
    console.error(
      `\n❌ 继承的业务切片未剥离干净（多半是区块外仍有反向引用）。端已保留在 ${root}。`
    )
    console.error(
      `   按提示解除引用后补跑：cd "${root}" && ${stripModulesHint(entry.id)} && bun run check`
    )
    console.error(`   或整体撤销本端：bun run remove:web --id ${entry.id}`)
    process.exit(1)
  }

  formatWebAppFiles(root, [...createdFiles, ...modifiedFiles])

  console.log("\n🔍 Running bun run check...")
  // `bun scaffold.ts` 直接执行时 Bun 隐式设 NODE_ENV=production，继承下去会让
  // react-dom 走 production 分支（没有 act），ui / web-core 的 render 用例全崩。
  const check = spawnSync(process.execPath, ["run", "check"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "test" },
  })
  if (check.status !== 0) {
    console.error(
      `\n❌ 门禁未通过。端文件已保留在 ${root}，修复后重跑 bun run check。`
    )
    process.exit(1)
  }

  console.log(`\n🎉 Web app "${entry.id}" added successfully!`)
  console.log("\nNext steps:")
  console.log(
    `  1. 开发：bun run dev，访问 http://localhost:${entry.devPort}${entry.base}`
  )
  console.log(
    `  2. 生产：同源子路径 ${entry.base}（由 API 静态托管，无需额外容器/端口）`
  )
  console.log(
    blank
      ? `  3. 定制端布局：按需编写 apps/${entry.id}/src/ 专属布局与页面`
      : `  3. 本端加业务模块：bun run gen:module --name <模块> --label "<中文名>" --app ${entry.id}（后端域须已存在）`
  )
  console.log(`  4. 删除本端：bun run remove:web --id ${entry.id}`)
  printAccessGrantHint(entry)
}

// ── Init Mode below ─────────────────────────────────────────────────────────

// --clean-notifications：未显式传参时 TTY 交互询问，非 TTY 默认 false（保留消息中心）
const cleanNotifications = resolveCleanNotifications(cleanNotificationsRaw)

console.log(`🚀 Starting scaffolding:`)
console.log(`   Project Name:   ${name}`)
console.log(`   Target Path:    ${targetPath}`)
console.log(`   Type:           ${type}`)
console.log(`   Clean Demo:     ${cleanDemo}`)
console.log(`   Clean Audit:    ${cleanAuditLog}`)
console.log(`   Clean Notify:   ${cleanNotifications}`)
console.log(`   Database/ORM:   ${dbChoice}`)

// Ensure target exists and is empty (or force is enabled)
if (fs.existsSync(targetPath)) {
  const files = fs.readdirSync(targetPath)
  const allowedItems = [".git", ".agents", ".gemini", ".editor-config", ".DS_Store"]
  if (
    !force &&
    files.length > 0 &&
    !files.every((f) => allowedItems.includes(f))
  ) {
    console.error(
      `Error: Target directory is not empty. Use --force to proceed anyway: ${targetPath}`
    )
    process.exit(1)
  }
} else {
  fs.mkdirSync(targetPath, { recursive: true })
}

// 排除策略（含 docs 白名单、产物模式、模板专属部署文件）集中在 lib/template-copy.ts，
// 由守卫测试对真实仓库断言「被排除的文档不会被任何复制过去的文件引用」。
function copyRecursive(src: string, dest: string) {
  const relPath = path.relative(templateCachePath, src)
  if (isExcludedFromTemplate(relPath)) return

  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true })
    }
    const files = fs.readdirSync(src)
    for (const file of files) {
      copyRecursive(path.join(src, file), path.join(dest, file))
    }
  } else {
    fs.copyFileSync(src, dest)
  }
}

console.log("📦 Copying template files from cache...")
copyRecursive(templateCachePath, targetPath)

// 模板专属文件/规则不能进入生成项目：
// - init.sql / gen-init-sql 是模板的「单份初始化脚本」模式；
//   生成项目改用 drizzle 迁移（下方 db:generate 会按 schema.ts 生成 baseline）。
// - AGENTS.md / README.md 的 template-only region 是模板仓库规则，生成项目不适用
//   （README 稍后会改名为 DESIGN_SYSTEM.md 作为设计参考，同样必须已剥离）。
function stripTemplateOnlyArtifacts(root: string): void {
  for (const fileName of ["AGENTS.md", "README.md"]) {
    const filePath = path.join(root, fileName)
    if (!fs.existsSync(filePath)) continue
    const content = fs.readFileSync(filePath, "utf8")
    const stripped = stripTemplateOnlyMarkdownRegions(content)
    if (stripped !== content) {
      fs.writeFileSync(filePath, stripped)
      console.log(`   Stripped template-only rules from ${fileName}`)
    }
  }

  const apiDir = path.join(root, "apps", "api")
  if (!fs.existsSync(apiDir)) return

  const templateOnlyFiles = [
    path.join(apiDir, "init.sql"),
    path.join(apiDir, "scripts", "gen-init-sql.ts"),
  ]
  for (const filePath of templateOnlyFiles) {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true })
      console.log(`   Removed template-only: ${path.relative(root, filePath)}`)
    }
  }

  const apiPkgPath = path.join(apiDir, "package.json")
  if (fs.existsSync(apiPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(apiPkgPath, "utf8"))
    let changed = false
    for (const key of ["db:init:generate", "db:init:check"]) {
      if (pkg.scripts && key in pkg.scripts) {
        delete pkg.scripts[key]
        changed = true
      }
    }
    if (changed)
      fs.writeFileSync(apiPkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  }
}

stripTemplateOnlyArtifacts(targetPath)

// 3. Perform Transformations based on Type
if (type === "flat-go" || type === "flat-java") {
  console.log(`🔧 Reorganizing to Flat Dual-Directory Structure...`)

  const frontendPath = path.join(targetPath, "frontend")
  const backendPath = path.join(targetPath, "backend")

  // Move apps/web to frontend (handles cross-volume movements)
  const oldWebPath = path.join(targetPath, "apps", "web")
  if (fs.existsSync(oldWebPath)) {
    try {
      fs.renameSync(oldWebPath, frontendPath)
    } catch (e) {
      fs.cpSync(oldWebPath, frontendPath, { recursive: true })
      fs.rmSync(oldWebPath, { recursive: true, force: true })
    }
  }

  // Remove monorepo folders
  const appsDir = path.join(targetPath, "apps")
  const packagesDir = path.join(targetPath, "packages")
  if (fs.existsSync(appsDir))
    fs.rmSync(appsDir, { recursive: true, force: true })
  if (fs.existsSync(packagesDir))
    fs.rmSync(packagesDir, { recursive: true, force: true })

  // Remove root configuration files that belong to monorepo
  // gen:module 生成器依赖 apps/api + packages/shared，flat 模板无后端契约层，随 apps/ 一起移除
  const rootFilesToRemove = [
    "package.json",
    "bun.lock",
    "eslint.config.js",
    "init.sh",
    // gen:module 生成器（连同 remove 子目录）在 flat 项目不存在，整目录删除
    "scripts/gen-module.ts",
    "scripts/gen-module.test.ts",
    "scripts/gen-module",
    "scripts/tsconfig.json",
    // 依赖 apps/ + packages/ 的 monorepo 专属测试，flat 产物里不可运行
    "scripts/lib/code-regions.test.ts",
    "scripts/lib/long-file-ratchet.test.ts",
    "scripts/prune-unused-imports.test.ts",
    // scripts/prune-unused-imports.ts / lib/code-regions.ts / lib/long-file-ratchet.ts
    // 必须保留：flat strip 后仍要跑 imports:prune 剪 import、区块引擎与棘轮剪枝也在这层。
    ".agents/skills/business-feature-builder",
    "docs/specs",
    "WORKFLOW.md",
  ]
  for (const file of rootFilesToRemove) {
    const fPath = path.join(targetPath, file)
    if (fs.existsSync(fPath)) fs.rmSync(fPath, { recursive: true, force: true })
  }

  // Create backend
  fs.mkdirSync(backendPath, { recursive: true })

  if (type === "flat-go") {
    // Generate Go Backend
    console.log("🐹 Generating Go backend template...")
    fs.writeFileSync(
      path.join(backendPath, "go.mod"),
      readTemplate("go/go.mod.template", { PROJECT_NAME: name })
    )

    if (dbChoice === "gorm") {
      fs.writeFileSync(
        path.join(backendPath, "main.go"),
        readTemplate("go/main.go.gorm.template")
      )
    } else {
      fs.writeFileSync(
        path.join(backendPath, "main.go"),
        readTemplate("go/main.go.template")
      )
    }
  } else if (type === "flat-java") {
    // Generate Kotlin + Gradle Backend
    console.log(
      "☕ Generating Spring Boot + Kotlin + Gradle backend template..."
    )
    const packageDir = path.join(
      backendPath,
      "src",
      "main",
      "kotlin",
      "com",
      "example"
    )
    fs.mkdirSync(packageDir, { recursive: true })

    fs.writeFileSync(
      path.join(backendPath, "settings.gradle.kts"),
      'rootProject.name = "backend"\n'
    )

    if (dbChoice === "jpa") {
      fs.writeFileSync(
        path.join(backendPath, "build.gradle.kts"),
        readTemplate("kotlin/build.gradle.kts.jpa.template")
      )

      fs.writeFileSync(
        path.join(packageDir, "App.kt"),
        readTemplate("kotlin/App.kt.jpa.template")
      )
    } else {
      fs.writeFileSync(
        path.join(backendPath, "build.gradle.kts"),
        readTemplate("kotlin/build.gradle.kts.template")
      )

      fs.writeFileSync(
        path.join(packageDir, "App.kt"),
        readTemplate("kotlin/App.kt.template")
      )
    }
  }

  // Generate Taskfile.yml
  console.log("📝 Generating Taskfile.yml...")
  let backendDevCmd = ""
  if (type === "flat-go") {
    backendDevCmd = "go run main.go"
  } else {
    backendDevCmd = "gradle bootRun"
  }
  fs.writeFileSync(
    path.join(targetPath, "Taskfile.yml"),
    readTemplate("taskfile/Taskfile.yml.template", {
      BACKEND_DEV_CMD: backendDevCmd,
    })
  )

  // Update frontend package name
  const frontPkgPath = path.join(frontendPath, "package.json")
  if (fs.existsSync(frontPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(frontPkgPath, "utf8"))
    pkg.name = `${name}-frontend`
    fs.writeFileSync(frontPkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  }

  // Update frontend index.html title
  const frontHtmlPath = path.join(frontendPath, "index.html")
  if (fs.existsSync(frontHtmlPath)) {
    let html = fs.readFileSync(frontHtmlPath, "utf8")
    html = html.replace(/<title>.*<\/title>/, `<title>${name}</title>`)
    fs.writeFileSync(frontHtmlPath, html)
  }

  // Update frontend vite.config.ts proxy target to localhost:8080
  const viteConfigPath = path.join(frontendPath, "vite.config.ts")
  if (fs.existsSync(viteConfigPath)) {
    let config = fs.readFileSync(viteConfigPath, "utf8")
    config = config.replace(
      /target:\s*['"]http:\/\/localhost:3000['"]/g,
      `target: "http://localhost:8080"`
    )
    fs.writeFileSync(viteConfigPath, config)
  }

  // Prettier 配置迁移：flat 项目的前端是 frontend/、且根目录没有 node_modules
  // （root package.json 已删除），根级 .prettierrc 里的 tailwind 插件会解析失败。
  // 迁到 frontend/ 并把 tailwindStylesheet 改为 frontend 内相对路径，
  // 保证 install 后的 prettier --write（以及用户 `cd frontend && bun run format`）可用。
  const rootPrettierConfig = path.join(targetPath, ".prettierrc")
  if (fs.existsSync(rootPrettierConfig)) {
    const config = fs
      .readFileSync(rootPrettierConfig, "utf8")
      .replaceAll("./apps/web/src/index.css", "./src/index.css")
    fs.writeFileSync(path.join(frontendPath, ".prettierrc"), config)
    fs.rmSync(rootPrettierConfig, { force: true })
  }
  const rootPrettierIgnore = path.join(targetPath, ".prettierignore")
  if (fs.existsSync(rootPrettierIgnore)) {
    fs.renameSync(
      rootPrettierIgnore,
      path.join(frontendPath, ".prettierignore")
    )
  }
} else {
  // Monorepo case
  console.log(`🔧 Configuring Monorepo...`)
  // Update root package.json name
  const rootPkgPath = path.join(targetPath, "package.json")
  if (fs.existsSync(rootPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"))
    pkg.name = name
    fs.writeFileSync(rootPkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  }

  // Update apps/web/index.html title
  const webHtmlPath = path.join(targetPath, "apps", "web", "index.html")
  if (fs.existsSync(webHtmlPath)) {
    let html = fs.readFileSync(webHtmlPath, "utf8")
    html = html.replace(/<title>.*<\/title>/, `<title>${name}</title>`)
    fs.writeFileSync(webHtmlPath, html)
  }

  // Delete init.sh as it is already run/not needed
  const initShPath = path.join(targetPath, "init.sh")
  if (fs.existsSync(initShPath)) fs.rmSync(initShPath, { force: true })

  // Strip database layer when --db none is selected (template ships with Drizzle built-in)
  if (dbChoice === "none") {
    console.log("🧹 Stripping database layer (--db none)...")
    const apiPath = path.join(targetPath, "apps", "api")
    const apiSrcPath = path.join(apiPath, "src")

    // Remove db directory, drizzle config, and migration output
    const dbDir = path.join(apiSrcPath, "db")
    const drizzleConfig = path.join(apiPath, "drizzle.config.ts")
    const drizzleDir = path.join(apiPath, "drizzle")
    if (fs.existsSync(dbDir)) fs.rmSync(dbDir, { recursive: true, force: true })
    if (fs.existsSync(drizzleConfig)) fs.rmSync(drizzleConfig, { force: true })
    if (fs.existsSync(drizzleDir))
      fs.rmSync(drizzleDir, { recursive: true, force: true })

    // Remove drizzle deps & scripts from package.json
    const apiPkgPath = path.join(apiPath, "package.json")
    if (fs.existsSync(apiPkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(apiPkgPath, "utf8"))
      if (pkg.dependencies) delete pkg.dependencies["drizzle-orm"]
      if (pkg.devDependencies) delete pkg.devDependencies["drizzle-kit"]
      if (pkg.scripts) {
        delete pkg.scripts["db:generate"]
        delete pkg.scripts["db:migrate"]
      }
      fs.writeFileSync(apiPkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    }

    // Rewrite index.ts to remove all DB code
    const indexTsPath = path.join(apiSrcPath, "index.ts")
    if (fs.existsSync(indexTsPath)) {
      let content = fs.readFileSync(indexTsPath, "utf8")

      // Remove DB-related imports
      content = content.replace(/import \{ eq \} from 'drizzle-orm'\n/g, "")
      content = content.replace(
        /import \{ migrate \} from 'drizzle-orm\/bun-sqlite\/migrator'\n/g,
        ""
      )
      content = content.replace(/import path from 'path'\n/g, "")
      content = content.replace(/\nimport \{ db \} from '.\/db'\n/g, "\n")
      content = content.replace(
        /import \{ users \} from '.\/db\/schema'\n/g,
        ""
      )

      // Remove Migration & Seed block
      content = content.replace(
        /\/\/ ─── Database Migration & Seed[\s\S]*?\n\n(?=\/\/ ─── Routes)/,
        ""
      )

      // Remove /users endpoint
      content = content.replace(/app\.get\('\/users'[\s\S]*?\}\)\n\n/, "")

      // Remove DB auth check in login, keep Fallback as primary
      content = content.replace(
        / {2}\/\/ 先从数据库中查找用户[\s\S]*?\/\/ Fallback: Demo 模式\n/,
        "  // Demo 模式：任意合法 email + 6位以上密码即可登录\n"
      )

      fs.writeFileSync(indexTsPath, content)
    }
    console.log("✅ Database layer stripped.")
  }
  // When --db drizzle: template already ships with Drizzle built-in, no action needed.
}

// 3.4 Tier 1 特性剥离（清单 + 执行器随模板版本化）
//
// 处理顺序：copy → stripTemplateOnlyArtifacts → flat 重组织 / monorepo 适配之后、
// CI stamping 与 README 改写之前。生成项目不保留 feature:* 标记：被剥离特性执行
// stripRegions，保留特性执行 unwrapRegions；scaffold 不再维护针对模板源码的正则。
const webSrcDir = type === "monorepo" ? "apps/web/src" : "frontend/src"

// flat 模板没有 audit_logs 内核与 /logs API，审计查看器页必然指向 404 路由 → 恒清理；
// monorepo 默认保留（Tier 0 的 modules/log 只读 API 始终保留），--clean-audit-log true 才剥 UI。
const removeFeatures: string[] = []
if (type !== "monorepo" || cleanAuditLog) removeFeatures.push("audit-log")
if (cleanNotifications) removeFeatures.push("notification")
if (cleanDemo) removeFeatures.push("demo")

console.log(
  `🧹 Stripping optional features (${removeFeatures.length > 0 ? removeFeatures.join(", ") : "none; unwrap feature markers"})...`
)
// argv 直传：字符串拼接经 cmd.exe 时，含空格 / 中文的目标路径会断在 shell 上
// （`--web-root C:\Users\John Doe\proj` 会被拆成两个参数）。
const strip = spawnSync(
  process.execPath,
  [
    "run",
    "scripts/strip-features.ts",
    "--web-root",
    webSrcDir,
    "--report",
    STRIP_FEATURES_REPORT,
    ...(removeFeatures.length > 0
      ? ["--remove", removeFeatures.join(",")]
      : []),
  ],
  { cwd: targetPath, stdio: "inherit" }
)
if (strip.error || strip.status !== 0) {
  console.error(
    `❌ 特性剥离失败：${strip.error?.message ?? `exit ${strip.status}`}`
  )
  console.error(`   目标目录已保留：${targetPath}`)
  console.error("   修复后手动重跑：")
  console.error(
    `     cd "${targetPath}" && bun scripts/strip-features.ts --web-root "${webSrcDir}"${
      removeFeatures.length > 0 ? ` --remove ${removeFeatures.join(",")}` : ""
    }`
  )
  process.exit(1)
}

// 区块剥离只改注释 / 代码（import 按设计不打区块），install 完成后再统一清理 / 规范化：
// imports:prune（未使用 import）→ eslint --fix（排序）→ prettier --write（幂等形态）。
const stripReport = readStripReport(targetPath)
const strippedModifiedFiles = [...new Set(stripReport?.modified ?? [])].filter(
  (rel) => fs.existsSync(path.join(targetPath, rel))
)
const strippedTsFiles = strippedModifiedFiles.filter((rel) =>
  /\.(ts|tsx)$/.test(rel)
)
// prettier 同时覆盖被改动过的 Markdown 文档（AGENTS / README→DESIGN_SYSTEM / 技能文档区块剥离后可能折行漂移）。
const strippedFormatFiles = [
  ...new Set(
    strippedModifiedFiles
      .filter((rel) => /\.(ts|tsx|md)$/.test(rel))
      .flatMap((rel) =>
        rel === "README.md" ? ["README.md", "DESIGN_SYSTEM.md"] : [rel]
      )
  ),
]
const stripRemediationHints = formattingRemediationHints(
  targetPath,
  type as ScaffoldType,
  strippedTsFiles,
  strippedFormatFiles
)

// 3.5 Rewrite README.md and adjust AGENTS.md
console.log("📝 Adjusting README.md and AGENTS.md...")

const readmePath = path.join(targetPath, "README.md")
const agentsPath = path.join(targetPath, "AGENTS.md")

// Archive original README.md as DESIGN_SYSTEM.md so users retain style reference
if (fs.existsSync(readmePath)) {
  fs.renameSync(readmePath, path.join(targetPath, "DESIGN_SYSTEM.md"))
}

// 模板 demo 仪表盘截图被 docs 白名单排除，设计参考文档里的图片引用必须一并删掉，
// 否则生成项目 DESIGN_SYSTEM.md 断图。
const designSystemPath = path.join(targetPath, "DESIGN_SYSTEM.md")
if (fs.existsSync(designSystemPath)) {
  const design = fs.readFileSync(designSystemPath, "utf8")
  const withoutPreview = stripDashboardPreviewImage(design)
  if (withoutPreview !== design) {
    fs.writeFileSync(designSystemPath, withoutPreview)
  }
}

// flat 模板不含 gen:module 生成器（scripts/gen-module.ts 已删除）：裁掉设计参考文档里
// 的生成器章节与相关命令行，避免生成项目文档指向不存在的脚本。
if (type !== "monorepo") {
  const designPath = path.join(targetPath, "DESIGN_SYSTEM.md")
  if (fs.existsSync(designPath)) {
    let design = fs.readFileSync(designPath, "utf8")
    design = design.replace(
      /## 🧱 业务模块生成器（`gen:module`）[\s\S]*?\n---\n/,
      ""
    )
    design = design.replace(/\n\| `bun run gen:module`[^\n]*\n/, "\n")
    design = design.replace(/\n\| `bun run test:scripts`[^\n]*\n/, "\n")
    design = design.replace(
      "（`test:eslint` + `test:scripts` + `shared` + `web` + `api`）",
      "（`test:eslint` + `shared` + `web` + `api`）"
    )
    fs.writeFileSync(designPath, design)
    console.log(
      "   Stripped gen:module docs from DESIGN_SYSTEM.md (flat 模板无生成器)"
    )
  }
}

// Write a clean, project-specific README.md
const monorepoWorkflowSection =
  type === "monorepo"
    ? `
## AI-Native Business Development
- **Human-AI Workflow Guide**: [WORKFLOW.md](WORKFLOW.md) (raw PRD/HTML archiving in \`docs/requirements/v<X.Y>/\`, living specs in \`docs/specs/<name>.md\`)
- **AI Developer Rules**: [AGENTS.md](AGENTS.md)
- **Scaffold a Business Module**: \`bun run gen:module --name <name> --label "<中文名>" --icon FileText\`
- **Run Full Quality Gates**: \`bun run check\`
`
    : ""

const newReadmeContent = `# ${name}

This project was bootstrapped from Liquid Glass Starter.

## Architecture & Tech Stack
- **Frontend**: React + Vite + Tailwind CSS v4 (located in \`${type === "monorepo" ? "apps/web" : "frontend"}\`)
- **Backend**: ${type === "monorepo" ? "Hono (Node/Bun SPA API)" : type === "flat-go" ? "Go (API Server)" : "Spring Boot (Kotlin + Gradle)"} (located in \`${type === "monorepo" ? "apps/api" : "backend"}\`)
${type === "monorepo" ? "- **Workspaces**: Managed via Bun Workspaces (monorepo)" : "- **Workspaces**: Flat dual-directory project"}

## Getting Started
1. Install dependencies:
   \`\`\`bash
   ${type === "monorepo" ? "bun install" : "cd frontend && bun install"}
   \`\`\`
2. Start the development servers:
   - Run: \`${type === "monorepo" ? "bun run dev" : "task dev"}\`
${monorepoWorkflowSection}
## Design System
- Refer to [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for utility classes, tokens, and visual components overview.
`

fs.writeFileSync(readmePath, newReadmeContent)

// 3.6 品牌信息：用项目名重写 app-config.ts（品牌唯一事实源），并同步 index.html 静态 title。
//    模板仓库的 Liquid Glass 品牌到此为止；生成项目标题 / 侧边栏 / 登录页都读 APP_NAME。
{
  const appConfigPath = path.join(targetPath, webSrcDir, "lib", "app-config.ts")
  const displayName = name!
  const year = new Date().getFullYear()
  const appConfigContent = `/**
 * 应用品牌配置 —— 品牌名的唯一事实源（标题 / 侧边栏 / 登录页 / 兜底标题共用）。
 *
 * 需要改品牌只改这里；index.html 的静态 title 在脚手架生成时已同步替换。
 */
export const APP_NAME = ${JSON.stringify(displayName)}

/** 文档标题（首屏静态 title 由 index.html 提供，运行期由 main.tsx 覆盖） */
export const APP_TITLE = ${JSON.stringify(displayName)}

/** 页脚版权文案 */
export const APP_COPYRIGHT = ${JSON.stringify(`© ${year} ${displayName}`)}
`
  fs.writeFileSync(appConfigPath, appConfigContent)

  const indexPath = path.join(targetPath, webSrcDir, "..", "index.html")
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, "utf8")
    // 只按 <title>…</title> 标签替换：模板标题文案变化（或用户手改过标题）时不会
    // 静默漏改；项目名做 HTML 转义，避免 & < > 破坏静态文档结构。
    const escapedName = displayName
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
    const titleTag = /<title>[\s\S]*?<\/title>/
    if (titleTag.test(html)) {
      fs.writeFileSync(
        indexPath,
        html.replace(titleTag, `<title>${escapedName}</title>`)
      )
    } else {
      console.warn(
        "   ⚠️  index.html 未找到 <title> 标签，跳过静态标题替换（运行期仍由 APP_TITLE 覆盖）"
      )
    }
  }
  console.log(`   Branding stamped: APP_NAME=${displayName}`)

  // 端注册表的 title 与品牌同源，否则生成项目里默认端仍挂着模板的 Liquid Glass 名字
  const registryPath = path.join(targetPath, "web-apps.json")
  if (fs.existsSync(registryPath)) {
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as {
      apps: Array<{ id: string; title: string }>
    }
    const defaultApp = registry.apps.find((a) => a.id === "web")
    if (defaultApp) {
      defaultApp.title = displayName
      fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`)
    }
  }
}

// Adjust AGENTS.md: adapt layout-specific sections, then rewrite paths for flat
if (fs.existsSync(agentsPath)) {
  let agentsContent = fs.readFileSync(agentsPath, "utf8")

  if (type === "flat-go" || type === "flat-java") {
    const webRoot = "frontend"

    // 1. Replace Commands section (Taskfile orchestration)
    agentsContent = agentsContent.replace(
      /<!-- region:cmds -->[\s\S]*?<!-- endregion:cmds -->/,
      `<!-- region:cmds -->\n## 🛠️ Commands\n\n\`\`\`bash\ntask dev         # dev server (Taskfile orchestrates frontend + backend)\ncd frontend && bun run test     # test\ncd frontend && bun run lint:fix # lint auto-fix\n\`\`\`\n<!-- endregion:cmds -->`
    )

    // 2. Replace API section (OpenAPI-oriented for heterogeneous stacks)
    agentsContent = agentsContent.replace(
      /<!-- region:api -->[\s\S]*?<!-- endregion:api -->/,
      `<!-- region:api -->\n## 🔌 API & Service Layer\n\n- **No direct imports** of API clients or backend SDKs in UI components. Use OpenAPI contract-driven generation (e.g. Orval / openapi-typescript) for type-safe API clients.\n- Encapsulate all network logic in \`${webRoot}/src/services/\`. UI only calls service functions returning Promises.\n<!-- endregion:api -->`
    )

    // 3. Global path rewrite: apps/web → frontend (after anchor replacements)
    agentsContent = agentsContent.replaceAll("apps/web", webRoot)
  }

  fs.writeFileSync(agentsPath, agentsContent)
}

// 4. 项目类型适配（flat 模板无内置认证后端）
//
// Tier 1 特性剥离（audit-log / notification / demo）已在 3.4 段由目标项目内的
// scripts/strip-features.ts 统一完成，本段只保留「项目架构类型适配」：
// flat-* 模板没有内置认证后端，clean-demo 时移除 LoginPage 并把 ProtectedRoute 改为
// 透传、App.tsx 重写为无认证固定骨架 —— 这属于项目类型适配，不是模板正则清理。
if (cleanDemo && type !== "monorepo") {
  const pagePath = path.join(targetPath, webSrcDir, "pages")

  // LoginPage 属认证闭环而非 demo 页面：仅 flat（无登录后端）才在 clean-demo 时清理
  const loginPagePath = path.join(pagePath, "LoginPage.tsx")
  if (fs.existsSync(loginPagePath)) {
    fs.rmSync(loginPagePath, { force: true })
    console.log(`   Removed: ${webSrcDir}/pages/LoginPage.tsx`)
  }

  // flat 版 App.tsx：无登录 / 无审计 / 无 demo 路由的固定骨架
  console.log("📝 Writing clean App.tsx (flat)...")
  fs.writeFileSync(
    path.join(targetPath, webSrcDir, "App.tsx"),
    `import { lazy, Suspense } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { Toaster } from "sonner"

import RouteErrorBoundary from "@/components/layout/RouteErrorBoundary"
import SidebarLayout from "@/layouts/SidebarLayout"
import ProtectedRoute from "@/router/ProtectedRoute"

// 所有页面必须通过 React.lazy 引入（arch:check 强制）
const DashboardPage = lazy(() => import("@/pages/DashboardPage"))
const ProfileSettingsPage = lazy(() => import("@/pages/ProfileSettingsPage"))

export default function App() {
  return (
    <>
      <RouteErrorBoundary>
        <Suspense fallback={null}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route element={<SidebarLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/settings" element={<ProfileSettingsPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
      <Toaster richColors position="top-right" />
    </>
  )
}
`
  )

  // flat 模板没有登录后端：保留 bypass 版 ProtectedRoute（LoginPage 已作为 demo 清理）
  console.log("📝 Writing clean ProtectedRoute.tsx (bypassing auth)...")
  fs.writeFileSync(
    path.join(targetPath, webSrcDir, "router", "ProtectedRoute.tsx"),
    `import { Outlet } from "react-router-dom"

export default function ProtectedRoute() {
  return <Outlet />
}
`
  )
}

// 4.5 CI Stamping (opt-in via --include-ci)
if (includeCi) {
  if (type === "monorepo") {
    console.log("🔧 Stamping CI files (--include-ci)...")
    stampCi(targetPath, name!, { force: true })

    // Port allocation (mirrors add-ci logic)
    if (skipPortAlloc) {
      console.log(
        "⚠️  --skip-port-alloc: 保留模板默认端口 11070，请人工修改 compose*.yml 与 .gitlab-ci.yml。"
      )
    } else {
      try {
        const alloc = allocatePort(
          name!,
          manualPort != null ? { manualPort, source: "skill" } : {}
        )
        stampPort(targetPath, alloc.port)
        const label = alloc.reused
          ? "复用已分配"
          : manualPort != null
            ? "手动指定"
            : "自动分配"
        console.log(
          `✓ 已为 ${name} ${label}测试端口 ${alloc.port}，测试 URL: http://192.0.2.10:${alloc.port}`
        )
      } catch (err) {
        console.warn(
          `⚠️  端口分配失败，保留模板默认 11070：${(err as Error).message}`
        )
        console.warn(
          "   项目已 scaffold 完成，可在排除 SSH 问题后重跑 `--mode add-ci --force` 重新分配端口。"
        )
      }
    }
  } else {
    console.warn(
      `⚠️  --include-ci is only supported for monorepo in this iteration. Skipped for type=${type}.`
    )
  }
}

// demo 页清理（--clean-demo）与 CI stamping（--include-ci 会覆盖 arch-check.ts）都
// 可能让模板写入的棘轮条目失效；在生成流程收尾前统一按目标项目实际文件剪枝。
await pruneRatchet(targetPath)

/**
 * 校验 drizzle-kit 是否真的产出了 baseline 迁移。
 *
 * drizzle-kit 遇到 schema/config 语法错误时经常只打印 TransformError / SyntaxError，
 * 但 exit code 仍为 0（仓库的 gen-init-sql / migrate-check 已踩过同一个坑）。
 * 仅依赖 execSync 是否抛错不够，必须后置检查 journal + 至少一份 .sql。
 */
function hasGeneratedDrizzleBaseline(root: string): boolean {
  const drizzleDir = path.join(root, "apps", "api", "drizzle")
  const journalPath = path.join(drizzleDir, "meta", "_journal.json")
  if (!fs.existsSync(journalPath)) return false
  try {
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
      entries?: unknown[]
    }
    if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
      return false
    }
  } catch {
    return false
  }
  return fs.readdirSync(drizzleDir).some((file) => file.endsWith(".sql"))
}

// 4.55 追加 Web 端（--web-apps）
// 放在默认端全部改造（demo 清理 / 特性剥离 / CI stamping）之后、install 之前：
// base 冲突检查要读改造后的默认端路由；add-web.ts 只依赖 node 内置与项目内纯 TS lib，
// install 之前就能跑。依赖安装 / 切片剥离 / 门禁则只在最后跑一次。
const extraWebAppFiles: string[] = []
const extraWebAppRecords: Array<{
  entry: AddWebAppResult["entry"]
  blank: boolean
}> = []
for (const extra of extraWebApps) {
  console.log(`\n🌐 Adding extra Web app: ${extra.id}`)
  const blank = extra.blank === true
  const result = addWebAppViaProject(targetPath, {
    id: extra.id,
    title: extra.title,
    base: extra.base,
    devPort: extra.devPort,
    restrictAccess: extra.accessPermission === true,
    blank,
  })
  if (!result) {
    console.error(
      `   目标目录是半成品（默认端改造已中断，未跑 imports:prune / install），不要在此基础上跑 --mode add-web。`
    )
    console.error(`   请删掉 ${targetPath} 后修正参数重跑 init。`)
    process.exit(1)
  }
  extraWebAppFiles.push(...result.createdFiles, ...result.modifiedFiles)
  extraWebAppRecords.push({ entry: result.entry, blank })
  console.log(
    `   ✓ apps/${result.entry.id} → http://localhost:${result.entry.devPort}${result.entry.base}`
  )
  printInheritedContent(result)
}

// 4.6 Install Dependencies
// 生成项目的数据库结构来自 drizzle baseline：install 或 db:generate 失败时，
// 项目既没有 init.sql 也没有迁移链，API 首次访问 DB 必然失败。这类失败必须
// fail-fast（保留已生成文件并给出恢复命令），绝不能打印「🎉 成功」。
console.log("📦 Installing project dependencies...")
let fatalSetupError: string | null = null
try {
  const installCwd =
    type === "monorepo" ? targetPath : path.join(targetPath, "frontend")
  execSync("bun install", {
    cwd: installCwd,
    stdio: "inherit",
    // husky 的 prepare 需要 .git，而脚手架在安装完成后才 git init：先跳过，git 就绪后再补装。
    env: { ...process.env, HUSKY: "0" },
  })
  console.log("✅ Dependencies installed successfully.")

  // Post-install DB migrations generation / module fetching
  if (type === "monorepo") {
    console.log("🏗️ Building shared packages...")
    try {
      execSync("bun run build:shared", { cwd: targetPath, stdio: "inherit" })
      console.log("✅ Shared packages built successfully.")
    } catch (e) {
      console.warn(
        '⚠️ Failed to build shared packages automatically. Please run "bun run build:shared" manually.'
      )
    }
  }

  // 特性区块剥离后残留的未使用 import（如删路由后的 lazy 常量、删菜单后的图标）
  // 依赖已安装，用 TS 语言服务 organizeImports RemoveUnused 清理，再交给 eslint --fix 收敛排序。
  //
  // 克隆体逐字节等于「特性剥离后、imports:prune 之前」的默认端，同样带着这些残留：
  // 只清默认端会让新端 typecheck 挂在 noUnusedLocals 上，必须把同一批路径映射进各新端一起清。
  const cloneStripFiles = (files: string[]): string[] => {
    const prefix = `apps/${DEFAULT_WEB_APP_ID}/`
    return extraWebAppRecords
      .filter((record) => !record.blank)
      .flatMap((record) =>
        files
          .filter((rel) => rel.startsWith(prefix))
          .map((rel) => `apps/${record.entry.id}/${rel.slice(prefix.length)}`)
          .filter((rel) => fs.existsSync(path.join(targetPath, rel)))
      )
  }
  cleanupStrippedFeatureFiles(
    targetPath,
    type as ScaffoldType,
    [...strippedTsFiles, ...cloneStripFiles(strippedTsFiles)],
    [...strippedFormatFiles, ...cloneStripFiles(strippedFormatFiles)]
  )

  // 新端继承的业务模块切片在这里剥（需要 TS 语言服务，必须在 install 之后）。
  // `--blank` 空壳端不克隆业务模块；其余端在模板仓库无模块时探测到 0 个也会静默成功。
  for (const record of extraWebAppRecords) {
    if (record.blank) continue
    if (!stripInheritedModules(targetPath, record.entry.id)) {
      fatalSetupError = `apps/${record.entry.id} 继承的业务切片未剥离干净（区块外仍有反向引用）。按提示解引用后补跑：${stripModulesHint(record.entry.id)}`
      break
    }
  }

  formatWebAppFiles(targetPath, extraWebAppFiles)

  if (dbChoice === "drizzle") {
    // 模板不再自带迁移链（只提交单份 init.sql），生成项目必须现场生成 baseline。
    console.log("💧 Generating Drizzle baseline migration from schema...")
    try {
      execSync("bun run db:generate", {
        cwd: path.join(targetPath, "apps", "api"),
        stdio: "inherit",
      })
      if (!hasGeneratedDrizzleBaseline(targetPath)) {
        // drizzle-kit 可能“打印错误但 exit 0”，这里必须拦住，否则生成项目无迁移可跑
        fatalSetupError =
          "Drizzle baseline 迁移未生成（drizzle-kit 报错但退出码为 0，apps/api/drizzle 下没有迁移 SQL）。"
      } else {
        console.log("✅ Drizzle baseline migration generated.")
      }
    } catch (e) {
      fatalSetupError =
        "Drizzle baseline 迁移生成失败：生成项目没有 init.sql，缺少 apps/api/drizzle/ 将导致 API 无法启动。"
    }
  } else if (type === "flat-go" && dbChoice === "gorm") {
    console.log("🐹 Fetching Go GORM dependencies...")
    try {
      execSync("go get gorm.io/gorm gorm.io/driver/sqlite", {
        cwd: path.join(targetPath, "backend"),
        stdio: "inherit",
      })
      console.log("✅ Go GORM dependencies installed.")
    } catch (e) {
      console.warn(
        '⚠️ Failed to run "go get" automatically. Go may not be installed. Please run it manually.'
      )
    }
  }
} catch (e) {
  console.warn('⚠️ Failed to run "bun install" automatically.')
  if (stripRemediationHints.length > 0) {
    console.warn("   安装完成后请补跑特性剥离后的清理 / 格式化：")
    for (const hint of stripRemediationHints) {
      console.warn(`     cd ${targetPath} && ${hint}`)
    }
  }
  if (dbChoice === "drizzle") {
    fatalSetupError =
      "依赖安装失败，无法生成 Drizzle baseline 迁移（生成项目没有 init.sql，缺少 apps/api/drizzle/ 将导致 API 无法启动）。"
  }
}

// 特性剥离报告只在 install 后的 import 剪枝阶段使用，用完即删（不进入生成项目）。
if (fs.existsSync(path.join(targetPath, STRIP_FEATURES_REPORT))) {
  fs.rmSync(path.join(targetPath, STRIP_FEATURES_REPORT), { force: true })
}

if (fatalSetupError) {
  console.error(`\n❌ 项目初始化未完成：${fatalSetupError}`)
  console.error(`   目标目录已保留：${targetPath}`)
  console.error("   按以下步骤修复后即可正常使用：")
  console.error(`     cd ${targetPath}`)
  console.error("     bun install")
  console.error("     bun --filter api db:generate")
  if (stripRemediationHints.length > 0) {
    console.error("   依赖安装完成后，记得补跑特性剥离后的清理 / 格式化：")
    for (const hint of stripRemediationHints) {
      console.error(`     cd ${targetPath} && ${hint}`)
    }
  }
  console.error("   完成后再执行 bun run dev。")
  process.exit(1)
}

// 5. Git Init
console.log("🗃️ Initializing Git repository...")
let gitInitialized = false
try {
  execSync("git init", { cwd: targetPath })
  execSync("git add -A", { cwd: targetPath })
  execSync(
    'git commit -m "chore: initial commit from liquid-glass-starter" --quiet',
    { cwd: targetPath }
  )
  gitInitialized = true
  console.log("✅ Git repository initialized.")
} catch (e) {
  console.warn(
    "⚠️ Failed to initialize Git repository automatically. You may need to run git init manually."
  )
}

// install 阶段用 HUSKY=0 跳过了钩子；git 就绪后补装（flat 项目没有根 package.json）。
if (gitInitialized && type === "monorepo") {
  try {
    execSync("bun run prepare", { cwd: targetPath, stdio: "inherit" })
    console.log("✅ Git hooks installed.")
  } catch {
    console.warn(
      "⚠️ Git hooks 安装失败（不影响项目启动），可稍后手动运行：bun run prepare"
    )
  }
}

// 6. Environment Checks
console.log("\n🔍 Checking environment dependencies...")

function isCommandAvailable(cmd: string): boolean {
  try {
    const checkCmd =
      process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`
    execSync(checkCmd, { stdio: "ignore" })
    return true
  } catch (e) {
    return false
  }
}

const missingDeps: string[] = []

if (type.startsWith("flat-")) {
  if (!isCommandAvailable("task")) {
    missingDeps.push(
      "task (go-task) -> Install via: brew install go-task (macOS) or choco install go-task (Windows)"
    )
  }
}

if (type === "flat-go") {
  if (!isCommandAvailable("go")) {
    missingDeps.push(
      "go -> Install via: brew install go (macOS) or download from golang.org"
    )
  }
} else if (type === "flat-java") {
  if (!isCommandAvailable("java")) {
    missingDeps.push(
      "java (JDK 17+) -> Install via: brew install openjdk@17 (macOS) or download from oracle.com/java"
    )
  }
  if (!isCommandAvailable("gradle")) {
    missingDeps.push(
      "gradle -> Install via: brew install gradle (macOS) or download from gradle.org"
    )
  }
}

if (missingDeps.length > 0) {
  console.warn(
    "\n⚠️ Warning: Some environment dependencies are missing. Please install them to run the project correctly:"
  )
  for (const dep of missingDeps) {
    console.warn(`   - ${dep}`)
  }
} else {
  console.log("✅ All environment dependencies are met!")
}

if (extraWebAppRecords.length > 0) {
  console.log("\n🌐 已生成的 Web 端：")
  for (const record of extraWebAppRecords) {
    console.log(
      `   - ${record.entry.id}${record.blank ? "（极简空壳）" : ""} → http://localhost:${record.entry.devPort}${record.entry.base}`
    )
  }
  const clonedWebApps = extraWebAppRecords.filter((record) => !record.blank)
  if (clonedWebApps.length > 0) {
    console.log(
      "   给克隆态端加业务模块：先裸跑 gen:module 建后端域，再对该端跑 gen:module --name <模块> --app <id>"
    )
  }
  if (clonedWebApps.length < extraWebAppRecords.length) {
    console.log(
      "   极简空壳端（--blank）不生成 menu-config 与模块注册锚点，按自建布局编写页面"
    )
  }
  for (const record of extraWebAppRecords) printAccessGrantHint(record.entry)
}

console.log("\n🎉 Scaffolding completed successfully!")
process.exit(0)
