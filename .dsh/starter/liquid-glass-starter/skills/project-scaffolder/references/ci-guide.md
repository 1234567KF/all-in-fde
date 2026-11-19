# GitLab CI/CD Guide

面向 `liquid-glass-starter` 系脚手架的完整 CI/CD 上线手册。当 skill 触发 add-ci 流程或用户答"Y"选择 include-ci 时，需要向用户导读本文件。

---

## 1. CI 结构概览

流水线包含 10 个 Job，分布在 `.pre` + 3 个 Stage 中（其中 3 个只在启用预发布后出现，见 §10）：

| Stage  | Job               | 触发条件                                                     | 依赖                                              | 作用                                                                                                                                                                    |
| ------ | ----------------- | ------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| .pre   | `warm-cache`      | MR / push 且 `bun.lock` 或 `.gitlab-ci.yml` 变更；web 无条件 | —                                                 | `bun install --frozen-lockfile --ignore-scripts` 创建/更新 `node_modules` 缓存（`check` 的缓存是 pull-only）                                                            |
| check  | `check`           | push / MR / schedule / web                                   | —                                                 | Bun 安装 + `build:shared` + **`migrate:check`** + **`arch:check`** + **`test:ci`**（三档质量门禁）                                                                      |
| build  | `build`           | 分支 `main`（不限来源）；启用预发布后在 pre-prod 上排除      | `check`                                           | `docker build`（不 push）+ `docker save` 导出 `image.tar.gz`，并写 `image.sha` 供跨流水线同源断言                                                                       |
| build  | `retag`           | 分支 `prod`（需 `FLOW_WEBHOOK_URL` 已配）                    | —                                                 | 双分支拉 main 的 `$SHA`、三分支拉 `pre-prod-$SHA`，retag 为 `:latest` 并推回                                                                                            |
| build  | `promote-preprod` | 分支 `pre-prod`（**仅配了 `PREPROD_HOST`**）                 | `check` + `needs:project` 取 main 的 `build` 产物 | 断言 `image.sha == pre-prod HEAD` → push `pre-prod-$SHA`（不可变）+ `pre-prod`（moving）；不产出 artifact                                                               |
| deploy | `push-registry`   | 分支 `main`（需 FLOW 已配 **且未启用预发布**）               | `build` (artifact)                                | 从 artifact `docker load` 后 push `$SHA` 与 `test-latest` 到阿里云 Registry（与 `deploy-test` 并行）                                                                    |
| deploy | `deploy-test`     | 分支 `main`                                                  | `check`, `build` (artifact)                       | SCP `compose.test.yml` + `deploy.sh` + `image.tar.gz` 到内网测试机，执行 `./deploy.sh test-latest image.tar.gz`（tar 加载模式）                                         |
| deploy | `restart-test`    | 分支 `main`（手动 play）                                     | `deploy-test`                                     | SSH 到测试机执行 `docker compose restart` + 健康轮询；模板 demo 上等效重置演示数据，生成项目上只是重启服务                                                              |
| deploy | `deploy-preprod`  | 分支 `pre-prod`（**仅配了 `PREPROD_HOST`**）                 | `check`, `promote-preprod`                        | 先远端校验 `.env`（拒默认密码 / dev 模式），再 SCP `compose.preprod.yml` + `deploy.sh` 到外网预发布机，由它自己从 Registry `docker pull pre-prod-$SHA` 启动（不传 tar） |
| deploy | `deploy-prod`     | 分支 `prod`（不限来源，需 FLOW 已配）                        | `check`, `retag`                                  | wget POST 到 `FLOW_WEBHOOK_URL` 触发阿里云 Flow 部署                                                                                                                    |

### 双分支模型（默认）

- **`main` 分支** = 测试环境。每次合入 → `build` 生成 tar artifact → `push-registry` 推阿里云 并行 `deploy-test` SCP 到测试机启动。
- **`prod` 分支** = 生产环境。要求以 **Fast-Forward 合并 main → prod**（不允许 Squash / Merge commit），保证 prod HEAD SHA 与 main 已构建 SHA 一致 → `retag` 复用镜像 → `deploy-prod` 触发 Flow webhook。
- **合并原则**：测试通过的镜像 == 生产运行的镜像，不重复 build（`push-registry` 推的 `$SHA` 即 `retag` 拉的 `$SHA`）。

### 三分支模型（可选，配 `PREPROD_HOST` 后启用）

`main` 是开发分支、多人提交频繁时，每次构建都推 Registry 会浪费带宽与存储，且仓库里分不清「构建产物」与「已批准发布」。启用后插入一道预发布关卡：

- **`main`** = 开发/测试环境。`build` 只产出 tar artifact + `image.sha`，**`push-registry` 关闭**，`deploy-test` 照旧 SCP 到内网测试机。
- **`pre-prod`** = 预发布环境。`promote-preprod` 用 `needs:project` 跨流水线取 main 最近一次成功的 `build` 产物，断言同源后推 `pre-prod-$SHA` + `pre-prod`；`deploy-preprod` SSH 到**外网**预发布机，由它从 Registry 拉取启动。
- **`prod`** = 生产环境。`retag` 改从 `pre-prod-$SHA` 拉取 → `:latest` → Flow webhook。
- **合并原则**：`main → pre-prod → prod` **逐级 Fast-Forward**，SHA 相等是「测试通过的镜像 == 预发布运行的镜像 == 生产运行的镜像」的唯一保障。

启用步骤、外网机准备与回滚见 **§10**。未配置 `PREPROD_HOST`（保持 `REPLACE_ME` 或空串）时仍是双分支模型：main 构建并推送、prod 复用 `retag`。

### workflow.rules 去重

有关联 MR 的 push 事件不会重复触发流水线，但 `pre-prod` / `prod` **必须豁免**：开着 `pre-prod → prod` 的 MR 时再合入 `pre-prod`，该 commit 仍带 `CI_OPEN_MERGE_REQUESTS`，不豁免会让晋级流水线被静默吞掉。

```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "push" && $CI_OPEN_MERGE_REQUESTS && $CI_COMMIT_BRANCH != "pre-prod" && $CI_COMMIT_BRANCH != "prod"
      when: never
    - when: always
```

---

## 1.5 `check` job 三档速查

| 命令                             | 代码                                                                                                                    | 作用                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `bun --filter api migrate:check` | [apps/api/scripts/migrate-check.ts](../../../apps/api/scripts/migrate-check.ts)                                         | drizzle journal / `.sql` / snapshot 三方一致 + 内存 SQLite 重放 + drift 检测             |
| `bun run arch:check`             | [scripts/arch-check.ts](../../../scripts/arch-check.ts)                                                                 | UI 层禁 `@workspace/web-core/lib/api` / `axios` / `sonner` 直连；页面必须 `React.lazy()` |
| `bun run test:ci`                | [apps/web/vitest.config.ts](../../../apps/web/vitest.config.ts) + [apps/api/bunfig.toml](../../../apps/api/bunfig.toml) | 前端 vitest istanbul 覆盖率 + 后端 Bun 原生覆盖率                                        |

