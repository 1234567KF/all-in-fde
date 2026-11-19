# 脚本说明

| 脚本 | 状态 | 说明 |
| --- | --- | --- |
| `verify-evidence.mjs` | 可用 | 校验证据 shape、ID 全集、门级一致性；`--strict` 把重复证据、E6-9 越权判 PASS、E5-2 日志超 20 分钟、E5-9 复核记录缺失变错误 |
| `card-evidence.mjs` | 可用 | 验收卡 → E6 证据：人点选后带签名落盘；未点选拒绝封卡，有问题写 FAIL |
| `e0-selfcheck.mjs` | 可用 | 环境自检，三态退出码 0/1/2 |
| `check-tickets.mjs` | 可用 | 票依赖图 + 票面纪律：无环、三阶段禁第三态、勾①必须有回执、批次票告警 |
| `e7-fresh-copy.mjs` | 可用 | 干净目录复跑：复制项目（不带依赖/数据/.git），可选 `--run` 装与跑门禁 |
| `starter-info.mjs` | 可用 | 解析脚手架坐标（工作区 → 本机 → 环境变量），`--check-reach` 探测可达 |
| `ensure-tmp.mjs` | 可用 | 建 `.fde-tmp/` 并写进本机 `.git/info/exclude`（幂等，支持 worktree） |
| `safe-remove.mjs` | 可用 | 删目录前体检：拦未入库文件、拦当前工作目录及其祖先；`--yes` 才真删 |
| `clean-tmp.mjs` | 可用 | 清理工作区 `.fde-tmp/`：预览、`--all`、`--older-than N` |
| `seed-demo` | 随脚手架落地 | 单源造数，dev-only；依赖脚手架的表结构 |
| `e2e-run` | 随脚手架落地 | 双 project 跑批，依赖 Playwright 配置 |

`seed-demo` 与 `e2e-run` 依赖具体脚手架，不在这里写死；脚手架接入时按 `references/scaffold.md` 与 `references/verify.md` 生成。

## 典型用法

```bash
# 1. 开工：建 .fde-tmp 并排除
node <技能>/scripts/ensure-tmp.mjs

# 2. 切片后：查依赖与票面纪律
node <技能>/scripts/check-tickets.mjs .fde/tickets

# 3. 验收：先跑冷启动脚本拿 E6-<脚本>.json，再让人填卡
node <技能>/scripts/card-evidence.mjs --card .fde/cards/E6-01.md \
  --from .fde/evidence/E6-coldstart.json --by "张三"

# 4. 交付：干净目录复跑
node <技能>/scripts/e7-fresh-copy.mjs --src . --run

# 5. 收口：严格校验
node <技能>/scripts/verify-evidence.mjs .fde/evidence --strict
```

仓库级校验脚本（**不在本技能内**，只在仓库里可用）：`scripts/check-public-artifacts.mjs`（产物净化）、`scripts/check-links.mjs`（链接可达）、`scripts/check-skills.mjs`（技能目录校验）。技能单独安装时这些不存在，不影响运行。
