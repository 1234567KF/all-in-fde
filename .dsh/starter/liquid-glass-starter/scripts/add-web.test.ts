/**
 * `add:web`（克隆默认端 + 改身份 + 注册）的单测。
 *
 * fixture 用**真实 `apps/web`** 而不是几行假 App.tsx：端样板就是默认端，
 * 只有拿活代码跑才能证明身份改写点、克隆排除清单与棘轮基线在真实形态上成立。
 * 与 `remove:web` 的逐字节往返在 remove-web.test.ts。
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

import {
  addWebApp,
  type AddWebOptions,
  type AddWebResult,
  ensureWebAppDockerfileRegions,
} from "./add-web"
import { listRegions, stripRegions } from "./lib/code-regions"
import {
  countRatchetLines,
  readLongFileRatchetEntries,
} from "./lib/long-file-ratchet"
import { parseWebApps } from "./lib/web-apps"

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))
const REGION_ID = "web-app:portal"

const temps: string[] = []

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function writeAt(root: string, rel: string, content: string): void {
  const file = path.join(root, rel)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content, "utf8")
}

/** 与 add-web 的克隆排除清单同口径：产物不进 fixture，否则「排除产物」用例自证。 */
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
/** 一个 500 行的夹具页 + 对应棘轮条目，让「克隆补基线」不依赖宿主是否有超长页。 */
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
  const root = mkdtempSync(path.join(os.tmpdir(), "add-web-"))
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

/** 全量文件快照（相对路径 → 内容），用于断言零副作用。 */
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

function addPortal(root: string, extra: Partial<AddWebOptions> = {}) {
  return addWebApp({
    root,
    id: "portal",
    title: "企业服务平台",
    ...extra,
  })
}

function readAt(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), "utf8")
}

