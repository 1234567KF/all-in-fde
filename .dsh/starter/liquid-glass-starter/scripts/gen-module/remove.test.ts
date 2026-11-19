/**
 * remove:module 单测 — 在 mkdtemp 临时 monorepo 副本上跑完整卸载流程。
 *
 * 绝不写真实仓库：每个用例都复制真实 8 个注册文件到临时目录，再用 gen:module 的纯函数
 * 生成模块文件与注册结果，最后调用 removeModule 验证「删文件 + 剥区块 + 归档规格书 +
 * imports:prune + 反向引用预检 + 工作区预检」的行为。
 *
 * 覆盖（模板仓库实施计划 §7 / 设计书 §6.4–6.6）：
 *   1. 单模块完整卸载：模块文件删除、8 个注册文件区块剥离且 pristine 逐字节还原、规格书归档；
 *   2. 双模块卸载其一 / 全部：Business 容器与共用图标保留、全部卸载后容器收起；
 *   3. 反向引用拦截：区块外引用（@/services / shared 导出符号 / 外键 references / ROLE_PERMISSIONS）；
 *   4. 存量模块（无区块）与区块标记损坏 → 报错不猜、不落盘；
 *   5. --dry-run 不落盘；--purge-spec 物理删除；幂等（二次卸载报「未找到模块」）；
 *   6. git 工作区干净预检与 --force 放行。
 */
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"

import {
  buildSpec,
  type ModuleSpec,
  REGISTRATION_FILE_LIST,
  renderModuleFiles,
  renderRegistrationChanges,
  renderSpecDoc,
  renderWebSliceFiles,
  resolveRepoRoot,
  webSliceRegistrationFiles,
} from "../gen-module"
import {
  listRegions,
  MODULE_REGION_PREFIX,
  stripRegions,
} from "../lib/code-regions"
import {
  backendPathCandidates,
  buildArchivedSpecContent,
  buildRemoveModulePlan,
  buildReverseReferencePatterns,
  discoverAppModuleNames,
  discoverModuleAppIds,
  expectedModuleRegionCount,
  findReverseReferences,
  formatDirtyWorkspaceHint,
  getDirtyPaths,
  type GitRunner,
  modulePathCandidates,
  parseSharedExportedSymbols,
  pruneLongFileRatchet,
  removeAllAppModuleSlices,
  removeModule,
  removeSharedBuildArtifacts,
  rollbackCleanPaths,
  scopedRegistrationFiles,
  stripModuleRegions,
  stripModuleRegionsDetailed,
  syncDatabaseOnRemove,
  webSlicePathCandidates,
} from "./remove"

// ─── 临时 monorepo 工具 ─────────────────────────────────────────────────────

const REAL_ROOT = resolveRepoRoot()
const tempRoots: string[] = []

/**
 * CI 的 check 镜像（`bun:1-alpine`）未安装 git（`bun install` 时 husky 也会打印
 * `git command not found`）。依赖真实 git 的集成用例在无 git 环境下跳过，避免门禁
 * 因环境差异变红；git 输出解析与失败分支本身由 `getDirtyPaths` 的注入式单测覆盖。
 */
const GIT_AVAILABLE =
  spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0
let logSpy: ReturnType<typeof spyOn> | null = null
let warnSpy: ReturnType<typeof spyOn> | null = null

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation(() => {})
  warnSpy = spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  logSpy?.mockRestore()
  warnSpy?.mockRestore()
  logSpy = null
  warnSpy = null
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function tempFile(root: string, relPath: string): string {
  return path.join(root, relPath)
}

function exists(root: string, relPath: string): boolean {
  return existsSync(tempFile(root, relPath))
}

function readTemp(root: string, relPath: string): string {
  return readFileSync(tempFile(root, relPath), "utf8")
}

function writeTemp(root: string, relPath: string, content: string): void {
  const absolute = tempFile(root, relPath)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content, "utf8")
}

/** 创建临时 monorepo 副本：真实 8 个注册文件（含当前仓库已有的生成模块） */
function createTempMonorepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "remove-module-"))
  tempRoots.push(root)
  for (const relPath of REGISTRATION_FILE_LIST) {
    writeTemp(
      root,
      relPath,
      readFileSync(path.join(REAL_ROOT, relPath), "utf8")
    )
  }
  return root
}

/** 原始注册文件内容快照（用于逐字节还原断言） */
function pristineRegistrationFiles(): Map<string, string> {
  const map = new Map<string, string>()
  for (const relPath of REGISTRATION_FILE_LIST) {
    map.set(relPath, readFileSync(path.join(REAL_ROOT, relPath), "utf8"))
  }
  return map
}

/** 只创建空临时仓库根（不复制真实注册文件；纯函数扫描用例用） */
function createTempDir(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "remove-module-empty-"))
  tempRoots.push(root)
  return root
}

/** 仓库当前已生成的业务模块名（生成项目里可能已有 category 等用户模块） */
function repoExistingModuleNames(): string[] {
  const names = new Set<string>()
  for (const [, content] of pristineRegistrationFiles()) {
    try {
      for (const id of listRegions(content)) {
        if (id.startsWith("module:")) names.add(id.slice("module:".length))
      }
    } catch {
      // 区块损坏由完整性门禁负责，这里只做状态探测
    }
  }
  return [...names].sort()
}

const EXISTING_MODULE_NAMES = repoExistingModuleNames()

/** 生成一个与仓库现有模块不冲突的探针模块名 */
function freshModuleName(base: string): string {
  const taken = new Set(EXISTING_MODULE_NAMES)
  if (!taken.has(base)) return base
  for (let index = 2; index < 100; index += 1) {
    const candidate = base + "-probe" + index
    if (!taken.has(candidate)) return candidate
  }
  throw new Error("无法生成不冲突的探针模块名：" + base)
}

/** 依次取仓库 menu-config 中未使用的探针图标名（生成项目可能已占用 FileText/Tag 等） */
const PROBE_ICON_CANDIDATES = [
  "ZzProbeAlpha",
  "ZzProbeBeta",
  "ZzProbeGamma",
  "ZzProbeDelta",
] as const

function freshProbeIcons(count: number): string[] {
  const menu = readFileSync(
    path.join(REAL_ROOT, "apps/web/src/lib/menu-config.ts"),
    "utf8"
  )
  const icons = PROBE_ICON_CANDIDATES.filter(
    (icon) => !new RegExp("\\b" + icon + "\\b").test(menu)
  ).slice(0, count)
  if (icons.length < count) {
    throw new Error("可用探针图标不足，无法构造卸载用例")
  }
  return icons
}

/** 用 gen:module 的纯函数在临时仓库里「生成」一个模块（文件 + 注册点 + 规格书） */
function generateModule(root: string, spec: ModuleSpec): void {
  for (const file of renderModuleFiles(spec)) {
    writeTemp(root, file.relPath, file.content)
  }
  const specDoc = renderSpecDoc(spec, "2026-11-05")
  writeTemp(root, specDoc.relPath, specDoc.content)
  for (const change of renderRegistrationChanges(spec, (relPath) =>
    exists(root, relPath) ? readTemp(root, relPath) : null
  )) {
    writeTemp(root, change.relPath, change.after)
  }
}

/** 与仓库 .prettierrc 一致（tailwind 插件对注册文件无影响，省去插件加载） */
const PRETTIER_OPTIONS = {
  endOfLine: "lf" as const,
  semi: false,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "es5" as const,
  printWidth: 80,
}

/** 用仓库 prettier 收敛（模拟 remove:module 落盘后的 prettier --write） */
async function formatWithPrettier(
  content: string,
  filePath: string
): Promise<string> {
  const prettier = (await import("prettier")) as {
    format: (
      source: string,
      options: Record<string, unknown>
    ) => Promise<string>
  }
  return prettier.format(content, {
    ...PRETTIER_OPTIONS,
    filepath: filePath,
    plugins: [],
  })
}

/**
 * 断言 8 个注册文件回到 pristine 字节。
 *
 * remove:module 的落盘后流水线是 imports:prune + prettier（+ eslint）。临时目录没有
 * node_modules，removeModule 会跳过 prettier，因此这里按真实流水线补一次 prettier 再比较：
 * 生成项目里 scaffold 已把基线 prettier 化（如全剥离后 menu-config 是单行 import），
 * 只 prune 不 prettier 会得到「多行 import ≠ 单行基线」的假失败（R3）。
 */
async function expectRegistrationFilesRestored(
  root: string,
  pristine: Map<string, string>
): Promise<void> {
  for (const relPath of REGISTRATION_FILE_LIST) {
    const formatted = await formatWithPrettier(
      readTemp(root, relPath),
      tempFile(root, relPath)
    )
    expect(formatted, relPath).toBe(pristine.get(relPath)!)
  }
}

