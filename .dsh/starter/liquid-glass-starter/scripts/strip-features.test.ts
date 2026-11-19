import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import {
  isExcludedFromTemplate,
  stripTemplateOnlyMarkdownRegions,
} from "../tools/scaffolder/scripts/lib/template-copy"
import {
  FEATURE_IDS,
  type FeatureId,
  type FeatureManifest,
  FEATURES,
} from "./features"
import { listRegions } from "./lib/code-regions"
import { pruneUnusedImportsInFiles } from "./prune-unused-imports"
import {
  featureRegionId,
  normalizeWebRoot,
  remapWebPath,
  SELF_FILES,
  stripFeatures,
  type StripFeaturesResult,
} from "./strip-features"

// 本文件只操作 mkdtemp 临时副本：**任何用例都不得对真实仓库执行剥离**。
const REPO_ROOT = path.resolve(import.meta.dir, "..")

/** 以宽类型读取清单（satisfies 后的字面量类型包含各特性不同的可选字段）。 */
function featureManifest(id: FeatureId): FeatureManifest {
  return FEATURES[id]
}

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── 通用文件助手 ─────────────────────────────────────────────────────────────

function writeFile(root: string, rel: string, content: string): void {
  const absolute = path.join(root, rel)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, content)
}

function readFile(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8")
}

function fileExists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel))
}

function walkFiles(
  root: string,
  visit: (rel: string, absolute: string) => void
): void {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop() as string
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(absolute)
      } else {
        visit(path.relative(root, absolute), absolute)
      }
    }
  }
}

/** 列出全部文件 → 内容快照（dry-run 落盘对比用）。 */
function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {}
  walkFiles(root, (rel, absolute) => {
    snapshot[rel] = fs.readFileSync(absolute, "utf8")
  })
  return snapshot
}

// ── feature 区块标记检测 ─────────────────────────────────────────────────────

