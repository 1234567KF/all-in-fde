/**
 * `add:web` 与 `remove:web` 的往返与预检测试。
 *
 * 两份实现同仓同 PR，唯一的契约是 `web-app:<id>` 区块与注册文件清单；
 * 只有把两者串起来跑才能证明契约没漂，因此这里做真实往返而不是各自 mock。
 * fixture 用真实 `apps/web`（端样板就是默认端），假 App.tsx 证明不了克隆成立。
 */
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
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "bun:test"

import { addWebApp } from "./add-web"
import { listRegions, stripRegions } from "./lib/code-regions"
import { readLongFileRatchetEntries } from "./lib/long-file-ratchet"
import { findWebAppReverseReferences, removeWebApp } from "./remove-web"

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))

const temps: string[] = []

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** 与 add-web 的克隆排除清单同口径，产物不进 fixture。 */
const FIXTURE_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".vite",
  ".turbo",
  ".cache",
  ".git",
])
const FIXTURE_SKIP_FILES = new Set([".eslintcache", ".DS_Store", "Thumbs.db"])
const FIXTURE_SKIP_SUFFIXES = [
  ".tsbuildinfo",
  ".log",
  ".bun-build",
  ".db",
  ".sqlite",
  ".sqlite3",
]

function copyTree(from: string, to: string): void {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (FIXTURE_SKIP_DIRS.has(entry.name)) continue
      copyTree(path.join(from, entry.name), path.join(to, entry.name))
      continue
    }
    if (FIXTURE_SKIP_FILES.has(entry.name)) continue
    if (FIXTURE_SKIP_SUFFIXES.some((s) => entry.name.endsWith(s))) continue
    mkdirSync(to, { recursive: true })
    writeFileSync(
      path.join(to, entry.name),
      readFileSync(path.join(from, entry.name))
    )
  }
}

/**
 * fixture 的注册面全部合成，只有默认端源码与权限表取自宿主：
 * 宿主可能已经是多端项目（portal / mobile 已注册）、可能没跑 --include-ci（无 Dockerfile）、
 * 棘轮也可能已被 --clean-demo 剪成空对象。直接复制宿主注册面会让「新增 portal」撞已存在。
 */
const FIXTURE_DEFAULT_ENTRY = {
  id: "web",
  base: "/",
  devPort: 5173,
  title: "默认端",
}
const FIXTURE_DOCKERFILE = [
  "FROM oven/bun:1 AS builder",
  "WORKDIR /app",
  "COPY package.json bun.lock ./",
  "COPY apps/web/package.json apps/web/",
  "# [web-apps:dockerfile] 由 add:web / remove:web 增删其余端的依赖层（勿手改本行）",
  "RUN bun install",
  "",
].join("\n")
/** 一个 500 行的夹具页 + 对应棘轮条目，让剪枝断言不依赖宿主是否有超长页。 */
const LONG_PAGE_REL = "apps/web/src/pages/LongFixturePage.tsx"
const FIXTURE_ARCH_CHECK = [
  "const MAX_LINES = 450",
  "",
  "const LONG_FILE_RATCHET: Record<string, number> = {",
  `  "${LONG_PAGE_REL}": 500,`,
  "}",
  "",
].join("\n")

/** 剥掉宿主已有的 web-app:* 区块，回到「只有默认端」的权限表基线。 */
function stripWebAppRegions(source: string): string {
  let next = source
  for (const id of listRegions(source)) {
    if (id.startsWith("web-app:")) next = stripRegions(next, id)
  }
  return next
}

function makeFixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "remove-web-"))
  temps.push(root)
  copyTree(path.join(REPO_ROOT, "apps/web"), path.join(root, "apps/web"))
  writeAt(
    root,
    "web-apps.json",
    `${JSON.stringify({ apps: [FIXTURE_DEFAULT_ENTRY] }, null, 2)}\n`
  )
  writeAt(
    root,
    "packages/shared/src/permissions.ts",
    stripWebAppRegions(
      readFileSync(
        path.join(REPO_ROOT, "packages/shared/src/permissions.ts"),
        "utf8"
      )
    )
  )
  writeAt(root, "Dockerfile", FIXTURE_DOCKERFILE)
  writeAt(root, LONG_PAGE_REL, "export const x = 1\n".repeat(500))
  writeAt(root, "scripts/arch-check.ts", FIXTURE_ARCH_CHECK)
  writeAt(root, "packages/ui/package.json", '{"name":"@workspace/ui"}\n')
  writeAt(
    root,
    "packages/web-core/package.json",
    '{"name":"@workspace/web-core"}\n'
  )
  return root
}

/** 全量文件快照（相对路径 → 内容），用于断言零副作用 / 逐字节还原。 */
function snapshot(root: string): Map<string, string> {
  const files = new Map<string, string>()
  const walk = (relDir: string) => {
    for (const entry of readdirSync(path.join(root, relDir), {
      withFileTypes: true,
    })) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(rel)
      else files.set(rel, readFileSync(path.join(root, rel), "utf8"))
    }
  }
  walk("")
  return files
}

