#!/usr/bin/sh
set -e

# ── 部署脚本（生产 / 测试通用）──
#
# 用法:
#   ./deploy.sh [镜像标签] [tar包路径]
#
# 模式:
#   1. Registry 模式（默认，生产用）
#      ./deploy.sh                         # latest
#      ./deploy.sh test-latest             # 从阿里云 pull
#
#   2. 本地 tar 加载模式（测试环境用，绕过 Registry 拉取）
#      ./deploy.sh test-latest image.tar.gz
#      → docker load 后启动，不再 pull
#
# 部署目录 = 脚本所在目录（放在哪跑在哪）
#
# 目录结构:
#   ${DEPLOY_DIR}/
#     ├── compose.yml
#     ├── .env          ← 密钥和配置（不入库）
#     ├── deploy.sh
#     └── data/         ← SQLite 持久卷（仅生成项目；模板 tmpfs 模式不创建）

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_REGISTRY="registry.example.com/liquid-glass"
IMAGE_NAME="liquid-glass-starter"
TAG="${1:-latest}"
FROM_TAR="${2:-}"
IMAGE="${IMAGE_REGISTRY}/${IMAGE_NAME}:${TAG}"

echo "=== ${IMAGE_NAME} deploy ==="
echo "Image: ${IMAGE}"
echo "Deploy dir: ${DEPLOY_DIR}"
if [ -n "${FROM_TAR}" ]; then
  echo "Source: local tar (${FROM_TAR})"
fi

# 0. 识别部署形态：compose.yml 含 tmpfs = 模板的无记忆 self-deploy
#    （/app/data 是容器内 tmpfs，宿主 ./data 不参与持久化）；
#    否则 = 生成项目的 ./data 绑定卷持久化。
MEMORYLESS=0
if [ -f "${DEPLOY_DIR}/compose.yml" ] && grep -q 'tmpfs' "${DEPLOY_DIR}/compose.yml" 2>/dev/null; then
  MEMORYLESS=1
fi
if [ "${MEMORYLESS}" -eq 1 ]; then
  echo "Data mode: memoryless (tmpfs，容器重建即空库)"
else
  echo "Data mode: persistent (./data 绑定卷)"
fi

# 1. 持久卷模式才需要宿主 data 目录（模板 tmpfs 模式不用，避免留下无意义的旧数据目录）
if [ "${MEMORYLESS}" -eq 0 ]; then
  mkdir -p "${DEPLOY_DIR}/data"
fi

# 2. bootstrap .env（首次部署兜底：仅用于 fresh 测试机 / 模板 self-deploy）
#    真实项目应通过 GitLab CI/CD 变量或手工写入真实密钥，
#    本段只保证 fresh 测试机上能直接拉起来验证 CI 链路。
#    认证已启用真实 bcrypt 校验：默认初始密码仍是 admin123，只作为首次拉起
#    测试环境的便利值；production 的安全性由 env.ts 守卫保证（必须显式配置
#    SEED_ADMIN_PASSWORD，缺失 / 过短 / 占位值直接启动失败）。正式上线前请
#    修改 .env 里的 SEED_ADMIN_PASSWORD（仅对空库首次建库生效）。
if [ ! -f "${DEPLOY_DIR}/.env" ]; then
  echo "⚠  .env 不存在，生成默认配置（仅用于首次自部署，请按需修改）"
  JWT_RAND=$(head -c 32 /dev/urandom | base64 | tr -d '\n=+/' | cut -c1-40)
  cat > "${DEPLOY_DIR}/.env" <<ENVEOF
PORT=3000
WEB_PORT=11070
FRONTEND_URL=http://localhost:11070
JWT_SECRET=${JWT_RAND}
SEED_ADMIN_PASSWORD=admin123
ENVEOF
  echo "✓ .env 已生成，JWT_SECRET 已随机化"
  # 持久卷模式 = 生成项目（测试机 / 手工生产部署）：默认密码仅用于首次拉起，
  # 打印醒目提示，避免误把测试默认值当成生产配置。
  if [ "${MEMORYLESS}" -eq 0 ]; then
    echo "⚠  初始 admin 密码为测试默认值 admin123：正式上线请先修改 .env 的"
    echo "   SEED_ADMIN_PASSWORD，再首次建库（已建库改 .env 不会改密）。"
  fi