describe("add:web 校验期零副作用", () => {
  const cases: Array<{
    name: string
    opts: Partial<AddWebOptions>
    error: RegExp
  }> = [
    { name: "id 非法", opts: { id: "Portal" }, error: /必须以小写字母开头/ },
    { name: "id 是默认端", opts: { id: "web" }, error: /保留给默认端/ },
    { name: "id 是 api", opts: { id: "api" }, error: /保留给后端/ },
    {
      name: "id 是 Windows 保留设备名",
      opts: { id: "con" },
      error: /Windows 保留设备名/,
    },
    { name: "title 为空", opts: { title: "  " }, error: /title 不能为空/ },
    {
      name: "--blank 与 --access-permission 互斥",
      opts: { blank: true, restrictAccess: true },
      error: /互斥/,
    },
    { name: "base 占用 /api/", opts: { base: "/api/v2/" }, error: /\/api\// },
    { name: "base 含查询符", opts: { base: "/x?y/" }, error: /只能含字母/ },
    { name: "base 含点段", opts: { base: "/a/../b/" }, error: /只能含字母/ },
    { name: "base 是根", opts: { base: "/" }, error: /base "\/"/ },
    { name: "base 含空段", opts: { base: "//portal//" }, error: /空路径段/ },
    {
      name: "base 与默认端一级路由冲突",
      opts: { base: "/dashboard/" },
      error: /一级路由/,
    },
    { name: "devPort 撞 API", opts: { devPort: 3000 }, error: /API 端口/ },
    {
      name: "devPort 撞已有端",
      opts: { devPort: 5173 },
      error: /devPort 5173 重复/,
    },
    { name: "devPort 越界", opts: { devPort: 70000 }, error: /1-65535/ },
  ]

  for (const { name, opts, error } of cases) {
    it(name, () => {
      const root = makeFixture()
      const before = snapshot(root)
      expect(() => addPortal(root, opts)).toThrow(error)
      expect(snapshot(root)).toEqual(before)
    })
  }

  it("目录已存在时拒绝", () => {
    const root = makeFixture()
    writeAt(root, "apps/portal/README.md", "占位\n")
    const before = snapshot(root)
    expect(() => addPortal(root)).toThrow(/目录已存在/)
    expect(snapshot(root)).toEqual(before)
  })

  it("缺少共享包时拒绝（旧结构项目）", () => {
    const root = makeFixture()
    rmSync(path.join(root, "packages/web-core"), { recursive: true })
    const before = snapshot(root)
    expect(() => addPortal(root)).toThrow(/packages\/web-core/)
    expect(snapshot(root)).toEqual(before)
  })

  it("缺少端注册表时拒绝", () => {
    const root = makeFixture()
    rmSync(path.join(root, "web-apps.json"))
    const before = snapshot(root)
    expect(() => addPortal(root)).toThrow(/web-apps\.json/)
    expect(snapshot(root)).toEqual(before)
  })

  it("默认端不完整时拒绝（端样板就是默认端）", () => {
    const root = makeFixture()
    rmSync(path.join(root, "apps/web/src/lib/app-config.ts"))
    const before = snapshot(root)
    expect(() => addPortal(root)).toThrow(/默认端缺少 apps\/web\/src\/lib\/app-config\.ts/)
    expect(snapshot(root)).toEqual(before)
  })

  it("身份改写点丢失时拒绝，且不改任何文件", () => {
    const root = makeFixture()
    const vite = path.join(root, "apps/web/vite.config.ts")
    writeFileSync(
      vite,
      readFileSync(vite, "utf8").replace('const APP_ID = "web"', "// 形态已变"),
      "utf8"
    )
    const before = snapshot(root)
    expect(() => addPortal(root)).toThrow(/「vite APP_ID」改写点命中 0 处/)
    expect(snapshot(root)).toEqual(before)
  })

  it("身份改写点重复时同样拒绝（改一处会漏另一处）", () => {
    const root = makeFixture()
    const vite = path.join(root, "apps/web/vite.config.ts")
    writeFileSync(
      vite,
      `${readFileSync(vite, "utf8")}\nconst APP_ID = "web"\n`,
      "utf8"
    )
    const before = snapshot(root)
    expect(() => addPortal(root)).toThrow(/「vite APP_ID」改写点命中 2 处/)
    expect(snapshot(root)).toEqual(before)
  })

  it("准入权限码已存在时拒绝", () => {
    const root = makeFixture()
    const file = path.join(root, "packages/shared/src/permissions.ts")
    writeFileSync(file, `${readFileSync(file, "utf8")}\n// "app:portal"\n`, "utf8")
    const before = snapshot(root)
    expect(() => addPortal(root, { restrictAccess: true })).toThrow(
      /权限码 "app:portal" 已存在/
    )
    expect(snapshot(root)).toEqual(before)
  })

  it("Dockerfile 缺锚点时拒绝并给出刷新指引", () => {
    const root = makeFixture()
    const file = path.join(root, "Dockerfile")
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("# [web-apps:dockerfile]", "# 锚点没了"),
      "utf8"
    )
    const before = snapshot(root)
    expect(() => addPortal(root)).toThrow(/Dockerfile 缺少锚点.*add-ci/s)
    expect(snapshot(root)).toEqual(before)
  })

  it("没有 Dockerfile 时不报错，也不列进改动清单", () => {
    const root = makeFixture()
    rmSync(path.join(root, "Dockerfile"))
    const result = addPortal(root)
    expect(result.modifiedFiles).not.toContain("Dockerfile")
    expect(existsSync(path.join(root, "Dockerfile"))).toBe(false)
  })
})

