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
    selftest.mjs
    lib/common.mjs
```

## 依赖

- Node.js 18+
- 可选：`tools/dsh-cost`（峰谷、历史均价、A/B）；缺失时 `plan` 降级，`verify` 提示先同步。

## 安装到 DSH

```powershell
node skills/token-budget/scripts/install.mjs
```

移除联接（不删技能目录）：

```powershell
node skills/token-budget/scripts/install.mjs --remove
```

重启 DSH 或等技能目录刷新后，`token-budget` 会出现在技能列表里。

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
