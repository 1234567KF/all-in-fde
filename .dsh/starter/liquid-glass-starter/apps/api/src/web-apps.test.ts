/**
 * 多端静态托管测试：用真实 Hono app + 临时目录产物验证挂载顺序与 fallback。
 *
 * 覆盖单端（退化成今天的两行）与多端（默认端 "/" 必须最后挂）两种形态，
 * 以及「非默认端的深链回自己的 index.html」「资源不跨端串味」。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "bun:test"
import { Hono } from "hono"

import { mountWebApps, readWebApps, type StaticWebApp } from "./web-apps.js"

const temps: string[] = []

/** 造一份 dist/web/<id> 布局：index.html 带端标记，js/app.js 只属于该端 */
function fixture(apps: StaticWebApp[]): { root: string; webRoot: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "static-apps-"))
  temps.push(root)
  const webRoot = path.join(root, "web")
  for (const app of apps) {
    const dir = path.join(webRoot, app.id)
    mkdirSync(path.join(dir, "js"), { recursive: true })
    writeFileSync(path.join(dir, "index.html"), `index:${app.id}`)
    writeFileSync(path.join(dir, "js", "app.js"), `asset:${app.id}`)
  }
  writeFileSync(
    path.join(root, "web-apps.json"),
    JSON.stringify({ apps }, null, 2)
  )
  return { root, webRoot }
}

function buildApp(apps: StaticWebApp[], webRoot: string): Hono {
  const rootApp = new Hono()
  rootApp.get("/api/ping", (c) => c.text("pong"))
  mountWebApps(rootApp, apps, webRoot)
  return rootApp
}

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true })
})

describe("readWebApps", () => {
  it("按 base 从长到短排序，默认端最后", () => {
    const { root } = fixture([
      { id: "web", base: "/" },
      { id: "h5", base: "/h5/" },
      { id: "portal", base: "/portal/" },
    ])
    expect(
      readWebApps(path.join(root, "web-apps.json")).map((a) => a.id)
    ).toEqual(["portal", "h5", "web"])
  })
})

describe("单端形态", () => {
  const apps: StaticWebApp[] = [{ id: "web", base: "/" }]

  it("根路径、深链与静态资源都命中默认端", async () => {
    const { webRoot } = fixture(apps)
    const app = buildApp(apps, webRoot)

    expect(await (await app.request("/")).text()).toBe("index:web")
    expect(await (await app.request("/users/42")).text()).toBe("index:web")
    expect(await (await app.request("/js/app.js")).text()).toBe("asset:web")
  })

  it("API 路由优先于 SPA fallback", async () => {
    const { webRoot } = fixture(apps)
    const app = buildApp(apps, webRoot)
    expect(await (await app.request("/api/ping")).text()).toBe("pong")
  })
})

describe("多端形态", () => {
  const apps: StaticWebApp[] = [
    { id: "web", base: "/" },
    { id: "portal", base: "/portal/" },
    { id: "h5", base: "/h5/" },
  ]

  it("各端命中自己的 index.html 与资源", async () => {
    const { root, webRoot } = fixture(apps)
    const app = buildApp(readWebApps(path.join(root, "web-apps.json")), webRoot)

    expect(await (await app.request("/")).text()).toBe("index:web")
    expect(await (await app.request("/portal/")).text()).toBe("index:portal")
    expect(await (await app.request("/h5/")).text()).toBe("index:h5")
    expect(await (await app.request("/portal/js/app.js")).text()).toBe(
      "asset:portal"
    )
    expect(await (await app.request("/h5/js/app.js")).text()).toBe("asset:h5")
  })

  it("非默认端深链回自己的 index.html，而不是默认端的", async () => {
    const { root, webRoot } = fixture(apps)
    const app = buildApp(readWebApps(path.join(root, "web-apps.json")), webRoot)

    expect(await (await app.request("/portal/users/42")).text()).toBe(
      "index:portal"
    )
    expect(await (await app.request("/h5/mine")).text()).toBe("index:h5")
  })

  it("资源不跨端串味：别的端独有的文件退回本端 index.html", async () => {
    const { root, webRoot } = fixture(apps)
    writeFileSync(path.join(webRoot, "web", "js", "only-web.js"), "secret")
    const app = buildApp(readWebApps(path.join(root, "web-apps.json")), webRoot)

    expect(await (await app.request("/portal/js/only-web.js")).text()).toBe(
      "index:portal"
    )
  })

  it("不带尾斜杠的端前缀 302 到带尾斜杠", async () => {
    const { root, webRoot } = fixture(apps)
    const app = buildApp(readWebApps(path.join(root, "web-apps.json")), webRoot)

    const res = await app.request("/portal")
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/portal/")
  })

  it("注册表顺序颠倒也不会让默认端吞掉其他端", async () => {
    const { root, webRoot } = fixture(apps)
    // 把注册表改写成「默认端在前」的错误顺序：readWebApps 的排序是唯一保障
    writeFileSync(
      path.join(root, "web-apps.json"),
      JSON.stringify({ apps: [...apps].reverse() })
    )
    const app = buildApp(readWebApps(path.join(root, "web-apps.json")), webRoot)
    expect(await (await app.request("/portal/")).text()).toBe("index:portal")
  })
})