describe("add:web 克隆与身份改写", () => {
  it("排除构建产物与本地状态，保留 public / components.json / 测试 setup", () => {
    const root = makeFixture()
    // 真实默认端里就带着 .eslintcache / .tsbuildinfo / .DS_Store，再补齐其余形态
    for (const rel of [
      "dist/index.html",
      "node_modules/dep/index.js",
      "coverage/lcov.info",
      ".vite/deps/chunk.js",
      "src/debug.log",
      "src/local.db",
      ".eslintcache",
      ".DS_Store",
      "tsconfig.tsbuildinfo",
    ]) {
      writeAt(root, `apps/web/${rel}`, "产物\n")
    }
    const result = addPortal(root)

    for (const rel of result.createdFiles) {
      expect(rel).not.toMatch(
        /\/(dist|node_modules|coverage|\.vite)\//
      )
      expect(rel).not.toMatch(/\.(tsbuildinfo|log|db|eslintcache)$/)
      expect(rel).not.toMatch(/\/\.DS_Store$/)
    }
    for (const rel of [
      "apps/portal/public/favicon.svg",
      "apps/portal/components.json",
      "apps/portal/src/test/setup.ts",
    ]) {
      expect(result.createdFiles).toContain(rel)
      expect(existsSync(path.join(root, rel))).toBe(true)
    }
  })

  it("克隆是逐字节复制（除 6 个身份文件外全等）", () => {
    const root = makeFixture()
    const result = addPortal(root)
    const identityFiles = new Set([
      "vite.config.ts",
      "vitest.config.ts",
      "package.json",
      "tsconfig.json",
      "index.html",
      "src/lib/app-config.ts",
    ])
    let compared = 0
    for (const rel of result.createdFiles) {
      const inner = rel.slice("apps/portal/".length)
      if (identityFiles.has(inner)) continue
      expect(readAt(root, rel)).toBe(readAt(root, `apps/web/${inner}`))
      compared += 1
    }
    expect(compared).toBeGreaterThan(50)
  })

  it("6 个身份文件全部改对（正向断言，不是 grep 不到 web）", () => {
    const root = makeFixture()
    addPortal(root, { restrictAccess: true })

    expect(readAt(root, "apps/portal/vite.config.ts")).toContain(
      'const APP_ID = "portal"'
    )
    expect(readAt(root, "apps/portal/vitest.config.ts")).toContain(
      'readWebApp(path.resolve(import.meta.dirname, "../.."), "portal")'
    )
    expect(JSON.parse(readAt(root, "apps/portal/package.json")).name).toBe(
      "portal"
    )
    expect(
      path.basename(
        JSON.parse(readAt(root, "apps/portal/tsconfig.json")).compilerOptions
          .tsBuildInfoFile
      )
    ).toBe("portal.tsbuildinfo")
    // 目录部分必须保留：各端共用 .cache/tsc/，只换文件名
    expect(
      JSON.parse(readAt(root, "apps/portal/tsconfig.json")).compilerOptions
        .tsBuildInfoFile
    ).toBe("../../.cache/tsc/portal.tsbuildinfo")
    expect(readAt(root, "apps/portal/index.html")).toContain(
      "<title>企业服务平台</title>"
    )

    const appConfig = readAt(root, "apps/portal/src/lib/app-config.ts")
    expect(appConfig).toContain('export const APP_NAME = "企业服务平台"')
    expect(appConfig).toContain('export const APP_TITLE = "企业服务平台"')
    expect(appConfig).toContain(
      `export const APP_COPYRIGHT = "© ${new Date().getFullYear()} 企业服务平台"`
    )
    // package.json 只换名字，其余键序与格式逐字保留
    expect(readAt(root, "apps/portal/package.json")).toBe(
      readAt(root, "apps/web/package.json").replace('"name": "web"', '"name": "portal"')
    )
  })

  it("注册表条目形状正确且能被权威校验器解析回来", () => {
    const root = makeFixture()
    const result = addPortal(root, { restrictAccess: true })
    const raw = JSON.parse(readAt(root, "web-apps.json"))
    expect(raw.apps[1]).toEqual({
      id: "portal",
      base: "/portal/",
      devPort: 5174,
      title: "企业服务平台",
      accessPermission: "app:portal",
    })
    expect(parseWebApps(raw)).toEqual([FIXTURE_DEFAULT_ENTRY, result.entry])
    expect(readAt(root, "web-apps.json")).toBe(`${JSON.stringify(raw, null, 2)}\n`)
  })

  it("base 归一化 + 端口自动递增", () => {
    const root = makeFixture()
    const result = addPortal(root, { base: "portal" })
    expect(result.entry.base).toBe("/portal/")
    expect(result.entry.devPort).toBe(5174)
    addWebApp({ root, id: "mobile", title: "移动端", base: "/m/" })
    expect(JSON.parse(readAt(root, "web-apps.json")).apps[2].devPort).toBe(5175)
  })

  it("标题含引号 / 反斜杠 / HTML 元字符时生成物仍合法", () => {
    const root = makeFixture()
    const title = '企业"服务"平台 <&> \\back'
    addPortal(root, { title, restrictAccess: true })

    const appConfig = readAt(root, "apps/portal/src/lib/app-config.ts")
    expect(appConfig).toContain(`export const APP_NAME = ${JSON.stringify(title)}`)
    expect(readAt(root, "packages/shared/src/permissions.ts")).toContain(
      `label: ${JSON.stringify(`${title}准入`)}`
    )
    expect(readAt(root, "apps/portal/index.html")).toContain(
      `<title>${title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</title>`
    )
  })

  it("不设准入时不写权限区块，注册表也没有 accessPermission", () => {
    const root = makeFixture()
    const before = readAt(root, "packages/shared/src/permissions.ts")
    const result = addPortal(root)
    expect(result.entry.accessPermission).toBeUndefined()
    expect(result.modifiedFiles).not.toContain("packages/shared/src/permissions.ts")
    expect(readAt(root, "packages/shared/src/permissions.ts")).toBe(before)
    // 准入码经 vite define 注入，端内代码零改动：克隆体与默认端逐字一致
    expect(readAt(root, "apps/portal/src/lib/app-config.ts")).not.toContain(
      "APP_ACCESS_PERMISSION"
    )
  })

  it("清点继承的业务模块与页面，供调用方剥切片 / 用户确认删留", () => {
    const root = makeFixture()
    writeAt(
      root,
      "apps/web/src/lib/query-keys.ts",
      `${readAt(root, "apps/web/src/lib/query-keys.ts")}\n// #region module:contract\nexport const contractKeys = {}\n// #endregion module:contract\n`
    )
    const result = addPortal(root)
    expect(result.inheritedModules).toEqual(["contract"])
    expect(result.inheritedPages).toContain("LoginPage.tsx")
    expect(result.inheritedPages).toEqual(
      readdirSync(path.join(root, "apps/portal/src/pages")).sort()
    )
  })
})