// ─── 纯函数工具 ─────────────────────────────────────────────────────────────

describe("remove:module 纯函数工具", () => {
  it("stripModuleRegions 删除目标区块并收起空 gen:group 容器", () => {
    const source = [
      "export const groups = [",
      "  // #region gen:group:Business",
      "  {",
      '    label: "Business",',
      "    items: [",
      "      // #region module:contract",
      '      { path: "/contract" },',
      "      // #endregion module:contract",
      "      // [gen:module:menu-items] 锚点",
      "    ],",
      "  },",
      "  // #endregion gen:group:Business",
      "  // [gen:module:menu-groups] 锚点",
      "]",
      "",
    ].join("\n")
    expect(stripModuleRegions(source, "contract")).toBe(
      [
        "export const groups = [",
        "  // [gen:module:menu-groups] 锚点",
        "]",
        "",
      ].join("\n")
    )
  })

  it("modulePathCandidates 生成与设计书 §6.3 一致的确定性路径", () => {
    const spec = buildSpec({ name: "purchase-order", label: "采购单" })
    const candidates = modulePathCandidates(spec)
    expect(candidates.files).toContain("packages/shared/src/purchase-order.ts")
    expect(candidates.files).toContain(
      "apps/web/src/hooks/queries/usePurchaseOrder.ts"
    )
    expect(candidates.dirs).toEqual([
      "apps/api/src/modules/purchase-order",
      "apps/web/src/pages/purchase-order",
    ])
    expect(candidates.specDoc).toBe("docs/specs/purchase-order.md")
  })

  it("parseSharedExportedSymbols 从 index.ts 区块解析导出符号", () => {
    const index = [
      'export { type ApiResponse } from "./response.js"',
      "",
      "// #region module:contract",
      "export {",
      "  CONTRACT_STATUS,",
      "  type Contract,",
      "  ContractFormSchema,",
      '} from "./contract.js"',
      "// #endregion module:contract",
      "",
    ].join("\n")
    expect(parseSharedExportedSymbols(index, "contract")).toEqual([
      "CONTRACT_STATUS",
      "Contract",
      "ContractFormSchema",
    ])
    expect(parseSharedExportedSymbols(index, "other")).toEqual([])
  })

  it("buildArchivedSpecContent 追加归档日期与原因占位", () => {
    const archived = buildArchivedSpecContent(
      "contract",
      "2026-11-05",
      "# 合同规格书\n"
    )
    expect(archived).toContain("> **归档日期**：2026-11-05")
    expect(archived).toContain("> **归档原因**：模块 `contract` 已卸载")
    expect(archived).toContain("# 合同规格书")
    expect(archived.endsWith("# 合同规格书\n")).toBe(true)
  })

  it("getDirtyPaths：非 git 目录视为干净", () => {
    const root = createTempDir()
    expect(getDirtyPaths(root, REGISTRATION_FILE_LIST)).toEqual([])
  })

  it("formatDirtyWorkspaceHint：porcelain 行还原成可复制执行的命令", () => {
    const hint = formatDirtyWorkspaceHint([
      " M apps/web/src/App.tsx",
      "?? docs/specs/contract.md",
      "R  packages/shared/src/old.ts -> packages/shared/src/new.ts",
      '?? "docs/specs/my spec.md"',
    ])
    const paths =
      "apps/web/src/App.tsx docs/specs/contract.md " +
      "packages/shared/src/new.ts 'docs/specs/my spec.md'"
    // 重命名取新路径；含空格的路径被单引号包裹，命令可直接粘贴
    expect(hint).toContain(
      "git add " + paths + ' && git commit -m "wip: 卸载前保存改动"'
    )
    expect(hint).toContain("git stash push -- " + paths)
    expect(hint).toContain("--force")
  })

  it("formatDirtyWorkspaceHint：空输入返回空串（不输出空命令）", () => {
    expect(formatDirtyWorkspaceHint([])).toBe("")
    expect(formatDirtyWorkspaceHint(["", "   "])).toBe("")
  })

  it("syncDatabaseOnRemove：生成项目（drizzle/）只提示不执行 DROP；缺失来源跳过", () => {
    const root = createTempDir()
    const spec = buildSpec({ name: "contract", label: "合同" })
    mkdirSync(path.join(root, "apps/api/drizzle"), { recursive: true })
    // 生成项目：只打印人工审核提示，不写任何迁移文件、不执行子进程
    expect(() => syncDatabaseOnRemove(root, spec, false)).not.toThrow()
    expect(readdirSync(path.join(root, "apps/api/drizzle"))).toEqual([])

    const emptyRoot = createTempDir()
    expect(() => syncDatabaseOnRemove(emptyRoot, spec, false)).not.toThrow()
    // --skip-db 直接跳过
    expect(() => syncDatabaseOnRemove(emptyRoot, spec, true)).not.toThrow()
  })

  it("pruneLongFileRatchet：剪掉指向已不存在文件的棘轮条目", () => {
    const root = createTempDir()
    mkdirSync(path.join(root, "scripts"), { recursive: true })
    writeTemp(
      root,
      "scripts/arch-check.ts",
      [
        "const LONG_FILE_RATCHET: Record<string, number> = {",
        '  "apps/web/src/pages/contract/ContractPage.tsx": 500,',
        '  "apps/web/src/pages/dashboard/DashboardPage.tsx": 470,',
        "}",
        "",
      ].join("\n")
    )
    // dashboard 文件存在，contract 文件不存在 → 只剪后者
    writeTemp(root, "apps/web/src/pages/dashboard/DashboardPage.tsx", "")
    pruneLongFileRatchet(root)
    const archCheck = readTemp(root, "scripts/arch-check.ts")
    expect(archCheck).not.toContain("ContractPage.tsx")
    expect(archCheck).toContain("DashboardPage.tsx")
  })

  it("rollbackCleanPaths：Git 回滚提示使用真实模块路径而非裸模块名（F4 回归）", () => {
    const spec = buildSpec({ name: "contract", label: "合同" })
    const paths = rollbackCleanPaths(spec)
    expect(paths).toContain("apps/api/src/modules/contract")
    expect(paths).toContain("apps/web/src/pages/contract")
    expect(paths).toContain("packages/shared/src/contract.ts")
    expect(paths).toContain("apps/web/src/services/contract.ts")
    expect(paths).toContain("apps/web/src/hooks/queries/useContract.ts")
    expect(paths).toContain("docs/specs/contract.md")
    // 裸模块名在仓库根匹配不到任何真实路径，不能出现在回滚清单里
    expect(paths).not.toContain("contract")
  })

  it("removeSharedBuildArtifacts：只删 packages/shared/dist/<name>.* 构建产物（F5 回归）", () => {
    const root = createTempDir()
    writeTemp(root, "packages/shared/dist/contract.js", "")
    writeTemp(root, "packages/shared/dist/contract.js.map", "")
    writeTemp(root, "packages/shared/dist/contract.d.ts", "")
    writeTemp(root, "packages/shared/dist/contract.d.ts.map", "")
    // 前缀相近的模块 / 其他产物不能被误删
    writeTemp(root, "packages/shared/dist/contract-probe2.d.ts", "")
    writeTemp(root, "packages/shared/dist/index.js", "")
    writeTemp(root, "packages/shared/dist/index.d.ts", "")

    const removed = removeSharedBuildArtifacts(root, "contract")
    expect(removed).toEqual([
      "contract.d.ts",
      "contract.d.ts.map",
      "contract.js",
      "contract.js.map",
    ])
    expect(exists(root, "packages/shared/dist/contract.js")).toBe(false)
    expect(exists(root, "packages/shared/dist/contract-probe2.d.ts")).toBe(true)
    expect(exists(root, "packages/shared/dist/index.d.ts")).toBe(true)

    // 幂等：再跑一次没有可删产物；dist 不存在也不报错
    expect(removeSharedBuildArtifacts(root, "contract")).toEqual([])
    expect(removeSharedBuildArtifacts(createTempDir(), "contract")).toEqual([])
  })

  it("findReverseReferences 跳过被删文件与注释行", () => {
    const root = createTempDir()
    writeTemp(
      root,
      "apps/web/src/pages/contract/ContractPage.tsx",
      'import { x } from "@/services/contract"\n'
    )
    writeTemp(
      root,
      "apps/web/src/pages/other/OtherPage.tsx",
      '// 旧实现见 "@/services/contract"\nimport { y } from "@/services/contract"\n'
    )
    writeTemp(
      root,
      "apps/web/src/services/contract.ts",
      'import { x } from "@/services/contract"\n'
    )
    const hits = findReverseReferences({
      root,
      spec: buildSpec({ name: "contract", label: "合同" }),
      sharedSymbols: [],
      linePatterns: [
        {
          feature: "@/services/contract",
          regex: /@\/services\/contract/,
        },
      ],
      deletedPaths: [
        "apps/web/src/pages/contract",
        "apps/web/src/services/contract.ts",
      ],
      strippedContents: new Map(),
    })
    expect(hits.map((hit) => hit.relPath)).toEqual([
      "apps/web/src/pages/other/OtherPage.tsx",
    ])
    expect(hits[0].line).toBe(2)
  })

  it("表标识符 / shared 符号收紧：UI 文案与同名本地变量不再误报", () => {
    const root = createTempDir()
    // BUG-1 回归：真实模板里 ComponentsOverviewPage 的本地变量 categories、
    // DashboardPage 的文案 Category Distribution 曾让 category 模块无法卸载。
    writeTemp(
      root,
      "apps/web/src/pages/ComponentsOverviewPage.tsx",
      [
        "export function ComponentsOverviewPage() {",
        '  const categories = ["基础元素", "表单与输入"]',
        "  const contracts = categories.map((item) => item)",
        "  return <div>{categories.length}{contracts.length} Category Distribution</div>",
        "}",
        "",
      ].join("\n")
    )
    writeTemp(
      root,
      "apps/web/src/pages/DashboardPage.tsx",
      [
        "export function DashboardPage() {",
        "  return <h2>Category Distribution</h2>",
        "}",
        "",
      ].join("\n")
    )

    const category = buildSpec({ name: "category", label: "分类" })
    const hits = findReverseReferences({
      root,
      spec: category,
      sharedSymbols: ["Category", "CategoryFormSchema", "CATEGORY_STATUS"],
      linePatterns: buildReverseReferencePatterns(category),
      deletedPaths: [],
      strippedContents: new Map(),
    })
    // 本地变量 `categories`、JSX 文案 `Category Distribution` 都不是反向引用
    expect(hits).toEqual([])
  })

  it("shared 导出符号：多行 import { Category } from shared 仍拦截（含 type/as 别名）", () => {
    const root = createTempDir()
    const spec = buildSpec({ name: "category", label: "分类" })
    writeTemp(
      root,
      "apps/web/src/pages/other/OtherPage.tsx",
      [
        "import {",
        "  Category,",
        "  type CategoryFormSchema,",
        "  CATEGORY_STATUS as Status,",
        '} from "shared"',
        "",
        "export function OtherPage() {",
        "  return <div>{String(Category)}</div>",
        "}",
        "",
      ].join("\n")
    )
    const hits = findReverseReferences({
      root,
      spec,
      sharedSymbols: ["Category", "CategoryFormSchema", "CATEGORY_STATUS"],
      linePatterns: buildReverseReferencePatterns(spec),
      deletedPaths: [],
      strippedContents: new Map(),
    })
    expect(hits.map((hit) => hit.feature)).toEqual([
      "shared 导出符号 Category（import 自 shared）",
      "shared 导出符号 CategoryFormSchema（import 自 shared）",
      "shared 导出符号 CATEGORY_STATUS（import 自 shared）",
    ])
    // 命中行号在 import 块内（第 2/3/4 行），不是全文裸词所在行
    expect(hits.map((hit) => hit.line)).toEqual([2, 3, 4])
  })

  it("表标识符语义上下文：外键 / drizzle 调用 / schema import 块 / schema.<table> 仍拦截", () => {
    const root = createTempDir()
    const spec = buildSpec({ name: "contract", label: "合同" })
    writeTemp(
      root,
      "apps/api/src/modules/order/order.service.ts",
      [
        'import { db } from "../../db.js"',
        "import {",
        "  contracts,",
        '} from "../../db/schema.js"',
        "",
        "export function probe(ctx: unknown) {",
        "  db.select().from(contracts)",
        "  db.insert(contracts).values({})",
        "  db.update(contracts).set({})",
        "  db.delete(contracts)",
        "  return schema.contracts",
        "}",
        "",
      ].join("\n")
    )
    writeTemp(
      root,
      "apps/api/src/db/extra-schema.ts",
      [
        "export const ordersProbe = sqliteTable('orders_probe', {",
        "  contractId: integer('contract_id').references(",
        "    () => contracts.id",
        "  ),",
        "})",
        "",
      ].join("\n")
    )
    const hits = findReverseReferences({
      root,
      spec,
      sharedSymbols: [],
      linePatterns: buildReverseReferencePatterns(spec),
      deletedPaths: [],
      strippedContents: new Map(),
    })
    const features = hits.map((hit) => hit.feature)
    expect(features).toContain("外键 references(() => contracts.*)")
    expect(features).toContain(
      "drizzle 调用 from/insert/update/delete(contracts)"
    )
    expect(features).toContain("schema.contracts")
    expect(features).toContain("schema import 块含表 contracts")
  })
})