const FEATURE_MARKER_PATTERNS = [
  /\/\/\s*#region\s+feature:/,
  /\/\/\s*#endregion\s+feature:/,
  /\{\/\*\s*#region\s+feature:/,
  /\{\/\*\s*#endregion\s+feature:/,
  /<!--\s*region:feature:/,
  /<!--\s*endregion:feature:/,
  /^#\s*region:feature:/m,
  /^#\s*endregion:feature:/m,
]

/** 返回 { 文件: 命中内容 } 形式的残留标记列表；空数组 = 干净。 */
function findFeatureMarkers(root: string, rels: readonly string[]): string[] {
  const violations: string[] = []
  for (const rel of rels) {
    const absolute = path.join(root, rel)
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue
    const content = fs.readFileSync(absolute, "utf8")
    for (const pattern of FEATURE_MARKER_PATTERNS) {
      const matched = pattern.exec(content)
      if (matched) violations.push(`${rel} → ${JSON.stringify(matched[0])}`)
    }
  }
  return violations
}

const SCANNABLE_EXTENSIONS = [".ts", ".tsx", ".md"]

/** 扫描「模板源码表面」：apps/ packages/ .agents/ docs/specs/ + 根文档（flat 为 frontend/）。 */
function collectFeatureSurface(root: string): string[] {
  const files: string[] = []
  for (const dir of ["apps", "packages", "frontend", ".agents", "docs/specs"]) {
    const absolute = path.join(root, dir)
    if (!fs.existsSync(absolute)) continue
    walkFiles(absolute, (rel) => {
      const fileName = path.basename(rel)
      if (fileName === ".env.example") {
        files.push(path.join(dir, rel))
        return
      }
      if (SCANNABLE_EXTENSIONS.some((ext) => fileName.endsWith(ext))) {
        files.push(path.join(dir, rel))
      }
    })
  }
  for (const rel of ["AGENTS.md", "README.md", ".env.example"]) {
    if (fileExists(root, rel)) files.push(rel)
  }
  // 清单里的路径是 POSIX；Windows 的 path.relative 返回反斜杠，比较前统一归一。
  return files
    .map((rel) => rel.split(path.sep).join("/"))
    .filter((rel) => {
      const segments = rel.split("/")
      return !["node_modules", "dist", ".git", "coverage"].some((skip) =>
        segments.includes(skip)
      )
    })
}

// ── fixture：镜像真实模板结构 + 全部清单文件的迷你项目 ───────────────────────

const APP_TEMPLATE = `import { lazy } from "react"

// #region feature:audit-log
const AuditLogPage = lazy(() => import("@/pages/audit-log/AuditLogPage"))
// #endregion feature:audit-log
const DashboardPage = lazy(() => import("@/pages/DashboardPage"))

// #region feature:demo
const ComponentsOverviewPage = lazy(() => import("@/pages/ComponentsOverviewPage"))
// #region feature:notification
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage"))
// #endregion feature:notification
// #endregion feature:demo

export default function App() {
  return (
    <Routes>
      {/* #region feature:audit-log */}
      <Route path="/audit-log" element={<AuditLogPage />} />
      {/* #endregion feature:audit-log */}
      {/* #region feature:demo */}
      <Route path="/components" element={<ComponentsOverviewPage />} />
      {/* #region feature:notification */}
      <Route path="/components/notifications" element={<NotificationsPage />} />
      {/* #endregion feature:notification */}
      {/* #endregion feature:demo */}
      <Route path="/dashboard" element={<DashboardPage />} />
    </Routes>
  )
}
`

const MENU_CONFIG_TEMPLATE = `export const menuGroups = [
  {
    label: "Overview",
    items: [{ title: "仪表盘", path: "/dashboard" }],
  },
  // #region feature:demo
  {
    label: "Showcase",
    items: [
      { title: "概览", path: "/components" },
      // #region feature:notification
      { title: "消息通知", path: "/components/notifications" },
      // #endregion feature:notification
    ],
  },
  // #endregion feature:demo
  // #region feature:audit-log
  {
    label: "Admin",
    items: [{ title: "审计日志", path: "/audit-log" }],
  },
  // #endregion feature:audit-log
]
`

const MENU_TEST_TEMPLATE = `import { describe, expect, it } from "bun:test"

// #region feature:audit-log
describe("审计日志菜单项", () => {
  it("Admin 分组存在", () => expect(true).toBe(true))
})
// #endregion feature:audit-log

// #region feature:demo
describe("Showcase 面包屑", () => {
  it("存在 /components 面包屑", () => expect(true).toBe(true))
})
// #endregion feature:demo
`

const QUERY_KEYS_TEMPLATE = `export const userKeys = {
  all: ["users"] as const,
}

// #region feature:notification
export const notificationKeys = {
  all: ["notifications"] as const,
}
// #endregion feature:notification

// [gen:module:query-keys] 由 bun run gen:module 追加业务域 query key（勿手改本行）
// #region feature:audit-log
export const logKeys = {
  all: ["logs"] as const,
}
// #endregion feature:audit-log
`

const TOPBAR_TEMPLATE = `import { TopBarNotificationSlot } from "@/components/layout/TopBarNotificationSlot"

export function TopBar() {
  return (
    <header>
      {/* #region feature:notification */}
      <TopBarNotificationSlot />
      {/* #endregion feature:notification */}
    </header>
  )
}
`

const COMPONENTS_OVERVIEW_TEMPLATE = `export default function ComponentsOverviewPage() {
  return (
    <div>
      {/* #region feature:demo */}
      {/* #region feature:notification */}
      <NotificationCenter />
      {/* #endregion feature:notification */}
      <DataTable />
      {/* #endregion feature:demo */}
    </div>
  )
}
`

const API_INDEX_TEMPLATE = `import notificationsRoute from "./modules/notification/notification.route.js"

const app = { route() {} }

// #region feature:notification
app.route("/notifications", notificationsRoute)
// #endregion feature:notification

// /logs 只读查询 API 属 Tier 0，永不随特性剥离
app.route("/logs", () => {})
`

const API_DB_TEMPLATE = `import { seedTemplateDemoData } from "./db/demo-seed.js"

export function init(db: unknown, source: { kind: "init" | "drizzle" }) {
  // #region feature:notification
  seedTemplateDemoData(db, source)
  // #endregion feature:notification
}
`

const API_ENV_TEMPLATE = `export const env = {
  NODE_ENV: "development",
  PORT: 3000,
}
`

const SEED_DEV_TEMPLATE = `// #region feature:notification
import { seedDemoNotifications } from "../src/db/demo-seed.js"
// #endregion feature:notification
import * as schema from "../src/db/schema.js"

export function seedDevData(d: unknown): void {
  void schema
  // #region feature:notification
  seedDemoNotifications(d)
  // #endregion feature:notification
}
`

const ADVANCED_PATTERNS_TEMPLATE = `# 进阶范式

<!-- region:feature:notification -->
## ④ 异步通知（notifySafe）
<!-- endregion:feature:notification -->

\`\`\`ts
// #region feature:notification
await notifySafe(opCtx, { type: "order.paid", payload: {} })
// #endregion feature:notification
\`\`\`

## 其他范式
`

const NOTIFICATION_SKILL_TEMPLATE = `# Business Feature Builder

<!-- region:feature:notification -->
- 写操作后异步通知：notifySafe()
<!-- endregion:feature:notification -->

- 其他约定
`

const SPEC_TEMPLATE = `# 业务规格书模板

<!-- region:feature:notification -->
## 4.2 消息通知副作用
<!-- endregion:feature:notification -->

## 5. 测试
`

/** 按清单把所有「整体删除」文件先落地，保证删除目标存在、无缺文件 warning。 */
function writeManifestDeleteTargets(root: string): void {
  for (const id of FEATURE_IDS) {
    const manifest = featureManifest(id)
    for (const group of Object.values(manifest.files)) {
      for (const rel of group ?? []) {
        const absolute = path.join(root, rel)
        if (path.extname(rel) !== "") {
          writeFile(root, rel, "// manifest placeholder\n")
        } else {
          fs.mkdirSync(absolute, { recursive: true })
          fs.writeFileSync(
            path.join(absolute, "placeholder.tsx"),
            "// manifest placeholder\n"
          )
        }
      }
    }
  }
  // demo 的 DashboardPage 同时出现在 files 与 replaceFiles 中（先删后写），占位即可
  writeFile(
    root,
    "apps/web/src/pages/DashboardPage.tsx",
    "export default function DashboardPage() {\n  return <div>template dashboard</div>\n}\n"
  )
}

/**
 * notification 切片的后端文件 fixture：
 * - demo-seed.ts 带 demo region（R1 修复）：demo 单独剥离时只删 href 行、文件保留；
 *   notification 一起剥离时整文件已删除，regionFiles 处理必须 skip，否则会「写回复活」；
 * - notification.route.ts 只有业务端点，已不再包含 demo href / feature:demo 区块。
 */
function writeDemoRegionsOnNotificationFiles(root: string): void {
  writeFile(
    root,
    "apps/api/src/db/demo-seed.ts",
    `export const demoSeeds = [
  // #region feature:demo
  { href: "/components/notifications" },
  // #endregion feature:demo
  { href: "/dashboard" },
]
`
  )
  writeFile(
    root,
    "apps/api/src/modules/notification/notification.route.ts",
    "export const notificationRoute = true\n"
  )
}

function createTemplateFixture(): string {
  const root = createTempDir("strip-features-fixture-")

  // Tier 0：所有特性剥离后必须保留
  writeFile(
    root,
    "apps/api/src/modules/log/log.route.ts",
    "export const logRoute = {}\n"
  )
  writeFile(
    root,
    "apps/api/src/modules/log/log.service.ts",
    "export const queryLogs = () => []\n"
  )
  writeFile(
    root,
    "apps/api/src/shared/notification.ts",
    "export function notify() {}\n"
  )
  writeFile(
    root,
    "apps/api/src/shared/notification-bus.ts",
    "export const bus = {}\n"
  )
  writeFile(
    root,
    "packages/shared/src/notification.ts",
    "export type NotificationWire = { id: string }\n"
  )
  writeFile(
    root,
    "packages/shared/src/audit.ts",
    "export const AUDIT_MODULES = []\n"
  )

  // 剥离基础设施（保留）
  writeFile(
    root,
    "scripts/lib/code-regions.ts",
    "// region engine (retained)\n"
  )
  writeFile(root, "scripts/lib/long-file-ratchet.ts", "// ratchet (retained)\n")
  // 自清理文件
  for (const rel of SELF_FILES)
    writeFile(root, rel, "// template-only stripper file\n")
  writeFile(
    root,
    "package.json",
    `${JSON.stringify(
      {
        name: "fixture",
        scripts: {
          "lint:scripts": `eslint scripts/gen-module.ts ${SELF_FILES.join(" ")} scripts/prune-unused-imports.ts`,
          "test:scripts": "bun test scripts/",
        },
      },
      null,
      2
    )}\n`
  )

  writeManifestDeleteTargets(root)

  // 带 feature 区块的宿主 / 注册点 / 文档
  writeFile(root, "apps/web/src/App.tsx", APP_TEMPLATE)
  writeFile(root, "apps/web/src/lib/menu-config.ts", MENU_CONFIG_TEMPLATE)
  writeFile(root, "apps/web/src/lib/menu-config.test.ts", MENU_TEST_TEMPLATE)
  writeFile(root, "apps/web/src/lib/query-keys.ts", QUERY_KEYS_TEMPLATE)
  writeFile(root, "apps/web/src/components/layout/TopBar.tsx", TOPBAR_TEMPLATE)
  writeFile(
    root,
    "apps/web/src/pages/ComponentsOverviewPage.tsx",
    COMPONENTS_OVERVIEW_TEMPLATE
  )
  writeFile(root, "apps/api/src/index.ts", API_INDEX_TEMPLATE)
  writeFile(root, "apps/api/src/db.ts", API_DB_TEMPLATE)
  writeFile(root, "apps/api/src/env.ts", API_ENV_TEMPLATE)
  writeFile(root, "apps/api/src/env.test.ts", "// env tests\n")
  writeFile(root, "apps/api/scripts/seed-dev.ts", SEED_DEV_TEMPLATE)
  writeFile(root, ".env.example", "PORT=3000\n")
  writeFile(
    root,
    "AGENTS.md",
    `# Guide

<!-- region:feature:audit-log -->
- AuditDiffViewer
<!-- endregion:feature:audit-log -->
<!-- region:feature:notification -->
- NotificationCenter 消息通知内核
<!-- endregion:feature:notification -->
- DataTable
`
  )
  writeFile(
    root,
    "README.md",
    `# Readme

<!-- region:feature:notification -->
## 消息通知后端
<!-- endregion:feature:notification -->

## Other
`
  )
  writeFile(
    root,
    ".agents/skills/business-feature-builder/references/advanced-patterns.md",
    ADVANCED_PATTERNS_TEMPLATE
  )
  writeFile(
    root,
    ".agents/skills/business-feature-builder/SKILL.md",
    NOTIFICATION_SKILL_TEMPLATE
  )
  writeFile(root, "docs/specs/_template.md", SPEC_TEMPLATE)
  writeDemoRegionsOnNotificationFiles(root)

  return root
}

const ALL_STRIPPED_MARKER_FREE = [
  "apps/web/src/App.tsx",
  "apps/web/src/lib/menu-config.ts",
  "apps/web/src/lib/menu-config.test.ts",
  "apps/web/src/lib/query-keys.ts",
  "apps/web/src/components/layout/TopBar.tsx",
  "apps/web/src/pages/ComponentsOverviewPage.tsx",
  "apps/api/src/index.ts",
  "apps/api/src/db.ts",
  "apps/api/src/env.ts",
  "apps/api/scripts/seed-dev.ts",
  "apps/api/src/db/demo-seed.ts",
  "apps/api/src/modules/notification/notification.route.ts",
  ".env.example",
  "AGENTS.md",
  "README.md",
  ".agents/skills/business-feature-builder/references/advanced-patterns.md",
  ".agents/skills/business-feature-builder/SKILL.md",
  "docs/specs/_template.md",
]

// ── 清单一致性 ───────────────────────────────────────────────────────────────

describe("features.ts 清单", () => {
  it("特性 id 唯一且与 FEATURES 键一致", () => {
    expect(new Set(FEATURE_IDS).size).toBe(FEATURE_IDS.length)
    expect(Object.keys(FEATURES).sort()).toEqual([...FEATURE_IDS].sort())
  })

  it("所有路径均为仓库相对路径（无绝对路径 / 无 '..' 越界）", () => {
    for (const id of FEATURE_IDS) {
      const manifest = featureManifest(id)
      const paths = [
        ...(manifest.files.web ?? []),
        ...(manifest.files.api ?? []),
        ...(manifest.files.shared ?? []),
        ...manifest.regionFiles,
        ...Object.keys(manifest.replaceFiles?.web ?? {}),
      ]
      for (const rel of paths) {
        expect(path.isAbsolute(rel)).toBe(false)
        expect(rel.split("/")).not.toContain("..")
      }
    }
  })

  it("web 文件路径统一以 apps/web/src/ 前缀声明（由 stripper 负责 flat 重映射）", () => {
    for (const id of FEATURE_IDS) {
      for (const rel of featureManifest(id).files.web ?? []) {
        expect(rel.startsWith("apps/web/src/")).toBe(true)
      }
      for (const [rel] of Object.entries(
        featureManifest(id).replaceFiles?.web ?? {}
      )) {
        expect(rel.startsWith("apps/web/src/")).toBe(true)
      }
    }
  })

  it("每个特性都有文件清单与区块清单", () => {
    for (const id of FEATURE_IDS) {
      const manifest = featureManifest(id)
      const fileCount =
        (manifest.files.web?.length ?? 0) +
        (manifest.files.api?.length ?? 0) +
        (manifest.files.shared?.length ?? 0)
      expect(fileCount).toBeGreaterThan(0)
      expect(manifest.regionFiles.length).toBeGreaterThan(0)
    }
  })

  it("demo 的 DashboardPage 占位页是无区块标记的默认导出", () => {
    const content =
      featureManifest("demo").replaceFiles?.web?.[
        "apps/web/src/pages/DashboardPage.tsx"
      ]
    expect(content).toBeDefined()
    expect(content as string).toContain("export default function DashboardPage")
    expect(content as string).not.toMatch(/feature:/)
  })
})

// ── fixture 执行 ─────────────────────────────────────────────────────────────

describe("stripFeatures：fixture", () => {
  it("remove=[] 仅去标记：不删文件、所有 feature 标记消失、自清理生效", () => {
    const root = createTemplateFixture()

    const result = stripFeatures({ root, webRoot: "apps/web/src", remove: [] })

    expect(result.removed).toEqual([])
    expect(result.retained).toEqual([...FEATURE_IDS])
    expect(result.deleted).toEqual([])
    expect(result.replaced).toEqual([])

    // 文件全部保留
    expect(fileExists(root, "apps/web/src/pages/audit-log")).toBe(true)
    expect(fileExists(root, "apps/web/src/pages/DashboardPage.tsx")).toBe(true)
    expect(fileExists(root, "apps/api/src/modules/notification")).toBe(true)

    // 去掉标记但保留内容
    expect(findFeatureMarkers(root, ALL_STRIPPED_MARKER_FREE)).toEqual([])
    expect(readFile(root, "apps/web/src/App.tsx")).toContain(
      "NotificationsPage"
    )
    expect(
      readFile(root, "apps/web/src/components/layout/TopBar.tsx")
    ).toContain("<TopBarNotificationSlot />")
    expect(readFile(root, "AGENTS.md")).toContain("NotificationCenter")
    expect(readFile(root, ".env.example")).toContain("PORT=3000")

    // 自清理：自身文件被删、package.json 去掉引用，其余基础设施保留
    expect(result.selfDeleted.sort()).toEqual([...SELF_FILES].sort())
    for (const rel of SELF_FILES) expect(fileExists(root, rel)).toBe(false)
    expect(fileExists(root, "scripts/lib/code-regions.ts")).toBe(true)
    const pkg = JSON.parse(readFile(root, "package.json")) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts["lint:scripts"]).not.toContain("scripts/features.ts")
    expect(pkg.scripts["lint:scripts"]).toContain("scripts/gen-module.ts")
  })

  it("单特性剥离 audit-log：删 UI 切片、保留 /logs 内核与通知特性", () => {
    const root = createTemplateFixture()

    const result = stripFeatures({
      root,
      webRoot: "apps/web/src",
      remove: ["audit-log"],
    })

    // 文件 / 目录删除
    expect(result.deleted).toContain("apps/web/src/pages/audit-log")
    expect(result.deleted).toContain(
      "apps/web/src/components/shared/AuditDiffViewer.tsx"
    )
    expect(result.deleted).toContain("apps/web/src/services/logs.ts")
    expect(fileExists(root, "apps/web/src/pages/audit-log")).toBe(false)
    expect(
      fileExists(root, "apps/web/src/components/shared/AuditDiffViewer.tsx")
    ).toBe(false)

    // 区块剥离
    expect(readFile(root, "apps/web/src/App.tsx")).not.toContain("AuditLogPage")
    expect(readFile(root, "apps/web/src/lib/menu-config.ts")).not.toContain(
      "审计日志"
    )
    expect(readFile(root, "AGENTS.md")).not.toContain("AuditDiffViewer")
    expect(findFeatureMarkers(root, ALL_STRIPPED_MARKER_FREE)).toEqual([])

    // 保留特性内容仍在（只去标记）
    expect(readFile(root, "apps/web/src/App.tsx")).toContain(
      "NotificationsPage"
    )
    expect(readFile(root, "AGENTS.md")).toContain("NotificationCenter")

    // Tier 0：/logs 后端与审计内核保留
    expect(fileExists(root, "apps/api/src/modules/log/log.route.ts")).toBe(true)
    expect(fileExists(root, "apps/api/src/modules/log/log.service.ts")).toBe(
      true
    )
    expect(fileExists(root, "apps/api/src/modules/notification")).toBe(true)
  })

  it("组合剥离 demo+notification：交集内容消失、api 通知后端被删、审计保留", () => {
    const root = createTemplateFixture()

    const result = stripFeatures({
      root,
      webRoot: "apps/web/src",
      remove: ["notification", "demo"],
    })

    // 交集：App.tsx 中外层 demo + 内层 notification 都消失，DashboardPage 保留
    const app = readFile(root, "apps/web/src/App.tsx")
    expect(app).not.toContain("NotificationsPage")
    expect(app).not.toContain("ComponentsOverviewPage")
    expect(app).not.toContain("/components")
    expect(app).toContain("DashboardPage")
    expect(app).toContain("/dashboard")

    // 顶栏插槽用法被剥离，TopBar 文件本身保留（import 由 imports:prune 负责清理）
    expect(fileExists(root, "apps/web/src/components/layout/TopBar.tsx")).toBe(
      true
    )
    expect(
      readFile(root, "apps/web/src/components/layout/TopBar.tsx")
    ).not.toContain("<TopBarNotificationSlot />")

    // 通知切片文件整体删除
    expect(fileExists(root, "apps/web/src/pages/NotificationsPage.tsx")).toBe(
      false
    )
    expect(fileExists(root, "apps/web/src/lib/demo-notifications.ts")).toBe(
      false
    )
    expect(fileExists(root, "apps/api/src/modules/notification")).toBe(false)
    expect(fileExists(root, "apps/api/src/db/demo-seed.ts")).toBe(false)
    // C-FIX-1 回归：demo regionFile 落在「整目录删除项」内时，不能被 region 写回复活
    expect(
      fileExists(
        root,
        "apps/api/src/modules/notification/notification.route.ts"
      )
    ).toBe(false)

    // 后端挂载 / 种子 / docs / seed-dev 全部清理（env.ts 与 .env.example 已无
    // 通知专属内容，因此不再需要区块手术）
    expect(readFile(root, "apps/api/src/index.ts")).not.toContain(
      "/notifications"
    )
    expect(readFile(root, "apps/api/src/index.ts")).toContain("/logs")
    expect(readFile(root, "apps/api/src/db.ts")).not.toContain(
      "seedTemplateDemoData(db"
    )
    expect(readFile(root, "apps/api/src/env.ts")).toContain("PORT: 3000")
    expect(readFile(root, "apps/api/scripts/seed-dev.ts")).not.toContain(
      "seedDemoNotifications"
    )
    expect(readFile(root, ".env.example")).toContain("PORT=3000")
    expect(readFile(root, "AGENTS.md")).not.toContain("消息通知内核")
    expect(readFile(root, "README.md")).not.toContain("消息通知后端")
    expect(readFile(root, "docs/specs/_template.md")).not.toContain(
      "消息通知副作用"
    )

    // 保留特性 audit-log 只去标记，内容仍在
    expect(readFile(root, "AGENTS.md")).toContain("AuditDiffViewer")
    expect(findFeatureMarkers(root, ALL_STRIPPED_MARKER_FREE)).toEqual([])
    expect(result.removed).toEqual(["notification", "demo"])
    expect(result.retained).toEqual(["audit-log"])
  })

  it("单特性剥离 notification：demo 页面保留、通知交集卡片被移除", () => {
    const root = createTemplateFixture()

    stripFeatures({ root, webRoot: "apps/web/src", remove: ["notification"] })

    // demo 页面保留
    expect(
      fileExists(root, "apps/web/src/pages/ComponentsOverviewPage.tsx")
    ).toBe(true)
    expect(fileExists(root, "apps/web/src/pages/DashboardPage.tsx")).toBe(true)
    expect(readFile(root, "apps/web/src/pages/DashboardPage.tsx")).toContain(
      "template dashboard"
    )

    // 交集：通知卡片 / 菜单项 / 路由被移除，demo 其它内容保留
    const overview = readFile(
      root,
      "apps/web/src/pages/ComponentsOverviewPage.tsx"
    )
    expect(overview).not.toContain("NotificationCenter")
    expect(overview).toContain("DataTable")
    expect(readFile(root, "apps/web/src/lib/menu-config.ts")).toContain("概览")
    expect(readFile(root, "apps/web/src/lib/menu-config.ts")).not.toContain(
      "消息通知"
    )
    expect(readFile(root, "apps/web/src/App.tsx")).toContain(
      "ComponentsOverviewPage"
    )
    expect(readFile(root, "apps/web/src/App.tsx")).not.toContain(
      "NotificationsPage"
    )

    // api 通知后端删除，/logs 保留（demo regionFile 不复活已删目录）
    expect(fileExists(root, "apps/api/src/modules/notification")).toBe(false)
    expect(
      fileExists(
        root,
        "apps/api/src/modules/notification/notification.route.ts"
      )
    ).toBe(false)
    expect(fileExists(root, "apps/api/src/modules/log/log.route.ts")).toBe(true)
    expect(findFeatureMarkers(root, ALL_STRIPPED_MARKER_FREE)).toEqual([])
  })

  it("demo 剥离：DashboardPage 被 replaceFiles 替换为精简欢迎页", () => {
    const root = createTemplateFixture()

    const result = stripFeatures({
      root,
      webRoot: "apps/web/src",
      remove: ["demo"],
    })

    expect(result.replaced).toContain("apps/web/src/pages/DashboardPage.tsx")
    const dashboard = readFile(root, "apps/web/src/pages/DashboardPage.tsx")
    expect(dashboard).toContain("Welcome to your new project!")
    expect(dashboard).not.toContain("template dashboard")
    expect(dashboard).not.toMatch(/feature:/)
    // 保留的 /dashboard 路由仍指向 DashboardPage
    expect(readFile(root, "apps/web/src/App.tsx")).toContain("DashboardPage")
    expect(fileExists(root, "apps/web/src/pages/sections")).toBe(false)

    // C-FIX-1：notification 保留时，后端 demo 种子的 href 行被剥离、文件与通知切片保留
    expect(fileExists(root, "apps/api/src/db/demo-seed.ts")).toBe(true)
    expect(
      fileExists(
        root,
        "apps/api/src/modules/notification/notification.route.ts"
      )
    ).toBe(true)
    expect(readFile(root, "apps/api/src/db/demo-seed.ts")).not.toContain(
      "/components/notifications"
    )
    // notification.route.ts 不再包含 demo href，无需区块手术
    expect(
      readFile(root, "apps/api/src/modules/notification/notification.route.ts")
    ).toContain("notificationRoute")
    // 非 demo 的真实路由 href 保留
    expect(readFile(root, "apps/api/src/db/demo-seed.ts")).toContain(
      'href: "/dashboard"'
    )
  })

  it("--report 写 JSON：deleted / modified / replaced 为 root 相对路径", () => {
    const root = createTemplateFixture()

    const result = stripFeatures({
      root,
      webRoot: "apps/web/src",
      remove: ["notification", "demo"],
      reportPath: ".strip-features-report.json",
    })

    const reportPath = path.join(root, ".strip-features-report.json")
    expect(fs.existsSync(reportPath)).toBe(true)
    const report = JSON.parse(
      fs.readFileSync(reportPath, "utf8")
    ) as StripFeaturesResult

    expect(report.root).toBe(root)
    expect(report.webRoot).toBe("apps/web/src")
    expect(report.removed).toEqual(["notification", "demo"])
    expect(report.retained).toEqual(["audit-log"])
    expect(report.deleted).toContain("apps/web/src/pages/NotificationsPage.tsx")
    expect(report.modified).toContain("apps/web/src/App.tsx")
    expect(report.replaced).toContain("apps/web/src/pages/DashboardPage.tsx")
    for (const rel of [
      ...report.deleted,
      ...report.modified,
      ...report.replaced,
    ]) {
      expect(path.isAbsolute(rel)).toBe(false)
    }
    // CLI 返回值与落盘 report 内容一致
    expect(report.modified).toEqual(result.modified)
  })

  it("dry-run（--list）不落盘：文件快照与执行前一致，也不写 report", () => {
    const root = createTemplateFixture()
    const before = snapshotTree(root)

    const result = stripFeatures({
      root,
      webRoot: "apps/web/src",
      remove: [...FEATURE_IDS],
      reportPath: ".strip-features-report.json",
      dryRun: true,
    })

    expect(result.deleted.length).toBeGreaterThan(0)
    expect(result.modified.length).toBeGreaterThan(0)
    expect(result.selfDeleted.length).toBeGreaterThan(0)
    expect(snapshotTree(root)).toEqual(before)
    expect(fileExists(root, ".strip-features-report.json")).toBe(false)
  })

  it("幂等：同一剥离重复执行不抛错、第二次没有可删文件", () => {
    const root = createTemplateFixture()
    stripFeatures({ root, webRoot: "apps/web/src", remove: [...FEATURE_IDS] })
    const before = snapshotTree(root)

    const second = stripFeatures({
      root,
      webRoot: "apps/web/src",
      remove: [...FEATURE_IDS],
    })

    expect(second.deleted).toEqual([])
    expect(second.selfDeleted).toEqual([])
    expect(snapshotTree(root)).toEqual(before)
  })

  it("区块解析失败时 fail-fast：不产生任何半成品（删除 / 自清理均未落盘）", () => {
    const root = createTemplateFixture()
    // 破坏 App.tsx 的配对（删掉 audit-log 的 endregion）
    writeFile(
      root,
      "apps/web/src/App.tsx",
      APP_TEMPLATE.replace("// #endregion feature:audit-log\n", "")
    )

    expect(() =>
      stripFeatures({ root, webRoot: "apps/web/src", remove: ["audit-log"] })
    ).toThrow(/App\.tsx/)

    // 计算阶段失败 → 删除清单与自清理都没有执行
    expect(fileExists(root, "apps/web/src/pages/audit-log")).toBe(true)
    for (const rel of SELF_FILES) expect(fileExists(root, rel)).toBe(true)
  })

  it("--keep-self：保留剥离器自身文件与 package.json 引用", () => {
    const root = createTemplateFixture()

    const result = stripFeatures({
      root,
      webRoot: "apps/web/src",
      remove: ["audit-log"],
      keepSelf: true,
    })

    expect(result.selfDeleted).toEqual([])
    for (const rel of SELF_FILES) expect(fileExists(root, rel)).toBe(true)
    const pkg = JSON.parse(readFile(root, "package.json")) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts["lint:scripts"]).toContain("scripts/features.ts")
  })

  it("flat 项目：web 路径重映射到 frontend/src，api / shared 整段自动跳过", () => {
    const root = createTempDir("strip-features-flat-")
    for (const id of FEATURE_IDS) {
      for (const rel of featureManifest(id).files.web ?? []) {
        const flatRel = remapWebPath(rel, "frontend/src")
        if (path.extname(flatRel) !== "") {
          writeFile(root, flatRel, "// manifest placeholder\n")
        } else {
          fs.mkdirSync(path.join(root, flatRel), { recursive: true })
          fs.writeFileSync(
            path.join(root, flatRel, "placeholder.tsx"),
            "// manifest placeholder\n"
          )
        }
      }
    }
    writeFile(root, "frontend/src/App.tsx", APP_TEMPLATE)
    writeFile(
      root,
      "frontend/src/components/layout/TopBar.tsx",
      TOPBAR_TEMPLATE
    )
    writeFile(root, "frontend/src/lib/menu-config.ts", MENU_CONFIG_TEMPLATE)
    writeFile(root, "frontend/src/lib/query-keys.ts", QUERY_KEYS_TEMPLATE)
    writeFile(
      root,
      "frontend/src/pages/ComponentsOverviewPage.tsx",
      COMPONENTS_OVERVIEW_TEMPLATE
    )
    writeFile(
      root,
      "frontend/src/pages/DashboardPage.tsx",
      "export default function DashboardPage() {\n  return <div>template dashboard</div>\n}\n"
    )
    writeFile(
      root,
      "frontend/src/lib/theme-color-a11y.test.ts",
      "// 主题色 a11y（保留）\n"
    )
    writeFile(
      root,
      "AGENTS.md",
      "<!-- region:feature:notification -->\n- NotificationCenter\n<!-- endregion:feature:notification -->\n"
    )
    writeFile(root, "README.md", "# Readme\n")
    writeFile(root, ".env.example", "PORT=3000\n")
    for (const rel of SELF_FILES)
      writeFile(root, rel, "// template-only stripper file\n")
    writeFile(
      root,
      "scripts/lib/code-regions.ts",
      "// region engine (retained)\n"
    )

    const result = stripFeatures({
      root,
      webRoot: "frontend/src",
      remove: [...FEATURE_IDS],
    })

    expect(result.webRoot).toBe("frontend/src")
    expect(fs.existsSync(path.join(root, "apps"))).toBe(false)
    for (const rel of result.deleted) {
      expect(rel.startsWith("frontend/src/")).toBe(true)
    }
    expect(result.deleted).toContain("frontend/src/pages/audit-log")
    expect(result.deleted).toContain("frontend/src/pages/NotificationsPage.tsx")
    expect(findFeatureMarkers(root, collectFeatureSurface(root))).toEqual([])
    expect(readFile(root, "frontend/src/pages/DashboardPage.tsx")).toContain(
      "Welcome to your new project!"
    )
    expect(fileExists(root, "frontend/src/components/layout/TopBar.tsx")).toBe(
      true
    )
    expect(fileExists(root, "frontend/src/lib/theme-color-a11y.test.ts")).toBe(
      true
    )
  })

  it("参数防护：未知特性 / 越界 web-root / 不存在的 root 全部抛错", () => {
    const root = createTemplateFixture()
    expect(() => stripFeatures({ root, remove: ["nope"] })).toThrow(/未知特性/)
    expect(() => stripFeatures({ root, webRoot: "../outside" })).toThrow(
      /--web-root/
    )
    expect(() =>
      stripFeatures({ root: path.join(root, "not-exists") })
    ).toThrow(/目标项目目录不存在/)
    expect(() => normalizeWebRoot("../x")).toThrow()
    expect(() => normalizeWebRoot("/abs/path")).toThrow()
    expect(remapWebPath("apps/web/src/pages/x.tsx", "frontend/src")).toBe(
      "frontend/src/pages/x.tsx"
    )
    expect(remapWebPath("AGENTS.md", "frontend/src")).toBe("AGENTS.md")
    expect(featureRegionId("notification")).toBe("feature:notification")
  })
})