describe("add:web 棘轮基线", () => {
  it("默认端超长页条目按克隆后实际行数复制到新端路径", () => {
    const root = makeFixture()
    const before = readLongFileRatchetEntries(root)
    const sourceKeys = Object.keys(before).filter((k) =>
      k.startsWith("apps/web/")
    )
    expect(sourceKeys.length).toBeGreaterThan(0)

    const result = addPortal(root)
    expect(result.modifiedFiles).toContain("scripts/arch-check.ts")

    const after = readLongFileRatchetEntries(root)
    for (const key of sourceKeys) {
      const target = key.replace("apps/web/", "apps/portal/")
      expect(after[target]).toBe(
        countRatchetLines(readAt(root, key))
      )
      expect(after[key]).toBe(before[key])
    }
  })

  it("指向已删文件的失效条目不会被复制", () => {
    const root = makeFixture()
    const file = path.join(root, "scripts/arch-check.ts")
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(
        "const LONG_FILE_RATCHET: Record<string, number> = {",
        'const LONG_FILE_RATCHET: Record<string, number> = {\n  "apps/web/src/pages/Gone.tsx": 900,'
      ),
      "utf8"
    )
    addPortal(root)
    expect(readLongFileRatchetEntries(root)).not.toHaveProperty(
      "apps/portal/src/pages/Gone.tsx"
    )
  })

  it("没有 arch-check.ts 时静默跳过，不列进改动清单", () => {
    const root = makeFixture()
    rmSync(path.join(root, "scripts/arch-check.ts"))
    const result = addPortal(root)
    expect(result.modifiedFiles).not.toContain("scripts/arch-check.ts")
    expect(existsSync(path.join(root, "scripts/arch-check.ts"))).toBe(false)
  })
})