本地提交阶段还有 [scripts/check-migration-staged.ts](../../../scripts/check-migration-staged.ts)（`.husky/pre-commit` 触发）拦截“新增 SQL 但漏 stage journal / snapshot”的断尾提交。

**覆盖率阀值**：模板阶段默认为 0（避免业务空缺卡红 CI）。业务成型后按需上提：前端 `lines/statements/functions=90 / branches=75`，后端 `coverageThreshold=0.85`。具体历史坑（Bun v8 provider 不兼容、bunfig 阀值必须单值等）见对应配置文件顶部注释。

**add-ci 向遗留项目下发时不会自动接管的两类配置**（避免覆盖项目已有）：`package.json` 里的 `test:*` / `arch:check` / `migrate:check` scripts；`apps/web/vitest.config.ts` 与 `apps/api/bunfig.toml` 的覆盖率配置。skill 在结束时会提醒核对。

---

## 1.6 构建入口：scripts/build-server.sh

Dockerfile builder 层唯一命令 `RUN sh scripts/build-server.sh`，做五步：准备 db-bootstrap（模板放 `init.sql`，生成项目放 `drizzle/`）→ `build:shared` → `bun build --compile` 出 `dist/server` → `build:web` → `collect-web-dist` 把各端产物汇总到 `dist/web/<id>/` 并复制 `dist/web-apps.json`。本地可直接 `sh scripts/build-server.sh` 复现容器产物。抽出脚本的详细动因见 [scripts/build-server.sh](../../../scripts/build-server.sh) 顶部注释。

### 多 Web 端时的 CI（无需改流水线）

`build:web` 由 `scripts/run-web-task.ts` 遍历 `web-apps.json` 逐端构建，产物汇总到 `dist/web/<id>/`（默认端也在 `dist/web/web/`），注册表副本落 `dist/web-apps.json`。Dockerfile 用 `COPY --from=builder /app/dist/web ./web` 整目录搬走，运行时 API 按 base 从长到短逐端挂静态资源与 SPA fallback。因此：

- **新增 / 删除端不改 `.gitlab-ci.yml`、compose、部署脚本、端口映射**：所有端同源同端口，只是 URL 前缀不同（`/`、`/portal/`、`/mobile/`）。
- **唯一需要跟着变的是 Dockerfile 依赖层**：`# [web-apps:dockerfile]` 锚点下的 `web-app:<id>` 区块（`COPY apps/<id>/package.json apps/<id>/`）由 `--mode add-web` / `bun run remove:web` 自动增删，**不要手改锚点行**。缺这一层会让 `bun install --frozen-lockfile` 在 builder 里找不到该 workspace 而失败。
- `check` job 的 typecheck / lint / test 同样按注册表遍历各端，新增端自动纳入门禁；ESLint 与 lint-staged 用 `apps/*` glob，不需要登记。
- 老项目升级：Dockerfile 里没有该锚点时 `add-web` 会直接拒绝，先跑 `--mode add-ci --force` 刷新 CI 文件。

---

## 1.7 运行时基础镜像：bun-runtime:alpine-3.20

Dockerfile stage-2 `FROM registry.example.com/liquid-glass/bun-runtime:alpine-3.20`。该镜像由 [ci-tools/runtime.Dockerfile](../../../ci-tools/runtime.Dockerfile) 构建，已预装：

- `libstdc++`：`bun build --compile` 产物必需的 C++ 运行时
- `ca-certificates`：HTTPS 出站（调 LLM / OSS / webhook 等）
- `tzdata` + `Asia/Shanghai`：容器内 `date` 与日志时间直接是 CST

**与 ci-tools:alpine-3.20 的区别**：同在 `ci-tools/` 目录但职责不同——`ci-tools:alpine-3.20` 预装 openssh-client 供 `deploy-test` job 做 SSH 部署；`bun-runtime:alpine-3.20` 预装 libstdc++ 供应用容器运行。不能合并（会把 SSH 客户端带进生产镜像，或把 libstdc++ 带进 CI 部署容器）。

## 1.8 `restart-test` 手动重启（维护用）

`restart-test` 是唯一的手动 job：`when: manual` + `allow_failure: true`，在 main 分支流水线的 `deploy-test` 成功后出现，**可以在之后补点**（流水线已结束也能 play），点它不会重新触发 check / build / deploy。

- **语义**：`docker compose restart`，即重启已部署服务；
- **模板自部署（compose.self.yml，tmpfs）**：重启会清空 `/app/data`，下一次健康检查触发 `init.sql` 建库并自动重新种 7 条演示通知 → 等效「重置演示数据」；
- **scaffold 生成项目（compose.test.yml，`./data` 持久卷）**：数据保留，仅重启服务；
- **不会**应用新的 `.env` / compose 配置（容器配置在创建时固定）；要升级配置或镜像请走部署流水线；
- 因为「重启服务」在两种形态下语义都成立，该 job 可随 `--include-ci` 原样进入生成项目，无需模板专属门禁；换测试机时覆盖 `TEST_HOST` / `TEST_PATH` 等变量即可；
- 健康检查最多等 60s，超时会打印最近 50 行容器日志并让 job 失败。

---

## 2. 首次上线 GitLab CI/CD Variables 清单

在 GitLab 项目 **Settings > CI/CD > Variables** 里配置。默认 CI 文件里保留了模板项目自己的值，实际上线**必须**替换以下：

### 必配变量

| Key                           | Type                  | Protected | Masked | 值说明                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | --------------------- | --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `G_TEST_SERVER_SSH_PKEY` | Variable（不是 File） | 是        | 否     | 测试机的 SSH 私钥内容（**整段** `-----BEGIN OPENSSH PRIVATE KEY-----` … `-----END OPENSSH PRIVATE KEY-----`）。yml 用 `echo "$..." > private_key` 展开，File 类型只会把文件路径写进私钥；多行 PEM 也无法 Masked（详见 §3.3）。预发布机用的是另一把 `G_PREPROD_SSH_PKEY`（`PREPROD_SSH_PKEY` 默认继承它）。如果用组级变量已存在，此项可跳过。 |
| `FLOW_WEBHOOK_URL`            | Variable              | 是        | 否     | 阿里云 Flow 流水线 Webhook 地址，形如 `http://REPLACE_WITH_YOUR_PROVIDER/pipeline/webhook/xxxxx`。**仅当项目要接入生产部署时必配**；纯测试环境不影响。                                                                                                                                                                                                    |

### 可选覆盖（默认已在 `.gitlab-ci.yml` `variables:` 段中硬编码）

