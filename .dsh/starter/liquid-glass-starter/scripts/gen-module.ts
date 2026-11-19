#!/usr/bin/env bun
/**
 * gen:module — 业务模块生成器（Batch 6.1）
 *
 * 一条命令生成跨 shared / api / web 的标准业务模块骨架，并完成所有注册点接线：
 *
 *   # 模式 A（默认）：标准服务端分页 CRUD 模块
 *   bun run gen:module --name contract --label "合同" --icon FileText
 *
 *   # 模式 B：轻量字典/分类模块（DataTable 全量拖拽重排 sortOrder）
 *   bun run gen:module --name category --label "分类" --icon Tag --mode sortable
 *
 * 生成的文件（<name> 为 kebab-case，如 purchase-order）：
 *   packages/shared/src/<name>.ts                              wire 契约（Zod + 类型）
 *   apps/api/src/modules/<name>/<name>.service.ts              业务 + 声明式审计
 *   apps/api/src/modules/<name>/<name>.route.ts                薄 handler
 *   apps/api/src/modules/<name>/<name>.route.test.ts           API 集成测试
 *   apps/web/src/services/<name>.ts                            API 调用封装
 *   apps/web/src/hooks/queries/use<Pascal>.ts                  TanStack Query hooks
 *   apps/web/src/pages/<name>/<Pascal>Page.tsx                 列表页
 *   apps/web/src/pages/<name>/components/<Pascal>FormDialog.tsx 新增/编辑弹窗
 *   apps/web/src/pages/<name>/hooks/use<Pascal>Form.ts          react-hook-form 表单 hook
 *   docs/specs/<name>.md                                       5 要素规格书（若已存在则保留不覆盖）
 *
 * 自动注册（文件内含 `[gen:module:*]` 锚点注释，生成器只在这些位置追加）：
 *   shared/permissions.ts（权限码 + 注册表）、shared/audit.ts（审计模块 + 标签 + 事件映射）、
 *   shared/index.ts（导出）、api/db/schema.ts（表）、api/src/index.ts（route 挂载）、
 *   web/lib/query-keys.ts（query key 工厂）、web/App.tsx（懒加载 + 路由）、
 *   web/lib/menu-config.ts（Business 分组菜单项，首次生成时创建分组）。
 *
 * 对称卸载（remove:module）：
 *   bun run remove:module --name contract        # 等价于 gen:module --remove
 *   8 个注册点注入的代码全部包裹在 `module:<name>` 代码区块内（菜单分组外层再包
 *   `gen:group:Business` 容器；import 一律不打区块）。卸载时对注册文件执行
 *   stripRegions(content, "module:<name>") + stripEmptyGroupRegions，再 imports:prune
 *   清理残留未使用导入，因此「生成 → 卸载」后注册文件逐字节还原。
 *   区块标记与 `[gen:module:*]` 锚点同级维护：勿删改标记行、勿把非本模块代码写进他人区块。
 *
 * 规则与边界：
 *   - 目标文件已存在且未传 --force 时整体中止；写盘后格式化 / 数据库同步失败会
 *     自动回滚本次文件改动（不留下半成品）；
 *   - 重复执行是幂等的：已注册的权限/审计/路由/菜单/query key 会跳过；
 *   - --force 只覆盖 9 个生成文件，不重写已登记的权限/审计/菜单/表结构：
 *     mode / label / icon 与已生成模块不一致时直接报错；
 *   - --label 拒绝会破坏 TS/JSX 语法的字符（引号 / 反引号 / 反斜杠 / 尖括号 /
 *     花括号 / 换行），中文标点与数字可用；
 *   - 生成骨架的字段（编码 / 名称 / 状态 / 描述）是占位，按 5 要素规格
 *     （实体字段 / 业务不变量 / 权限 / 审计 / 界面布局）替换后重跑数据库同步命令。
 *
 * 选项：
 *   --name <kebab>     模块名，必填，如 contract / purchase-order
 *   --label <中文>      模块中文名，必填，如 合同
 *   --icon <Lucide>    菜单图标，缺省 FileText（须为 lucide-react 导出的组件名）
 *   --mode <crud|sortable>  默认 crud；sortable = 字典类全量拖拽重排
 *   --remove           卸载模式：按区块剥离注册点 + 删除模块文件（等价 remove:module）
 *   --purge-spec       卸载时物理删除规格书（默认归档到 docs/specs/_archived/）
 *   --force            生成：覆盖已存在的生成文件；卸载：允许未提交改动 + 覆盖已有归档
 *   --dry-run          只打印将要创建/修改/删除的文件，不落盘
 *   --skip-format      跳过 prettier / eslint --fix（卸载时也跳过 imports:prune）
 *   --skip-db          跳过数据库结构同步
 *   -h, --help         打印本帮助
 *
 * 生成后自动执行：prettier + eslint --fix（统一代码风格/import 顺序），
 * 并按仓库形态同步数据库结构来源：
 *   模板仓库（存在 apps/api/init.sql）→ bun --filter api db:init:generate
 *   scaffold 生成项目（存在 drizzle 迁移）→ bun --filter api db:generate
 */
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

import { DEFAULT_WEB_APP_ID, readWebApps } from "./lib/web-apps"

// ─── 类型 ─────────────────────────────────────────────────────────────────────

/** 生成模式：crud = 服务端分页 CRUD；sortable = 全量字典 + 拖拽重排 */
export type ModuleMode = "crud" | "sortable"

/** CLI 原始选项（--name / --label 等，未校验） */
export interface GenModuleCliOptions {
  name: string
  label: string
  icon: string
  mode: ModuleMode
  /**
   * --icon / --mode 是否由用户显式传入。切片模式据此区分「缺省沿用后端域」与
   * 「显式覆盖」：缺省值（FileText / crud）不能当成用户意图，否则 sortable 模块
   * 的切片会被静默改成 crud、图标被静默换成 FileText。
   */
  iconExplicit: boolean
  modeExplicit: boolean
  /** 卸载模式（等价 remove:module）：按模块区块剥离注册文件并删除模块文件 */
  remove: boolean
  /**
   * 目标端 id（空 = 后端域 + 默认端切片，即历史行为）。
   * 非空时只操作该端的前端切片，后端域（契约/表/权限码/审计标签/规格书）不动。
   */
  app: string
  /** 卸载时物理删除规格书（默认归档到 docs/specs/_archived/） */
  purgeSpec: boolean
  /** 卸载该端全部模块切片（必须与 --app 同时使用；add:web 克隆后清场用） */
  allModules: boolean
  /** 全域卸载时允许连带拆掉非默认端的切片（破坏性操作的显式确认） */
  allApps: boolean
  force: boolean
  dryRun: boolean
  skipFormat: boolean
  skipDb: boolean
  help: boolean
}

/** 校验并派生后的模块规格（模板渲染唯一入参） */
export interface ModuleSpec {
  /** kebab-case 模块名，如 purchase-order */
  name: string
  /** 中文名，如 合同 */
  label: string
  /** lucide-react 图标组件名，如 FileText */
  icon: string
  mode: ModuleMode
  /** camelCase：purchaseOrder（变量/query key 用） */
  camel: string
  /** PascalCase：PurchaseOrder（组件/文件用） */
  pascal: string
  /** snake_case：purchase_order（表名基） */
  snake: string
  /** 表名（复数 snake）：purchase_orders */
  table: string
  /** 全大写下划线：PURCHASE_ORDER（权限码/审计常量用） */
  upper: string
  /** API 挂载路径（复数 kebab）：/purchase-orders */
  apiPath: string
  /** 复数 kebab：contracts / purchase-orders / categories */
  pluralKebab: string
  /** 复数 camel：contracts / purchaseOrders / categories */
  pluralCamel: string
  /** 复数 Pascal：Contracts / PurchaseOrders / Categories（列表 hook / 服务函数名用） */
  pluralPascal: string
  /** 前端路由/菜单路径（单数 kebab）：/purchase-order */
  routePath: string
  /** 审计模块名：purchase-order */
  auditModule: string
  permissionView: string
  permissionEdit: string
}

/** 待创建的文件 */
export interface GeneratedFile {
  /** 相对仓库根目录的路径 */
  relPath: string
  content: string
}

/** 注册点文件变更（before 为 null 表示新建文件） */
export interface FileChange {
  relPath: string
  before: string | null
  after: string
}

/** 生成器业务错误：打印给人看，不打印堆栈 */
export class GenModuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GenModuleError"
  }
}

// ─── 注册锚点 ─────────────────────────────────────────────────────────────────
// 这些注释在模板文件里各出现一次，生成器只在其附近追加内容；缺失说明文件被
// 手工改写过，直接报错而不是猜测位置（避免把注册内容写进错误的位置）。

export const MARKERS = {
  permissions: "// [gen:module:permissions]",
  permissionRegistry: "// [gen:module:permission-registry]",
  auditModules: "// [gen:module:audit-modules]",
  auditModuleLabels: "// [gen:module:audit-module-labels]",
  auditModuleEventTypes: "// [gen:module:audit-module-event-types]",
  apiRouteImports: "// [gen:module:api-route-imports]",
  apiRouteMounts: "// [gen:module:api-route-mounts]",
  appLazyImports: "// [gen:module:app-lazy-imports]",
  appRoutes: "[gen:module:app-routes]",
  queryKeys: "// [gen:module:query-keys]",
  menuGroups: "// [gen:module:menu-groups]",
  menuItems: "// [gen:module:menu-items]",
} as const

/** 菜单分组标签（首次生成时自动创建，后续模块追加到该分组） */
const MENU_GROUP_LABEL = "Business"

const STATUS_ENABLED = "enabled"
const STATUS_DISABLED = "disabled"

// ─── 命名派生 ─────────────────────────────────────────────────────────────────

/** kebab → camel：purchase-order → purchaseOrder */
export function toCamel(name: string): string {
  const parts = name.split("-")
  return parts
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join("")
}

/** kebab → Pascal：purchase-order → PurchaseOrder */
export function toPascal(name: string): string {
  const camel = toCamel(name)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

/** kebab → snake：purchase-order → purchase_order */
export function toSnake(name: string): string {
  return name.split("-").join("_")
}

/** kebab → 全大写下划线：purchase-order → PURCHASE_ORDER */
export function toUpperSnake(name: string): string {
  return toSnake(name).toUpperCase()
}

/**
 * 英文名词复数（只覆盖常见规则，够生成表名/路由；不规则名词请生成后手工改）：
 * contract → contracts / category → categories / box → boxes / match → matches
 */
export function pluralize(word: string): string {
  if (/(s|x|z|ch|sh)$/.test(word)) return word + "es"
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ies"
  return word + "s"
}

/** kebab 复数：只变换最后一段，purchase-order → purchase-orders */
export function pluralizeKebab(name: string): string {
  const index = name.lastIndexOf("-")
  if (index === -1) return pluralize(name)
  return name.slice(0, index + 1) + pluralize(name.slice(index + 1))
}

/** snake 复数：只变换最后一段，purchase_order → purchase_orders */
export function pluralizeSnake(snake: string): string {
  const index = snake.lastIndexOf("_")
  if (index === -1) return pluralize(snake)
  return snake.slice(0, index + 1) + pluralize(snake.slice(index + 1))
}

/** TS 字符串字面量（用户输入的中文标签等统一经此转义，避免引号注入） */
function quote(value: string): string {
  return JSON.stringify(value)
}

/** 按字母序渲染具名导入成员（去重：--icon 与页面内置图标同名时不能重复导入） */
export function renderNamedImports(names: string[]): string {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(", ")
}

/**
 * 判断文件中是否存在以 prefix 开头的独立行（trim 后比较）。
 *
 * 幂等判定不能用 content.includes：生成 sub-contract 后再生成 contract 时，
 * `SUB_CONTRACT_VIEW:` 会包含子串 `CONTRACT_VIEW:` 导致误判「已注册」。
 */
export function hasLineStartingWith(content: string, prefix: string): boolean {
  return content.split("\n").some((line) => line.trimStart().startsWith(prefix))
}

// ─── 模块规格校验/派生 ────────────────────────────────────────────────────────

const MODULE_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const ICON_NAME_RE = /^[A-Z][A-Za-z0-9]*$/

/**
 * 模板内置模块名 / 共享契约文件名 / 路由路径（禁止作为业务模块名生成，
 * 避免覆盖 starter 内置文件或与内置路由/审计类别冲突）。
 */
const RESERVED_MODULE_NAMES = new Set([
  // packages/shared/src 内置契约文件
  "index",
  "audit",
  "notification",
  "pagination",
  "permissions",
  "response",
  "user",
  // apps/api 内置模块与路由
  "auth",
  "health",
  "log",
  "logs",
  "notifications",
  "system",
  "users",
  // apps/web 内置页面与路由
  "audit-log",
  "dashboard",
  "forbidden",
  "login",
  "not-found",
  "result",
  "server-error",
  "settings",
])

/**
 * 校验原始选项并派生模块规格。
 *
 * 拒绝的输入都是「会让生成结果不可编译/不可审查」的形态：
 * name 必须是 kebab（决定文件名/标识符/权限码），label 不许换行或 JSDoc 结束符，
 * icon 必须是 PascalCase 的 lucide 导出名。
 */
export function buildSpec(options: {
  name?: string
  label?: string
  icon?: string
  mode?: string
  /**
   * 是否校验 label（默认 true）。
   * remove:module 不使用 label（卸载由区块驱动），但 name 可能超过 30 字符；
   * 此时传 false，跳过「必填 / 长度 / 语法字符」校验，避免把 name 当 label 误拒。
   */
  validateLabel?: boolean
}): ModuleSpec {
  const name = (options.name ?? "").trim()
  const label = (options.label ?? "").trim()
  const icon = (options.icon ?? "FileText").trim()
  const mode = (options.mode ?? "crud").trim()
  const validateLabel = options.validateLabel ?? true

  if (!name)
    throw new GenModuleError("缺少必填参数 --name（kebab-case，如 contract）")
  if (!MODULE_NAME_RE.test(name)) {
    throw new GenModuleError(
      "模块名必须是 kebab-case 且以字母开头：" +
        name +
        "（示例 contract / purchase-order）"
    )
  }
  if (RESERVED_MODULE_NAMES.has(name)) {
    throw new GenModuleError(
      "模块名 " + name + " 为模板内置保留名，请换一个业务模块名"
    )
  }
  if (validateLabel) {
    if (!label) {
      throw new GenModuleError('缺少必填参数 --label（中文模块名，如 "合同"）')
    }
    if (label.length > 30) {
      throw new GenModuleError("--label 最多 30 个字符")
    }
    // label 会进入 TS 字符串 / JSX 文本 / JSX 属性：拒绝会破坏代码语法的字符，
    // 生成器不做「猜测式转义」（JSX 文本与属性各有不同转义规则，统一拒绝更安全）。
    const unsafeLabelChar = [...label].find((ch) =>
      ['"', "'", "`", "\\", "<", ">", "{", "}", "\r", "\n"].includes(ch)
    )
    if (unsafeLabelChar !== undefined) {
      throw new GenModuleError(
        "--label 不能包含引号 / 反斜杠 / 反引号 / 尖括号 / 花括号 / 换行：" +
          JSON.stringify(unsafeLabelChar)
      )
    }
    if (label.includes("*/")) {
      throw new GenModuleError("--label 不能包含 */（会截断 JSDoc 注释）")
    }
  }
  if (!ICON_NAME_RE.test(icon)) {
    throw new GenModuleError(
      "--icon 必须是 lucide-react 的组件名（PascalCase，如 FileText / Tag）"
    )
  }
  if (mode !== "crud" && mode !== "sortable") {
    throw new GenModuleError("--mode 只支持 crud 或 sortable：" + mode)
  }

  const snake = toSnake(name)
  const camel = toCamel(name)
  const pascal = toPascal(name)
  const pluralKebab = pluralizeKebab(name)
  return {
    name,
    label,
    icon,
    mode,
    camel,
    pascal,
    snake,
    table: pluralizeSnake(snake),
    upper: toUpperSnake(name),
    apiPath: "/" + pluralKebab,
    pluralKebab,
    pluralCamel: toCamel(pluralKebab),
    pluralPascal: toPascal(pluralKebab),
    routePath: "/" + name,
    auditModule: name,
    permissionView: name + ":view",
    permissionEdit: name + ":edit",
  }
}

// ─── 文件内容插入（纯函数，便于单测）────────────────────────────────────────

/** 锚点缺失 → 说明注册文件被大改过，报错并提示手工恢复锚点 */
function assertMarker(content: string, marker: string, fileLabel: string) {
  if (!content.includes(marker)) {
    throw new GenModuleError(
      fileLabel +
        " 缺少注册锚点 " +
        marker +
        "：请恢复该行注释（gen:module 依赖锚点定位，不会猜测插入位置）"
    )
  }
}

/** 在锚点所在行之后插入代码块（锚点行保持不动，块以换行结尾） */
export function insertAfterMarker(
  content: string,
  marker: string,
  block: string,
  fileLabel = "目标文件"
): string {
  assertMarker(content, marker, fileLabel)
  const markerIndex = content.indexOf(marker)
  const lineEnd = content.indexOf("\n", markerIndex)
  if (lineEnd === -1) {
    throw new GenModuleError(fileLabel + " 锚点所在行格式异常：" + marker)
  }
  return content.slice(0, lineEnd + 1) + block + content.slice(lineEnd + 1)
}

/** 在锚点所在行之前插入代码块（锚点行保持不动） */
export function insertBeforeMarker(
  content: string,
  marker: string,
  block: string,
  fileLabel = "目标文件"
): string {
  assertMarker(content, marker, fileLabel)
  const markerIndex = content.indexOf(marker)
  const lineStart = content.lastIndexOf("\n", markerIndex) + 1
  return content.slice(0, lineStart) + block + content.slice(lineStart)
}

/**
 * 在锚点前插入代码，但跳过锚点前的空行：插到「锚点前最后一个非空行」之后。
 *
 * 用于 `[gen:module:api-route-imports]` 这类位于 import 块之后、与 import 块之间隔着
 * 空行的锚点：直接把 import 插在锚点行前会形成「空行 + import + 锚点注释」的独立分组，
 * eslint simple-import-sort 会把 import 移回主 import 块并吞掉分隔空行，导致
 * remove:module 删掉 import 后锚点前空行丢失、注册文件无法逐字节还原。
 * 插在最后一个非空行（即 import 块末尾）之后，排序只影响 import 行本身。
 */
export function insertBeforeMarkerSkippingBlank(
  content: string,
  marker: string,
  block: string,
  fileLabel = "目标文件"
): string {
  assertMarker(content, marker, fileLabel)
  const markerIndex = content.indexOf(marker)
  let insertAt = content.lastIndexOf("\n", markerIndex) + 1
  while (insertAt > 0) {
    const previousLineEnd = insertAt - 1
    const previousLineStart = content.lastIndexOf("\n", previousLineEnd - 1) + 1
    if (content.slice(previousLineStart, previousLineEnd).trim() !== "") break
    insertAt = previousLineStart
  }
  return content.slice(0, insertAt) + block + content.slice(insertAt)
}

/** 文件末尾追加段落（空行 + 注释 + 内容），保持与既有段落的分隔 */
export function appendSection(content: string, section: string): string {
  const base = content.replace(/\s+$/, "")
  return base + "\n\n" + section.replace(/\s+$/, "") + "\n"
}

// ─── lucide 图标校验（尽力而为）───────────────────────────────────────────────
// 生成器先按 PascalCase 形态校验；若 web 依赖已安装，再读 lucide-react 类型声明
// 确认图标真实存在，把「跑 typecheck 才发现拼错图标名」提前到生成阶段。

let lucideIconNames: Set<string> | null = null

/**
 * 解析 lucide-react 的类型声明路径。
 *
 * 不同版本的 package.json 字段形态不同（实测 v1.67 用 `typings`，无顶层 `types`；
 * 也兼容 `types` 与 `exports["."].types`），漏掉字段会让图标校验静默失效。
 */
function resolveLucideTypesPath(pkgPath: string, pkg: unknown): string | null {
  const manifest = pkg as {
    types?: string
    typings?: string
    exports?: Record<string, unknown>
  }
  const exportEntry = manifest.exports?.["."]
  const exportTypes =
    typeof exportEntry === "object" && exportEntry !== null
      ? ((exportEntry as { types?: string }).types ?? null)
      : null
  const typesRel = manifest.typings ?? manifest.types ?? exportTypes
  if (!typesRel) return null
  const typesPath = path.resolve(path.dirname(pkgPath), typesRel)
  return existsSync(typesPath) ? typesPath : null
}

/** 读取 lucide-react 导出图标名集合；依赖未安装时返回 null（跳过严格校验） */
export function getLucideIconNames(repoRoot: string): Set<string> | null {
  if (lucideIconNames) return lucideIconNames
  const candidates = [
    path.join(repoRoot, "apps/web/node_modules/lucide-react/package.json"),
    path.join(repoRoot, "node_modules/lucide-react/package.json"),
  ]
  for (const pkgPath of candidates) {
    if (!existsSync(pkgPath)) continue
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
      const typesPath = resolveLucideTypesPath(pkgPath, pkg)
      if (!typesPath) continue
      const dts = readFileSync(typesPath, "utf8")
      const names = new Set<string>()
      const re = /declare const ([A-Za-z0-9]+): LucideIcon/g
      let match: RegExpExecArray | null = re.exec(dts)
      while (match) {
        names.add(match[1])
        match = re.exec(dts)
      }
      if (names.size > 0) {
        lucideIconNames = names
        return names
      }
    } catch {
      // 类型声明不可读时跳过严格校验（不阻塞生成）
    }
  }
  return null
}

