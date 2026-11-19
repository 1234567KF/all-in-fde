/**
 * `bun run add:web --id <id> --title <名称>` —— 新增一个 Web 端。
 *
 * 端样板 = **目标项目自己的默认端 `apps/web`**，不是另写一份空壳。默认端是过了门禁、
 * 最新、已按 init 选择剥过业务的应用样板；克隆它再改身份，新端天然与默认端同形，
 * 项目改了什么新端自动跟上，不存在「模板落后于项目」的平行维护轴。
 *
 * 与 `scripts/remove-web.ts` 成对：这里写入的 `web-app:<id>` 区块由那边 stripRegions
 * 剥离，区块 id 与注册文件清单是两者之间唯一的契约（同仓同 PR，改动必须同步）。
 *
 * 边界：
 *   - 只做「克隆 + 改身份 + 注册」，刻意不 install / 不格式化 / 不剥业务模块 / 不跑门禁：
 *     init 多端时这些只在最后跑一次，由调用方按 createdFiles / modifiedFiles 决定范围；
 *   - 克隆来的业务模块切片由调用方跑 `remove:module --app <id> --all-modules` 清掉；
 *   - 校验全部前置、写入全部后置，任一步失败整体回滚，绝不留半成品端。
 *
 * 只 import 项目内零依赖模块（node:fs / node:path + 三个纯 TS lib），因此
 * **`bun install` 之前就能执行**——init 的多端循环正是排在 install 之前。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { listRegions, MODULE_REGION_PREFIX } from "./lib/code-regions"
import {
  countRatchetLines,
  readLongFileRatchetEntries,
  upsertLongFileRatchetEntries,
} from "./lib/long-file-ratchet"
import {
  DEFAULT_WEB_APP_ID,
  parseWebApps,
  readWebApps,
  type WebApp,
} from "./lib/web-apps"

/** 端注册区块 id 前缀（与 remove-web.ts 的 REGION_PREFIX 一致） */
const REGION_PREFIX = "web-app:"
const REGISTRY_FILE = "web-apps.json"
const PERMISSIONS_FILE = "packages/shared/src/permissions.ts"
const PERMISSIONS_ANCHOR = "// [gen:module:permissions]"
const REGISTRY_ANCHOR = "// [gen:module:permission-registry]"
const DOCKERFILE_ANCHOR = "# [web-apps:dockerfile]"
const ARCH_CHECK_FILE = "scripts/arch-check.ts"

/** API 占用端口，Vite 不能与之冲突 */
const API_DEV_PORT = 3000
/** Windows 保留设备名：mkdir 会失败，必须在校验期挡掉而不是写入期报裸 ENOENT */
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/

/**
 * 克隆时排除的构建产物与本地状态（与 .gitignore 对齐）。
 * 不排除会把默认端的 dist / 覆盖率 / 增量快照带进新端，既脏又可能让门禁误判。
 */
const CLONE_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".vite",
  ".turbo",
  ".cache",
  ".git",
])
const CLONE_SKIP_FILES = new Set([
  ".eslintcache",
  ".DS_Store",
  "Thumbs.db",
])
const CLONE_SKIP_SUFFIXES = [
  ".tsbuildinfo",
  ".log",
  ".bun-build",
  ".db",
  ".sqlite",
  ".sqlite3",
]

export interface AddWebOptions {
  /** 目标项目根目录 */
  root: string
  id: string
  title: string
  /** 省略时为 /<id>/ */
  base?: string
  /** 省略时取现有端最大端口 +1 */
  devPort?: number
  /** true 时注册 app:<id> 准入权限码（拦截器在各端 SidebarLayout，经 env 注入） */
  restrictAccess?: boolean
  /** true 时仅复制工程底座并生成极简无登录/无侧边栏空壳（适合官网 / H5 / 大屏，与 restrictAccess 互斥） */
  blank?: boolean
  /** 只校验并打印计划，不落盘 */
  dryRun?: boolean
}

export interface AddWebResult {
  entry: WebApp
  /** 相对 root 的新建文件（posix 分隔） */
  createdFiles: string[]
  /** 相对 root 的改动文件（posix 分隔） */
  modifiedFiles: string[]
  /** 克隆继承来的业务模块名（调用方据此跑 remove:module --all-modules） */
  inheritedModules: string[]
  /** 克隆继承来的页面目录/文件名（供用户确认删留） */
  inheritedPages: string[]
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/")
}

/** 校验失败一律抛 Error（调用方负责打印并退出），保证校验期零副作用。 */
function fail(message: string): never {
  throw new Error(message)
}