function writeAt(root: string, rel: string, content: string): void {
  const file = path.join(root, rel)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content, "utf8")
}

describe("remove:web 基本约束", () => {
  it("默认端 web 不允许删除", () => {
    const root = makeFixture()
    expect(() => removeWebApp({ root, id: "web" })).toThrow(/不允许删除/)
  })

  it("注册表里没有该端时报错并列出现有端", () => {
    const root = makeFixture()
    expect(() => removeWebApp({ root, id: "portal" })).toThrow(/现有端：web/)
  })

  it("缺少 web-apps.json 时报错", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "remove-web-empty-"))
    temps.push(root)
    expect(() => removeWebApp({ root, id: "portal" })).toThrow(/web-apps\.json/)
  })
})

describe("add:web → remove:web 往返", () => {
  for (const restrictAccess of [false, true]) {
    it(`${restrictAccess ? "带准入" : "不带准入"}往返后逐字节还原`, () => {
      const root = makeFixture()
      const before = snapshot(root)

      const result = addWebApp({
        root,
        id: "portal",
        title: "企业服务平台",
        restrictAccess,
      })
      expect(result.createdFiles.length).toBeGreaterThan(50)
      expect(existsSync(path.join(root, "apps/portal"))).toBe(true)

      removeWebApp({ root, id: "portal" })

      expect(existsSync(path.join(root, "apps/portal"))).toBe(false)
      expect(snapshot(root)).toEqual(before)
    })
  }

  it("--blank 极简端往返后逐字节还原", () => {
    const root = makeFixture()
    const before = snapshot(root)

    addWebApp({
      root,
      id: "public",
      title: "公众服务",
      base: "/p/",
      blank: true,
    })
    expect(
      existsSync(path.join(root, "apps/public/src/pages/HomePage.tsx"))
    ).toBe(true)

    removeWebApp({ root, id: "public" })
    expect(existsSync(path.join(root, "apps/public"))).toBe(false)
    expect(snapshot(root)).toEqual(before)
  })

  it("准入配置落在注册表与权限区块，端内代码零改动", () => {
    const root = makeFixture()
    addWebApp({
      root,
      id: "portal",
      title: "企业服务平台",
      restrictAccess: true,
    })

    const appConfig = readFileSync(
      path.join(root, "apps/portal/src/lib/app-config.ts"),
      "utf8"
    )
    expect(appConfig).toContain('APP_NAME = "企业服务平台"')
    // 准入码经 vite define 从注册表注入，不再写进端内常量
    expect(appConfig).not.toContain("APP_ACCESS_PERMISSION")
    expect(
      readFileSync(path.join(root, "apps/portal/vite.config.ts"), "utf8")
    ).toContain('const APP_ID = "portal"')

    const registry = JSON.parse(
      readFileSync(path.join(root, "web-apps.json"), "utf8")
    )
    expect(registry.apps[1]).toEqual({
      id: "portal",
      base: "/portal/",
      devPort: 5174,
      title: "企业服务平台",
      accessPermission: "app:portal",
    })

    const permissions = readFileSync(
      path.join(root, "packages/shared/src/permissions.ts"),
      "utf8"
    )
    expect(permissions).toContain('APP_PORTAL: "app:portal"')
    expect(permissions).toContain("// #region web-app:portal")
    expect(readFileSync(path.join(root, "Dockerfile"), "utf8")).toContain(
      "COPY apps/portal/package.json apps/portal/"
    )
  })

  it("标题含引号 / 反斜杠 / HTML 元字符时生成物仍合法，且往返还原", () => {
    const root = makeFixture()
    const before = snapshot(root)
    const title = '企业"服务"平台 <&> \\back'
    addWebApp({ root, id: "portal", title, restrictAccess: true })

    // TS 上下文：整串必须等价于 JSON.stringify，否则生成物语法崩溃（曾实测 TS1005）
    const appConfig = readFileSync(
      path.join(root, "apps/portal/src/lib/app-config.ts"),
      "utf8"
    )
    expect(appConfig).toContain(
      `export const APP_NAME = ${JSON.stringify(title)}`
    )
    const permissions = readFileSync(
      path.join(root, "packages/shared/src/permissions.ts"),
      "utf8"
    )
    expect(permissions).toContain(`label: ${JSON.stringify(`${title}准入`)}`)
    // HTML 上下文：& < > 必须转义，引号在文本节点里原样保留
    const html = readFileSync(path.join(root, "apps/portal/index.html"), "utf8")
    expect(html).toContain(
      `<title>${title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</title>`
    )

    removeWebApp({ root, id: "portal" })
    expect(snapshot(root)).toEqual(before)
  })

  it("不限制准入时不写权限区块，端内代码与默认端逐字一致", () => {
    const root = makeFixture()
    const before = readFileSync(
      path.join(root, "packages/shared/src/permissions.ts"),
      "utf8"
    )
    addWebApp({ root, id: "h5", title: "移动端" })
    expect(
      readFileSync(
        path.join(root, "packages/shared/src/permissions.ts"),
        "utf8"
      )
    ).toBe(before)
    expect(
      readFileSync(path.join(root, "apps/h5/src/lib/app-config.ts"), "utf8")
    ).not.toContain("APP_ACCESS_PERMISSION")
  })

  it("删除端后剪掉该端的 LONG_FILE_RATCHET 条目，默认端条目不动", () => {
    const root = makeFixture()
    const before = readLongFileRatchetEntries(root)
    addWebApp({ root, id: "portal", title: "企业服务平台" })
    expect(
      Object.keys(readLongFileRatchetEntries(root)).some((key) =>
        key.startsWith("apps/portal/")
      )
    ).toBe(true)

    removeWebApp({ root, id: "portal" })
    expect(readLongFileRatchetEntries(root)).toEqual(before)
  })

  it("dry-run 不落任何改动", () => {
    const root = makeFixture()
    addWebApp({
      root,
      id: "portal",
      title: "企业服务平台",
      restrictAccess: true,
    })
    const before = snapshot(root)
    const plan = removeWebApp({ root, id: "portal", dryRun: true })
    expect(plan.modifiedFiles).toContain("packages/shared/src/permissions.ts")
    expect(plan.modifiedFiles).toContain("Dockerfile")
    expect(snapshot(root)).toEqual(before)
  })
})

