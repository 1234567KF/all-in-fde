/**
 * 环境变量解析与启动期校验。
 *
 * 纯函数（parsePositiveNumber / assertOssConfiguration / assertOssEndpoint /
 * assertSeedAdminPassword）单独导出，便于直接单测边界值；模块加载时用它们校验
 * 真实 env 快照，校验失败即启动失败。
 */
import { PASSWORD_MIN_LENGTH } from "shared"

/** `.env.example` 里的占位值：生产直接复制未改就启动 = 公开默认密码 */
export const SEED_ADMIN_PASSWORD_PLACEHOLDER = "change-me-in-production"

/**
 * 校验初始 admin 密码（空库首次建库时写入种子 hash 的唯一口令来源）：
 * - 必须满足登录校验（LoginSchema）的密码下限，否则种子写入的 admin 永远无法登录，
 *   且 starter 没有改密接口可自助恢复；
 * - production 拒绝 `.env.example` 占位值，避免示例文件被直接复制上线。
 */
export function assertSeedAdminPassword(
  password: string,
  nodeEnv: string
): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `[ENV] SEED_ADMIN_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters (same as login validation), otherwise the seeded admin could never log in`
    )
  }
  if (
    nodeEnv === "production" &&
    password === SEED_ADMIN_PASSWORD_PLACEHOLDER
  ) {
    throw new Error(
      "[ENV] SEED_ADMIN_PASSWORD is still the .env.example placeholder; set a real password before production"
    )
  }
}

/** 解析正数环境变量（缺省或非法时回落默认值，避免 NaN 传播到业务计算） */
export function parsePositiveNumber(
  raw: string | undefined,
  fallback: number
): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * 校验 OSS 三要素（AK ID / AK Secret / Bucket）配置：
 * - 全空（本地开发 mock 模式）或三项齐全均合法；
 * - 生产环境禁止「半启用」：缺任意一项会静默降级本地 mock，上传凭证指向不存在的
 *   回退路由（带病运行），因此宁可启动失败。
 */
export function assertOssConfiguration(
  nodeEnv: string,
  oss: { accessKeyId: string; accessKeySecret: string; bucket: string }
): void {
  const configuredCount = [
    oss.accessKeyId,
    oss.accessKeySecret,
    oss.bucket,
  ].filter(Boolean).length
  if (nodeEnv === "production" && configuredCount > 0 && configuredCount < 3) {
    throw new Error(
      "[ENV] OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET must be configured together"
    )
  }
}

/**
 * 校验 OSS_ENDPOINT 格式：留空合法；配置时必须是 http(s) URL 且不能带 path/query/hash
 * （ali-oss 内部按 URL 解析 endpoint，非法值会在首次上传时才抛错——提前到启动期暴露）。
 */
export function assertOssEndpoint(endpoint: string): void {
  if (!endpoint) return

  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new Error(
      "[ENV] OSS_ENDPOINT must be a valid http(s) URL, e.g. https://oss-cn-hangzhou-internal.aliyuncs.com"
    )
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("[ENV] OSS_ENDPOINT must use http:// or https://")
  }
  if (!parsed.hostname) {
    throw new Error("[ENV] OSS_ENDPOINT must contain a hostname")
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(
      "[ENV] OSS_ENDPOINT must not contain path / query / hash, only scheme://host[:port]"
    )
  }
}

export const env = {
  PORT: parseInt(process.env.PORT || "3000"),
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",
  NODE_ENV: process.env.NODE_ENV || "development",
  JWT_SECRET: process.env.JWT_SECRET || "dev-secret-key",
  /**
   * 初始 admin 密码：仅在空库首次建库时用于写入种子 hash。
   * 开发默认 admin123；生产必须显式配置。启动期校验（见 assertSeedAdminPassword）：
   * 至少 6 位（与登录校验一致，否则种子账号无法登录）、生产拒绝 .env.example 占位值。
   * 已存在的库不会因修改本变量而改密。
   */
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || "admin123",

  // ─── 对象存储（ali-oss 双模，使用方见 shared/oss.ts）────────────────────────
  /**
   * 三项（AK ID / AK Secret / Bucket）**同时**配置才启用 OSS 模式；
   * 任一缺失即降级本地 mock 模式（上传凭证指向本地回退路由，便于无云环境开发）。
   */
  OSS_ACCESS_KEY_ID: process.env.OSS_ACCESS_KEY_ID || "",
  OSS_ACCESS_KEY_SECRET: process.env.OSS_ACCESS_KEY_SECRET || "",
  OSS_BUCKET: process.env.OSS_BUCKET || "",
  /** OSS 区域（默认杭州） */
  OSS_REGION: process.env.OSS_REGION || "oss-cn-hangzhou",
  /**
   * 自定义 OSS 服务 endpoint（内网 / 代理场景），如
   * `https://oss-cn-hangzhou-internal.aliyuncs.com`；留空则由 bucket + region 拼默认域名。
   * 注意：直传 host 会按 ali-oss 语义自动拼 `${bucket}.`（IP 形式 endpoint 除外）。
   */
  OSS_ENDPOINT: process.env.OSS_ENDPOINT || "",
  /** 对象 key 统一前缀（多环境共用一个 bucket 时做隔离，如 `my-app/dev`） */
  OSS_PREFIX: process.env.OSS_PREFIX || "",
  /** CDN 域名：配置后签名 URL 用 CDN 域名替换 OSS 默认域名 */
  OSS_CDN_DOMAIN: process.env.OSS_CDN_DOMAIN || "",
  /** 上传大小上限（MB，默认 10）；同时写入 OSS Post Policy 与业务校验 */
  UPLOAD_MAX_SIZE_MB: parsePositiveNumber(process.env.UPLOAD_MAX_SIZE_MB, 10),
} as const

// 生产环境必须配置
if (env.NODE_ENV === "production" && !process.env.FRONTEND_URL) {
  throw new Error("[ENV] FRONTEND_URL is required in production")
}

if (env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("[ENV] JWT_SECRET is required in production")
}

if (env.NODE_ENV === "production" && !process.env.SEED_ADMIN_PASSWORD) {
  throw new Error("[ENV] SEED_ADMIN_PASSWORD is required in production")
}

// 初始 admin 密码策略：短于登录下限会让种子账号永久锁死；占位值等于公开密码
assertSeedAdminPassword(env.SEED_ADMIN_PASSWORD, env.NODE_ENV)

// OSS 双模禁止「半启用」；endpoint 格式非法也提前暴露（详见上方纯函数注释）
assertOssConfiguration(env.NODE_ENV, {
  accessKeyId: env.OSS_ACCESS_KEY_ID,
  accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
  bucket: env.OSS_BUCKET,
})
assertOssEndpoint(env.OSS_ENDPOINT)
