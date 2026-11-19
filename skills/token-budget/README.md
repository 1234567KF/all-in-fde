# token-budget

all-in-fde 任务和长任务的预算层：先判断任务类型、峰谷和读取策略，再按省 token 的 playbook 执行。领域技能负责内容，本技能负责流程、预算和验收。

`all-in-fde` 入口目前不存在；以后有时，在入口第一步加载本技能并执行 `plan`。

## 用法

```powershell
# 1. 任务开始：出计划（自动读峰谷和最近上下文压力）
node skills/token-budget/scripts/plan.mjs --task "审阅这份标书并给出 P0 问题" --json

# 2. 需要子代理：生成简报
node skills/token-budget/scripts/brief.mjs --goal "审阅第 5 章一致性" --inputs "docs/a.md" --max-return 1500

# 3. 工具输出太长：只压日志/JSON，原文可 retrieve
node skills/token-budget/scripts/squeeze.mjs "test.log" --type log --level medium --out "test.squeezed.log" --json
node skills/token-budget/scripts/squeeze.mjs retrieve <id>

# 4. 交付后：A/B 验证
node skills/token-budget/scripts/verify.mjs --task doc-review-01 --base A --cand B
```

也可以直接说：“用 token-budget 给这个任务做预算”。

## 脚本

| 脚本 | 作用 | 关键约束 |
| --- | --- | --- |
| `scripts/plan.mjs` | 类型、峰谷、读取策略、模型/effort、预算 | 只读，不调用模型 |
| `scripts/brief.mjs` | 生成子代理简报 | 返回上限默认 1500 token |
| `scripts/squeeze.mjs` | 日志/JSON 可逆压缩 | 拒绝 `.js/.py/.md/.docx` 等；原文落盘 |
| `scripts/verify.mjs` | 复用 `tools/dsh-cost` 做 A/B | 需要先 `sync` 账本 |
| `scripts/install.mjs` | 装/卸 DSH 目录联接 | 不删除技能目录 |
| `scripts/selftest.mjs` | 自检 | 无网络、无真实会话 |

## 目录

```text
skills/token-budget/
  SKILL.md
  META.json
  PROVENANCE.md
  CHANGELOG.md
  LICENSE
  references/
    policy.md
    playbook-doc.md
    playbook-code.md
    playbook-ppt.md
    playbook-research.md
  scripts/
    plan.mjs
    brief.mjs
    squeeze.mjs
    verify.mjs
    install.mjs
    doctor.mjs
    package.mjs
    sync-vendor.mjs
    selftest.mjs
    lib/common.mjs
    lib/dsh-cost.mjs
  vendor/dsh-cost/          # 技能自带依赖副本（由 sync-vendor 生成）
```

## 与计费工具 `dsh-cost` 的关系

计费**不是**技能，是独立的本地工具 `dsh-cost`；但本技能把它作为**依赖绑定**，不是“可有可无”。

依赖解析顺序：

1. `DSH_COST_HOME` 环境变量
2. `~/.dsh/dsh-cost`（`install.mjs` 安装到这里）
3. `tools/dsh-cost`（本仓库开发目录）
4. `skills/token-budget/vendor/dsh-cost`（技能自带副本，免克隆安装用）

数据在 dsh-cost 目录下的 `data/`、`reports/`；安装到 `~/.dsh/dsh-cost` 后，账本和报表也在那里，不写进技能目录。

| 本技能动作 | 用到 dsh-cost 什么 | 没有 dsh-cost 时 |
| --- | --- | --- |
| `plan` | `pricing.json` 判峰谷；`reports/summary.json` 取历史均价 | 峰谷显示“不可用”，预算只有轮次参考 |
| `verify` | 账本 + A/B 统计 | 报错，提示先安装/同步 |
| `squeeze` / `brief` | 不用 | 正常工作 |

反过来，**没有 token-budget，dsh-cost 仍可单独用**：直接跑 `sync`/`report` 即可。

## 依赖

- Node.js 18+
- `dsh-cost`：通过 `install.mjs` 安装，或用 `DSH_COST_HOME` 指向一个已有目录

## 安装（含 dsh-cost 依赖）

```powershell
# 先看会装到哪
node skills/token-budget/scripts/install.mjs --dry-run

# 安装 dsh-cost 到 ~/.dsh/dsh-cost，并挂载技能
node skills/token-budget/scripts/install.mjs

# 检查绑定
node skills/token-budget/scripts/doctor.mjs
```

安装会：

- 把 dsh-cost 的 `bin/src/bench/scripts/pricing.json` 复制到 `~/.dsh/dsh-cost`；
- 如果目标没有账本/报表，把当前 `data/`、`reports/` 迁移过去；
- 把技能挂到 `.dsh/skills/token-budget`（没有 `.dsh` 时跳过，复制技能目录即可）。

可选参数：`--home DIR` 改安装位置；`--remove` 只移除技能联接，不删 dsh-cost 和数据。

## 免克隆安装包

```powershell
node skills/token-budget/scripts/package.mjs
```

生成 `dist/token-budget-<version>/`，里面自带 `vendor/dsh-cost`，复制到任意机器后：

```powershell
node scripts/install.mjs
```

不需要克隆 all-in-fde，也不需要 `tools/`。

`vendor/dsh-cost` 是 `tools/dsh-cost` 的代码副本，不含账本/报表。改了 dsh-cost 后运行：

```powershell
node skills/token-budget/scripts/sync-vendor.mjs
```

## 给 all-in-fde 入口的接入方式

入口技能第一步加一句：

```text
先加载 token-budget 技能，执行 plan，再按返回的 playbook 走。
```

或者直接调用 `scripts/plan.mjs`。本技能不依赖入口存在，也可以单独触发。

## 设计原则

- 正确性优先，不压缩源代码/文档正文/合同/交付物。
- 一个内容只允许一个压缩器。
- 不做自动 hook、不改 system prompt/tools 前缀。
- 不承诺固定节省比例；用 A/B 的置信区间和质量门说话。