describe("add:web 区块契约（remove:web 靠它剥离）", () => {
  it("两个注册文件的 web-app:<id> 区块可被识别，剥离后逐字节还原", () => {
    const root = makeFixture()
    const files = ["packages/shared/src/permissions.ts", "Dockerfile"]
    const before = files.map((rel) => readAt(root, rel))
    addPortal(root, { restrictAccess: true })

    files.forEach((rel, i) => {
      const content = readAt(root, rel)
      expect(listRegions(content)).toContain(REGION_ID)
      expect(stripRegions(content, REGION_ID)).toBe(before[i])
    })
    expect(readAt(root, "packages/shared/src/permissions.ts")).toContain(
      'APP_PORTAL: "app:portal"'
    )
    expect(readAt(root, "Dockerfile")).toContain(
      "COPY apps/portal/package.json apps/portal/"
    )
    // 夹具 Dockerfile 是合成件，这里顺手守住真实文件的锚点不漂（宿主可能没跑 --include-ci）
    const hostDockerfile = path.join(REPO_ROOT, "Dockerfile")
    if (existsSync(hostDockerfile)) {
      expect(readFileSync(hostDockerfile, "utf8")).toContain(
        "# [web-apps:dockerfile]"
      )
    }
  })
})

describe("add:web dry-run", () => {
  it("零副作用，且计划与正式执行逐条一致", () => {
    const root = makeFixture()
    const before = snapshot(root)
    const plan = addPortal(root, { restrictAccess: true, dryRun: true })
    expect(snapshot(root)).toEqual(before)

    const actual = addPortal(root, { restrictAccess: true })
    expect(plan.createdFiles).toEqual(actual.createdFiles)
    expect(plan.modifiedFiles).toEqual(actual.modifiedFiles)
    expect(plan.entry).toEqual(actual.entry)
    expect(plan.inheritedPages).toEqual(actual.inheritedPages)
  })
})

describe("add:web --json（脚手架消费的跨进程契约）", () => {
  it("stdout 只有结果 JSON，过程诊断不混进来", () => {
    // CLI 的 root 由 import.meta.url 决定（真实仓库，可能已经是多端项目），
    // 因此用随机 id 避开已注册端，并用 --dry-run 保证零副作用。
    const probeId = `probe-${Date.now().toString(36)}`
    const run = Bun.spawnSync(
      [
        process.execPath,
        "run",
        path.join(REPO_ROOT, "scripts/add-web.ts"),
        "--id",
        probeId,
        "--title",
        "企业服务平台",
        "--access-permission",
        "--json",
        "--dry-run",
      ],
      { cwd: REPO_ROOT }
    )
    expect(run.exitCode).toBe(0)
    const parsed = JSON.parse(run.stdout.toString()) as AddWebResult
    expect(Object.keys(parsed).sort()).toEqual([
      "createdFiles",
      "entry",
      "inheritedModules",
      "inheritedPages",
      "modifiedFiles",
    ])
    expect(parsed.entry.id).toBe(probeId)
    expect(parsed.createdFiles.length).toBeGreaterThan(50)
  })

  it("--blank --json 仅返回极简空壳清单且无继承模块/页面", () => {
    const probeId = `probe-blank-${Date.now().toString(36)}`
    const run = Bun.spawnSync(
      [
        process.execPath,
        "run",
        path.join(REPO_ROOT, "scripts/add-web.ts"),
        "--id",
        probeId,
        "--title",
        "官网 H5",
        "--blank",
        "--json",
        "--dry-run",
      ],
      { cwd: REPO_ROOT }
    )
    expect(run.exitCode).toBe(0)
    const parsed = JSON.parse(run.stdout.toString()) as AddWebResult
    expect(parsed.entry.id).toBe(probeId)
    expect(parsed.inheritedModules).toEqual([])
    expect(parsed.inheritedPages).toEqual([])
    expect(parsed.createdFiles).toContain(`apps/${probeId}/src/pages/HomePage.tsx`)
    expect(parsed.createdFiles).not.toContain(
      `apps/${probeId}/src/layouts/SidebarLayout.tsx`
    )
    expect(parsed.modifiedFiles).not.toContain("scripts/arch-check.ts")
  })
})

