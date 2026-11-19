// Tier 1 系统可选特性清单（template-only，剥离后由 strip-features.ts 自清理）。
//
// 设计依据：模板仓库设计书 §5 + 实施计划 §5（两者都不随脚手架分发）。
//
// 本文件只做「声明」，不含任何逻辑：
//   - files：整体删除的文件 / 目录（目录按递归删除），按端划分；目标项目缺少该端时自动跳过；
//   - regionFiles：需要执行区块剥离的文件（含 Markdown / dotenv 文档）；路径一律「模板仓库相对」，
//     flat 项目由 strip-features.ts 把 `apps/web/src/` 前缀重映射到 --web-root；
//   - replaceFiles：剥离后写入精简占位内容的文件（demo 的 DashboardPage 是替换而非删除）。
//
// 归属规则（设计书 §2.1 / §5.3）：
//   - Tier 0 常驻：apps/api/src/modules/log（/logs 只读 API）、audit:view 权限、audit_logs 表、
//     shared/notification.ts 写入内核、notification-bus、packages/shared/notification.ts、
//     notifications 表 —— 都不在本清单里；
//   - 同一文件可以被多个特性同时列出（交集：App.tsx / menu-config.ts / query-keys.ts /
//     ComponentsOverviewPage.tsx / NotificationsPage.tsx）。代码交集用区块「特性嵌套」表达
//     （外层 feature:demo、内层 feature:notification），整文件删除则直接重复列出即可。

/** 按端划分的整体删除列表。 */
export interface FeatureFileGroups {
  /** apps/web/src 下的文件 / 目录（flat 项目重映射到 --web-root） */
  web?: string[]
  /** apps/api 下的文件 / 目录（目标项目没有 apps/api 时跳过） */
  api?: string[]
  /** packages/shared 下的文件 / 目录（目标项目没有 packages 时跳过） */
  shared?: string[]
}

/** 按端划分的「整体替换为占位内容」列表：key 为文件路径，value 为完整文件内容。 */
export interface FeatureReplaceGroups {
  /** apps/web/src 下的文件（flat 项目重映射到 --web-root） */
  web?: Record<string, string>
  /** apps/api 下的文件（目标项目没有 apps/api 时跳过） */
  api?: Record<string, string>
  /** packages/shared 下的文件（目标项目没有 packages 时跳过） */
  shared?: Record<string, string>
}

export interface FeatureManifest {
  /** 整体删除的文件 / 目录，按端划分；目标项目缺少该端时自动跳过 */
  files: FeatureFileGroups
  /** 需执行 stripRegions / unwrapRegions 的文件（相对仓库根，含 Markdown / dotenv 文档） */
  regionFiles: string[]
  /** 剥离后需写入精简占位内容的文件 */
  replaceFiles?: FeatureReplaceGroups
}

/**
 * demo 剥离后的 DashboardPage 占位页。
 *
 * 模板 DashboardPage 依赖 `pages/sections/*` 演示块，但根路由 `/` 与 `/dashboard` 仍需指向
 * 该页面（设计书 §5.4-1），因此不能删除只能替换。内容沿用旧 scaffold 的 clean placeholder。
 */
const CLEAN_DASHBOARD_PAGE = `export default function DashboardPage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4 font-h1">Welcome to your new project!</h1>
      <p className="text-[var(--lg-text-muted)]">This is a clean workspace scaffolded from Liquid Glass Starter.</p>
    </div>
  )
}
`

/** 特性 id 的稳定顺序（CLI 校验 / 遍历 / 报告都用它）。 */
export const FEATURE_IDS = ["audit-log", "notification", "demo"] as const

export type FeatureId = (typeof FEATURE_IDS)[number]

/**
 * Tier 1 特性清单。
 *
 * 新增 / 删除模板文件时：只改这里，scaffold 不再维护针对模板源码的正则。
 */