| Key                | 默认值                                          | 何时需要覆盖                                                       |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------ |
| `TEST_HOST`        | `192.0.2.10`                               | 用不同的内网测试机                                                 |
| `TEST_PORT`        | `2222`                                         | 测试机 SSH 端口不同                                                |
| `TEST_USER`        | `ExampleOrg`                                        | 部署用户名不同                                                     |
| `TEST_PATH`        | `/srv/deploy/<project>`                        | 部署目录不同（scaffold 已按项目名替换）                            |
| `TEST_SSH_PKEY`    | `$G_TEST_SERVER_SSH_PKEY`                  | 换测试机时连密钥一起覆盖；Type 必须是 **Variable**（不是 File）    |
| `IMAG_REG`         | `registry.example.com/liquid-glass` | 使用其它镜像仓库前缀                                               |
| `PREPROD_HOST`     | `REPLACE_ME`                                    | **配成外网预发布机 IP/域名即启用三分支模型**（见 §10）；不配则关闭 |
| `PREPROD_PORT`     | `2222`                                         | 预发布机 SSH 端口不同（团队惯例 `2222`，`22` 常被占用或另有服务） |
| `PREPROD_USER`     | `ExampleOrg`                                        | 预发布机部署用户名不同                                             |
| `PREPROD_PATH`     | `/srv/deploy/<project>-preprod`                | 预发布部署目录不同（scaffold 已按项目名替换）                      |
| `PREPROD_SSH_PKEY` | `$G_PREPROD_SSH_PKEY`                 | 预发布机用别的密钥；Type 必须是 **Variable**（不是 File）          |

覆盖方式：不改 `.gitlab-ci.yml`，在 GitLab UI Variables 里新加同名 Key，Runtime 会覆盖 yml 内的默认值。

> **`PREPROD_*` 与 Protected**：若把这些变量设为 Protected，`pre-prod` **必须先设为保护分支**（§10.3），否则 job 里取不到值。注意失败模式**不是「job 报错」**：`PREPROD_HOST` 取不到值会回落 yml 默认的 `REPLACE_ME`，哨兵命中后 `promote-preprod` / `deploy-preprod` **整个不出现在流水线里**，日志里什么都找不到。只有私钥单独取不到值（`PREPROD_HOST` 没勾 Protected 而密钥勾了）才会走到 `deploy-preprod` 的 `before_script` 空值守卫。

> **初始管理员密码（`SEED_ADMIN_PASSWORD`）**：认证已启用真实 bcrypt 校验，`deploy.sh`
> 首次生成 `.env` 时写入测试默认值 `admin123`，用于 fresh 测试机拉起验证；生成项目
> （持久卷 / 生产）会额外打印「正式上线前请修改」提示。production 启动守卫要求该值
> 存在、至少 6 位且不是 `.env.example` 占位值，缺失或不合规直接启动失败。
> 若部署目录已有 `.env`，必须确认其中含 `SEED_ADMIN_PASSWORD`（同上要求），否则 deploy
> 脚本会提前报错。改 `.env` 不会更新已建库的 admin 密码：需重建数据目录或手工改库。

---

## 3. SSH 私钥生成与投放

首次接入需要给 GitLab CI 一个能 SSH 到测试机的私钥。

### 3.1 生成密钥对（本地）

```bash
ssh-keygen -t ed25519 -C "gitlab-ci@<project>" -f ~/.ssh/gitlab_ci_<project>
# 一路回车，不要设置 passphrase（CI 无法交互输入）
```

产物：

- `~/.ssh/gitlab_ci_<project>` — 私钥（后续贴到 GitLab）
- `~/.ssh/gitlab_ci_<project>.pub` — 公钥（追加到测试机）

### 3.2 把公钥装到测试机

```bash
ssh -p 2222 deploy@192.0.2.10
# 登录后：
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<粘贴 gitlab_ci_<project>.pub 的完整内容>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
exit
```

本地验证：

```bash
ssh -i ~/.ssh/gitlab_ci_<project> -p 2222 deploy@192.0.2.10 "hostname && whoami"
```

### 3.3 把私钥装到 GitLab

- **组级共享（推荐）**：管理员在 Group Settings > CI/CD > Variables 里配 `G_TEST_SERVER_SSH_PKEY`，组内所有项目自动继承。
- **项目单配**：Project Settings > CI/CD > Variables → Add Variable：
  - Key: `G_TEST_SERVER_SSH_PKEY`
  - Type: `Variable`（不是 File，因为 `.gitlab-ci.yml` 里用 `echo "$..." > private_key` 展开）
  - Protected: 建议 ✅
  - Masked: 尝试勾选；如果 GitLab 拒绝（多行/含特殊字符），取消 masked 但保留 protected
  - Value: 整段私钥内容（含首尾 BEGIN/END 行）

---

## 4. 首次触发流水线

三种方式：

1. **Push 到 `main`（自动）**

   ```bash
   git push origin main
   ```

   → 触发 `check` + `build` + `push-registry` + `deploy-test`（后两者并行）。

2. **GitLab Web UI 手动触发**
   - Project → CI/CD → Pipelines → Run pipeline
   - Branch: `main`（或 `prod` / `pre-prod`）
   - 适合首次配好 Variables 后想立即验证但没有代码改动的场景。job 集与 push 一致，来源不放宽分支限制。

3. **CI/CD Schedules 定时**
   - Project → CI/CD → Schedules → New schedule
   - Cron: 如 `0 3 * * *`（每天 3 点）
   - Branch: `main`
   - 会带 `CI_PIPELINE_SOURCE=schedule`。`build` / `push-registry` / `deploy-test` **只认 `main`**，`retag` / `deploy-prod` **只认 `prod`**：在 main 上定时 = 重新构建并部署测试环境；在 prod 上定时 = 复用已晋级镜像重新发布生产，**不会**重复 build，也不会把 `test-latest` 覆盖成 prod 产物。

---

## 5. 常见错误排错

### 5.1 `retag` job 拉镜像失败

日志形如：

```
❌ 拉取镜像失败：registry.example.com/liquid-glass/<project>:<sha>
  当前 prod HEAD SHA (...) 在 Registry 中不存在。
```

**原因**：合并上游 → prod 时用了 Squash 或 Merge commit，prod 的 HEAD SHA 与上游已发布的 SHA 不同。上游是谁取决于模式（看日志第一行 `▶ 复用 <UPSTREAM> 已发布镜像 …`）：

| 模式                          | `retag` 拉取的源 tag      | 额外前提                                                   |
| ----------------------------- | ------------------------- | ---------------------------------------------------------- |
| 双分支（`PREPROD_HOST` 未配） | `<project>:$SHA`          | main 的 `push-registry` 当时推成功过（见 §5.2.2）          |
| 三分支（已配 `PREPROD_HOST`） | `<project>:pre-prod-$SHA` | pre-prod 的 `promote-preprod` 已成功推送该 tag（见 §10.6） |

**修复**：

```bash
git checkout prod
git reset --hard <上一个正确的 SHA>
git merge --ff-only pre-prod   # 双分支模型改成 main
git push origin prod
```

以后合并上游 → prod 一律选择 Fast-Forward。

### 5.2 `deploy-test` 健康检查超时

日志形如：

```
ERROR: Health check timeout (60s)
```

**可能原因**：

- 应用启动时数据库迁移失败 → 看 `docker compose logs` 尾部
- 端口冲突（测试机已有服务占用 `WEB_PORT`）→ 修改测试机 `.env` 里的 `WEB_PORT`
- 应用监听地址不是 `0.0.0.0:3000` → 检查 API server 启动配置

### 5.2.1 `deploy-test` tar 包丢失 / 镜像不存在

日志形如：`ERROR: tar 包不存在` 或 `docker: no such image`。

**可能原因**：