// ── 真实模板（只读 / mkdtemp 副本）──────────────────────────────────────────

/** 模拟 scaffold 的 stripTemplateOnlyArtifacts：生成项目不保留模板专属规则段。 */
function stripTemplateOnlyRegions(root: string): void {
  for (const rel of ["AGENTS.md", "README.md"]) {
    const absolute = path.join(root, rel)
    if (!fs.existsSync(absolute)) continue
    fs.writeFileSync(
      absolute,
      stripTemplateOnlyMarkdownRegions(fs.readFileSync(absolute, "utf8"))
    )
  }
}

/** 复制真实模板到 mkdtemp 副本（排除策略与 scaffold 共用同一份 lib）。 */
function copyRealTemplate(): string {
  const root = createTempDir("strip-features-real-")
  fs.cpSync(REPO_ROOT, root, {
    recursive: true,
    filter: (source) =>
      !isExcludedFromTemplate(path.relative(REPO_ROOT, source)),
  })
  stripTemplateOnlyRegions(root)
  return root
}

// ── 静态残留引用检查（代替慢速全量 typecheck，落实设计书 §8）──────────────
// 说明：完整 `bun run check` / typecheck 只能由人工验收覆盖——scaffold 全链路 e2e
// 依赖 GitLab 模板 cache + bun install + drizzle baseline，无法离线自动化（见
// SKILL.md「自动化测试边界与手工验收清单」，属设计书 §7.2 的已批准偏差）。

