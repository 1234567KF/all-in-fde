/**
 * 端注册表与多端工具链测试。
 *
 * 全部用临时目录 fixture，不断言本仓库当前有几个端——生成项目可能是多端，
 * 断言真实注册表的条目数会让同一份测试在两种形态下给出不同结果。
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

import { afterEach, describe, expect, it } from "bun:test"

import { collectWebDist } from "./collect-web-dist"
import {
  orderByBaseDesc,
  parseWebApps,
  readWebApp,
  readWebApps,
  type WebApp,
} from "./lib/web-apps"
import { devArgv, isWebTask, taskCommand } from "./run-web-task"

const PC: WebApp = {
  id: "web",
  base: "/",
  devPort: 5173,
  title: "运营端",
}
const PORTAL: WebApp = {
  id: "portal",
  base: "/portal/",
  devPort: 5174,
  title: "企业端",
  accessPermission: "app:portal",
}
const H5: WebApp = {
  id: "h5",
  base: "/h5/",
  devPort: 5175,
  title: "移动端",
}

const temps: string[] = []

function tmpRoot(apps: WebApp[]): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "web-apps-"))
  temps.push(root)
  writeFileSync(
    path.join(root, "web-apps.json"),
    JSON.stringify({ apps }, null, 2)
  )
  return root
}

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true })
})

describe("parseWebApps", () => {
  it("接受单端（默认端 base /）", () => {
    expect(parseWebApps({ apps: [PC] })).toEqual([PC])
  })

  it("接受多端并保留准入权限码", () => {
    const apps = parseWebApps({ apps: [PC, PORTAL, H5] })
    expect(apps.map((a) => a.id)).toEqual(["web", "portal", "h5"])
    expect(apps[1].accessPermission).toBe("app:portal")
  })

  const invalid: [string, unknown][] = [
    ["apps 缺失", {}],
    ["apps 为空", { apps: [] }],
    ["id 非法", { apps: [{ ...PC, id: "Web" }] }],
    ["id 重复", { apps: [PC, { ...PORTAL, id: "web", base: "/x/" }] }],
    ["base 重复", { apps: [PC, { ...PORTAL, base: "/" }] }],
    ["devPort 重复", { apps: [PC, { ...PORTAL, devPort: 5173 }] }],
    ["base 缺尾斜杠", { apps: [PC, { ...PORTAL, base: "/portal" }] }],
    ["base 缺首斜杠", { apps: [PC, { ...PORTAL, base: "portal/" }] }],
    ["base 含空段", { apps: [PC, { ...PORTAL, base: "/por//tal/" }] }],
    ["base 占用 /api/", { apps: [PC, { ...PORTAL, base: "/api/" }] }],
    ["base 在 /api/ 之下", { apps: [PC, { ...PORTAL, base: "/api/x/" }] }],
    ["base 含查询符", { apps: [PC, { ...PORTAL, base: "/x?y/" }] }],
    ["base 含点段", { apps: [PC, { ...PORTAL, base: "/a/../b/" }] }],
    ["base 含空格", { apps: [PC, { ...PORTAL, base: "/a b/" }] }],
    ["devPort 越界", { apps: [{ ...PC, devPort: 70000 }] }],
    ["title 为空", { apps: [{ ...PC, title: "  " }] }],
    ["accessPermission 为空串", { apps: [{ ...PC, accessPermission: "" }] }],
    ["没有默认端", { apps: [{ ...PORTAL }] }],
    ["默认端 id 不是 web", { apps: [{ ...PC, id: "admin" }] }],
    ["多个 base /", { apps: [PC, { ...PORTAL, id: "other", base: "/" }] }],
  ]

  for (const [name, raw] of invalid) {
    it(`拒绝：${name}`, () => {
      expect(() => parseWebApps(raw)).toThrow(/web-apps\.json 无效/)
    })
  }
})

describe("readWebApps / readWebApp", () => {
  it("从磁盘读取并校验", () => {
    const root = tmpRoot([PC, PORTAL])
    expect(readWebApps(root).map((a) => a.id)).toEqual(["web", "portal"])
    expect(readWebApp(root, "portal").devPort).toBe(5174)
  })

  it("缺条目时报错而不是回落默认值", () => {
    const root = tmpRoot([PC])
    expect(() => readWebApp(root, "portal")).toThrow(/缺少端 "portal"/)
  })
})

describe("orderByBaseDesc", () => {
  it("默认端 / 排最后，避免吞掉其他端前缀", () => {
    expect(orderByBaseDesc([PC, H5, PORTAL]).map((a) => a.base)).toEqual([
      "/portal/",
      "/h5/",
      "/",
    ])
  })

  it("不改动入参", () => {
    const apps = [PC, PORTAL]
    orderByBaseDesc(apps)
    expect(apps[0].id).toBe("web")
  })
})

describe("run-web-task 命令推导", () => {
  it("task 白名单", () => {
    expect(isWebTask("build")).toBe(true)
    expect(isWebTask("test")).toBe(true)
    expect(isWebTask("deploy")).toBe(false)
  })

  it("包脚本任务在仓库根用 bun --filter 执行", () => {
    const { argv, cwd } = taskCommand("lint:nocache", "portal")
    expect(argv).toEqual([
      process.execPath,
      "--filter",
      "portal",
      "lint:nocache",
    ])
    expect(existsSync(path.join(cwd, "web-apps.json"))).toBe(true)
  })

  it("vitest 走 bun x 且在端目录内执行（包脚本会落到 node 上）", () => {
    const { argv, cwd } = taskCommand("test", "portal")
    expect(argv).toEqual([process.execPath, "x", "vitest", "run"])
    // 必须用原生分隔符比较：Windows 上 path.join 产出反斜杠，POSIX 字面量会假红
    expect(cwd.endsWith(path.join("apps", "portal"))).toBe(true)
    expect(taskCommand("test:coverage", "h5").argv).toEqual([
      process.execPath,
      "x",
      "vitest",
      "run",
      "--coverage",
    ])
  })

  it("spawn 用 execPath 而非裸 bun/bunx（Windows 只有 .cmd shim 时会 ENOENT）", () => {
    for (const task of [
      "test",
      "test:coverage",
      "dev",
      "build",
      "lint",
    ] as const) {
      expect(taskCommand(task, "web").argv[0]).toBe(process.execPath)
    }
    expect(devArgv([PC])[0]).toBe(process.execPath)
  })

  it("vitest 子进程强制 NODE_ENV=test（Bun 直接跑 .ts 会隐式 production）", () => {
    expect(taskCommand("test", "web").env.NODE_ENV).toBe("test")
    expect(taskCommand("test:coverage", "web").env.NODE_ENV).toBe("test")
  })

  it("dev 并发拉起 api 与所有端", () => {
    expect(devArgv([PC, PORTAL, H5])).toEqual([
      process.execPath,
      "x",
      "concurrently",
      "-n",
      "api,web,portal,h5",
      "bun --filter api dev",
      "bun --filter web dev",
      "bun --filter portal dev",
      "bun --filter h5 dev",
    ])
  })
})

describe("collectWebDist", () => {
  it("各端产物平级汇总，注册表副本落在静态根之外", () => {
    const root = tmpRoot([PC, PORTAL])
    for (const app of [PC, PORTAL]) {
      const dist = path.join(root, "apps", app.id, "dist")
      mkdirSync(path.join(dist, "js"), { recursive: true })
      writeFileSync(
        path.join(dist, "index.html"),
        `<title>${app.title}</title>`
      )
      writeFileSync(path.join(dist, "js", "app.js"), `// ${app.id}`)
    }

    collectWebDist(root)

    expect(
      readFileSync(path.join(root, "dist/web/web/index.html"), "utf-8")
    ).toContain("运营端")
    expect(
      readFileSync(path.join(root, "dist/web/portal/js/app.js"), "utf-8")
    ).toBe("// portal")
    // 注册表不能被 serveStatic 暴露：必须在 dist/web 之外
    expect(existsSync(path.join(root, "dist/web-apps.json"))).toBe(true)
    expect(existsSync(path.join(root, "dist/web/web-apps.json"))).toBe(false)
  })

  it("重复执行会清掉已移除端的残留产物", () => {
    const root = tmpRoot([PC, PORTAL])
    for (const app of [PC, PORTAL]) {
      const dist = path.join(root, "apps", app.id, "dist")
      mkdirSync(dist, { recursive: true })
      writeFileSync(path.join(dist, "index.html"), app.id)
    }
    collectWebDist(root)
    expect(existsSync(path.join(root, "dist/web/portal"))).toBe(true)

    writeFileSync(
      path.join(root, "web-apps.json"),
      JSON.stringify({ apps: [PC] })
    )
    collectWebDist(root)
    expect(existsSync(path.join(root, "dist/web/portal"))).toBe(false)
  })

  it("缺产物时报错并指出端 id", () => {
    const root = tmpRoot([PC, PORTAL])
    mkdirSync(path.join(root, "apps/web/dist"), { recursive: true })
    expect(() => collectWebDist(root)).toThrow(/apps\/portal\/dist/)
  })
})