/** base 归一化：补首尾斜杠（`portal` / `/portal` / `portal/` 都接受）。 */
function normalizeBase(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === "") fail("base 不能为空")
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`
}

/** HTML 文本节点转义：标题里的 & < > 会破坏静态文档结构。 */
function htmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function permissionKeyOf(id: string): string {
  return `APP_${id.toUpperCase().replaceAll("-", "_")}`
}

/**
 * 默认端已占用的一级路由。
 *
 * 各端产物是平级目录，文件系统不冲突，但 URL 会：默认端 base 是 "/"，
 * 它的 `/portal` 页面和新端的 `/portal/` 前缀在同一个 URL 空间里。
 */
function defaultAppFirstSegments(root: string): Set<string> {
  const appSrc = path.join(
    root,
    "apps",
    DEFAULT_WEB_APP_ID,
    "src",
    "App.tsx"
  )
  const segments = new Set<string>()
  if (!existsSync(appSrc)) return segments
  const source = readFileSync(appSrc, "utf8")
  for (const match of source.matchAll(/\bpath=["']([^"']+)["']/g)) {
    const segment = match[1].split("/").filter(Boolean)[0]
    if (segment && segment !== "*") segments.add(segment)
  }
  return segments
}

/** 在锚点行之后插入区块（锚点本身不动，剥离后逐字节还原）。 */
function insertAfterAnchor(
  source: string,
  anchor: string,
  block: string,
  file: string
): string {
  const lines = source.split("\n")
  const index = lines.findIndex((line) => line.trim().startsWith(anchor))
  if (index === -1) {
    fail(
      `${file} 缺少锚点 \`${anchor}\`：该文件来自旧版模板，请先跑 \`--mode add-ci --force\` 刷新。`
    )
  }
  lines.splice(index + 1, 0, ...block.split("\n"))
  return lines.join("\n")
}

// ─── 身份改写 ────────────────────────────────────────────────────────────────

interface IdentityContext {
  id: string
  title: string
  year: number
}

/**
 * 一处身份改写。`pattern` 必须在源内容里**恰好命中一次**（校验期就断言，
 * 把「改到一半才发现模板形态变了」提前到零副作用阶段）；`render` 产出替换文本；
 * 写入后断言替换文本确实落地，JSON 文件再加一条语义断言。
 *
 * 用正向断言而非「grep 不到 web」：正向同时覆盖「忘了改」与「改错值」，
 * 反向 grep 无法发现改成了第三个端的 id。
 */
interface IdentityEdit {
  /** 相对端目录的路径 */
  relPath: string
  label: string
  pattern: RegExp
  render: (ctx: IdentityContext, matched: string) => string
  /** 额外语义断言（缺省只断言 render 结果已写入） */
  verify?: (content: string, ctx: IdentityContext) => void
}

/** 把 match 里的旧端 id 字面量换成新 id（保留其余文本与格式）。 */
function swapIdLiteral(matched: string, id: string): string {
  return matched.replace(/"[^"]*"(\s*\))$/, `"${id}"$1`)
}

const IDENTITY_EDITS: IdentityEdit[] = [
  {
    relPath: "vite.config.ts",
    label: "vite APP_ID",
    pattern: /^const APP_ID = "([^"]+)"$/m,
    render: (ctx) => `const APP_ID = "${ctx.id}"`,
  },
  {
    relPath: "vitest.config.ts",
    label: "vitest readWebApp id",
    pattern: /readWebApp\([^\n]*,\s*"([^"]+)"\s*\)/,
    render: (ctx, matched) => swapIdLiteral(matched, ctx.id),
  },
  {
    relPath: "package.json",
    label: "workspace 包名",
    pattern: /"name":\s*"([^"]+)"/,
    render: (ctx, matched) =>
      matched.replace(/"[^"]*"$/, `"${ctx.id}"`),
    verify: (content, ctx) => {
      const name = (JSON.parse(content) as { name?: string }).name
      if (name !== ctx.id) {
        fail(`package.json 的 name 改写后为 ${JSON.stringify(name)}，应为 "${ctx.id}"`)
      }
    },
  },
  {
    relPath: "tsconfig.json",
    label: "tsBuildInfoFile",
    pattern: /"tsBuildInfoFile":\s*"([^"]+)"/,
    render: (ctx, matched) => {
      const value = /"([^"]+)"$/.exec(matched)?.[1] ?? ""
      // 只换文件名、保留目录：各端共用 .cache/tsc/ 但必须各写各的快照
      const next = value.replace(/[^/]*$/, `${ctx.id}.tsbuildinfo`)
      return matched.replace(/"[^"]+"$/, JSON.stringify(next))
    },
    verify: (content, ctx) => {
      const file = (
        JSON.parse(content) as {
          compilerOptions?: { tsBuildInfoFile?: string }
        }
      ).compilerOptions?.tsBuildInfoFile
      if (path.basename(file ?? "") !== `${ctx.id}.tsbuildinfo`) {
        fail(
          `tsconfig.json 的 tsBuildInfoFile 改写后为 ${JSON.stringify(file)}，文件名应为 "${ctx.id}.tsbuildinfo"`
        )
      }
    },
  },
  {
    relPath: "index.html",
    label: "静态 title",
    pattern: /<title>[\s\S]*?<\/title>/,
    render: (ctx) => `<title>${htmlText(ctx.title)}</title>`,
  },
  {
    relPath: "src/lib/app-config.ts",
    label: "APP_NAME",
    pattern: /^export const APP_NAME = .*$/m,
    render: (ctx) => `export const APP_NAME = ${JSON.stringify(ctx.title)}`,
  },
  {
    relPath: "src/lib/app-config.ts",
    label: "APP_TITLE",
    pattern: /^export const APP_TITLE = .*$/m,
    render: (ctx) => `export const APP_TITLE = ${JSON.stringify(ctx.title)}`,
  },
  {
    relPath: "src/lib/app-config.ts",
    label: "APP_COPYRIGHT",
    pattern: /^export const APP_COPYRIGHT = .*$/m,
    render: (ctx) =>
      `export const APP_COPYRIGHT = ${JSON.stringify(`© ${ctx.year} ${ctx.title}`)}`,
  },
]