/** 校验图标名；web 依赖未安装时只做形态校验 */
export function assertIconExists(icon: string, repoRoot: string): void {
  const names = getLucideIconNames(repoRoot)
  if (!names) return
  if (!names.has(icon)) {
    throw new GenModuleError(
      "图标 " +
        icon +
        " 不是 lucide-react 导出的组件名。可选的常用图标：FileText / Tag / Package / Layers"
    )
  }
}

// ─── CLI 参数解析 ─────────────────────────────────────────────────────────────

export const HELP_TEXT = `gen:module — 业务模块生成器 / 卸载器

用法：
  bun run gen:module --name <kebab> --label <中文> [选项]
  bun run remove:module --name <kebab> [选项]        # 等价 gen:module --name <kebab> --remove

生成模式必填：
  --name <kebab>     模块名（kebab-case，如 contract / purchase-order）
  --label <中文>      模块中文名（如 合同）

生成选项：
  --icon <Lucide>    菜单图标组件名，默认 FileText
  --mode <mode>      crud（默认，服务端分页 CRUD）| sortable（字典 + 拖拽重排）
  --app <id>         只在该端生成前端切片（后端域必须已存在，见下方「多端」）
  --force            覆盖已存在的生成文件
  --dry-run          只打印将创建/修改的文件，不落盘
  --skip-format      跳过 prettier / eslint --fix
  --skip-db          跳过数据库结构同步（init.sql / drizzle 迁移）
  -h, --help         打印本帮助

卸载模式（--remove；只要求 --name，label/icon/mode 无需传入）：
  --remove           按 module:<name> 区块剥离注册文件并删除模块专属文件
  --app <id>         只拆该端的前端切片，后端域与规格书保留
  --all-modules      拆掉该端全部模块切片（必须与 --app 同时使用）
  --all-apps         全域卸载时允许连带拆掉非默认端的切片（必须显式确认）
  --purge-spec       物理删除规格书（默认归档到 docs/specs/_archived/<name>.md）
  --force            允许相关文件存在未提交改动；允许覆盖已存在的归档规格书
  --dry-run          只打印将删除的文件 / 将剥离的区块，不落盘
  --skip-format      跳过 imports:prune / prettier / eslint --fix
  --skip-db          跳过数据库结构同步（模板 init.sql 自动重建；生成项目只提示）

多端生命周期（后端域只注册一次，前端切片按端生成）：
  后端域 = shared 契约 / Drizzle 表 / api service+route / 权限码 / 审计标签 / 规格书
  前端切片 = pages / services / hooks / query-keys / 路由 / 菜单（每端各一份）
  --app 指定的端必须已在 web-apps.json 注册，且后端域必须已存在（否则报错并给配方）；
  label / icon 可按端覆盖（只影响本端文案与菜单），mode 必须与后端域一致。

示例：
  bun run gen:module --name contract --label "合同" --icon FileText
  bun run gen:module --name category --label "分类" --icon Tag --mode sortable
  bun run gen:module --name contract --app portal        # 复用后端域，只造 portal 切片
  bun run remove:module --name contract --dry-run
  bun run remove:module --name contract --app portal     # 只拆 portal 切片
  bun run remove:module --app portal --all-modules       # 清空 portal 全部切片
`

/** 布尔 flag 的显式取值：只接受 true/false，避免 `--force=false` 被当成 true */
function parseBooleanFlagValue(flag: string, value: string): boolean {
  if (value === "true") return true
  if (value === "false") return false
  throw new GenModuleError(
    "布尔参数 " + flag + " 只接受 true/false，收到：" + value
  )
}

const BOOLEAN_FLAGS = new Set([
  "--remove",
  "--purge-spec",
  "--all-modules",
  "--all-apps",
  "--force",
  "--dry-run",
  "--skip-format",
  "--skip-db",
  "-h",
  "--help",
])

/** 解析 CLI 参数（不校验业务取值，校验在 buildSpec / removeModule） */
export function parseArgs(argv: string[]): GenModuleCliOptions {
  const options: GenModuleCliOptions = {
    name: "",
    label: "",
    icon: "FileText",
    mode: "crud",
    iconExplicit: false,
    modeExplicit: false,
    remove: false,
    app: "",
    purgeSpec: false,
    allModules: false,
    allApps: false,
    force: false,
    dryRun: false,
    skipFormat: false,
    skipDb: false,
    help: false,
  }

  const valueFlags = new Set(["--name", "--label", "--icon", "--mode", "--app"])

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index]
    const eqIndex = rawArg.indexOf("=")
    const flag = eqIndex === -1 ? rawArg : rawArg.slice(0, eqIndex)
    const inlineValue = eqIndex === -1 ? null : rawArg.slice(eqIndex + 1)

    if (flag === "-h" || flag === "--help") {
      options.help = true
      continue
    }
    if (BOOLEAN_FLAGS.has(flag)) {
      const enabled =
        inlineValue === null ? true : parseBooleanFlagValue(flag, inlineValue)
      if (flag === "--remove") options.remove = enabled
      if (flag === "--purge-spec") options.purgeSpec = enabled
      if (flag === "--all-modules") options.allModules = enabled
      if (flag === "--all-apps") options.allApps = enabled
      if (flag === "--force") options.force = enabled
      if (flag === "--dry-run") options.dryRun = enabled
      if (flag === "--skip-format") options.skipFormat = enabled
      if (flag === "--skip-db") options.skipDb = enabled
      continue
    }
    if (!valueFlags.has(flag)) {
      throw new GenModuleError("未知参数 " + rawArg + "（--help 查看用法）")
    }
    const value = inlineValue ?? argv[index + 1]
    if (
      value === undefined ||
      (inlineValue === null && value.startsWith("--"))
    ) {
      throw new GenModuleError("参数 " + flag + " 缺少取值")
    }
    if (inlineValue === null) index += 1
    if (flag === "--name") options.name = value
    if (flag === "--label") options.label = value
    if (flag === "--icon") {
      options.icon = value
      options.iconExplicit = true
    }
    if (flag === "--mode") {
      options.mode = value as ModuleMode
      options.modeExplicit = true
    }
    if (flag === "--app") options.app = value
  }

  return options
}

// ─── 模板渲染：shared 契约 ────────────────────────────────────────────────────

/** shared/<name>.ts —— wire schema + 表单/查询契约（api/web 单一事实源） */
export function renderSharedSchema(spec: ModuleSpec): string {
  const { pascal, upper, label } = spec

  const listQueryBlock =
    spec.mode === "sortable"
      ? ""
      : `
// ─── 列表查询契约（服务端分页 + 状态筛选；HTTP query string 空值按未传处理）────

export const ${pascal}ListQueryBaseSchema = PageQueryBaseSchema.pick({
  page: true,
  pageSize: true,
  keyword: true,
}).extend({
  status: z.enum(${upper}_STATUS_OPTIONS).optional(),
})

export const ${pascal}ListQuerySchema = z.preprocess(
  stripBlankQueryValues,
  ${pascal}ListQueryBaseSchema
)

export type ${pascal}ListQuery = z.infer<typeof ${pascal}ListQueryBaseSchema>
`

  const sortableFields =
    spec.mode === "sortable"
      ? `  sortOrder: z.number().int(),
`
      : ""

  // 分页契约只在 crud 模式使用；sortable 全量列表不引入 pagination，避免 unused import
  const paginationImport =
    spec.mode === "crud"
      ? `import { PageQueryBaseSchema, stripBlankQueryValues } from "./pagination.js"\n`
      : ""

  const reorderBlock =
    spec.mode === "sortable"
      ? `
// ─── 拖拽重排契约（PUT /${pluralizeKebab(spec.name)}/reorder 入参）───────────────

export const ${pascal}ReorderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, "排序列表不能为空"),
})

export type ${pascal}ReorderInput = z.infer<typeof ${pascal}ReorderSchema>
`
      : ""

  return `/**
 * ${label} — 前后端共享契约（gen:module 生成；5 要素第 1 项：核心实体与字段）
 *
 * 单一事实源：api 的 route/service 与 web 的表单校验都从这里取 schema / 类型。
 * 修改字段后：同步 apps/api/src/db/schema.ts，再按仓库形态重跑
 * \`bun --filter api db:init:generate\`（模板仓库）或 \`bun --filter api db:generate\`
 * （scaffold 生成项目），否则 migrate:check 会失败。
 */
import { z } from "zod"

${paginationImport}
// ─── 状态枚举（DB 存英文值，中文仅 UI 展示）─────────────────────────────────

export const ${upper}_STATUS = {
  ENABLED: ${quote(STATUS_ENABLED)},
  DISABLED: ${quote(STATUS_DISABLED)},
} as const

export type ${pascal}Status =
  (typeof ${upper}_STATUS)[keyof typeof ${upper}_STATUS]

export const ${upper}_STATUS_LABELS: Record<${pascal}Status, string> = {
  enabled: "启用",
  disabled: "停用",
}

export const ${upper}_STATUS_OPTIONS = [
  "enabled",
  "disabled",
] as const satisfies readonly ${pascal}Status[]

// ─── wire 契约（接口响应行）─────────────────────────────────────────────────

export const ${pascal}Schema = z.object({
  id: z.number().int().positive(),
  ${spec.mode === "sortable" ? "" : "code: z.string(),\n  "}name: z.string(),
  status: z.enum(${upper}_STATUS_OPTIONS),
  description: z.string().nullable(),
${sortableFields}  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ${pascal} = z.infer<typeof ${pascal}Schema>

// ─── 表单契约（POST/PUT 入参；web 表单校验复用同一份 schema）────────────────

export const ${pascal}FormSchema = z.object({
  ${spec.mode === "sortable" ? "" : 'code: z.string().trim().min(1, "请输入编码").max(50, "编码最多 50 个字符"),\n  '}name: z.string().trim().min(1, "请输入名称").max(100, "名称最多 100 个字符"),
  status: z.enum(${upper}_STATUS_OPTIONS),
  description: z.string().trim().max(200, "描述最多 200 个字符").optional(),
})

export type ${pascal}Form = z.infer<typeof ${pascal}FormSchema>
${listQueryBlock}${reorderBlock}`
}

// ─── 模板渲染：API service（crud 模式）───────────────────────────────────────

function renderCrudApiService(spec: ModuleSpec): string {
  const { pascal, pluralPascal, upper, label, table } = spec
  return `/**
 * ${pascal} 服务层 — ${label}管理（gen:module 生成；5 要素第 2/4 项：业务不变量 + 审计）
 *
 * 约定：
 * - 写操作首参统一 OpCtx；领域错误继承 ServiceError，由 route 的 mapServiceError 转 HTTP
 * - CRUD 审计走 shared/audited-crud.ts 的声明式包装器（${upper}_AUDIT_CONFIG 内联在本文件顶部）
 * - 唯一性冲突 → 409；目标不存在 → 404；route 只做参数校验/鉴权/响应映射
 */
import { and, count, desc, eq, sql } from "drizzle-orm"
import {
  AUDIT_MODULES,
  type ${pascal},
  type ${pascal}Form,
  type ${pascal}ListQuery,
  type ${pascal}Status,
  type PagedResult,
} from "shared"

import { getDrizzle } from "../../db.js"
import { ${table} } from "../../db/schema.js"
import {
  auditedDelete,
  auditedInsert,
  auditedUpdate,
  type TableAuditConfig,
} from "../../shared/audited-crud.js"
import type { OpCtx } from "../../shared/op-context.js"
import { ServiceError } from "../../shared/service-error.js"

// ─── 审计配置（fieldLabels 决定审计 changes 的中文 key）─────────────────────

export const ${upper}_AUDIT_CONFIG: TableAuditConfig = {
  module: AUDIT_MODULES.${upper},
  fieldLabels: {
    code: "编码",
    name: "名称",
    status: "状态",
    description: "描述",
  },
  excludeColumns: ["createdAt", "updatedAt"],
  snapshotColumns: ["code", "name", "status", "description"],
}

// ─── 错误类型（code 供前端按错误类型分支，status 决定 HTTP 码）───────────────

export class ${pascal}NotFoundError extends ServiceError {
  constructor() {
    super(${quote(label + "不存在")}, 404, ${quote(upper + "_NOT_FOUND")})
    this.name = "${pascal}NotFoundError"
  }
}

export class ${pascal}CodeConflictError extends ServiceError {
  constructor(code: string) {
    super(${quote(label + "编码")} + "「" + code + "」已存在", 409, ${quote(upper + "_CODE_EXISTS")})
    this.name = "${pascal}CodeConflictError"
  }
}

// ─── 行类型 / 转换 ──────────────────────────────────────────────────────────

type ${pascal}Row = typeof ${table}.$inferSelect

/** DB 行 → wire：status 列是 text，收窄到 shared 的枚举类型（脏值由前端 schema 兜底） */
function toWire${pascal}(row: ${pascal}Row): ${pascal} {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status as ${pascal}Status,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** LIKE 通配符转义（配合 ESCAPE '\\'，防用户输入 % / _ 扩大匹配范围） */
function escapeLike(value: string): string {
  return value.replace(/[\\\\%_]/g, (ch) => "\\\\" + ch)
}

/** 空串 / 纯空白描述统一落 null，避免 DB 出现两种空值语义 */
function normalizeDescription(description: string | undefined): string | null {
  const value = description?.trim()
  return value ? value : null
}

// ─── Service 方法 ───────────────────────────────────────────────────────────

/** 列表：关键字（编码/名称）+ 状态筛选，服务端分页，固定 updatedAt 倒序 */
export function list${pluralPascal}(
  query: ${pascal}ListQuery
): PagedResult<${pascal}> {
  const db = getDrizzle()
  const conditions = []

  if (query.status) conditions.push(eq(${table}.status, query.status))
  if (query.keyword) {
    const pattern = "%" + escapeLike(query.keyword) + "%"
    conditions.push(
      sql\`
        \${${table}.code} LIKE \${pattern} ESCAPE '\\\\'
        OR \${${table}.name} LIKE \${pattern} ESCAPE '\\\\'
      \`
    )
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const total =
    db.select({ value: count() }).from(${table}).where(where).get()?.value ?? 0

  const rows = db
    .select()
    .from(${table})
    .where(where)
    // updatedAt 同毫秒多行时用 id 兜底全序，避免 offset 分页下重复/漏行
    .orderBy(desc(${table}.updatedAt), desc(${table}.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
    .all()

  return {
    items: rows.map(toWire${pascal}),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(total / query.pageSize),
  }
}

/** 新增：编码唯一性校验（409）→ insert → 声明式审计 snapshot */
export function create${pascal}(ctx: OpCtx, input: ${pascal}Form): ${pascal} {
  const db = getDrizzle()
  const conflict = db
    .select({ id: ${table}.id })
    .from(${table})
    .where(eq(${table}.code, input.code))
    .get()
  if (conflict) throw new ${pascal}CodeConflictError(input.code)

  const now = new Date().toISOString()
  const row = db
    .insert(${table})
    .values({
      code: input.code,
      name: input.name,
      status: input.status,
      description: normalizeDescription(input.description),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()!
  const record = toWire${pascal}(row)

  auditedInsert({
    row: record,
    ctx,
    config: ${upper}_AUDIT_CONFIG,
    meta: {
      target: record.name,
      targetId: String(record.id),
      detail: ${quote("新增" + spec.label + "：")} + record.name,
    },
  })

  return record
}

/** 更新：不存在 → 404；编码变更时查重 → 409；changes 只记录实际变更列 */
export function update${pascal}(
  ctx: OpCtx,
  id: number,
  input: ${pascal}Form
): ${pascal} {
  const db = getDrizzle()
  const existing = db
    .select()
    .from(${table})
    .where(eq(${table}.id, id))
    .get()
  if (!existing) throw new ${pascal}NotFoundError()

  if (input.code !== existing.code) {
    const conflict = db
      .select({ id: ${table}.id })
      .from(${table})
      .where(eq(${table}.code, input.code))
      .get()
    if (conflict) throw new ${pascal}CodeConflictError(input.code)
  }

  const patch = {
    code: input.code,
    name: input.name,
    status: input.status,
    description: normalizeDescription(input.description),
    updatedAt: new Date().toISOString(),
  }
  db.update(${table}).set(patch).where(eq(${table}.id, id)).run()

  auditedUpdate({
    before: existing,
    data: patch,
    ctx,
    config: ${upper}_AUDIT_CONFIG,
    meta: {
      target: input.name,
      targetId: String(id),
    },
  })

  return toWire${pascal}({ ...existing, ...patch })
}

/** 删除：不存在 → 404；删除前快照写审计（severity = warning） */
export function delete${pascal}(ctx: OpCtx, id: number): void {
  const db = getDrizzle()
  const existing = db
    .select()
    .from(${table})
    .where(eq(${table}.id, id))
    .get()
  if (!existing) throw new ${pascal}NotFoundError()

  db.delete(${table}).where(eq(${table}.id, id)).run()

  auditedDelete({
    before: existing,
    ctx,
    config: ${upper}_AUDIT_CONFIG,
    meta: {
      target: existing.name,
      targetId: String(id),
    },
  })
}
`
}

// ─── 模板渲染：API route（crud 模式）─────────────────────────────────────────

function renderCrudApiRoute(spec: ModuleSpec): string {
  const { pascal, pluralPascal, upper, label, apiPath } = spec
  return `/**
 * ${pascal} API 路由 — ${label}管理 CRUD（gen:module 生成，薄 handler）
 *
 * 端点：
 * - GET    ${apiPath}          列表（服务端分页 + 关键字/状态筛选，需 ${spec.permissionView}）
 * - POST   ${apiPath}          新增（需 ${spec.permissionEdit}）
 * - PUT    ${apiPath}/:id      更新（需 ${spec.permissionEdit}）
 * - DELETE ${apiPath}/:id      删除（需 ${spec.permissionEdit}）
 *
 * 约定：中间件链 authMiddleware → opCtxMiddleware；参数校验在 route，业务规则与
 * 审计在 ${spec.name}.service.ts（B2 门禁禁止 route 直连 DB）。
 */
import { Hono } from "hono"
import { PERMISSIONS, ${pascal}FormSchema, ${pascal}ListQuerySchema } from "shared"

import { authMiddleware } from "../../middleware/auth.js"
import { requirePermission } from "../../middleware/permission.js"
import { fail, ok } from "../../response.js"
import { opCtxMiddleware } from "../../shared/op-context.js"
import { mapServiceError } from "../../shared/service-error.js"
import { safeJson } from "../../utils/safe-json.js"
import { formatZodErrors } from "../../utils/validation.js"
import {
  create${pascal},
  delete${pascal},
  list${pluralPascal},
  update${pascal},
} from "./${spec.name}.service.js"

const ${spec.camel}Route = new Hono()

${spec.camel}Route.use("*", authMiddleware, opCtxMiddleware)

/** 路径参数 id：非正整数直接 400，避免 Number("abc") → NaN 传给 service */
function parseId(raw: string | undefined): number | null {
  if (!raw) return null
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

// ─── GET ${apiPath} — 列表（服务端分页）─────────────────────────────────────

${spec.camel}Route.get(
  "/",
  requirePermission(PERMISSIONS.${upper}_VIEW),
  (c) => {
    const parsed = ${pascal}ListQuerySchema.safeParse(c.req.query())
    if (!parsed.success) {
      return fail(
        c,
        400,
        "VALIDATION_ERROR",
        "请求参数校验失败",
        formatZodErrors(parsed)
      )
    }
    return ok(c, list${pluralPascal}(parsed.data))
  }
)

// ─── POST ${apiPath} — 新增 ─────────────────────────────────────────────────

${spec.camel}Route.post(
  "/",
  requirePermission(PERMISSIONS.${upper}_EDIT),
  async (c) => {
    const body = await safeJson(c)
    if (!body) {
      return fail(c, 400, "VALIDATION_ERROR", "请求体必须为有效 JSON")
    }
    const parsed = ${pascal}FormSchema.safeParse(body)
    if (!parsed.success) {
      return fail(
        c,
        400,
        "VALIDATION_ERROR",
        "请求参数校验失败",
        formatZodErrors(parsed)
      )
    }

    try {
      const record = create${pascal}(c.get("opCtx")!, parsed.data)
      return ok(c, { ${spec.camel}: record }, "创建成功", 201)
    } catch (err) {
      return mapServiceError(c, err)
    }
  }
)

// ─── PUT ${apiPath}/:id — 更新 ──────────────────────────────────────────────

${spec.camel}Route.put(
  "/:id",
  requirePermission(PERMISSIONS.${upper}_EDIT),
  async (c) => {
    const id = parseId(c.req.param("id"))
    if (id === null) {
      return fail(c, 400, "VALIDATION_ERROR", "ID 必须为正整数")
    }

    const body = await safeJson(c)
    if (!body) {
      return fail(c, 400, "VALIDATION_ERROR", "请求体必须为有效 JSON")
    }
    const parsed = ${pascal}FormSchema.safeParse(body)
    if (!parsed.success) {
      return fail(
        c,
        400,
        "VALIDATION_ERROR",
        "请求参数校验失败",
        formatZodErrors(parsed)
      )
    }

    try {
      const record = update${pascal}(c.get("opCtx")!, id, parsed.data)
      return ok(c, { ${spec.camel}: record }, "更新成功")
    } catch (err) {
      return mapServiceError(c, err)
    }
  }
)

// ─── DELETE ${apiPath}/:id — 删除 ───────────────────────────────────────────

${spec.camel}Route.delete(
  "/:id",
  requirePermission(PERMISSIONS.${upper}_EDIT),
  (c) => {
    const id = parseId(c.req.param("id"))
    if (id === null) {
      return fail(c, 400, "VALIDATION_ERROR", "ID 必须为正整数")
    }

    try {
      delete${pascal}(c.get("opCtx")!, id)
      return ok(c, undefined, "删除成功")
    } catch (err) {
      return mapServiceError(c, err)
    }
  }
)

export default ${spec.camel}Route
`
}