// ─── 完整卸载流程 ───────────────────────────────────────────────────────────

// ─── 完整卸载流程 ───────────────────────────────────────────────────────────

describe("removeModule 完整卸载", () => {
  it("单模块：删模块文件 + 剥 8 注册文件区块 + 规格书归档 + 逐字节还原", async () => {
    const root = createTempMonorepo()
    const pristine = pristineRegistrationFiles()
    const spec = buildSpec({
      name: freshModuleName("contract"),
      label: "合同",
    })
    generateModule(root, spec)
    // 模拟 build:shared 产出的 gitignored 构建产物（F5）：卸载后应被 best-effort 清理
    for (const artifact of [".js", ".js.map", ".d.ts", ".d.ts.map"]) {
      writeTemp(root, "packages/shared/dist/" + spec.name + artifact, "")
    }
    writeTemp(root, "packages/shared/dist/index.d.ts", "// 无关产物")

    await removeModule({ root, name: spec.name, skipDb: true })

    // 模块专属文件全部删除（路径按 spec 派生，兼容仓库已有其他生成模块）
    const candidates = modulePathCandidates(spec)
    for (const relPath of [...candidates.files, ...candidates.dirs]) {
      expect(exists(root, relPath), relPath).toBe(false)
    }

    // F5：shared dist 中的模块构建产物被清理，无关产物保留
    for (const artifact of [".js", ".js.map", ".d.ts", ".d.ts.map"]) {
      expect(
        exists(root, "packages/shared/dist/" + spec.name + artifact),
        artifact
      ).toBe(false)
    }
    expect(exists(root, "packages/shared/dist/index.d.ts")).toBe(true)

    // 规格书默认归档（保留原始内容 + 归档头），原文件移除
    expect(exists(root, candidates.specDoc)).toBe(false)
    const archived = readTemp(root, "docs/specs/_archived/" + spec.name + ".md")
    expect(archived).toMatch(/> \*\*归档日期\*\*：\d{4}-\d{2}-\d{2}/)
    expect(archived).toContain(
      "> **归档原因**：模块 `" + spec.name + "` 已卸载"
    )
    expect(archived).toContain("合同")

    // 注册文件无残留区块；仓库原本无其他模块时 Business 容器也应收起
    for (const relPath of REGISTRATION_FILE_LIST) {
      const content = readTemp(root, relPath)
      expect(content, relPath).not.toContain("module:" + spec.name)
      if (EXISTING_MODULE_NAMES.length === 0) {
        expect(content, relPath).not.toContain("gen:group:Business")
      }
    }
    await expectRegistrationFilesRestored(root, pristine)

    // 幂等：再卸载一次 → 报「未找到模块」，不产生半成品
    await expect(
      removeModule({
        root,
        name: spec.name,
        skipDb: true,
        skipFormat: true,
      })
    ).rejects.toThrow(new RegExp("未找到模块 " + spec.name))
  })

  it("双模块卸载其一：另一模块与 Business 容器保留，专属图标剪枝", async () => {
    const root = createTempMonorepo()
    const pristine = pristineRegistrationFiles()
    const [iconA, iconB] = freshProbeIcons(2)
    const nameA = freshModuleName("uninstall-a")
    const nameB = freshModuleName("uninstall-b")
    const specA = buildSpec({ name: nameA, label: "甲", icon: iconA })
    const specB = buildSpec({
      name: nameB,
      label: "乙",
      icon: iconB,
      mode: "sortable",
    })
    generateModule(root, specA)
    generateModule(root, specB)

    await removeModule({ root, name: nameA, skipDb: true })

    const menu = readTemp(root, "apps/web/src/lib/menu-config.ts")
    expect(menu).toContain("// #region gen:group:Business")
    expect(menu).toContain("// #region module:" + nameB)
    expect(menu).not.toContain("module:" + nameA)
    // A/B 用不同图标：A 的图标随 A 区块删除后被 prune 剪掉，B 的保留
    expect(menu).toContain(iconB)
    expect(menu).not.toContain(iconA)
    // 全仓库只有一个 Business 容器
    expect(menu.match(/label: "Business"/g)?.length).toBe(1)

    // B 的注册仍完整（权限 / 表 / 路由）
    expect(readTemp(root, "packages/shared/src/permissions.ts")).toContain(
      specB.upper + "_VIEW"
    )
    expect(readTemp(root, "apps/api/src/db/schema.ts")).toContain(specB.table)
    expect(readTemp(root, "apps/web/src/App.tsx")).toContain(
      specB.pascal + "Page"
    )

    // 卸载最后一个模块：仓库原本无其他模块时 Business 容器收起
    await removeModule({ root, name: nameB, skipDb: true })
    for (const relPath of REGISTRATION_FILE_LIST) {
      const content = readTemp(root, relPath)
      expect(content, relPath).not.toContain("module:" + nameA)
      expect(content, relPath).not.toContain("module:" + nameB)
      if (EXISTING_MODULE_NAMES.length === 0) {
        expect(content, relPath).not.toContain("#region module:")
        expect(content, relPath).not.toContain("gen:group:Business")
      }
    }
    await expectRegistrationFilesRestored(root, pristine)
  })

  it("--purge-spec 物理删除规格书（不产生归档目录）", async () => {
    const root = createTempMonorepo()
    const spec = buildSpec({
      name: freshModuleName("contract"),
      label: "合同",
    })
    generateModule(root, spec)

    await removeModule({
      root,
      name: spec.name,
      purgeSpec: true,
      skipDb: true,
      skipFormat: true,
    })

    expect(exists(root, "docs/specs/" + spec.name + ".md")).toBe(false)
    expect(exists(root, "docs/specs/_archived/" + spec.name + ".md")).toBe(
      false
    )
  })

  it("--dry-run 只打印计划：文件、区块、规格书全部不动", async () => {
    const root = createTempMonorepo()
    const spec = buildSpec({
      name: freshModuleName("contract"),
      label: "合同",
    })
    generateModule(root, spec)
    const candidates = modulePathCandidates(spec)
    // 生成器只产出一部分候选路径（如 shared 契约测试文件不一定存在），
    // dry-run 断言只针对「执行前实际存在」的模块文件
    const existedBefore = [...candidates.files, ...candidates.dirs].filter(
      (relPath) => exists(root, relPath)
    )
    expect(existedBefore.length).toBeGreaterThan(0)
    const registrationBefore = new Map(
      REGISTRATION_FILE_LIST.map((relPath) => [
        relPath,
        readTemp(root, relPath),
      ])
    )

    await removeModule({ root, name: spec.name, dryRun: true, skipDb: true })

    for (const relPath of existedBefore) {
      expect(exists(root, relPath), relPath).toBe(true)
    }
    expect(exists(root, candidates.specDoc)).toBe(true)
    expect(exists(root, "docs/specs/_archived/" + spec.name + ".md")).toBe(
      false
    )
    for (const relPath of REGISTRATION_FILE_LIST) {
      expect(readTemp(root, relPath), relPath).toBe(
        registrationBefore.get(relPath)!
      )
    }

    // dry-run 之后正式执行仍可成功（预检未污染工作区）
    await removeModule({
      root,
      name: spec.name,
      skipDb: true,
      skipFormat: true,
    })
    expect(exists(root, candidates.files[0])).toBe(false)
  })
})