- `build` job artifact 过期（默认 `expire_in: 1 day`）但 `deploy-test` 重跑时 artifact 已被清理 → 重新触发 `build`
- 测试机上旧的 `image.tar.gz` 未正常删除（deploy.sh 中 `rm -f` 因权限失败）→ SSH 上去手动 `rm image.tar.gz` 后重新部署
- `compose.test.yml` 的 `pull_policy` 被改成 `always` → tar 加载模式下会反而去拉阿里云，确保保持 `missing`

### 5.2.2 `push-registry` 失败但 `deploy-test` 成功

`push-registry` 与 `deploy-test` 并行。如果 `push-registry` 失败（阿里云网络抖动、介质临时不可用等）但 `deploy-test` 成功：

- **测试环境不受影响**（镜像已从 tar 加载）
- **但阿里云 Registry 缺了这个 `$SHA` 镜像** → 后续 FF 合并到 prod 时 `retag` 会拉不到镜像
- **修复**：在 GitLab UI 中手动 retry `push-registry` job 即可

> 三分支模式下本 job 被哨兵关闭、根本不出现在流水线里，镜像改由 `promote-preprod` 晋级推送；对应的失败排查见 §10.6。

### 5.3 Registry 登录失败

`docker pull` 报 401 / unauthorized：

- GitLab Runner 未登录内部 registry。如果 registry 是内网公开可拉，无需登录；若需要 Basic Auth，在 CI 里加 `docker login` 步骤并配置 `REGISTRY_USER` / `REGISTRY_PASS` 两个 GitLab Variables。

### 5.4 `check` job 失败（typecheck / migrate:check / arch:check / test:ci）

本地先单独重现、修好再 push：

```bash
bun run build:shared            # 前置，shared 包没编译会满版报错
bun run typecheck               # 类型检查（CI 必跑）
bun --filter api migrate:check  # 迁移 / snapshot / drift 三维一致性
bun run arch:check              # UI 层约束 + 页面 lazy
bun run test:ci                 # 前后端覆盖率阈值
```

常见败因：`schema.ts` 改了但忘跑 `bunx drizzle-kit generate`（migrate:check 报 drift）；UI 层直接 `import axios`（arch:check 报）；新增大块业务代码但未写测试（test:ci 覆盖率低于阀值）。临时无法及时修时可在 `apps/web/vitest.config.ts` / `apps/api/bunfig.toml` 里调低阀值，但需尽快追齐到目标基线。

### 5.5 生产 Flow Webhook 报 404 / 403

- `FLOW_WEBHOOK_URL` 变量未配 → 到 GitLab Variables 里加
- URL 里的 token 已作废 → 到阿里云 Flow 流水线里重新生成 Webhook 触发器

---

## 6. 验证 CI 结构改动

模板项目本身就能跑，CI 结构变更直接在 `~/liquid-glass-starter/` 上改并 push，用它自己的测试环境冒烟验证（测试机 `192.0.2.10:11070`）。

**本地先跑守护测试**：`bun test scripts/ci-manifest.test.ts`（已含在 `bun run test:scripts` / `bun run check` 里）。三份 CI 文件清单用文本解析校验，复制排除策略直接 import `scripts/lib/template-copy.ts` 断言行为：

- 根目录每份 `compose*.yml`（除模板专属 `compose.self.yml`）同时在 scaffold 的 `CI_FILES_ALL` / `CI_FILES_REPLACE` / `PORT_STAMP_FILES` 三份清单里，且被复制排除策略排除（init 不带 CI 时不会原样拷进生成项目），含 `11070` 的 CI 文件都进了端口替换清单；`compose.self.yml` 反过来必须被排除策略排除、且不进任何 CI 清单（tmpfs 无记忆部署不能泄漏到生成项目）；
- `PREPROD_HOST` 哨兵默认值与各 job 的开关方向（**空串同样判为关闭**）、`retag` 选镜像源的 `case` 与之一致、`workflow` 对 pre-prod / prod 的去重豁免；
- 镜像 tag 在 `variables` / `promote-preprod` / `deploy-preprod` / `retag` / `compose.preprod.yml` 五处同源；
- `build` 产出 `image.sha`、`promote-preprod` 的 `needs` 带 `ref: main`、`deploy-preprod` 不 SCP tar 也不引用 `compose.self.yml`；
- 各 job 的正向规则限定分支（`build` / `push-registry` 只认 main，`retag` / `deploy-prod` 只认 prod，晋级与预发布部署只认 pre-prod），且不留被上一条覆盖的死规则；
- `deploy-preprod` 的 `.env` 守卫在远端校验内容（必填键 / 显式 `NODE_ENV` 只允许 production / 拒默认密码与占位值），且不把 `.env` 拉回 CI；
- 所有本地 `needs: - job:` 都指向存在的 job。**边界**：这条只校验存在性，**不模拟 GitLab 的 rules 求值**。「needs 指向被 rules 排除的 job 会让整条流水线创建失败」这类分支×来源组合，要靠项目级 `ci/lint` 带 `dry_run` + `include_jobs` 实机核（本仓库已核过 main 的 job 集，以及 `PREPROD_HOST` 取空串 / 哨兵 / 真值时的开关方向）。

新增 compose 文件或改 yml 书写形态时，需同步更新该测试的正则（三份清单与 yml 依赖字面量形态，与 `scripts/lib/long-file-ratchet.ts` 同一取舍）；复制排除策略是纯函数模块，改名单不需要动测试正则。

---

## 7. GitLab CI 上线清单（Success Output 用）

当 skill 完成 init 带 CI 或 add-ci 后，向用户输出：

```markdown
### GitLab CI 上线清单

代码推到 GitLab 前，请在项目 **Settings > CI/CD > Variables** 配好：

- [ ] `G_TEST_SERVER_SSH_PKEY` —— 测试机 SSH 私钥
- [ ] `FLOW_WEBHOOK_URL` —— 生产 Flow Webhook（仅生产上线时；阿里云 Flow 需逐项目单独配置）

如果你的部署环境与模板默认不同，还需覆盖：`TEST_HOST` / `TEST_PORT` / `TEST_USER` / `TEST_PATH` / `IMAG_REG`

**要启用预发布（可选，见 §10）**：把 `PREPROD_HOST` 配成外网预发布机地址即切换为三分支模型 —— 这是**唯一必须按项目配置**的预发布变量，`PREPROD_PORT` / `PREPROD_USER` / `PREPROD_SSH_PKEY` 的 yml 默认值已对齐团队预发布机，`PREPROD_PATH` 由 scaffold 按项目名写死。启用前必须：先把 `pre-prod` 设为保护分支再配 Protected 变量（顺序反了两个预发布 job 会静默不出现）；在外网机完成 `docker login`、`sudo install -d -o 1001 -g 1001 <部署目录>/data`、手工写好合规 `.env`（CI 会远端校验，拒 `admin123` 与非 production）。不配则保持双分支，行为不变。

**【add-ci 向遗留项目下发时额外确认】**

- [ ] `package.json` scripts 已包含：`arch:check` / `test:ci` / `test:coverage` / `test:api:coverage`；`apps/api/package.json` 包含 `migrate:check`
- [ ] `apps/web/vitest.config.ts` 已启用 `provider: "istanbul"` + `thresholds`
- [ ] `apps/api/bunfig.toml` 已配 `coverageThreshold` 与 `coveragePathIgnorePatterns`
- [ ] `apps/web/package.json` devDependencies 已加 `@vitest/coverage-istanbul`
- [ ] 本地先跑一次 `bun run build:shared && bun --filter api migrate:check && bun run arch:check && bun run test:ci` 所有项均绿

首次触发方式：`git push origin main` 或 GitLab UI → Pipelines → Run pipeline。

详见：`skills/project-scaffolder/references/ci-guide.md`
```

