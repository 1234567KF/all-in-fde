# 认证扩展指南

> 适用范围：`monorepo` 模板（`flat-go` / `flat-java` 模板无内置认证后端，本文不适用）。
> 本文是**替换指南**而不是「多模式配置」：starter 只内置一种安全的最小实现（账号 + 密码），
> 其余登录方式通过两个替换点接入，避免把复杂度强加给所有项目。

---

## 1. 当前实现

| 项           | 现状                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 账号标识     | `users.email` —— **不透明字符串**（可存 `admin` / 手机号 / 邮箱，不做格式校验），同时是 JWT 的 `sub`（系统内规范主体）                                   |
| 凭证         | `users.password_hash`（bcrypt）；为空表示该用户未启用密码登录（SSO 用户等），登录 fail-closed                                                            |
| 登录流程     | `POST /auth/login { email, password }` → 查用户 → 校验凭证 → 签发 accessToken + refreshToken                                                             |
| 种子密码     | `SEED_ADMIN_PASSWORD`：仅空库首次建库时 hash 写入 admin；开发默认 `admin123`，production 未配置 / 少于 6 位 / 仍是 `.env.example` 占位值都会在启动期报错 |
| refreshToken | 内存 Map（随机 UUID，旋转、7 天 TTL）——**重启失效、仅单实例**；多实例部署需换 Redis/DB 持久化                                                            |
| 审计         | 登录成功/失败均写 `audit_logs`；失败文案统一「账号或密码错误」（防账号枚举）                                                                             |

**登录校验的两个替换点**（[auth.service.ts](../apps/api/src/modules/auth/auth.service.ts)）：

```ts
// 替换点 1：按账号标识查用户（手机号映射 / SSO subject 映射改这里）
function findUserByIdentifier(identifier: string) { ... }

// 替换点 2：校验凭证（短信验证码 / OIDC 改这里；默认 bcrypt 密码）
async function verifyCredential(user, password) { ... }
```

JWT 签发（`issueTokens`）、审计、`permissions` 解析、路由结构**不需要改**。
请求契约在 [packages/shared/src/index.ts](../packages/shared/src/index.ts) 的 `LoginSchema`。

**失败路径约定**：账号不存在、未启用密码登录（空 hash）、密码错误都返回同一文案
「账号或密码错误」，且都会执行一次 bcrypt 比较（未知账号用随机生成的 dummy hash 等时比较），
不通过响应时间泄露账号是否存在。替换 `verifyCredential` 时请保留这一性质。

**初始密码来源**：模板演示部署（tmpfs）与 `deploy.sh` 首次 bootstrap 的 `.env` 都使用
`admin123`——后者仅用于 fresh 测试机拉起，持久卷模式会打印「正式上线前请修改」提示。
production 的安全性由启动守卫保证：必须显式配置、至少 6 位、不得是 `.env.example`
占位值（缺失或不合规直接启动失败）。

---

## 2. 常见改造 Recipe

### 2.1 手机号 / 用户名登录（不换机制）

不需要改 schema：把手机号或用户名直接作为 `users.email` 的值即可。

1. UI 文案改成「账号 / 手机号」（`LoginPage`、`LoginSchema` 的 label）；
2. `LoginSchema.email` 已是 `min(1)`，不做邮箱格式校验；
3. 种子账号同理（`bun run db:reset` 后 admin 账号仍是 `admin`）。

> 可选：把列名/字段改成 `loginName` 更诚实。影响面：`db/schema.ts`、`packages/shared` 的
> User/Login 契约、auth/user service、前端 auth store 与登录页、审计字段、测试。
> 纯命名重构，功能不变，建议在业务稳定后单独做。

### 2.2 手机号 + 短信验证码

1. `packages/shared`：新增 `SmsLoginSchema { phone, code }`（保留 `LoginSchema` 或替换）；
2. `auth.route.ts`：新增发码接口（**必须**带限流 / 图形或滑块校验，模板不内置）；
3. `auth.service.ts`：
   - `findUserByIdentifier` 改为按手机号映射（存 `users.email` 或按 2.4 用 identities 表）；
   - `verifyCredential` 改为校验验证码（Redis/DB 存 code + TTL + 一次性消费）；