// ─── 预检拦截：区块缺失 / 损坏 / 反向引用 / 工作区脏 ─────────────────────────

describe("removeModule 预检拦截", () => {
  it("存量模块（缺少 module 区块）→ 报错列文件，不落盘", async () => {
    const root = createTempMonorepo()
    const name = freshModuleName("legacy")
    const spec = buildSpec({ name, label: "存量" })
    // 只写模块文件与规格书，不写注册区块（模拟 v2 之前生成的存量模块）
    for (const file of renderModuleFiles(spec)) {
      writeTemp(root, file.relPath, file.content)
    }
    writeTemp(root, "docs/specs/" + name + ".md", "# 存量模块\n")

    await expect(
      removeModule({
        root,
        name,
        skipDb: true,
        skipFormat: true,
      })
    ).rejects.toThrow(new RegExp("缺少 module:" + name + " 区块"))
    expect(exists(root, "packages/shared/src/" + name + ".ts")).toBe(true)
    expect(exists(root, "docs/specs/" + name + ".md")).toBe(true)
  })

  it("区块标记损坏（缺 endregion）→ 报错带行号，不落盘", async () => {
    const root = createTempMonorepo()
    const spec = buildSpec({
      name: freshModuleName("contract"),
      label: "合同",
    })
    generateModule(root, spec)
    const permissions = readTemp(root, "packages/shared/src/permissions.ts")
    const broken = permissions.replace(
      "// #endregion module:" + spec.name + "\n",
      ""
    )
    expect(broken).not.toBe(permissions)
    writeTemp(root, "packages/shared/src/permissions.ts", broken)

    await expect(
      removeModule({
        root,
        name: spec.name,
        skipDb: true,
        skipFormat: true,
      })
    ).rejects.toThrow(/区块标记损坏（第 \d+ 行）/)
    expect(exists(root, "packages/shared/src/" + spec.name + ".ts")).toBe(true)
  })

  it("区块外引用 @/services 与 shared 导出符号 → 拦截并列出位置", async () => {
    const root = createTempMonorepo()
    const spec = buildSpec({
      name: freshModuleName("contract"),
      label: "合同",
    })
    generateModule(root, spec)
    writeTemp(
      root,
      "apps/web/src/pages/other/OtherPage.tsx",
      [
        'import { listContracts } from "@/services/' + spec.name + '"',
        "import { type " + spec.pascal + ' } from "shared"',
        "",
      ].join("\n")
    )

    const failure = removeModule({
      root,
      name: spec.name,
      skipDb: true,
      skipFormat: true,
    })
    await expect(failure).rejects.toThrow(/反向引用/)
    await expect(failure).rejects.toThrow(new RegExp("@/services/" + spec.name))
    await expect(failure).rejects.toThrow(
      new RegExp("shared 导出符号 " + spec.pascal)
    )
    // 未落盘：模块文件与区块都还在
    expect(exists(root, "packages/shared/src/" + spec.name + ".ts")).toBe(true)
    expect(readTemp(root, "packages/shared/src/permissions.ts")).toContain(
      "module:" + spec.name
    )
  })

  it("外键 references(() => <table>.id) 仍拦截（多行写法）", async () => {
    const root = createTempMonorepo()
    const spec = buildSpec({
      name: freshModuleName("contract"),
      label: "合同",
    })
    generateModule(root, spec)
    writeTemp(
      root,
      "apps/api/src/db/extra-schema.ts",
      [
        "import {",
        "  " + spec.table + ",",
        '} from "./schema.js"',
        "",
        'export const ordersProbe = sqliteTable("orders_probe", {',
        '  contractId: integer("contract_id").references(',
        "    () => " + spec.table + ".id",
        "  ),",
        "})",
        "",
      ].join("\n")
    )

    const failure = removeModule({
      root,
      name: spec.name,
      skipDb: true,
      skipFormat: true,
    })
    await expect(failure).rejects.toThrow(
      new RegExp("外键 references\\(\\(\\) => " + spec.table)
    )
    await expect(failure).rejects.toThrow(
      /apps\/api\/src\/db\/extra-schema\.ts/
    )
    expect(exists(root, "packages/shared/src/" + spec.name + ".ts")).toBe(true)
  })

  it("ROLE_PERMISSIONS 引用区块外新增权限 / 权限码字符串 → 拦截", async () => {
    const root = createTempMonorepo()
    const spec = buildSpec({
      name: freshModuleName("contract"),
      label: "合同",
    })
    generateModule(root, spec)
    const permissions = readTemp(root, "packages/shared/src/permissions.ts")
    writeTemp(
      root,
      "packages/shared/src/permissions.ts",
      permissions +
        "\nexport const ROLE_PERMISSIONS_PROBE = { admin: [PERMISSIONS." +
        spec.upper +
        "_APPROVE] }\n" +
        'export const PERMISSION_LITERAL_PROBE = "' +
        spec.name +
        ':approve"\n'
    )

    const failure = removeModule({
      root,
      name: spec.name,
      skipDb: true,
      skipFormat: true,
    })
    // 设计书 §6.4 例子：开发者在区块外新增 <UPPER>_APPROVE 并在别处使用也必须拦截
    await expect(failure).rejects.toThrow(
      new RegExp("PERMISSIONS\\." + spec.upper + "_")
    )
    await expect(failure).rejects.toThrow(
      new RegExp("权限码字符串 " + spec.name)
    )
    expect(exists(root, "packages/shared/src/" + spec.name + ".ts")).toBe(true)
  })

  it.skipIf(!GIT_AVAILABLE)(
    "git 工作区有未提交改动 → 默认拒绝；--force 放行",
    async () => {
      const root = createTempMonorepo()
      const spec = buildSpec({
        name: freshModuleName("contract"),
        label: "合同",
      })
      generateModule(root, spec)
      const init = spawnSync("git", ["init", "-q"], {
        cwd: root,
        encoding: "utf8",
      })
      expect(init.status).toBe(0)

      // A6：dry-run 不写盘，工作区脏也应能正常预览（不要求 --force）
      await removeModule({
        root,
        name: spec.name,
        dryRun: true,
        skipDb: true,
        skipFormat: true,
      })
      expect(exists(root, "packages/shared/src/" + spec.name + ".ts")).toBe(
        true
      )

      // 正式执行仍要求 --force
      await expect(
        removeModule({
          root,
          name: spec.name,
          skipDb: true,
          skipFormat: true,
        })
      ).rejects.toThrow(/未提交改动/)
      expect(exists(root, "packages/shared/src/" + spec.name + ".ts")).toBe(
        true
      )

      await removeModule({
        root,
        name: spec.name,
        skipDb: true,
        skipFormat: true,
        force: true,
      })
      expect(exists(root, "packages/shared/src/" + spec.name + ".ts")).toBe(
        false
      )
      expect(exists(root, "apps/api/src/modules/" + spec.name)).toBe(false)
    }
  )
})