/** 遍历 root 下 apps/ + packages/ 的源码文件（默认排除 *.test.*）。 */
function collectSourceFiles(
  root: string,
  options: { includeTests?: boolean } = {}
): string[] {
  const files: string[] = []
  for (const dir of ["apps", "packages"]) {
    const base = path.join(root, dir)
    if (!fs.existsSync(base)) continue
    walkFiles(base, (rel) => {
      const fileName = path.basename(rel)
      if (!fileName.endsWith(".ts") && !fileName.endsWith(".tsx")) return
      if (!options.includeTests && /\.test\.(ts|tsx)$/.test(fileName)) return
      const segments = rel.split(path.sep)
      if (
        segments.some((segment) => ["node_modules", "dist"].includes(segment))
      )
        return
      files.push(`${dir}/${rel.split(path.sep).join("/")}`)
    })
  }
  return files
}

/** 提取文件中的静态 / 动态 / 副作用 import specifier。 */
function extractImportSpecifiers(content: string): string[] {
  const specifiers = new Set<string>()
  for (const pattern of [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
  ]) {
    let matched: RegExpExecArray | null
    while ((matched = pattern.exec(content)) !== null) {
      specifiers.add(matched[1])
    }
  }
  return [...specifiers]
}

/** 把 import specifier 归一化为仓库相对模块路径（去扩展名）；包名返回 null。 */
function resolveImportSpecifier(
  fileRel: string,
  specifier: string
): string | null {
  let candidate: string
  if (specifier.startsWith("@/")) {
    candidate = `apps/web/src/${specifier.slice(2)}`
  } else if (specifier.startsWith("@workspace/ui/")) {
    candidate = `packages/ui/src/${specifier.slice("@workspace/ui/".length)}`
  } else if (specifier.startsWith("@workspace/web-core/")) {
    candidate = `packages/web-core/src/${specifier.slice("@workspace/web-core/".length)}`
  } else if (specifier.startsWith(".")) {
    candidate = path.posix.normalize(
      path.posix.join(path.posix.dirname(fileRel), specifier)
    )
  } else {
    return null
  }
  return candidate.replace(/\.(js|jsx|ts|tsx)$/, "")
}

