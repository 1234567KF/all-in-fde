/**
 * gen:module 单测 — 命名派生 / CLI 解析 / 模板渲染 / 注册点接线
 *
 * 生成器本身不改运行时代码，验证重点：
 * 1. 命名派生与参数校验（决定文件路径、标识符、权限码，错一个字就是坏模块）；
 * 2. 锚点插入的纯函数行为（锚点缺失必须报错而不是静默写坏文件）；
 * 3. 生成文件清单与关键契约（crud / sortable 两种模式各 9 个文件）；
 * 4. 注册点幂等（同一模块重复注册必须跳过，不能重复追加权限/路由/菜单）。
 *
 * 端到端验收（生成后跑 typecheck/lint/arch:check/test）见 README「业务模块生成器」。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, describe, expect, it } from "bun:test"

import {
  addLucideIcon,
  appendSection,
  assertIconExists,
  BACKEND_REGISTRATION_FILES,
  buildSpec,
  detectExistingModuleState,
  ensurePermissionsValueImport,
  GenModuleError,
  getLucideIconNames,
  hasLineStartingWith,
  insertAfterMarker,
  insertBeforeMarker,
  insertBeforeMarkerSkippingBlank,
  MARKERS,
  menuGroupRegionId,
  moduleRegionId,
  parseArgs,
  pluralize,
  pluralizeKebab,
  pluralizeSnake,
  renderBackendFiles,
  renderDbTable,
  renderModuleFiles,
  renderNamedImports,
  renderRegistrationChanges,
  renderSpecDoc,
  renderWebSliceFiles,
  resolveRepoRoot,
  rollbackWrites,
  toCamel,
  toPascal,
  toSnake,
  toUpperSnake,
  webSliceRegistrationFiles,
  wrapJsxRegion,
  wrapTsRegion,
} from "./gen-module"
import {
  listRegions,
  parseRegions,
  stripEmptyGroupRegions,
  stripRegions,
} from "./lib/code-regions"
import { createUnusedImportsSession } from "./prune-unused-imports"

// ─── 命名派生 ────────────────────────────────────────────────────────────────

describe("命名派生", () => {
  it("kebab 各形态：单词 / 多段", () => {
    expect(toCamel("contract")).toBe("contract")
    expect(toCamel("purchase-order")).toBe("purchaseOrder")
    expect(toPascal("contract")).toBe("Contract")
    expect(toPascal("purchase-order")).toBe("PurchaseOrder")
    expect(toSnake("purchase-order")).toBe("purchase_order")
    expect(toUpperSnake("purchase-order")).toBe("PURCHASE_ORDER")
  })

  it("复数规则：常规 / s-x-ch-sh / 辅音+y / 多段只变最后一段", () => {
    expect(pluralize("contract")).toBe("contracts")
    expect(pluralize("box")).toBe("boxes")
    expect(pluralize("match")).toBe("matches")
    expect(pluralize("category")).toBe("categories")
    expect(pluralize("day")).toBe("days")
    expect(pluralizeKebab("purchase-order")).toBe("purchase-orders")
    expect(pluralizeSnake("purchase_order")).toBe("purchase_orders")
  })
})

// ─── 参数解析与规格校验 ──────────────────────────────────────────────────────

describe("parseArgs", () => {
  it("支持空格与 = 两种取值形式，布尔开关缺省 false", () => {
    const options = parseArgs([
      "--name",
      "contract",
      "--label=合同",
      "--mode",
      "sortable",
      "--force",
      "--dry-run",
    ])
    expect(options.name).toBe("contract")
    expect(options.label).toBe("合同")
    expect(options.mode).toBe("sortable")
    expect(options.force).toBe(true)
    expect(options.dryRun).toBe(true)
    expect(options.skipDb).toBe(false)
    expect(options.icon).toBe("FileText")
  })

  it("--help / -h 置位", () => {
    expect(parseArgs(["--help"]).help).toBe(true)
    expect(parseArgs(["-h"]).help).toBe(true)
  })

  it("未知参数 / 缺值 → GenModuleError", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(GenModuleError)
    expect(() => parseArgs(["--name"])).toThrow(GenModuleError)
    expect(() => parseArgs(["--name", "--label", "合同"])).toThrow(
      GenModuleError
    )
  })

  it("布尔参数显式取值：--force=false 不等于 true", () => {
    expect(parseArgs(["--force=false"]).force).toBe(false)
    expect(parseArgs(["--force=true"]).force).toBe(true)
    expect(() => parseArgs(["--force=yes"])).toThrow(GenModuleError)
  })

  it("卸载模式参数：--remove / --purge-spec 置位，默认 false", () => {
    const removeOptions = parseArgs([
      "--name",
      "contract",
      "--remove",
      "--purge-spec",
      "--dry-run",
    ])
    expect(removeOptions.remove).toBe(true)
    expect(removeOptions.purgeSpec).toBe(true)
    expect(removeOptions.dryRun).toBe(true)
    // 卸载模式只要求 --name：label/icon/mode 不传也是合法解析结果
    expect(removeOptions.label).toBe("")
    expect(removeOptions.mode).toBe("crud")

    const generateOptions = parseArgs(["--name", "contract", "--label", "合同"])
    expect(generateOptions.remove).toBe(false)
    expect(generateOptions.purgeSpec).toBe(false)
  })
})

describe("buildSpec", () => {
  it("crud 规格派生（table / 权限码 / 路由路径）", () => {
    const spec = buildSpec({ name: "contract", label: "合同" })
    expect(spec.pascal).toBe("Contract")
    expect(spec.camel).toBe("contract")
    expect(spec.table).toBe("contracts")
    expect(spec.upper).toBe("CONTRACT")
    expect(spec.apiPath).toBe("/contracts")
    expect(spec.routePath).toBe("/contract")
    expect(spec.permissionView).toBe("contract:view")
    expect(spec.permissionEdit).toBe("contract:edit")
    expect(spec.mode).toBe("crud")
  })

  it("多段 kebab 与 y 结尾复数：purchase-order / category", () => {
    const order = buildSpec({ name: "purchase-order", label: "采购单" })
    expect(order.pascal).toBe("PurchaseOrder")
    expect(order.table).toBe("purchase_orders")
    expect(order.apiPath).toBe("/purchase-orders")
    expect(order.routePath).toBe("/purchase-order")

    const category = buildSpec({
      name: "category",
      label: "分类",
      mode: "sortable",
    })
    expect(category.table).toBe("categories")
    expect(category.mode).toBe("sortable")
  })

  it("非法输入 → GenModuleError（大写 / 下划线 / 数字开头 / 保留名 / 缺 label / 坏图标 / 坏模式）", () => {
    expect(() => buildSpec({ name: "Contract", label: "合同" })).toThrow()
    expect(() =>
      buildSpec({ name: "purchase_order", label: "采购单" })
    ).toThrow()
    expect(() => buildSpec({ name: "1contract", label: "合同" })).toThrow()
    expect(() => buildSpec({ name: "user", label: "用户" })).toThrow(
      GenModuleError
    )
    expect(() => buildSpec({ name: "auth", label: "认证" })).toThrow(
      GenModuleError
    )
    expect(() => buildSpec({ name: "audit", label: "审计" })).toThrow(
      GenModuleError
    )
    expect(() => buildSpec({ name: "system", label: "系统" })).toThrow(
      GenModuleError
    )
    expect(() => buildSpec({ name: "dashboard", label: "看板" })).toThrow(
      GenModuleError
    )
    expect(() => buildSpec({ name: "contract" })).toThrow()
    expect(() =>
      buildSpec({ name: "contract", label: "合同", icon: "file-text" })
    ).toThrow()
    expect(() =>
      buildSpec({ name: "contract", label: "合同", mode: "list" })
    ).toThrow()
    expect(() => buildSpec({ name: "contract", label: "合同\n注入" })).toThrow()
  })
})

// ─── 锚点插入 ────────────────────────────────────────────────────────────────

describe("锚点插入", () => {
  const content = ["// head", "// [probe:marker] 注释", "// tail", ""].join(
    "\n"
  )

  it("insertAfterMarker 在锚点行后插入", () => {
    const next = insertAfterMarker(content, "// [probe:marker]", "NEW\n")
    expect(next).toBe("// head\n// [probe:marker] 注释\nNEW\n// tail\n")
  })

  it("insertBeforeMarker 在锚点行前插入", () => {
    const next = insertBeforeMarker(content, "// [probe:marker]", "NEW\n")
    expect(next).toBe("// head\nNEW\n// [probe:marker] 注释\n// tail\n")
  })

  it("锚点缺失 → GenModuleError（不猜测位置）", () => {
    expect(() => insertAfterMarker(content, "// [missing]", "x\n")).toThrow(
      GenModuleError
    )
    expect(() => insertBeforeMarker(content, "// [missing]", "x\n")).toThrow(
      GenModuleError
    )
  })

  it("insertBeforeMarkerSkippingBlank 跳过锚点前空行，插到 import 块末尾", () => {
    const source = [
      'import { env } from "./env.js"',
      "",
      "// [probe:imports] 锚点",
      "",
      "export const app = env",
      "",
    ].join("\n")
    const next = insertBeforeMarkerSkippingBlank(
      source,
      "// [probe:imports]",
      'import probeRoute from "./probe.route.js"\n'
    )
    expect(next).toBe(
      [
        'import { env } from "./env.js"',
        'import probeRoute from "./probe.route.js"',
        "",
        "// [probe:imports] 锚点",
        "",
        "export const app = env",
        "",
      ].join("\n")
    )
    expect(() =>
      insertBeforeMarkerSkippingBlank(source, "// [missing]", "x\n")
    ).toThrow(GenModuleError)
  })

  it("appendSection 收敛末尾空行并追加段落", () => {
    expect(appendSection("const a = 1\n\n\n", "// section\nconst b = 2")).toBe(
      "const a = 1\n\n// section\nconst b = 2\n"
    )
  })

  it("addLucideIcon 按字母序插入；已存在则不重复", () => {
    const menu =
      'import {\n  Settings,\n  type LucideIcon,\n} from "lucide-react"\n'
    const withTag = addLucideIcon(menu, "Tag")
    expect(withTag).toContain("type LucideIcon")
    expect(withTag.indexOf("Settings")).toBeLessThan(withTag.indexOf("Tag"))
    expect(addLucideIcon(withTag, "Tag")).toBe(withTag)
  })
})

// ─── 生成文件清单与关键契约 ──────────────────────────────────────────────────

describe("renderModuleFiles", () => {
  it("crud 模式生成 9 个文件，路径符合仓库布局", () => {
    const spec = buildSpec({ name: "contract", label: "合同" })
    const files = renderModuleFiles(spec)
    expect(files.map((file) => file.relPath)).toEqual([
      "packages/shared/src/contract.ts",
      "apps/api/src/modules/contract/contract.service.ts",
      "apps/api/src/modules/contract/contract.route.ts",
      "apps/api/src/modules/contract/contract.route.test.ts",
      "apps/web/src/services/contract.ts",
      "apps/web/src/hooks/queries/useContract.ts",
      "apps/web/src/pages/contract/ContractPage.tsx",
      "apps/web/src/pages/contract/components/ContractFormDialog.tsx",
      "apps/web/src/pages/contract/hooks/useContractForm.ts",
    ])
  })

  it("crud 模板关键内容：权限码 / 时务审计 / 分页查询 / 路由挂载", () => {
    const spec = buildSpec({ name: "contract", label: "合同" })
    const files = new Map(
      renderModuleFiles(spec).map((file) => [file.relPath, file.content])
    )
    const shared = files.get("packages/shared/src/contract.ts")!
    expect(shared).toContain("CONTRACT_STATUS")
    expect(shared).toContain("ContractListQuerySchema")
    expect(shared).toContain("code: z.string()")

    const service = files.get(
      "apps/api/src/modules/contract/contract.service.ts"
    )!
    expect(service).toContain("CONTRACT_AUDIT_CONFIG")
    expect(service).toContain("auditedInsert")
    expect(service).toContain("escapeLike")

    const route = files.get("apps/api/src/modules/contract/contract.route.ts")!
    expect(route).toContain("requirePermission(PERMISSIONS.CONTRACT_VIEW)")
    expect(route).toContain("listContracts(parsed.data)")
    expect(route).toContain('createContract(c.get("opCtx")!, parsed.data)')

    const page = files.get("apps/web/src/pages/contract/ContractPage.tsx")!
    expect(page).toContain("DataTable<Contract>")
    expect(page).toContain("ConfirmDialog")

    // 生成器模板占位符不应泄漏到生成结果（SQL 模板里的运行时插值不在此列）
    for (const content of files.values()) {
      for (const placeholder of [
        "${pascal}",
        "${pluralPascal}",
        "${table}",
        "${label}",
        "${spec.",
      ]) {
        expect(content).not.toContain(placeholder)
      }
    }
  })

  it("sortable 模式：重排契约 / sortOrder / 拖拽页 / 引用保护 TODO", () => {
    const spec = buildSpec({
      name: "category",
      label: "分类",
      mode: "sortable",
    })
    const files = new Map(
      renderModuleFiles(spec).map((file) => [file.relPath, file.content])
    )
    const shared = files.get("packages/shared/src/category.ts")!
    expect(shared).toContain("CategoryReorderSchema")
    expect(shared).toContain("sortOrder")
    expect(shared).not.toContain("CategoryListQuery")

    const service = files.get(
      "apps/api/src/modules/category/category.service.ts"
    )!
    expect(service).toContain("reorderCategories")
    expect(service).toContain("TODO(引用保护)")
    expect(service).toContain("db.transaction")

    const route = files.get("apps/api/src/modules/category/category.route.ts")!
    expect(route).toContain('"/reorder"')
    expect(route.indexOf('"/reorder"')).toBeLessThan(route.indexOf('"/:id"'))

    const page = files.get("apps/web/src/pages/category/CategoryPage.tsx")!
    expect(page).toContain("draggable")
    expect(page).toContain("onReorder")
  })

  it("renderDbTable：crud 唯一索引 key 为 code，sortable 为 name + sort_order 索引", () => {
    const crud = renderDbTable(buildSpec({ name: "contract", label: "合同" }))
    expect(crud).toContain('uniqueIndex("uq_contracts_code").on(table.code)')

    const sortable = renderDbTable(
      buildSpec({ name: "category", label: "分类", mode: "sortable" })
    )
    expect(sortable).toContain(
      'uniqueIndex("uq_categories_name").on(table.name)'
    )
    expect(sortable).toContain(
      'index("idx_categories_sort_order").on(table.sortOrder)'
    )
  })

  it("renderSpecDoc：生成 docs/specs/<name>.md 五要素规格书（crud / sortable）", () => {
    const crudSpec = renderSpecDoc(
      buildSpec({ name: "contract", label: "合同" }),
      "2026-11-05"
    )
    expect(crudSpec.relPath).toBe("docs/specs/contract.md")
    expect(crudSpec.content).toContain("# 合同（`contract`）业务模块规格书")
    expect(crudSpec.content).toContain("2026-11-05")
    expect(crudSpec.content).toContain("`uq_contracts_code`")
    expect(crudSpec.content).toContain("`contract:view`")

    const sortableSpec = renderSpecDoc(
      buildSpec({ name: "category", label: "分类", mode: "sortable" }),
      "2026-11-05"
    )
    expect(sortableSpec.relPath).toBe("docs/specs/category.md")
    expect(sortableSpec.content).toContain("`PUT /categories/reorder`")
    expect(sortableSpec.content).toContain("`sortOrder`")
  })
})

// ─── 注册点：接线 + 幂等 ─────────────────────────────────────────────────────

/** 覆盖全部锚点的最小夹具（与模板文件形态一致） */
function makeRegistryFixtures(): Record<string, string> {
  return {
    "packages/shared/src/permissions.ts": [
      "export const PERMISSIONS = {",
      "  // [gen:module:permissions] 由 bun run gen:module 追加业务模块权限码（勿手改本行）",
      '  USER_VIEW: "user:view",',
      "} as const",
      "",
      "export const PERMISSION_REGISTRY: PermissionDef[] = [",
      "  // [gen:module:permission-registry] 由 bun run gen:module 追加业务模块权限注册（勿手改本行）",
      "]",
      "",
    ].join("\n"),
    "packages/shared/src/audit.ts": [
      "export const AUDIT_MODULES = {",
      "  // [gen:module:audit-modules] 锚点",
      '  USER: "user",',
      "} as const",
      "",
      "export const AUDIT_MODULE_LABELS: Record<AuditModule, string> = {",
      "  // [gen:module:audit-module-labels] 锚点",
      '  user: "用户管理",',
      "}",
      "",
      "export const MODULE_EVENT_TYPES: Record<string, readonly AuditEventType[]> = {",
      "  // [gen:module:audit-module-event-types] 锚点",
      '  user: ["create"],',
      "}",
      "",
    ].join("\n"),
    "packages/shared/src/index.ts":
      'export { type ApiResponse } from "./response.js"\n',
    "apps/api/src/db/schema.ts": "export const users = sqliteTable\n",
    "apps/api/src/index.ts": [
      'import { env } from "./env.js"',
      "",
      "// [gen:module:api-route-imports] 锚点",
      "",
      'app.route("/logs", logsRoute)',
      "// [gen:module:api-route-mounts] 锚点",
      "",
      "export { app }",
      "",
    ].join("\n"),
    "apps/web/src/lib/query-keys.ts": [
      "// [gen:module:query-keys] 锚点",
      "export const logKeys = {}",
      "",
    ].join("\n"),
    "apps/web/src/App.tsx": [
      'const ResultPage = lazy(() => import("@/pages/ResultPage"))',
      "",
      "// [gen:module:app-lazy-imports] 锚点",
      "",
      "export default function App() {",
      "  return (",
      "    <Routes>",
      "      <Route element={<SidebarLayout />}>",
      "        {/* [gen:module:app-routes] */}",
      "      </Route>",
      "    </Routes>",
      "  )",
      "}",
      "",
    ].join("\n"),
    "apps/web/src/lib/menu-config.ts": [
      "import {",
      "  Settings,",
      '} from "lucide-react"',
      "",
      "export const menuGroups: MenuGroup[] = [",
      "  {",
      '    label: "Overview",',
      '    items: [{ title: "仪表盘", path: "/dashboard", icon: Settings }],',
      "  },",
      "  // [gen:module:menu-groups] 锚点",
      "]",
      "",
    ].join("\n"),
  }
}