describe("remove:web 反向引用预检", () => {
  function withPortal(): string {
    const root = makeFixture()
    addWebApp({
      root,
      id: "portal",
      title: "企业服务平台",
      restrictAccess: true,
    })
    return root
  }

  it("副作用 import（无 from / 无括号）也算反向引用", () => {
    const root = withPortal()
    writeAt(root, "apps/web/src/setup.ts", 'import "portal/src/setup"\n')
    const hits = findWebAppReverseReferences(root, "portal")
    expect(hits.some((h) => h.kind === "import")).toBe(true)
    expect(() => removeWebApp({ root, id: "portal" })).toThrow(/反向引用/)
  })

  it("行号按原文计算，不被剥掉的注册区块前移", () => {
    const root = withPortal()
    const file = path.join(root, "packages/shared/src/permissions.ts")
    const marker = "APP_PORTAL,"
    const content = `${readFileSync(file, "utf8")}\n// 手工授权\n  ${marker}\n`
    writeFileSync(file, content, "utf8")

    const hits = findWebAppReverseReferences(root, "portal")
    const hit = hits.find((h) => h.kind === "permission" && h.text === marker)
    expect(hit).toBeDefined()
    const actualLine =
      content.split("\n").findIndex((l) => l.trim() === marker) + 1
    expect(hit!.line).toBe(actualLine)
  })

  it("其他端相对路径 import 本端 → 终止", () => {
    const root = withPortal()
    writeAt(
      root,
      "apps/web/src/pages/Borrow.tsx",
      'import { APP_NAME } from "../../../portal/src/lib/app-config"\n'
    )
    const hits = findWebAppReverseReferences(root, "portal")
    expect(hits.some((h) => h.kind === "import")).toBe(true)
    expect(() => removeWebApp({ root, id: "portal" })).toThrow(/反向引用/)
  })

  it("共享包按裸包名 import 本端 → 终止", () => {
    const root = withPortal()
    writeAt(
      root,
      "packages/web-core/src/lib/borrow.ts",
      'import { APP_NAME } from "portal/lib/app-config"\n'
    )
    expect(() => removeWebApp({ root, id: "portal" })).toThrow(/反向引用/)
  })

  it("ROLE_PERMISSIONS 仍引用准入码 → 终止", () => {
    const root = withPortal()
    const file = path.join(root, "packages/shared/src/permissions.ts")
    const source = readFileSync(file, "utf8")
    writeFileSync(
      file,
      source.replace(
        "[PERMISSIONS.USER_VIEW, PERMISSIONS.USER_EDIT]",
        "[PERMISSIONS.USER_VIEW, PERMISSIONS.APP_PORTAL]"
      ),
      "utf8"
    )
    const hits = findWebAppReverseReferences(root, "portal")
    expect(hits.some((h) => h.kind === "permission")).toBe(true)
    expect(() => removeWebApp({ root, id: "portal" })).toThrow(/反向引用/)
  })

  it("后端引用准入码 → 终止（api 不能 import 端，但能用 PERMISSIONS.APP_<ID>）", () => {
    const root = withPortal()
    writeAt(
      root,
      "apps/api/src/modules/user/portal-guard.ts",
      'import { PERMISSIONS } from "shared"\nexport const guard = PERMISSIONS.APP_PORTAL\n'
    )
    const hits = findWebAppReverseReferences(root, "portal")
    expect(
      hits.some(
        (h) => h.kind === "permission" && h.relPath.startsWith("apps/api/")
      )
    ).toBe(true)
    expect(() => removeWebApp({ root, id: "portal" })).toThrow(/反向引用/)
  })

  it("注册区块自身不算反向引用", () => {
    const root = withPortal()
    expect(findWebAppReverseReferences(root, "portal")).toEqual([])
  })
})