/** 全部特性「整体删除」的文件 / 目录路径（仓库相对）。 */
function collectAllDeletedPaths(): string[] {
  const deletedPaths: string[] = []
  for (const id of FEATURE_IDS) {
    const files = featureManifest(id).files
    deletedPaths.push(
      ...(files.web ?? []),
      ...(files.api ?? []),
      ...(files.shared ?? [])
    )
  }
  return deletedPaths
}

/** 归一化 import 目标是否指向某个已删除文件 / 目录。 */
function isReferenceToDeleted(
  resolved: string,
  deletedPaths: readonly string[]
): boolean {
  return deletedPaths.some((deletedPath) => {
    const modulePath = deletedPath.replace(/\.(ts|tsx|js|jsx)$/, "")
    return resolved === modulePath || resolved.startsWith(`${modulePath}/`)
  })
}

/** 扫描源码中「import 了已删除模块」的残留引用。 */
function findResidualImportReferences(
  root: string,
  deletedPaths: readonly string[]
): string[] {
  const violations: string[] = []
  for (const rel of collectSourceFiles(root, { includeTests: true })) {
    const content = fs.readFileSync(path.join(root, rel), "utf8")
    for (const specifier of extractImportSpecifiers(content)) {
      const resolved = resolveImportSpecifier(rel, specifier)
      if (resolved && isReferenceToDeleted(resolved, deletedPaths)) {
        violations.push(`${rel} → ${specifier}`)
      }
    }
  }
  return violations
}

