/**
 * remove:module — `gen:module` 的对称卸载器（模板仓库设计书 §6 / 实施计划 §7）
 *
 * 卸载退化为通用操作：模块归属由 `module:<name>` 代码区块声明（gen:module 生成时写入），
 * 这里只做「删模块专属文件 + 对 8 个注册文件 stripRegions + stripEmptyGroupRegions +
 * imports:prune」，不再维护 8 个 unregister* 启发式函数。
 *
 * 安全哲学：宁可报错让人工处理，也不静默产出坏仓库——
 *   - 单文件区块数量必须等于 gen:module 固定写入数（部分标记被删 → 报错）；
 *   - 容器内出现手写菜单项时保留 gen:group 容器（不整体收起误删）；
 *   - 归档目标已存在时默认拒绝覆盖（--force 才覆盖）；
 *   - `--dry-run` 不写盘，因此不受工作区脏预检拦截（只警示）。
 *
 * 执行流程（与设计书 §6.4 一一对应）：
 *   1. 存在性检查：模块文件 / 区块都不存在 → 报错「未找到模块」，不猜；
 *   2. 区块完整性：8 个注册文件必须各有 module:<name> 区块、数量等于固定写入数且配对合法，
 *      缺失/损坏/数量不符 → 报错（避免只剥一半留下悬挂代码）；
 *   3. 工作区干净预检：`git status --porcelain -- <相关路径>`（含归档目标；非 git 仓库视为
 *      干净；git status 失败 → 抛错不视为干净），`--force` 时放行；dry-run 只警示不拦截；
 *   4. 内存中计算全部删除与剥离结果（含规格书归档内容）；
 *   5. 反向引用预检：扫描 apps/ + packages/ 的**剩余内容**（注册文件用剥离后内容），
 *      命中特征（shared 相对导入 / 页面 / service / hook / shared 导出符号 / <camel>Keys /
 *      PERMISSIONS / AUDIT_MODULES / 表标识符与外键）→ 列出位置并终止；
 *   6. 一次性落盘：删文件/目录 → 写剥离结果 → 规格书归档或删除
 *      （归档目标已存在时默认拒绝，`--force` 才覆盖）；
 *   7. imports:prune + prettier + eslint --fix（--skip-format 跳过）→ build:shared →
 *      best-effort 清理 packages/shared/dist/<name>.* 构建产物 →
 *      pruneMissingLongFileRatchet；
 *   8. 数据库策略（模板 init.sql 自动重建；生成项目只提示人工审核 DROP TABLE，永不自动执行；
 *      --skip-db 跳过）；
 *   9. 打印后续建议与已知影响（历史审计 fallback / 角色权限需人工 / git 回滚指引）。
 *
 * 计算阶段（步骤 1–5）失败不产生任何写入；落盘后格式化/构建失败时，依赖「执行前工作区
 * 干净」+ Git 回滚（`git restore <模块路径> && git clean -fd <模块路径>`），不自研内存快照回滚。
 */
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

import {
  BACKEND_REGISTRATION_FILES,
  buildSharedPackage,
  buildSpec,
  formatGeneratedFiles,
  GenModuleError,
  type ModuleSpec,
  REGISTRATION_FILE_LIST,
  webSliceRegistrationFiles,
} from "../gen-module"
import {
  GROUP_REGION_PREFIX,
  listRegions,
  MODULE_REGION_PREFIX,
  parseRegions,
  type RegionInfo,
  RegionParseError,
  stripEmptyGroupRegions,
  stripRegions,
} from "../lib/code-regions"
import { pruneMissingLongFileRatchet } from "../lib/long-file-ratchet"
import { DEFAULT_WEB_APP_ID, readWebApps } from "../lib/web-apps"
import { pruneUnusedImportsInFiles } from "../prune-unused-imports"

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface RemoveModuleOptions {
  /** 仓库根目录（monorepo） */
  root: string
  /** 模块名（kebab-case，与 gen:module --name 一致） */
  name: string
  /**
   * 只拆该端的前端切片（空 = 全域卸载：后端域 + 所有探测到含该模块区块的端）。
   * 切片模式下后端域、规格书、数据库结构、shared 构建全部不动。
   */
  app?: string
  /** 全域卸载时允许连带拆掉非默认端的切片（破坏性操作的显式确认） */
  allApps?: boolean
  /** 只打印计划与预检结果，不落盘、不跑子命令 */
  dryRun?: boolean
  /** 物理删除规格书（默认归档到 docs/specs/_archived/<name>.md） */
  purgeSpec?: boolean
  /** 允许相关文件存在未提交改动（默认要求 git 工作区干净） */
  force?: boolean
  /** 跳过 imports:prune / prettier / eslint --fix */
  skipFormat?: boolean
  /** 跳过数据库结构同步 */
  skipDb?: boolean
  /** 抑制成功文案（--all-modules 批量迭代时用，收尾统一打印一次） */
  quiet?: boolean
  /**
   * dry-run 批量清场时，前几轮「已模拟移除」的切片路径。
   * 预检把它们当作已删除，否则第二轮仍会看到上一轮模块的文件，
   * 把本来能按顺序解开的跨模块引用误报成环。
   */
  simulatedDeletedPaths?: readonly string[]
}

/**
 * 卸载范围。两种生命周期刻意分开：
 * - slice：只拆一个端的前端切片，后端域保留（其他端可能还在用）
 * - domain：拆后端域 + 所有**真正含该模块区块**的端的切片
 *
 * domain 的 appIds 必须是探测结果而非全部注册端：没有该模块区块的端若进注册清单，
 * stripRegistrationFiles 会因「区块数 0」判 missing 而抛错。
 */
export type RemoveScope =
  { kind: "slice"; appId: string } | { kind: "domain"; appIds: string[] }

/** 缺省范围 = 历史行为（后端域 + 默认端切片），保证既有调用与测试逐字节不变。 */
const DEFAULT_SCOPE: RemoveScope = {
  kind: "domain",
  appIds: [DEFAULT_WEB_APP_ID],
}

/** 注册文件剥离结果（before/after 均为完整文件内容） */
export interface StrippedRegistrationFile {
  relPath: string
  before: string
  after: string
  /** 该文件内 module:<name> 区块数量 */
  regionCount: number
}

/** 一次卸载的完整计算计划（dry-run 打印与正式落盘共用） */
export interface RemoveModulePlan {
  spec: ModuleSpec
  /** 存在的模块专属文件/目录（仓库相对路径） */
  deletedPaths: string[]
  /** 规格书路径（不存在为 null） */
  specDocPath: string | null
  specAction: "archive" | "purge" | "none"
  /** 归档目标路径（specAction === "archive" 时非空） */
  archivePath: string | null
  registrationFiles: StrippedRegistrationFile[]
  /** 归档目标是否已存在（默认拒绝覆盖，--force 才覆盖） */
  archiveExists: boolean
  /** 计算阶段产生的 warning（如保留含手写内容的菜单容器） */
  warnings: string[]
  dirtyPaths: string[]
  references: ReverseReferenceHit[]
}

/** 反向引用命中位置 */
export interface ReverseReferenceHit {
  relPath: string
  line: number
  /** 命中的特征名（人读） */
  feature: string
  text: string
}

// ─── 路径推导 ────────────────────────────────────────────────────────────────

/** 后端域专属文件/目录候选（与端无关）：shared 契约 + api 模块目录 + 规格书。 */
export function backendPathCandidates(spec: ModuleSpec): {
  files: string[]
  dirs: string[]
  specDoc: string
} {
  return {
    files: [
      "packages/shared/src/" + spec.name + ".ts",
      "packages/shared/src/" + spec.name + ".test.ts",
    ],
    dirs: ["apps/api/src/modules/" + spec.name],
    specDoc: "docs/specs/" + spec.name + ".md",
  }
}

/** 某端的前端切片专属文件/目录候选：service / hook（含各自测试）+ 页面目录。 */
export function webSlicePathCandidates(
  spec: ModuleSpec,
  appId = DEFAULT_WEB_APP_ID
): { files: string[]; dirs: string[] } {
  const appSrc = "apps/" + appId + "/src/"
  return {
    files: [
      appSrc + "services/" + spec.name + ".ts",
      appSrc + "services/" + spec.name + ".test.ts",
      appSrc + "hooks/queries/use" + spec.pascal + ".ts",
      appSrc + "hooks/queries/use" + spec.pascal + ".test.tsx",
    ],
    dirs: [appSrc + "pages/" + spec.name],
  }
}

/**
 * 模块专属文件/目录候选（存在性过滤前）。
 * 与设计书 §6.3 一致：shared 契约 / api 模块目录 / web service / hook / 页面目录 / 规格书。
 * 顺序 = 后端域在前、默认端切片在后，与历史形态逐字节一致。
 */
export function modulePathCandidates(spec: ModuleSpec): {
  files: string[]
  dirs: string[]
  specDoc: string
} {
  const backend = backendPathCandidates(spec)
  const slice = webSlicePathCandidates(spec)
  return {
    files: [...backend.files, ...slice.files],
    dirs: [...backend.dirs, ...slice.dirs],
    specDoc: backend.specDoc,
  }
}

/** 按卸载范围组装删除候选（domain 含所有注册端的切片，孤儿目录也一并清）。 */
function scopedPathCandidates(
  spec: ModuleSpec,
  scope: RemoveScope,
  allAppIds: readonly string[]
): { files: string[]; dirs: string[]; specDoc: string | null } {
  if (scope.kind === "slice") {
    const slice = webSlicePathCandidates(spec, scope.appId)
    return { files: slice.files, dirs: slice.dirs, specDoc: null }
  }
  const backend = backendPathCandidates(spec)
  const files = [...backend.files]
  const dirs = [...backend.dirs]
  for (const appId of allAppIds) {
    const slice = webSlicePathCandidates(spec, appId)
    files.push(...slice.files)
    dirs.push(...slice.dirs)
  }
  return { files, dirs, specDoc: backend.specDoc }
}