// ─── 模板渲染：API route 测试（crud 模式）────────────────────────────────────

function renderCrudApiTest(spec: ModuleSpec): string {
  const { pascal, upper, apiPath, camel } = spec
  return `/**
 * ${pascal} 模块接口测试（gen:module 生成）
 *
 * 覆盖：鉴权（401/403）、创建（201 + 审计）、唯一性冲突（409）、参数校验（400）、
 * 非法 JSON（400）、列表分页与关键字/状态筛选、更新（200 + 审计 / 409 / 404）、
 * 删除（200 + 审计 / 404）。每个用例独立一份内存库（beforeEach），可单独 -t 运行。
 *
 * 运行：cd apps/api && bun test src/modules/${spec.name}/
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { Hono } from "hono"
import jwt from "jsonwebtoken"

import { getDrizzle } from "../../db.js"
import { auditLogs } from "../../db/schema.js"
import { JWT_SECRET } from "../../middleware/auth.js"
import { setupTestDb } from "../../test-helpers.js"
import ${camel}Route from "./${spec.name}.route.js"

// ── Fixtures ────────────────────────────────────────────────────────────────

const ADMIN_PAYLOAD = {
  sub: "admin@test.local",
  username: "admin@test.local",
  role: "admin",
}
const USER_PAYLOAD = {
  sub: "user@test.local",
  username: "user@test.local",
  role: "user",
}

let app: Hono
let adminToken: string
let userToken: string

function signToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" })
}

beforeAll(() => {
  app = new Hono()
  app.route(${quote(apiPath)}, ${camel}Route)
  adminToken = signToken(ADMIN_PAYLOAD)
  userToken = signToken(USER_PAYLOAD)
})

// 每个用例独立一份内存库：避免用例间共享数据导致的顺序依赖
beforeEach(() => {
  setupTestDb()
})

interface RequestOptions {
  body?: unknown
  /** 原样发送的请求体（用于非法 JSON 用例） */
  rawBody?: string
  /** 传 null 模拟未认证请求 */
  token?: string | null
}

async function request(
  method: string,
  url: string,
  options: RequestOptions = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers["Content-Type"] = "application/json"
  }
  if (options.token !== null) {
    headers["Authorization"] = "Bearer " + (options.token ?? adminToken)
  }
  const res = await app.request(url, {
    method,
    headers,
    body:
      options.rawBody ??
      (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  })
  return { status: res.status, body: await res.json() }
}

const validForm = {
  code: "TEST-001",
  name: "测试记录A",
  status: "enabled",
  description: "生成器自带示例字段",
}

async function createOne(
  overrides: Partial<typeof validForm> = {}
): Promise<{ id: number; code: string; name: string }> {
  const res = await request("POST", ${quote(apiPath)}, {
    body: { ...validForm, ...overrides },
  })
  const data = res.body.data as {
    ${camel}: { id: number; code: string; name: string }
  }
  return data.${camel}
}

function moduleLogs() {
  return getDrizzle()
    .select()
    .from(auditLogs)
    .all()
    .filter((log) => log.module === ${quote(spec.auditModule)})
}

// ── 鉴权 ────────────────────────────────────────────────────────────────────

describe("鉴权", () => {
  it("GET 无 token → 401", async () => {
    const { status } = await request("GET", ${quote(apiPath)}, { token: null })
    expect(status).toBe(401)
  })

  it("GET 无 ${spec.permissionView} 权限 → 403", async () => {
    const { status, body } = await request("GET", ${quote(apiPath)}, {
      token: userToken,
    })
    expect(status).toBe(403)
    expect(body.success).toBe(false)
  })

  it("POST 无 token → 401", async () => {
    const { status } = await request("POST", ${quote(apiPath)}, {
      body: validForm,
      token: null,
    })
    expect(status).toBe(401)
  })

  it("POST 无 ${spec.permissionEdit} 权限 → 403", async () => {
    const { status } = await request("POST", ${quote(apiPath)}, {
      body: validForm,
      token: userToken,
    })
    expect(status).toBe(403)
  })
})

// ── 创建 ────────────────────────────────────────────────────────────────────

describe("POST ${apiPath}", () => {
  it("创建成功 → 201，返回 wire 行并写 create 审计（含中文快照）", async () => {
    const { status, body } = await request("POST", ${quote(apiPath)}, {
      body: validForm,
    })
    expect(status).toBe(201)
    const data = body.data as { ${camel}: Record<string, unknown> }
    expect(data.${camel}.code).toBe(validForm.code)
    expect(data.${camel}.id).toBeGreaterThan(0)

    const created = moduleLogs().find((log) => log.eventType === "create")
    expect(created).toBeTruthy()
    expect(created?.target).toBe(validForm.name)
    expect(created?.changes).toContain("snapshot")
  })

  it("缺少必填字段 → 400 + 字段级 errors", async () => {
    const { status, body } = await request("POST", ${quote(apiPath)}, {
      body: { code: "TEST-002" },
    })
    expect(status).toBe(400)
    expect(body.code).toBe("VALIDATION_ERROR")
    const errors = body.errors as Record<string, string>
    expect(errors.name).toBeTruthy()
  })

  it("请求体不是合法 JSON → 400", async () => {
    const { status, body } = await request("POST", ${quote(apiPath)}, {
      rawBody: "{not-json",
    })
    expect(status).toBe(400)
    expect(body.code).toBe("VALIDATION_ERROR")
  })

  it("编码重复 → 409 ${upper}_CODE_EXISTS", async () => {
    await createOne()
    const { status, body } = await request("POST", ${quote(apiPath)}, {
      body: { ...validForm, name: "另一个名字" },
    })
    expect(status).toBe(409)
    expect(body.code).toBe(${quote(upper + "_CODE_EXISTS")})
  })
})

// ── 列表 ────────────────────────────────────────────────────────────────────

describe("GET ${apiPath}", () => {
  it("默认分页：page=1 / pageSize=20，返回分页结构", async () => {
    await createOne({ code: "TEST-001", name: "记录A" })
    await createOne({ code: "TEST-002", name: "记录B" })
    const { status, body } = await request("GET", ${quote(apiPath)})
    expect(status).toBe(200)
    const data = body.data as {
      items: Array<Record<string, unknown>>
      total: number
      page: number
      pageSize: number
      totalPages: number
    }
    expect(data.items).toHaveLength(2)
    expect(data.page).toBe(1)
    expect(data.pageSize).toBe(20)
    expect(data.total).toBe(2)
    expect(data.totalPages).toBe(1)
  })

  it("page / pageSize 组合切页", async () => {
    await createOne({ code: "TEST-001", name: "记录A" })
    await createOne({ code: "TEST-002", name: "记录B" })
    await createOne({ code: "TEST-003", name: "记录C" })

    const first = await request("GET", ${quote(apiPath + "?page=1&pageSize=2")})
    const second = await request("GET", ${quote(apiPath + "?page=2&pageSize=2")})
    const firstData = first.body.data as {
      items: unknown[]
      totalPages: number
    }
    const secondData = second.body.data as { items: unknown[] }
    expect(firstData.items).toHaveLength(2)
    expect(firstData.totalPages).toBe(2)
    expect(secondData.items).toHaveLength(1)
  })

  it("keyword 同时匹配编码与名称", async () => {
    await createOne({ code: "ALPHA-1", name: "阿尔法" })
    await createOne({ code: "BETA-1", name: "贝塔" })

    const byCode = await request("GET", ${quote(apiPath + "?keyword=ALPHA")})
    const byName = await request("GET", ${quote(apiPath + "?keyword=贝塔")})
    expect((byCode.body.data as { items: unknown[] }).items).toHaveLength(1)
    expect((byName.body.data as { items: unknown[] }).items).toHaveLength(1)
  })

  it("status 精确筛选", async () => {
    await createOne({ code: "TEST-001", name: "启用记录", status: "enabled" })
    await createOne({ code: "TEST-002", name: "停用记录", status: "disabled" })

    const { body } = await request("GET", ${quote(apiPath + "?status=disabled")})
    const data = body.data as { items: Array<{ code: string }>; total: number }
    expect(data.total).toBe(1)
    expect(data.items[0].code).toBe("TEST-002")
  })
})

// ── 更新 ────────────────────────────────────────────────────────────────────

describe("PUT ${apiPath}/:id", () => {
  it("非正整数 id → 400", async () => {
    const { status } = await request("PUT", ${quote(apiPath + "/abc")}, {
      body: validForm,
    })
    expect(status).toBe(400)
  })

  it("目标不存在 → 404 ${upper}_NOT_FOUND", async () => {
    const { status, body } = await request("PUT", ${quote(apiPath + "/99999")}, {
      body: validForm,
    })
    expect(status).toBe(404)
    expect(body.code).toBe(${quote(upper + "_NOT_FOUND")})
  })

  it("更新成功 → 200，审计 changes 记录变更列", async () => {
    const created = await createOne()
    const { status, body } = await request(
      "PUT",
      ${quote(apiPath + "/")} + created.id,
      { body: { ...validForm, name: "改名后的记录", status: "disabled" } }
    )
    expect(status).toBe(200)
    const data = body.data as { ${camel}: Record<string, unknown> }
    expect(data.${camel}.name).toBe("改名后的记录")
    expect(data.${camel}.status).toBe("disabled")

    const updated = moduleLogs().find((log) => log.eventType === "update")
    expect(updated).toBeTruthy()
    expect(updated?.changes).toContain("名称")
  })

  it("编码改成已存在值 → 409", async () => {
    const first = await createOne({ code: "TEST-001" })
    await createOne({ code: "TEST-002" })
    const { status, body } = await request(
      "PUT",
      ${quote(apiPath + "/")} + first.id,
      { body: { ...validForm, code: "TEST-002" } }
    )
    expect(status).toBe(409)
    expect(body.code).toBe(${quote(upper + "_CODE_EXISTS")})
  })
})

// ── 删除 ────────────────────────────────────────────────────────────────────

describe("DELETE ${apiPath}/:id", () => {
  it("删除成功 → 200 + delete 审计；再次删除 → 404", async () => {
    const created = await createOne()
    const first = await request("DELETE", ${quote(apiPath + "/")} + created.id)
    expect(first.status).toBe(200)

    const deleted = moduleLogs().find((log) => log.eventType === "delete")
    expect(deleted).toBeTruthy()

    const second = await request("DELETE", ${quote(apiPath + "/")} + created.id)
    expect(second.status).toBe(404)
  })

  it("非正整数 id → 400", async () => {
    const { status } = await request("DELETE", ${quote(apiPath + "/0")})
    expect(status).toBe(400)
  })
})
`
}

// ─── 模板渲染：web service / hooks / 表单 hook（crud 模式）───────────────────

function renderCrudWebService(spec: ModuleSpec): string {
  const { pascal, camel, apiPath } = spec
  return `/**
 * ${pascal} service — 封装 ${apiPath} CRUD 接口（gen:module 生成）
 *
 * 契约唯一事实源：packages/shared/src/${spec.name}.ts；统一响应信封
 * { success, message, data }，业务数据取 res.data.data。
 */
import type {
  ${pascal},
  ${pascal}Form,
  ${pascal}ListQuery,
  PagedResult,
} from "shared"

import { api } from "@workspace/web-core/lib/api"

/** 列表查询参数：复用 shared 的 query 契约（缺省按后端 page=1 / pageSize=20） */
export type ${pascal}ListParams = Partial<${pascal}ListQuery>

export const ${camel}Service = {
  list: async (
    params: ${pascal}ListParams = {}
  ): Promise<PagedResult<${pascal}>> => {
    const res = await api.get(${quote(apiPath)}, { params })
    return res.data.data
  },

  create: async (data: ${pascal}Form): Promise<${pascal}> => {
    const res = await api.post(${quote(apiPath)}, data)
    return res.data.data.${camel}
  },

  update: async (id: number, data: ${pascal}Form): Promise<${pascal}> => {
    const res = await api.put(${quote(apiPath + "/")} + id, data)
    return res.data.data.${camel}
  },

  remove: async (id: number): Promise<void> => {
    await api.delete(${quote(apiPath + "/")} + id)
  },
}
`
}

function renderCrudWebHooks(spec: ModuleSpec): string {
  const { pascal, pluralPascal, camel, label } = spec
  return `/**
 * ${pascal} 域 Query hooks — 服务端状态统一由 TanStack Query 管理（gen:module 生成）
 *
 * - 列表参数直接进 query key：筛选 / 翻页即新 key，翻页时 keepPreviousData 防闪空；
 * - 写操作成功后失效 ${camel}Keys.all；create / update 声明 silentError，由表单弹窗
 *   回填服务端字段错误并自行 toast，避免同一错误弹两次。
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ${pascal}Form } from "shared"

import { ${camel}Keys } from "@/lib/query-keys"
import {
  type ${pascal}ListParams,
  ${camel}Service,
} from "@/services/${spec.name}"

export interface Use${pluralPascal}Options {
  /** 无 ${spec.permissionView} 权限时可关闭请求，避免无意义 403 */
  enabled?: boolean
}

export function use${pluralPascal}(
  params: ${pascal}ListParams = {},
  options: Use${pluralPascal}Options = {}
) {
  const { enabled = true } = options
  return useQuery({
    queryKey: ${camel}Keys.list(params),
    queryFn: () => ${camel}Service.list(params),
    enabled,
    placeholderData: keepPreviousData,
    meta: { errorMessage: ${quote("加载" + label + "列表失败")} },
  })
}

export function useCreate${pascal}() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ${pascal}Form) => ${camel}Service.create(data),
    meta: { silentError: true },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ${camel}Keys.all }),
  })
}

export function useUpdate${pascal}() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: number; data: ${pascal}Form }) =>
      ${camel}Service.update(input.id, input.data),
    meta: { silentError: true },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ${camel}Keys.all }),
  })
}

export function useDelete${pascal}() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => ${camel}Service.remove(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ${camel}Keys.all }),
  })
}
`
}

function renderCrudFormHook(spec: ModuleSpec): string {
  const { pascal } = spec
  return `/**
 * use${pascal}Form — 表单共享 hook（gen:module 生成；react-hook-form + zod）
 *
 * 校验规则直接复用 shared 的 ${pascal}FormSchema（与后端契约单一事实源），
 * 新增 / 编辑弹窗通过 resetEmpty / resetFrom${pascal} 切换数据源。
 */
import { zodResolver } from "@hookform/resolvers/zod"
import { useCallback } from "react"
import { useForm } from "react-hook-form"
import type { ${pascal}, ${pascal}Form } from "shared"
import { ${pascal}FormSchema } from "shared"

/** 新增场景的初始值（状态默认启用） */
function makeEmptyValues(): ${pascal}Form {
  return {
    code: "",
    name: "",
    status: "enabled",
    description: "",
  }
}

/** 编辑场景：wire 行 → 表单值（null 描述收敛成空串，避免受控组件 warning） */
function toFormValues(record: ${pascal}): ${pascal}Form {
  return {
    code: record.code,
    name: record.name,
    status: record.status,
    description: record.description ?? "",
  }
}

export function use${pascal}Form() {
  const form = useForm<${pascal}Form>({
    resolver: zodResolver(${pascal}FormSchema),
    defaultValues: makeEmptyValues(),
    mode: "onSubmit",
  })

  const resetEmpty = useCallback(() => form.reset(makeEmptyValues()), [form])
  const resetFrom${pascal} = useCallback(
    (record: ${pascal}) => form.reset(toFormValues(record)),
    [form]
  )

  return { form, resetEmpty, resetFrom${pascal} }
}
`
}

// ─── 模板渲染：表单弹窗（crud 模式）─────────────────────────────────────────

function renderCrudFormDialog(spec: ModuleSpec): string {
  const { pascal, label } = spec
  return `/**
 * ${pascal}FormDialog — 新增/编辑${label}弹窗（gen:module 生成）
 *
 * - 桌面居中 Dialog / 移动底部 Sheet（ResponsiveDialog）；
 * - 校验复用 shared 的 ${pascal}FormSchema；服务端字段错误由 applyServerFieldErrors
 *   回填到对应字段，其余错误交给全局 mutation toast（hooks 已声明 silentError）。
 */
import { useEffect } from "react"
import type { ${pascal}, ${pascal}Status } from "shared"
import { ${spec.upper}_STATUS_LABELS, ${spec.upper}_STATUS_OPTIONS } from "shared"

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@workspace/ui/components/shared/ResponsiveDialog"
import { Button } from "@workspace/ui/components/ui/button"
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/ui/field"
import { Input } from "@workspace/ui/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/ui/select"
import { Textarea } from "@workspace/ui/components/ui/textarea"
import {
  useCreate${pascal},
  useUpdate${pascal},
} from "@/hooks/queries/use${pascal}"
import { extractErrorMessage } from "@workspace/web-core/lib/errors"
import { applyServerFieldErrors } from "@/lib/form-error"
import { showError, showSuccess } from "@workspace/web-core/lib/toast"

import { use${pascal}Form } from "../hooks/use${pascal}Form"

interface ${pascal}FormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 编辑目标；null 表示新增 */
  editing: ${pascal} | null
}

export function ${pascal}FormDialog({
  open,
  onOpenChange,
  editing,
}: ${pascal}FormDialogProps) {
  const { form, resetEmpty, resetFrom${pascal} } = use${pascal}Form()
  const create${pascal} = useCreate${pascal}()
  const update${pascal} = useUpdate${pascal}()
  const submitting = create${pascal}.isPending || update${pascal}.isPending

  // 打开弹窗时按「新增 / 编辑」重置表单数据源
  useEffect(() => {
    if (!open) return
    if (editing) resetFrom${pascal}(editing)
    else resetEmpty()
  }, [open, editing, resetEmpty, resetFrom${pascal}])

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      if (editing) {
        await update${pascal}.mutateAsync({ id: editing.id, data: values })
        showSuccess(${quote(label + "已更新")})
      } else {
        await create${pascal}.mutateAsync(values)
        showSuccess(${quote(label + "已创建")})
      }
      onOpenChange(false)
    } catch (err) {
      if (!applyServerFieldErrors(err, form.setError)) {
        showError(extractErrorMessage(err))
      }
    }
  })

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next)
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {editing ? ${quote("编辑" + label)} : ${quote("新增" + label)}}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            ${quote("带 * 的字段为必填；保存后写入审计日志。")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <Field>
            <FieldLabel htmlFor="${spec.name}-code">编码 *</FieldLabel>
            <Input
              id="${spec.name}-code"
              placeholder=${quote("唯一编码，如 HT-001")}
              aria-invalid={Boolean(form.formState.errors.code)}
              disabled={submitting}
              {...form.register("code")}
            />
            <FieldError>{form.formState.errors.code?.message}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="${spec.name}-name">名称 *</FieldLabel>
            <Input
              id="${spec.name}-name"
              placeholder=${quote("请输入" + label + "名称")}
              aria-invalid={Boolean(form.formState.errors.name)}
              disabled={submitting}
              {...form.register("name")}
            />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </Field>

          <Field>
            <FieldLabel>状态</FieldLabel>
            <Select
              value={form.watch("status")}
              disabled={submitting}
              onValueChange={(value) =>
                form.setValue("status", value as ${pascal}Status, {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {${spec.upper}_STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {${spec.upper}_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="${spec.name}-description">描述</FieldLabel>
            <Textarea
              id="${spec.name}-description"
              placeholder=${quote("可选，最多 200 个字符")}
              rows={3}
              disabled={submitting}
              {...form.register("description")}
            />
            <FieldError>{form.formState.errors.description?.message}</FieldError>
          </Field>

          {form.formState.errors.root ? (
            <p className="text-sm text-destructive">
              {form.formState.errors.root.message}
            </p>
          ) : null}

          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "保存中..." : "保存"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
`
}