// ─── R2 审查回归（A1–A8）─────────────────────────────────────────────────────

describe("R2 回归：区块完整性 / 长模块名 / 语义引用 / 归档 / 容器 / dry-run / git", () => {
  it("A1：App.tsx 部分区块被删（只留 lazy，路由标记被删）→ 报错不落盘", async () => {
    const root = createTempMonorepo()
    const spec = buildSpec({
      name: freshModuleName("contract"),
      label: "合同",
    })
    generateModule(root, spec)
    // 删掉 JSX 路由区块的开/闭标记行，保留 <Route>（模拟只删 1/2 区块）
    const appPath = "apps/web/src/App.tsx"
    const app = readTemp(root, appPath)
    const broken = app
      .replace("{/* #region module:" + spec.name + " */}\n", "")
      .replace("{/* #endregion module:" + spec.name + " */}\n", "")
    expect(broken).not.toBe(app)
    writeTemp(root, appPath, broken)

    const failure = removeModule({
      root,
      name: spec.name,
      skipDb: true,
      skipFormat: true,
    })
    await expect(failure).rejects.toThrow(/区块数量与 gen:module 写入不符/)
    await expect(failure).rejects.toThrow(
      new RegExp("apps/web/src/App\\.tsx：期望 2 处，实际 1 处")
    )
    // 未落盘：模块文件与其余区块仍在
    expect(exists(root, "packages/shared/src/" + spec.name + ".ts")).toBe(true)
    expect(readTemp(root, "packages/shared/src/permissions.ts")).toContain(
      "module:" + spec.name
    )
  })

  it("A1：permissions.ts 只删 1/2 区块 → 报错并列出期望/实际", async () => {
    const root = createTempMonorepo()
    const spec = buildSpec({
      name: freshModuleName("contract"),
      label: "合同",
    })
    generateModule(root, spec)
    const relPath = "packages/shared/src/permissions.ts"
    const content = readTemp(root, relPath)
    // 只删掉第一处（权限码区）的开闭标记行，保留注册表区块
    const firstOpen = content.indexOf("// #region module:" + spec.name)
    const firstClose =
      content.indexOf("// #endregion module:" + spec.name) +
      ("// #endregion module:" + spec.name).length +
      1
    expect(firstOpen).toBeGreaterThan(-1)
    const broken = content.slice(0, firstOpen) + content.slice(firstClose)
    writeTemp(root, relPath, broken)

    await expect(
      removeModule({
        root,
        name: spec.name,
        skipDb: true,
        skipFormat: true,
      })
    ).rejects.toThrow(
      new RegExp("packages/shared/src/permissions\\.ts：期望 2 处，实际 1 处")
    )
  })

  it("A2：31+ 字符模块名生成→卸载成功（remove 不再把 name 当 label 校验）", async () => {
    const root = createTempMonorepo()
    const name = freshModuleName("purchase-order-approval-workflow")
    expect(name.length).toBeGreaterThan(30)
    const spec = buildSpec({ name, label: "采购订单审批流程" })
    generateModule(root, spec)

    await removeModule({
      root,
      name,
      skipDb: true,
      skipFormat: true,
    })
    expect(exists(root, "packages/shared/src/" + name + ".ts")).toBe(false)
    expect(exists(root, "apps/api/src/modules/" + name)).toBe(false)
  })

  it("A3：raw SQL / db.query.<table> / schema 命名空间别名 仍拦截", () => {
    const root = createTempDir()
    const spec = buildSpec({ name: "contract", label: "合同" })
    writeTemp(
      root,
      "apps/api/src/modules/order/order.repo.ts",
      [
        'import * as dbSchema from "../../db/schema.js"',
        "",
        "export function probe(db: any) {",
        "  db.run(sql`select * from contracts where id = 1`)",
        '  db.run("delete from contracts where id = 2")',
        "  db.query.contracts.findMany()",
        "  return dbSchema.contracts",
        "}",
        "",
      ].join("\n")
    )
    const hits = findReverseReferences({
      root,
      spec,
      sharedSymbols: [],
      linePatterns: buildReverseReferencePatterns(spec),
      deletedPaths: [],
      strippedContents: new Map(),
    })
    const features = hits.map((hit) => hit.feature)
    expect(features).toContain("raw SQL 引用表 contracts")
    expect(features).toContain("query.contracts")
    expect(features).toContain("schema 命名空间 dbSchema.contracts")
    expect(hits.length).toBeGreaterThanOrEqual(4)
  })

  it("A3 反例：UI 文案 / 普通数组变量 / 字符串中的单词不误报", () => {
    const root = createTempDir()
    const spec = buildSpec({ name: "category", label: "分类" })
    writeTemp(
      root,
      "apps/web/src/pages/ComponentsOverviewPage.tsx",
      [
        "const categories = [",
        '  { title: "Category Distribution" },',
        '  { title: "categories from contract view" },',
        "]",
        'export const description = "all contracts and orders"',
        "",
      ].join("\n")
    )
    const hits = findReverseReferences({
      root,
      spec,
      sharedSymbols: ["Category", "CategoryFormSchema"],
      linePatterns: buildReverseReferencePatterns(spec),
      deletedPaths: [],
      strippedContents: new Map(),
    })
    expect(hits).toEqual([])
  })

  it("A4：归档目标已存在 → 默认拒绝覆盖；dry-run 可预览；--force 才覆盖", async () => {
    const root = createTempMonorepo()
    const spec = buildSpec({
      name: freshModuleName("contract"),
      label: "合同",
    })
    generateModule(root, spec)
    const archiveRel = "docs/specs/_archived/" + spec.name + ".md"
    writeTemp(root, archiveRel, "历史归档内容（不可静默覆盖）\n")

    // 默认拒绝，且不产生任何写入
    await expect(
      removeModule({
        root,
        name: spec.name,
        skipDb: true,
        skipFormat: true,
      })
    ).rejects.toThrow(/归档目标已存在，拒绝覆盖/)
    expect(exists(root, "packages/shared/src/" + spec.name + ".ts")).toBe(true)
    expect(readTemp(root, archiveRel)).toBe("历史归档内容（不可静默覆盖）\n")

    // dry-run 不写盘，可预览（提示需要 --force）
    await removeModule({
      root,
      name: spec.name,
      dryRun: true,
      skipDb: true,
      skipFormat: true,
    })
    expect(readTemp(root, archiveRel)).toBe("历史归档内容（不可静默覆盖）\n")

    // --force 覆盖归档后成功卸载
    await removeModule({
      root,
      name: spec.name,
      force: true,
      skipDb: true,
      skipFormat: true,
    })
    expect(exists(root, "packages/shared/src/" + spec.name + ".ts")).toBe(false)
    const archived = readTemp(root, archiveRel)
    expect(archived).toMatch(/> \*\*归档日期\*\*：\d{4}-\d{2}-\d{2}/)
    expect(archived).not.toContain("不可静默覆盖")
  })

  it("A5：Business 容器内有手写菜单项 → 保留容器不误删（并产生 warning）", async () => {
    const root = createTempMonorepo()
    const spec = buildSpec({
      name: freshModuleName("contract"),
      label: "合同",
    })
    generateModule(root, spec)

    // 在 Business 分组的 module 区块之外手写一条菜单项
    const menuPath = "apps/web/src/lib/menu-config.ts"
    const menu = readTemp(root, menuPath)
    const manualItem =
      '      { title: "手写菜单项", path: "/manual", icon: Settings },\n'
    const anchor = "      // [gen:module:menu-items]"
    expect(menu).toContain(anchor)
    writeTemp(root, menuPath, menu.replace(anchor, manualItem + anchor))

    const plan = buildRemoveModulePlan(root, spec, false)
    expect(plan.warnings.join("\n")).toMatch(/保留了 gen:group:Business 容器/)

    await removeModule({
      root,
      name: spec.name,
      skipDb: true,
      skipFormat: true,
    })
    const menuAfter = readTemp(root, menuPath)
    expect(menuAfter).toContain("手写菜单项")
    expect(menuAfter).toContain("// #region gen:group:Business")
    expect(menuAfter).not.toContain("module:" + spec.name)
    expect(exists(root, "packages/shared/src/" + spec.name + ".ts")).toBe(false)
  })

  it("A5 纯函数：容器内仅有 module 区块/结构行时仍正常收起", () => {
    const source = [
      "export const groups = [",
      "  // #region gen:group:Business",
      "  {",
      '    label: "Business",',
      "    items: [",
      "      // #region module:contract",
      '      { path: "/contract" },',
      "      // #endregion module:contract",
      "      // [gen:module:menu-items] 锚点",
      "    ],",
      "  },",
      "  // #endregion gen:group:Business",
      "]",
      "",
    ].join("\n")
    const result = stripModuleRegionsDetailed(source, "contract")
    expect(result.preservedGroupIds).toEqual([])
    expect(result.content).not.toContain("gen:group:Business")

    // 手写项 → 保留容器与手写项
    const withManual = source.replace(
      "      // [gen:module:menu-items] 锚点",
      '      { title: "手写", path: "/manual" },\n' +
        "      // [gen:module:menu-items] 锚点"
    )
    const preserved = stripModuleRegionsDetailed(withManual, "contract")
    expect(preserved.preservedGroupIds).toEqual(["gen:group:Business"])
    expect(preserved.content).toContain('title: "手写"')
    expect(preserved.content).toContain("gen:group:Business")
  })

  it("A7：import * as ns from shared + export * from shared 仍拦截", () => {
    const root = createTempDir()
    const spec = buildSpec({ name: "category", label: "分类" })
    writeTemp(
      root,
      "apps/web/src/pages/other/NamespacePage.tsx",
      [
        'import * as sharedNs from "shared"',
        "",
        "export function NamespacePage() {",
        "  return <div>{String(sharedNs.Category)}</div>",
        "}",
        "",
      ].join("\n")
    )
    writeTemp(
      root,
      "packages/shared/src/reexport.ts",
      'export * from "shared"\n'
    )
    const hits = findReverseReferences({
      root,
      spec,
      sharedSymbols: ["Category", "CategoryFormSchema"],
      linePatterns: buildReverseReferencePatterns(spec),
      deletedPaths: [],
      strippedContents: new Map(),
    })
    const features = hits.map((hit) => hit.feature)
    expect(features).toContain(
      "shared 导出符号 sharedNs.Category（命名空间导入 shared）"
    )
    expect(features).toContain("export * from shared（再导出全部 shared 符号）")
  })

  it("A8：git status 失败时抛错（不当作干净）", () => {
    const root = createTempDir()
    const failingRunner: GitRunner = (args) => {
      if (args[0] === "rev-parse") {
        return { status: 0, stdout: "true\n" }
      }
      return { status: 128, stdout: "", stderr: "fatal: index file corrupt" }
    }
    expect(() =>
      getDirtyPaths(root, ["packages/shared/src/index.ts"], failingRunner)
    ).toThrow(/git status 失败/)

    // 非 git 仓库（rev-parse 失败）→ 视为干净
    const nonGitRunner: GitRunner = () => ({
      status: 128,
      stdout: "",
      stderr: "fatal: not a git repository",
    })
    expect(
      getDirtyPaths(root, ["packages/shared/src/index.ts"], nonGitRunner)
    ).toEqual([])

    // status 正常 → 返回去重后的改动行
    const dirtyRunner: GitRunner = (args) => {
      if (args[0] === "rev-parse") {
        return { status: 0, stdout: "true\n" }
      }
      return {
        status: 0,
        stdout: " M apps/web/src/App.tsx\n?? docs/specs/_archived/x.md\n",
      }
    }
    expect(getDirtyPaths(root, ["apps/web/src/App.tsx"], dirtyRunner)).toEqual([
      " M apps/web/src/App.tsx",
      "?? docs/specs/_archived/x.md",
    ])
  })

  it("A4+A8：dirty 预检相关路径包含归档目标（归档被改过也会被拦截）", () => {
    const root = createTempMonorepo()
    const spec = buildSpec({
      name: freshModuleName("contract"),
      label: "合同",
    })
    generateModule(root, spec)
    const archiveRel = "docs/specs/_archived/" + spec.name + ".md"
    writeTemp(root, archiveRel, "历史归档\n")

    const receivedArgs: string[][] = []
    const runner: GitRunner = (args) => {
      receivedArgs.push([...args])
      if (args[0] === "rev-parse") return { status: 0, stdout: "true\n" }
      return { status: 0, stdout: " M " + archiveRel + "\n" }
    }
    const plan = buildRemoveModulePlan(root, spec, false, runner)
    const statusArgs = receivedArgs.find((args) => args[0] === "status") ?? []
    expect(statusArgs).toContain(archiveRel)
    expect(plan.archiveExists).toBe(true)
    expect(plan.dirtyPaths).toEqual([" M " + archiveRel])
  })
})