/** 判断仓库相对路径是否命删除目标（含目录前缀） */
export function isDeletedPath(
  relPath: string,
  deletedPaths: readonly string[]
): boolean {
  return deletedPaths.some(
    (deleted) => relPath === deleted || relPath.startsWith(deleted + "/")
  )
}

/**
 * Git 回滚提示里要清理的真实模块路径（仓库相对，目录在前、文件在后，含规格书）。
 *
 * 不能用裸模块名：`git clean -fd contract` 在仓库根匹配不到
 * `apps/web/src/pages/contract/` / `apps/api/src/modules/contract/` 等真实路径。
 */
export function rollbackCleanPaths(
  spec: ModuleSpec,
  scope: RemoveScope = DEFAULT_SCOPE,
  allAppIds: readonly string[] = [DEFAULT_WEB_APP_ID]
): string[] {
  const candidates = scopedPathCandidates(spec, scope, allAppIds)
  return [
    ...candidates.dirs,
    ...candidates.files,
    ...(candidates.specDoc === null ? [] : [candidates.specDoc]),
  ]
}

// ─── 区块剥离（纯函数）────────────────────────────────────────────────────────

/**
 * 各注册文件「每个模块固定写入的区块数」（设计书 §6.1）。
 *
 * App.tsx = lazy 声明 + JSX 路由两个区块；permissions.ts = 权限码 + 权限注册表；
 * audit.ts = 模块名 + 中文标签 + 事件映射；其余文件各 1 个。
 * 数量不符说明标记被手删/移动：只剥离现存区块会留下悬挂代码
 * （如 App.tsx 只删 lazy 区块、`<ContractPage />` 路由仍在），因此必须报错。
 */
export const EXPECTED_MODULE_REGIONS: Record<string, number> = {
  "packages/shared/src/permissions.ts": 2,
  "packages/shared/src/audit.ts": 3,
  "packages/shared/src/index.ts": 1,
  "apps/api/src/db/schema.ts": 1,
  "apps/api/src/index.ts": 1,
  "apps/web/src/lib/query-keys.ts": 1,
  "apps/web/src/App.tsx": 2,
  "apps/web/src/lib/menu-config.ts": 1,
}

/**
 * 前端切片注册文件的「路径形状 → 区块数」。用后缀匹配而非枚举端 id，
 * 新增端不需要回来改这张表（端 id 是用户任意取的）。
 */
const SLICE_REGION_COUNTS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^apps\/[^/]+\/src\/lib\/query-keys\.ts$/, 1],
  [/^apps\/[^/]+\/src\/App\.tsx$/, 2],
  [/^apps\/[^/]+\/src\/lib\/menu-config\.ts$/, 1],
]

/** 某注册文件期望的 module:<name> 区块数（后端域查表，任意端的切片按形状匹配）。 */
export function expectedModuleRegionCount(relPath: string): number {
  const known = EXPECTED_MODULE_REGIONS[relPath]
  if (known !== undefined) return known
  for (const [pattern, count] of SLICE_REGION_COUNTS) {
    if (pattern.test(relPath)) return count
  }
  return 1
}

/** 按卸载范围算出要剥离区块的注册文件清单。 */
export function scopedRegistrationFiles(scope: RemoveScope): string[] {
  if (scope.kind === "slice") return webSliceRegistrationFiles(scope.appId)
  return [
    ...BACKEND_REGISTRATION_FILES,
    ...scope.appIds.flatMap((appId) => webSliceRegistrationFiles(appId)),
  ]
}

/** 读某文件的区块 id；文件不存在返回空数组，标记损坏则抛错（不静默漏检）。 */
function regionIdsOf(root: string, relPath: string): string[] {
  const full = path.join(root, relPath)
  if (!existsSync(full)) return []
  return listRegions(readFileSync(full, "utf8"))
}

/**
 * 枚举某端当前持有的全部模块切片名（区块驱动）。
 *
 * 不用 docs/specs/*.md：规格书可能先于代码存在、可能后端域有而某端无切片，
 * 还要过滤 _template / _archived。区块是归属声明，`module:*` 在则切片在。
 */
export function discoverAppModuleNames(root: string, appId: string): string[] {
  const names = new Set<string>()
  for (const relPath of webSliceRegistrationFiles(appId)) {
    for (const id of regionIdsOf(root, relPath)) {
      if (id.startsWith(MODULE_REGION_PREFIX)) {
        names.add(id.slice(MODULE_REGION_PREFIX.length))
      }
    }
  }
  return [...names].sort()
}

/**
 * 探测哪些端真正含该模块的切片区块。
 *
 * 全域卸载必须用探测结果而非全部注册端：没有区块的端若进注册清单，
 * stripRegistrationFiles 会因「区块数 0」判 missing 而抛错。
 */
export function discoverModuleAppIds(
  root: string,
  name: string,
  allAppIds: readonly string[]
): string[] {
  const target = MODULE_REGION_PREFIX + name
  return allAppIds.filter((appId) =>
    webSliceRegistrationFiles(appId).some((relPath) =>
      regionIdsOf(root, relPath).includes(target)
    )
  )
}

/** gen:group 容器内允许出现的自动生成结构行（其余非注释行视为手写内容） */
const MENU_GROUP_STRUCTURAL_LINE_RES: readonly RegExp[] = [
  /^\{\s*$/,
  /^label:\s*"[^"]*",?\s*$/,
  /^items:\s*\[\s*$/,
  /^\]\s*,?\s*$/,
  /^\}\s*,?\s*$/,
]

/** 该行是否可安全视为容器自动生成结构（空白 / 注释 / 菜单项锚点 / 固定结构行） */
function isMenuGroupGeneratedLine(line: string): boolean {
  const text = line.trim()
  if (text === "") return true
  if (text.startsWith("//") || text.startsWith("/*") || text.startsWith("*")) {
    return true
  }
  if (text.includes("[gen:module:menu-items]")) return true
  return MENU_GROUP_STRUCTURAL_LINE_RES.some((re) => re.test(text))
}

/**
 * 判断 gen:group 容器内（模块区块之外）是否存在手写内容。
 *
 * 收起容器 = 整体删除容器区块；若开发者往 Business 分组里手写过菜单项，整体收起会把
 * 手写项一起删掉且不报错。这里把「非 module 区块、非结构行、非注释/锚点」的行视为
 * 手写内容 → 保留容器并 warning。
 */
function groupRegionHasCustomContent(
  content: string,
  group: RegionInfo,
  allRegions: readonly RegionInfo[]
): boolean {
  const lines = content.split("\n")
  // module 区块行（含标记）会被 stripRegions 整体删除，不参与手写内容判定
  const skipLines = new Set<number>()
  for (const region of allRegions) {
    if (!region.id.startsWith(MODULE_REGION_PREFIX)) continue
    for (let line = region.startLine; line <= region.endLine; line += 1) {
      skipLines.add(line)
    }
  }
  for (let line = group.startLine + 1; line < group.endLine; line += 1) {
    if (skipLines.has(line)) continue
    if (!isMenuGroupGeneratedLine(lines[line - 1])) return true
  }
  return false
}

export interface StripModuleRegionsResult {
  content: string
  /** 因含手写内容而保留（未收起）的 gen:group 容器 id */
  preservedGroupIds: string[]
}

/**
 * 对单个注册文件执行「删 module:<name> 区块 → 收起空 gen:group 容器」。
 *
 * 与纯 stripEmptyGroupRegions 的区别：容器内若存在模块区块之外的手写菜单项/代码，
 * 保留容器（不猜测删除），由 removeModule 打印 warning 提示人工检查。
 */
export function stripModuleRegionsDetailed(
  content: string,
  name: string
): StripModuleRegionsResult {
  const stripped = stripRegions(content, "module:" + name)
  const regions = parseRegions(stripped)
  const groups = regions.filter((region) =>
    region.id.startsWith(GROUP_REGION_PREFIX)
  )
  const customGroups = groups.filter((group) =>
    groupRegionHasCustomContent(stripped, group, regions)
  )
  if (customGroups.length > 0) {
    return {
      content: stripped,
      preservedGroupIds: customGroups.map((group) => group.id),
    }
  }
  return { content: stripEmptyGroupRegions(stripped), preservedGroupIds: [] }
}

/** 对单个注册文件执行「删 module:<name> 区块 → 收起空 gen:group 容器」 */
export function stripModuleRegions(content: string, name: string): string {
  return stripModuleRegionsDetailed(content, name).content
}

/** 8 个注册文件剥离结果 + 需要提示的 warning */
export interface StripRegistrationResult {
  files: StrippedRegistrationFile[]
  warnings: string[]
}

/**
 * 计算注册文件的剥离结果（缺省 8 个 = 后端域 5 + 默认端切片 3；切片模式只传该端 3 个）。
 *
 * 区块完整性校验（不猜）：
 * - 任一文件缺少 module:<name> 区块（存量模块 / 标记被删）→ 报错；
 * - 单文件区块数与 expectedModuleRegionCount 不符（部分标记被删）→ 报错并列出期望/实际，
 *   否则会「只剥一半」留下悬挂代码（如 App.tsx 只剩 lazy 区块、`<ContractPage />` 还在）；
 * - `RegionParseError`（标记被手改坏）同样终止，并给出文件与行号。
 */