// ─── 模板渲染：列表页（crud 模式）───────────────────────────────────────────

function renderCrudPage(spec: ModuleSpec): string {
  const { pascal, pluralPascal, upper, label } = spec
  const iconImports = renderNamedImports([
    spec.icon,
    "Pencil",
    "Plus",
    "Trash2",
  ])
  return `/**
 * ${pascal}Page — ${label}管理列表页（gen:module 生成）
 *
 * 生成骨架的 5 要素映射（实体字段 / 业务不变量 / 权限 / 审计 / 界面布局，
 * 改业务前先读 README「业务模块生成器」与 AGENTS.md）：
 * 1. 核心实体与字段 → packages/shared/src/${spec.name}.ts
 * 2. 业务不变量 → ${spec.name}.service.ts（编码唯一 409 / 不存在 404）
 * 3. 权限 → PERMISSIONS.${upper}_VIEW / ${upper}_EDIT（菜单 / 按钮 / 接口三层门控）
 * 4. 审计 → ${spec.name}.service.ts 的 ${upper}_AUDIT_CONFIG
 * 5. 界面交互 → FilterBar + DataTable + MobileCard + ${pascal}FormDialog（本文件）
 *
 * 约定：页面不直连 services（数据走 hooks/queries），不写死颜色（走语义 token）。
 */
import { ${iconImports} } from "lucide-react"
import { useMemo, useState } from "react"
import type { ${pascal}, ${pascal}Status } from "shared"
import {
  ${upper}_STATUS_LABELS,
  ${upper}_STATUS_OPTIONS,
  PERMISSIONS,
} from "shared"

import { ConfirmDialog } from "@workspace/ui/components/shared/ConfirmDialog"
import { type ColumnDef, DataTable } from "@workspace/ui/components/shared/DataTable"
import { DateCell } from "@workspace/ui/components/shared/DateCell"
import { FilterBar } from "@workspace/ui/components/shared/FilterBar"
import {
  MobileCard,
  MobileCardMeta,
  MobileCardTags,
  MobileCardTitle,
} from "@workspace/ui/components/shared/MobileCard"
import { NullableText } from "@workspace/ui/components/shared/NullableText"
import { PermissionGate } from "@workspace/web-core/components/shared/PermissionGate"
import { StatusBadge } from "@workspace/ui/components/shared/StatusBadge"
import { Badge } from "@workspace/ui/components/ui/badge"
import { Button } from "@workspace/ui/components/ui/button"
import { Input } from "@workspace/ui/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/ui/select"
import {
  use${pluralPascal},
  useDelete${pascal},
} from "@/hooks/queries/use${pascal}"
import { usePermission } from "@workspace/web-core/hooks/usePermission"
import { showSuccess } from "@workspace/web-core/lib/toast"
import type { ${pascal}ListParams } from "@/services/${spec.name}"

import { ${pascal}FormDialog } from "./components/${pascal}FormDialog"

/** 筛选下拉的「全部」哨兵值：空串会被 query 清洗逻辑丢掉，用显式常量更清晰 */
const ALL_FILTER = "__all__"
const PAGE_SIZE = 20

function statusBadge(status: ${pascal}Status) {
  return (
    <StatusBadge active={status === "enabled"}>
      {${upper}_STATUS_LABELS[status]}
    </StatusBadge>
  )
}

export default function ${pascal}Page() {
  const { can } = usePermission()
  const canView = can(PERMISSIONS.${upper}_VIEW)
  const canEdit = can(PERMISSIONS.${upper}_EDIT)

  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState("")
  const [statusFilter, setStatusFilter] = useState(ALL_FILTER)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<${pascal} | null>(null)
  const [deleting, setDeleting] = useState<${pascal} | null>(null)

  const queryParams = useMemo<${pascal}ListParams>(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      keyword: keyword.trim() || undefined,
      status:
        statusFilter === ALL_FILTER
          ? undefined
          : (statusFilter as ${pascal}Status),
    }),
    [page, keyword, statusFilter]
  )

  const { data, isLoading } = use${pluralPascal}(queryParams, { enabled: canView })
  const delete${pascal} = useDelete${pascal}()

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 0
  const isFiltered = keyword.trim() !== "" || statusFilter !== ALL_FILTER

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (row: ${pascal}) => {
    setEditing(row)
    setDialogOpen(true)
  }

  const handleDelete = () => {
    const target = deleting
    if (!target) return
    delete${pascal}.mutate(target.id, {
      onSuccess: () => {
        showSuccess(${quote("已删除：")} + target.name)
        setDeleting(null)
      },
      onError: () => setDeleting(null),
    })
  }

  const columns: ColumnDef<${pascal}>[] = [
    {
      header: "编码",
      width: "w-[140px]",
      render: (row) => <span className="font-mono text-xs">{row.code}</span>,
    },
    {
      header: "名称",
      width: "w-[180px]",
      render: (row) => (
        <span className="block max-w-[180px] truncate font-medium">
          {row.name}
        </span>
      ),
    },
    {
      header: "状态",
      width: "w-[90px]",
      render: (row) => statusBadge(row.status),
    },
    {
      header: "描述",
      width: "w-[240px]",
      render: (row) => (
        <span className="block max-w-[240px] truncate">
          <NullableText value={row.description} />
        </span>
      ),
    },
    {
      header: "更新时间",
      width: "w-[130px]",
      render: (row) => <DateCell value={row.updatedAt} />,
    },
    {
      header: "操作",
      width: "w-[150px]",
      render: (row) =>
        canEdit ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2"
              onClick={() => openEdit(row)}
            >
              <Pencil className="size-3.5" />
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2"
              style={{ color: "var(--lg-danger)" }}
              onClick={() => setDeleting(row)}
            >
              <Trash2 className="size-3.5" />
              删除
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">只读</span>
        ),
    },
  ]

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      <FilterBar
        search={
          <Input
            className="h-9 w-full md:w-56"
            placeholder="搜索编码 / 名称"
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value)
              setPage(1)
            }}
          />
        }
        activeFilterCount={statusFilter === ALL_FILTER ? 0 : 1}
      >
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>全部状态</SelectItem>
            {${upper}_STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {${upper}_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <PermissionGate perm={PERMISSIONS.${upper}_EDIT}>
        <Button size="sm" className="h-9 gap-1.5" onClick={openCreate}>
          <Plus className="size-4" />
          新增
        </Button>
      </PermissionGate>
    </div>
  )

  const header = (
    <div>
      <h1 className="font-heading text-2xl font-bold tracking-tight md:text-3xl">
        ${label}管理
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        维护${label}数据，支持关键字搜索、状态筛选与服务端分页
      </p>
    </div>
  )

  // 无查看权限：不发起请求，直接提示（菜单同样不可见，接口仍有后端 403 兜底）
  if (!canView) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {header}
        <div className="inset-card flex flex-col items-center gap-2 p-10 text-center">
          <${spec.icon} className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            当前账号没有查看${label}的权限（${spec.permissionView}）
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      {header}

      <DataTable<${pascal}>
        columns={columns}
        data={items}
        loading={isLoading}
        total={total}
        rowKey="id"
        emptyIcon={${spec.icon}}
        emptyTitle=${quote("暂无" + label)}
        emptyDescription=${quote("点击右上角「新增」创建第一条" + label + "记录")}
        isFiltered={isFiltered}
        pagination={{ currentPage: page, totalPages, onPageChange: setPage }}
        onMobileCardClick={(row) => {
          if (canEdit) openEdit(row)
        }}
        mobileCard={(row) => (
          <MobileCard>
            <MobileCardTitle title={row.name}>
              {statusBadge(row.status)}
            </MobileCardTitle>
            <MobileCardTags>
              <Badge variant="outline">{row.code}</Badge>
            </MobileCardTags>
            <MobileCardMeta>
              <span className="truncate">
                <NullableText value={row.description} />
              </span>
              <DateCell value={row.updatedAt} />
            </MobileCardMeta>
            {canEdit ? (
              <div className="flex items-center gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2"
                  onClick={(event) => {
                    event.stopPropagation()
                    openEdit(row)
                  }}
                >
                  <Pencil className="size-3.5" />
                  编辑
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2"
                  style={{ color: "var(--lg-danger)" }}
                  onClick={(event) => {
                    event.stopPropagation()
                    setDeleting(row)
                  }}
                >
                  <Trash2 className="size-3.5" />
                  删除
                </Button>
              </div>
            ) : null}
          </MobileCard>
        )}
        toolbar={toolbar}
      />

      <${pascal}FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null)
        }}
        title=${quote("删除" + label)}
        description={
          deleting
            ? ${quote("确定删除「")} + deleting.name + "」吗？删除后不可恢复。"
            : undefined
        }
        confirmLabel="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
`
}

// ─── 模板渲染：API service（sortable 字典模式）───────────────────────────────

function renderSortableApiService(spec: ModuleSpec): string {
  const { pascal, pluralPascal, upper, label, table, camel } = spec
  return `/**
 * ${pascal} 服务层 — ${label}管理（gen:module 生成；5 要素第 2/4 项：业务不变量 + 审计）
 *
 * 字典/分类模块约定：
 * - 列表全量返回并按 sortOrder 升序，不做服务端分页；
 * - 新增时 sortOrder 追加到末尾；拖拽重排一次提交全量 id 顺序，事务内逐行更新；
 * - 引用保护：删除前应检查业务表引用（本骨架未接业务表，在 delete 的 TODO 处补）。
 */
import { asc, desc, eq } from "drizzle-orm"
import {
  AUDIT_EVENT_TYPES,
  AUDIT_MODULES,
  type ${pascal},
  type ${pascal}Form,
  type ${pascal}Status,
} from "shared"

import { getDrizzle } from "../../db.js"
import { ${table} } from "../../db/schema.js"
import { createAuditor } from "../../shared/audit-log.js"
import {
  auditedDelete,
  auditedInsert,
  auditedUpdate,
  type TableAuditConfig,
} from "../../shared/audited-crud.js"
import type { OpCtx } from "../../shared/op-context.js"
import { ServiceError } from "../../shared/service-error.js"

// ─── 审计配置（fieldLabels 决定审计 changes 的中文 key）─────────────────────

export const ${upper}_AUDIT_CONFIG: TableAuditConfig = {
  module: AUDIT_MODULES.${upper},
  fieldLabels: {
    name: "名称",
    status: "状态",
    description: "描述",
  },
  excludeColumns: ["createdAt", "updatedAt", "sortOrder"],
  snapshotColumns: ["name", "status", "description"],
}

/** 非 CRUD 动作（拖拽重排）的模块级审计函数 */
const audit = createAuditor(AUDIT_MODULES.${upper})

// ─── 错误类型 ───────────────────────────────────────────────────────────────

export class ${pascal}NotFoundError extends ServiceError {
  constructor() {
    super(${quote(label + "不存在")}, 404, ${quote(upper + "_NOT_FOUND")})
    this.name = "${pascal}NotFoundError"
  }
}

export class ${pascal}NameConflictError extends ServiceError {
  constructor(name: string) {
    super(${quote(label + "名称")} + "「" + name + "」已存在", 409, ${quote(upper + "_NAME_EXISTS")})
    this.name = "${pascal}NameConflictError"
  }
}

/** 重排队列不合法（缺项 / 重复 / 未知 id）→ 400 */
export class ${pascal}ReorderInvalidError extends ServiceError {
  constructor(message = "排序列表必须包含全部记录且不重复") {
    super(message, 400, ${quote(upper + "_REORDER_INVALID")})
    this.name = "${pascal}ReorderInvalidError"
  }
}

// ─── 行类型 / 转换 ──────────────────────────────────────────────────────────

type ${pascal}Row = typeof ${table}.$inferSelect

function toWire${pascal}(row: ${pascal}Row): ${pascal} {
  return {
    id: row.id,
    name: row.name,
    status: row.status as ${pascal}Status,
    description: row.description,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** 空串 / 纯空白描述统一落 null，避免 DB 出现两种空值语义 */
function normalizeDescription(description: string | undefined): string | null {
  const value = description?.trim()
  return value ? value : null
}

// ─── Service 方法 ───────────────────────────────────────────────────────────

/** 全量列表（字典/下拉选项共用）；sortOrder 相同时按 id 兜底稳定排序 */
export function list${pluralPascal}(): ${pascal}[] {
  return getDrizzle()
    .select()
    .from(${table})
    .orderBy(asc(${table}.sortOrder), asc(${table}.id))
    .all()
    .map(toWire${pascal})
}

/** 新增：名称唯一性校验（409）→ sortOrder 追加到末尾 → 声明式审计 */
export function create${pascal}(
  ctx: OpCtx,
  input: ${pascal}Form
): ${pascal} {
  const db = getDrizzle()
  const conflict = db
    .select({ id: ${table}.id })
    .from(${table})
    .where(eq(${table}.name, input.name))
    .get()
  if (conflict) throw new ${pascal}NameConflictError(input.name)

  const last = db
    .select({ sortOrder: ${table}.sortOrder })
    .from(${table})
    .orderBy(desc(${table}.sortOrder))
    .limit(1)
    .get()
  const now = new Date().toISOString()

  const row = db
    .insert(${table})
    .values({
      name: input.name,
      status: input.status,
      description: normalizeDescription(input.description),
      sortOrder: (last?.sortOrder ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()!
  const record = toWire${pascal}(row)

  auditedInsert({
    row: record,
    ctx,
    config: ${upper}_AUDIT_CONFIG,
    meta: {
      target: record.name,
      targetId: String(record.id),
      detail: ${quote("新增" + spec.label + "：")} + record.name,
    },
  })

  return record
}

/** 更新：不存在 → 404；名称变更时查重 → 409（sortOrder 只由 reorder 维护） */
export function update${pascal}(
  ctx: OpCtx,
  id: number,
  input: ${pascal}Form
): ${pascal} {
  const db = getDrizzle()
  const existing = db
    .select()
    .from(${table})
    .where(eq(${table}.id, id))
    .get()
  if (!existing) throw new ${pascal}NotFoundError()

  if (input.name !== existing.name) {
    const conflict = db
      .select({ id: ${table}.id })
      .from(${table})
      .where(eq(${table}.name, input.name))
      .get()
    if (conflict) throw new ${pascal}NameConflictError(input.name)
  }

  const patch = {
    name: input.name,
    status: input.status,
    description: normalizeDescription(input.description),
    updatedAt: new Date().toISOString(),
  }
  db.update(${table}).set(patch).where(eq(${table}.id, id)).run()

  auditedUpdate({
    before: existing,
    data: patch,
    ctx,
    config: ${upper}_AUDIT_CONFIG,
    meta: { target: input.name, targetId: String(id) },
  })

  return toWire${pascal}({ ...existing, ...patch })
}

/** 删除：不存在 → 404；有业务引用时抛 400（引用保护，见 TODO） */
export function delete${pascal}(ctx: OpCtx, id: number): void {
  const db = getDrizzle()
  const existing = db
    .select()
    .from(${table})
    .where(eq(${table}.id, id))
    .get()
  if (!existing) throw new ${pascal}NotFoundError()

  // TODO(引用保护)：若其他业务表通过 ${camel}Id 引用本表，删除前先统计引用数并抛 400：
  // const refs = db
  //   .select({ id: bizTable.id })
  //   .from(bizTable)
  //   .where(eq(bizTable.${camel}Id, id))
  //   .limit(1)
  //   .all()
  // if (refs.length > 0) throw new ${pascal}InUseError()
  // 同时在下方错误类型区补 ${pascal}InUseError extends ServiceError（400）。

  db.delete(${table}).where(eq(${table}.id, id)).run()

  auditedDelete({
    before: existing,
    ctx,
    config: ${upper}_AUDIT_CONFIG,
    meta: { target: existing.name, targetId: String(id) },
  })
}

/**
 * 拖拽重排：入参必须是当前全量 id 的顺序排列（事务内逐行写 sortOrder）。
 * 校验失败 → 400；成功后写一条「排序调整」审计（非 CRUD 动作走 createAuditor）。
 */
export function reorder${pluralPascal}(ctx: OpCtx, ids: number[]): void {
  const db = getDrizzle()
  const existing = db.select({ id: ${table}.id }).from(${table}).all()
  const known = new Set(existing.map((row) => row.id))
  const duplicates = new Set<number>()
  for (const id of ids) {
    if (duplicates.has(id)) throw new ${pascal}ReorderInvalidError()
    duplicates.add(id)
  }
  if (ids.length !== existing.length || !ids.every((id) => known.has(id))) {
    throw new ${pascal}ReorderInvalidError()
  }

  const now = new Date().toISOString()
  db.transaction((tx) => {
    ids.forEach((id, index) => {
      tx.update(${table})
        .set({ sortOrder: index, updatedAt: now })
        .where(eq(${table}.id, id))
        .run()
    })
  })

  audit(ctx, {
    eventType: AUDIT_EVENT_TYPES.UPDATE,
    target: "排序调整",
    detail:
      ${quote("调整" + spec.label + "显示顺序（")} +
      ids.length +
      " 项）",
  })
}
`
}

// ─── 模板渲染：API route（sortable 字典模式）─────────────────────────────────

function renderSortableApiRoute(spec: ModuleSpec): string {
  const { pascal, pluralPascal, upper, label, camel, apiPath } = spec
  return `/**
 * ${pascal} API 路由 — ${label}管理（字典类：全量列表 + 拖拽重排）（gen:module 生成，薄 handler）
 *
 * 端点：
 * - GET    ${apiPath}            全量列表（需 ${spec.permissionView}）
 * - POST   ${apiPath}            新增（需 ${spec.permissionEdit}）
 * - PUT    ${apiPath}/reorder    保存拖拽顺序（需 ${spec.permissionEdit}）
 * - PUT    ${apiPath}/:id        更新（需 ${spec.permissionEdit}）
 * - DELETE ${apiPath}/:id        删除（需 ${spec.permissionEdit}）
 *
 * 注意：/reorder 必须注册在 /:id 之前（避免被动态段吞掉）；业务规则与审计在
 * ${spec.name}.service.ts（B2 门禁禁止 route 直连 DB）。
 */
import { Hono } from "hono"
import { PERMISSIONS, ${pascal}FormSchema, ${pascal}ReorderSchema } from "shared"

import { authMiddleware } from "../../middleware/auth.js"
import { requirePermission } from "../../middleware/permission.js"
import { fail, ok } from "../../response.js"
import { opCtxMiddleware } from "../../shared/op-context.js"
import { mapServiceError } from "../../shared/service-error.js"
import { safeJson } from "../../utils/safe-json.js"
import { formatZodErrors } from "../../utils/validation.js"
import {
  create${pascal},
  delete${pascal},
  list${pluralPascal},
  reorder${pluralPascal},
  update${pascal},
} from "./${spec.name}.service.js"

const ${camel}Route = new Hono()

${camel}Route.use("*", authMiddleware, opCtxMiddleware)

/** 路径参数 id：非正整数直接 400，避免 Number("abc") → NaN 传给 service */
function parseId(raw: string | undefined): number | null {
  if (!raw) return null
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

// ─── GET ${apiPath} — 全量列表（字典数据，不做分页）─────────────────────────

${camel}Route.get(
  "/",
  requirePermission(PERMISSIONS.${upper}_VIEW),
  (c) => ok(c, { items: list${pluralPascal}() })
)

// ─── PUT ${apiPath}/reorder — 保存拖拽顺序（须在 /:id 之前注册）──────────────

${camel}Route.put(
  "/reorder",
  requirePermission(PERMISSIONS.${upper}_EDIT),
  async (c) => {
    const body = await safeJson(c)
    if (!body) {
      return fail(c, 400, "VALIDATION_ERROR", "请求体必须为有效 JSON")
    }
    const parsed = ${pascal}ReorderSchema.safeParse(body)
    if (!parsed.success) {
      return fail(
        c,
        400,
        "VALIDATION_ERROR",
        "请求参数校验失败",
        formatZodErrors(parsed)
      )
    }

    try {
      reorder${pluralPascal}(c.get("opCtx")!, parsed.data.ids)
      return ok(c, undefined, "排序已保存")
    } catch (err) {
      return mapServiceError(c, err)
    }
  }
)

// ─── POST ${apiPath} — 新增 ─────────────────────────────────────────────────

${camel}Route.post(
  "/",
  requirePermission(PERMISSIONS.${upper}_EDIT),
  async (c) => {
    const body = await safeJson(c)
    if (!body) {
      return fail(c, 400, "VALIDATION_ERROR", "请求体必须为有效 JSON")
    }
    const parsed = ${pascal}FormSchema.safeParse(body)
    if (!parsed.success) {
      return fail(
        c,
        400,
        "VALIDATION_ERROR",
        "请求参数校验失败",
        formatZodErrors(parsed)
      )
    }

    try {
      const record = create${pascal}(c.get("opCtx")!, parsed.data)
      return ok(c, { ${camel}: record }, "创建成功", 201)
    } catch (err) {
      return mapServiceError(c, err)
    }
  }
)

// ─── PUT ${apiPath}/:id — 更新 ──────────────────────────────────────────────

${camel}Route.put(
  "/:id",
  requirePermission(PERMISSIONS.${upper}_EDIT),
  async (c) => {
    const id = parseId(c.req.param("id"))
    if (id === null) {
      return fail(c, 400, "VALIDATION_ERROR", "ID 必须为正整数")
    }

    const body = await safeJson(c)
    if (!body) {
      return fail(c, 400, "VALIDATION_ERROR", "请求体必须为有效 JSON")
    }
    const parsed = ${pascal}FormSchema.safeParse(body)
    if (!parsed.success) {
      return fail(
        c,
        400,
        "VALIDATION_ERROR",
        "请求参数校验失败",
        formatZodErrors(parsed)
      )
    }

    try {
      const record = update${pascal}(c.get("opCtx")!, id, parsed.data)
      return ok(c, { ${camel}: record }, "更新成功")
    } catch (err) {
      return mapServiceError(c, err)
    }
  }
)

// ─── DELETE ${apiPath}/:id — 删除 ───────────────────────────────────────────

${camel}Route.delete(
  "/:id",
  requirePermission(PERMISSIONS.${upper}_EDIT),
  (c) => {
    const id = parseId(c.req.param("id"))
    if (id === null) {
      return fail(c, 400, "VALIDATION_ERROR", "ID 必须为正整数")
    }

    try {
      delete${pascal}(c.get("opCtx")!, id)
      return ok(c, undefined, "删除成功")
    } catch (err) {
      return mapServiceError(c, err)
    }
  }
)

export default ${camel}Route
`
}

