import { z } from "zod"

/**
 * 登录密码最小长度 —— 登录表单 / 登录接口校验与「初始 admin 密码」校验共用。
 *
 * SEED_ADMIN_PASSWORD 也必须满足该下限：若种子写入了登录校验会拒绝的短密码，
 * admin 会永久无法登录（且没有改密接口可自助恢复），所以 env.ts / seed-dev.ts
 * 启动期直接拒绝短密码。
 */
export const PASSWORD_MIN_LENGTH = 6

// Shared Login validation schema
export const LoginSchema = z.object({
  email: z.string().min(1, "请输入账号"),
  password: z
    .string()
    .min(
      PASSWORD_MIN_LENGTH,
      `密码长度至少为 ${PASSWORD_MIN_LENGTH} 位 (Password must be at least ${PASSWORD_MIN_LENGTH} characters)`
    ),
})

export type LoginInput = z.infer<typeof LoginSchema>

export { type ApiResponse } from "./response.js"

// ─── 通用分页（业务无关契约）──────────────────────────────────────────────────
export {
  type PagedResult,
  type PageQuery,
  PageQueryBaseSchema,
  PageQuerySchema,
  stripBlankQueryValues,
} from "./pagination.js"

// ─── 用户（前后端共享契约）────────────────────────────────────────────────────
export {
  type UpdateMeInput,
  UpdateMeSchema,
  type User,
  UserSchema,
} from "./user.js"

// ─── 消息通知（业务无关通用契约）─────────────────────────────────────────────
export {
  type Notification,
  NOTIFICATION_STREAM_EVENT,
  type NotificationListQuery,
  NotificationListQuerySchema,
  type NotificationPage,
  NotificationPageSchema,
  NotificationSchema,
  type NotificationUnreadCount,
  NotificationUnreadCountSchema,
} from "./notification.js"

// ─── 权限 ─────────────────────────────────────────────────────────────────────
export {
  ALL_PERMISSIONS,
  buildPermissionTree,
  DEFAULT_ROLE,
  type Permission,
  PERMISSION_REGISTRY,
  type PermissionCode,
  type PermissionDef,
  PERMISSIONS,
  permissionsForRole,
  type PermissionTreeGroup,
  ROLE_PERMISSIONS,
} from "./permissions.js"

// ─── 审计日志 ─────────────────────────────────────────────────────────────────
export {
  AUDIT_EVENT_TYPE_LABELS,
  AUDIT_EVENT_TYPE_OPTIONS,
  AUDIT_EVENT_TYPES,
  AUDIT_MODULE_LABELS,
  AUDIT_MODULE_OPTIONS,
  AUDIT_MODULES,
  AUDIT_RESULT,
  AUDIT_RESULT_LABELS,
  AUDIT_RESULT_OPTIONS,
  AUDIT_SEVERITY,
  AUDIT_SEVERITY_LABELS,
  AUDIT_SEVERITY_OPTIONS,
  type AuditChangeEntry,
  type AuditChanges,
  AuditChangesSchema,
  type AuditEventType,
  type AuditLog,
  type AuditLogQuery,
  AuditLogQueryBaseSchema,
  AuditLogQuerySchema,
  AuditLogSchema,
  type AuditModule,
  type AuditResult,
  type AuditSeverity,
  MODULE_EVENT_TYPES,
} from "./audit.js"