/** 源端必须存在的文件（缺任一说明默认端不完整，克隆会得到坏端）。 */
const SOURCE_REQUIRED = [
  "src/App.tsx",
  "vite.config.ts",
  "vitest.config.ts",
  "package.json",
  "tsconfig.json",
  "index.html",
  "src/lib/app-config.ts",
]

/** `--blank` 保留的底座源文件（仅配置/样式/挂载入口，跳过所有 PC 布局与演示页面）。 */
const BLANK_KEEP_SRC_FILES = new Set([
  "src/index.css",
  "src/main.tsx",
  "src/vite-env.d.ts",
  "src/test/setup.ts",
  "src/lib/app-config.ts",
])

/** `--blank` 生成的极简可运行壳（严格满足 ESLint、Prettier 与 arch-check）。 */
function buildBlankTemplates(): Record<string, string> {
  return {
    "src/App.tsx": [
      'import PageSkeleton from "@workspace/ui/components/shared/PageSkeleton"',
      'import { lazy, Suspense } from "react"',
      'import { Route, Routes } from "react-router-dom"',
      'import { Toaster } from "sonner"',
      "",
      'const HomePage = lazy(() => import("@/pages/HomePage"))',
      'const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"))',
      "",
      "export default function App() {",
      "  return (",
      "    <>",
      "      <Routes>",
      "        <Route",
      '          path="/"',
      "          element={",
      '            <Suspense fallback={<PageSkeleton />}>',
      "              <HomePage />",
      "            </Suspense>",
      "          }",
      "        />",
      "        <Route",
      '          path="*"',
      "          element={",
      '            <Suspense fallback={<PageSkeleton />}>',
      "              <NotFoundPage />",
      "            </Suspense>",
      "          }",
      "        />",
      "      </Routes>",
      '      <Toaster richColors position="top-right" />',
      "    </>",
      "  )",
      "}",
      "",
    ].join("\n"),
    "src/pages/HomePage.tsx": [
      'import { APP_NAME } from "@/lib/app-config"',
      "",
      "export default function HomePage() {",
      "  return (",
      '    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center justify-center gap-3 px-6 py-10 text-center">',
      "      <h1",
      '        className="text-2xl font-bold tracking-tight"',
      '        style={{ color: "var(--lg-text-primary)" }}',
      "      >",
      "        {APP_NAME}",
      "      </h1>",
      '      <p className="text-sm" style={{ color: "var(--lg-text-secondary)" }}>',
      "        独立空壳已就绪，请按本端场景（H5 / 官网 / 大屏）编写布局与页面。",
      "      </p>",
      "    </main>",
      "  )",
      "}",
      "",
    ].join("\n"),
    "src/pages/NotFoundPage.tsx": [
      'import { Button } from "@workspace/ui/components/ui/button"',
      'import { Link } from "react-router-dom"',
      "",
      "export default function NotFoundPage() {",
      "  return (",
      '    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-10 text-center">',
      "      <h1",
      '        className="text-2xl font-bold"',
      '        style={{ color: "var(--lg-text-primary)" }}',
      "      >",
      "        页面不存在",
      "      </h1>",
      '      <p className="text-sm" style={{ color: "var(--lg-text-secondary)" }}>',
      "        请检查访问地址是否正确。",
      "      </p>",
      "      <Button asChild>",
      '        <Link to="/">返回首页</Link>',
      "      </Button>",
      "    </main>",
      "  )",
      "}",
      "",
    ].join("\n"),
    "src/App.test.tsx": [
      'import { QueryClientProvider } from "@tanstack/react-query"',
      'import { render, screen } from "@testing-library/react"',
      'import { ThemeProvider } from "@workspace/ui/components/providers/theme-provider"',
      'import { queryClient } from "@workspace/web-core/lib/query"',
      'import { MemoryRouter } from "react-router-dom"',
      'import { describe, expect, it } from "vitest"',
      "",
      'import { APP_NAME } from "@/lib/app-config"',
      "",
      'import App from "./App"',
      "",
      "function renderBlankApp(initialPath: string) {",
      "  return render(",
      "    <QueryClientProvider client={queryClient}>",
      "      <MemoryRouter initialEntries={[initialPath]}>",
      '        <ThemeProvider defaultTheme="system">',
      "          <App />",
      "        </ThemeProvider>",
      "      </MemoryRouter>",
      "    </QueryClientProvider>",
      "  )",
      "}",
      "",
      'describe("空白端路由冒烟测试", () => {',
      '  it("根路径渲染端标题占位页", async () => {',
      '    renderBlankApp("/")',
      "    expect(",
      '      await screen.findByRole("heading", { name: APP_NAME })',
      "    ).toBeInTheDocument()",
      "  })",
      "",
      '  it("未命中路由回退到 404", async () => {',
      '    renderBlankApp("/unknown-route")',
      "    expect(",
      '      await screen.findByRole("heading", { name: "页面不存在" })',
      "    ).toBeInTheDocument()",
      "  })",
      "})",
      "",
    ].join("\n"),
  }
}