// ─── 多端：后端域 / 前端切片两种生命周期 ──────────────────────────────────────

/** 临时多端 monorepo：真实 8 个注册文件 + 各额外端 3 个（克隆默认端）+ 端注册表 */
function createTempMultiAppMonorepo(extraAppIds: string[]): string {
  const root = createTempMonorepo()
  const apps = [
    { id: "web", base: "/", devPort: 5173, title: "默认端" },
    ...extraAppIds.map((id, index) => ({
      id,
      base: "/" + id + "/",
      devPort: 5174 + index,
      title: id,
    })),
  ]
  writeTemp(root, "web-apps.json", JSON.stringify({ apps }, null, 2) + "\n")
  for (const id of extraAppIds) {
    for (const relPath of webSliceRegistrationFiles(id)) {
      writeTemp(
        root,
        relPath,
        readTemp(root, relPath.replace("apps/" + id + "/", "apps/web/"))
      )
    }
  }
  // fixture 必须是「无业务模块」的干净 monorepo。注册文件是从宿主复制的，而宿主
  // （生成项目）可能已经有 contract 等模块，带进来会让「0 个模块」「只含本用例
  // 生成的模块」这类断言假失败。各用例自己 generateModule，不依赖宿主模块。
  for (const relPath of [
    ...REGISTRATION_FILE_LIST,
    ...extraAppIds.flatMap((id) => webSliceRegistrationFiles(id)),
  ]) {
    if (!exists(root, relPath)) continue
    let content = readTemp(root, relPath)
    for (const regionId of listRegions(content)) {
      if (regionId.startsWith(MODULE_REGION_PREFIX)) {
        content = stripRegions(content, regionId)
      }
    }
    writeTemp(root, relPath, content)
  }
  return root
}

/** 只在某端生成前端切片（复用已存在的后端域，不写规格书） */
function generateSlice(root: string, spec: ModuleSpec, appId: string): void {
  for (const file of renderWebSliceFiles(spec, appId)) {
    writeTemp(root, file.relPath, file.content)
  }
  for (const change of renderRegistrationChanges(
    spec,
    (relPath) => (exists(root, relPath) ? readTemp(root, relPath) : null),
    { app: appId }
  )) {
    writeTemp(root, change.relPath, change.after)
  }
}

