/**
 * `web-apps.json` 端注册表读取器（Node / Bun 通用，不依赖 Bun API）。
 *
 * 消费方：`scripts/run-web-task.ts`、`scripts/collect-web-dist.ts`、各端 `vite.config.ts`。
 * 注册表刻意用 JSON 而非 TS：Bun scripts、Node 下的 vite/eslint 配置、以及不能 import
 * 仓库文件的 `scaffold.ts` 都能直接解析。
 *
 * 例外：`scripts/arch-check.ts` 会被 `--mode add-ci` 单文件 stamp 进目标项目，
 * 不能引入本依赖，它自行内联读取注册表。
 */
import { readFileSync } from "node:fs"
import path from "node:path"

export interface WebApp {
  /** 同时是目录名 apps/<id> 与 workspace 包名 */
  id: string
  /** URL 前缀，必须以 / 开头和结尾；默认端固定 "/" */
  base: string
  devPort: number
  title: string
  /** 可选端准入权限码（体验层，真正的鉴权仍是后端 requirePermission） */
  accessPermission?: string
}

export const DEFAULT_WEB_APP_ID = "web"

const ID_RE = /^[a-z][a-z0-9-]*$/
/** base 路径段字符集：拒绝 `.` `..` `?` `#` 空格等会破坏 URL 前缀语义的字符 */
const BASE_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/

function fail(message: string): never {
  throw new Error(`web-apps.json 无效：${message}`)
}

/** 解析并校验注册表内容（与文件读取分离，便于单测直接喂 JSON） */
export function parseWebApps(raw: unknown): WebApp[] {
  const apps = (raw as { apps?: unknown } | null)?.apps
  if (!Array.isArray(apps) || apps.length === 0) {
    fail("apps 必须是非空数组")
  }

  const seenId = new Set<string>()
  const seenBase = new Set<string>()
  const seenPort = new Set<number>()

  for (const entry of apps as WebApp[]) {
    const { id, base, devPort, title, accessPermission } = entry
    if (typeof id !== "string" || !ID_RE.test(id)) {
      fail(`id ${JSON.stringify(id)} 必须匹配 ${ID_RE}`)
    }
    if (seenId.has(id)) fail(`id "${id}" 重复`)
    seenId.add(id)

    if (
      typeof base !== "string" ||
      !base.startsWith("/") ||
      !base.endsWith("/")
    ) {
      fail(`"${id}" 的 base 必须以 / 开头和结尾（如 /portal/）`)
    }
    if (base.includes("//")) fail(`"${id}" 的 base 不能含空路径段`)
    for (const segment of base.split("/").filter(Boolean)) {
      if (!BASE_SEGMENT_RE.test(segment)) {
        fail(
          `"${id}" 的 base 路径段 "${segment}" 只能含字母/数字/下划线/连字符`
        )
      }
    }
    if (base === "/api/" || base.startsWith("/api/")) {
      fail(`"${id}" 的 base 不能占用 /api/（后端路由前缀）`)
    }
    if (seenBase.has(base)) fail(`base "${base}" 重复`)
    seenBase.add(base)

    if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535) {
      fail(`"${id}" 的 devPort 必须是 1-65535 的整数`)
    }
    if (seenPort.has(devPort)) fail(`devPort ${devPort} 重复`)
    seenPort.add(devPort)

    if (typeof title !== "string" || title.trim() === "") {
      fail(`"${id}" 的 title 不能为空`)
    }
    if (
      accessPermission !== undefined &&
      (typeof accessPermission !== "string" || accessPermission === "")
    ) {
      fail(`"${id}" 的 accessPermission 必须是非空字符串`)
    }
  }

  const roots = (apps as WebApp[]).filter((a) => a.base === "/")
  if (roots.length !== 1 || roots[0].id !== DEFAULT_WEB_APP_ID) {
    fail(`必须有且只有默认端 "${DEFAULT_WEB_APP_ID}" 使用 base "/"`)
  }

  return apps as WebApp[]
}

export function readWebApps(root: string): WebApp[] {
  const file = path.join(root, "web-apps.json")
  return parseWebApps(JSON.parse(readFileSync(file, "utf-8")))
}

/** 取单个端的配置（各端 vite.config.ts 用；缺条目直接报错而不是静默用默认值） */
export function readWebApp(root: string, id: string): WebApp {
  const app = readWebApps(root).find((a) => a.id === id)
  if (!app) fail(`缺少端 "${id}" 的条目`)
  return app
}

/**
 * 静态托管挂载顺序：base 从长到短，默认端 "/" 最后。
 * 顺序反了会让 "/" 的 serveStatic 吞掉 /portal/ 等前缀。
 */
export function orderByBaseDesc(apps: WebApp[]): WebApp[] {
  return [...apps].sort((a, b) => b.base.length - a.base.length)
}