export function stripRegistrationFiles(
  registrationContents: Map<string, string>,
  name: string,
  registrationFiles: readonly string[] = REGISTRATION_FILE_LIST
): StripRegistrationResult {
  const target = "module:" + name
  const missing: string[] = []
  const mismatches: Array<{
    relPath: string
    expected: number
    actual: number
  }> = []
  const warnings: string[] = []
  const files: StrippedRegistrationFile[] = []

  for (const relPath of registrationFiles) {
    const before = registrationContents.get(relPath)
    if (before === undefined) {
      throw new GenModuleError(
        "找不到注册文件 " + relPath + "：当前目录不是 monorepo 模板仓库？"
      )
    }
    let ids: string[]
    try {
      ids = listRegions(before)
    } catch (error) {
      if (error instanceof RegionParseError) {
        throw new GenModuleError(
          relPath +
            " 的区块标记损坏（第 " +
            error.line +
            " 行）：" +
            error.message +
            "\n\nremove:module 不会猜测删除范围，请人工修复区块标记后重试。"
        )
      }
      throw error
    }
    const regionCount = ids.filter((id) => id === target).length
    const expected = expectedModuleRegionCount(relPath)
    if (regionCount === 0) {
      missing.push(relPath)
      continue
    }
    if (regionCount !== expected) {
      mismatches.push({ relPath, expected, actual: regionCount })
      continue
    }
    const stripped = stripModuleRegionsDetailed(before, name)
    if (stripped.preservedGroupIds.length > 0) {
      warnings.push(
        relPath +
          " 保留了 " +
          stripped.preservedGroupIds.join("、") +
          " 容器：容器内存在 " +
          target +
          " 区块之外的手写内容（整体收起会误删菜单项），请人工检查该分组"
      )
    }
    files.push({
      relPath,
      before,
      after: stripped.content,
      regionCount,
    })
  }

  // 全部文件都没有目标区块 → 存量模块（v2 之前生成 / 模块名错误）
  if (missing.length === registrationFiles.length && mismatches.length === 0) {
    throw new GenModuleError(
      "以下注册文件缺少 " +
        target +
        " 区块（可能是 v2 之前生成的存量模块，或区块标记被手工删除）：\n" +
        missing.map((relPath) => "  - " + relPath).join("\n") +
        "\n\nremove:module 只按区块精确卸载，不会猜测删除范围。\n" +
        "请人工清理这些文件中的模块注册代码后重试；若确认是存量模块，\n" +
        "可先 `git commit` 当前状态，再用手工删除 + 反向引用排查完成卸载。"
    )
  }

  // 部分文件缺区块 / 区块数不符 → 标记被手删或移动，不能继续（否则留下悬挂代码）
  if (missing.length > 0 || mismatches.length > 0) {
    const mismatchLines = [
      ...missing.map(
        (relPath) =>
          "  - " +
          relPath +
          "：期望 " +
          expectedModuleRegionCount(relPath) +
          " 处，实际 0 处"
      ),
      ...mismatches.map(
        (item) =>
          "  - " +
          item.relPath +
          "：期望 " +
          item.expected +
          " 处，实际 " +
          item.actual +
          " 处"
      ),
    ]
    throw new GenModuleError(
      "以下注册文件的 " +
        target +
        " 区块数量与 gen:module 写入不符（区块标记被手删/移动？）：\n" +
        mismatchLines.join("\n") +
        "\n\nremove:module 只按现存区块精确卸载，不会猜测缺失范围——" +
        "继续执行会留下悬挂代码（如只剩 lazy 声明、`<Route>` 仍在）。\n" +
        "请先 `git restore` 还原区块标记，或人工清理残留后重试。"
    )
  }

  // 剥离后不应再残留目标区块；残留说明区块嵌套异常（防御性检查）
  for (const file of files) {
    if (listRegions(file.after).includes(target)) {
      throw new GenModuleError(
        file.relPath +
          " 剥离后仍残留 " +
          target +
          " 区块：区块嵌套异常，请人工检查"
      )
    }
  }
  return { files, warnings }
}

// ─── 工作区干净预检 ──────────────────────────────────────────────────────────

/** git 命令执行结果（可注入 fake runner，便于单测失败分支） */
export interface GitCommandResult {
  status: number | null
  stdout: string
  stderr?: string
}

export type GitRunner = (args: readonly string[]) => GitCommandResult

/** 默认真实 git runner（cwd 固定为仓库根） */
function defaultGitRunner(root: string): GitRunner {
  return (args) => {
    const result = spawnSync("git", [...args], {
      cwd: root,
      encoding: "utf8",
    })
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    }
  }
}

/**
 * 返回相关路径中「有未提交改动」的 git status 行（已去重）。
 *
 * - 非 git 仓库（含临时副本 / CI 解压目录）：`git rev-parse` 失败 → 视为干净；
 * - 在 worktree 内但 `git status` 失败：**抛错而不是当作干净**（不能因为 git 异常
 *   就静默跳过保护，否则可能覆盖未提交改动）；
 * - `runGit` 可注入，便于单测失败分支。
 */
export function getDirtyPaths(
  root: string,
  relPaths: readonly string[],
  runGit: GitRunner = defaultGitRunner(root)
): string[] {
  if (relPaths.length === 0) return []
  const inside = runGit(["rev-parse", "--is-inside-work-tree"])
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return []

  const result = runGit(["status", "--porcelain", "--", ...relPaths])
  if (result.status !== 0) {
    throw new GenModuleError(
      "git status 失败，无法确认相关文件是否有未提交改动（不当作干净处理）：\n" +
        (result.stderr?.trim() || result.stdout.trim() || "(无输出)") +
        "\n\n请先手动检查 `git status --porcelain -- <相关路径>`；" +
        "确认无风险后可加 --force 跳过该预检。"
    )
  }
  const lines = result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
  return [...new Set(lines)]
}

/**
 * 把一行 `git status --porcelain` 还原成相对路径。
 *
 * porcelain v1 格式为 `XY <path>`：前两位是索引/工作区状态 + 一个空格；
 * 重命名/复制形如 `R  old -> new`，取新路径（旧路径已不存在，提交/暂存时用新路径即可）；
 * 含特殊字符的路径会被 git 加双引号，这里去掉引号并还原常见转义。
 */
function dirtyLineToPath(line: string): string | null {
  const trimmed = line.trimEnd()
  if (trimmed.length <= 3) return null
  let raw = trimmed.slice(3)
  const renamedAt = raw.indexOf(" -> ")
  if (renamedAt >= 0) raw = raw.slice(renamedAt + " -> ".length)
  raw = raw.trim()
  if (raw.startsWith('"') && raw.endsWith('"')) {
    raw = raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  }
  return raw || null
}

