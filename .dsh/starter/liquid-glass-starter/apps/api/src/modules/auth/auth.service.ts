/**
 * Auth 服务层 — 登录/刷新（登录审计「活教材」）
 *
 * 骨架约定（回流自 CRM modules/auth，剥除 CRM 业务：渠道登录/岗位/限流）：
 * - 登录成功/失败均写审计：createAuditor(AUDIT_MODULES.USER) +
 *   AUDIT_EVENT_TYPES.LOGIN，失败传 severity warning + result failure
 * - 登录是未认证入口，OpCtx 的 operator 字段为空（仅 ip/ua/requestId 有值），
 *   审计时用登录目标账号覆盖 operator 字段
 *
 * 密码说明：users.password_hash 存 bcrypt hash；hash 为空的用户禁止密码登录
 * （为 SSO / 多方式登录预留）。登录校验的两个「替换点」见下方
 * findUserByIdentifier / verifyCredential；扩展手机号、短信验证码或 SSO 时
 * 只需替换这两处与 LoginSchema，不要动 JWT 签发 / 审计 / 权限。
 */
import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"
import jwt from "jsonwebtoken"
import {
  AUDIT_EVENT_TYPES,
  AUDIT_MODULES,
  AUDIT_RESULT,
  DEFAULT_ROLE,
  type LoginInput,
  permissionsForRole,
} from "shared"

import { getDrizzle } from "../../db.js"
import { users } from "../../db/schema.js"
import { JWT_SECRET } from "../../middleware/auth.js"
import { createAuditor } from "../../shared/audit-log.js"
import type { OpCtx } from "../../shared/op-context.js"
import { ServiceError } from "../../shared/service-error.js"
import { hashPasswordSync, verifyPassword } from "../../utils/password.js"

const audit = createAuditor(AUDIT_MODULES.USER)

// ─── 错误类型 ─────────────────────────────────────────────────────────────────
// code 显式传 "TOKEN_EXPIRED"：保持与迁移前 routes/auth.ts 的响应形状一致

export class LoginFailedError extends ServiceError {
  constructor() {
    // 统一文案：不区分"账号不存在"与"密码错误"，避免账号枚举
    super("账号或密码错误", 401, "LOGIN_FAILED")
    this.name = "LoginFailedError"
  }
}

export class RefreshTokenInvalidError extends ServiceError {
  constructor() {
    super("refreshToken 无效或已过期", 401, "TOKEN_EXPIRED")
    this.name = "RefreshTokenInvalidError"
  }
}

// ─── Token Helpers ────────────────────────────────────────────────────────────

// 种子项目：使用内存 Map 关联 refreshToken 与用户账号（带 TTL 惰性清理）
// permissions 由 role 在登录时解析一次随 user 下发（前端只消费该数组）
type SessionUser = {
  name: string | null
  email: string
  role: string | null
  permissions: string[]
}
const REFRESH_TTL_MS = 7 * 24 * 3600_000 // 7 天
const refreshTokenStore = new Map<
  string,
  { user: SessionUser; expiresAt: number }
>()