---

## 8. Skill `add-ci` 模式手册

本节是 SKILL.md 中 “Intent B: 为已有项目添加 CI” 的行为契约与用户对话流程详情，SKILL.md 只留触发规则和一行命令，具体流程读这里。

### 8.1 触发条件

用户意图为“为已有项目加 CI”时直接进入 8.2，**不要跑完整 Phase 1 Interview**（不问项目名、架构、DB 等）。

### 8.2 Add-CI Interview（中文）

1. **确认目标项目目录**：默认当前 workspace root；不确定时向用户确认绝对路径。
2. **告知将写入的文件**（含质量门禁脚本）：
   - CI 定义：`.gitlab-ci.yml`
   - 镜像构建：`Dockerfile` / `ci-tools/Dockerfile` / `ci-tools/runtime.Dockerfile` / `ci-tools/README.md` / `.dockerignore`
   - 部署编排：`deploy.sh` / `compose.yml` / `compose.test.yml` / `compose.preprod.yml`
   - 质量门禁脚本：`scripts/arch-check.ts` / `scripts/lib/long-file-ratchet.ts`（arch-check 的 450 行棘轮 helper，scaffold 剪枝时动态 import 目标项目这一份）/ `scripts/check-migration-staged.ts` / `apps/api/scripts/migrate-check.ts`

   `ci-tools/runtime.Dockerfile` 产出 `bun-runtime:alpine-3.20`，主 Dockerfile stage-2 `FROM` 依赖它；首次使用前需人工 `docker buildx build --push`一次（命令见 `ci-tools/README.md`）。后续项目彻底复用，无需重推。

   若目标目录中任一文件已存在 → 报错，需用户确认后加 `--force`。

3. **提示上线前必配项**：向用户读出本文 §2 的 Variables 清单和 §7 的 `add-ci 向遗留项目下发` 清单，强调 `package.json` scripts / `bunfig.toml` / `vitest.config.ts` / devDependencies 需要人工核对（本 skill 只写入 CI 文件，不改这些配置）。
4. Stop and wait。用户回复 “开始 / 继续 / 确认” 后再执行 8.3。

### 8.3 Add-CI Execution

```bash
bun run <SKILL_DIR>/scripts/scaffold.ts \
  --mode add-ci \
  --target "<TARGET_PATH>" \
  [--force]
```

- 项目名从 `apps/web/package.json`（monorepo）或 `frontend/package.json`（flat，暂不支持）自动推断。
- 结构自检：monorepo 必须存在 `apps/api/src/index.ts` + `apps/web/package.json` + `packages/shared/package.json`。
- 冲突检测：默认不覆盖已存在的 CI 文件，除非传 `--force`。

### 8.4 错误处理

| 错误信息                                                    | 处理                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `CI files already exist`                                    | 列出冲突文件，询问用户是否 `--force` 覆盖                            |
| `Project structure does not match monorepo CI expectations` | 项目结构与模板已偏离，需人工核对 `apps/api/src/index.ts` 等关键文件  |
| `Flat layout CI is not sedimented yet`                      | 当前 flat-go / flat-java 项目不支持自动注入 CI，建议手写或等后续迭代 |

### 8.5 完成后的 Post-Success

输出 §7 中的 “GitLab CI 上线清单” 模板。

---

## 9. 测试端口分配（skill 自动分配 + SSH 探测）

### 9.1 端口段划分

| 段位          | 用途                                    | 备注                                              |
| ------------- | --------------------------------------- | ------------------------------------------------- |
| `11070`       | 模板 `liquid-glass-starter` self-deploy | 保留，不参与递增分配                              |
| `11080`       | 预留给主业务项目的固定端口              | registry 以 `source: manual` 登记，不参与递增分配 |
| `11081-11199` | 新项目递增分配段                        | skill port-allocator 自动挑选                     |
| `11200+`      | 预留（其他服务 / 未来扩展）             | 不使用                                            |

### 9.2 分配行为

**单次 SSH 原子事务**：远端 `flock` + `python3` 一口气完成读 registry → 扫 `ss -tlnH` LISTEN → 写 registry。具体实现见 [scripts/lib/port-allocator.ts](../../scripts/lib/port-allocator.ts) 顶部注释。

**Registry 位置**：`deploy@192.0.2.10:/srv/deploy/port-registry.json`（团队共享单一权威源，无本地缓存）。

**幂等**：registry 已有同名 project → 直接复用（`reused=true`）；否则从 `11081` 递增找第一个「LISTEN 未占 + registry 未登记」的端口。

### 9.3 SSH 免密降级链

目标：`deploy@192.0.2.10:2222`，密码 `ExampleOrg`（硬编码于 [scripts/lib/test-server.ts](../../scripts/lib/test-server.ts)）。

1. `ssh -o BatchMode=yes` 试当前 key ——成功即返
2. 失败 → 无 `~/.ssh/id_ed25519` 则 `ssh-keygen` 生成 → `sshpass` / `expect` 密码登录后 `ssh-copy-id`
3. 二次 BatchMode 验证

`sshpass` / `expect` 都未安装时 skill 报错并提示 `brew install hudochenkov/sshpass/sshpass`。

### 9.4 CLI 用法与手动兜底

**自动模式**（默认，推荐）：

```bash
bun run <SKILL_DIR>/scripts/scaffold.ts --mode add-ci --target "<PATH>"
```

**手动指定端口**（跳过远端探测，仅走 registry 冲突检查）：

```bash
bun run <SKILL_DIR>/scripts/scaffold.ts --mode add-ci --target "<PATH>" --port 11099
```

**完全跳过**（保留模板默认 11070 占位符，用户后续手改）：

```bash
bun run <SKILL_DIR>/scripts/scaffold.ts --mode add-ci --target "<PATH>" --skip-port-alloc
```

**直接调用分配器**（初始化 / 调试 / 手动登记）：

```bash
bun run <SKILL_DIR>/scripts/lib/port-allocator.ts demo-app --port 11080 --source manual
bun run <SKILL_DIR>/scripts/lib/port-allocator.ts myproject
```

### 9.5 修复 / 撤销分配

**手工回填历史部署**（例如之前有人 SSH 上去手起了服务占了 11085）：

```bash
ssh -p 2222 deploy@192.0.2.10 'vi /srv/deploy/port-registry.json'
# 在 allocations 数组里手动追一条：
# { "project": "legacy-x", "port": 11085, "allocatedAt": "2026-07-14", "source": "manual" }
```

**释放某项目的端口**（项目已下线）：同上 `vi`，删除对应 allocations 条目即可；下次分配时自然可以抢中。