// ─── 模板渲染：API route 测试（sortable 字典模式）───────────────────────────

function renderSortableApiTest(spec: ModuleSpec): string {
  const { pascal, upper, apiPath, camel } = spec
  return `/**
 * ${pascal} 模块接口测试（gen:module 生成；字典/拖拽重排模式）
 *
 * 覆盖：鉴权（401/403）、创建（201 + sortOrder 追加 + 审计）、名称冲突（409）、
 * 参数校验 / 非法 JSON（400）、拖拽重排（顺序持久化 + 审计 + 非法输入 400）、
 * 更新与删除（404）。每个用例独立一份内存库（beforeEach），可单独 -t 运行。
 *
 * 运行：cd apps/api && bun test src/modules/${spec.name}/
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { Hono } from "hono"
import jwt from "jsonwebtoken"

import { getDrizzle } from "../../db.js"
import { auditLogs } from "../../db/schema.js"
import { JWT_SECRET } from "../../middleware/auth.js"
import { setupTestDb } from "../../test-helpers.js"
import ${camel}Route from "./${spec.name}.route.js"

// ── Fixtures ────────────────────────────────────────────────────────────────

const ADMIN_PAYLOAD = {
  sub: "admin@test.local",
  username: "admin@test.local",
  role: "admin",
}
const USER_PAYLOAD = {
  sub: "user@test.local",
  username: "user@test.local",
  role: "user",
}

let app: Hono
let adminToken: string
let userToken: string

function signToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" })
}

beforeAll(() => {
  app = new Hono()
  app.route(${quote(apiPath)}, ${camel}Route)
  adminToken = signToken(ADMIN_PAYLOAD)
  userToken = signToken(USER_PAYLOAD)
})

// 每个用例独立一份内存库：避免用例间共享数据导致的顺序依赖
beforeEach(() => {
  setupTestDb()
})

interface RequestOptions {
  body?: unknown
  /** 原样发送的请求体（用于非法 JSON 用例） */
  rawBody?: string
  /** 传 null 模拟未认证请求 */
  token?: string | null
}

async function request(
  method: string,
  url: string,
  options: RequestOptions = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers["Content-Type"] = "application/json"
  }
  if (options.token !== null) {
    headers["Authorization"] = "Bearer " + (options.token ?? adminToken)
  }
  const res = await app.request(url, {
    method,
    headers,
    body:
      options.rawBody ??
      (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  })
  return { status: res.status, body: await res.json() }
}

const validForm = {
  name: "测试分类A",
  status: "enabled",
  description: "生成器自带示例字段",
}

async function createOne(
  overrides: Partial<typeof validForm> = {}
): Promise<{ id: number; name: string; sortOrder: number }> {
  const res = await request("POST", ${quote(apiPath)}, {
    body: { ...validForm, ...overrides },
  })
  const data = res.body.data as {
    ${camel}: { id: number; name: string; sortOrder: number }
  }
  return data.${camel}
}

async function listItems(): Promise<
  Array<{ id: number; name: string; sortOrder: number }>
> {
  const res = await request("GET", ${quote(apiPath)})
  const data = res.body.data as {
    items: Array<{ id: number; name: string; sortOrder: number }>
  }
  return data.items
}

function moduleLogs() {
  return getDrizzle()
    .select()
    .from(auditLogs)
    .all()
    .filter((log) => log.module === ${quote(spec.auditModule)})
}

// ── 鉴权 ────────────────────────────────────────────────────────────────────

describe("鉴权", () => {
  it("GET 无 token → 401", async () => {
    const { status } = await request("GET", ${quote(apiPath)}, { token: null })
    expect(status).toBe(401)
  })

  it("GET 无 ${spec.permissionView} 权限 → 403", async () => {
    const { status } = await request("GET", ${quote(apiPath)}, {
      token: userToken,
    })
    expect(status).toBe(403)
  })

  it("POST 无 token → 401", async () => {
    const { status } = await request("POST", ${quote(apiPath)}, {
      body: validForm,
      token: null,
    })
    expect(status).toBe(401)
  })

  it("reorder 无 ${spec.permissionEdit} 权限 → 403", async () => {
    const { status } = await request("PUT", ${quote(apiPath + "/reorder")}, {
      body: { ids: [1] },
      token: userToken,
    })
    expect(status).toBe(403)
  })
})

// ── 创建 ────────────────────────────────────────────────────────────────────

describe("POST ${apiPath}", () => {
  it("创建成功 → 201，sortOrder 从 0 递增并写 create 审计", async () => {
    const first = await createOne()
    const second = await createOne({ name: "测试分类B" })
    expect(first.sortOrder).toBe(0)
    expect(second.sortOrder).toBe(1)

    const created = moduleLogs().find((log) => log.eventType === "create")
    expect(created).toBeTruthy()
    expect(created?.target).toBe(validForm.name)
  })

  it("缺少必填字段 → 400 + 字段级 errors", async () => {
    const { status, body } = await request("POST", ${quote(apiPath)}, {
      body: { status: "enabled" },
    })
    expect(status).toBe(400)
    const errors = body.errors as Record<string, string>
    expect(errors.name).toBeTruthy()
  })

  it("请求体不是合法 JSON → 400", async () => {
    const { status, body } = await request("POST", ${quote(apiPath)}, {
      rawBody: "{not-json",
    })
    expect(status).toBe(400)
    expect(body.code).toBe("VALIDATION_ERROR")
  })

  it("名称重复 → 409 ${upper}_NAME_EXISTS", async () => {
    await createOne()
    const { status, body } = await request("POST", ${quote(apiPath)}, {
      body: validForm,
    })
    expect(status).toBe(409)
    expect(body.code).toBe(${quote(upper + "_NAME_EXISTS")})
  })
})

// ── 列表 ────────────────────────────────────────────────────────────────────

describe("GET ${apiPath}", () => {
  it("空库 → items 为空数组", async () => {
    const { status, body } = await request("GET", ${quote(apiPath)})
    expect(status).toBe(200)
    expect((body.data as { items: unknown[] }).items).toEqual([])
  })

  it("按 sortOrder 升序返回全量列表", async () => {
    await createOne()
    await createOne({ name: "测试分类B" })
    await createOne({ name: "测试分类C" })

    const items = await listItems()
    expect(items.map((item) => item.name)).toEqual([
      "测试分类A",
      "测试分类B",
      "测试分类C",
    ])
    expect(items.map((item) => item.sortOrder)).toEqual([0, 1, 2])
  })
})

// ── 拖拽重排 ────────────────────────────────────────────────────────────────

describe("PUT ${apiPath}/reorder", () => {
  it("提交全量 id 逆序 → 顺序持久化并写「排序调整」审计", async () => {
    const first = await createOne()
    const second = await createOne({ name: "测试分类B" })
    const reversed = [second.id, first.id]

    const { status } = await request("PUT", ${quote(apiPath + "/reorder")}, {
      body: { ids: reversed },
    })
    expect(status).toBe(200)

    const items = await listItems()
    expect(items.map((item) => item.id)).toEqual(reversed)
    expect(items.map((item) => item.sortOrder)).toEqual([0, 1])

    const reorderLog = moduleLogs().find((log) => log.target === "排序调整")
    expect(reorderLog).toBeTruthy()
  })

  it("id 列表缺项 → 400 ${upper}_REORDER_INVALID", async () => {
    const first = await createOne()
    await createOne({ name: "测试分类B" })

    const { status, body } = await request(
      "PUT",
      ${quote(apiPath + "/reorder")},
      { body: { ids: [first.id] } }
    )
    expect(status).toBe(400)
    expect(body.code).toBe(${quote(upper + "_REORDER_INVALID")})
  })

  it("id 列表重复 → 400", async () => {
    const first = await createOne()
    const second = await createOne({ name: "测试分类B" })

    const { status } = await request("PUT", ${quote(apiPath + "/reorder")}, {
      body: { ids: [first.id, first.id] },
    })
    expect(status).toBe(400)
    expect(second.id).toBeGreaterThan(0)
  })

  it("id 列表含未知 id → 400", async () => {
    await createOne()

    const { status } = await request("PUT", ${quote(apiPath + "/reorder")}, {
      body: { ids: [99999] },
    })
    expect(status).toBe(400)
  })
})

// ── 更新 / 删除 ─────────────────────────────────────────────────────────────

describe("PUT ${apiPath}/:id 与 DELETE ${apiPath}/:id", () => {
  it("更新名称 → 200；删除 → 200 + 审计；再次删除 → 404", async () => {
    const created = await createOne()

    const updateRes = await request(
      "PUT",
      ${quote(apiPath + "/")} + created.id,
      { body: { name: "改名后的分类", status: "disabled" } }
    )
    expect(updateRes.status).toBe(200)

    const deleteRes = await request(
      "DELETE",
      ${quote(apiPath + "/")} + created.id
    )
    expect(deleteRes.status).toBe(200)

    const deleted = moduleLogs().find((log) => log.eventType === "delete")
    expect(deleted).toBeTruthy()

    const secondDelete = await request(
      "DELETE",
      ${quote(apiPath + "/")} + created.id
    )
    expect(secondDelete.status).toBe(404)
  })

  it("不存在的 id → 404", async () => {
    const { status, body } = await request(
      "PUT",
      ${quote(apiPath + "/99999")},
      { body: validForm }
    )
    expect(status).toBe(404)
    expect(body.code).toBe(${quote(upper + "_NOT_FOUND")})
  })
})
`
}

// ─── 模板渲染：web service / hooks / 表单 hook（sortable 字典模式）───────────

function renderSortableWebService(spec: ModuleSpec): string {
  const { pascal, camel, apiPath } = spec
  return `/**
 * ${pascal} service — 封装 ${apiPath} 字典/分类接口（gen:module 生成）
 *
 * 契约唯一事实源：packages/shared/src/${spec.name}.ts；统一响应信封
 * { success, message, data }，业务数据取 res.data.data。
 */
import type { ${pascal}, ${pascal}Form } from "shared"

import { api } from "@workspace/web-core/lib/api"

export const ${camel}Service = {
  /** 全量列表（字典/下拉选项共用，后端按 sortOrder 升序） */
  list: async (): Promise<${pascal}[]> => {
    const res = await api.get(${quote(apiPath)})
    return res.data.data.items
  },

  create: async (data: ${pascal}Form): Promise<${pascal}> => {
    const res = await api.post(${quote(apiPath)}, data)
    return res.data.data.${camel}
  },

  update: async (id: number, data: ${pascal}Form): Promise<${pascal}> => {
    const res = await api.put(${quote(apiPath + "/")} + id, data)
    return res.data.data.${camel}
  },

  remove: async (id: number): Promise<void> => {
    await api.delete(${quote(apiPath + "/")} + id)
  },

  /** 保存拖拽后的全量 id 顺序（后端事务内逐行更新 sortOrder） */
  reorder: async (ids: number[]): Promise<void> => {
    await api.put(${quote(apiPath + "/reorder")}, { ids })
  },
}
`
}

function renderSortableWebHooks(spec: ModuleSpec): string {
  const { pascal, pluralPascal, camel, label } = spec
  return `/**
 * ${pascal} 域 Query hooks — 服务端状态统一由 TanStack Query 管理（gen:module 生成）
 *
 * - 全量列表用固定 key ${camel}Keys.list()，拖拽重排时先乐观更新缓存再提交，
 *   失败回滚、成功重新拉取，避免整页闪烁；
 * - create / update 声明 silentError，由表单弹窗回填字段错误并自行 toast。
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type { ${pascal}, ${pascal}Form } from "shared"

import { ${camel}Keys } from "@/lib/query-keys"
import { ${camel}Service } from "@/services/${spec.name}"

export interface Use${pluralPascal}Options {
  /** 无 ${spec.permissionView} 权限时可关闭请求，避免无意义 403 */
  enabled?: boolean
}

export function use${pluralPascal}(options: Use${pluralPascal}Options = {}) {
  const { enabled = true } = options
  return useQuery({
    queryKey: ${camel}Keys.list(),
    queryFn: () => ${camel}Service.list(),
    enabled,
    meta: { errorMessage: ${quote("加载" + label + "列表失败")} },
  })
}

export function useCreate${pascal}() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ${pascal}Form) => ${camel}Service.create(data),
    meta: { silentError: true },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ${camel}Keys.all }),
  })
}

export function useUpdate${pascal}() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: number; data: ${pascal}Form }) =>
      ${camel}Service.update(input.id, input.data),
    meta: { silentError: true },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ${camel}Keys.all }),
  })
}

export function useDelete${pascal}() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => ${camel}Service.remove(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ${camel}Keys.all }),
  })
}

/**
 * 保存拖拽顺序：先按新顺序乐观更新缓存（拖完立即生效），
 * 失败回滚到快照，成功后失效重拉保证与服务端一致。
 */
export function useReorder${pluralPascal}() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => ${camel}Service.reorder(ids),
    // 不声明 silentError：失败时由全局 mutation 错误处理弹 toast（乐观更新已回滚）
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: ${camel}Keys.lists() })
      const previous = queryClient.getQueryData<${pascal}[]>(
        ${camel}Keys.list()
      )
      if (previous) {
        const byId = new Map(previous.map((item) => [item.id, item]))
        const next = ids
          .map((id) => byId.get(id))
          .filter((item): item is ${pascal} => item !== undefined)
        queryClient.setQueryData(${camel}Keys.list(), next)
      }
      return { previous }
    },
    onError: (_err, _ids, context) => {
      if (context?.previous) {
        queryClient.setQueryData(${camel}Keys.list(), context.previous)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ${camel}Keys.all })
    },
  })
}
`
}

function renderSortableFormHook(spec: ModuleSpec): string {
  const { pascal, label } = spec
  return `/**
 * use${pascal}Form — ${label}表单共享 hook（gen:module 生成；react-hook-form + zod）
 *
 * 校验规则直接复用 shared 的 ${pascal}FormSchema（与后端契约单一事实源）；
 * sortOrder 由后端维护，表单不暴露该字段。
 */
import { zodResolver } from "@hookform/resolvers/zod"
import { useCallback } from "react"
import { useForm } from "react-hook-form"
import type { ${pascal}, ${pascal}Form } from "shared"
import { ${pascal}FormSchema } from "shared"

/** 新增场景的初始值（状态默认启用） */
function makeEmptyValues(): ${pascal}Form {
  return {
    name: "",
    status: "enabled",
    description: "",
  }
}

/** 编辑场景：wire 行 → 表单值（null 描述收敛成空串，避免受控组件 warning） */
function toFormValues(record: ${pascal}): ${pascal}Form {
  return {
    name: record.name,
    status: record.status,
    description: record.description ?? "",
  }
}

export function use${pascal}Form() {
  const form = useForm<${pascal}Form>({
    resolver: zodResolver(${pascal}FormSchema),
    defaultValues: makeEmptyValues(),
    mode: "onSubmit",
  })

  const resetEmpty = useCallback(() => form.reset(makeEmptyValues()), [form])
  const resetFrom${pascal} = useCallback(
    (record: ${pascal}) => form.reset(toFormValues(record)),
    [form]
  )

  return { form, resetEmpty, resetFrom${pascal} }
}
`
}

// ─── 模板渲染：表单弹窗（sortable 字典模式）─────────────────────────────────

function renderSortableFormDialog(spec: ModuleSpec): string {
  const { pascal, label, upper } = spec
  return `/**
 * ${pascal}FormDialog — 新增/编辑${label}弹窗（gen:module 生成）
 *
 * - 桌面居中 Dialog / 移动底部 Sheet（ResponsiveDialog）；
 * - 校验复用 shared 的 ${pascal}FormSchema；服务端字段错误由 applyServerFieldErrors
 *   回填到对应字段，其余错误交给全局 mutation toast（hooks 已声明 silentError）。
 */
import { useEffect } from "react"
import type { ${pascal}, ${pascal}Status } from "shared"
import { ${upper}_STATUS_LABELS, ${upper}_STATUS_OPTIONS } from "shared"

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@workspace/ui/components/shared/ResponsiveDialog"
import { Button } from "@workspace/ui/components/ui/button"
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/ui/field"
import { Input } from "@workspace/ui/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/ui/select"
import { Textarea } from "@workspace/ui/components/ui/textarea"
import {
  useCreate${pascal},
  useUpdate${pascal},
} from "@/hooks/queries/use${pascal}"
import { extractErrorMessage } from "@workspace/web-core/lib/errors"
import { applyServerFieldErrors } from "@/lib/form-error"
import { showError, showSuccess } from "@workspace/web-core/lib/toast"

import { use${pascal}Form } from "../hooks/use${pascal}Form"

interface ${pascal}FormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 编辑目标；null 表示新增 */
  editing: ${pascal} | null
}

export function ${pascal}FormDialog({
  open,
  onOpenChange,
  editing,
}: ${pascal}FormDialogProps) {
  const { form, resetEmpty, resetFrom${pascal} } = use${pascal}Form()
  const create${pascal} = useCreate${pascal}()
  const update${pascal} = useUpdate${pascal}()
  const submitting = create${pascal}.isPending || update${pascal}.isPending

  // 打开弹窗时按「新增 / 编辑」重置表单数据源
  useEffect(() => {
    if (!open) return
    if (editing) resetFrom${pascal}(editing)
    else resetEmpty()
  }, [open, editing, resetEmpty, resetFrom${pascal}])

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      if (editing) {
        await update${pascal}.mutateAsync({ id: editing.id, data: values })
        showSuccess(${quote(label + "已更新")})
      } else {
        await create${pascal}.mutateAsync(values)
        showSuccess(${quote(label + "已创建")})
      }
      onOpenChange(false)
    } catch (err) {
      if (!applyServerFieldErrors(err, form.setError)) {
        showError(extractErrorMessage(err))
      }
    }
  })

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next)
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {editing ? ${quote("编辑" + label)} : ${quote("新增" + label)}}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            ${quote("排序由列表拖拽维护；保存后写入审计日志。")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <Field>
            <FieldLabel htmlFor="${spec.name}-name">名称 *</FieldLabel>
            <Input
              id="${spec.name}-name"
              placeholder=${quote("请输入" + label + "名称")}
              aria-invalid={Boolean(form.formState.errors.name)}
              disabled={submitting}
              {...form.register("name")}
            />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </Field>

          <Field>
            <FieldLabel>状态</FieldLabel>
            <Select
              value={form.watch("status")}
              disabled={submitting}
              onValueChange={(value) =>
                form.setValue("status", value as ${pascal}Status, {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {${upper}_STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {${upper}_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="${spec.name}-description">描述</FieldLabel>
            <Textarea
              id="${spec.name}-description"
              placeholder=${quote("可选，最多 200 个字符")}
              rows={3}
              disabled={submitting}
              {...form.register("description")}
            />
            <FieldError>{form.formState.errors.description?.message}</FieldError>
          </Field>

          {form.formState.errors.root ? (
            <p className="text-sm text-destructive">
              {form.formState.errors.root.message}
            </p>
          ) : null}

          <ResponsiveDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "保存中..." : "保存"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
`
}

