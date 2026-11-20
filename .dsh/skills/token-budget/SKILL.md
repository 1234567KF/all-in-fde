---
name: token-budget
description: Token 预算与节省策略。用户说“统计 / 看计费 / 看板”，或提到 token-budget、省 token、预算、成本、节省，或 all-in-fde 任务开始/收尾时加载；先判断类型与峰谷，再执行；统计时生成当前工作空间的 dashboard。
metadata:
  version: "0.4.1"
---

# token-budget

预算层。领域技能管内容，本技能管流程和验收；入口不存在时也可单独用。

## 第一步

在技能 Base directory（DSH 加载时给出，本文件所在目录）执行：

```powershell
node "<Base directory>/scripts/plan.mjs" --task "<用户原话>" --json
```

按返回的 `type`、`playbook`、`model`、`effort`、`readStrategy`、`subagents` 执行。类型判断错了用 `--type doc|code|ppt|research` 覆盖。

## 五个动作

以下 `scripts/...` 都相对技能 Base directory。

| 动作 | 命令 | 用途 |
| --- | --- | --- |
| `plan` | `scripts/plan.mjs --task "..." --json` | 判类型、峰谷、预算、读取策略 |
| `brief` | `scripts/brief.mjs --goal "..." --inputs "a,b" --max-return 1500` | 子代理简报 |
| `squeeze` | `scripts/squeeze.mjs <日志/JSON> --out <压缩文件> --json` | 可逆压缩，`retrieve <id>` 取原文 |
| `verify` | `scripts/verify.mjs --task "<#task>"` | 调 dsh-cost 做 A/B |
| `stat` | `scripts/stat.mjs` | 生成当前工作空间看板 |

## 统计 / 看板（任何工作空间）

用户只说“统计”“看计费”“看板”时，直接执行：

```powershell
node "<Base directory>/scripts/stat.mjs"
```

它按当前工作目录名生成 `<当前工作空间>/.dsh/dsh-cost/dashboard.html`，然后：

- 用 `present` 把这个 HTML 作为交付物展示；
- 或让用户双击打开，不要只在聊天里贴 Markdown 表格。

范围规则：

- 当前工作空间有匹配的计费起点（`epoch.workspace`）→ 按起点统计；
- 其他工作空间 → 默认该空间全部历史；
- 看板含总账、按日、每条 H2A 指令、A2A 子代理下钻。

脚本只读会话日志，不调用模型、不产生 token。统计结果要数字时，读看板或跑 `report`，不要重新生成 Markdown 长文。

## 规则

1. **读**：文档先大纲再分节；代码先 map/signatures 再行区间；不整篇/整文件读。
2. **写**：只给 diff、路径、摘要、未决问题；不重述输入。
3. **子代理**：用 `brief`，返回 ≤1500 token；详细内容写文件。
4. **压缩**：仅日志/JSON/命令输出，且可 retrieve；代码、文档正文、合同、交付物不压。
5. **峰谷**：`peak=true` 时长生成推低谷；审阅/核对可继续。
6. **模型**：默认 flash；机械任务低 effort；架构/疑难才升 pro，不在中途频繁换。
7. **压缩时机**：只在章节/阶段边界；保留决策、术语、未决问题。

## 被 all-in-fde 入口调用

`all-in-fde` 已存在。入口在两步调用本技能：

```text
开工：加载 token-budget，执行 plan，按返回的 playbook 走。
收尾/用户说统计：执行 scripts/stat.mjs，把当前工作空间看板交给用户。
```

入口负责选领域技能（all-in-md、PPT、编码）；本技能负责预算、验收和统计，不改入口的流程。

## 脱离 all-in-fde 使用（任何会话）

本技能不依赖 all-in-fde。两种独立用法：

1. **选预设「FDE 预算」**（`fde-budget`）：persona 内置省流纪律——非平凡任务开工自动跑 plan、派子代理先出 brief、长日志先 squeeze、问计费直接出 stat。普通问答/调研/文档任务都适用。
2. **手动调用**：任何会话里说「统计」「看计费」「看板」，或提到省 token / 预算 / 成本，本技能按上方「统计 / 看板」一节直接执行，不需要流程上下文。

注意：plan/brief/squeeze 是脚本，路径以技能 Base directory 为准；`fde-budget` 预设里的路径写死为 `~/.dsh/skills/token-budget/scripts/...`（全局联接位置）。技能装在别处时用实际 Base directory。

## 红线

- 不压缩源代码、文档正文、合同、交付物。
- 同一段内容只允许一个压缩器，不叠加。
- 不改 system prompt/tools 前缀；不做缓存预热；不做技能 stub。
- 不为省 token 缩短交付物；不承诺固定节省比例。
- `#cost-off` / `#no-squeeze` / `#no-brief` 可关闭；环境变量 `TOKEN_BUDGET=off` 全局关。

## 文件

`references/policy.md`（决策表/压缩矩阵）、`references/playbook-{doc,code,ppt,research}.md`、`scripts/{plan,brief,squeeze,verify,stat,install,doctor,package,sync-vendor}.mjs`、`vendor/dsh-cost/`。细节按需读，不要整包塞进上下文。

绑定 dsh-cost；先跑 `scripts/doctor.mjs` 检查。
