/**
 * 多端静态托管：读端注册表，按 base 从长到短逐端挂 serveStatic + SPA fallback。
 *
 * 单端项目注册表只有 1 条，循环退化成「静态资源 + fallback」两行；
 * 多端时默认端 "/" 必须最后挂，否则会吞掉 /portal/ 等前缀。
 *
 * 注册表由 scripts/collect-web-dist.ts 复制为 dist/web-apps.json，
 * Dockerfile 拷到 /app/web-apps.json（在静态根 /app/web 之外，不对外暴露）。
 */
import { readFileSync } from "node:fs"

import type { Hono } from "hono"
import { serveStatic } from "hono/bun"

export interface StaticWebApp {
  id: string
  base: string
}

/** 读注册表并返回挂载顺序（base 长的在前，默认端 "/" 最后） */
export function readWebApps(registryPath: string): StaticWebApp[] {
  const { apps } = JSON.parse(readFileSync(registryPath, "utf-8")) as {
    apps: StaticWebApp[]
  }
  return [...apps].sort((a, b) => b.base.length - a.base.length)
}

/**
 * 逐端挂载静态资源与 SPA fallback。
 *
 * hono 的 serveStatic 把**完整**的 c.req.path 交给 rewriteRequestPath，再与 root
 * 拼接，所以这里必须自己剥掉 base 前缀；设置了 path 时则跳过 rewrite（fallback 用）。
 * fallback 传 root + 相对 path 而不是拼好的完整 path：bun 适配器用 node:path.join
 * 拼 root 与 path，完整绝对路径会被 join 吃掉前导斜杠。
 */
export function mountWebApps(
  rootApp: Hono,
  apps: StaticWebApp[],
  webRoot = "./web"
): void {
  for (const app of apps) {
    const root = `${webRoot}/${app.id}`
    // /portal -> /portal/：不带尾斜杠时浏览器会把相对资源解析到上一层
    if (app.base !== "/") {
      rootApp.get(app.base.slice(0, -1), (c) => c.redirect(app.base))
    }
    rootApp.use(
      `${app.base}*`,
      serveStatic({
        root,
        rewriteRequestPath: (p) => p.slice(app.base.length - 1),
      })
    )
    rootApp.get(`${app.base}*`, serveStatic({ root, path: "index.html" }))
  }
}
