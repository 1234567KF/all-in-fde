#!/usr/bin/env bun
/**
 * 把各端 `apps/<id>/dist` 汇总成部署布局 `dist/web/<id>/`，并复制注册表副本。
 *
 * 由 `scripts/build-server.sh` 在逐端 build 之后调用；Dockerfile 从
 * `dist/web` 与 `dist/web-apps.json` 拷进镜像。所有端（含默认端）平级，
 * 因此各端可独立并行 build，不存在 Vite emptyOutDir 互相清空的顺序依赖。
 *
 * 注册表副本放在静态根 `dist/web` **之外**，不对外暴露。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { readWebApps } from "./lib/web-apps.js"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

export function collectWebDist(root: string): void {
  const apps = readWebApps(root)
  const outDir = path.join(root, "dist", "web")

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  for (const app of apps) {
    const src = path.join(root, "apps", app.id, "dist")
    if (!existsSync(src)) {
      throw new Error(
        `缺少 ${app.id} 的构建产物 apps/${app.id}/dist，请先执行 bun run build:web`
      )
    }
    cpSync(src, path.join(outDir, app.id), { recursive: true })
    console.log(`  -> dist/web/${app.id}  (base ${app.base})`)
  }

  cpSync(
    path.join(root, "web-apps.json"),
    path.join(root, "dist", "web-apps.json")
  )
}

if (import.meta.main) {
  collectWebDist(ROOT)
}