/** shell 安全引用：仅含常规字符时原样输出，否则单引号包裹（并转义内部单引号） */
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return "'" + value.replace(/'/g, String.raw`'\''`) + "'"
}

/**
 * 生成可直接复制执行的处理建议（提交 / 只暂存相关文件）。
 *
 * 卸载器落盘后依赖 Git 回滚（见文件头），因此被脏工作区拦下时，最快最安全的
 * 是先把这些文件提交或 stash；这里把 porcelain 行还原成路径并拼好命令，
 * 避免用户手动从状态行里挑路径、或误用 `git restore .` 丢掉未提交的改动。
 */
export function formatDirtyWorkspaceHint(
  dirtyPaths: readonly string[]
): string {
  const paths = dirtyPaths
    .map(dirtyLineToPath)
    .filter((value): value is string => value !== null)
  if (paths.length === 0) return ""

  const quoted = paths.map(shellQuote).join(" ")
  return (
    "\n\n请先提交或暂存这些改动后重试（任选其一）：\n" +
    "  git add " +
    quoted +
    ' && git commit -m "wip: 卸载前保存改动"\n' +
    "  git stash push -- " +
    quoted +
    "   # 只暂存本次涉及的文件\n" +
    "确认这些改动无保留价值时，也可直接加 --force 跳过该预检。"
  )
}

// ─── 反向引用预检 ────────────────────────────────────────────────────────────

/** 反向引用扫描的文件扩展名（代码文件；drizzle 迁移 .sql / snapshot .json 不在范围内） */
const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
])

/** 扫描时跳过的目录 */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "drizzle",
  ".git",
  ".turbo",
  ".cache",
])

/**
 * 从 `packages/shared/src/index.ts` 的模块区块里解析导出的符号名
 * （`export { A, type B } from "./<name>.js"`），用于反向引用扫描。
 */
export function parseSharedExportedSymbols(
  indexContent: string,
  name: string
): string[] {
  let regions: ReturnType<typeof parseRegions>
  try {
    regions = parseRegions(indexContent)
  } catch {
    return []
  }
  const target = regions.find((region) => region.id === "module:" + name)
  if (!target) return []
  const lines = indexContent.split("\n")
  const body = lines.slice(target.startLine - 1, target.endLine).join("\n")
  const block = /export\s*\{([\s\S]*?)\}\s*from\s*["']\.\/[^"']+["']/.exec(body)
  if (!block) return []
  return block[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^type\s+/, ""))
    .filter((entry) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry))
}

/** 正则元字符转义 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** 尚未附加文件路径的命中（由扫描器补 relPath） */
type LocalReferenceHit = Omit<ReverseReferenceHit, "relPath">

/** 行级反向引用特征（正则在单行上匹配） */
export interface ReverseReferencePattern {
  feature: string
  regex: RegExp
  /**
   * true = 特征指向**前端切片**（切片模式下会被删掉，引用它即悬挂）；
   * false / 缺省 = 指向**后端域**（切片模式下合法保留，命中即假阳性，必须跳过）。
   * 设为可选是为了让手工构造 pattern 的调用方（如单测 fixture）不必关心它；
   * buildReverseReferencePatterns 的 8 条全部显式标注。
   */
  sliceOwned?: boolean
}

/**
 * 内容级反向引用规则（正则在整份文件内容上做全局匹配，允许跨行）。
 * 用于表标识符这类「裸词容易误伤 UI 文案 / 本地变量」的特征。
 */
export interface ContentReferenceRule {
  feature: string
  regex: RegExp
}

/**
 * 行级精确特征（设计书 §6.4 中与表 / 符号无关的部分）。
 *
 * 这些特征自带代码语义（路径 / 常量名 / 权限码 / query key 名），不会把 UI 文案或
 * 本地变量误判为反向引用，因此保持单行匹配。
 */
/**
 * 行级精确特征（设计书 §6.4 中与表 / 符号无关的部分）。
 *
 * 这些特征自带代码语义（路径 / 常量名 / 权限码 / query key 名），不会把 UI 文案或
 * 本地变量误判为反向引用，因此保持单行匹配。
 *
 * `sliceOnly = true`（只拆一个端的前端切片）时**只返回 sliceOwned 的 4 条**：
 * 后端域此时合法保留，若仍用全量特征，本端其他页面里一句
 * `<PermissionGate perm={PERMISSIONS.CONTRACT_VIEW}>` 就会命中并永久阻塞卸载。
 */
export function buildReverseReferencePatterns(
  spec: ModuleSpec,
  sliceOnly = false
): ReverseReferencePattern[] {
  const { name, pascal, camel, upper } = spec
  const patterns: ReverseReferencePattern[] = [
    {
      feature: 'shared 相对导入 "./' + name + '.js"',
      regex: new RegExp(
        "from\\s+[\"']\\./" + escapeRegExp(name) + "\\.js[\"']"
      ),
      sliceOwned: false,
    },
    {
      feature: "@/pages/" + name + "/",
      regex: new RegExp("@/pages/" + escapeRegExp(name) + "/"),
      sliceOwned: true,
    },
    {
      feature: "@/services/" + name,
      regex: new RegExp("@/services/" + escapeRegExp(name) + "(?=[\"'/])"),
      sliceOwned: true,
    },
    {
      feature: "@/hooks/queries/use" + pascal,
      regex: new RegExp(
        "@/hooks/queries/use" + escapeRegExp(pascal) + "(?=[\"'/])"
      ),
      sliceOwned: true,
    },
    {
      // query key 工厂是按端的，切片删掉后引用即悬挂
      feature: camel + "Keys",
      regex: new RegExp("\\b" + escapeRegExp(camel + "Keys") + "\\b"),
      sliceOwned: true,
    },
    {
      // 任何 <UPPER>_* 常量（含区块外手工新增的 CONTRACT_APPROVE 等）
      feature: "PERMISSIONS." + upper + "_*",
      regex: new RegExp("\\bPERMISSIONS\\." + escapeRegExp(upper) + "_"),
      sliceOwned: false,
    },
    {
      feature: "AUDIT_MODULES." + upper,
      regex: new RegExp("\\bAUDIT_MODULES\\." + escapeRegExp(upper) + "\\b"),
      sliceOwned: false,
    },
    {
      // 权限码字符串字面量（<name>:<action>，如 "contract:approve"）
      feature: "权限码字符串 " + name + ":*",
      regex: new RegExp("[\"']" + escapeRegExp(name) + ":[a-z_]+[\"']"),
      sliceOwned: false,
    },
  ]
  return sliceOnly ? patterns.filter((p) => p.sliceOwned) : patterns
}

/**
 * 表标识符 `<table>` 的反向引用规则 —— **设计书 §6.4「表标识符」的收紧解释**。
 *
 * 直接裸词匹配 `\\b<table>\\b` 会把 `const categories = [...]`（本地变量）、JSX 文案
 * `Category Distribution`、i18n 文案等误判为反向引用，导致模块名是常见英文词
 * （category / contract / order）时在真实项目里几乎无法卸载。这里只保留
 * 「该表确实被代码语义引用」的四种形态：
 *   1. 外键：`references(() => <table>.id)`（允许跨行）；
 *   2. drizzle 调用：`from(<table>)` / `insert(<table>)` / `update(<table>)` / `delete(<table>)`；
 *   3. schema import 块：`import { ... <table> ... } from "<任意路径>/schema..."`（多行 import 可命中）；
 *   4. `schema.<table>`（`import * as schema` 命名空间用法）；
 *   5. raw SQL：`sql\`... from/join/into/update/insert into <table> ...\`` 或普通字符串
 *      （不区分大小写）；
 *   6. `db.query.<table>` / `.query.<table>`（drizzle 关系查询 API）。
 *
 * 注意：`import * as <ns> from ".../schema..."` 后 `<ns>.<table>` 由
 * findSchemaNamespaceTableReferences 动态解析命名空间名后匹配。
 *
 * 判定原则：宁可对「可疑但无编译影响」的引用放行（删除后由 typecheck 兜底），
 * 也不要把普通文案当成反向引用、让合法卸载被永久阻塞。
 */
export function buildTableReferenceRules(
  spec: ModuleSpec
): ContentReferenceRule[] {
  const table = escapeRegExp(spec.table)
  return [
    {
      feature: "外键 references(() => " + spec.table + ".*)",
      regex: new RegExp(
        "references\\s*\\(\\s*\\(\\s*\\)\\s*=>\\s*" + table + "\\s*\\.",
        "g"
      ),
    },
    {
      feature: "drizzle 调用 from/insert/update/delete(" + spec.table + ")",
      regex: new RegExp(
        "\\b(?:from|insert|update|delete)\\s*\\(\\s*" + table + "\\s*[,)]",
        "g"
      ),
    },
    {
      feature: "schema." + spec.table,
      regex: new RegExp("\\bschema\\." + table + "\\b", "g"),
    },
    {
      // raw SQL：from / join / into / update / insert into 之后跟表名（大小写不敏感）
      feature: "raw SQL 引用表 " + spec.table,
      regex: new RegExp(
        "\\b(?:from|join|into|update|insert\\s+into)\\s+" + table + "\\b",
        "gi"
      ),
    },
    {
      // drizzle 关系查询 API：db.query.<table> / .query.<table>
      feature: "query." + spec.table,
      regex: new RegExp("\\bquery\\." + table + "\\b", "g"),
    },
  ]
}

/** 1-based 行号 + 该行 trim 后的文本 */
function lineAt(
  content: string,
  index: number
): { line: number; text: string } {
  const lineStart = content.lastIndexOf("\n", index) + 1
  let lineEnd = content.indexOf("\n", index)
  if (lineEnd === -1) lineEnd = content.length
  const line = content.slice(0, lineStart).split("\n").length
  return { line, text: content.slice(lineStart, lineEnd).trim() }
}

/** 该索引所在行是否纯注释行 */
function isCommentAt(content: string, index: number): boolean {
  return isCommentLine(lineAt(content, index).text)
}

/** 在整份内容上做全局正则匹配（自动补 g 标志，容忍空匹配死循环） */
function matchesAll(content: string, regex: RegExp): RegExpExecArray[] {
  const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g"
  const global = new RegExp(regex.source, flags)
  const matches: RegExpExecArray[] = []
  let match: RegExpExecArray | null
  while ((match = global.exec(content)) !== null) {
    matches.push(match)
    if (match[0] === "") global.lastIndex += 1
  }
  return matches
}

/** 解析 import/export 语句块 `{ ... } from "<source>"`（源码、多行均可） */
interface ImportStatement {
  /** 语句起始偏移 */
  index: number
  /** 花括号内具名成员列表的起始偏移 */
  namesIndex: number
  /** 花括号内具名成员列表原文 */
  namesSource: string
  /** 来源模块（引号内） */
  source: string
}

function parseImportStatements(content: string): ImportStatement[] {
  const statements: ImportStatement[] = []
  const importRe =
    /\b(?:import|export)\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g
  let match: RegExpExecArray | null
  while ((match = importRe.exec(content)) !== null) {
    const namesOffsetInMatch = match[0].indexOf("{") + 1
    statements.push({
      index: match.index,
      namesIndex: match.index + namesOffsetInMatch,
      namesSource: match[1],
      source: match[2],
    })
  }
  return statements
}

/** 规范具名成员：去掉 `type` 修饰符、`as` 别名，取原始导出名 */
function originalImportName(specifier: string): string {
  const withoutType = specifier.trim().replace(/^type\s+/, "")
  return withoutType.split(/\s+as\s+/)[0].trim()
}

/**
 * shared 导出符号的反向引用：**只匹配 import/export 语句块**，不做全文裸词匹配。
 *
 * 覆盖形态（设计书 §6.4「模块在 shared 中导出的符号名」）：
 *   - `import { Category } from "shared"`（含多行、`type` 修饰符、`as` 别名）；
 *   - `import type { Category } from "shared"`；
 *   - `export { Category } from "shared"`（再导出）；
 *   - `import { Category } from "./<name>.js"`（shared 包内部相对导入）。
 *
 * 不匹配 UI 文案里的同名英文单词（如 Dashboard 上的 "Category Distribution"）。
 */
export function findSharedSymbolImportReferences(
  content: string,
  spec: ModuleSpec,
  sharedSymbols: readonly string[]
): LocalReferenceHit[] {
  if (sharedSymbols.length === 0) return []
  const wanted = new Set(sharedSymbols)
  const sources = new Set(["shared", "./" + spec.name + ".js"])
  const hits: LocalReferenceHit[] = []

  // `export * from "shared"` / `export * as ns from "shared"`：整包再导出，全部符号泄漏
  const starExportRe =
    /\bexport\s+\*\s+(?:as\s+[A-Za-z_$][\w$]*\s+)?from\s*["']([^"']+)["']/g
  for (const match of matchesAll(content, starExportRe)) {
    if (!sources.has(match[1])) continue
    if (isCommentAt(content, match.index)) continue
    const { line, text } = lineAt(content, match.index)
    hits.push({
      line,
      text,
      feature: "export * from " + match[1] + "（再导出全部 shared 符号）",
    })
  }

  // `import * as <ns> from "shared"` 之后的 `<ns>.<symbol>`（命名空间导入）
  const namespaceImportRe =
    /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g
  for (const match of matchesAll(content, namespaceImportRe)) {
    if (!sources.has(match[2])) continue
    const namespace = match[1]
    for (const symbol of wanted) {
      const useRe = new RegExp(
        "\\b" + escapeRegExp(namespace) + "\\." + escapeRegExp(symbol) + "\\b",
        "g"
      )
      for (const use of matchesAll(content, useRe)) {
        if (isCommentAt(content, use.index)) continue
        const { line, text } = lineAt(content, use.index)
        hits.push({
          line,
          text,
          feature:
            "shared 导出符号 " +
            namespace +
            "." +
            symbol +
            "（命名空间导入 " +
            match[2] +
            "）",
        })
      }
    }
  }

  for (const statement of parseImportStatements(content)) {
    if (!sources.has(statement.source)) continue
    for (const specifier of statement.namesSource.split(",")) {
      const original = originalImportName(specifier)
      if (!wanted.has(original)) continue
      // 尽量定位到具体成员所在行；找不到时回退到语句起始行
      const localIndex = statement.namesSource.indexOf(specifier)
      const absolute =
        localIndex >= 0 ? statement.namesIndex + localIndex : statement.index
      const { line, text } = lineAt(content, absolute)
      hits.push({
        line,
        text,
        feature:
          "shared 导出符号 " +
          original +
          "（import 自 " +
          statement.source +
          "）",
      })
    }
  }
  return hits
}

/**
 * `import * as <ns> from "<任意路径>/schema..."` 之后的 `<ns>.<table>` 用法。
 *
 * 命名空间名由 import 语句动态解析（如 `import * as dbSchema from "../../db/schema.js"`），
 * 不能写死成 `schema.`。
 */
function findSchemaNamespaceTableReferences(
  content: string,
  spec: ModuleSpec
): LocalReferenceHit[] {
  const hits: LocalReferenceHit[] = []
  const namespaceImportRe =
    /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g
  const table = escapeRegExp(spec.table)
  for (const match of matchesAll(content, namespaceImportRe)) {
    if (!/schema(?:\.(?:js|ts))?$/.test(match[2])) continue
    const namespace = match[1]
    const useRe = new RegExp(
      "\\b" + escapeRegExp(namespace) + "\\." + table + "\\b",
      "g"
    )
    for (const use of matchesAll(content, useRe)) {
      if (isCommentAt(content, use.index)) continue
      const { line, text } = lineAt(content, use.index)
      hits.push({
        line,
        text,
        feature: "schema 命名空间 " + namespace + "." + spec.table,
      })
    }
  }
  return hits
}

/**
 * 从 schema 模块的 import/export 块里查找目标表（覆盖多行 import 与 type import）。
 * 例：`import { contracts, users } from "./schema.js"`。
 */
function findSchemaTableImportReferences(
  content: string,
  spec: ModuleSpec
): LocalReferenceHit[] {
  const hits: LocalReferenceHit[] = []
  for (const statement of parseImportStatements(content)) {
    if (!/schema(?:\.(?:js|ts))?$/.test(statement.source)) continue
    for (const specifier of statement.namesSource.split(",")) {
      if (originalImportName(specifier) !== spec.table) continue
      const localIndex = statement.namesSource.indexOf(specifier)
      const absolute =
        localIndex >= 0 ? statement.namesIndex + localIndex : statement.index
      const { line, text } = lineAt(content, absolute)
      hits.push({
        line,
        text,
        feature: "schema import 块含表 " + spec.table,
      })
    }
  }
  return hits
}

/** 行是否纯注释（反向引用预检忽略注释行，减少文档性文本误报） */
function isCommentLine(line: string): boolean {
  const text = line.trim()
  return (
    text.startsWith("//") ||
    text.startsWith("/*") ||
    text.startsWith("*") ||
    text.startsWith("<!--")
  )
}

/**
 * 扫描 apps/ + packages/ 的剩余代码内容，查找对被卸载模块的反向引用。
 *
 * - 注册文件使用「内存中剥离后」的内容（strippedContents），避免把即将删除的区块算成引用；
 * - 被删除的模块文件 / 目录整体跳过；
 * - 注释行不参与匹配（说明性文字不算代码引用）；
 * - 表标识符 / shared 导出符号走「代码语义上下文」规则（见
 *   buildTableReferenceRules / findSharedSymbolImportReferences），避免常见英文词误报。
 */
export function findReverseReferences(params: {
  root: string
  spec: ModuleSpec
  sharedSymbols: readonly string[]
  linePatterns: readonly ReverseReferencePattern[]
  tableRules?: readonly ContentReferenceRule[]
  deletedPaths: readonly string[]
  strippedContents: ReadonlyMap<string, string>
  /** 扫描范围（仓库相对目录）；缺省 = 全部 apps + packages */
  scanRoots?: readonly string[]
  /**
   * 切片模式：后端域合法保留，因此只查前端切片特征，
   * 跳过表标识符 / schema import / schema 命名空间 / shared 导出符号四类后端检查。
   */
  sliceOnly?: boolean
}): ReverseReferenceHit[] {
  const {
    root,
    spec,
    sharedSymbols,
    linePatterns,
    deletedPaths,
    strippedContents,
    scanRoots = ["apps", "packages"],
    sliceOnly = false,
  } = params
  const tableRules = sliceOnly
    ? []
    : (params.tableRules ?? buildTableReferenceRules(spec))
  const hits: ReverseReferenceHit[] = []

  for (const scanRoot of scanRoots) {
    const absoluteScanRoot = path.join(root, scanRoot)
    if (!existsSync(absoluteScanRoot)) continue
    for (const relPath of walkCodeFiles(root, scanRoot)) {
      if (isDeletedPath(relPath, deletedPaths)) continue
      const content =
        strippedContents.get(relPath) ?? readFileSafe(path.join(root, relPath))
      if (content === null) continue

      // 1) 行级精确特征
      const lines = content.split("\n")
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (line.trim() === "" || isCommentLine(line)) continue
        for (const pattern of linePatterns) {
          if (pattern.regex.test(line)) {
            hits.push({
              relPath,
              line: index + 1,
              feature: pattern.feature,
              text: line.trim(),
            })
          }
        }
      }

      // 2) 表标识符：代码语义上下文（可跨行）
      for (const rule of tableRules) {
        for (const match of matchesAll(content, rule.regex)) {
          if (isCommentAt(content, match.index)) continue
          const { line, text } = lineAt(content, match.index)
          hits.push({ relPath, line, feature: rule.feature, text })
        }
      }

      if (sliceOnly) continue

      // 3) schema import 块 / 命名空间里的表（可跨行）
      for (const hit of findSchemaTableImportReferences(content, spec)) {
        if (isCommentLine(hit.text)) continue
        hits.push({ ...hit, relPath })
      }
      for (const hit of findSchemaNamespaceTableReferences(content, spec)) {
        hits.push({ ...hit, relPath })
      }

      // 4) shared 导出符号：import/export 语句块
      for (const hit of findSharedSymbolImportReferences(
        content,
        spec,
        sharedSymbols
      )) {
        hits.push({ ...hit, relPath })
      }
    }
  }

  // 同一行可能被多条规则命中（如 schema import 同时命中表规则），按「文件:行:特征」去重
  const seen = new Set<string>()
  return hits.filter((hit) => {
    const key = hit.relPath + ":" + hit.line + ":" + hit.feature
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 递归遍历目录下的代码文件（仓库相对路径） */
function walkCodeFiles(root: string, relDir: string): string[] {
  const absoluteDir = path.join(root, relDir)
  let entries
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true })
  } catch {
    return []
  }
  const results: string[] = []
  for (const entry of entries) {
    const relPath = relDir + "/" + entry.name
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      results.push(...walkCodeFiles(root, relPath))
      continue
    }
    if (!entry.isFile()) continue
    const ext = path.extname(entry.name)
    if (!SCAN_EXTENSIONS.has(ext)) continue
    results.push(relPath)
  }
  return results
}