**重置整个 registry**（谨慎，会丢失所有历史分配记录）：

```bash
ssh -p 2222 deploy@192.0.2.10 'rm /srv/deploy/port-registry.json'
# skill 下次分配时会重新创建空 registry
```

**撤销测试机对本机的免密授权**（例如离职 / 换机器）：

```bash
ssh -p 2222 deploy@192.0.2.10
# 编辑 ~/.ssh/authorized_keys 移除本机公钥行
```

### 9.6 常见错误

| 错误信息                                         | 处理                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `SSH 免密配置失败：缺少 sshpass/expect`          | macOS `brew install hudochenkov/sshpass/sshpass` 或手动 `ssh-copy-id -p 2222 deploy@192.0.2.10` 输密码 `ExampleOrg` 一次 |
| `端口 XXXX 已被项目 YYY 占用（remote registry）` | 换 `--port` 或上去 `vi /srv/deploy/port-registry.json` 清理 YYY 条目                                                      |
| `端口段 11081-11199 已全部占用`                  | 上去清理长期不用的 registry 条目；或扩容 `test-server.ts` 中的 `portRangeEnd`                                              |
| `远端分配失败 (exit N): ...`                     | SSH 本身可达但远端脚本报错（python 缺失 / registry 文件損坏）；stderr 会带上完整错误信息                                   |
| `ssh-copy-id 已执行但免密验证仍失败`             | 手动 `chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`，或用 `ssh -vvv` 排查                                          |

### 9.7 TODO

多测试机支持 / 凭据环境变量兜底 / `--sync-remote` 自动回填——需要时再加。

---

## 10. 启用预发布（可选，三分支模型）

### 10.1 开关与适用场景

**开关就是一个变量**：`PREPROD_HOST` 保持 `REPLACE_ME` = 关闭（双分支，main / prod 的 push 流水线行为与启用前一致）；配成外网预发布机的 IP/域名 = 启用。**空串同样判为关闭**（避免有人清空值想关掉预发布，反而让 main 停推 Registry、prod 去拉不存在的 tag）。与 `FLOW_WEBHOOK_URL` 同一范式，scaffold 没有额外 flag。

适用场景：`main` 作为开发分支多人频繁提交，每次构建都推 Registry 浪费带宽与存储，且仓库里分不清「构建产物」和「已批准发布」。启用后 main 完全不碰 Registry，只有合并到 `pre-prod` 才晋级推送。

**前置条件**：GitLab **Premium / Ultimate**（`needs:project` 是付费功能），且触发流水线的账号对目标项目有读取产物的权限。本团队的 `192.0.2.10`（17.2.1-ee，ultimate）已实机验证跨流水线下载可用。

### 10.2 启用顺序（顺序错了会取到旧镜像 / 静默缺 job）

1. **先把含本 CI 改动的提交合入 `main` 并跑绿一次**，确认 `build` job 的 artifact 里同时有 `image.tar.gz` 和 `image.sha`。
   `needs:project` 取的是「main 上最近一次成功的 `build` job」，如果 main 还跑在旧 yml 上，取到的 tar 里没有 `image.sha`，`promote-preprod` 会直接失败。
2. **建 `pre-prod` 分支**（从 main FF 出来），此时**先不要配 `PREPROD_HOST`**，推一次提交确认流水线里只有 `check`（`promote-preprod` / `deploy-preprod` 被哨兵关掉，`build` 也不在该分支跑）。
3. **先按 §10.3 把 `pre-prod` 设为保护分支 + FF-only，再按 §10.5 配 Protected 变量**。顺序反了变量就取不到值、`PREPROD_HOST` 回落 `REPLACE_ME`，第 5 步的流水线里会**静默缺少两个预发布 job**（不是报错，见 §2 末尾提示）。
4. 按 §10.4 准备外网机：Docker + `docker login`、`data` 目录归属、手工 `.env`、CI 公钥、安全组。
5. **等 main 的 `build` 跑绿后**，在 GitLab 上以 **Fast-forward 方式合并 main → pre-prod**（等价于在 pre-prod 上 `git merge --ff-only main`）。合并产生 push 事件才会跑晋级——**MR 页面那条流水线只有 `check`**，别在那里等 `promote-preprod`。
   验证清单：流水线里**出现 `promote-preprod` 与 `deploy-preprod`** → 同源断言通过 → 双 tag 推送成功 → `.env` 校验通过 → 外网机 pull 到 `pre-prod-$SHA` → 容器 healthy → GitLab `environment` 的 url 正确展开。
6. 需要生产时再建 `prod` 保护分支 + 配 `FLOW_WEBHOOK_URL`，从 pre-prod FF 合并。

> **日常晋级节奏**：`needs:project` **不等待运行中的流水线**。main 的新 `build` 还在跑时就 FF 到 pre-prod，取到的是上一次成功产物，同源断言会失败（§10.6 b 的 D 类）。正确节奏是「main 流水线绿 → 再 FF pre-prod」。

### 10.3 分支保护与 FF-only

`pre-prod` 和 `prod` **都设为保护分支 + Fast-forward-only**（Settings > Repository > Protected branches / Merge requests）：

- SHA 相等是镜像同源的唯一保障，Squash / Merge commit 都会让 `promote-preprod` 的同源断言或 `retag` 的 pull 失败；
- `PREPROD_*` 变量若勾了 Protected，`pre-prod` 必须是保护分支才取得到值；取不到值时 `PREPROD_HOST` 回落 `REPLACE_ME`，**两个预发布 job 直接不出现**在流水线里（不是报错，见 §2 末尾提示）。所以分支保护要**先于**配 Protected 变量完成；
- FF-only 还能挡住「pre-prod 上直接提交」这类会让断言失败的操作。

### 10.4 外网预发布机准备（CI 不会替你做）

预发布机在**外网**，与内网测试机的部署路径不同：CI 只 SCP `compose.preprod.yml`（落地为 `compose.yml`）+ `deploy.sh`，**镜像由预发布机自己从阿里云公网 Registry 拉取**（内网测试机才走 SCP tar，因为内网 SCP ~10s vs 公网 pull ~2min；外网机反过来）。

上线前必须人工完成五件事（`PREPROD_PATH` 以 `/srv/deploy/<project>-preprod` 为例）：

1. **装好 Docker + Compose，并 `docker login registry.example.com`**。凭据要持久化在部署用户的 `~/.docker/config.json` 里，`deploy.sh` 才 pull 得动（也可以用 `REGISTRY_USER` / `REGISTRY_PASS` 环境变量走脚本内登录，见 §5.3）。
2. **建好数据目录并把归属给容器内的 appuser(uid=1001)**：

   ```bash
   sudo install -d -o 1001 -g 1001 -m 755 "$PREPROD_PATH/data"
   ```

   `compose.preprod.yml` 用 `./data:/app/data` 绑定卷，容器以非 root 的 1001 运行。`deploy.sh` 会尝试 `chown -R 1001:1001`，但**部署用户不是 root 时这一步静默跳过**（`|| true`，为内网测试机保留的行为）。全新外网机的部署用户 uid 通常不是 1001，漏了这步 SQLite 建不出来 → `/api/health` 返回 503 → 容器永不 healthy → 部署在 60s 后超时，日志里只看到 `Database unavailable`。