fi

# 2.1 存量 .env 兼容：production 启动守卫（apps/api/src/env.ts）要求这三个键存在且非空，
#     缺任意一个容器都启动即失败，表面上只看到末尾 60s 健康检查超时——这里提前报错。
#     老部署目录的 .env 可能没有这些键。
for key in SEED_ADMIN_PASSWORD JWT_SECRET FRONTEND_URL; do
  if ! grep -q "^${key}=." "${DEPLOY_DIR}/.env"; then
    echo "ERROR: ${DEPLOY_DIR}/.env 缺少 ${key} 或值为空（production 必填，否则服务启动即失败）。"
    echo "       请编辑 .env 补一行 ${key}=<真实值> 后重新执行本脚本。"
    echo "       SEED_ADMIN_PASSWORD 需 ≥6 位且非占位值；FRONTEND_URL 填浏览器访问地址（CORS 白名单）。"
    exit 1
  fi
done

# NODE_ENV 只允许 production（不写则沿用镜像默认值，也是 production）。
# 写成 development 的后果不是"少个开关"：跳过全部生产守卫（JWT_SECRET 回落公开的
# dev-secret-key）、关闭静态托管（/api/health 404 → 健康检查超时），容器却照常在跑。
if grep -q '^NODE_ENV=' "${DEPLOY_DIR}/.env" && ! grep -Eq '^NODE_ENV="?production"?$' "${DEPLOY_DIR}/.env"; then
  echo "ERROR: ${DEPLOY_DIR}/.env 的 NODE_ENV 必须是 production（当前不是）。"
  echo "       不写这一行最省事：镜像自带 ENV NODE_ENV=production。"
  echo "       写成 development 会关闭静态托管，并让 JWT_SECRET 回落到公开默认值。"
  exit 1
fi

# 3. 修正 data 目录权限与容器内 appuser (uid=1001) 一致
#    非 root 用户环境（如测试机 ExampleOrg）无权限时静默跳过
if [ "${MEMORYLESS}" -eq 0 ]; then
  chown -R 1001:1001 "${DEPLOY_DIR}/data" 2>/dev/null || true
fi

# 4. 加载镜像（tar 模式 or Registry 模式）
if [ -n "${FROM_TAR}" ]; then
  TAR_PATH="${DEPLOY_DIR}/${FROM_TAR}"
  if [ ! -f "${TAR_PATH}" ]; then
    echo "ERROR: tar 包不存在: ${TAR_PATH}"
    exit 1
  fi
  echo "Loading image from tar..."
  docker load -i "${TAR_PATH}"
  # tar 包一次性使用，加载后立即删除释放磁盘
  rm -f "${TAR_PATH}"
else
  # 可选登录
  if [ -n "${REGISTRY_USER}" ] && [ -n "${REGISTRY_PASS}" ]; then
    echo "Logging in to registry..."
    echo "${REGISTRY_PASS}" | docker login "${IMAGE_REGISTRY}" \
      --username "${REGISTRY_USER}" --password-stdin
  fi
  echo "Pulling image..."
  docker pull "${IMAGE}"
fi

# 5. 重新部署
echo "Starting service..."
cd "${DEPLOY_DIR}"
if [ -n "${FROM_TAR}" ]; then
  # tar 模式：镜像已本地加载，不再拉取
  docker compose up -d
else
  docker compose up -d --pull always
fi

# 6. 等待健康检查
echo "Waiting for health check..."
timeout=60
elapsed=0
until docker compose ps | grep -q "healthy" || [ ${elapsed} -ge ${timeout} ]; do
  sleep 5
  elapsed=$((elapsed + 5))
  echo "  ... ${elapsed}s"
done

if [ ${elapsed} -ge ${timeout} ]; then
  echo "ERROR: Health check timeout (${timeout}s)"
  echo "Check logs: docker compose logs"
  docker compose logs --tail=50
  exit 1
fi

# 7. 清理旧镜像（未被容器引用且超过 24h 的）
# – 回滚统一从 Registry 拉取（阿里云 Flow 内网通道，几秒完成），无需本地缓存
# – 保留 24h 仅用于兜底调试，避免频繁 build 期间误清
echo "Cleaning up old images..."
docker image prune -af --filter "until=24h" 2>/dev/null || true

echo "=== Deploy complete ==="
docker compose ps