export const FEATURES = {
  // ── feature:audit-log（审计查看器 UI 切片；后端 /logs 与审计内核保留）──────────
  "audit-log": {
    files: {
      web: [
        "apps/web/src/pages/audit-log",
        "apps/web/src/components/shared/AuditDiffViewer.tsx",
        "apps/web/src/components/shared/AuditDiffViewer.test.tsx",
        "apps/web/src/lib/audit-diff.ts",
        "apps/web/src/lib/audit-diff.test.ts",
        "apps/web/src/services/logs.ts",
        "apps/web/src/services/logs.test.ts",
        "apps/web/src/hooks/queries/useLogs.ts",
        "apps/web/src/hooks/queries/useLogs.test.tsx",
      ],
    },
    regionFiles: [
      "apps/web/src/App.tsx",
      "apps/web/src/lib/menu-config.ts",
      "apps/web/src/lib/menu-config.test.ts",
      "apps/web/src/lib/query-keys.ts",
      "AGENTS.md",
      "README.md",
      // 范式四「标杆参考」中的审计日志引用（已标注 feature:audit-log）。
      ".agents/skills/business-feature-builder/references/advanced-patterns.md",
    ],
  },

  // ── feature:notification（通知 UI 切片 + SSE + /notifications API + 演示种子）────
  notification: {
    files: {
      web: [
        "apps/web/src/components/layout/TopBarNotificationSlot.tsx",
        "apps/web/src/components/shared/NotificationCenter.tsx",
        "apps/web/src/components/shared/NotificationCenter.test.tsx",
        "apps/web/src/components/shared/NotificationBell.tsx",
        "apps/web/src/components/shared/NotificationBell.test.tsx",
        "apps/web/src/components/shared/NotificationPanel.tsx",
        "apps/web/src/components/shared/NotificationPanel.test.tsx",
        "apps/web/src/components/shared/NotificationContent.tsx",
        "apps/web/src/components/shared/NotificationContent.test.tsx",
        "apps/web/src/components/shared/notification-config.ts",
        "apps/web/src/hooks/queries/useNotifications.ts",
        "apps/web/src/hooks/queries/useNotifications.test.tsx",
        "apps/web/src/hooks/queries/useNotificationStream.ts",
        "apps/web/src/hooks/queries/useNotificationStream.test.tsx",
        "apps/web/src/services/notifications.ts",
        "apps/web/src/services/notifications.test.ts",
        "apps/web/src/lib/notification-adapter.ts",
        "apps/web/src/lib/notification-adapter.test.ts",
        // 拆分后仅剩「通知配色」断言的 a11y 测试随特性删除（主题色断言已迁到
        // theme-color-a11y.test.ts，保留）。
        "apps/web/src/lib/notification-a11y.test.ts",
        "apps/web/src/lib/demo-notifications.ts",
        "apps/web/src/hooks/useDemoNotifications.ts",
        "apps/web/src/hooks/useDemoNotifications.test.ts",
        "apps/web/src/pages/NotificationsPage.tsx",
      ],
      api: [
        "apps/api/src/modules/notification",
        "apps/api/src/db/demo-seed.ts",
        "apps/api/src/db/demo-seed.test.ts",
      ],
      // Tier 0 写入内核（api shared/notification.ts、notification-bus.ts、packages/shared/
      // notification.ts、notifications 表）保留，故 shared 段为空 —— 不列出。
    },
    regionFiles: [
      // web 宿主 / 注册点
      "apps/web/src/components/layout/TopBar.tsx",
      "apps/web/src/lib/query-keys.ts",
      "apps/web/src/App.tsx",
      "apps/web/src/lib/menu-config.ts",
      "apps/web/src/pages/ComponentsOverviewPage.tsx",
      // api 挂载 / 种子（env.ts 已无通知专属配置、.env.example 已无演示变量，
      // 因此两者都不再需要 feature 区块）
      "apps/api/src/index.ts",
      "apps/api/src/db.ts",
      // seed-dev.ts 的 seedDemoNotifications() 调用与 import：demo-seed.ts 随特性删除，
      // 若不清除会让生成项目的 `db:seed-dev` / `db:reset` 运行期 import 失败。
      "apps/api/scripts/seed-dev.ts",
      // AI 指引与文档
      "AGENTS.md",
      "README.md",
      ".agents/skills/business-feature-builder/references/advanced-patterns.md",
      ".agents/skills/business-feature-builder/SKILL.md",
      "docs/specs/_template.md",
    ],
  },

  // ── feature:demo（组件画廊 + 错误兜底页 demo 路由；Tier 0 错误页保留）──────────
  demo: {
    files: {
      web: [
        "apps/web/src/pages/ComponentsOverviewPage.tsx",
        // DashboardPage 先删后由 replaceFiles 写入精简占位（二者在同一清单内，执行顺序保证）
        "apps/web/src/pages/DashboardPage.tsx",
        "apps/web/src/pages/DataPage.tsx",
        "apps/web/src/pages/FormsPage.tsx",
        "apps/web/src/pages/FoundationsPage.tsx",
        "apps/web/src/pages/OverlaysPage.tsx",
        "apps/web/src/pages/ResultPage.tsx",
        "apps/web/src/pages/SystemSettingsPage.tsx",
        "apps/web/src/pages/VirtualTableDemoPage.tsx",
        "apps/web/src/pages/NotificationsPage.tsx",
        "apps/web/src/pages/sections",
        "apps/web/src/lib/demo-notifications.ts",
        "apps/web/src/hooks/useDemoNotifications.ts",
        "apps/web/src/hooks/useDemoNotifications.test.ts",
      ],
    },
    regionFiles: [
      "apps/web/src/App.tsx",
      "apps/web/src/lib/menu-config.ts",
      "apps/web/src/lib/menu-config.test.ts",
      "apps/web/src/pages/ComponentsOverviewPage.tsx",
      // 后端 demo 种子的 href 指向前端 demo 路由：demo 剥离后这些路由已删除，
      // 若 notification 保留则种子消息会跳到 404。仅剥离 href 行，通知内核保留。
      // 注意 demo-seed.ts 同时是 notification.files.api 的删除项：notification 剥离时
      // 整文件删除，regionFiles 处理会因「文件已被删除」而自动 skip。
      "apps/api/src/db/demo-seed.ts",
      // seed-dev 的 demo / viewer 演示账号随 demo 特性剥离（admin 种子保留）。
      "apps/api/scripts/seed-dev.ts",
    ],
    replaceFiles: {
      web: {
        "apps/web/src/pages/DashboardPage.tsx": CLEAN_DASHBOARD_PAGE,
      },
    },
  },
} satisfies Record<FeatureId, FeatureManifest>