describe("add:web --blank（极简无登录空壳）", () => {
  it("保留工程底座与样式入口，不克隆 PC 布局/登录/演示页也不复制棘轮", () => {
    const root = makeFixture()
    const plan = addWebApp({
      root,
      id: "public",
      title: "公众服务",
      base: "/p/",
      blank: true,
      dryRun: true,
    })
    const actual = addWebApp({
      root,
      id: "public",
      title: "公众服务",
      base: "/p/",
      blank: true,
    })

    expect(actual.createdFiles).toEqual(plan.createdFiles)
    expect(actual.modifiedFiles).toEqual(plan.modifiedFiles)
    expect(actual.inheritedModules).toEqual([])
    expect(actual.inheritedPages).toEqual([])

    // 工程底座与身份改写保留
    expect(readAt(root, "apps/public/vite.config.ts")).toContain(
      'const APP_ID = "public"'
    )
    expect(readAt(root, "apps/public/index.html")).toContain(
      "<title>公众服务</title>"
    )
    expect(readAt(root, "apps/public/src/lib/app-config.ts")).toContain(
      'export const APP_NAME = "公众服务"'
    )
    expect(existsSync(path.join(root, "apps/public/src/index.css"))).toBe(true)
    expect(existsSync(path.join(root, "apps/public/src/main.tsx"))).toBe(true)

    // PC 管理壳与演示页均未继承
    expect(
      existsSync(path.join(root, "apps/public/src/layouts/SidebarLayout.tsx"))
    ).toBe(false)
    expect(
      existsSync(path.join(root, "apps/public/src/pages/LoginPage.tsx"))
    ).toBe(false)
    expect(
      existsSync(path.join(root, "apps/public/src/pages/LongFixturePage.tsx"))
    ).toBe(false)

    // 棘轮未被污染
    expect(actual.modifiedFiles).not.toContain("scripts/arch-check.ts")
    expect(readLongFileRatchetEntries(root)).not.toHaveProperty(
      "apps/public/src/pages/LongFixturePage.tsx"
    )

    // 生成的 App.tsx 无鉴权/侧边栏耦合且页面全部 lazy 引入（满足 arch-check）
    const appTsx = readAt(root, "apps/public/src/App.tsx")
    expect(appTsx).toContain('lazy(() => import("@/pages/HomePage"))')
    expect(appTsx).toContain('lazy(() => import("@/pages/NotFoundPage"))')
    expect(appTsx).not.toContain("ProtectedRoute")
    expect(appTsx).not.toContain("SidebarLayout")
  })

  it("生成的极简空壳文件引用的包、共享模块路径与导出符号在宿主均真实存在", () => {
    const root = makeFixture()
    addWebApp({
      root,
      id: "public",
      title: "公众服务",
      base: "/p/",
      blank: true,
    })

    const readJsonDeps = (pkgFile: string) => {
      const json = JSON.parse(readFileSync(pkgFile, "utf8")) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      return new Set([
        ...Object.keys(json.dependencies ?? {}),
        ...Object.keys(json.devDependencies ?? {}),
      ])
    }
    const installedDeps = new Set([
      ...readJsonDeps(path.join(REPO_ROOT, "package.json")),
      ...readJsonDeps(path.join(REPO_ROOT, "apps/web/package.json")),
    ])

    const resolveTsFile = (baseNoExt: string): string | null => {
      for (const candidate of [
        baseNoExt,
        `${baseNoExt}.ts`,
        `${baseNoExt}.tsx`,
        path.join(baseNoExt, "index.ts"),
        path.join(baseNoExt, "index.tsx"),
      ]) {
        if (existsSync(candidate)) return candidate
      }
      return null
    }

    const assertExported = (
      targetFile: string,
      defaultImport: string | null,
      namedImports: string[]
    ) => {
      const code = readFileSync(targetFile, "utf8")
      if (defaultImport) {
        expect(code).toMatch(/\bexport\s+default\b/)
      }
      for (const sym of namedImports) {
        const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const declRe = new RegExp(
          `\\bexport\\s+(?:async\\s+)?(?:function|const|let|var|class|type|interface)\\s+${escaped}\\b`
        )
        const listRe = new RegExp(
          `\\bexport\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}`,
          "s"
        )
        expect(declRe.test(code) || listRe.test(code)).toBe(true)
      }
    }

    const blankFiles = [
      "apps/public/src/App.tsx",
      "apps/public/src/pages/HomePage.tsx",
      "apps/public/src/pages/NotFoundPage.tsx",
      "apps/public/src/App.test.tsx",
    ]
    const staticImportRe =
      /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]+)\}\s*)?from\s+["']([^"']+)["']/g
    const dynamicImportRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g

    for (const rel of blankFiles) {
      const abs = path.join(root, rel)
      const content = readFileSync(abs, "utf8")
      const specs: Array<{
        spec: string
        defaultName: string | null
        named: string[]
      }> = []

      for (const m of content.matchAll(staticImportRe)) {
        const named = (m[2] ?? "")
          .split(",")
          .map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
          .filter(Boolean)
        specs.push({ spec: m[3], defaultName: m[1] ?? null, named })
      }
      for (const m of content.matchAll(dynamicImportRe)) {
        specs.push({ spec: m[1], defaultName: null, named: [] })
      }

      expect(specs.length).toBeGreaterThan(0)
      for (const { spec, defaultName, named } of specs) {
        if (spec.startsWith("@/")) {
          const resolved = resolveTsFile(
            path.join(root, "apps/public/src", spec.slice(2))
          )
          expect(resolved).not.toBeNull()
          assertExported(resolved!, defaultName, named)
        } else if (spec.startsWith(".")) {
          const resolved = resolveTsFile(path.resolve(path.dirname(abs), spec))
          expect(resolved).not.toBeNull()
          assertExported(resolved!, defaultName, named)
        } else if (spec.startsWith("@workspace/")) {
          const [, pkg, ...rest] = spec.split("/")
          const resolved = resolveTsFile(
            path.join(REPO_ROOT, "packages", pkg, "src", ...rest)
          )
          expect(resolved).not.toBeNull()
          assertExported(resolved!, defaultName, named)
        } else {
          const pkgName = spec.startsWith("@")
            ? spec.split("/").slice(0, 2).join("/")
            : spec.split("/")[0]
          expect(installedDeps.has(pkgName)).toBe(true)
        }
      }
    }
  })
})