// ─── 模板渲染：列表页（sortable 字典模式）───────────────────────────────────

function renderSortablePage(spec: ModuleSpec): string {
  const { pascal, pluralPascal, upper, label } = spec
  const iconImports = renderNamedImports([
    spec.icon,
    "Pencil",
    "Plus",
    "Trash2",
  ])
  return `/**
 * ${pascal}Page — ${label}管理页（gen:module 生成；字典/分类模式）
 *
 * 生成骨架的 5 要素映射（实体字段 / 业务不变量 / 权限 / 审计 / 界面布局，
 * 改业务前先读 README「业务模块生成器」与 AGENTS.md）：
 * 1. 核心实体与字段 → packages/shared/src/${spec.name}.ts
 * 2. 业务不变量 → ${spec.name}.service.ts（名称唯一 409 / 引用保护 400）
 * 3. 权限 → PERMISSIONS.${upper}_VIEW / ${upper}_EDIT
 * 4. 审计 → ${spec.name}.service.ts 的 ${upper}_AUDIT_CONFIG + 排序调整审计
 * 5. 界面交互 → DataTable 全量拖拽重排 + ${pascal}FormDialog（本文件）
 *
 * 交互约定：拖拽后立即乐观更新，成功提示「排序已保存」，失败自动回滚。
 */
import { ${iconImports} } from "lucide-react"
import { useState } from "react"
import type { ${pascal} } from "shared"
import {
  ${upper}_STATUS_LABELS,
  PERMISSIONS,
} from "shared"

import { ConfirmDialog } from "@workspace/ui/components/shared/ConfirmDialog"
import { type ColumnDef, DataTable } from "@workspace/ui/components/shared/DataTable"
import { DateCell } from "@workspace/ui/components/shared/DateCell"
import {
  MobileCard,
  MobileCardMeta,
  MobileCardTags,
  MobileCardTitle,
} from "@workspace/ui/components/shared/MobileCard"
import { NullableText } from "@workspace/ui/components/shared/NullableText"
import { PermissionGate } from "@workspace/web-core/components/shared/PermissionGate"
import { StatusBadge } from "@workspace/ui/components/shared/StatusBadge"
import { Button } from "@workspace/ui/components/ui/button"
import {
  use${pluralPascal},
  useDelete${pascal},
  useReorder${pluralPascal},
} from "@/hooks/queries/use${pascal}"
import { usePermission } from "@workspace/web-core/hooks/usePermission"
import { showSuccess } from "@workspace/web-core/lib/toast"

import { ${pascal}FormDialog } from "./components/${pascal}FormDialog"

function statusBadge(active: boolean) {
  return (
    <StatusBadge active={active}>
      {active ? ${upper}_STATUS_LABELS.enabled : ${upper}_STATUS_LABELS.disabled}
    </StatusBadge>
  )
}

export default function ${pascal}Page() {
  const { can } = usePermission()
  const canView = can(PERMISSIONS.${upper}_VIEW)
  const canEdit = can(PERMISSIONS.${upper}_EDIT)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<${pascal} | null>(null)
  const [deleting, setDeleting] = useState<${pascal} | null>(null)

  const { data: items = [], isLoading } = use${pluralPascal}({ enabled: canView })
  const delete${pascal} = useDelete${pascal}()
  const reorder${pluralPascal} = useReorder${pluralPascal}()

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (row: ${pascal}) => {
    setEditing(row)
    setDialogOpen(true)
  }

  const handleDelete = () => {
    const target = deleting
    if (!target) return
    delete${pascal}.mutate(target.id, {
      onSuccess: () => {
        showSuccess(${quote("已删除：")} + target.name)
        setDeleting(null)
      },
      onError: () => setDeleting(null),
    })
  }

  /** DataTable 拖拽回调：先在本地算出新顺序（乐观更新由 hook 负责） */
  const handleReorder = (fromIndex: number, toIndex: number) => {
    const next = [...items]
    const moved = next.splice(fromIndex, 1)[0]
    if (!moved) return
    next.splice(toIndex, 0, moved)
    reorder${pluralPascal}.mutate(next.map((item) => item.id), {
      onSuccess: () => showSuccess("排序已保存"),
    })
  }

  const columns: ColumnDef<${pascal}>[] = [
    {
      header: "名称",
      width: "w-[200px]",
      render: (row) => (
        <span className="block max-w-[200px] truncate font-medium">
          {row.name}
        </span>
      ),
    },
    {
      header: "状态",
      width: "w-[90px]",
      render: (row) => statusBadge(row.status === "enabled"),
    },
    {
      header: "描述",
      width: "w-[280px]",
      render: (row) => (
        <span className="block max-w-[280px] truncate">
          <NullableText value={row.description} />
        </span>
      ),
    },
    {
      header: "更新时间",
      width: "w-[130px]",
      render: (row) => <DateCell value={row.updatedAt} />,
    },
    {
      header: "操作",
      width: "w-[150px]",
      render: (row) =>
        canEdit ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2"
              onClick={() => openEdit(row)}
            >
              <Pencil className="size-3.5" />
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2"
              style={{ color: "var(--lg-danger)" }}
              onClick={() => setDeleting(row)}
            >
              <Trash2 className="size-3.5" />
              删除
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">只读</span>
        ),
    },
  ]

  const header = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight md:text-3xl">
          ${label}管理
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          字典类数据：拖拽行调整显示顺序，顺序保存到 sortOrder
        </p>
      </div>
      <PermissionGate perm={PERMISSIONS.${upper}_EDIT}>
        <Button size="sm" className="h-9 gap-1.5" onClick={openCreate}>
          <Plus className="size-4" />
          新增
        </Button>
      </PermissionGate>
    </div>
  )

  // 无查看权限：不发起请求，直接提示（菜单同样不可见，接口仍有后端 403 兜底）
  if (!canView) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {header}
        <div className="inset-card flex flex-col items-center gap-2 p-10 text-center">
          <${spec.icon} className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            当前账号没有查看${label}的权限（${spec.permissionView}）
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      {header}

      <DataTable<${pascal}>
        columns={columns}
        data={items}
        loading={isLoading}
        total={items.length}
        rowKey="id"
        // 拖拽 = 写操作，必须与后端 edit 权限对齐（只读用户不应看到拖拽把手）
        draggable={canEdit}
        onReorder={canEdit ? handleReorder : undefined}
        emptyIcon={${spec.icon}}
        emptyTitle=${quote("暂无" + label)}
        emptyDescription=${quote("点击右上角「新增」创建第一条" + label + "记录")}
        onMobileCardClick={(row) => {
          if (canEdit) openEdit(row)
        }}
        mobileCard={(row) => (
          <MobileCard>
            <MobileCardTitle title={row.name}>
              {statusBadge(row.status === "enabled")}
            </MobileCardTitle>
            <MobileCardTags>
              <span className="font-mono text-xs text-muted-foreground">
                sortOrder: {row.sortOrder}
              </span>
            </MobileCardTags>
            <MobileCardMeta>
              <span className="truncate">
                <NullableText value={row.description} />
              </span>
              <DateCell value={row.updatedAt} />
            </MobileCardMeta>
            {canEdit ? (
              <div className="flex items-center gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2"
                  onClick={(event) => {
                    event.stopPropagation()
                    openEdit(row)
                  }}
                >
                  <Pencil className="size-3.5" />
                  编辑
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2"
                  style={{ color: "var(--lg-danger)" }}
                  onClick={(event) => {
                    event.stopPropagation()
                    setDeleting(row)
                  }}
                >
                  <Trash2 className="size-3.5" />
                  删除
                </Button>
              </div>
            ) : null}
          </MobileCard>
        )}
      />

      <${pascal}FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null)
        }}
        title=${quote("删除" + label)}
        description={
          deleting
            ? ${quote("确定删除「")} + deleting.name + "」吗？删除后不可恢复。"
            : undefined
        }
        confirmLabel="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
`
}

// ─── 模板渲染：module 文件清单 ──────────────────────────────────────────────

/**
 * 渲染业务模块 5 要素规格书骨架（`docs/specs/<name>.md`）。
 *
 * 与代码文件分离处理：若人类或 AI 在 Step 1 已先行创建 `docs/specs/<name>.md`，
 * `gen:module` 会保留已有规格书（即使传入 `--force` 也不覆盖人工对齐的需求规格）；
 * 若直接通过 CLI 生成模块且尚无规格书，则自动落盘此骨架以满足 `arch:check` 的
 * `module-spec-required` 门禁。
 */
function formatTodayLocal(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

export function renderSpecDoc(
  spec: ModuleSpec,
  dateStr: string = formatTodayLocal()
): GeneratedFile {
  const isCrud = spec.mode === "crud"
  const fieldRows = isCrud
    ? [
        `| \`id\` | \`integer\` | 是 | 自增 | ID | 主键 |`,
        `| \`code\` | \`text\` | 是 | — | ${spec.label}编码 | 唯一索引 \`uq_${spec.table}_code\`，上限 64 字符 |`,
        `| \`name\` | \`text\` | 是 | — | ${spec.label}名称 | 上限 100 字符 |`,
        `| \`status\` | \`text\` | 是 | \`"enabled"\` | 状态 | 枚举 \`enabled\` / \`disabled\` |`,
        `| \`description\` | \`text\` | 否 | \`null\` | 备注描述 | 上限 500 字符 |`,
        `| \`createdAt\` | \`text\` | 是 | ISO 时间 | 创建时间 | — |`,
        `| \`updatedAt\` | \`text\` | 是 | ISO 时间 | 更新时间 | — |`,
      ].join("\n")
    : [
        `| \`id\` | \`integer\` | 是 | 自增 | ID | 主键 |`,
        `| \`name\` | \`text\` | 是 | — | ${spec.label}名称 | 唯一索引 \`uq_${spec.table}_name\`，上限 100 字符 |`,
        `| \`status\` | \`text\` | 是 | \`"enabled"\` | 状态 | 枚举 \`enabled\` / \`disabled\` |`,
        `| \`description\` | \`text\` | 否 | \`null\` | 备注描述 | 上限 500 字符 |`,
        `| \`sortOrder\` | \`integer\` | 是 | \`0\` | 排序权重 | 索引 \`idx_${spec.table}_sort_order\`，拖拽重排 |`,
        `| \`createdAt\` | \`text\` | 是 | ISO 时间 | 创建时间 | — |`,
        `| \`updatedAt\` | \`text\` | 是 | ISO 时间 | 更新时间 | — |`,
      ].join("\n")

  const content = `# ${spec.label}（\`${spec.name}\`）业务模块规格书

> **模块标识**：\`--name ${spec.name} --label "${spec.label}" --icon ${spec.icon} --mode ${spec.mode}\`
> **当前版本**：\`v1.0\`

---

## 0. 业务背景与范围（Requirement Context）

### 0.1 原始需求背景与痛点
- **谁在什么场景下使用**：业务管理员在后台维护「${spec.label}」数据。
- **解决的核心问题**：提供标准化的${spec.label}${isCrud ? "分页检索、新增、编辑与删除" : "字典维护与拖拽排序"}能力，并纳入 RBAC 权限与操作审计闭环。
- **本次范围内（In Scope）**：${spec.label}${isCrud ? "列表筛选、分页查询、创建、编辑、删除" : "全量列表、创建、编辑、删除、拖拽重排"}。
- **本次范围外（Out of Scope）**：跨系统外部同步。

### 0.2 版本演进记录（Changelog & Raw Input Mapping）
| 版本 | 日期 | 变更摘要 | 关联原始资料（PRD / 原型） |
| :--- | :--- | :--- | :--- |
| \`v1.0\` | ${dateStr} | 初始版本：通过 \`gen:module\` 初始化 ${spec.label}（\`${spec.mode}\`）全栈模块 | *对话直接生成（无独立原始附件）* |

---

## 1. 核心实体与字段（Entity & Schema）

- **表名**：\`${spec.table}\`（位于 \`apps/api/src/db/schema.ts\`）

| 字段名 | 类型 | 必填 | 默认值 | 中文标签 | 索引 / 约束说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
${fieldRows}

---

## 2. 接口与共享契约（API & Shared Contracts）

- **契约文件**：\`packages/shared/src/${spec.name}.ts\`
- **后端路由**：\`apps/api/src/modules/${spec.name}/${spec.name}.route.ts\`（挂载于 \`${spec.apiPath}\`）

| 方法与路径 | 权限码 | 请求体 / 查询参数 | 响应结构 |
| :--- | :--- | :--- | :--- |
| \`GET ${spec.apiPath}\` | \`${spec.permissionView}\` | ${isCrud ? "`page`, `pageSize`, `keyword?`, `status?`" : "无（全量按 `sortOrder` 升序）"} | ${isCrud ? "`PaginatedListData<" + spec.pascal + ">`" : "`ApiResponse<" + spec.pascal + "[]>`"} |
${isCrud ? `| \`GET ${spec.apiPath}/:id\` | \`${spec.permissionView}\` | \`:id\` | \`ApiResponse<${spec.pascal}>\` |\n` : `| \`PUT ${spec.apiPath}/reorder\` | \`${spec.permissionEdit}\` | \`${spec.pascal}ReorderInput\` | \`ApiResponse<null>\` |\n`}| \`POST ${spec.apiPath}\` | \`${spec.permissionEdit}\` | \`Create${spec.pascal}Input\` | \`ApiResponse<${spec.pascal}>\` (201) |
| \`PUT ${spec.apiPath}/:id\` | \`${spec.permissionEdit}\` | \`Update${spec.pascal}Input\` | \`ApiResponse<${spec.pascal}>\` |
| \`DELETE ${spec.apiPath}/:id\` | \`${spec.permissionEdit}\` | \`:id\` | \`ApiResponse<null>\` |

---

## 3. 业务不变量与前置校验（Service Invariants）

> **维护约定**：修 Bug 前必读本节核对预期；仅当本规格书五要素（字段、契约、业务规则、交互块、权限/审计）发生变化时才同步更新本文档，纯代码缺陷修复或样式/重构无需修改本文件。

1. **唯一性约束（\`409 CONFLICT\`）**：${isCrud ? "`code`（编码）" : "`name`（名称）"}全局唯一，新增或修改撞车时抛出 \`new ServiceError(409, "CONFLICT", "...")\`。
2. **存在性校验（\`404 NOT_FOUND\`）**：按 \`id\` 更新或删除不存在的记录时抛出 \`new ServiceError(404, "NOT_FOUND", "${spec.label}不存在")\`。
3. **删除引用保护（\`409 CONFLICT\`）**：删除前检查是否被下游业务单据引用（若有下游外键关联，补充 \`count\` 守卫拦截）。

---

## 4. 页面布局与交互设计（UI & Interaction）

- **前端路由与菜单**：\`${spec.routePath}\`（菜单分组 \`Business\`，图标 \`${spec.icon}\`，权限 \`${spec.permissionView}\`）
- **列表页组件**：\`apps/web/src/pages/${spec.name}/${spec.pascal}Page.tsx\`
  - ${isCrud ? "顶部 `FilterBar`（关键词搜索 + 状态筛选）+ `DataTable`（桌面表格 + 移动端 `mobileCard`）+ `SmartPagination`" : "`DataTable`（启用 `draggable` 拖拽重排 + 移动端 `mobileCard`）"}
- **表单弹窗**：\`apps/web/src/pages/${spec.name}/components/${spec.pascal}FormDialog.tsx\`（基于 \`ResponsiveDialog\`，移动端自动切换底部抽屉）
- **危险操作确认**：删除走 \`ConfirmDialog\`（\`variant="destructive"\`）。

---

## 5. 权限与审计配置（RBAC & Audit）

- **权限码**：
  - 查看列表：\`PERMISSIONS.${spec.upper}_VIEW = "${spec.permissionView}"\`
  - 新增/编辑/删除：\`PERMISSIONS.${spec.upper}_EDIT = "${spec.permissionEdit}"\`
- **审计配置**：
  - 模块标识：\`AUDIT_MODULES.${spec.upper} = "${spec.auditModule}"\`
  - \`TableAuditConfig\`：位于 \`apps/api/src/modules/${spec.name}/${spec.name}.service.ts\`，配置 \`fieldLabels\` 中文映射以驱动审计日志页 \`AuditDiffViewer\` 三态 Diff 展示。
`

  return {
    relPath: "docs/specs/" + spec.name + ".md",
    content,
  }
}

/**
 * 后端域新文件（4 个，与端无关，一个模块只生成一次）：
 * shared 契约 + api service / route / route 测试。
 */
export function renderBackendFiles(spec: ModuleSpec): GeneratedFile[] {
  const apiDir = "apps/api/src/modules/" + spec.name
  const isCrud = spec.mode === "crud"

  return [
    {
      relPath: "packages/shared/src/" + spec.name + ".ts",
      content: renderSharedSchema(spec),
    },
    {
      relPath: apiDir + "/" + spec.name + ".service.ts",
      content: isCrud
        ? renderCrudApiService(spec)
        : renderSortableApiService(spec),
    },
    {
      relPath: apiDir + "/" + spec.name + ".route.ts",
      content: isCrud ? renderCrudApiRoute(spec) : renderSortableApiRoute(spec),
    },
    {
      relPath: apiDir + "/" + spec.name + ".route.test.ts",
      content: isCrud ? renderCrudApiTest(spec) : renderSortableApiTest(spec),
    },
  ]
}

/**
 * 某端的前端切片新文件（5 个）：service / hooks / 页面 / 表单弹窗 / 表单 hook。
 * 各端各一份，复用同一个后端域（权限码、query key 形状、service URL 完全一致）。
 */
export function renderWebSliceFiles(
  spec: ModuleSpec,
  appId = DEFAULT_WEB_APP_ID
): GeneratedFile[] {
  const pageDir = "apps/" + appId + "/src/pages/" + spec.name
  const isCrud = spec.mode === "crud"

  return [
    {
      relPath: "apps/" + appId + "/src/services/" + spec.name + ".ts",
      content: isCrud
        ? renderCrudWebService(spec)
        : renderSortableWebService(spec),
    },
    {
      relPath: "apps/" + appId + "/src/hooks/queries/use" + spec.pascal + ".ts",
      content: isCrud ? renderCrudWebHooks(spec) : renderSortableWebHooks(spec),
    },
    {
      relPath: pageDir + "/" + spec.pascal + "Page.tsx",
      content: isCrud ? renderCrudPage(spec) : renderSortablePage(spec),
    },
    {
      relPath: pageDir + "/components/" + spec.pascal + "FormDialog.tsx",
      content: isCrud
        ? renderCrudFormDialog(spec)
        : renderSortableFormDialog(spec),
    },
    {
      relPath: pageDir + "/hooks/use" + spec.pascal + "Form.ts",
      content: isCrud ? renderCrudFormHook(spec) : renderSortableFormHook(spec),
    },
  ]
}

/** 渲染某模式的全部新文件（后端域 + 默认端切片，不含注册点修改） */
export function renderModuleFiles(spec: ModuleSpec): GeneratedFile[] {
  return [...renderBackendFiles(spec), ...renderWebSliceFiles(spec)]
}

// ─── 模板渲染：数据库表（注册 schema.ts）────────────────────────────────────

/** 新表定义：追加到 apps/api/src/db/schema.ts 末尾 */
export function renderDbTable(spec: ModuleSpec): string {
  const { table, label } = spec
  const sortable = spec.mode === "sortable"
  const businessFields = sortable
    ? `    name: text("name").notNull(),
    status: text("status").notNull().default("enabled"),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),`
    : `    code: text("code").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("enabled"),
    description: text("description"),`
  const indexes = sortable
    ? `    uniqueIndex("uq_${table}_name").on(table.name),
    index("idx_${table}_sort_order").on(table.sortOrder),`
    : `    uniqueIndex("uq_${table}_code").on(table.code),`

  return `/**
 * ${label}表 — gen:module 生成的业务骨架（5 要素第 1 项：核心实体与字段）
 *
 * 字段为占位示例，按业务规格书调整后重跑数据库结构同步命令：
 * 模板仓库 \`bun --filter api db:init:generate\`；生成项目 \`bun --filter api db:generate\`。
 */
export const ${table} = sqliteTable(
  "${table}",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
${businessFields}
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
${indexes}
  ]
)
`
}

// ─── 注册点：权限 / 审计 / 导出 / 表 / API 挂载 / query key / 路由 / 菜单 ────

export type RegistrationTransform = (
  content: string,
  spec: ModuleSpec
) => string | null

// ─── 模块区块（remove:module 的归属声明）─────────────────────────────────────
// 8 个注册点注入的代码统一包裹在 `module:<name>` 区块内，remove:module 用
// stripRegions(content, "module:<name>") 精确移除；import 语句一律不打区块
// （设计书 §3.3：删区块后由 imports:prune 清理未使用导入）。
// 区块标记与 `[gen:module:*]` 锚点同级维护：勿删改标记行、勿把非本模块代码写进他人区块。