function readFileSafe(absolutePath: string): string | null {
  try {
    return readFileSync(absolutePath, "utf8")
  } catch {
    return null
  }
}

/** 反向引用命中 → 人读报错文案（最多列 40 处，避免刷屏） */
export function formatReverseReferenceHits(
  name: string,
  hits: readonly ReverseReferenceHit[]
): string {
  const limit = 40
  const shown = hits.slice(0, limit)
  const lines = [
    "卸载 " +
      name +
      " 前发现 " +
      hits.length +
      " 处反向引用（区块外代码仍引用该模块，删除后会编译失败）：",
    ...shown.map(
      (hit) =>
        "  - " +
        hit.relPath +
        ":" +
        hit.line +
        "  [" +
        hit.feature +
        "]  " +
        hit.text
    ),
  ]
  if (hits.length > limit) {
    lines.push("  … 另有 " + (hits.length - limit) + " 处未列出")
  }
  lines.push(
    "",
    "请先手工移除这些引用（或把它们移进 module:" +
      name +
      " 区块），再重新执行 remove:module。"
  )
  return lines.join("\n")
}

// ─── 规格书归档 / 删除 ───────────────────────────────────────────────────────

/** 本地日期 YYYY-MM-DD（归档头用；不用 toISOString().slice，避免 UTC 时区把日期前移） */
function todayLocalDate(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return (
    now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate())
  )
}