describe("多端拆分恒等式（不破坏单端历史形态）", () => {
  const spec = buildSpec({ name: "contract", label: "合同" })

  it("backend + webSlice 路径候选拼接 === modulePathCandidates（含顺序）", () => {
    const backend = backendPathCandidates(spec)
    const slice = webSlicePathCandidates(spec)
    const whole = modulePathCandidates(spec)
    expect([...backend.files, ...slice.files]).toEqual(whole.files)
    expect([...backend.dirs, ...slice.dirs]).toEqual(whole.dirs)
    expect(backend.specDoc).toBe(whole.specDoc)
  })

  it("webSlicePathCandidates 按端参数化，4 文件 + 1 目录全在该端", () => {
    const slice = webSlicePathCandidates(spec, "portal")
    expect(slice.files).toHaveLength(4)
    expect(slice.dirs).toEqual(["apps/portal/src/pages/contract"])
    for (const relPath of [...slice.files, ...slice.dirs]) {
      expect(relPath.startsWith("apps/portal/src/")).toBe(true)
    }
  })

  it("rollbackCleanPaths 缺省与历史一致；切片模式不含规格书与后端路径", () => {
    expect(rollbackCleanPaths(spec)).toEqual([
      ...modulePathCandidates(spec).dirs,
      ...modulePathCandidates(spec).files,
      modulePathCandidates(spec).specDoc,
    ])
    const slicePaths = rollbackCleanPaths(spec, {
      kind: "slice",
      appId: "portal",
    })
    expect(slicePaths).not.toContain("docs/specs/contract.md")
    for (const relPath of slicePaths) {
      expect(relPath.startsWith("apps/portal/")).toBe(true)
    }
  })

  it("expectedModuleRegionCount：任意端 id 都按形状匹配，无需新建映射", () => {
    expect(expectedModuleRegionCount("apps/portal/src/App.tsx")).toBe(2)
    expect(expectedModuleRegionCount("apps/mobile/src/lib/query-keys.ts")).toBe(
      1
    )
    expect(expectedModuleRegionCount("apps/x-y/src/lib/menu-config.ts")).toBe(1)
    expect(
      expectedModuleRegionCount("packages/shared/src/permissions.ts")
    ).toBe(2)
    expect(expectedModuleRegionCount("packages/shared/src/audit.ts")).toBe(3)
    expect(expectedModuleRegionCount("apps/api/src/index.ts")).toBe(1)
  })

  it("scopedRegistrationFiles：slice 只 3 个；domain 按探测到的端展开", () => {
    expect(scopedRegistrationFiles({ kind: "slice", appId: "portal" })).toEqual(
      webSliceRegistrationFiles("portal")
    )
    expect(
      scopedRegistrationFiles({ kind: "domain", appIds: ["web", "portal"] })
    ).toEqual([
      ...REGISTRATION_FILE_LIST,
      ...webSliceRegistrationFiles("portal"),
    ])
    // 缺省 = 历史 8 个
    expect(
      scopedRegistrationFiles({ kind: "domain", appIds: ["web"] })
    ).toEqual(REGISTRATION_FILE_LIST)
  })

  it("sliceOnly 只保留 4 条前端特征，后端域特征全部剔除", () => {
    const all = buildReverseReferencePatterns(spec)
    const slice = buildReverseReferencePatterns(spec, true)
    expect(all).toHaveLength(8)
    expect(slice).toHaveLength(4)
    expect(slice.every((pattern) => pattern.sliceOwned)).toBe(true)
    expect(slice.map((pattern) => pattern.feature)).toEqual([
      "@/pages/contract/",
      "@/services/contract",
      "@/hooks/queries/useContract",
      "contractKeys",
    ])
  })
})

describe("多端切片卸载：预检隔离（硬伤 2 回归）", () => {
  it(
    "本端其他页合法引用保留的后端域（PERMISSIONS / shared 契约 / 权限码字符串）→ 必须通过",
    { timeout: 30_000 },
    async () => {
      const root = createTempMultiAppMonorepo(["portal"])
      const name = freshModuleName("slice-backend-ref")
      const spec = buildSpec({ name, label: "切片后端引用" })
      generateModule(root, spec)
      generateSlice(root, spec, "portal")

      // 后端域在切片模式下保留，因此这些引用全部合法，不得误报
      writeTemp(
        root,
        "apps/portal/src/pages/OtherPage.tsx",
        [
          "import { PERMISSIONS, type " + spec.pascal + ' } from "shared"',
          "export const code = PERMISSIONS." + spec.upper + "_VIEW",
          'export const literal = "' + spec.name + ':view"',
          "export type Row = " + spec.pascal,
          "export default function OtherPage() { return null }",
        ].join("\n") + "\n"
      )

      await removeModule({ root, name, app: "portal", skipDb: true })

      // portal 切片文件已删，后端域与默认端切片一个字节都没动
      for (const relPath of [
        ...webSlicePathCandidates(spec, "portal").files,
        ...webSlicePathCandidates(spec, "portal").dirs,
      ]) {
        expect(exists(root, relPath), relPath).toBe(false)
      }
      expect(exists(root, "apps/api/src/modules/" + name)).toBe(true)
      expect(exists(root, "packages/shared/src/" + name + ".ts")).toBe(true)
      expect(exists(root, "apps/web/src/pages/" + name)).toBe(true)
      expect(exists(root, "docs/specs/" + name + ".md")).toBe(true)
    }
  )

  it(
    "本端其他页引用被删的切片（@/services/<name>）→ 必须抛错并列出位置",
    { timeout: 30_000 },
    async () => {
      const root = createTempMultiAppMonorepo(["portal"])
      const name = freshModuleName("slice-dangling")
      const spec = buildSpec({ name, label: "切片悬挂" })
      generateModule(root, spec)
      generateSlice(root, spec, "portal")
      writeTemp(
        root,
        "apps/portal/src/pages/OtherPage.tsx",
        "import { " +
          spec.camel +
          'Service } from "@/services/' +
          name +
          '"\nexport default function OtherPage() { return null }\n'
      )

      await expect(
        removeModule({ root, name, app: "portal", skipDb: true })
      ).rejects.toThrow("apps/portal/src/pages/OtherPage.tsx")
      // 预检失败 → 零落盘
      expect(exists(root, "apps/portal/src/pages/" + name)).toBe(true)
    }
  )

  it(
    "切片卸载只剥该端 3 个注册文件，规格书不归档、后端 5 个与默认端 3 个逐字节不变",
    { timeout: 30_000 },
    async () => {
      const root = createTempMultiAppMonorepo(["portal"])
      const name = freshModuleName("slice-isolation")
      const spec = buildSpec({ name, label: "切片隔离" })
      generateModule(root, spec)
      const afterDomain = new Map<string, string>()
      for (const relPath of REGISTRATION_FILE_LIST) {
        afterDomain.set(relPath, readTemp(root, relPath))
      }
      const specBefore = readTemp(root, "docs/specs/" + name + ".md")
      generateSlice(root, spec, "portal")

      const plan = buildRemoveModulePlan(
        root,
        spec,
        false,
        undefined,
        { kind: "slice", appId: "portal" },
        ["web", "portal"]
      )
      expect(plan.registrationFiles.map((file) => file.relPath)).toEqual(
        webSliceRegistrationFiles("portal")
      )
      expect(plan.specAction).toBe("none")
      expect(plan.archivePath).toBeNull()
      expect(plan.specDocPath).toBeNull()

      await removeModule({ root, name, app: "portal", skipDb: true })

      for (const relPath of REGISTRATION_FILE_LIST) {
        expect(readTemp(root, relPath), relPath).toBe(afterDomain.get(relPath)!)
      }
      expect(readTemp(root, "docs/specs/" + name + ".md")).toBe(specBefore)
      expect(exists(root, "docs/specs/_archived/" + name + ".md")).toBe(false)
    }
  )
})