describe("renderRegistrationChanges", () => {
  it("首次生成：8 个注册文件全部产生变更（权限 / 审计 / 导出 / 表 / 挂载 / key / 路由 / 菜单）", () => {
    const spec = buildSpec({ name: "contract", label: "合同" })
    const fixtures = makeRegistryFixtures()
    const changes = renderRegistrationChanges(
      spec,
      (relPath) => fixtures[relPath] ?? null
    )
    expect(changes.map((change) => change.relPath)).toEqual([
      "packages/shared/src/permissions.ts",
      "packages/shared/src/audit.ts",
      "packages/shared/src/index.ts",
      "apps/api/src/db/schema.ts",
      "apps/api/src/index.ts",
      "apps/web/src/lib/query-keys.ts",
      "apps/web/src/App.tsx",
      "apps/web/src/lib/menu-config.ts",
    ])

    const byPath = new Map(
      changes.map((change) => [change.relPath, change.after])
    )
    const permissions = byPath.get("packages/shared/src/permissions.ts")!
    expect(permissions).toContain('CONTRACT_VIEW: "contract:view"')
    expect(permissions).toContain("code: PERMISSIONS.CONTRACT_VIEW")
    expect(permissions).toContain('groupLabel: "合同管理"')

    const audit = byPath.get("packages/shared/src/audit.ts")!
    expect(audit).toContain('CONTRACT: "contract"')
    expect(audit).toContain('"contract": "合同管理"')
    expect(audit).toContain('"contract": ["create", "update", "delete"]')

    const sharedIndex = byPath.get("packages/shared/src/index.ts")!
    expect(sharedIndex).toContain('} from "./contract.js"')

    const schema = byPath.get("apps/api/src/db/schema.ts")!
    expect(schema).toContain("export const contracts = sqliteTable")

    const apiIndex = byPath.get("apps/api/src/index.ts")!
    expect(apiIndex).toContain('from "./modules/contract/contract.route.js"')
    expect(apiIndex).toContain('app.route("/contracts", contractRoute)')

    const queryKeys = byPath.get("apps/web/src/lib/query-keys.ts")!
    expect(queryKeys).toContain("export const contractKeys = {")

    const app = byPath.get("apps/web/src/App.tsx")!
    expect(app).toContain('import("@/pages/contract/ContractPage")')
    expect(app).toContain('path="/contract"')

    const menu = byPath.get("apps/web/src/lib/menu-config.ts")!
    expect(menu).toContain('label: "Business"')
    expect(menu).toContain("permission: PERMISSIONS.CONTRACT_VIEW")
  })

  it("幂等：把首次结果作为新内容再跑一遍 → 0 个变更", () => {
    const spec = buildSpec({ name: "contract", label: "合同" })
    const first = makeRegistryFixtures()
    const changes = renderRegistrationChanges(
      spec,
      (relPath) => first[relPath] ?? null
    )
    for (const change of changes) first[change.relPath] = change.after

    const second = renderRegistrationChanges(
      spec,
      (relPath) => first[relPath] ?? null
    )
    expect(second).toEqual([])
  })

  it("第二个 sortable 模块：追加到已有 Business 分组内，不重复建组", () => {
    const crud = buildSpec({ name: "contract", label: "合同" })
    const fixtures = makeRegistryFixtures()
    for (const change of renderRegistrationChanges(
      crud,
      (relPath) => fixtures[relPath] ?? null
    )) {
      fixtures[change.relPath] = change.after
    }

    const sortable = buildSpec({
      name: "category",
      label: "分类",
      mode: "sortable",
    })
    const changes = renderRegistrationChanges(
      sortable,
      (relPath) => fixtures[relPath] ?? null
    )
    const menu = changes.find(
      (change) => change.relPath === "apps/web/src/lib/menu-config.ts"
    )!
    expect((menu.after.match(/label: "Business"/g) ?? []).length).toBe(1)
    expect(menu.after).toContain('path: "/category"')
    expect(menu.after).toContain("permission: PERMISSIONS.CATEGORY_VIEW")
    // 生成顺序 = 菜单顺序：先生成的 contract 排在后来生成的 category 之前
    expect(menu.after.indexOf('path: "/contract"')).toBeLessThan(
      menu.after.indexOf('path: "/category"')
    )
  })

  it("注册文件缺失 → GenModuleError", () => {
    const spec = buildSpec({ name: "contract", label: "合同" })
    expect(() => renderRegistrationChanges(spec, () => null)).toThrow(
      GenModuleError
    )
  })
})