function issueTokens(user: SessionUser) {
  // 惰性清理：当条目过多时移除过期条目，避免长期运行内存单调增长
  if (refreshTokenStore.size > 500) {
    const now = Date.now()
    for (const [key, entry] of refreshTokenStore) {
      if (entry.expiresAt < now) refreshTokenStore.delete(key)
    }
  }

  const accessToken = jwt.sign(
    {
      sub: user.email,
      username: user.name ?? user.email,
      role: user.role ?? DEFAULT_ROLE,
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  )
  const refreshToken = randomUUID()
  refreshTokenStore.set(refreshToken, {
    user,
    expiresAt: Date.now() + REFRESH_TTL_MS,
  })
  return { accessToken, refreshToken }
}

// ─── Service 方法 ─────────────────────────────────────────────────────────────

/**
 * 替换点 1：按账号标识查用户。
 *
 * 当前 users.email 是**不透明账号标识**（可以是 admin / 手机号 / 邮箱，不做格式校验）；
 * 接入手机号↔用户映射、SSO subject 映射时只需替换本函数（详见 docs/auth.md）。
 */
function findUserByIdentifier(identifier: string) {
  return getDrizzle()
    .select()
    .from(users)
    .where(eq(users.email, identifier))
    .get()
}

let unknownUserPasswordHash: string | null = null

/**
 * 未知账号 / 未启用密码登录用户的等时比较用 dummy hash。
 *
 * 惰性生成（首次失败登录时才付 bcrypt 成本），每次进程启动随机生成、不写死固定值；
 * 不对应任何真实账号，仅用于让「账号不存在 / SSO 用户」与「密码错误」消耗同一次
 * bcrypt compare，避免通过响应时间枚举账号。
 */
function getUnknownUserPasswordHash(): string {
  unknownUserPasswordHash ??= hashPasswordSync(randomUUID())
  return unknownUserPasswordHash
}

/**
 * 替换点 2：校验凭证。
 *
 * 默认实现是 bcrypt 密码校验；password_hash 为空表示该用户未启用密码登录
 * （SSO 用户等），fail-closed。接入短信验证码 / OIDC 时替换本函数即可。
 *
 * 等时约定：账号不存在（user = null）与空 hash 也会执行一次 bcrypt（dummy hash），
 * 让失败路径耗时一致、不泄露账号是否存在；替换实现时请保留这一性质
 * （或改用固定耗时的凭证校验）。
 */
async function verifyCredential(
  user: { passwordHash: string | null } | null,
  password: string
): Promise<boolean> {
  const matched = await verifyPassword(
    password,
    user?.passwordHash ?? getUnknownUserPasswordHash()
  )
  return Boolean(user?.passwordHash) && matched
}

/**
 * 登录 + 成功审计
 *
 * user.permissions 由 role 解析后随响应下发：前端权限门控（usePermission /
 * PermissionGate / 菜单过滤）只读这个数组，不自行推导角色 → 权限。
 */
export async function login(ctx: OpCtx, input: LoginInput) {
  const dbUser = findUserByIdentifier(input.email)

  // 失败路径统一走一次 bcrypt（见 verifyCredential 的等时约定），再按统一文案拒绝
  const credentialOk = await verifyCredential(dbUser ?? null, input.password)

  if (!dbUser || !credentialOk) {
    auditLoginFailure(ctx, input.email, dbUser ? "密码错误" : "用户不存在")
    throw new LoginFailedError()
  }

  const user: SessionUser = {
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role,
    permissions: permissionsForRole(dbUser.role),
  }

  // 登录成功审计：登录前无操作人上下文，operator 字段以登录账号覆盖
  audit(
    {
      ...ctx,
      operator: user.name ?? user.email,
      operatorId: String(dbUser.id),
      operatorAccount: user.email,
      operatorRole: user.role ?? DEFAULT_ROLE,
    },
    {
      eventType: AUDIT_EVENT_TYPES.LOGIN,
      target: user.name ?? user.email,
      targetId: String(dbUser.id),
      detail: `账号：${user.email}`,
    }
  )

  return { ...issueTokens(user), user }
}

/** 登录失败审计（route 层参数校验失败时调用） */
export function auditLoginFailure(
  ctx: OpCtx,
  account: string,
  reason: string
): void {
  audit(
    { ...ctx, operator: account, operatorAccount: account },
    {
      eventType: AUDIT_EVENT_TYPES.LOGIN,
      target: account,
      detail: `登录失败：${reason}`,
      severity: "warning",
      result: AUDIT_RESULT.FAILURE,
    }
  )
}

/**
 * 刷新 token（旋转：作废旧 refreshToken，签发新 token 对）
 *
 * 只复用登录时的会话快照，不重新查询 DB role / 权限：RBAC 变更需用户重新登录
 * （见 README「权限门控与导航自动派生」的实现边界）。
 */
export function refreshTokens(refreshToken: unknown) {
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    throw new RefreshTokenInvalidError()
  }

  const entry = refreshTokenStore.get(refreshToken)
  refreshTokenStore.delete(refreshToken)

  if (!entry || entry.expiresAt < Date.now()) {
    throw new RefreshTokenInvalidError()
  }

  return issueTokens(entry.user)
}