4. JWT / 审计 / 权限 / refresh 不动；
5. 测试补：验证码错误 / 过期 / 重放，登录成功审计。

### 2.3 企业 SSO / OIDC

1. 新增 `GET /auth/sso/start` + `GET /auth/sso/callback`（state + PKCE）；
2. 回调里用 OIDC `sub` / 工号查用户，不存在则按需创建（`password_hash` 留空）；
3. 复用 `issueTokens` / `permissionsForRole` / 登录审计；
4. 建议同时引入 2.4 的 `user_identities` 保存 subject，避免把外部 subject 塞进 `users.email`。

### 2.4 同一用户多方式登录（升级 `user_identities`）

单列 `loginName` 只能表达「一个用户一个主登录标识」。需要「同一用户可手机号 + 微信 + SSO」
时，加一张一对多身份表（模板默认不内置，按需加）：

```sql
CREATE TABLE user_identities (
  id              integer PRIMARY KEY AUTOINCREMENT,
  user_id         integer NOT NULL REFERENCES users(id),
  provider        text NOT NULL,        -- password / phone / email / wechat / oidc:corp
  identifier      text NOT NULL,        -- 归一化后的手机号 / 邮箱 / subject
  credential_hash text,                 -- password 用；短信/SSO 为 NULL
  verified_at     text,
  created_at      text NOT NULL,
  UNIQUE(provider, identifier)
);
```

登录解析改为「identity → user」：

```ts
async function resolveIdentity(provider: string, identifier: string) {
  const identity = db
    .select()
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, provider),
        eq(userIdentities.identifier, identifier)
      )
    )
    .get()
  if (!identity) return null
  return (
    db.select().from(users).where(eq(users.id, identity.userId)).get() ?? null
  )
}
// verifyCredential(identity, input) 按 provider 分派；issueTokens(user) 不变
```

**JWT `sub` 用谁？**

- **推荐（改动最小）**：保留 `users.email`（或 `login_name`）作为**必填唯一规范标识**，JWT `sub` 继续用它。
  identities 只负责把多种登录方式解析到用户，通知 `recipientId`、审计 `operatorId`、权限全部零改动。
- **彻底版**：允许用户没有规范账号（纯手机号注册）时，把 JWT `sub` 换成稳定的 `user.id`。
  此时需同步调整：`notifications.recipientId`、审计 `operatorId`、演示种子数据、测试断言——
  属于全链路替换，确认有真实需求再做。

迁移方式：

- 生成项目：`bun --filter api db:generate` 生成迁移并提交 → 启动自动迁移；
- 模板仓库：`bun --filter api db:init:generate` 重新生成 `init.sql`（模板不提交迁移链）。

---

## 3. 安全清单（上线前核对）

- [ ] production 已显式配置 `SEED_ADMIN_PASSWORD`（至少 6 位、不得使用 `.env.example` 占位值；`deploy.sh` 写入的 `admin123` 只是测试默认值，正式上线前必须改），首次登录后改密（starter 无改密接口，需自行补 `/auth/change-password`）；
- [ ] 登录失败统一文案 + 等时 bcrypt + 审计 + 限流（防枚举 / 防爆破）；
- [ ] refreshToken 持久化（多实例部署必须）并支持吊销；
- [ ] 密码 hash / 凭证列**永不出现在 API 响应**（`user.service.ts` 的 `toMeUser` 已做显式白名单）；
- [ ] 权限变更要求重新登录（refresh 不重新解析 role，见 README「权限门控」边界说明）；
- [ ] 找回密码 / 验证码 / SSO 的 state 等流程自行补齐——starter 有意不内置。

---

## 4. 不建议的做法

- **不要**把认证做成 `AUTH_MODE=password|sms|oidc` 之类的运行时多模式开关：starter 里必然是浅实现，
  每个项目最终仍要定制，反而增加测试与文档负担；
- **不要**在教程/模板里保留「任意密码可登录」的演示行为：本模板已改为真实 bcrypt 校验；
- 业务代码不要直接读 `users.password_hash`：凭证只允许在 auth 模块内部使用。