3. **手工写好 `$PREPROD_PATH/.env`**（不要从测试机复制，那份是 `admin123`）：

   ```dotenv
   PORT=3000
   WEB_PORT=<项目已分配端口；与测试机同机时换一个>
   FRONTEND_URL=http://<外网机地址>:<WEB_PORT>
   JWT_SECRET=<随机长字符串>
   SEED_ADMIN_PASSWORD=<≥6 位真实密码，非 admin123 / change-me-in-production>
   ```

   `FRONTEND_URL` / `JWT_SECRET` / `SEED_ADMIN_PASSWORD` 三项都由 [apps/api/src/env.ts](../../../apps/api/src/env.ts) 的 production 启动守卫强制要求，缺一个容器就启动即失败（表面上只看到部署末尾 60s 超时）。`deploy-preprod` 会在**远端**校验这份文件（只回传结论，不把内容拉进 CI 日志）：文件不存在、必填键为空、`NODE_ENV` 显式写了但不是 `production`、密码仍是 `admin123` 或示例占位值，都直接失败并给出修法，不会走到 `deploy.sh`。
   ⚠️ `PORT` 是**容器内**监听端口，必须是 `3000`：`compose.preprod.yml` 的映射（`WEB_PORT:3000`）与容器内健康检查都写死 3000。写成别的值容器能起来但对外不通，只表现为 60s 健康检查超时；要换对外端口改 `WEB_PORT`。守卫会直接拒非 3000 的 `PORT`。
   ⚠️ **`NODE_ENV` 不用写**：镜像自带 `ENV NODE_ENV=production`，`env_file` 只在文件里出现该键时才覆盖。显式写就必须是 `production` —— 写成 `development` 会跳过全部生产守卫（`JWT_SECRET` 回落公开的 `dev-secret-key`）、关闭静态托管（`/api/health` 变 404 → 部署超时），容器却照常跑在公网端口上。CI 的 `ENV_CHECK` 与 `deploy.sh` 的 2.1 预检都只拒绝「写了但不是 production」，所以最省事也最安全的是根本不写。
   ⚠️ `deploy.sh` 在 `.env` 缺失时会兜底生成一份并写入 `admin123`——这在公网不可接受，所以守卫必须先拦。

4. **投放 CI 公钥**到部署用户的 `~/.ssh/authorized_keys`（生成与投放手法同 §3，只是目标机换成外网机）。`PREPROD_SSH_PKEY` 默认继承实例级 `G_PREPROD_SSH_PKEY`（团队预发布机的 `ExampleOrg` 密钥），SSH 端口默认 `2222`，**这两个都不用配**；只有换密钥时才在项目里覆盖（Type = **Variable**，不是 File）。
5. **开放安全组**：SSH 端口（`PREPROD_PORT`）对 GitLab Runner 出口 IP 放行；业务端口（`WEB_PORT`）按需对公网放行。

**端口从哪来**：沿用项目已分配的测试端口，scaffold 的 `stampPort` 会把 `compose.preprod.yml` 的 `${WEB_PORT:-…}`、`deploy-preprod` 的 url 与 `deploy.sh` 一起替换，**不需要手写**。但分配器探测的是**内网测试机**（`ss -tlnH` + `/srv/deploy/port-registry.json`，见 §9），registry 按项目名一条记录、测试与预发布共用一个端口号，**它不知道预发布机上什么被占用**：

- 预发布是独立外网机 → 该端口在它上面基本空闲，直接用；
- 与内网测试机同机、或多个项目的预发布挤在同一台外网机 → 会撞端口，需手工在预发布部署目录的 `.env` 里改 `WEB_PORT`（`env_file` 的值优先于 compose 的 fallback）。部署目录带 `-preprod` 后缀，因此同机也不冲突。

改过 `WEB_PORT` 后：部署完成回显会**读远端 `.env` 的真实值**，日志里的 URL 是对的；`environment.url` 仍是 scaffold 写死的展示值（GitLab 无法在运行时求值），只作 UI 链接参考。`port-allocator` 的 registry 绑定内网测试机，预发布不参与分配。

### 10.5 GitLab Variables

| Key                | Type     | Protected | 说明                                                   |
| ------------------ | -------- | --------- | ------------------------------------------------------ |
| `PREPROD_HOST`     | Variable | 建议 ✅   | 外网机 IP / 域名。**这就是开关**                       |
| `PREPROD_PORT`     | Variable | 建议 ✅   | SSH 端口，默认 `2222`（团队惯例）                     |
| `PREPROD_USER`     | Variable | 建议 ✅   | 部署用户，默认 `ExampleOrg`                                |
| `PREPROD_PATH`     | Variable | 建议 ✅   | 部署目录，默认 `/srv/deploy/<project>-preprod`        |
| `PREPROD_SSH_PKEY` | Variable | 建议 ✅   | 私钥整段内容；默认继承 `$G_PREPROD_SSH_PKEY` |

`PREPROD_SHA_TAG` / `PREPROD_TAG` 是 yml 内部推导出的镜像 tag，**不需要也不应该在 UI 覆盖**。

勾 Protected 之前先确认 `pre-prod` 已是保护分支（§10.2 第 3 步）：否则变量取不到值、`PREPROD_HOST` 回落 `REPLACE_ME`，两个预发布 job 会**静默不出现**在流水线里。

### 10.6 排错

**a) `promote-preprod` 报 `could not retrieve the needed artifacts`**

失败发生在 **artifact 下载阶段**，`script` 里的友好提示根本不会执行。原因是 main 上没有可取的成功 `build` 产物：main 最新流水线 build 失败 / 还没跑完 / 产物被清理。
**恢复路径**：修好 main 的流水线并跑绿，再回来 retry 本 job。

> `build` 的 `expire_in: 1 day` 不会卡住晋级：GitLab 默认 keep-latest 会永久保留每个 ref 最新成功流水线的产物（已实机验证 `artifacts_expire_at` 过期后产物仍在）。频繁提交下不宜放大 `expire_in`。

**b) `❌ 镜像同源断言失败`**

日志会打印 main 最近一次成功 build 的 SHA 与 pre-prod HEAD，并给出四类判据：

| 类  | 含义                                | 修复                                                                                           |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| A   | main 已前进                         | 在 pre-prod 上 `git merge --ff-only main`（把 pre-prod 快进到 main，勿 Squash / Merge commit） |
| B   | pre-prod 含非 main 的提交           | 回退 pre-prod 后重新 FF 合并                                                                   |
| C   | main 新流水线 build 失败 / 产物过期 | 修好 main 流水线后 retry 本 job                                                                |
| D   | main 的 build **还在跑**            | `needs:project` 不等待运行中的流水线，取到的是上一次成功产物；等 main 绿了再 retry 本 job      |

**先查 D**：刚合入 main 就立刻 FF 到 pre-prod 是最常见的触发方式，此时 main 的 build 往往还没跑完。
自查命令：`git merge-base --is-ancestor <main build SHA> <pre-prod HEAD>`。

**c) `❌ main 的 build 产物缺少 image.sha`**

