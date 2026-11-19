import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "bun:test"

import { validateWebAppFields } from "./web-app"

const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("validateWebAppFields", () => {
  it("归一化 base 并接受合法配置", () => {
    expect(
      validateWebAppFields({
        id: "public",
        title: "官网 H5",
        base: "p",
        blank: true,
      })
    ).toBe("/p/")
  })

  it("拒绝非法 id / base / devPort / 非布尔标记", () => {
    expect(() => validateWebAppFields({ id: "Web", title: "测试" })).toThrow(
      /必须匹配/
    )
    expect(() =>
      validateWebAppFields({ id: "public", title: "测试", base: "/" })
    ).toThrow(/保留给默认端/)
    expect(() =>
      validateWebAppFields({ id: "public", title: "测试", devPort: 3000 })
    ).toThrow(/API 端口/)
    expect(() =>
      validateWebAppFields({
        id: "public",
        title: "测试",
        blank: "true" as unknown as boolean,
      })
    ).toThrow(/blank 必须是布尔值/)
  })

  it("拒绝 --blank 与 --access-permission 同时启用", () => {
    expect(() =>
      validateWebAppFields({
        id: "public",
        title: "公众端",
        blank: true,
        accessPermission: true,
      })
    ).toThrow(/互斥/)
  })

  it("scaffold --mode add-web --blank 遇到旧版 scripts/add-web.ts 报错时给出升级提示", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "scaffold-blank-compat-"))
    temps.push(tempRoot)
    mkdirSync(path.join(tempRoot, "scripts"), { recursive: true })
    writeFileSync(
      path.join(tempRoot, "scripts", "add-web.ts"),
      'console.error("❌ 参数 --blank 缺少取值"); process.exit(1)\n',
      "utf8"
    )
    const scaffoldPath = fileURLToPath(new URL("../scaffold.ts", import.meta.url))
    const run = Bun.spawnSync(
      [
        process.execPath,
        "run",
        scaffoldPath,
        "--mode",
        "add-web",
        "--target",
        tempRoot,
        "--id",
        "public",
        "--title",
        "官网",
        "--blank",
      ],
      { cwd: tempRoot }
    )
    expect(run.exitCode).toBe(1)
    expect(run.stderr.toString()).toContain("版本较旧，不支持 --blank")
  })
})
