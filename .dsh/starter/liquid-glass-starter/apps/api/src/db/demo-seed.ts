/**
 * 模板演示数据 — 仅模板自部署 / 本地首启使用
 *
 * 定位：让 starter 的演示实例拥有「可反复演示」的消息数据。
 * 触发条件不是环境变量，而是建库来源：模板空库执行 init.sql 时自动补齐
 * （见 apps/api/src/db.ts）；scaffold 生成项目走 drizzle 迁移，不会种。
 * 真实业务项目不要把它当业务种子——业务通知应当由业务事件调用 notify() 产生。
 *
 * 幂等：固定主键 id（seed-notification-N）+ ON CONFLICT DO NOTHING；
 * 重复播种不会产生重复数据。
 */
import type { BootstrapSource } from "./bootstrap.js"
import type { DrizzleDB } from "./index.js"
import { notifications } from "./schema.js"

/** 演示消息收件人：starter 的 JWT sub = users.email，admin 登录后 sub 即 "admin" */
export const DEMO_RECIPIENT_ID = "admin"

/** 演示消息固定主键前缀（便于识别演示数据，避免与业务通知混淆） */
const DEMO_ID_PREFIX = "seed-notification-"

export interface DemoNotificationSeed {
  type: string
  title: string
  content: string
  read: boolean
  minutesAgo: number
  href?: string
}

/** 与 apps/web/src/lib/demo-notifications.ts 同一套业务 type / 文案，保证前端注册表命中 */
export const DEMO_NOTIFICATION_SEEDS: readonly DemoNotificationSeed[] = [
  {
    type: "approval",
    title: "新的审批申请",
    content: "李四提交了审批「Q4 版本发布计划」，请及时审核",
    read: false,
    minutesAgo: 4,
    href: "/dashboard",
  },
  {
    type: "approved",
    title: "审批已通过",
    content: "您提交的「V2 版本」已通过评审，可以开始实施",
    read: false,
    minutesAgo: 26,
    // #region feature:demo
    href: "/components",
    // #endregion feature:demo
  },
  {
    type: "assigned",
    title: "任务已指派",
    content: "王五将「消息中心组件沉淀」指派给您跟进",
    read: false,
    minutesAgo: 75,
    // #region feature:demo
    href: "/components/notifications",
    // #endregion feature:demo
  },
  {
    type: "rejected",
    title: "审批被驳回",
    content: "您的「数据迁移任务」被驳回，请检查依赖配置后重新提交",
    read: false,
    minutesAgo: 300,
    // #region feature:demo
    href: "/system-settings",
    // #endregion feature:demo
  },
  {
    type: "announcement",
    title: "系统公告",
    content: "系统将于周六 02:00 进行维护，预计持续 30 分钟「周末维护窗口」",
    read: true,
    minutesAgo: 60 * 26,
    href: "/dashboard",
  },
  {
    type: "account",
    title: "账号已创建",
    content: "您的账号已创建，请及时修改初始密码",
    read: true,
    minutesAgo: 60 * 48,
    href: "/settings",
  },
  {
    type: "system",
    title: "欢迎使用消息中心",
    content:
      "消息通知内核与业务解耦，type 由业务自定义；这是一条「系统消息」示例",
    read: true,
    minutesAgo: 60 * 72,
    // #region feature:demo
    href: "/components/notifications",
    // #endregion feature:demo
  },
] as const

function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * 幂等补齐演示消息（已存在的固定 id 跳过）。
 *
 * @returns 本次实际插入的条数
 */
export function seedDemoNotifications(db: DrizzleDB, now = Date.now()): number {
  let inserted = 0

  for (const [index, seed] of DEMO_NOTIFICATION_SEEDS.entries()) {
    const createTimeMs = now - seed.minutesAgo * 60_000
    const row = db
      .insert(notifications)
      .values({
        id: `${DEMO_ID_PREFIX}${index + 1}`,
        recipientId: DEMO_RECIPIENT_ID,
        type: seed.type,
        title: seed.title,
        content: seed.content,
        payload: { href: seed.href },
        isRead: seed.read ? 1 : 0,
        readTime: seed.read ? toIso(createTimeMs + 60_000) : null,
        createTime: toIso(createTimeMs),
        dedupeKey: null,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id })
      .get()

    if (row) inserted += 1
  }

  return inserted
}

/**
 * 按建库来源决定是否补齐演示消息。
 *
 * 模板（init.sql）空库建库 → 补齐 7 条；
 * 生成项目走 drizzle 迁移（source.kind === "drizzle"）→ 不种。
 * 用建库来源而不是环境变量，避免生成项目误开演示开关。
 *
 * @returns 本次实际插入的条数（幂等：已存在时为 0）
 */
export function seedTemplateDemoData(
  db: DrizzleDB,
  source: BootstrapSource
): number {
  if (source.kind !== "init") return 0
  return seedDemoNotifications(db)
}