describe("ensureWebAppDockerfileRegions（add-ci 重新 stamp 后补回端依赖层）", () => {
  it("补回结果与增端时写入的 Dockerfile 逐字节一致，且幂等", () => {
    const root = makeFixture()
    addPortal(root)
    addWebApp({ root, id: "mobile", title: "移动端" })
    const expected = readAt(root, "Dockerfile")
    expect(listRegions(expected)).toEqual(["web-app:mobile", "web-app:portal"])

    // 模拟 --mode add-ci：拿模板原件覆盖 Dockerfile（只含默认端）
    writeAt(root, "Dockerfile", FIXTURE_DOCKERFILE)
    expect(listRegions(readAt(root, "Dockerfile"))).toEqual([])

    expect(ensureWebAppDockerfileRegions(root)).toEqual(["portal", "mobile"])
    expect(readAt(root, "Dockerfile")).toBe(expected)

    expect(ensureWebAppDockerfileRegions(root)).toEqual([])
    expect(readAt(root, "Dockerfile")).toBe(expected)
  })

  it("未启用 CI 的项目没有 Dockerfile → 静默跳过", () => {
    const root = makeFixture()
    addPortal(root)
    rmSync(path.join(root, "Dockerfile"))
    expect(ensureWebAppDockerfileRegions(root)).toEqual([])
  })

  it("单端项目 → 不动 Dockerfile", () => {
    const root = makeFixture()
    const before = readAt(root, "Dockerfile")
    expect(ensureWebAppDockerfileRegions(root)).toEqual([])
    expect(readAt(root, "Dockerfile")).toBe(before)
  })
})
