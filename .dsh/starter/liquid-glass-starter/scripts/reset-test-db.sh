#!/usr/bin/env bash
# 重置测试环境数据库（停止容器 → 删除外挂 SQLite 文件，不重启）
set -euo pipefail

SSH_HOST="192.0.2.10"
SSH_PORT="2222"
SSH_USER="ExampleOrg"
REMOTE_DIR="/srv/deploy/liquid-glass-starter"
IMAGE="registry.example.com/liquid-glass/liquid-glass-starter:test-latest"

echo "==> 停止容器..."
ssh -o StrictHostKeyChecking=no -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" \
  "cd $REMOTE_DIR && docker compose down"

echo "==> 删除数据库文件..."
ssh -o StrictHostKeyChecking=no -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" \
  "docker run --rm --entrypoint='' -v $REMOTE_DIR/data:/data $IMAGE sh -c 'rm -f /data/sqlite.db /data/sqlite.db-shm /data/sqlite.db-wal'"

echo "==> 完成。数据库已重置，容器未重启。"
echo "    如需启动: ssh -p $SSH_PORT $SSH_USER@$SSH_HOST 'cd $REMOTE_DIR && docker compose up -d'"
