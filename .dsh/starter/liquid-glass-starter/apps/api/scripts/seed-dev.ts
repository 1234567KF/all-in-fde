/**
 * 本地开发种子数据脚本（手动执行，不随服务启动运行）
 *
 * 用法：bun run db:seed-dev
 * 说明：补充开发测试种子数据（幂等，已存在则跳过）。
 *       生产环境请勿执行。
 *
 * 机制约定（沉淀自实战项目）：
 *   ▸ 幂等播种：唯一键冲突 onConflictDoNothing，存量库可反复执行补齐新增数据
 *   ▸ 生产守卫：NODE_ENV=production 直接拒绝执行
 *   ▸ 种子密码：与启动种子同源（SEED_ADMIN_PASSWORD，开发缺省 admin123），
 *     以 bcrypt hash 写入 password_hash；密码至少 6 位（与登录校验一致，否则账号
 *     无法登录），生产环境禁止执行本脚本，管理员密码由生产环境显式配置，
 *     严禁把真实密码硬编码进仓库
 *
 * 路径约定：DATA_DIR 环境变量优先，默认 apps/api/data；结构来源由
 * bootstrapDatabase 自动探测（init.sql 或 drizzle/），脚本从仓库根执行也正确。
 * 不 import src/db/index.js —— 其模块级 `new Database("sqlite.db")` 会在 cwd
 * 产生副产物文件；这里仅引用纯声明的 schema.ts。
 */
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { PASSWORD_MIN_LENGTH } from "shared"

import { bootstrapDatabase } from "../src/db/bootstrap.js"
import { seedDemoNotifications } from "../src/db/demo-seed.js"
import * as schema from "../src/db/schema.js"
import { users } from "../src/db/schema.js"
import { hashPasswordSync } from "../src/utils/password.js"

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

/** SQLite 数据文件所在目录（与 src/db.ts 的 DATA_DIR 约定一致） */
export function resolveDataDir(): string {
  return process.env.DATA_DIR || join(apiRoot, "data")
}

export type DevDb = ReturnType<typeof drizzle<typeof schema, Database>>

/** 打开本地 dev 库并应用全量迁移（不存在则创建） */
export function openDevDb(): DevDb {
  const dataDir = resolveDataDir()
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }
  const sqlite = new Database(join(dataDir, "sqlite.db"))
  sqlite.exec("PRAGMA journal_mode = WAL")
  const db = drizzle(sqlite, { schema })
  bootstrapDatabase(sqlite, db, { baseDir: apiRoot })
  return db
}

/**
 * 解析并校验开发种子密码（与启动种子同源）。
 *
 * 必须满足登录校验的密码下限：写入短密码会导致 admin 永久无法登录
 * （登录接口会先以「密码至少需要 N 位」拒绝），且没有改密接口可自助恢复。
 */
export function resolveSeedAdminPassword(): string {
  const password = process.env.SEED_ADMIN_PASSWORD || "admin123"
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `SEED_ADMIN_PASSWORD 至少需要 ${PASSWORD_MIN_LENGTH} 位（与登录校验一致），否则种子账号无法登录`
    )
  }
  return password
}

/**
 * 开发环境种子数据：管理员 + 演示用户。
 * 幂等——按 email 唯一键 onConflictDoNothing，重复执行不会插入重复行。
 * demo / viewer 属于演示数据（feature:demo），--clean-demo 的生成项目不会播种。
 */
export function seedDevData(d: DevDb): void {
  const now = new Date().toISOString()
  // 开发种子密码：与启动种子同源（SEED_ADMIN_PASSWORD，缺省 admin123）
  const passwordHash = hashPasswordSync(resolveSeedAdminPassword())

  d.insert(users)
    .values([
      // 与 src/db.ts 启动种子保持一致的管理员（先到先得，互不冲突）
      {
        email: "admin",
        name: "Admin",
        role: "admin",
        passwordHash,
        createdAt: now,
      },
      // #region feature:demo
      {
        email: "demo@example.com",
        name: "Demo User",
        role: "user",
        passwordHash,
        createdAt: now,
      },
      {
        email: "viewer@example.com",
        name: "Demo Viewer",
        role: "user",
        passwordHash,
        createdAt: now,
      },
      // #endregion feature:demo
    ])
    .onConflictDoNothing()
    .run()

  // #region feature:notification
  seedDemoNotifications(d)
  // #endregion feature:notification
}

// #region feature:notification
// 演示消息：数据与写入逻辑统一在 src/db/demo-seed.ts
// （模板建库种子与本地 db:reset 复用同一份，避免两处漂移）
// 本地 db:reset 仍会由 seedDevData 一并补齐 7 条演示通知。
// #endregion feature:notification

if (import.meta.main) {
  if (process.env.NODE_ENV === "production") {
    console.error("❌ 禁止在生产环境执行 seed-dev")
    process.exit(1)
  }

  seedDevData(openDevDb())

  console.log("\n🎉 本地开发种子数据就绪")
  console.log("  管理员  admin")
  // #region feature:demo
  console.log("  用户    demo@example.com / viewer@example.com")
  // #endregion feature:demo
  // #region feature:notification
  console.log(
    "  消息    admin 的 7 条演示通知（4 未读 / 3 已读，登录后看顶栏）"
  )
  // #endregion feature:notification
}