// ─── 渲染结果语法安全 ────────────────────────────────────────────────────────

/** 用 Bun.Transpiler 做语法解析（只解析不执行，等价于 tsc 的 parseDiagnostics） */
function assertParses(file: { relPath: string; content: string }): void {
  const loader = file.relPath.endsWith(".tsx") ? "tsx" : "ts"
  expect(
    () => new Bun.Transpiler({ loader }).transformSync(file.content),
    file.relPath
  ).not.toThrow()
}

describe("渲染结果语法安全", () => {
  it("crud / sortable / 多词 / 中文标点 label 的全部渲染文件均可被 TS 解析", () => {
    const specs = [
      buildSpec({ name: "contract", label: "合同" }),
      buildSpec({ name: "category", label: "分类", mode: "sortable" }),
      buildSpec({ name: "purchase-order", label: "采购单（含税）" }),
      buildSpec({ name: "v2-record", label: "V2 记录 · 测试" }),
    ]
    for (const spec of specs) {
      for (const file of renderModuleFiles(spec)) assertParses(file)
    }
  })

  it("每个生成的 API 测试文件都在 450 行以内（arch:check 行数棘轮）", () => {
    for (const spec of [
      buildSpec({ name: "contract", label: "合同" }),
      buildSpec({ name: "category", label: "分类", mode: "sortable" }),
    ]) {
      const testFile = renderModuleFiles(spec).find((file) =>
        file.relPath.endsWith("route.test.ts")
      )!
      expect(testFile.content.split("\n").length).toBeLessThan(450)
    }
  })
})