/** 菜单分组容器区块 id：gen:group:<Label>（模块全部卸载后由 stripEmptyGroupRegions 收起） */
export function menuGroupRegionId(label: string): string {
  return "gen:group:" + label
}

/** 模块区块 id：module:<name>（8 个注册点共用，remove:module 按此 id 剥离） */
export function moduleRegionId(name: string): string {
  return "module:" + name
}

/**
 * 用 `// #region <id>` / `// #endregion <id>` 包裹 TS/TSX 语句块。
 *
 * body 末尾的**一个**换行会被吞掉，随后统一在关闭标记前补一个换行：这样 body 自带
 * 的尾部空行（如 query key 工厂块与下一段声明之间的空行）会落在区块内部，
 * `stripRegions` 删除整块后不会残留额外空行 → 「插入 → 剥离」逐字节还原。
 * indent 用于容器内部的嵌套区块（菜单分组内 6 空格）。
 */
export function wrapTsRegion(id: string, body: string, indent = ""): string {
  return (
    indent +
    "// #region " +
    id +
    "\n" +
    body.replace(/\n$/, "") +
    "\n" +
    indent +
    "// #endregion " +
    id +
    "\n"
  )
}

/** 用 JSX 注释包裹 JSX 子节点（TS 注释写进 JSX 子节点会变成渲染文本）。 */
export function wrapJsxRegion(id: string, body: string, indent = ""): string {
  return (
    indent +
    "{/* #region " +
    id +
    " */}\n" +
    body.replace(/\n$/, "") +
    "\n" +
    indent +
    "{/* #endregion " +
    id +
    " */}\n"
  )
}

/** 权限码 + 权限注册表（admin 自动持有全量；普通角色需在 ROLE_PERMISSIONS 显式授予） */
export const registerPermissions: RegistrationTransform = (content, spec) => {
  if (hasLineStartingWith(content, spec.upper + "_VIEW:")) return null
  const id = moduleRegionId(spec.name)
  const codes = wrapTsRegion(
    id,
    "  " +
      spec.upper +
      "_VIEW: " +
      quote(spec.permissionView) +
      ",\n  " +
      spec.upper +
      "_EDIT: " +
      quote(spec.permissionEdit) +
      ",\n"
  )
  const withCodes = insertAfterMarker(
    content,
    MARKERS.permissions,
    codes,
    "shared/permissions.ts"
  )
  const registry = wrapTsRegion(
    id,
    `  {
    code: PERMISSIONS.${spec.upper}_VIEW,
    label: ${quote(spec.label + "列表")},
    group: ${quote(spec.name)},
    groupLabel: ${quote(spec.label + "管理")},
    kind: "menu",
  },
  {
    code: PERMISSIONS.${spec.upper}_EDIT,
    label: ${quote("编辑" + spec.label)},
    group: ${quote(spec.name)},
    groupLabel: ${quote(spec.label + "管理")},
    kind: "action",
  },
`
  )
  return insertAfterMarker(
    withCodes,
    MARKERS.permissionRegistry,
    registry,
    "shared/permissions.ts"
  )
}

/** 审计模块名 + 中文标签 + 模块事件映射（审计日志筛选下拉同步生效） */
export const registerAudit: RegistrationTransform = (content, spec) => {
  if (
    hasLineStartingWith(content, spec.upper + ": " + quote(spec.name) + ",")
  ) {
    return null
  }
  const id = moduleRegionId(spec.name)
  let next = insertAfterMarker(
    content,
    MARKERS.auditModules,
    wrapTsRegion(id, "  " + spec.upper + ": " + quote(spec.name) + ",\n"),
    "shared/audit.ts"
  )
  next = insertAfterMarker(
    next,
    MARKERS.auditModuleLabels,
    wrapTsRegion(
      id,
      "  " + quote(spec.name) + ": " + quote(spec.label + "管理") + ",\n"
    ),
    "shared/audit.ts"
  )
  return insertAfterMarker(
    next,
    MARKERS.auditModuleEventTypes,
    wrapTsRegion(
      id,
      "  " + quote(spec.name) + ': ["create", "update", "delete"],\n'
    ),
    "shared/audit.ts"
  )
}

/** shared/index.ts 导出（appendSection 保证与既有段落用空行分隔，export 排序规则不报错） */
export const registerSharedExports: RegistrationTransform = (content, spec) => {
  if (hasLineStartingWith(content, '} from "./' + spec.name + '.js"')) {
    return null
  }
  const names = [
    spec.upper + "_STATUS",
    spec.upper + "_STATUS_LABELS",
    spec.upper + "_STATUS_OPTIONS",
    "type " + spec.pascal,
    "type " + spec.pascal + "Status",
    spec.pascal + "FormSchema",
    "type " + spec.pascal + "Form",
    spec.pascal + "Schema",
  ]
  if (spec.mode === "crud") {
    names.push(
      spec.pascal + "ListQueryBaseSchema",
      "type " + spec.pascal + "ListQuery",
      spec.pascal + "ListQuerySchema"
    )
  } else {
    names.push(
      spec.pascal + "ReorderSchema",
      "type " + spec.pascal + "ReorderInput"
    )
  }
  const sorted = names.sort((a, b) =>
    a.replace(/^type /, "").localeCompare(b.replace(/^type /, ""))
  )
  const section = wrapTsRegion(
    moduleRegionId(spec.name),
    `// ─── ${spec.label}（gen:module 生成：wire 契约 + 表单/查询 schema）──────────────────

export {
${sorted.map((name) => "  " + name + ",").join("\n")}
} from "./${spec.name}.js"`
  )
  return appendSection(content, section)
}

/** 数据库表定义（追加到 schema.ts 末尾；重复执行跳过） */
export const registerDbTable: RegistrationTransform = (content, spec) => {
  if (
    hasLineStartingWith(
      content,
      "export const " + spec.table + " = sqliteTable"
    )
  ) {
    return null
  }
  return appendSection(
    content,
    wrapTsRegion(moduleRegionId(spec.name), renderDbTable(spec))
  )
}

/** API route import + 挂载（两处插入提交在同一个变更里；import 不打区块） */
export const registerApiRoutes: RegistrationTransform = (content, spec) => {
  const importLine =
    'from "./modules/' + spec.name + "/" + spec.name + '.route.js"'
  if (
    hasLineStartingWith(content, "import " + spec.camel + "Route " + importLine)
  ) {
    return null
  }
  // import 插在锚点前「最后一个非空行」之后（跳过锚点与 import 块之间的空行）：
  // 这样 eslint simple-import-sort 只移动 import 行本身，锚点前后的空行结构不变，
  // remove:module 删掉 import 后注册文件逐字节还原。
  const withImport = insertBeforeMarkerSkippingBlank(
    content,
    MARKERS.apiRouteImports,
    "import " +
      spec.camel +
      'Route from "./modules/' +
      spec.name +
      "/" +
      spec.name +
      '.route.js"\n',
    "apps/api/src/index.ts"
  )
  return insertAfterMarker(
    withImport,
    MARKERS.apiRouteMounts,
    wrapTsRegion(
      moduleRegionId(spec.name),
      "  app.route(" + quote(spec.apiPath) + ", " + spec.camel + "Route)\n"
    ),
    "apps/api/src/index.ts"
  )
}

/** 前端 query key 工厂 */
export const registerQueryKeys: RegistrationTransform = (content, spec) => {
  if (hasLineStartingWith(content, "export const " + spec.camel + "Keys = {")) {
    return null
  }
  const block = `export const ${spec.camel}Keys = {
  all: [${quote(spec.table)}] as const,
  lists: () => [...${spec.camel}Keys.all, "list"] as const,
  list: (params?: Record<string, unknown>) =>
    [...${spec.camel}Keys.lists(), params ?? {}] as const,
  details: () => [...${spec.camel}Keys.all, "detail"] as const,
  detail: (id: string | number) => [...${spec.camel}Keys.details(), id] as const,
}

`
  return insertAfterMarker(
    content,
    MARKERS.queryKeys,
    wrapTsRegion(moduleRegionId(spec.name), block),
    "web/lib/query-keys.ts"
  )
}

/** App.tsx：懒加载声明 + 路由节点（arch:check 的页面 lazy 规则依赖 App.tsx 内 import()） */
export const registerAppRoute: RegistrationTransform = (content, spec) => {
  const lazyPrefix = "const " + spec.pascal + "Page = lazy("
  if (hasLineStartingWith(content, lazyPrefix)) return null
  const id = moduleRegionId(spec.name)
  const lazyBlock = wrapTsRegion(
    id,
    "const " +
      spec.pascal +
      'Page = lazy(() => import("@/pages/' +
      spec.name +
      "/" +
      spec.pascal +
      'Page"))\n'
  )
  const withLazy = insertAfterMarker(
    content,
    MARKERS.appLazyImports,
    lazyBlock,
    "App.tsx"
  )
  const routeBlock = `              <Route
                path=${quote(spec.routePath)}
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <${spec.pascal}Page />
                  </Suspense>
                }
              />
`
  // 路由节点位于 JSX 子节点，必须用 {/* #region ... */} 注释（// 注释会变成渲染文本）
  return insertBeforeMarker(
    withLazy,
    MARKERS.appRoutes,
    wrapJsxRegion(id, routeBlock),
    "App.tsx"
  )
}

/** lucide-react 具名导入块追加图标（按字母序插入，保持仓库 import 风格） */
export function addLucideIcon(content: string, icon: string): string {
  const importRe = /import \{([\s\S]*?)\} from "lucide-react"/
  const match = importRe.exec(content)
  if (!match) {
    throw new GenModuleError(
      'web/lib/menu-config.ts 缺少 import { ... } from "lucide-react"'
    )
  }
  const names = match[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
  if (names.some((name) => name === icon || name === "type " + icon)) {
    return content
  }
  const sorted = [...names, icon].sort((a, b) =>
    a.replace(/^type /, "").localeCompare(b.replace(/^type /, ""))
  )
  const replaced = `import {\n${sorted.map((name) => "  " + name + ",").join("\n")}\n} from "lucide-react"`
  return (
    content.slice(0, match.index) +
    replaced +
    content.slice(match.index + match[0].length)
  )
}

/**
 * 确保 menu-config 存在 `PERMISSIONS` 值导入。
 *
 * scaffold 的 --clean-audit-log 在删除 Admin 分组并跑 imports:prune 后，会把 shared 导入
 * 精简成 `import { type PermissionCode } from "shared"`（或旧版 `import type { PermissionCode }`）；
 * 生成器随后插入的菜单项要用 PERMISSIONS 值，这里必须补回（类型导入需保留 type 修饰符，
 * verbatimModuleSyntax 下才合法）。
 */
export function ensurePermissionsValueImport(content: string): string {
  if (/import \{[^}]*\bPERMISSIONS\b[^}]*\} from "shared"/.test(content)) {
    return content
  }
  const sharedImport = /import (?:type )?\{([^}]*)\} from "shared"/
  const match = sharedImport.exec(content)
  if (match) {
    const names = match[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => (name.startsWith("type ") ? name : "type " + name))
    const replaced = `import { ${[...names, "PERMISSIONS"].join(", ")} } from "shared"`
    return (
      content.slice(0, match.index) +
      replaced +
      content.slice(match.index + match[0].length)
    )
  }
  const lucideImport = /import \{[\s\S]*?\} from "lucide-react"\n/
  const lazyImport = lucideImport.exec(content)
  if (lazyImport) {
    const insertAt = lazyImport.index + lazyImport[0].length
    return (
      content.slice(0, insertAt) +
      'import { PERMISSIONS } from "shared"\n' +
      content.slice(insertAt)
    )
  }
  throw new GenModuleError(
    "web/lib/menu-config.ts 缺少 shared 导入，无法登记权限菜单项"
  )
}

/** 菜单：图标 + Business 分组内菜单项（首次生成时创建分组容器区块） */
export const registerMenu: RegistrationTransform = (content, spec) => {
  if (hasLineStartingWith(content, "path: " + quote(spec.routePath) + ",")) {
    return null
  }
  const withIcon = addLucideIcon(content, spec.icon)
  const withPermissions = ensurePermissionsValueImport(withIcon)
  const id = moduleRegionId(spec.name)
  const menuItem = wrapTsRegion(
    id,
    `      {
        title: ${quote(spec.label)},
        path: ${quote(spec.routePath)},
        icon: ${spec.icon},
        keywords: ${quote(spec.label + " " + spec.name + " " + MENU_GROUP_LABEL)},
        englishSub: ${quote(spec.pascal)},
        permission: PERMISSIONS.${spec.upper}_VIEW,
      },
`,
    "      "
  )
  if (withPermissions.includes(MARKERS.menuItems)) {
    return insertBeforeMarker(
      withPermissions,
      MARKERS.menuItems,
      menuItem,
      "web/lib/menu-config.ts"
    )
  }
  // 首个模块直接落位、锚点置于其后：后续模块插到锚点前即可保持「生成顺序 = 菜单顺序」。
  // 分组外层包 gen:group:Business 容器区块：全部业务模块卸载后由 stripEmptyGroupRegions 收起。
  const groupId = menuGroupRegionId(MENU_GROUP_LABEL)
  const group = `  // #region ${groupId}
  {
    label: ${quote(MENU_GROUP_LABEL)},
    items: [
${menuItem}      // [gen:module:menu-items] 由 bun run gen:module 追加业务模块菜单项（勿手改本行）
    ],
  },
  // #endregion ${groupId}
`
  return insertBeforeMarker(
    withPermissions,
    MARKERS.menuGroups,
    group,
    "web/lib/menu-config.ts"
  )
}

/**
 * 后端域注册点（5 个，与端无关）：权限码 / 审计标签 / shared 导出 / 表结构 / API 挂载。
 * 一个模块只注册一次——`--app` 切片模式**根本不调用本数组**，靠代码路径物理隔离
 * 保证不会重复注册权限码与表。
 */
const BACKEND_REGISTRATIONS: Array<{
  relPath: string
  transform: RegistrationTransform
}> = [
  {
    relPath: "packages/shared/src/permissions.ts",
    transform: registerPermissions,
  },
  { relPath: "packages/shared/src/audit.ts", transform: registerAudit },
  { relPath: "packages/shared/src/index.ts", transform: registerSharedExports },
  { relPath: "apps/api/src/db/schema.ts", transform: registerDbTable },
  { relPath: "apps/api/src/index.ts", transform: registerApiRoutes },
]

/** 某端的前端切片注册点（3 个）：query key / 路由 / 菜单。 */
function webSliceRegistrations(appId: string): Array<{
  relPath: string
  transform: RegistrationTransform
}> {
  return [
    {
      relPath: "apps/" + appId + "/src/lib/query-keys.ts",
      transform: registerQueryKeys,
    },
    { relPath: "apps/" + appId + "/src/App.tsx", transform: registerAppRoute },
    {
      relPath: "apps/" + appId + "/src/lib/menu-config.ts",
      transform: registerMenu,
    },
  ]
}

/** 全部注册点（顺序无关；同一文件多个转换按声明顺序串联） */
const REGISTRATIONS: Array<{
  relPath: string
  transform: RegistrationTransform
}> = [...BACKEND_REGISTRATIONS, ...webSliceRegistrations(DEFAULT_WEB_APP_ID)]

/**
 * 计算注册点文件变更（纯函数：读取函数注入，便于单测）。
 * 已注册过的目标返回 null → 不产生变更（幂等）。
 *
 * `scope.app` 非空 = 切片模式，只算该端的 3 个前端注册点；缺省 = 后端域 + 默认端切片。
 */
export function renderRegistrationChanges(
  spec: ModuleSpec,
  read: (relPath: string) => string | null,
  scope?: { app?: string }
): FileChange[] {
  const registrations = scope?.app
    ? webSliceRegistrations(scope.app)
    : REGISTRATIONS
  const changes: FileChange[] = []
  for (const { relPath, transform } of registrations) {
    const before = read(relPath)
    if (before === null) {
      throw new GenModuleError(
        "找不到注册文件 " + relPath + "：当前目录不是 monorepo 模板仓库？"
      )
    }
    const after = transform(before, spec)
    if (after === null || after === before) continue
    changes.push({ relPath, before, after })
  }
  return changes
}

// ─── 已生成模块探测（--force 安全护栏）──────────────────────────────────────

/** 已生成模块的关键参数（用于阻止 --force 静默覆盖不同参数的模块） */
export interface ExistingModuleState {
  mode: ModuleMode
  /** 从 shared 文件头注释解析；缺失时为空串 */
  label: string
  /** 从 menu-config 菜单项解析；未注册时为 null */
  icon: string | null
}

/** 在 menu-config 中按路由路径定位菜单项，读取其 icon 名 */
function findMenuIcon(content: string, routePath: string): string | null {
  const lines = content.split("\n")
  const pathLine = "path: " + quote(routePath) + ","
  const index = lines.findIndex((line) => line.trimStart().startsWith(pathLine))
  if (index === -1) return null
  for (let offset = -3; offset <= 3; offset += 1) {
    const match = /icon: ([A-Za-z0-9]+)/.exec(lines[index + offset] ?? "")
    if (match) return match[1]
  }
  return null
}

/**
 * 探测磁盘上已有的生成模块（service 存在即视为已生成）。
 *
 * --force 只重写 9 个模块文件，不会重写已登记的权限/审计/菜单/表结构；
 * 参数变化（尤其 mode）时继续覆盖会得到自相矛盾的仓库，因此先探测再拦截。
 */
export function detectExistingModuleState(
  spec: ModuleSpec,
  read: (relPath: string) => string | null,
  appId = DEFAULT_WEB_APP_ID
): ExistingModuleState | null {
  const service = read(
    "apps/api/src/modules/" + spec.name + "/" + spec.name + ".service.ts"
  )
  if (!service) return null

  const shared = read("packages/shared/src/" + spec.name + ".ts")
  const labelMatch = shared ? /^ \* (.+?) — /m.exec(shared) : null
  const menu = read("apps/" + appId + "/src/lib/menu-config.ts")

  return {
    mode: service.includes("sortOrder") ? "sortable" : "crud",
    label: labelMatch?.[1]?.trim() ?? "",
    icon: menu ? findMenuIcon(menu, spec.routePath) : null,
  }
}

// ─── 落盘 / 自动化 ──────────────────────────────────────────────────────────

/** 仓库根目录（脚本固定在 <root>/scripts/ 下） */
export function resolveRepoRoot(): string {
  return path.resolve(import.meta.dirname ?? import.meta.dir, "..")
}

function readRepoFile(root: string, relPath: string): string | null {
  const fullPath = path.join(root, relPath)
  if (!existsSync(fullPath)) return null
  return readFileSync(fullPath, "utf8")
}

function writeRepoFile(root: string, relPath: string, content: string): void {
  const fullPath = path.join(root, relPath)
  mkdirSync(path.dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content, "utf8")
}

/** 确认当前目录是 monorepo 模板仓库（flat 生成项目没有 apps/ 与 packages/） */
function assertMonorepoWorkspace(
  root: string,
  appId = DEFAULT_WEB_APP_ID
): void {
  const required = [
    "package.json",
    "apps/" + appId + "/src/App.tsx",
    "apps/api/src/db/schema.ts",
    "packages/shared/src/index.ts",
  ]
  const missing = required.filter((rel) => !existsSync(path.join(root, rel)))
  if (missing.length > 0) {
    throw new GenModuleError(
      "当前目录不是 monorepo 模板仓库（缺少 " +
        missing.join("、") +
        "）：gen:module 只适用于 monorepo 形态"
    )
  }
}

interface RunResult {
  ok: boolean
  output: string
}

/** 同步执行子命令并收集输出（失败时由调用方决定报错文案） */
function runCommand(root: string, command: string, args: string[]): RunResult {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" })
  const output = (result.stdout ?? "") + (result.stderr ?? "")
  return { ok: result.status === 0, output: output.trim() }
}

/**
 * 解析 node_modules/.bin 下的可执行文件。
 *
 * Windows 上 npm/pnpm 生成 `.cmd`，而 Bun 生成 `.exe`（另有 `.bunx` 元数据），
 * 不能只按无后缀文件探测；POSIX 直接使用无后缀文件。
 */
function resolveNodeBin(nodeModules: string, name: string): string | null {
  const binDir = path.join(nodeModules, ".bin")
  const candidates =
    process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name]
  for (const candidate of candidates) {
    const fullPath = path.join(binDir, candidate)
    if (existsSync(fullPath)) return fullPath
  }
  return null
}

/**
 * 用仓库自带的 prettier / eslint 自动格式化生成代码：
 * 生成器模板不可能预知 simple-import-sort 的分组结果与 prettier 折行，交给工具统一。
 */