// ─── 克隆 ────────────────────────────────────────────────────────────────────

function shouldSkipClone(name: string, isDir: boolean): boolean {
  if (isDir) return CLONE_SKIP_DIRS.has(name)
  if (CLONE_SKIP_FILES.has(name)) return true
  return CLONE_SKIP_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

/** 枚举默认端里会被克隆的文件（相对端目录的 posix 路径，已排除产物）。 */
function listCloneFiles(root: string, sourceId: string): string[] {
  const sourceDir = path.join(root, "apps", sourceId)
  const files: string[] = []
  const walk = (relDir: string): void => {
    for (const entry of readdirSync(path.join(sourceDir, relDir), {
      withFileTypes: true,
    })) {
      if (shouldSkipClone(entry.name, entry.isDirectory())) continue
      const rel = relDir ? path.join(relDir, entry.name) : entry.name
      if (entry.isDirectory()) {
        walk(rel)
        continue
      }
      files.push(toPosix(rel))
    }
  }
  walk("")
  return files.sort()
}

/** `--blank`：保留端工程底座与基础样式入口，替换为极简无登录空白页文件清单。 */
function listBlankFiles(root: string, sourceId: string): {
  kept: string[]
  templates: Record<string, string>
  planned: string[]
} {
  const kept = listCloneFiles(root, sourceId).filter(
    (rel) => !rel.startsWith("src/") || BLANK_KEEP_SRC_FILES.has(rel)
  )
  const templates = buildBlankTemplates()
  const planned = [...new Set([...kept, ...Object.keys(templates)])].sort()
  return { kept, templates, planned }
}

/** 递归克隆默认端或生成极简空壳；返回新建文件的仓库相对 posix 路径。 */
function cloneApp(
  root: string,
  sourceId: string,
  targetId: string,
  blank: boolean
): string[] {
  const sourceDir = path.join(root, "apps", sourceId)
  const targetDir = path.join(root, "apps", targetId)
  if (!blank) {
    const files = listCloneFiles(root, sourceId)
    for (const rel of files) {
      const dest = path.join(targetDir, rel)
      mkdirSync(path.dirname(dest), { recursive: true })
      copyFileSync(path.join(sourceDir, rel), dest)
    }
    return files.map((rel) => toPosix(path.join("apps", targetId, rel)))
  }

  const { kept, templates, planned } = listBlankFiles(root, sourceId)
  for (const rel of kept) {
    if (rel in templates) continue
    const dest = path.join(targetDir, rel)
    mkdirSync(path.dirname(dest), { recursive: true })
    copyFileSync(path.join(sourceDir, rel), dest)
  }
  for (const [rel, content] of Object.entries(templates)) {
    const dest = path.join(targetDir, rel)
    mkdirSync(path.dirname(dest), { recursive: true })
    writeFileSync(dest, content, "utf8")
  }
  return planned.map((rel) => toPosix(path.join("apps", targetId, rel)))
}

/** 清点克隆继承来的业务模块切片名（区块驱动，与 remove:module 同一判据）。 */
function inheritedModuleNames(root: string, appId: string): string[] {
  const names = new Set<string>()
  for (const relPath of [
    `apps/${appId}/src/lib/query-keys.ts`,
    `apps/${appId}/src/App.tsx`,
    `apps/${appId}/src/lib/menu-config.ts`,
  ]) {
    const full = path.join(root, relPath)
    if (!existsSync(full)) continue
    for (const id of listRegions(readFileSync(full, "utf8"))) {
      if (id.startsWith(MODULE_REGION_PREFIX)) {
        names.add(id.slice(MODULE_REGION_PREFIX.length))
      }
    }
  }
  return [...names].sort()
}

/** 清点克隆继承来的页面（供用户确认删留；手写业务页不会被 --all-modules 剥掉）。 */
function inheritedPageNames(root: string, appId: string): string[] {
  const pagesDir = path.join(root, "apps", appId, "src", "pages")
  if (!existsSync(pagesDir)) return []
  return readdirSync(pagesDir).sort()
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

/**
 * 新增一个端：校验 → 克隆默认端 → 改身份 → 棘轮补基线 → 注册表 → 可选准入 → Dockerfile。
 *
 * 校验期零副作用；写入期任一步失败（含身份断言失败）整体回滚。
 */
export function addWebApp(opts: AddWebOptions): AddWebResult {
  const root = path.resolve(opts.root)
  const { id } = opts
  const title = (opts.title ?? "").trim()

  // ── 校验期（零副作用）──────────────────────────────────────────────────────
  if (!existsSync(root)) fail(`目标目录不存在：${root}`)
  for (const required of [
    "packages/ui/package.json",
    "packages/web-core/package.json",
    PERMISSIONS_FILE,
    REGISTRY_FILE,
  ]) {
    if (!existsSync(path.join(root, required))) {
      fail(
        `缺少 ${required}：新增端依赖分包结构与端注册表，目标项目必须先升级到最新模板。`
      )
    }
  }

  const apps = readWebApps(root)
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
    fail(`id "${id}" 必须以小写字母开头，只含小写字母/数字/连字符`)
  }
  if (id === DEFAULT_WEB_APP_ID) fail(`id "${DEFAULT_WEB_APP_ID}" 保留给默认端`)
  if (id === "api") fail(`id "api" 保留给后端`)
  if (WINDOWS_DEVICE_RE.test(id)) {
    fail(`id "${id}" 是 Windows 保留设备名，不能用作目录名`)
  }
  if (title === "") fail("title 不能为空")
  if (opts.blank && opts.restrictAccess) {
    fail(
      "--blank 与 --access-permission 互斥：极简空壳无登录与侧边栏拦截器；需要角色准入请省略 --blank，或在自建布局内自行校验权限。"
    )
  }

  const base = normalizeBase(opts.base ?? `/${id}/`)
  const devPort =
    opts.devPort ?? Math.max(...apps.map((app) => app.devPort), 5172) + 1
  if (devPort === API_DEV_PORT) fail(`devPort 不能是 ${API_DEV_PORT}（API 端口）`)

  const appDir = path.join(root, "apps", id)
  if (existsSync(appDir)) fail(`目录已存在：apps/${id}`)
  const firstSegment = base.split("/").filter(Boolean)[0]
  if (defaultAppFirstSegments(root).has(firstSegment)) {
    fail(
      `base "${base}" 与默认端的一级路由 /${firstSegment} 冲突，请换一个前缀。`
    )
  }

  const accessPermission = opts.restrictAccess ? `app:${id}` : undefined
  const permissionKey = permissionKeyOf(id)
  const permissionsPath = path.join(root, PERMISSIONS_FILE)
  const permissionsSource = readFileSync(permissionsPath, "utf8")
  if (accessPermission) {
    if (permissionsSource.includes(`"${accessPermission}"`)) {
      fail(`权限码 "${accessPermission}" 已存在于 ${PERMISSIONS_FILE}`)
    }
    for (const anchor of [PERMISSIONS_ANCHOR, REGISTRY_ANCHOR]) {
      if (!permissionsSource.includes(anchor)) {
        fail(`${PERMISSIONS_FILE} 缺少锚点 \`${anchor}\`，无法写入准入权限。`)
      }
    }
  }

  const dockerfilePath = path.join(root, "Dockerfile")
  const hasDockerfile = existsSync(dockerfilePath)
  const dockerfileSource = hasDockerfile
    ? readFileSync(dockerfilePath, "utf8")
    : null
  if (dockerfileSource !== null) {
    if (!dockerfileSource.includes(DOCKERFILE_ANCHOR)) {
      fail(
        `Dockerfile 缺少锚点 \`${DOCKERFILE_ANCHOR}\`：请先跑 \`--mode add-ci --force\` 刷新 CI 文件。`
      )
    }
    if (dockerfileSource.includes(`COPY apps/${id}/package.json`)) {
      fail(`Dockerfile 已包含 apps/${id} 的依赖层`)
    }
  }

  // 源端完整性
  const sourceDir = path.join(root, "apps", DEFAULT_WEB_APP_ID)
  const requiredFiles = opts.blank
    ? [...new Set([...SOURCE_REQUIRED, ...BLANK_KEEP_SRC_FILES])]
    : SOURCE_REQUIRED
  for (const rel of requiredFiles) {
    if (!existsSync(path.join(sourceDir, rel))) {
      fail(
        `默认端缺少 apps/${DEFAULT_WEB_APP_ID}/${rel}：端样板就是默认端，它不完整时无法${opts.blank ? "派生极简空壳" : "克隆出新端"}。`
      )
    }
  }

  // 身份改写可命中性预检：每处必须在源内容里恰好命中 1 次
  const ctx: IdentityContext = { id, title, year: new Date().getFullYear() }
  const sourceContents = new Map<string, string>()
  for (const edit of IDENTITY_EDITS) {
    let content = sourceContents.get(edit.relPath)
    if (content === undefined) {
      content = readFileSync(path.join(sourceDir, edit.relPath), "utf8")
      sourceContents.set(edit.relPath, content)
    }
    const hits = [...content.matchAll(new RegExp(edit.pattern.source, "gm"))]
    if (hits.length !== 1) {
      fail(
        `apps/${DEFAULT_WEB_APP_ID}/${edit.relPath} 的「${edit.label}」改写点命中 ${hits.length} 处（应为 1 处）：` +
          `默认端形态已变化，无法安全克隆。请检查该文件后重试。`
      )
    }
  }

  // 注册表整体校验（id/base/端口冲突、字符集、唯一根端全部由 parseWebApps 兜住）
  const entry: WebApp = {
    id,
    base,
    devPort,
    title,
    ...(accessPermission ? { accessPermission } : {}),
  }
  parseWebApps({ apps: [...apps, entry] })

  const regionId = `${REGION_PREFIX}${id}`
  const nextPermissions = accessPermission
    ? insertAfterAnchor(
        insertAfterAnchor(
          permissionsSource,
          PERMISSIONS_ANCHOR,
          [
            `  // #region ${regionId}`,
            `  ${permissionKey}: "${accessPermission}",`,
            `  // #endregion ${regionId}`,
          ].join("\n"),
          PERMISSIONS_FILE
        ),
        REGISTRY_ANCHOR,
        [
          `  // #region ${regionId}`,
          `  {`,
          `    code: PERMISSIONS.${permissionKey},`,
          `    label: ${JSON.stringify(`${title}准入`)},`,
          `    group: "app",`,
          `    groupLabel: "端准入",`,
          `    kind: "menu",`,
          `  },`,
          `  // #endregion ${regionId}`,
        ].join("\n"),
        PERMISSIONS_FILE
      )
    : null
  const nextDockerfile =
    dockerfileSource === null
      ? null
      : insertAfterAnchor(
          dockerfileSource,
          DOCKERFILE_ANCHOR,
          dockerfileRegion(id),
          "Dockerfile"
        )
  const nextRegistry = `${JSON.stringify({ apps: [...apps, entry] }, null, 2)}\n`

  // 棘轮：默认端的超长页条目要按同样行数复制到新端路径（克隆是逐字节复制）。
  // `--blank` 不克隆默认端业务页，跳过棘轮。
  // 从源端算而不是从克隆结果算，dry-run 与正式执行才能得到同一份计划。
  // 必须在剥业务模块之前补——剥完后 pruneMissingLongFileRatchet 会自动剪掉被删页面的条目。
  const ratchetAdditions: Record<string, number> = {}
  if (!opts.blank) {
    const ratchetSource = readLongFileRatchetEntries(root)
    const sourcePrefix = `apps/${DEFAULT_WEB_APP_ID}/`
    for (const relPath of Object.keys(ratchetSource)) {
      if (!relPath.startsWith(sourcePrefix)) continue
      const sourceAbs = path.join(root, relPath)
      if (!existsSync(sourceAbs)) continue
      const targetRel = `apps/${id}/${relPath.slice(sourcePrefix.length)}`
      ratchetAdditions[toPosix(targetRel)] = countRatchetLines(
        readFileSync(sourceAbs, "utf8")
      )
    }
  }

  if (opts.dryRun) {
    const relFiles = opts.blank
      ? listBlankFiles(root, DEFAULT_WEB_APP_ID).planned
      : listCloneFiles(root, DEFAULT_WEB_APP_ID)
    return {
      entry,
      createdFiles: relFiles.map((rel) => toPosix(path.join("apps", id, rel))),
      modifiedFiles: [
        REGISTRY_FILE,
        ...(nextPermissions === null ? [] : [PERMISSIONS_FILE]),
        ...(nextDockerfile === null ? [] : ["Dockerfile"]),
        ...(Object.keys(ratchetAdditions).length > 0 ? [ARCH_CHECK_FILE] : []),
      ],
      inheritedModules: opts.blank
        ? []
        : inheritedModuleNames(root, DEFAULT_WEB_APP_ID),
      inheritedPages: opts.blank
        ? []
        : inheritedPageNames(root, DEFAULT_WEB_APP_ID),
    }
  }

  // ── 写入期（任一步失败整体回滚）────────────────────────────────────────────
  const snapshots = new Map<string, string | null>([
    [REGISTRY_FILE, readFileSync(path.join(root, REGISTRY_FILE), "utf8")],
    [PERMISSIONS_FILE, permissionsSource],
    ["Dockerfile", dockerfileSource],
    [
      ARCH_CHECK_FILE,
      existsSync(path.join(root, ARCH_CHECK_FILE))
        ? readFileSync(path.join(root, ARCH_CHECK_FILE), "utf8")
        : null,
    ],
  ])

  /**
   * 逐项独立尝试：删目录失败（Windows 上文件被占用会 EBUSY）不能阻断注册文件还原，
   * 否则留下的半成品比原错误更难查。返回失败项供调用方如实报告。
   */
  const rollback = (): string[] => {
    const failures: string[] = []
    const attempt = (label: string, fn: () => void): void => {
      try {
        fn()
      } catch (error) {
        failures.push(
          `${label}：${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    attempt(`删除 apps/${id}/`, () =>
      rmSync(appDir, { recursive: true, force: true })
    )
    for (const [rel, content] of snapshots) {
      const abs = path.join(root, rel)
      attempt(`还原 ${rel}`, () => {
        if (content === null) rmSync(abs, { force: true })
        else writeFileSync(abs, content, "utf8")
      })
    }
    return failures
  }

  let createdFiles: string[]
  try {
    createdFiles = cloneApp(root, DEFAULT_WEB_APP_ID, id, Boolean(opts.blank))

    // 身份改写 + 正向断言
    const edited = new Map<string, string>()
    for (const edit of IDENTITY_EDITS) {
      const before =
        edited.get(edit.relPath) ??
        readFileSync(path.join(appDir, edit.relPath), "utf8")
      const matched = before.match(edit.pattern)
      if (!matched) {
        fail(`apps/${id}/${edit.relPath} 的「${edit.label}」改写点丢失`)
      }
      const rendered = edit.render(ctx, matched[0])
      const after = before.replace(edit.pattern, rendered)
      if (!after.includes(rendered)) {
        fail(`apps/${id}/${edit.relPath} 的「${edit.label}」改写未落地`)
      }
      edit.verify?.(after, ctx)
      edited.set(edit.relPath, after)
    }
    for (const [relPath, content] of edited) {
      writeFileSync(path.join(appDir, relPath), content, "utf8")
    }

    if (Object.keys(ratchetAdditions).length > 0) {
      upsertLongFileRatchetEntries(root, ratchetAdditions)
    }

    writeFileSync(path.join(root, REGISTRY_FILE), nextRegistry, "utf8")
    const modifiedFiles = [REGISTRY_FILE]
    if (nextPermissions !== null) {
      writeFileSync(permissionsPath, nextPermissions, "utf8")
      modifiedFiles.push(PERMISSIONS_FILE)
    }
    if (nextDockerfile !== null) {
      writeFileSync(dockerfilePath, nextDockerfile, "utf8")
      modifiedFiles.push("Dockerfile")
    }
    if (Object.keys(ratchetAdditions).length > 0) {
      modifiedFiles.push(ARCH_CHECK_FILE)
    }

    // 注册表回读校验：写下去的必须能被权威校验器解析回来
    parseWebApps(JSON.parse(readFileSync(path.join(root, REGISTRY_FILE), "utf8")))

    return {
      entry,
      createdFiles,
      modifiedFiles,
      inheritedModules: opts.blank ? [] : inheritedModuleNames(root, id),
      inheritedPages: opts.blank ? [] : inheritedPageNames(root, id),
    }
  } catch (error) {
    const failures = rollback()
    const message = error instanceof Error ? error.message : String(error)
    const tail =
      failures.length === 0
        ? "\n\n↩️  已回滚本次增端的全部改动（端目录与注册文件恢复到增端前）。"
        : "\n\n⚠️  回滚未完全成功，以下各项需人工处理：\n" +
          failures.map((item) => `  - ${item}`).join("\n")
    throw new Error(message + tail, { cause: error })
  }
}

/** Dockerfile 依赖层区块文本：增端写入与 add-ci 修复共用，避免两处漂移。 */
function dockerfileRegion(id: string): string {
  const regionId = `${REGION_PREFIX}${id}`
  return [
    `# region:${regionId}`,
    `COPY apps/${id}/package.json apps/${id}/`,
    `# endregion:${regionId}`,
  ].join("\n")
}

/**
 * 把已注册端的 Dockerfile 依赖层区块补齐（幂等，已有区块的端跳过）。
 *
 * 供技能 `--mode add-ci` 用：它拿模板原件重新 stamp Dockerfile，而原件只含默认端，
 * 不补的话容器里 `bun install` 解析不到其余 workspace，构建直接失败。
 * 区块契约与 `remove-web.ts` 的剥离侧同源，所以修复也放在项目侧。
 */
export function ensureWebAppDockerfileRegions(root: string): string[] {
  const dockerfilePath = path.join(root, "Dockerfile")
  if (!existsSync(dockerfilePath)) return []
  let source = readFileSync(dockerfilePath, "utf8")
  const added: string[] = []
  for (const app of readWebApps(root)) {
    if (app.id === DEFAULT_WEB_APP_ID) continue
    if (listRegions(source).includes(`${REGION_PREFIX}${app.id}`)) continue
    source = insertAfterAnchor(
      source,
      DOCKERFILE_ANCHOR,
      dockerfileRegion(app.id),
      "Dockerfile"
    )
    added.push(app.id)
  }
  if (added.length > 0) writeFileSync(dockerfilePath, source, "utf8")
  return added
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

/** `--json` 供脚手架消费：stdout 只有结果 JSON，过程诊断一律走 stderr。 */
function parseCliArgs(argv: string[]): { opts: AddWebOptions; json: boolean } {
  const values = new Map<string, string>()
  const flags = new Set<string>()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith("--")) fail(`未知参数 ${arg}`)
    const eq = arg.indexOf("=")
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    if (
      name === "access-permission" ||
      name === "blank" ||
      name === "dry-run" ||
      name === "json"
    ) {
      flags.add(name)
      continue
    }
    const value = eq === -1 ? argv[i + 1] : arg.slice(eq + 1)
    if (value === undefined || value.startsWith("--")) {
      fail(`参数 --${name} 缺少取值`)
    }
    if (eq === -1) i += 1
    values.set(name, value)
  }
  const id = values.get("id")
  const title = values.get("title")
  if (!id) fail("缺少必填参数 --id")
  if (!title) fail("缺少必填参数 --title")
  const devPortRaw = values.get("dev-port")
  return {
    json: flags.has("json"),
    opts: {
      root: fileURLToPath(new URL("..", import.meta.url)),
      id,
      title,
      base: values.get("base"),
      devPort: devPortRaw === undefined ? undefined : Number(devPortRaw),
      restrictAccess: flags.has("access-permission"),
      blank: flags.has("blank"),
      dryRun: flags.has("dry-run"),
    },
  }
}

function main(): void {
  const { opts, json } = parseCliArgs(process.argv.slice(2))
  const result = addWebApp(opts)
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return
  }
  const { entry } = result

  console.log(`\n🧩 add:web — 端 "${entry.id}"（${entry.title}）`)
  console.log(`   base:     ${entry.base}`)
  console.log(`   devPort:  ${entry.devPort}`)
  console.log(
    `   准入:     ${entry.accessPermission ?? "（不设，全员可进）"}`
  )
  console.log(
    `   样板:     ${
      opts.blank
        ? `极简独立空壳（保留 apps/${DEFAULT_WEB_APP_ID} 工程底座，跳过 PC 布局与演示页）`
        : `克隆 apps/${DEFAULT_WEB_APP_ID}`
    }`
  )

  if (opts.dryRun) {
    console.log(
      `\n将${opts.blank ? "创建" : "克隆"} ${result.createdFiles.length} 个文件到 apps/${entry.id}/，并更新：`
    )
    for (const rel of result.modifiedFiles) console.log(`   ~ ${rel}`)
    console.log("\n--dry-run：未写入任何文件。")
  } else {
    console.log(
      `\n✅ 新建 ${result.createdFiles.length} 个文件，更新 ${result.modifiedFiles.length} 个注册文件。`
    )
    for (const rel of result.modifiedFiles) console.log(`   ~ ${rel}`)
  }

  if (result.inheritedModules.length > 0) {
    console.log(
      `\n📦 继承的业务模块切片（${result.inheritedModules.length} 个）：` +
        result.inheritedModules.join("、")
    )
  }
  if (result.inheritedPages.length > 0) {
    console.log(
      `\n📄 继承的页面（${result.inheritedPages.length} 项，请确认删留）：` +
        result.inheritedPages.join("、")
    )
    console.log(
      "   注意：手写的业务页没有 module:* 区块，不会被 --all-modules 剥掉，需人工删除。"
    )
  }

  const steps = opts.blank
    ? [
        `  1. bun install（新端 package.json 名字已改为 ${entry.id}）`,
        "  2. bun run check",
        `  3. 按需编写 apps/${entry.id}/src/ 专属布局与页面`,
      ]
    : [
        `  1. bun install（新端 package.json 名字已改为 ${entry.id}）`,
        `  2. bun run remove:module --app ${entry.id} --all-modules --force（清掉继承的业务切片）`,
        "  3. bun run check",
        `  4. 本端要加业务模块：bun run gen:module --name <模块> --app ${entry.id}`,
      ]

  console.log(
    [
      "",
      "后续步骤：",
      ...steps,
      "",
      "提示：",
      `  - 开发地址 http://localhost:${entry.devPort}${entry.base}；生产同源 ${entry.base}`,
      entry.accessPermission
        ? `  - 准入只是体验层：其他角色要进本端，需在 ROLE_PERMISSIONS 里授予 PERMISSIONS.${permissionKeyOf(entry.id)}；真正的越权防线仍是后端 requirePermission`
        : opts.blank
          ? "  - 极简空壳无登录与侧边栏拦截；公开接口与业务鉴权由后端路由或自建布局承担"
          : "  - 本端不设准入拦截；需要时删掉重建并加 --access-permission",
      `  - 撤销本端：bun run remove:web --id ${entry.id}`,
    ].join("\n")
  )
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