main 还跑在旧 yml 上。按 §10.2 第 1 步先把改动合入 main 跑绿一次。

**d) `❌ 预发布机 .env 不合规：…`**

守卫生效了（这是预期行为，不是故障）。消息会指出具体原因：文件不存在 / 必填键为空 / `NODE_ENV` 显式写了但不是 `production` / 密码仍是 `admin123` 或示例占位值。按 §10.4 第 3 步的模板修好远端 `.env` 后 retry。校验在远端执行，CI 日志里不会出现 `.env` 内容。

**e) `❌ PREPROD_SSH_PKEY 为空`**

私钥取不到值：它默认继承实例级 `G_PREPROD_SSH_PKEY`，该变量不存在、或勾了 Protected 但 `pre-prod` 不是保护分支时会展开成空串。按 §10.3 把分支保护配对，或单独配 `PREPROD_SSH_PKEY`。

**f) 流水线里根本没有 `promote-preprod` / `deploy-preprod`**

不是 job 失败，是 job 被 rules 关掉了，日志里什么都找不到。三种原因：`PREPROD_HOST` 仍是 `REPLACE_ME`；被设成了**空串**（同样判为关闭）；勾了 Protected 但 `pre-prod` 不是保护分支，取不到值后回落 `REPLACE_ME`。逐一核对 §10.5 与 §10.3。

**g) 外网机 `docker pull` 报 401 / unauthorized**

部署用户没登录 Registry，或 `~/.docker/config.json` 的凭据过期。见 §10.4 第 1 步与 §5.3。

**h) 容器起不来 / `ERROR: Health check timeout (60s)`**

先看 `docker compose logs`：

- `Database unavailable` 或 SQLite 权限报错 → `data` 目录归属不是 1001，按 §10.4 第 2 步 `sudo install -d -o 1001 -g 1001` 重建归属后重跑；
- `[ENV] … is required in production` → `.env` 缺键。正常会被 d) 的守卫提前拦下；若是手工跑 `deploy.sh` 绕过了 CI，`deploy.sh` 自己的预检也会报出缺哪个键；
- `/api/health` 404 → `NODE_ENV` 不是 `production`，静态托管与 `/api` 前缀都没启用（见 §10.4 第 3 步的警告）。`deploy.sh` 的 2.1 预检本应先拦下这种 `.env`；若仍走到这步，说明用的是别的 compose / 绕过脚本起的容器。

**i) 启用后手工 `./deploy.sh test-latest` 拉到陈旧镜像**

启用预发布后 `push-registry` 关闭，Registry 里的 `test-latest` **不再更新**。内网测试机必须走 tar 模式（`./deploy.sh test-latest image.tar.gz`，即 `deploy-test` 的做法）；手工部署预发布机用 `./deploy.sh pre-prod`（moving tag）。
精确部署/回滚到某个 SHA **必须同时给环境变量**：`PREPROD_IMAGE_TAG=pre-prod-<SHA> ./deploy.sh pre-prod-<SHA>`。只传第一个参数不够——`deploy.sh` 的 `$1` 只决定 `docker pull` 哪个镜像，`compose up` 实际启动的是 compose 里插值出来的镜像，缺环境变量会回落到 moving tag，**看起来部署成功其实没回滚**（详见 §10.7）。

**j) `deploy-preprod` 长时间无输出，卡在第一条 `ssh` 上**

几乎都是 **SSH 端口不对**：连到 22 上的另一个 sshd / 防护服务时，认证会落到 `keyboard-interactive`，CI 没有 TTY，ssh 就一直等交互输入直到 job 超时（实测挂死 14 分钟）。团队预发布机的 SSH 端口是 `2222`，`22` 往往已被别的服务占用。

排查顺序：

1. 核对 `PREPROD_PORT`（去同组已跑通的项目抄，不要猜）；
2. 现在 CI 内所有 `ssh`/`scp` 都带 `-o BatchMode=yes -o ConnectTimeout=15`，认证/网络问题会在 15s 内以 `Permission denied` / `Connection timed out` 失败，不再挂死；仍长时间无输出多半是运行的不是新版 yml；
3. `ssh-keyscan` 也不再重定向 stderr，host key / 端口不通会直接报出来。

### 10.7 回滚

不可变的 `pre-prod-$SHA` tag 就是为回滚留的：

```bash
ssh <PREPROD_USER>@<PREPROD_HOST>
cd <PREPROD_PATH>
PREPROD_IMAGE_TAG=pre-prod-<目标SHA> ./deploy.sh pre-prod-<目标SHA>
```

**环境变量不能省**：`deploy.sh` 的 `$1` 只决定 `docker pull` 哪个镜像，`compose up` 启动的是 `${PREPROD_IMAGE_TAG:-pre-prod}` 的插值结果。漏了环境变量会静默启动 moving tag——看着部署成功，其实没回滚。

⚠️ **回滚镜像不等于回滚数据库**：`./data` 是持久卷，新版本跑过的 drizzle 迁移不会随镜像回退。回滚前先备份（项目内置的 SQLite 热备走 `VACUUM INTO` 原子快照，见 [apps/api/src/shared/sqlite-ops.ts](../../../apps/api/src/shared/sqlite-ops.ts)；或停容器后 `cp -a data data.bak`），并确认目标版本的 schema 与当前库兼容。含破坏性迁移、或已按新结构写入数据时，回滚可能不安全。

⚠️ `deploy.sh` 结尾的 `docker image prune -af --filter "until=24h"` 按镜像 **created 时间**过滤，会清掉本地未被容器引用的旧 SHA tag。回滚到较旧版本时需要重新从 Registry pull（脚本的 registry 模式本来就会 pull，所以正常可行），但不要指望本地一直留着历史镜像。

**tag 保留策略**：每次晋级都会新增一个不可变的 `pre-prod-$SHA`，长期会累积。在阿里云 ACR 命名空间上配保留策略（如保留最近 N 个 / 最近 90 天），但必须保证**当前 prod 与预发布正在用的 SHA 不被清掉**，否则回滚与 `retag` 会拉不到镜像。

生产回滚同理：`prod` 分支 `git reset --hard <上一个正确 SHA>` 后重新 FF 合并，让 `retag` 把对应的 `pre-prod-$SHA` 重新打成 `:latest`。

### 10.8 模板仓库自身不启用

`liquid-glass-starter` 模板仓库**保持 `PREPROD_HOST: "REPLACE_ME"`**：`compose.preprod.yml` 用的是 `./data` 持久卷，启用会违反 [AGENTS.md](../../../AGENTS.md) 的「模板部署级别无状态」规则（模板 self-deploy 必须走 `compose.self.yml` 的 tmpfs）。该文件只随 scaffold 进入生成项目，由项目自己决定是否配 `PREPROD_HOST`。

### 10.9 缓存影响

main 不再 push 后，Registry 的 `:latest` 只在 prod 发布时前进，`build` 的 `--cache-from` 锚点变粗。但 Runner 宿主的 BuildKit 本地缓存仍在（`build` 只 prune 24h 前的悬空镜像），同机连续构建不受影响；跨机或长时间未构建时首帧会慢一些。