/** 归档规格书内容：原文件头追加归档日期与原因占位（业务决策记录不随模块删除而丢失） */
export function buildArchivedSpecContent(
  name: string,
  date: string,
  content: string
): string {
  return [
    "> **归档日期**：" + date,
    "> **归档原因**：模块 `" + name + "` 已卸载（待补充业务决策记录）",
    "> **原始路径**：docs/specs/" + name + ".md（由 remove:module 自动归档）",
    "",
    content,
  ].join("\n")
}

// ─── 计划计算 ────────────────────────────────────────────────────────────────

/** 读取注册文件（缺失即报错，说明当前目录不是 monorepo 模板仓库） */
export function readRegistrationFiles(
  root: string,
  registrationFiles: readonly string[] = REGISTRATION_FILE_LIST
): Map<string, string> {
  const contents = new Map<string, string>()
  for (const relPath of registrationFiles) {
    const content = readFileSafe(path.join(root, relPath))
    if (content === null) {
      throw new GenModuleError(
        "找不到注册文件 " +
          relPath +
          "：remove:module 只适用于 monorepo 模板 / 生成项目"
      )
    }
    contents.set(relPath, content)
  }
  return contents
}

/** 计算卸载计划（纯计算，不落盘；dry-run 与正式执行共用） */
export function buildRemoveModulePlan(
  root: string,
  spec: ModuleSpec,
  purgeSpec = false,
  runGit?: GitRunner,
  scope: RemoveScope = DEFAULT_SCOPE,
  allAppIds: readonly string[] = [DEFAULT_WEB_APP_ID],
  simulatedDeletedPaths: readonly string[] = []
): RemoveModulePlan {
  const sliceOnly = scope.kind === "slice"
  const candidates = scopedPathCandidates(spec, scope, allAppIds)
  const registrationFileList = scopedRegistrationFiles(scope)
  const registrationContents = readRegistrationFiles(root, registrationFileList)
  const target = "module:" + spec.name

  // 1. 存在性：模块文件 / 目录 / 规格书 / 注册区块 任一存在才继续
  const deletedPaths = [
    ...candidates.files,
    ...candidates.dirs,
    ...(candidates.specDoc === null ? [] : [candidates.specDoc]),
  ].filter((relPath) => existsSync(path.join(root, relPath)))
  const hasRegions = [...registrationContents.values()].some((content) =>
    safeListRegions(content).includes(target)
  )
  if (deletedPaths.length === 0 && !hasRegions) {
    throw new GenModuleError(
      "未找到模块 " +
        spec.name +
        (sliceOnly ? " 在端 " + scope.appId + " 的前端切片" : "") +
        "：模块文件（" +
        candidates.files.join("、") +
        " / 目录 " +
        candidates.dirs.join("、") +
        "）与 " +
        target +
        " 区块均不存在。\n可先用 --dry-run 确认 --name 是否正确。"
    )
  }

  // 2. 区块完整性（含应有区块数校验）+ 内存剥离
  const { files: registrationFiles, warnings } = stripRegistrationFiles(
    registrationContents,
    spec.name,
    registrationFileList
  )

  // 3. 规格书动作（默认归档；--purge-spec 物理删除）
  //    切片模式不碰规格书：它归后端域独占，其他端可能还在用同一份。
  const specExists =
    candidates.specDoc !== null && deletedPaths.includes(candidates.specDoc)
  const specAction: RemoveModulePlan["specAction"] = !specExists
    ? "none"
    : purgeSpec
      ? "purge"
      : "archive"
  const archivePath =
    specAction === "archive"
      ? "docs/specs/_archived/" + spec.name + ".md"
      : null
  const archiveExists =
    archivePath !== null && existsSync(path.join(root, archivePath))

  // 4. 工作区干净预检（相关路径：注册文件 + 全部被删/被归档文件 + 归档目标——
  //    避免把未提交的规格书改动直接归档、覆盖已改过的历史归档、或 --purge-spec 删除）
  const relatedPaths = [
    ...registrationFileList,
    ...deletedPaths,
    ...(archivePath ? [archivePath] : []),
  ]
  const dirtyPaths = getDirtyPaths(root, relatedPaths, runGit)

  // 5. 反向引用预检（注册文件用剥离后内容；共享导出符号从剥离前内容解析）
  const strippedMap = new Map(
    registrationFiles.map((file) => [file.relPath, file.after] as const)
  )
  const sharedBefore = registrationContents.get("packages/shared/src/index.ts")
  const sharedSymbols = sharedBefore
    ? parseSharedExportedSymbols(sharedBefore, spec.name)
    : []
  const references = findReverseReferences({
    root,
    spec,
    sharedSymbols,
    linePatterns: buildReverseReferencePatterns(spec, sliceOnly),
    // 只影响预检视野，不进 plan.deletedPaths（后者驱动真实删除与文案）
    deletedPaths: [...deletedPaths, ...simulatedDeletedPaths],
    strippedContents: strippedMap,
    // 切片模式只扫本端：其他端与后端域的引用都合法，扫了只会制造假阳性
    scanRoots: sliceOnly ? ["apps/" + scope.appId] : ["apps", "packages"],
    sliceOnly,
  })

  return {
    spec,
    deletedPaths,
    specDocPath: specExists ? candidates.specDoc : null,
    specAction,
    archivePath,
    archiveExists,
    registrationFiles,
    warnings,
    dirtyPaths,
    references,
  }
}

function safeListRegions(content: string): string[] {
  try {
    return listRegions(content)
  } catch {
    return []
  }
}

// ─── 打印计划 ────────────────────────────────────────────────────────────────

/** 打印卸载计划与预检结果（dry-run 与正式执行共用） */
export function printRemovePlan(plan: RemoveModulePlan): void {
  console.log(
    "🧹 remove:module：" + plan.spec.name + "（按 module 区块精确卸载）"
  )
  if (plan.deletedPaths.length === 0) {
    console.log("\n将删除的模块文件：无（仅剥离注册点区块）")
  } else {
    console.log("\n将删除以下模块文件 / 目录：")
    for (const relPath of plan.deletedPaths) {
      if (relPath === plan.specDocPath) continue
      console.log("  - " + relPath)
    }
  }

  console.log("\n将剥离以下注册文件区块：")
  for (const file of plan.registrationFiles) {
    console.log(
      "  ~ " +
        file.relPath +
        "（" +
        file.regionCount +
        " 处 module:" +
        plan.spec.name +
        " 区块）"
    )
  }

  if (plan.specDocPath) {
    if (plan.specAction === "archive") {
      console.log(
        "\n📄 规格书：归档到 " +
          plan.archivePath +
          (plan.archiveExists
            ? "（⚠️ 目标已存在，正式执行需 --force 覆盖）"
            : "")
      )
    } else {
      console.log("\n📄 规格书：物理删除（--purge-spec）")
    }
  } else {
    console.log("\n📄 规格书：不存在（跳过）")
  }

  if (plan.dirtyPaths.length > 0) {
    console.log(
      "\n⚠️  工作区存在未提交改动" +
        (plan.dirtyPaths.length > 0
          ? "（" + plan.dirtyPaths.length + " 项）"
          : "") +
        "："
    )
    for (const line of plan.dirtyPaths.slice(0, 20)) console.log("  " + line)
    if (plan.dirtyPaths.length > 20) {
      console.log("  … 另有 " + (plan.dirtyPaths.length - 20) + " 项")
    }
  } else {
    console.log("\n✅ git 工作区干净（相关文件无未提交改动）")
  }
  for (const warning of plan.warnings) {
    console.log("⚠️  " + warning)
  }
  console.log("✅ 反向引用预检通过（剩余代码未引用该模块）")
}

// ─── 数据库结构同步（移除策略：永不自动 DROP）─────────────────────────────────

/**
 * 卸载后的数据库结构同步：
 * - 模板仓库（apps/api/init.sql）→ 自动重生成 init.sql（模板无状态、数据无风险）；
 * - 生成项目（apps/api/drizzle/）→ **只打印人工审核提示，绝不自动执行**
 *   （DROP TABLE 等同删除生产数据，且 drizzle-kit 删除类变更可能交互阻塞）；
 * - 都没有 → 跳过并提示。
 */