const NOTIFICATION_DOC_REGION_FILES = [
  "AGENTS.md",
  "README.md",
  ".agents/skills/business-feature-builder/references/advanced-patterns.md",
  ".agents/skills/business-feature-builder/SKILL.md",
  "docs/specs/_template.md",
]

describe("真实模板区块标注一致性", () => {
  it("每个特性至少有一个 feature:<id> 区块，且所有 regionFiles 区块配对合法", () => {
    for (const id of FEATURE_IDS) {
      const regionId = featureRegionId(id)
      const files = featureManifest(id).regionFiles.filter((rel) =>
        fileExists(REPO_ROOT, rel)
      )
      expect(files.length).toBeGreaterThan(0)

      let matched = 0
      for (const rel of files) {
        // listRegions 对不配对 / 自嵌套会抛 RegionParseError
        const regions = listRegions(readFile(REPO_ROOT, rel))
        if (regions.includes(regionId)) matched += 1
      }
      expect(matched).toBeGreaterThan(0)
    }
  })

  it("通知特性在 AI 指引 / 文档中均有 Markdown 区块", () => {
    for (const rel of NOTIFICATION_DOC_REGION_FILES) {
      expect(fileExists(REPO_ROOT, rel)).toBe(true)
      expect(listRegions(readFile(REPO_ROOT, rel))).toContain(
        "feature:notification"
      )
    }
  })

  it("API / seed-dev 集成点已标注 feature:notification 区块", () => {
    for (const rel of [
      "apps/api/src/index.ts",
      "apps/api/src/db.ts",
      "apps/api/scripts/seed-dev.ts",
    ]) {
      expect(listRegions(readFile(REPO_ROOT, rel))).toContain(
        "feature:notification"
      )
    }
    // env.ts / .env.example 已无通知专属配置（演示数据由建库来源决定），
    // 不再需要 feature 区块 —— 反向断言防止清单或源码再次漂移。
    expect(FEATURES.notification.regionFiles).not.toContain(
      "apps/api/src/env.ts"
    )
    expect(FEATURES.notification.regionFiles).not.toContain(".env.example")
  })

  it("审计文档区块已标注（advanced-patterns 范式四标杆参考）", () => {
    // notification.regionFiles 里也曾列过 env.test.ts，但该文件实际没有通知区块
    // （多标），已从清单移除 —— 用反向断言防止清单再次漂移。
    expect(FEATURES.notification.regionFiles).not.toContain(
      "apps/api/src/env.test.ts"
    )

    const advancedPatterns =
      ".agents/skills/business-feature-builder/references/advanced-patterns.md"
    expect(FEATURES["audit-log"].regionFiles).toContain(advancedPatterns)
    expect(listRegions(readFile(REPO_ROOT, advancedPatterns))).toContain(
      "feature:audit-log"
    )
  })
})

