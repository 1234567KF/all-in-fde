---
name: token-budget
description: Token 预算与节省策略。用户提到 token-budget、省 token、预算、成本、节省，或 all-in-fde 入口任务开始时加载；先判断类型、峰谷和读取策略，再按 playbook 执行，并可用 A/B 验证是否真省。
metadata:
  version: "0.2.0"
---

# token-budget

预算层。领域技能管内容，本技能管流程和验收；入口不存在时也可单独用。

## 第一步

在技能 Base directory（DSH 加载时给出，本文件所在目录）执行：

```powershell
node "<Base directory>/scripts/plan.mjs" --task "<用户原话>" --json
```

按返回的 `type`、`playbook`、`model`、`effort`、`readStrategy`、`subagents` 执行。类型判断错了用 `--type doc|code|ppt|research` 覆盖。

## 四个动作

以下 `scripts/...` 都相对技能 Base directory。

| 动作 | 命令 | 用途 |
| --- | --- | --- |
| `plan` | `scripts/plan.mjs --task "..." --json` | 判类型、峰谷、预算、读取策略 |
| `brief` | `scripts/brief.mjs --goal "..." --inputs "a,b" --max-return 1500` | 子代理简报 |
| `squeeze` | `scripts/squeeze.mjs <日志/JSON> --out <压缩文件> --json` | 可逆压缩，`retrieve <id>` 取原文 |
| `verify` | `scripts/verify.mjs --task "<#task>"` | 调 dsh-cost 做 A/B |

## 规则

1. **读**：文档先大纲再分节；代码先 map/signatures 再行区间；不整篇/整文件读。
2. **写**：只给 diff、路径、摘要、未决问题；不重述输入。
3. **子代理**：用 `brief`，返回 ≤1500 token；详细内容写文件。
4. **压缩**：仅日志/JSON/命令输出，且可 retrieve；代码、文档正文、合同、交付物不压。
5. **峰谷**：`peak=true` 时长生成推低谷；审阅/核对可继续。
6. **模型**：默认 flash；机械任务低 effort；架构/疑难才升 pro，不在中途频繁换。
7. **压缩时机**：只在章节/阶段边界；保留决策、术语、未决问题。

## 被 all-in-fde 入口调用

以后有独立的 `all-in-fde` 入口技能时，在它的第一步加一句：

```text
先加载 token-budget 技能，执行 plan，再按返回的 playbook 走。
```

不需要改脚本；`plan` 会自动读当前峰谷和最近上下文压力。入口技能负责选领域技能（all-in-md、PPT、编码），本技能只负责预算和验收。

## 红线

- 不压缩源代码、文档正文、合同、交付物。
- 同一段内容只允许一个压缩器，不叠加。
- 不改 system prompt/tools 前缀；不做缓存预热；不做技能 stub。
- 不为省 token 缩短交付物；不承诺固定节省比例。
- `#cost-off` / `#no-squeeze` / `#no-brief` 可关闭；环境变量 `TOKEN_BUDGET=off` 全局关。

## 文件

`references/policy.md`（决策表/压缩矩阵）、`references/playbook-{doc,code,ppt,research}.md`、`scripts/{plan,brief,squeeze,verify,install,doctor,package,sync-vendor}.mjs`、`vendor/dsh-cost/`。细节按需读，不要整包塞进上下文。

绑定 dsh-cost；先跑 `scripts/doctor.mjs` 检查。