export function syncDatabaseOnRemove(
  root: string,
  spec: ModuleSpec,
  skipDb: boolean
): void {
  if (skipDb) {
    console.log(
      "⏭️  --skip-db：跳过数据库结构同步（记得手动移除 " +
        spec.table +
        " 表定义 / 生成迁移）"
    )
    return
  }
  const initSql = path.join(root, "apps", "api", "init.sql")
  const drizzleDir = path.join(root, "apps", "api", "drizzle")
  if (existsSync(initSql)) {
    console.log("\n🔄 模板仓库：重新生成 apps/api/init.sql ...")
    const result = spawnSync(
      process.execPath,
      ["--filter", "api", "db:init:generate"],
      { cwd: root, encoding: "utf8" }
    )
    if (result.status !== 0) {
      throw new GenModuleError(
        "db:init:generate 失败：\n" +
          ((result.stdout ?? "") + (result.stderr ?? "")).trim()
      )
    }
    return
  }
  if (existsSync(drizzleDir)) {
    console.warn(
      [
        "",
        "⚠️  生成项目：schema 已移除表 " +
          spec.table +
          "，但迁移不会自动生成。",
        "   确认可以丢弃该表数据后，手动执行以下命令并人工审核生成的迁移：",
        "     bun --filter api db:generate",
        "   然后检查 DROP TABLE " +
          spec.table +
          " 语句，再 bun --filter api db:migrate。",
        "   （remove:module 永不自动执行迁移：DROP TABLE 等同删除业务数据，且",
        "     drizzle-kit 对删除类变更可能弹出交互确认导致脚本挂起）",
      ].join("\n")
    )
    return
  }
  console.warn(
    "⚠️  未找到数据库结构来源（apps/api/init.sql 或 apps/api/drizzle/），跳过结构同步"
  )
}

// ─── LONG_FILE_RATCHET 剪枝 ──────────────────────────────────────────────────

/** 卸载模块页面/测试后剪掉 LONG_FILE_RATCHET 中的失效条目（否则 arch:check 报 overlong-ratchet-missing） */
export function pruneLongFileRatchet(root: string): void {
  const archCheck = path.join(root, "scripts", "arch-check.ts")
  if (!existsSync(archCheck)) {
    console.warn(
      "⚠️  未找到 scripts/arch-check.ts，跳过 LONG_FILE_RATCHET 剪枝"
    )
    return
  }
  pruneMissingLongFileRatchet(root)
}

// ─── 构建产物清理 ────────────────────────────────────────────────────────────

/** tsc 为模块私有源码产出的 dist 文件扩展名（declarationMap 会产生 .d.ts.map） */
const SHARED_BUILD_EXTENSIONS = new Set([
  ".js",
  ".js.map",
  ".d.ts",
  ".d.ts.map",
])

/**
 * best-effort 删除 `packages/shared/dist/<name>.*` 构建产物。
 *
 * 为什么需要：remove:module 只删 `packages/shared/src/<name>.ts`；重新构建 shared 时
 * tsc 不会清理已删除源文件对应的旧产物（`contract.js` / `contract.d.ts` / sourcemap），
 * 这些文件虽被 .gitignore 忽略、不影响 git status，但会留在生成项目 dist 里造成困惑。
 *
 * 只删精确 `<name>.<tsc 扩展名>`（`contract.` 前缀不会误删 `contract-probe2.*`）；
 * dist 不存在 / 读取失败 / 单文件删除失败都不阻断卸载。
 *
 * @returns 实际删除的文件名（不含目录）
 */
export function removeSharedBuildArtifacts(
  root: string,
  name: string
): string[] {
  const distDir = path.join(root, "packages", "shared", "dist")
  if (!existsSync(distDir)) return []
  let entries
  try {
    entries = readdirSync(distDir, { withFileTypes: true })
  } catch {
    return []
  }
  const prefix = name + "."
  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.startsWith(prefix)) continue
    const extension = entry.name.slice(prefix.length)
    if (!SHARED_BUILD_EXTENSIONS.has("." + extension)) continue
    try {
      rmSync(path.join(distDir, entry.name), { force: true })
      removed.push(entry.name)
    } catch {
      // best-effort：单个产物删除失败不阻断卸载
    }
  }
  return removed.sort()
}

// ─── 后续建议 ────────────────────────────────────────────────────────────────