describe("真实模板副本：全特性剥离", () => {
  it("monorepo 副本剥离全部特性后无残留标记，Tier 0 内核保留、各切片消失", () => {
    const root = copyRealTemplate()

    const result = stripFeatures({
      root,
      webRoot: "apps/web/src",
      remove: [...FEATURE_IDS],
    })

    // 清单文件全部存在（模板标注与清单没有 drift）
    expect(
      result.warnings.filter((warning) => warning.includes("清单文件不存在"))
    ).toEqual([])
    expect(result.selfDeleted.sort()).toEqual([...SELF_FILES].sort())

    // 无任何 feature:* 标记残留
    expect(findFeatureMarkers(root, collectFeatureSurface(root))).toEqual([])

    // Tier 0 保留
    expect(fileExists(root, "apps/api/src/modules/log/log.route.ts")).toBe(true)
    expect(fileExists(root, "apps/api/src/modules/log/log.service.ts")).toBe(
      true
    )
    expect(fileExists(root, "apps/api/src/shared/notification.ts")).toBe(true)
    expect(fileExists(root, "apps/api/src/shared/notification-bus.ts")).toBe(
      true
    )
    expect(fileExists(root, "packages/shared/src/notification.ts")).toBe(true)
    expect(fileExists(root, "packages/ui/src/lib/theme-color-a11y.test.ts")).toBe(
      true
    )

    // 通知后端 / UI 切片消失
    expect(fileExists(root, "apps/api/src/modules/notification")).toBe(false)
    expect(fileExists(root, "apps/api/src/db/demo-seed.ts")).toBe(false)
    expect(
      fileExists(root, "apps/web/src/components/shared/NotificationCenter.tsx")
    ).toBe(false)
    expect(
      fileExists(
        root,
        "apps/web/src/components/layout/TopBarNotificationSlot.tsx"
      )
    ).toBe(false)
    expect(
      fileExists(root, "apps/web/src/hooks/queries/useNotifications.ts")
    ).toBe(false)
    expect(fileExists(root, "apps/web/src/lib/notification-a11y.test.ts")).toBe(
      false
    )

    // audit-log UI 切片消失，后端 /logs 保留
    expect(fileExists(root, "apps/web/src/pages/audit-log")).toBe(false)
    expect(
      fileExists(root, "apps/web/src/components/shared/AuditDiffViewer.tsx")
    ).toBe(false)
    expect(fileExists(root, "apps/web/src/hooks/queries/useLogs.ts")).toBe(
      false
    )

    // demo 切片消失 + DashboardPage 占位
    expect(
      fileExists(root, "apps/web/src/pages/ComponentsOverviewPage.tsx")
    ).toBe(false)
    expect(fileExists(root, "apps/web/src/pages/sections")).toBe(false)
    expect(fileExists(root, "apps/web/src/pages/DataPage.tsx")).toBe(false)
    expect(readFile(root, "apps/web/src/pages/DashboardPage.tsx")).toContain(
      "Welcome to your new project!"
    )
    expect(
      readFile(root, "apps/web/src/pages/DashboardPage.tsx")
    ).not.toContain("recharts")

    // 注册点 / 文档 / env
    const app = readFile(root, "apps/web/src/App.tsx")
    expect(app).toContain("DashboardPage")
    expect(app).not.toContain("AuditLogPage")
    expect(app).not.toContain("NotificationsPage")
    expect(app).not.toContain("ComponentsOverviewPage")
    expect(app).toContain("ProfileSettingsPage")

    const menu = readFile(root, "apps/web/src/lib/menu-config.ts")
    expect(menu).toContain("仪表盘")
    expect(menu).not.toContain("Showcase")
    expect(menu).not.toContain("审计日志")
    expect(menu).not.toContain("消息通知")

    expect(readFile(root, "AGENTS.md")).not.toContain("消息通知内核")
    expect(readFile(root, "AGENTS.md")).not.toContain("AuditDiffViewer")
    expect(readFile(root, "AGENTS.md")).not.toContain("演示数据由建库来源决定")
    expect(readFile(root, "README.md")).not.toContain("消息通知后端")
    expect(readFile(root, ".env.example")).not.toContain("feature:")

    // seed-dev 集成点：通知种子「调用」已随区块移除，用户种子仍在。
    // import 语句按设计书 §3.3 不打区块，由 install 后的 imports:prune 清理
    // （post-prune 的静态残留检查见「剥离后残留引用静态检查」用例）。
    const seedDev = readFile(root, "apps/api/scripts/seed-dev.ts")
    expect(seedDev).not.toContain("seedDemoNotifications(")
    expect(seedDev).toContain("seedDevData")
    expect(fileExists(root, "apps/api/scripts/reset-db.ts")).toBe(true)

    // 自清理：features/tests 删除、engine 保留、package.json 引用清理
    expect(fileExists(root, "scripts/features.ts")).toBe(false)
    expect(fileExists(root, "scripts/strip-features.ts")).toBe(false)
    expect(fileExists(root, "scripts/lib/code-regions.ts")).toBe(true)
    const pkg = JSON.parse(readFile(root, "package.json")) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts["lint:scripts"]).not.toContain("scripts/features.ts")
    expect(pkg.scripts["lint:scripts"]).not.toContain(
      "scripts/strip-features.ts"
    )
    expect(pkg.scripts["lint:scripts"]).toContain(
      "scripts/prune-unused-imports.ts"
    )
  })

  it("flat 布局副本：web 重映射到 frontend/src，api / shared 端自动跳过", () => {
    const root = createTempDir("strip-features-real-flat-")
    fs.cpSync(
      path.join(REPO_ROOT, "apps", "web", "src"),
      path.join(root, "frontend", "src"),
      {
        recursive: true,
      }
    )
    for (const rel of [
      "AGENTS.md",
      "README.md",
      ".env.example",
      ...SELF_FILES,
      "scripts/lib/code-regions.ts",
      "scripts/lib/long-file-ratchet.ts",
    ]) {
      const source = path.join(REPO_ROOT, rel)
      if (!fs.existsSync(source)) continue
      const destination = path.join(root, rel)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.copyFileSync(source, destination)
    }
    stripTemplateOnlyRegions(root)

    const result = stripFeatures({
      root,
      webRoot: "frontend/src",
      remove: [...FEATURE_IDS],
    })

    expect(fs.existsSync(path.join(root, "apps"))).toBe(false)
    expect(result.deleted.length).toBeGreaterThan(0)
    for (const rel of result.deleted) {
      expect(rel.startsWith("frontend/src/")).toBe(true)
    }
    expect(result.deleted).toContain("frontend/src/pages/audit-log")
    expect(result.deleted).toContain("frontend/src/pages/NotificationsPage.tsx")
    expect(fileExists(root, "frontend/src/hooks/usePagedList.test.ts")).toBe(
      true
    )
    expect(readFile(root, "frontend/src/pages/DashboardPage.tsx")).toContain(
      "Welcome to your new project!"
    )
    expect(
      readFile(root, "frontend/src/components/layout/TopBar.tsx")
    ).not.toContain("<TopBarNotificationSlot />")

    const surface = collectFeatureSurface(root)
    expect(surface.length).toBeGreaterThan(0)
    expect(findFeatureMarkers(root, surface)).toEqual([])
  })
})