describe("多端全域卸载：探测与护栏（硬伤 3 回归）", () => {
  it(
    "三端只有 web 有切片 → 裸 remove 成功（无区块的端不进注册清单，不报 missing）",
    { timeout: 30_000 },
    async () => {
      const root = createTempMultiAppMonorepo(["portal", "mobile"])
      const name = freshModuleName("domain-single-app")
      const spec = buildSpec({ name, label: "单端切片" })
      generateModule(root, spec)

      expect(
        discoverModuleAppIds(root, name, ["web", "portal", "mobile"])
      ).toEqual(["web"])
      await removeModule({ root, name, skipDb: true })
      expect(exists(root, "apps/api/src/modules/" + name)).toBe(false)
    }
  )

  it(
    "web + portal 都有切片 → 裸 remove 报需 --all-apps；加 flag 后两端切片都清",
    { timeout: 60_000 },
    async () => {
      const root = createTempMultiAppMonorepo(["portal"])
      const name = freshModuleName("domain-two-apps")
      const spec = buildSpec({ name, label: "两端切片" })
      generateModule(root, spec)
      generateSlice(root, spec, "portal")

      expect(discoverModuleAppIds(root, name, ["web", "portal"])).toEqual([
        "web",
        "portal",
      ])
      await expect(removeModule({ root, name, skipDb: true })).rejects.toThrow(
        "--all-apps"
      )
      // 护栏失败 → 零落盘
      expect(exists(root, "apps/portal/src/pages/" + name)).toBe(true)

      await removeModule({ root, name, allApps: true, skipDb: true })
      expect(exists(root, "apps/portal/src/pages/" + name)).toBe(false)
      expect(exists(root, "apps/web/src/pages/" + name)).toBe(false)
      expect(exists(root, "apps/api/src/modules/" + name)).toBe(false)
      for (const relPath of [
        ...REGISTRATION_FILE_LIST,
        ...webSliceRegistrationFiles("portal"),
      ]) {
        expect(readTemp(root, relPath), relPath).not.toContain("module:" + name)
      }
    }
  )

  it(
    "dry-run 下 --all-apps 护栏只警示不拦截（与脏工作区护栏同一约定）",
    { timeout: 30_000 },
    async () => {
      const root = createTempMultiAppMonorepo(["portal"])
      const name = freshModuleName("domain-dryrun")
      const spec = buildSpec({ name, label: "全域预览" })
      generateModule(root, spec)
      generateSlice(root, spec, "portal")
      await removeModule({ root, name, dryRun: true, skipDb: true })
      expect(exists(root, "apps/portal/src/pages/" + name)).toBe(true)
    }
  )

  it(
    "先 --app 拆掉唯一端的切片 → 裸 remove 仍能拆后端域（探测为空是合法状态，不是区块被手删）",
    { timeout: 60_000 },
    async () => {
      const root = createTempMultiAppMonorepo(["portal"])
      const name = freshModuleName("domain-after-slice")
      const spec = buildSpec({ name, label: "先拆切片" })
      generateModule(root, spec)

      await removeModule({ root, name, app: "web", skipDb: true })
      expect(discoverModuleAppIds(root, name, ["web", "portal"])).toEqual([])
      expect(exists(root, "apps/api/src/modules/" + name)).toBe(true)

      await removeModule({ root, name, skipDb: true })
      expect(exists(root, "apps/api/src/modules/" + name)).toBe(false)
      expect(exists(root, "docs/specs/_archived/" + name + ".md")).toBe(true)
    }
  )
})

describe("--all-modules：清空某端全部切片（add:web 清场入口）", () => {
  it("0 个模块 → 静默成功退出（init 最常见路径）", async () => {
    const root = createTempMultiAppMonorepo(["portal"])
    expect(discoverAppModuleNames(root, "portal")).toEqual([])
    await removeAllAppModuleSlices({ root, app: "portal" })
  })

  it("未注册端 → 报错", async () => {
    const root = createTempMultiAppMonorepo(["portal"])
    await expect(
      removeAllAppModuleSlices({ root, app: "nope" })
    ).rejects.toThrow("未在 web-apps.json 注册")
  })

  it(
    "2 个模块一次清空，后端域与默认端切片不动",
    { timeout: 60_000 },
    async () => {
      const root = createTempMultiAppMonorepo(["portal"])
      const [iconA, iconB] = freshProbeIcons(2)
      const nameA = freshModuleName("bulk-a")
      const nameB = freshModuleName("bulk-b")
      const specA = buildSpec({ name: nameA, label: "甲", icon: iconA })
      const specB = buildSpec({
        name: nameB,
        label: "乙",
        icon: iconB,
        mode: "sortable",
      })
      generateModule(root, specA)
      generateModule(root, specB)
      const webBefore = new Map<string, string>()
      for (const relPath of REGISTRATION_FILE_LIST) {
        webBefore.set(relPath, readTemp(root, relPath))
      }
      generateSlice(root, specA, "portal")
      generateSlice(root, specB, "portal")

      expect(discoverAppModuleNames(root, "portal")).toEqual(
        [nameA, nameB].sort()
      )
      await removeAllAppModuleSlices({ root, app: "portal", skipFormat: true })

      expect(discoverAppModuleNames(root, "portal")).toEqual([])
      for (const spec of [specA, specB]) {
        expect(exists(root, "apps/portal/src/pages/" + spec.name)).toBe(false)
        // 后端域与默认端切片完整保留
        expect(exists(root, "apps/api/src/modules/" + spec.name)).toBe(true)
        expect(exists(root, "apps/web/src/pages/" + spec.name)).toBe(true)
      }
      for (const relPath of REGISTRATION_FILE_LIST) {
        expect(readTemp(root, relPath), relPath).toBe(webBefore.get(relPath)!)
      }
    }
  )

  it(
    "跨模块引用（B 的页面引 A 的 service）→ 迭代到不动点后全部清空",
    { timeout: 60_000 },
    async () => {
      const root = createTempMultiAppMonorepo(["portal"])
      const [iconA, iconB] = freshProbeIcons(2)
      const nameA = freshModuleName("dep-a")
      const nameB = freshModuleName("dep-b")
      const specA = buildSpec({ name: nameA, label: "被依赖", icon: iconA })
      const specB = buildSpec({ name: nameB, label: "依赖方", icon: iconB })
      generateModule(root, specA)
      generateModule(root, specB)
      generateSlice(root, specA, "portal")
      generateSlice(root, specB, "portal")
      // B 的页面引用 A 的 service：先拆 A 会被预检拦，必须先拆 B
      writeTemp(
        root,
        "apps/portal/src/pages/" + nameB + "/Extra.tsx",
        "import { " +
          specA.camel +
          'Service } from "@/services/' +
          nameA +
          '"\nexport const x = ' +
          specA.camel +
          "Service\n"
      )

      await removeAllAppModuleSlices({ root, app: "portal", skipFormat: true })
      expect(discoverAppModuleNames(root, "portal")).toEqual([])
      expect(exists(root, "apps/portal/src/pages/" + nameA)).toBe(false)
      expect(exists(root, "apps/portal/src/pages/" + nameB)).toBe(false)
    }
  )

  it(
    "dry-run + 跨模块引用 → 不误报成环，且零落盘（前几轮已模拟移除的切片不再算活引用）",
    { timeout: 60_000 },
    async () => {
      const root = createTempMultiAppMonorepo(["portal"])
      const [iconA, iconB] = freshProbeIcons(2)
      const nameA = freshModuleName("dry-dep-a")
      const nameB = freshModuleName("dry-dep-b")
      const specA = buildSpec({ name: nameA, label: "被依赖", icon: iconA })
      const specB = buildSpec({ name: nameB, label: "依赖方", icon: iconB })
      generateModule(root, specA)
      generateModule(root, specB)
      generateSlice(root, specA, "portal")
      generateSlice(root, specB, "portal")
      writeTemp(
        root,
        "apps/portal/src/pages/" + nameB + "/Extra.tsx",
        'import { x } from "@/services/' + nameA + '"\nexport const y = x\n'
      )

      await removeAllAppModuleSlices({
        root,
        app: "portal",
        dryRun: true,
        skipFormat: true,
      })

      expect(discoverAppModuleNames(root, "portal")).toEqual(
        [nameA, nameB].sort()
      )
      expect(exists(root, "apps/portal/src/pages/" + nameA)).toBe(true)
      expect(exists(root, "apps/portal/src/pages/" + nameB)).toBe(true)
    }
  )

  it.skipIf(!GIT_AVAILABLE)(
    "不带 --force 时脏工作区仍被拦（批量清场不绕过破坏性护栏）",
    { timeout: 60_000 },
    async () => {
      const root = createTempMultiAppMonorepo(["portal"])
      const name = freshModuleName("dirty-bulk")
      const spec = buildSpec({ name, label: "脏清场" })
      generateModule(root, spec)
      generateSlice(root, spec, "portal")
      expect(
        spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" }).status
      ).toBe(0)

      await expect(
        removeAllAppModuleSlices({ root, app: "portal", skipFormat: true })
      ).rejects.toThrow(/未提交改动/)
      expect(exists(root, "apps/portal/src/pages/" + name)).toBe(true)

      await removeAllAppModuleSlices({
        root,
        app: "portal",
        force: true,
        skipFormat: true,
      })
      expect(discoverAppModuleNames(root, "portal")).toEqual([])
    }
  )
})