// ─── 工具函数 ────────────────────────────────────────────────────────────────

describe("工具函数", () => {
  it("renderNamedImports 去重并排序（--icon 与页面内置图标同名不重复导入）", () => {
    expect(renderNamedImports(["Pencil", "Pencil", "Plus", "Trash2"])).toBe(
      "Pencil, Plus, Trash2"
    )
  })

  it("hasLineStartingWith 按整行前缀判断（避免子串误判）", () => {
    const content =
      '  SUB_CONTRACT_VIEW: "sub-contract:view",\n  CONTRACT_EDIT: "contract:edit",\n'
    expect(hasLineStartingWith(content, "CONTRACT_VIEW:")).toBe(false)
    expect(hasLineStartingWith(content, "CONTRACT_EDIT:")).toBe(true)
  })

  it("getLucideIconNames 解析真实 lucide-react；不存在图标在生成阶段报错", () => {
    const names = getLucideIconNames(resolveRepoRoot())
    if (!names) {
      // 依赖未安装（bun install 之前）时跳过严格校验，与生成器运行时行为一致
      return
    }
    expect(names.has("FileText")).toBe(true)
    expect(() =>
      assertIconExists("NotARealIconXYZ", resolveRepoRoot())
    ).toThrow(GenModuleError)
    expect(() => assertIconExists("FileText", resolveRepoRoot())).not.toThrow()
  })

  it("rollbackWrites 恢复旧内容 / 删除本次新建文件", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gen-module-"))
    try {
      mkdirSync(path.join(dir, "a/b"), { recursive: true })
      writeFileSync(path.join(dir, "a/existing.ts"), "after", "utf8")
      writeFileSync(path.join(dir, "a/b/new.ts"), "new", "utf8")

      rollbackWrites(
        dir,
        new Map<string, string | null>([
          ["a/existing.ts", "before"],
          ["a/b/new.ts", null],
        ])
      )

      expect(readFileSync(path.join(dir, "a/existing.ts"), "utf8")).toBe(
        "before"
      )
      expect(existsSync(path.join(dir, "a/b/new.ts"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("rollbackWrites 收掉本次新建的空目录，但保留仍有内容的目录", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gen-module-"))
    try {
      mkdirSync(path.join(dir, "modules/probe"), { recursive: true })
      mkdirSync(path.join(dir, "pages/probe/components"), { recursive: true })
      writeFileSync(path.join(dir, "modules/probe/probe.service.ts"), "x")
      writeFileSync(path.join(dir, "modules/keep.ts"), "keep")
      writeFileSync(path.join(dir, "pages/probe/components/Form.tsx"), "x")
      writeFileSync(path.join(dir, "pages/probe/keep.tsx"), "keep")

      rollbackWrites(
        dir,
        new Map<string, string | null>([
          ["modules/probe/probe.service.ts", null],
          ["pages/probe/components/Form.tsx", null],
        ])
      )

      expect(existsSync(path.join(dir, "modules/probe"))).toBe(false)
      expect(existsSync(path.join(dir, "pages/probe/components"))).toBe(false)
      expect(existsSync(path.join(dir, "modules/keep.ts"))).toBe(true)
      expect(existsSync(path.join(dir, "pages/probe/keep.tsx"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("ensurePermissionsValueImport 能给降级后的 type-only 导入补回 PERMISSIONS", () => {
    const typeOnly = 'import type { PermissionCode } from "shared"\n'
    const next = ensurePermissionsValueImport(typeOnly)
    expect(next).toContain(
      'import { type PermissionCode, PERMISSIONS } from "shared"'
    )

    // imports:prune 剥离 PERMISSIONS 后保留行内 type 修饰符形态
    const inlineTypeOnly = 'import { type PermissionCode } from "shared"\n'
    expect(ensurePermissionsValueImport(inlineTypeOnly)).toBe(
      'import { type PermissionCode, PERMISSIONS } from "shared"\n'
    )

    const already =
      'import { type PermissionCode, PERMISSIONS } from "shared"\n'
    expect(ensurePermissionsValueImport(already)).toBe(already)
  })
})

// ─── 注册点边界 ──────────────────────────────────────────────────────────────

describe("注册点边界", () => {
  it("sub-contract 先注册后，contract 仍能完整注册（不做子串误判）", () => {
    const fixtures = makeRegistryFixtures()
    const apply = (spec: ReturnType<typeof buildSpec>) => {
      for (const change of renderRegistrationChanges(
        spec,
        (relPath) => fixtures[relPath] ?? null
      )) {
        fixtures[change.relPath] = change.after
      }
    }
    apply(buildSpec({ name: "sub-contract", label: "子合同" }))
    apply(buildSpec({ name: "contract", label: "合同" }))

    const permissions = fixtures["packages/shared/src/permissions.ts"]
    expect(permissions).toContain('CONTRACT_VIEW: "contract:view"')
    expect(permissions).toContain('SUB_CONTRACT_VIEW: "sub-contract:view"')
    const schema = fixtures["apps/api/src/db/schema.ts"]
    expect(schema).toContain("export const contracts = sqliteTable")
    expect(schema).toContain("export const sub_contracts = sqliteTable")
  })
})

// ─── --force 参数变化护栏 ────────────────────────────────────────────────────

describe("detectExistingModuleState", () => {
  const readFrom = (overrides: Record<string, string>) => (relPath: string) =>
    overrides[relPath] ?? null

  it("service 不存在 → null（视为全新模块）", () => {
    const spec = buildSpec({ name: "contract", label: "合同" })
    expect(detectExistingModuleState(spec, () => null)).toBeNull()
  })

  it("解析已生成模块的 mode / label / icon", () => {
    const spec = buildSpec({
      name: "category",
      label: "分类",
      mode: "sortable",
    })
    const read = readFrom({
      "apps/api/src/modules/category/category.service.ts":
        "// sortOrder / reorderCategorys",
      "packages/shared/src/category.ts":
        "/**\n * 分类 — 前后端共享契约（gen:module 生成）\n */\n",
      "apps/web/src/lib/menu-config.ts":
        '        title: "分类",\n        path: "/category",\n        icon: Tag,\n',
    })
    expect(detectExistingModuleState(spec, read)).toEqual({
      mode: "sortable",
      label: "分类",
      icon: "Tag",
    })
  })

  it("crud 生成模块被解析为 crud", () => {
    const spec = buildSpec({ name: "contract", label: "合同" })
    const read = readFrom({
      "apps/api/src/modules/contract/contract.service.ts": "// listContracts",
      "packages/shared/src/contract.ts":
        "/**\n * 合同 — 前后端共享契约（gen:module 生成）\n */\n",
    })
    expect(detectExistingModuleState(spec, read)?.mode).toBe("crud")
  })
})

// ─── 真实注册文件锚点 ────────────────────────────────────────────────────────

describe("真实注册文件锚点", () => {
  const repoRoot = resolveRepoRoot()
  const FILE_BY_MARKER: Record<keyof typeof MARKERS, string> = {
    permissions: "packages/shared/src/permissions.ts",
    permissionRegistry: "packages/shared/src/permissions.ts",
    auditModules: "packages/shared/src/audit.ts",
    auditModuleLabels: "packages/shared/src/audit.ts",
    auditModuleEventTypes: "packages/shared/src/audit.ts",
    apiRouteImports: "apps/api/src/index.ts",
    apiRouteMounts: "apps/api/src/index.ts",
    appLazyImports: "apps/web/src/App.tsx",
    appRoutes: "apps/web/src/App.tsx",
    queryKeys: "apps/web/src/lib/query-keys.ts",
    menuGroups: "apps/web/src/lib/menu-config.ts",
    menuItems: "apps/web/src/lib/menu-config.ts",
  }

  const readReal = (relPath: string): string | null => {
    const fullPath = path.join(repoRoot, relPath)
    return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : null
  }

  it("模板内置 MARKERS 在真实注册文件中出现且仅出现一次", () => {
    for (const [key, relPath] of Object.entries(FILE_BY_MARKER)) {
      const content = readReal(relPath)
      expect(content, relPath).not.toBeNull()
      const marker = MARKERS[key as keyof typeof MARKERS]
      const occurrences = (content as string).split(marker).length - 1
      // menuItems 锚点由首次生成创建在 Business 分组内，模板里可以不存在；
      // 存在时也必须唯一（防止重复生成时出现两个锚点）。
      if (key === "menuItems") {
        expect(occurrences, relPath + " 的锚点 " + marker).toBeLessThanOrEqual(
          1
        )
      } else {
        expect(occurrences, relPath + " 的锚点 " + marker).toBe(1)
      }
    }
  })

  it("对真实注册文件副本跑注册计算：变更可应用且二次幂等", () => {
    const spec = buildSpec({ name: "review-probe", label: "评审探针" })
    const first = renderRegistrationChanges(spec, readReal)
    const applied = new Map<string, string>()
    for (const change of first) applied.set(change.relPath, change.after)

    const second = renderRegistrationChanges(
      spec,
      (relPath) => applied.get(relPath) ?? readReal(relPath)
    )
    expect(second).toEqual([])
  })
})

// ─── 模块区块输出（remove:module 的归属声明）──────────────────────────────────

/** 把一批 spec 依次应用到夹具 / 真实文件内容上（生成端纯函数，不落盘） */
function applySpecs(
  specs: ReturnType<typeof buildSpec>[],
  read: (relPath: string) => string | null
): Map<string, string> {
  const contents = new Map<string, string>()
  const readCurrent = (relPath: string) =>
    contents.get(relPath) ?? read(relPath)
  for (const spec of specs) {
    for (const change of renderRegistrationChanges(spec, readCurrent)) {
      contents.set(change.relPath, change.after)
    }
  }
  return contents
}

const MODULE_REGISTRATION_FILES = [
  "packages/shared/src/permissions.ts",
  "packages/shared/src/audit.ts",
  "packages/shared/src/index.ts",
  "apps/api/src/db/schema.ts",
  "apps/api/src/index.ts",
  "apps/web/src/lib/query-keys.ts",
  "apps/web/src/App.tsx",
  "apps/web/src/lib/menu-config.ts",
]

const readRepoFileOrNull = (root: string, relPath: string): string | null => {
  const fullPath = path.join(root, relPath)
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : null
}

/**
 * 仓库当前已生成的业务模块名（来自 8 个注册文件的 `module:<name>` 区块）。
 *
 * 模板仓库通常为空；**生成项目里可能已有用户模块**（如 category）。真实文件往返
 * 用例必须与仓库状态解耦：不能假设 contract/category 未被占用，也不能断言
 * FileText / Business 容器等初始形态，否则用户「先加模块再跑 bun run check」时
 * test:scripts 会假红。
 */
function repoExistingModuleNames(): string[] {
  const root = resolveRepoRoot()
  const names = new Set<string>()
  for (const relPath of MODULE_REGISTRATION_FILES) {
    const content = readRepoFileOrNull(root, relPath)
    if (!content) continue
    try {
      for (const id of listRegions(content)) {
        if (id.startsWith("module:")) names.add(id.slice("module:".length))
      }
    } catch {
      // 区块损坏由 code-regions 完整性门禁负责，这里只做状态探测
    }
  }
  return [...names].sort()
}

const EXISTING_MODULE_NAMES = repoExistingModuleNames()

/** 生成一个仓库里不冲突的探针模块名（已生成模块的仓库里不能复用 contract/category） */
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
  const menu =
    readRepoFileOrNull(resolveRepoRoot(), "apps/web/src/lib/menu-config.ts") ??
    ""
  const icons = PROBE_ICON_CANDIDATES.filter(
    (icon) => !new RegExp("\\b" + icon + "\\b").test(menu)
  ).slice(0, count)
  if (icons.length < count) {
    throw new Error("可用探针图标不足，无法构造往返用例")
  }
  return icons
}

describe("区块辅助函数", () => {
  it("wrapTsRegion：单换行 body 不产生空行；双换行保留一个空行在区块内", () => {
    expect(wrapTsRegion("module:contract", "  A: 1,\n")).toBe(
      "// #region module:contract\n  A: 1,\n// #endregion module:contract\n"
    )
    expect(wrapTsRegion("module:contract", "const x = 1\n\n")).toBe(
      "// #region module:contract\nconst x = 1\n\n// #endregion module:contract\n"
    )
  })

  it("wrapTsRegion 支持缩进（菜单分组内 6 空格）与 JSX 注释形态", () => {
    expect(wrapTsRegion("module:x", "      item,\n", "      ")).toBe(
      "      // #region module:x\n      item,\n      // #endregion module:x\n"
    )
    expect(wrapJsxRegion("module:x", "        <Route />\n")).toBe(
      "{/* #region module:x */}\n        <Route />\n{/* #endregion module:x */}\n"
    )
    expect(moduleRegionId("contract")).toBe("module:contract")
    expect(menuGroupRegionId("Business")).toBe("gen:group:Business")
  })

  it("区块 id 与 remove:module 的剥离目标一致（parseRegions 可识别插入结果）", () => {
    const fixture = makeRegistryFixtures()
    const spec = buildSpec({ name: "contract", label: "合同" })
    const changes = renderRegistrationChanges(
      spec,
      (relPath) => fixture[relPath] ?? null
    )
    for (const change of changes) {
      expect(() => parseRegions(change.after), change.relPath).not.toThrow()
      expect(listRegions(change.after), change.relPath).toContain(
        "module:contract"
      )
    }
  })

  it("import 语句一律不打区块（设计书 §3.3）", () => {
    const fixture = makeRegistryFixtures()
    const spec = buildSpec({ name: "contract", label: "合同" })
    for (const change of renderRegistrationChanges(
      spec,
      (relPath) => fixture[relPath] ?? null
    )) {
      const lines = change.after.split("\n")
      for (const region of parseRegions(change.after)) {
        const inside = lines.slice(region.startLine - 1, region.endLine)
        for (const line of inside) {
          expect(
            line.trimStart().startsWith("import "),
            change.relPath + " 的区块内不允许包 import：" + line
          ).toBe(false)
        }
      }
    }
  })
})

describe("8 个注册点的区块格式", () => {
  const spec = buildSpec({ name: "contract", label: "合同" })
  const generate = (): Map<string, string> => {
    const fixture = makeRegistryFixtures()
    const after = new Map<string, string>()
    for (const change of renderRegistrationChanges(
      spec,
      (relPath) => fixture[relPath] ?? null
    )) {
      after.set(change.relPath, change.after)
    }
    return after
  }

  const countRegions = (content: string, id: string) =>
    listRegions(content).filter((regionId) => regionId === id).length

  it("permissions：权限码区 + 权限注册表区两个同 id 区块", () => {
    const content = generate().get("packages/shared/src/permissions.ts")!
    expect(countRegions(content, "module:contract")).toBe(2)
    expect(content).toContain(
      '// #region module:contract\n  CONTRACT_VIEW: "contract:view",'
    )
    expect(content).toContain(
      "// #region module:contract\n  {\n    code: PERMISSIONS.CONTRACT_VIEW,"
    )
  })

  it("audit：模块名 / 标签 / 事件映射三个同 id 区块", () => {
    const content = generate().get("packages/shared/src/audit.ts")!
    expect(countRegions(content, "module:contract")).toBe(3)
    expect(content).toContain(
      '// #region module:contract\n  CONTRACT: "contract",\n// #endregion module:contract'
    )
    expect(content).toContain(
      '// #region module:contract\n  "contract": "合同管理",'
    )
    expect(content).toContain(
      '// #region module:contract\n  "contract": ["create", "update", "delete"],'
    )
  })

  it("shared/index.ts 与 schema.ts：appendSection + 区块包裹，段前保持一个空行", () => {
    const generated = generate()
    const sharedIndex = generated.get("packages/shared/src/index.ts")!
    expect(sharedIndex).toContain(
      "\n\n// #region module:contract\n// ─── 合同（gen:module 生成：wire 契约 + 表单/查询 schema）"
    )
    expect(sharedIndex).toContain(
      '} from "./contract.js"\n// #endregion module:contract\n'
    )
    const schema = generated.get("apps/api/src/db/schema.ts")!
    expect(schema).toContain(
      "\n\n// #region module:contract\n/**\n * 合同表 — gen:module 生成的业务骨架"
    )
    expect(schema).toContain(")\n// #endregion module:contract\n")
  })

  it("api/src/index.ts：route import 在区块外（锚点之前），route 挂载在区块内", () => {
    const content = generate().get("apps/api/src/index.ts")!
    const importIndex = content.indexOf(
      'import contractRoute from "./modules/contract/contract.route.js"'
    )
    expect(importIndex).toBeGreaterThan(-1)
    // import 必须插在锚点「前一个非空行」之后：插在锚点行前会被 simple-import-sort
    // 搬走并吞掉锚点前的分隔空行；插在锚点行后则注释会被一起搬走——两种情况都会
    // 让 remove:module 后的注册文件无法逐字节还原。
    expect(importIndex).toBeLessThan(content.indexOf(MARKERS.apiRouteImports))
    expect(content).toContain(
      'import { env } from "./env.js"\n' +
        'import contractRoute from "./modules/contract/contract.route.js"\n' +
        "\n" +
        MARKERS.apiRouteImports
    )
    expect(content).toContain(
      '// #region module:contract\n  app.route("/contracts", contractRoute)\n// #endregion module:contract'
    )
    const region = parseRegions(content).find(
      (item) => item.id === "module:contract"
    )!
    const lines = content.split("\n")
    expect(
      lines.slice(region.startLine - 1, region.endLine).join("\n")
    ).not.toContain("import contractRoute")
  })

  it("query-keys：区块内保留结尾空行，剥离后不残留空行", () => {
    const content = generate().get("apps/web/src/lib/query-keys.ts")!
    expect(content).toContain(
      "// #region module:contract\nexport const contractKeys = {"
    )
    expect(content).toContain("}\n\n// #endregion module:contract\n")
  })

  it("App.tsx：lazy 声明用 TS 区块、路由节点用 JSX 区块（两个同 id 区块）", () => {
    const content = generate().get("apps/web/src/App.tsx")!
    expect(countRegions(content, "module:contract")).toBe(2)
    expect(content).toContain(
      "// #region module:contract\nconst ContractPage = lazy("
    )
    expect(content).toContain(
      '{/* #region module:contract */}\n              <Route\n                path="/contract"'
    )
    expect(content).toContain("{/* #endregion module:contract */}\n")
  })

  it("menu-config：首个模块生成 gen:group:Business 容器 + 嵌套 module 区块", () => {
    const content = generate().get("apps/web/src/lib/menu-config.ts")!
    expect(listRegions(content).sort()).toEqual([
      "gen:group:Business",
      "module:contract",
    ])
    expect(content).toContain(
      [
        "  // #region gen:group:Business",
        "  {",
        '    label: "Business",',
        "    items: [",
        "      // #region module:contract",
        "      {",
        '        title: "合同",',
        '        path: "/contract",',
        "        icon: FileText,",
      ].join("\n")
    )
    expect(content).toContain(
      [
        "      // #endregion module:contract",
        "      // [gen:module:menu-items] 由 bun run gen:module 追加业务模块菜单项（勿手改本行）",
        "    ],",
        "  },",
        "  // #endregion gen:group:Business",
      ].join("\n")
    )
  })

  it("第二个模块：插到 menu-items 锚点前，仍只有一个 Business 容器", () => {
    const contents = applySpecs(
      [
        buildSpec({ name: "contract", label: "合同" }),
        buildSpec({ name: "category", label: "分类", mode: "sortable" }),
      ],
      (relPath) => makeRegistryFixtures()[relPath] ?? null
    )
    const content = contents.get("apps/web/src/lib/menu-config.ts")!
    expect(content.match(/label: "Business"/g)?.length).toBe(1)
    expect(content.match(/#region gen:group:Business/g)?.length).toBe(1)
    expect(content).toContain("      // #region module:category")
    expect(content.indexOf('path: "/contract"')).toBeLessThan(
      content.indexOf('path: "/category"')
    )
  })
})

// ─── 真实 8 注册文件：生成 → 剥离 → imports:prune 逐字节还原（硬验收）──────────

/**
 * 对生成结果执行 remove:module 的辅助步骤：剥区块 → 收起空容器 → imports:prune → prettier。
 *
 * 硬验收（模板仓库实施计划 §7 / 设计书 §6.7）：8 个注册文件必须逐字节还原。
 * import 一律不打区块，删除后残留 import 由 pruner 精确清理；真实 remove:module 在
 * prune 之后还会跑 prettier --write，这里必须逐步模拟：
 * 生成项目里 `scaffold` 已对基线跑过 prettier（如全剥离后 menu-config 是单行 import），
 * 生成器则用 prettier 输出多行 import；只 prune 不 prettier 会得到多行结果、与单行
 * 基线不一致（R3 全剥离项目 test:scripts 假红）。因此 prune 后统一过仓库 prettier 再比较。
 */
/**
 * 往返测试共用的剪枝会话：6 次「剥离 → 剪枝」复用同一个 TS Program 增量更新
 * （每轮重新建模约 300ms，会话复用后首轮 ~500ms、后续 ~70ms）。
 */
const pruneSession = createUnusedImportsSession()
afterAll(() => pruneSession.dispose())

async function stripAndPrune(
  root: string,
  contents: Map<string, string>,
  name: string,
  registrationFiles: readonly string[] = MODULE_REGISTRATION_FILES
): Promise<Map<string, string>> {
  const stripped = new Map<string, string>()
  for (const relPath of registrationFiles) {
    const content = contents.get(relPath)
    if (content === undefined) continue
    stripped.set(
      relPath,
      stripEmptyGroupRegions(stripRegions(content, "module:" + name))
    )
  }

  // 批量剪枝：8 个文件共用一次 LanguageService / Program（单次建模是主要开销，
  // 逐文件调用 organizeUnusedImports 会给每个文件重复建 Program，CI 上慢 3 倍）
  const pruned = pruneSession.organize(
    new Map(
      [...stripped].map(([relPath, content]) => [
        path.join(root, relPath),
        content,
      ])
    )
  )

  const result = new Map<string, string>()
  for (const [relPath, content] of stripped) {
    const filePath = path.join(root, relPath)
    result.set(
      relPath,
      await formatWithPrettier(pruned.get(filePath) ?? content, filePath)
    )
  }
  return result
}

const PRETTIER_OPTIONS = {
  endOfLine: "lf" as const,
  semi: false,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "es5" as const,
  printWidth: 80,
}

/** 用仓库 prettier 格式化（模拟 gen:module / remove:module 的 prettier --write） */
let prettierModule: Promise<{
  format: (source: string, options: Record<string, unknown>) => Promise<string>
}> | null = null

async function formatWithPrettier(
  content: string,
  filePath: string
): Promise<string> {
  prettierModule ??= import("prettier") as Promise<{
    format: (
      source: string,
      options: Record<string, unknown>
    ) => Promise<string>
  }>
  const prettier = await prettierModule
  return prettier.format(content, {
    ...PRETTIER_OPTIONS,
    filepath: filePath,
    plugins: [],
  })
}

describe("真实注册文件往返逐字节还原", () => {
  const repoRoot = resolveRepoRoot()
  const readReal = (relPath: string) => readRepoFileOrNull(repoRoot, relPath)
  const pristine = (): Map<string, string> => {
    const map = new Map<string, string>()
    for (const relPath of MODULE_REGISTRATION_FILES) {
      const content = readReal(relPath)
      expect(content, relPath).not.toBeNull()
      map.set(relPath, content as string)
    }
    return map
  }

  const expectByteEqual = (
    actual: Map<string, string>,
    expected: Map<string, string>
  ) => {
    for (const relPath of MODULE_REGISTRATION_FILES) {
      expect(actual.get(relPath), relPath).toBe(expected.get(relPath))
    }
  }

  it(
    "单模块：生成探针模块 → remove 剥离 + imports:prune → 8 个文件逐字节还原",
    { timeout: 30_000 },
    async () => {
      const original = pristine()
      const name = freshModuleName("roundtrip-probe")
      const spec = buildSpec({ name, label: "往返探针" })
      const generated = new Map(original)
      for (const change of renderRegistrationChanges(spec, readReal)) {
        generated.set(change.relPath, change.after)
      }
      // 生成结果必须能通过区块完整性解析（remove:module 前置门槛）
      for (const relPath of MODULE_REGISTRATION_FILES) {
        expect(
          () => parseRegions(generated.get(relPath)!),
          relPath
        ).not.toThrow()
      }
      const stripped = await stripAndPrune(repoRoot, generated, name)
      expectByteEqual(stripped, original)
    }
  )

  it(
    "双模块（不共用图标）卸载其一：另一模块与 Business 容器保留，再卸载全部后容器收起",
    { timeout: 30_000 },
    async () => {
      const original = pristine()
      const [iconA, iconB] = freshProbeIcons(2)
      const nameA = freshModuleName("roundtrip-a")
      const nameB = freshModuleName("roundtrip-b")
      const specA = buildSpec({ name: nameA, label: "甲", icon: iconA })
      const specB = buildSpec({
        name: nameB,
        label: "乙",
        icon: iconB,
        mode: "sortable",
      })
      const generated = new Map(original)
      for (const spec of [specA, specB]) {
        for (const change of renderRegistrationChanges(
          spec,
          (relPath) => generated.get(relPath) ?? null
        )) {
          generated.set(change.relPath, change.after)
        }
      }

      // 卸载 B：Business 容器与 A 区块保留，B 的专属图标被剪枝
      const afterRemoveB = await stripAndPrune(repoRoot, generated, nameB)
      const menuAfter = afterRemoveB.get("apps/web/src/lib/menu-config.ts")!
      expect(menuAfter).toContain("// #region gen:group:Business")
      expect(menuAfter).toContain("// #region module:" + nameA)
      expect(menuAfter).not.toContain("// #region module:" + nameB)
      expect(menuAfter).not.toContain(iconB)

      // 再卸载 A：容器收起（若仓库本无其他模块），8 个注册文件回到初始状态
      const afterRemoveAll = await stripAndPrune(repoRoot, afterRemoveB, nameA)
      expectByteEqual(afterRemoveAll, original)
    }
  )

  it(
    "双模块共用图标：卸载其一后共享图标保留；全部卸载后图标被剪枝",
    { timeout: 30_000 },
    async () => {
      const original = pristine()
      const [sharedIcon] = freshProbeIcons(1)
      const nameA = freshModuleName("roundtrip-shared-a")
      const nameB = freshModuleName("roundtrip-shared-b")
      const specA = buildSpec({ name: nameA, label: "甲", icon: sharedIcon })
      const specB = buildSpec({
        name: nameB,
        label: "乙",
        icon: sharedIcon,
        mode: "sortable",
      })
      const generated = new Map(original)
      for (const spec of [specA, specB]) {
        for (const change of renderRegistrationChanges(
          spec,
          (relPath) => generated.get(relPath) ?? null
        )) {
          generated.set(change.relPath, change.after)
        }
      }

      // A 与 B 共用同一图标：先卸 A，图标仍被 B 使用
      const afterRemoveA = await stripAndPrune(repoRoot, generated, nameA)
      const menuAfter = afterRemoveA.get("apps/web/src/lib/menu-config.ts")!
      expect(menuAfter).toContain(sharedIcon)
      expect(menuAfter).toContain("// #region module:" + nameB)

      // 再卸 B：该图标不再被任何生成模块使用 → imports:prune 删除（仓库原本不使用它）
      const afterRemoveAll = await stripAndPrune(repoRoot, afterRemoveA, nameB)
      expect(
        afterRemoveAll.get("apps/web/src/lib/menu-config.ts")
      ).not.toContain(sharedIcon)
      expectByteEqual(afterRemoveAll, original)
    }
  )

  it(
    "区块持久化：生成结果经 prettier 格式化后标记仍可识别，剥离后仍逐字节还原",
    { timeout: 30_000 },
    async () => {
      const original = pristine()
      const name = freshModuleName("roundtrip-persist")
      const spec = buildSpec({ name, label: "持久化探针" })
      const generated = new Map(original)
      for (const change of renderRegistrationChanges(spec, readReal)) {
        generated.set(change.relPath, change.after)
      }

      // 基线归一化：生成项目里基线文件可能不是 prettier 幂等形态
      // （scaffold 剥离特性后 prune 产生的多行 import 会被 prettier 折叠成单行），
      // 先格式化基线再比较，保证「往返收益」不受仓库当前格式影响。
      const expected = new Map<string, string>()
      const formatted = new Map<string, string>()
      const stripped = new Map<string, string>()
      for (const relPath of MODULE_REGISTRATION_FILES) {
        const filePath = path.join(repoRoot, relPath)
        expected.set(
          relPath,
          await formatWithPrettier(original.get(relPath)!, filePath)
        )
        // gen:module 落盘后会跑 prettier --write：标记行可能被重新缩进，仍须整行识别
        const formattedContent = await formatWithPrettier(
          generated.get(relPath)!,
          filePath
        )
        formatted.set(relPath, formattedContent)
        expect(listRegions(formattedContent), relPath).toContain(
          "module:" + name
        )
        expect(() => parseRegions(formattedContent), relPath).not.toThrow()
        stripped.set(
          relPath,
          stripEmptyGroupRegions(
            stripRegions(formattedContent, "module:" + name)
          )
        )
      }

      const pruned = pruneSession.organize(
        new Map(
          [...stripped].map(([relPath, content]) => [
            path.join(repoRoot, relPath),
            content,
          ])
        )
      )
      for (const relPath of MODULE_REGISTRATION_FILES) {
        const filePath = path.join(repoRoot, relPath)
        const restored = await formatWithPrettier(
          pruned.get(filePath) ?? stripped.get(relPath)!,
          filePath
        )
        expect(restored, relPath).toBe(expected.get(relPath)!)
      }
    }
  )
})

describe("后端域 / 前端切片拆分", () => {
  // 名字必须避开宿主已生成的模块：注册文件里已有同名区块时 renderRegistrationChanges
  // 会判定「已注册」而返回空变更，生成项目里跑本用例就会假失败。
  const spec = buildSpec({
    name: `slice-probe-${Date.now().toString(36)}`,
    label: "合同",
  })

  it("renderBackendFiles 只含 shared 与 api，不含任何端目录", () => {
    const files = renderBackendFiles(spec)
    expect(files).toHaveLength(4)
    for (const file of files) {
      expect(file.relPath.startsWith("apps/web/")).toBe(false)
      expect(file.relPath.startsWith("apps/")).toBe(
        file.relPath.startsWith("apps/api/")
      )
    }
  })

  it("renderWebSliceFiles 按端参数化，5 个文件全在该端目录下", () => {
    const files = renderWebSliceFiles(spec, "portal")
    expect(files).toHaveLength(5)
    for (const file of files) {
      expect(file.relPath.startsWith("apps/portal/src/")).toBe(true)
    }
  })

  it("拆分后拼接与 renderModuleFiles 逐字节一致（含顺序）", () => {
    const combined = [...renderBackendFiles(spec), ...renderWebSliceFiles(spec)]
    expect(combined).toEqual(renderModuleFiles(spec))
  })

  it("注册点清单拆分后拼接与历史 8 个逐字节一致（含顺序）", () => {
    expect([
      ...BACKEND_REGISTRATION_FILES,
      ...webSliceRegistrationFiles("web"),
    ]).toEqual(MODULE_REGISTRATION_FILES)
    expect(BACKEND_REGISTRATION_FILES).toHaveLength(5)
    expect(webSliceRegistrationFiles("portal")).toEqual([
      "apps/portal/src/lib/query-keys.ts",
      "apps/portal/src/App.tsx",
      "apps/portal/src/lib/menu-config.ts",
    ])
  })

  it("scope.app 指向不存在的端 → 报「找不到注册文件」，不静默跳过", () => {
    const repoRoot = resolveRepoRoot()
    const read = (relPath: string) => readRepoFileOrNull(repoRoot, relPath)
    // 用不可能存在的端 id：宿主仓库本身可能已经是多端项目
    expect(() =>
      renderRegistrationChanges(spec, read, { app: "ghost-app" })
    ).toThrow(GenModuleError)
    expect(() =>
      renderRegistrationChanges(spec, read, { app: "ghost-app" })
    ).toThrow("apps/ghost-app/src/lib/query-keys.ts")
  })

  it("scope.app 指向真实存在的端时只改该端 3 个文件", () => {
    const repoRoot = resolveRepoRoot()
    // 用默认端的真实内容冒充 portal（克隆语义），验证 scope 的路径隔离
    const virtual = new Map<string, string>()
    for (const relPath of MODULE_REGISTRATION_FILES) {
      virtual.set(relPath, readRepoFileOrNull(repoRoot, relPath)!)
    }
    for (const relPath of webSliceRegistrationFiles("portal")) {
      virtual.set(
        relPath,
        virtual.get(relPath.replace("apps/portal/", "apps/web/"))!
      )
    }
    const read = (relPath: string) => virtual.get(relPath) ?? null
    const changes = renderRegistrationChanges(spec, read, { app: "portal" })
    expect(changes.map((change) => change.relPath)).toEqual(
      webSliceRegistrationFiles("portal")
    )
    // 后端域与默认端切片一个字节都不动
    for (const relPath of MODULE_REGISTRATION_FILES) {
      const changed = changes.find((change) => change.relPath === relPath)
      expect(changed, relPath).toBeUndefined()
    }
  })
})

describe("parseArgs 多端 flag", () => {
  it("--app / --all-modules / --all-apps 取值与缺省", () => {
    const options = parseArgs([
      "--name",
      "contract",
      "--app",
      "portal",
      "--remove",
      "--all-modules",
    ])
    expect(options.app).toBe("portal")
    expect(options.allModules).toBe(true)
    expect(options.allApps).toBe(false)
    expect(parseArgs(["--name", "contract"]).app).toBe("")
    expect(parseArgs(["--all-apps"]).allApps).toBe(true)
    expect(parseArgs(["--all-modules=false"]).allModules).toBe(false)
  })

  it("--icon / --mode 显式标记：缺省值不能被当成用户意图", () => {
    const implicit = parseArgs(["--name", "contract", "--label", "合同"])
    expect(implicit.iconExplicit).toBe(false)
    expect(implicit.modeExplicit).toBe(false)
    const explicit = parseArgs([
      "--name",
      "contract",
      "--label",
      "合同",
      "--icon",
      "FileText",
      "--mode",
      "crud",
    ])
    // 即使传的就是缺省值，也算显式传入
    expect(explicit.iconExplicit).toBe(true)
    expect(explicit.modeExplicit).toBe(true)
  })
})

describe("多端往返逐字节还原", () => {
  const repoRoot = resolveRepoRoot()
  const portalFiles = webSliceRegistrationFiles("portal")
  const allFiles = [...MODULE_REGISTRATION_FILES, ...portalFiles]

  /** portal 初始内容 = 默认端真实内容（add:web 的克隆语义） */
  const pristine = (): Map<string, string> => {
    const map = new Map<string, string>()
    for (const relPath of MODULE_REGISTRATION_FILES) {
      const content = readRepoFileOrNull(repoRoot, relPath)
      expect(content, relPath).not.toBeNull()
      map.set(relPath, content as string)
    }
    for (const relPath of portalFiles) {
      map.set(
        relPath,
        map.get(relPath.replace("apps/portal/", "apps/web/")) as string
      )
    }
    return map
  }

  it(
    "裸 gen → --app portal gen → 拆 portal 切片 → 全域卸载：11 个文件逐字节还原",
    { timeout: 60_000 },
    async () => {
      const original = pristine()
      const name = freshModuleName("multiapp-probe")
      const spec = buildSpec({ name, label: "多端探针" })

      // 1. 裸 gen：后端域 + 默认端切片
      const generated = new Map(original)
      const readGenerated = (relPath: string) => generated.get(relPath) ?? null
      for (const change of renderRegistrationChanges(spec, readGenerated)) {
        generated.set(change.relPath, change.after)
      }
      const afterDomain = new Map(generated)

      // 2. --app portal：只动 portal 3 个文件，后端域与默认端一个字节都不变
      const sliceChanges = renderRegistrationChanges(spec, readGenerated, {
        app: "portal",
      })
      expect(sliceChanges.map((change) => change.relPath)).toEqual(portalFiles)
      for (const change of sliceChanges) {
        generated.set(change.relPath, change.after)
      }
      for (const relPath of MODULE_REGISTRATION_FILES) {
        expect(generated.get(relPath), relPath).toBe(afterDomain.get(relPath))
      }
      for (const relPath of allFiles) {
        expect(
          () => parseRegions(generated.get(relPath)!),
          relPath
        ).not.toThrow()
      }

      // 3. 只拆 portal 切片：portal 3 个还原，其余 8 个保持「已生成」状态
      const portalRestored = await stripAndPrune(
        repoRoot,
        generated,
        name,
        portalFiles
      )
      const merged = new Map(generated)
      for (const [relPath, content] of portalRestored) {
        merged.set(relPath, content)
      }
      for (const relPath of portalFiles) {
        expect(merged.get(relPath), relPath).toBe(original.get(relPath))
      }
      for (const relPath of MODULE_REGISTRATION_FILES) {
        expect(merged.get(relPath), relPath).toBe(afterDomain.get(relPath))
      }

      // 4. 全域卸载：11 个文件全部回到初始状态
      const restored = await stripAndPrune(repoRoot, merged, name)
      for (const relPath of MODULE_REGISTRATION_FILES) {
        expect(restored.get(relPath), relPath).toBe(original.get(relPath))
      }
      for (const relPath of portalFiles) {
        expect(merged.get(relPath), relPath).toBe(original.get(relPath))
      }
    }
  )
})