describe("真实模板：feature 标记 ↔ regionFiles 清单对账", () => {
  it("每个 feature:<id> 标记所在文件都列在对应特性的 regionFiles", () => {
    const violations: string[] = []
    for (const rel of collectFeatureSurface(REPO_ROOT)) {
      const regions = listRegions(readFile(REPO_ROOT, rel))
      for (const regionId of new Set(
        regions.filter((id) => id.startsWith("feature:"))
      )) {
        const featureId = regionId.slice("feature:".length)
        if (!(FEATURE_IDS as readonly string[]).includes(featureId)) {
          violations.push(`${rel}: 未知特性标记 ${regionId}`)
          continue
        }
        const manifest = featureManifest(featureId as FeatureId)
        const listed = manifest.regionFiles.some(
          (candidate) => remapWebPath(candidate, "apps/web/src") === rel
        )
        if (!listed) {
          violations.push(`${rel}: ${regionId} 未列入 ${featureId}.regionFiles`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it("regionFiles 列出的现存文件必须真的包含对应 feature 标记（防清单多标）", () => {
    const violations: string[] = []
    for (const id of FEATURE_IDS) {
      for (const candidate of featureManifest(id).regionFiles) {
        const rel = remapWebPath(candidate, "apps/web/src")
        // 目标项目缺少该端 / 文件不存在时跳过（异构模板与未来文件）
        if (!fileExists(REPO_ROOT, rel)) continue
        if (
          !listRegions(readFile(REPO_ROOT, rel)).includes(featureRegionId(id))
        ) {
          violations.push(`${rel}: 缺少 ${featureRegionId(id)}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})

describe("真实模板副本：剥离后残留引用静态检查（设计书 §8）", () => {
  it("全特性剥离 + imports:prune 后：无指向已删模块的 import、无标记残留、目录不复活", () => {
    const root = copyRealTemplate()
    const result = stripFeatures({
      root,
      webRoot: "apps/web/src",
      remove: [...FEATURE_IDS],
    })

    // 先做 scaffold install 后会做的 import 剪枝，再检查「静态不可达」
    const modifiedTsFiles = result.modified.filter(
      (rel) => /\.(ts|tsx)$/.test(rel) && fs.existsSync(path.join(root, rel))
    )
    pruneUnusedImportsInFiles(root, modifiedTsFiles)

    const deletedPaths = collectAllDeletedPaths().filter(
      (rel) => !result.replaced.includes(rel)
    )
    expect(findResidualImportReferences(root, deletedPaths)).toEqual([])

    // C-FIX-1 回归：`modules/notification` 内曾有 demo regionFile，整目录删除后不得被写回
    expect(fileExists(root, "apps/api/src/modules/notification")).toBe(false)
    expect(
      fileExists(
        root,
        "apps/api/src/modules/notification/notification.route.ts"
      )
    ).toBe(false)
    expect(fileExists(root, "apps/api/src/db/demo-seed.ts")).toBe(false)

    // 无 feature:* 标记残留；Tier 0 的 /logs 内核保留
    expect(findFeatureMarkers(root, collectSourceFiles(root))).toEqual([])
    expect(fileExists(root, "apps/api/src/modules/log/log.route.ts")).toBe(true)
  })
})

describe("真实模板副本：仅剥离 demo（notification 保留）", () => {
  it("notification 切片完整保留，且后端不再引用已删除的 /components/notifications 路由", () => {
    const root = copyRealTemplate()
    stripFeatures({ root, webRoot: "apps/web/src", remove: ["demo"] })

    // notification UI + 后端切片保留（demo 只删 demo 页面与 demo 路由入口）
    for (const rel of [
      "apps/api/src/modules/notification/notification.route.ts",
      "apps/api/src/modules/notification/notification.service.ts",
      "apps/api/src/modules/notification/notification.route.test.ts",
      "apps/api/src/db/demo-seed.ts",
      "apps/api/src/db/demo-seed.test.ts",
      "apps/api/src/shared/notification.ts",
      "apps/web/src/components/layout/TopBarNotificationSlot.tsx",
      "apps/web/src/components/shared/NotificationCenter.tsx",
      "apps/web/src/hooks/queries/useNotifications.ts",
      "apps/web/src/services/notifications.ts",
    ]) {
      expect(fileExists(root, rel)).toBe(true)
    }

    // demo 前端切片消失，DashboardPage 被替换
    expect(
      fileExists(root, "apps/web/src/pages/ComponentsOverviewPage.tsx")
    ).toBe(false)
    expect(fileExists(root, "apps/web/src/pages/sections")).toBe(false)
    expect(readFile(root, "apps/web/src/pages/DashboardPage.tsx")).toContain(
      "Welcome to your new project!"
    )
    expect(readFile(root, "apps/web/src/App.tsx")).not.toContain(
      "/components/notifications"
    )

    // R1 修复点：保留的 notification 后端源码（非测试）不再指向已删 demo 路由
    const danglingRouteRefs = collectSourceFiles(root)
      .map((rel) => ({ rel, content: readFile(root, rel) }))
      .filter(({ content }) => content.includes("/components/notifications"))
      .map(({ rel }) => rel)
    expect(danglingRouteRefs).toEqual([])

    // 非 demo 的真实页面 href（/dashboard、/settings）仍保留在种子里
    expect(readFile(root, "apps/api/src/db/demo-seed.ts")).toContain(
      'href: "/dashboard"'
    )
  })
})