function printRemoveNextSteps(
  plan: RemoveModulePlan,
  scope: RemoveScope,
  allAppIds: readonly string[] = [DEFAULT_WEB_APP_ID]
): void {
  const { spec } = plan
  const cleanPaths = rollbackCleanPaths(spec, scope, allAppIds).join(" ")

  if (scope.kind === "slice") {
    console.log(
      [
        "",
        '✅ 已拆掉端 "' +
          scope.appId +
          '" 的 ' +
          spec.name +
          " 前端切片。后续步骤：",
        "  1. 在 docs/specs/" +
          spec.name +
          ".md 的交互功能块移除本端页面路径（规格书归后端域，本次未改动）",
        "  2. 跑全量门禁：bun run check",
        "",
        "已知影响：",
        "  - 后端域（契约 / 表 / 权限码 / 审计标签 / API 路由）与其他端的切片都未改动；",
        "  - 本端菜单与路由已移除，历史审计日志不受影响；",
        "  - 若后续格式化失败，可 Git 回滚（只限本端切片路径）：",
        "      git restore " + cleanPaths,
        "      git clean -fd " + cleanPaths,
        "  - 重建本端切片：bun run gen:module --name " +
          spec.name +
          " --app " +
          scope.appId,
      ].join("\n")
    )
    return
  }

  const lines = [
    "",
    "✅ 卸载完成。后续步骤：",
    "  1. 先按上方警告同步数据库结构（生成项目：bun --filter api db:generate → 人工审核 DROP TABLE → bun --filter api db:migrate）",
    "  2. 再跑全量门禁：bun run check（结构没同步时 migrate:check 会因 schema drift 报红）",
  ]
  if (plan.specAction === "archive") {
    lines.push(
      "  3. 规格书已归档到 " + plan.archivePath + "（补充归档原因占位后提交）"
    )
  }
  lines.push(
    "",
    "已知影响：",
    "  - 历史审计日志：AUDIT_MODULE_LABELS 移除后，审计页对历史记录回退显示原始模块码",
    "    （" + spec.name + "），筛选下拉不再出现该模块——属预期行为；",
    "  - 角色权限：ROLE_PERMISSIONS 中若仍引用 " +
      spec.permissionView +
      " / " +
      spec.permissionEdit +
      " 需人工移除（反向引用预检会拦截，不会自动改角色授权）；",
    "  - 若后续格式化 / 构建失败，可 Git 回滚（只限本模块路径，不动无关改动）：",
    "      git restore " + cleanPaths,
    "      git clean -fd " + cleanPaths,
    "  - 重新安装该模块：用相同 --name 重跑 gen:module 即可重建区块与文件。"
  )
  console.log(lines.join("\n"))
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

/**
 * 卸载一个 gen:module 生成的业务模块。
 *
 * 计算阶段（存在性 / 区块完整性 / 工作区 / 反向引用）失败时抛 GenModuleError，
 * 不产生任何写入；落盘后失败依赖 Git 回滚（见文件头注释）。
 */
/**
 * 注册表里的端 id。没有 web-apps.json 时退化为单端（历史形态 / 测试 fixture）；
 * 注册表存在但损坏则让 readWebApps 大声报错，不静默兜底。
 */
function registeredAppIds(root: string): string[] {
  if (!existsSync(path.join(root, "web-apps.json"))) return [DEFAULT_WEB_APP_ID]
  return readWebApps(root).map((app) => app.id)
}

export async function removeModule(
  options: RemoveModuleOptions
): Promise<void> {
  const root = path.resolve(options.root)
  const name = (options.name ?? "").trim()
  if (!name) {
    throw new GenModuleError("缺少必填参数 --name（kebab-case，如 contract）")
  }

  // 复用 gen:module 的命名校验（kebab-case / 保留名 / 形态）。
  // 注意：remove 不使用 label（卸载由区块驱动），且 name 可以超过 label 的 30 字符上限，
  // 因此这里必须传 validateLabel: false，不能把 name 当 label 校验。
  const spec = buildSpec({ name, label: name, validateLabel: false })

  const allAppIds = registeredAppIds(root)
  const requestedApp = (options.app ?? "").trim()
  let scope: RemoveScope
  let scopeWarning: string | null = null
  if (requestedApp) {
    if (!allAppIds.includes(requestedApp)) {
      throw new GenModuleError(
        '端 "' +
          requestedApp +
          '" 未在 web-apps.json 注册（已注册：' +
          allAppIds.join("、") +
          "）"
      )
    }
    scope = { kind: "slice", appId: requestedApp }
  } else {
    // 全域卸载：只把**真正含该模块区块**的端纳入注册清单，否则没区块的端会被判 missing。
    // 探测为空是合法状态（切片已先被 `--app` 拆掉、只剩后端域），此时注册清单只有后端 5 个；
    // 回退到默认端会让「先拆切片再拆后端域」这条正常序列被误判成区块被手删而永久阻塞。
    const appIds = discoverModuleAppIds(root, name, allAppIds)
    const foreign = appIds.filter((appId) => appId !== DEFAULT_WEB_APP_ID)
    if (foreign.length > 0 && !options.allApps) {
      const message =
        "模块 " +
        name +
        " 在默认端之外还有前端切片（" +
        foreign.join("、") +
        "）。全域卸载会连带拆掉它们并删除后端域，属破坏性操作，需显式确认。\n\n" +
        "  只拆某一端切片（保留后端域）：bun run remove:module --name " +
        name +
        " --app " +
        foreign[0] +
        "\n  确认全域卸载：bun run remove:module --name " +
        name +
        " --all-apps"
      if (options.dryRun) {
        scopeWarning = message
      } else {
        throw new GenModuleError(message)
      }
    }
    scope = { kind: "domain", appIds }
  }
  const sliceOnly = scope.kind === "slice"

  const plan = buildRemoveModulePlan(
    root,
    spec,
    Boolean(options.purgeSpec),
    undefined,
    scope,
    allAppIds,
    options.simulatedDeletedPaths ?? []
  )
  const dirtyBlocked = plan.dirtyPaths.length > 0 && !options.force

  // 工作区干净预检：dry-run 只预览、不写盘，因此不拦截（打印 warning 即可）；
  // 正式执行才要求 --force 放行。
  if (dirtyBlocked && !options.dryRun) {
    throw new GenModuleError(
      "相关文件存在未提交改动，拒绝卸载（避免误删未保存的修改）：\n" +
        plan.dirtyPaths.map((line) => "  " + line).join("\n") +
        formatDirtyWorkspaceHint(plan.dirtyPaths)
    )
  }
  // 反向引用预检（计算阶段，落盘前；dry-run 同样必须通过——它反映真实卸载可行性）
  if (plan.references.length > 0) {
    throw new GenModuleError(formatReverseReferenceHits(name, plan.references))
  }

  if (!options.quiet) printRemovePlan(plan)
  if (scopeWarning) console.log("\n⚠️  " + scopeWarning)

  if (options.dryRun) {
    if (dirtyBlocked) {
      console.log(
        "\n⚠️  相关文件存在未提交改动：正式执行需要 --force（dry-run 不写盘，可正常预览）。" +
          formatDirtyWorkspaceHint(plan.dirtyPaths)
      )
    }
    if (plan.archiveExists) {
      console.log(
        "\n⚠️  归档目标已存在：正式执行需要 --force 才会覆盖（dry-run 不写盘，可正常预览）。"
      )
    }
    console.log("\n--dry-run：未删除 / 未写入任何文件。")
    return
  }

  // 归档目标保护：默认拒绝覆盖已存在的归档（历史业务决策记录不能静默丢失）
  if (plan.archivePath && plan.archiveExists && !options.force) {
    throw new GenModuleError(
      "归档目标已存在，拒绝覆盖：" +
        plan.archivePath +
        "\n\n规格书默认归档到该路径；覆盖历史归档可能丢失既有业务记录。\n" +
        "请先手动备份 / 改名归档文件，或确认无保留价值后加 --force 覆盖。"
    )
  }

  // ── 一次性落盘 ─────────────────────────────────────────────────────────────
  for (const relPath of plan.deletedPaths) {
    if (relPath === plan.specDocPath && plan.specAction === "archive") continue
    const absolutePath = path.join(root, relPath)
    rmSync(absolutePath, { recursive: true, force: true })
  }
  for (const file of plan.registrationFiles) {
    writeFileSync(path.join(root, file.relPath), file.after, "utf8")
  }
  if (plan.specDocPath) {
    const specAbsolute = path.join(root, plan.specDocPath)
    if (plan.specAction === "purge") {
      rmSync(specAbsolute, { force: true })
    } else if (plan.archivePath) {
      const archiveAbsolute = path.join(root, plan.archivePath)
      mkdirSync(path.dirname(archiveAbsolute), { recursive: true })
      const archived = buildArchivedSpecContent(
        name,
        todayLocalDate(),
        readFileSync(specAbsolute, "utf8")
      )
      writeFileSync(archiveAbsolute, archived, "utf8")
      rmSync(specAbsolute, { force: true })
    }
  }
  if (!options.quiet) {
    console.log(
      "\n✅ 已删除 " +
        plan.deletedPaths.filter((relPath) => relPath !== plan.specDocPath)
          .length +
        " 个模块文件/目录，剥离 " +
        plan.registrationFiles.length +
        " 个注册文件。"
    )
  }

  // ── 剪枝 + 格式化 + 构建 + 棘轮 + DB（落盘后阶段，失败依赖 Git 回滚）─────────
  const touchedPaths = plan.registrationFiles.map((file) => file.relPath)
  try {
    if (options.skipFormat) {
      console.log(
        "\n⏭️  --skip-format：跳过 imports:prune / prettier / eslint --fix（建议手动跑 bun run imports:prune + lint:fix）"
      )
    } else {
      console.log("\n🧹 imports:prune（删除区块剥离后残留的未使用导入）...")
      pruneUnusedImportsInFiles(root, touchedPaths)
      formatGeneratedFiles(root, touchedPaths)
    }

    // 切片模式：后端域未动，shared 产物与数据库结构都不需要重建/同步。
    // 棘轮仍要剪——本端被删的超长页条目会失效。
    if (!sliceOnly) {
      console.log("\n📦 重新构建 packages/shared ...")
      buildSharedPackage(root)

      const removedArtifacts = removeSharedBuildArtifacts(root, spec.name)
      if (removedArtifacts.length > 0) {
        console.log("🧹 清理 shared 构建产物：" + removedArtifacts.join("、"))
      }
    }

    console.log("\n📏 剪枝 LONG_FILE_RATCHET ...")
    pruneLongFileRatchet(root)

    if (!sliceOnly) {
      syncDatabaseOnRemove(root, spec, Boolean(options.skipDb))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const origin =
      error instanceof GenModuleError ? "" : "\n（原始错误：" + message + "）"
    throw new GenModuleError(
      "卸载已落盘，但后续步骤失败（" +
        (options.skipFormat
          ? "构建 / 棘轮 / DB"
          : "imports:prune / 格式化 / 构建 / 棘轮 / DB") +
        "）：\n" +
        message +
        origin +
        "\n\n由于执行前已要求工作区干净，可用 Git 完整回滚：\n" +
        "  git restore " +
        rollbackCleanPaths(spec, scope, allAppIds).join(" ") +
        "\n  git clean -fd " +
        rollbackCleanPaths(spec, scope, allAppIds).join(" ") +
        "\n如需保留删除结果，可手动修复上述失败后重跑 bun run check。"
    )
  }

  if (!options.quiet) printRemoveNextSteps(plan, scope, allAppIds)
}

/**
 * 清空某端的全部模块切片（`--app <id> --all-modules`，add:web 克隆后清场用）。
 *
 * 迭代到不动点而非单遍：克隆来的模块之间可能有跨模块引用（B 的页面引 A 的 service），
 * 单遍会因顺序不对而失败；迭代自动按依赖顺序剥离，只有真正解不开的环才报错。
 * 每轮复用 removeModule 的全部预检，不新建机制。
 *
 * 探测到 0 个模块必须静默成功（init 最常见路径：模板仓库没有生成模块）。
 */
export async function removeAllAppModuleSlices(options: {
  root: string
  app: string
  dryRun?: boolean
  force?: boolean
  skipFormat?: boolean
}): Promise<void> {
  const root = path.resolve(options.root)
  const appId = (options.app ?? "").trim()
  if (!appId) {
    throw new GenModuleError("--all-modules 必须与 --app <id> 同时使用")
  }
  const allAppIds = registeredAppIds(root)
  if (!allAppIds.includes(appId)) {
    throw new GenModuleError(
      '端 "' +
        appId +
        '" 未在 web-apps.json 注册（已注册：' +
        allAppIds.join("、") +
        "）"
    )
  }

  let pending = discoverAppModuleNames(root, appId)
  if (pending.length === 0) {
    console.log('端 "' + appId + '" 没有业务模块切片，无需清理。')
    return
  }

  console.log(
    '🧹 清空端 "' +
      appId +
      '" 的 ' +
      pending.length +
      " 个模块切片：" +
      pending.join("、")
  )

  const removed: string[] = []
  const blockers = new Map<string, string>()
  // dry-run 不落盘，所以要自己记住「前几轮已经模拟移除的切片」，
  // 否则跨模块引用会被反复看成活引用，把可按顺序解开的依赖误报成环。
  const simulatedDeleted: string[] = []
  while (pending.length > 0) {
    let progressed = false
    for (const name of [...pending]) {
      try {
        await removeModule({
          root,
          name,
          app: appId,
          dryRun: options.dryRun,
          // 尊重调用方的 --force：init / add:web 编排会显式传（克隆切片本就要丢），
          // 交互式清场则必须保留脏工作区护栏，否则会静默删掉未提交的改动。
          force: options.force,
          // N 个模块跑 N 遍 TS LanguageService 太贵；注册文件只有 3 个，收尾统一处理
          skipFormat: true,
          quiet: true,
          simulatedDeletedPaths: simulatedDeleted,
        })
        if (options.dryRun) {
          const slice = webSlicePathCandidates(
            buildSpec({ name, label: name, validateLabel: false }),
            appId
          )
          simulatedDeleted.push(...slice.files, ...slice.dirs)
        }
        pending = pending.filter((item) => item !== name)
        blockers.delete(name)
        removed.push(name)
        progressed = true
      } catch (error) {
        blockers.set(
          name,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    if (!progressed) {
      throw new GenModuleError(
        "以下模块切片无法自动剥离（跨模块引用成环，或区块标记被手改）：\n" +
          [...blockers.entries()]
            .map(([name, message]) => "── " + name + " ──\n" + message)
            .join("\n\n") +
          "\n\n请先在源端解开跨模块引用（或人工清理残留），再重跑本命令。"
      )
    }
  }

  if (options.dryRun) {
    console.log("\n--dry-run：未删除 / 未写入任何文件。")
    return
  }

  // 收尾一次性剪枝 + 格式化（只涉及该端 3 个注册文件）
  const registrationFiles = webSliceRegistrationFiles(appId)
  if (!options.skipFormat) {
    console.log("\n🧹 imports:prune + 格式化（收尾统一执行一次）...")
    pruneUnusedImportsInFiles(root, registrationFiles)
    formatGeneratedFiles(root, registrationFiles)
  }
  pruneLongFileRatchet(root)

  console.log(
    '\n✅ 已清空端 "' +
      appId +
      '" 的 ' +
      removed.length +
      " 个模块切片（后端域与其他端未改动）：" +
      removed.join("、")
  )
}