export function formatGeneratedFiles(root: string, relPaths: string[]): void {
  const rootNodeModules = path.join(root, "node_modules")
  const prettierBin = resolveNodeBin(rootNodeModules, "prettier")
  const eslintBin = resolveNodeBin(rootNodeModules, "eslint")
  if (!prettierBin || !eslintBin) {
    console.warn(
      "⚠️  未找到 node_modules/.bin/prettier 或 eslint（含 .exe/.cmd），跳过自动格式化（请先 bun install 后手动 bun run lint:fix）"
    )
    return
  }
  const codePaths = relPaths.filter(
    (relPath) => relPath.endsWith(".ts") || relPath.endsWith(".tsx")
  )
  const prettierPaths = relPaths.filter(
    (relPath) =>
      relPath.endsWith(".ts") ||
      relPath.endsWith(".tsx") ||
      relPath.endsWith(".md")
  )

  console.log("\n🎨 prettier --write ...")
  const prettier = runCommand(root, prettierBin, ["--write", ...prettierPaths])
  if (!prettier.ok) {
    throw new GenModuleError("prettier 格式化失败：\n" + prettier.output)
  }

  console.log("🧹 eslint --fix --no-cache ...")
  const eslint = runCommand(root, eslintBin, [
    "--fix",
    "--no-cache",
    ...codePaths,
  ])
  if (!eslint.ok) {
    throw new GenModuleError(
      "eslint --fix 后仍有错误，请按输出修复生成代码或注册文件：\n" +
        eslint.output
    )
  }
}

/**
 * 重新编译 packages/shared（dist/index.js + dist/index.d.ts）。
 *
 * apps/api 与 apps/web 通过 packages/shared/package.json 的 exports 解析到 dist/：
 * 生成器更新 shared/src 后立即重编 dist，保证紧接着跑单测或 typecheck 能读到新契约。
 */
export function buildSharedPackage(root: string): void {
  const tscBin = [
    path.join(root, "packages", "shared", "node_modules"),
    path.join(root, "apps", "api", "node_modules"),
    path.join(root, "apps", "web", "node_modules"),
    path.join(root, "node_modules"),
  ]
    .map((nodeModules) => resolveNodeBin(nodeModules, "tsc"))
    .find((candidate): candidate is string => candidate !== null)
  if (!tscBin) {
    console.warn(
      "⚠️  未找到 tsc（含 .exe/.cmd），跳过 shared 构建（请先 bun install 后运行 bun run build:shared）"
    )
    return
  }
  console.log("📦 tsc -p packages/shared/tsconfig.json ...")
  const result = runCommand(root, tscBin, [
    "-p",
    "packages/shared/tsconfig.json",
  ])
  if (!result.ok) {
    throw new GenModuleError("packages/shared 构建失败：\n" + result.output)
  }
}

/** 按仓库形态同步数据库结构来源（模板 init.sql / 生成项目 drizzle 迁移） */
export function syncDatabaseStructure(root: string): void {
  const initSql = path.join(root, "apps", "api", "init.sql")
  const drizzleJournal = path.join(
    root,
    "apps",
    "api",
    "drizzle",
    "meta",
    "_journal.json"
  )

  if (existsSync(initSql)) {
    console.log("\n🔄 模板仓库：重新生成 apps/api/init.sql ...")
    const result = runCommand(root, process.execPath, [
      "--filter",
      "api",
      "db:init:generate",
    ])
    if (!result.ok) {
      throw new GenModuleError("db:init:generate 失败：\n" + result.output)
    }
    return
  }

  if (existsSync(drizzleJournal)) {
    console.log("\n🔄 生成项目：生成 drizzle 迁移 ...")
    const result = runCommand(root, process.execPath, [
      "--filter",
      "api",
      "db:generate",
    ])
    if (!result.ok) {
      throw new GenModuleError("db:generate 失败：\n" + result.output)
    }
    return
  }

  console.warn(
    "⚠️  未找到数据库结构来源（apps/api/init.sql 或 apps/api/drizzle/meta/_journal.json），跳过结构同步"
  )
}

function printNextSteps(spec: ModuleSpec): void {
  const routeTest = "cd apps/api && bun test src/modules/" + spec.name + "/"
  console.log(
    [
      "",
      "✅ 生成完成。后续步骤：",
      "  1. 应用新表到本地开发库：生成项目用 bun --filter api db:migrate（增量、不清数据）；模板仓库用 bun run db:reset（会清空本地数据）",
      "  2. 对照 docs/specs/" +
        spec.name +
        ".md 的 5 要素补充真实字段、业务不变量与页面列",
      "  3. 跑全量门禁：bun run check",
      "  4. 只跑生成模块接口测试：" + routeTest,
      "",
      "提示：",
      "  - 权限已注册到 PERMISSION_REGISTRY（admin 自动持有全量）；普通角色需在",
      "    shared/permissions.ts 的 ROLE_PERMISSIONS 中显式授予 " +
        spec.permissionView +
        " / " +
        spec.permissionEdit,
      "  - 审计模块已注册（" +
        spec.auditModule +
        "），审计日志页筛选下拉自动出现",
      "  - 菜单挂到 menu-config.ts 的 Business 分组，页面路由已按 React.lazy 注册",
      "  - 废弃模块用对称卸载：bun run remove:module --name " + spec.name,
    ].join("\n")
  )
}

/** 切片模式的后续步骤（后端域未改动，所以不提数据库同步与权限注册） */
function printSliceNextSteps(spec: ModuleSpec, appId: string): void {
  const pageDir = "apps/" + appId + "/src/pages/" + spec.name + "/"
  console.log(
    [
      "",
      '✅ 已为端 "' +
        appId +
        '" 生成 ' +
        spec.label +
        " 前端切片（复用既有后端域，未改动）。后续步骤：",
      "  1. 在 docs/specs/" +
        spec.name +
        ".md 的交互功能块补上本端页面路径：" +
        pageDir,
      "  2. 跑全量门禁：bun run check",
      "  3. 只跑本端前端测试：cd apps/" + appId + " && bunx vitest run",
      "",
      "提示：",
      "  - 权限码 / 审计标签 / 表结构 / API 路由全部复用既有后端域，本次未重复注册",
      "  - 菜单可见性由模块权限码控制，与端准入 app:" +
        appId +
        " 是两道独立门（进得了端不一定看得到模块）",
      "  - 只拆本端切片：bun run remove:module --name " +
        spec.name +
        " --app " +
        appId,
    ].join("\n")
  )
}

/**
 * 切片模式：只在指定端生成前端切片，复用已存在的后端域。
 *
 * 后端域不存在时**报错而非顺带创建**：前端形状由 mode 决定，后端不存在时无从推断；
 * 且 label / icon / mode 的事实源就是后端域，复用它才能保证各端切片的权限码、
 * query key 形状、service URL 完全一致。
 */
function generateWebSlice(options: GenModuleCliOptions, root: string): void {
  const appId = options.app
  const apps = readWebApps(root)
  if (!apps.some((app) => app.id === appId)) {
    throw new GenModuleError(
      '端 "' +
        appId +
        '" 未在 web-apps.json 注册（已注册：' +
        apps.map((app) => app.id).join("、") +
        "）。\n先增端：bun run add:web --id " +
        appId +
        ' --title "端名称"'
    )
  }
  assertMonorepoWorkspace(root, appId)

  // 先用宽松校验派生 name/pascal（label 可缺省，稍后从后端域继承）
  const probe = buildSpec({
    name: options.name,
    label: "-",
    validateLabel: false,
  })
  const read = (relPath: string) => readRepoFile(root, relPath)
  const existing = detectExistingModuleState(probe, read)
  if (!existing) {
    throw new GenModuleError(
      "模块 " +
        probe.name +
        " 的后端域不存在，--app 只生成前端切片、不会顺带创建后端域。\n\n" +
        "请先建后端域（同时生成默认端切片），再为本端生成切片：\n" +
        "  bun run gen:module --name " +
        probe.name +
        ' --label "中文名"\n' +
        "  bun run gen:module --name " +
        probe.name +
        " --app " +
        appId
    )
  }
  if (options.modeExplicit && options.mode !== existing.mode) {
    throw new GenModuleError(
      "模式冲突：后端域是 " +
        existing.mode +
        "，--mode 传的是 " +
        options.mode +
        "。同一模块的各端切片必须同模式（共用契约与 API）。\n" +
        "去掉 --mode 即自动沿用后端域的 " +
        existing.mode +
        "；确实要换模式请先 remove:module 再重新生成。"
    )
  }
  const label = options.label.trim() || existing.label
  if (!label) {
    throw new GenModuleError(
      "后端域未记录 label（shared 文件头注释被改过），请显式传 --label"
    )
  }
  const icon = options.iconExplicit
    ? options.icon
    : (existing.icon ?? "FileText")
  const spec = buildSpec({
    name: options.name,
    label,
    icon,
    mode: existing.mode,
  })
  assertIconExists(spec.icon, root)

  const files = renderWebSliceFiles(spec, appId)
  const existingFiles = files.filter((file) =>
    existsSync(path.join(root, file.relPath))
  )
  if (existingFiles.length > 0 && !options.force) {
    throw new GenModuleError(
      "端 " +
        appId +
        " 已有该模块切片（重新生成请加 --force，或先 remove:module --app " +
        appId +
        "）：\n" +
        existingFiles.map((file) => "  - " + file.relPath).join("\n")
    )
  }

  const registrationChanges = renderRegistrationChanges(spec, read, {
    app: appId,
  })

  console.log(
    "🧩 gen:module（切片）：" +
      spec.label +
      "（" +
      spec.name +
      "，模式 " +
      spec.mode +
      "）→ 端 " +
      appId
  )
  printPlan(files, registrationChanges)

  if (options.dryRun) {
    console.log("\n--dry-run：未写入任何文件。")
    return
  }

  const backups = new Map<string, string | null>()
  for (const file of files) {
    backups.set(file.relPath, readRepoFile(root, file.relPath))
  }
  for (const change of registrationChanges) {
    backups.set(change.relPath, change.before)
  }

  try {
    for (const file of files) writeRepoFile(root, file.relPath, file.content)
    for (const change of registrationChanges) {
      writeRepoFile(root, change.relPath, change.after)
    }
    console.log(
      "\n✅ 已写入 " +
        files.length +
        " 个切片文件，更新 " +
        registrationChanges.length +
        " 个本端注册文件（后端域未改动）。"
    )

    const touchedPaths = [
      ...files.map((file) => file.relPath),
      ...registrationChanges.map((change) => change.relPath),
    ]
    if (options.skipFormat) {
      console.log("\n⏭️  --skip-format：跳过 prettier / eslint --fix")
    } else {
      formatGeneratedFiles(root, touchedPaths)
    }

    // 后端域未变，但 shared 的 dist 仍需新鲜（本端 service/hooks 会 import 它）
    buildSharedPackage(root)
    console.log(
      "⏭️  切片模式：跳过数据库结构同步（表结构属后端域，本次未改动）"
    )
  } catch (error) {
    rollbackWrites(root, backups)
    try {
      buildSharedPackage(root)
    } catch {
      // 回滚后重编 shared 为 best-effort
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new GenModuleError(
      message + "\n\n↩️  已回滚本次生成的文件改动（工作区恢复到生成前状态）。"
    )
  }

  printSliceNextSteps(spec, appId)
}

/** 打印计划（dry-run 与正式执行共用） */
function printPlan(
  files: GeneratedFile[],
  registrationChanges: FileChange[]
): void {
  console.log("\n将创建以下文件：")
  for (const file of files) console.log("  + " + file.relPath)
  if (registrationChanges.length === 0) {
    console.log("\n注册点已是最新（幂等跳过）")
  } else {
    console.log("\n将更新以下注册文件：")
    for (const change of registrationChanges)
      console.log("  ~ " + change.relPath)
  }
}

/** 主流程（CLI 与测试共用；测试可注入 argv） */
export async function main(
  argv: string[] = process.argv.slice(2)
): Promise<void> {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(HELP_TEXT)
    return
  }

  // flag 组合护栏：--all-modules / --all-apps 都是破坏性操作的范围声明，
  // 不允许裸用或互相矛盾，避免「一次删掉所有模块的所有端」这种误操作。
  if (options.allModules && !options.remove) {
    throw new GenModuleError(
      "--all-modules 只用于卸载，请加 --remove（或直接用 remove:module）"
    )
  }
  if (options.allModules && !options.app) {
    throw new GenModuleError(
      "--all-modules 必须与 --app <id> 同时使用：它只清空一个端的切片，裸用会波及所有端"
    )
  }
  if (options.allApps && !options.remove) {
    throw new GenModuleError("--all-apps 只用于卸载，请加 --remove")
  }
  if (options.allApps && options.app) {
    throw new GenModuleError(
      "--all-apps 用于全域卸载（不带 --app）；只拆单端切片请直接 --app <id>"
    )
  }

  const root = resolveRepoRoot()

  // 卸载模式：只要求 --name（label / icon / mode 无需传入）。动态 import 避免
  // remove.ts ⇄ gen-module.ts 的静态循环依赖（remove.ts 需要复用本文件的
  // GenModuleError / formatGeneratedFiles / buildSharedPackage / syncDatabaseStructure）。
  if (options.remove) {
    const { removeModule, removeAllAppModuleSlices } =
      await import("./gen-module/remove")
    if (options.allModules) {
      await removeAllAppModuleSlices({
        root,
        app: options.app,
        dryRun: options.dryRun,
        force: options.force,
        skipFormat: options.skipFormat,
      })
      return
    }
    await removeModule({
      root,
      name: options.name,
      app: options.app,
      allApps: options.allApps,
      dryRun: options.dryRun,
      purgeSpec: options.purgeSpec,
      force: options.force,
      skipFormat: options.skipFormat,
      skipDb: options.skipDb,
    })
    return
  }

  // 切片模式：只在指定端生成前端切片，后端域必须已存在
  if (options.app) {
    generateWebSlice(options, root)
    return
  }

  const spec = buildSpec(options)
  assertMonorepoWorkspace(root)
  assertIconExists(spec.icon, root)

  const codeFiles = renderModuleFiles(spec)
  const existingFiles = codeFiles.filter((file) =>
    existsSync(path.join(root, file.relPath))
  )
  if (existingFiles.length > 0 && !options.force) {
    throw new GenModuleError(
      "以下文件已存在（重新生成请加 --force，或用其它 --name）：\n" +
        existingFiles.map((file) => "  - " + file.relPath).join("\n")
    )
  }

  // 若 docs/specs/<name>.md 尚不存在则自动初始化；若已存在（如 Step 1 已由 AI/人工先创建）则保留不覆盖
  const specDoc = renderSpecDoc(spec)
  const hasExistingSpecDoc = existsSync(path.join(root, specDoc.relPath))
  const files = hasExistingSpecDoc ? codeFiles : [...codeFiles, specDoc]

  // --force 只覆盖生成文件，不重写已登记的权限/审计/菜单/表结构：
  // mode / label / icon 变化时静默覆盖会得到 registry 与代码不一致的仓库，直接拦截。
  if (existingFiles.length > 0 && options.force) {
    const existing = detectExistingModuleState(spec, (relPath) =>
      readRepoFile(root, relPath)
    )
    if (existing) {
      const mismatches: string[] = []
      if (existing.mode !== spec.mode) {
        mismatches.push("mode: " + existing.mode + " → " + spec.mode)
      }
      if (existing.label && existing.label !== spec.label) {
        mismatches.push("label: " + existing.label + " → " + spec.label)
      }
      if (existing.icon && existing.icon !== spec.icon) {
        mismatches.push("icon: " + existing.icon + " → " + spec.icon)
      }
      if (mismatches.length > 0) {
        throw new GenModuleError(
          "已存在参数不同的生成模块，--force 不会重写已注册的权限/审计/菜单/表结构：\n" +
            mismatches.map((item) => "  - " + item).join("\n") +
            "\n\n请用相同参数重跑，或先用 remove:module 卸载旧模块后重新生成：\n" +
            "  bun run remove:module --name " +
            spec.name +
            "\n  （等价：bun run gen:module --name " +
            spec.name +
            " --remove；执行前会做反向引用预检）"
        )
      }
    }
  }

  const registrationChanges = renderRegistrationChanges(spec, (relPath) =>
    readRepoFile(root, relPath)
  )

  console.log(
    "🧩 gen:module：" +
      spec.label +
      "（" +
      spec.name +
      "，模式 " +
      spec.mode +
      "）"
  )
  printPlan(files, registrationChanges)
  if (hasExistingSpecDoc) {
    console.log("\n📄 保留已有业务规格书：" + specDoc.relPath + "（不覆盖）")
  }

  if (options.dryRun) {
    console.log("\n--dry-run：未写入任何文件。")
    return
  }

  // 写入前记录快照：后续格式化 / 数据库结构同步失败时整体回滚，避免半成品仓库。
  const backups = new Map<string, string | null>()
  for (const file of files) {
    backups.set(file.relPath, readRepoFile(root, file.relPath))
  }
  for (const change of registrationChanges) {
    backups.set(change.relPath, change.before)
  }

  try {
    for (const file of files) writeRepoFile(root, file.relPath, file.content)
    for (const change of registrationChanges) {
      writeRepoFile(root, change.relPath, change.after)
    }
    console.log(
      "\n✅ 已写入 " +
        files.length +
        " 个文件，更新 " +
        registrationChanges.length +
        " 个注册文件。"
    )

    const touchedPaths = [
      ...files.map((file) => file.relPath),
      ...registrationChanges.map((change) => change.relPath),
    ]
    if (options.skipFormat) {
      console.log("\n⏭️  --skip-format：跳过 prettier / eslint --fix")
    } else {
      formatGeneratedFiles(root, touchedPaths)
    }

    buildSharedPackage(root)

    if (options.skipDb) {
      console.log(
        "⏭️  --skip-db：跳过数据库结构同步（记得手动重新生成 init.sql / drizzle 迁移）"
      )
    } else {
      syncDatabaseStructure(root)
    }
  } catch (error) {
    rollbackWrites(root, backups)
    try {
      buildSharedPackage(root)
    } catch {
      // 回滚后重编 shared 为 best-effort
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new GenModuleError(
      message + "\n\n↩️  已回滚本次生成的文件改动（工作区恢复到生成前状态）。"
    )
  }

  printNextSteps(spec)
}

/** 生成文件路径清单（生成器错误提示 / remove:module 删除清单共用） */
export function generatedPathList(
  spec: ModuleSpec,
  appId = DEFAULT_WEB_APP_ID
): string {
  const appSrc = "apps/" + appId + "/src/"
  return [
    "packages/shared/src/" + spec.name + ".ts",
    "apps/api/src/modules/" + spec.name + "/",
    appSrc + "services/" + spec.name + ".ts",
    appSrc + "hooks/queries/use" + spec.pascal + ".ts",
    appSrc + "pages/" + spec.name + "/",
    "docs/specs/" + spec.name + ".md",
  ].join("、")
}

/** 后端域注册点清单（5 个，与端无关） */
export const BACKEND_REGISTRATION_FILES = [
  "packages/shared/src/permissions.ts",
  "packages/shared/src/audit.ts",
  "packages/shared/src/index.ts",
  "apps/api/src/db/schema.ts",
  "apps/api/src/index.ts",
]

/** 某端的前端切片注册点清单（3 个） */
export function webSliceRegistrationFiles(appId: string): string[] {
  const appSrc = "apps/" + appId + "/src/"
  return [
    appSrc + "lib/query-keys.ts",
    appSrc + "App.tsx",
    appSrc + "lib/menu-config.ts",
  ]
}

/**
 * 注册点文件清单（8 个：remove:module 遍历剥离区块；生成器错误提示共用）。
 * 顺序 = 后端域 5 个 + 默认端切片 3 个，与历史形态逐字节一致。
 */
export const REGISTRATION_FILE_LIST = [
  ...BACKEND_REGISTRATION_FILES,
  ...webSliceRegistrationFiles(DEFAULT_WEB_APP_ID),
]

/** 回滚写入：content === null 表示本次新建的文件，直接删除 */
export function rollbackWrites(
  root: string,
  backups: Map<string, string | null>
): void {
  const createdDirs = new Set<string>()
  for (const [relPath, content] of backups) {
    try {
      if (content === null) {
        rmSync(path.join(root, relPath), { force: true })
        for (
          let dir = path.dirname(relPath);
          dir !== "." && dir !== path.sep;
          dir = path.dirname(dir)
        ) {
          createdDirs.add(dir)
        }
      } else {
        writeFileSync(path.join(root, relPath), content, "utf8")
      }
    } catch {
      // 回滚是 best-effort：单文件失败不阻断其它文件恢复
    }
  }

  // 只删空目录（rmdirSync 非空即抛），由深到浅收敛。残留空目录会被
  // arch:check 当成缺规格书的业务模块，把一次失败回滚变成持续报错。
  for (const dir of [...createdDirs].sort(
    (a, b) => b.split(path.sep).length - a.split(path.sep).length
  )) {
    try {
      rmdirSync(path.join(root, dir))
    } catch {
      // 非空或不存在：说明还有其它内容，保留
    }
  }
}

// ─── CLI 入口 ───────────────────────────────────────────────────────────────

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    if (error instanceof GenModuleError) {
      console.error("\n❌ " + error.message)
      process.exit(1)
    }
    console.error(error)
    process.exit(1)
  }
}
