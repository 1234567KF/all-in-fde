/**
 * 新增 Web 端的**参数形状校验**（`--mode add-web` 与 init 多端共用）。
 *
 * 自包含约束：skill 官方安装方式是 `npx giget .../skills/project-scaffolder`，
 * 只安装 skill 子树，因此本文件不得 import skill 目录之外的任何相对路径。
 *
 * 增端的机械部分（克隆默认端 / 改身份 / 写注册区块）在**目标项目**的
 * `scripts/add-web.ts`，不在这里：项目侧受 lint / typecheck / test / arch:check 全覆盖，
 * 且端样板就是项目自己的默认端，不存在「模板落后于项目」的平行维护轴。
 * 本文件只保留必须在项目存在之前跑的纯形状校验（init 的早期参数预检）。
 */

export interface WebAppEntry {
  id: string
  base: string
  devPort: number
  title: string
  accessPermission?: string
}

/** 目标项目 `scripts/add-web.ts --json` 的输出形状（跨进程契约）。 */
export interface AddWebAppResult {
  entry: WebAppEntry
  /** 相对项目根的新建文件（posix 分隔） */
  createdFiles: string[]
  /** 相对项目根的改动文件（posix 分隔） */
  modifiedFiles: string[]
  /** 克隆继承来的业务模块切片名 */
  inheritedModules: string[]
  /** 克隆继承来的页面目录/文件名 */
  inheritedPages: string[]
}

export const DEFAULT_WEB_APP_ID = "web"

const ID_RE = /^[a-z][a-z0-9-]*$/
/** base 的每个路径段：拒绝 `.` `..` `?` `#` 空格等会破坏 URL 前缀语义的字符 */
const BASE_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/
/** Windows 保留设备名：mkdir 会失败，必须在校验期挡掉而不是写入期报裸 ENOENT */
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/
/** API 占用端口，Vite 不能与之冲突 */
const API_DEV_PORT = 3000

/** 校验失败一律抛 Error（调用方负责打印并退出），保证校验期零副作用。 */
function fail(message: string): never {
  throw new Error(message)
}

/** base 归一化：补首尾斜杠（`portal` / `/portal` / `portal/` 都接受）。 */
function normalizeBase(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === "") fail(`base 不能为空`)
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`
}

export interface WebAppFieldsInput {
  id: string
  title: string
  base?: string
  devPort?: number
  accessPermission?: boolean
  blank?: boolean
}

/**
 * 纯形状校验（不碰文件系统），返回归一化后的 base。
 *
 * init 的早期参数预检与 addWebApp 共用：`--web-apps` 的语义错误必须在模板复制 /
 * 特性剥离之前暴露，否则会留下无法用 add-web 补救的半成品项目。
 * 涉及项目状态的校验（既有 id / base / 端口冲突、默认端一级路由）留在 addWebApp。
 */
export function validateWebAppFields(input: WebAppFieldsInput): string {
  const { id, title } = input
  if (typeof id !== "string" || !ID_RE.test(id)) {
    fail(
      `id "${id}" 必须匹配 ${ID_RE}（小写字母开头，只含小写字母/数字/连字符）`
    )
  }
  if (id === DEFAULT_WEB_APP_ID) fail(`id "${DEFAULT_WEB_APP_ID}" 保留给默认端`)
  if (id === "api") fail(`id "api" 保留给后端`)
  if (WINDOWS_DEVICE_RE.test(id)) {
    fail(`id "${id}" 是 Windows 保留设备名，不能用作目录名`)
  }
  if (typeof title !== "string" || title.trim() === "") fail(`title 不能为空`)

  const base = normalizeBase(input.base ?? `/${id}/`)
  if (base === "/") fail(`base "/" 保留给默认端 "${DEFAULT_WEB_APP_ID}"`)
  if (base.includes("//")) fail(`base "${base}" 不能含空路径段`)
  if (base === "/api/" || base.startsWith("/api/")) {
    fail(`base "${base}" 不能占用 /api/（后端路由前缀）`)
  }
  for (const segment of base.split("/").filter(Boolean)) {
    if (!BASE_SEGMENT_RE.test(segment)) {
      fail(
        `base "${base}" 的路径段 "${segment}" 只能含字母/数字/下划线/连字符（拒绝 . .. ? # 空格等）`
      )
    }
  }

  if (input.devPort !== undefined) {
    const { devPort } = input
    if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535) {
      fail(`devPort ${devPort} 必须是 1-65535 的整数`)
    }
    if (devPort === API_DEV_PORT)
      fail(`devPort 不能是 ${API_DEV_PORT}（API 端口）`)
  }
  // 下游按 `=== true` 决定是否注册准入码：JSON 里写成字符串 "true" 会静默变成
  // 「无准入」，把用户明确要求受限的端开放出去，所以必须在这里挡掉非布尔值。
  if (
    input.accessPermission !== undefined &&
    typeof input.accessPermission !== "boolean"
  ) {
    fail(`accessPermission 必须是布尔值（true = 注册 app:<id> 准入码）`)
  }
  if (input.blank !== undefined && typeof input.blank !== "boolean") {
    fail(`blank 必须是布尔值（true = 极简无登录空壳）`)
  }
  if (input.blank && input.accessPermission) {
    fail(
      `--blank 与 --access-permission 互斥：极简空壳无登录与侧边栏拦截器；需要角色准入请省略 blank`
    )
  }
  return base
}
