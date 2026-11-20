# 工作区说明（Agent 必读）

这是一个 DSH 工作区，装了三样东西：

| 位置 | 是什么 |
| --- | --- |
| `.dsh/skills/all-in-fde` | 入口技能：把一段需求推进到可验收的小型 IT 系统 |
| `.dsh/bundles/fde-presets` | 三个子代理预设：FDE 主控 / FDE 逐单 / FDE 验收 |
| `.dsh/starter/liquid-glass-starter` | 本地脚手架底座（Bun + Hono + Drizzle + React），起项目用 |

## 首次进入：先完成安装，再谈开发

判断依据：`.dsh/starter/liquid-glass-starter/node_modules` 不存在，说明还没装。

**一键**：

```bash
node scripts/bootstrap.mjs
```

它会：检查 bun → 在 `.dsh/starter/liquid-glass-starter` 跑 `bun install` → 跑 `bun run check`。

**如果没有 bun**，先装一个（不要跳过）：

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"      # Windows
curl -fsSL https://bun.sh/install | bash          # macOS / Linux
```

装完新开一个终端，再跑 `node scripts/bootstrap.mjs`。

`bun run check` 全绿之前，**不要开始起项目**。空模板都绿不了，后面所有绿都不可信。

## 起一个新项目

1. 新建会话，选预设 **FDE 主控**。
2. 一句话说需求，例如「做个合同管理，能录入、经理审批、批完通知我」。
3. 技能会先收活、填采集表、等人审定，然后到「起架」——用 `.dsh/starter/liquid-glass-starter` 生成项目，不 clone、不联网。

想在**别的工作区**用这套脚手架：在那个目录开 FDE 主控会话，说「用脚手架起这个项目」。技能按顺序找脚手架坐标：

1. `<那个工作区>/.fde/starter.json`（项目级，可指向任意本机副本）
2. `~/.dsh/all-in-fde/starter.json`（本机级）
3. 本技能自带的 `.dsh/starter/liquid-glass-starter`（开箱即用）

## 改动边界

- `.dsh/starter/` 是**模板底座**，不要改。要定制请在生成出来的项目里改。
- `.dsh/skills/all-in-fde/` 是技能本体，可以改；改完跑 `node scripts/check-skills.mjs`。
- 中间产物写工作区根目录的 `.fde-tmp/`，由 `scripts/ensure-tmp.mjs` 建好并写进 `.git/info/exclude`，不进版本库。

## 省流与计费（token-budget / dsh-cost）——所有任务通用

本工作区自带计费技能。**不限于 all-in-fde**：任何实质性任务（编码、调研、写文档、分析），AI 都按下面的时机自动执行省流动作，不需要人敲命令。闲聊和单句问答除外。

| 时机 | AI 动作 |
| --- | --- |
| 任何实质性任务开工 | 跑 `node .dsh/skills/token-budget/scripts/plan.mjs --task "<用户原话>" --json`，按返回的 `effort`/`readStrategy` 执行；高峰时段把 `suggestDefer` 提示给用户一次，不代做决定 |
| 派子代理（subagent/fork/workflow 节点） | 先 `brief.mjs --goal ... --max-return 1500` 生成简报，用简报当 prompt，不发裸指令 |
| 要贴进对话的命令日志超 ~200 行 | 先 `squeeze.mjs <log> --level medium --out <log>.squeezed.log`，引用压缩版；**源代码与文档正文永不压缩** |
| all-in-fde 收尾 / 用户说"统计""看板""计费" | 跑 `stat.mjs`，present 生成的 dashboard.html |
| 新会话只说"统计" | token-budget 直接出看板，不走 all-in-fde |
| all-in-fde 票面有 `#task=` 标签 | Worker prompt 首行带上，供 verify 关联成本 |

红线：质量优先于省钱；脚本缺失或报错时注明一句然后继续，不因省流工具卡住正题。

**跨工作区生效**：在别的工作区开 FDE 主控 / 逐单 / 验收会话时，这些纪律同样适用于该会话的整个生命周期（含后续普通问答）——all-in-fde SKILL.md 已内嵌同样的触发规则。想在别的工作区的**任意**会话（非 all-in-fde）获得此纪律，建会话时选预设「FDE 预算」，或把本节复制到那个工作区的 AGENTS.md。

**首次使用需启动 watch**（增量同步会话日志，让看板实时）：

```bash
node tools/dsh-cost/bin/dsh-cost.mjs watch
```

watch 跑在后台，不阻塞。重启机器后需重新启动。状态检查：`node tools/dsh-cost/bin/dsh-cost.mjs status`。

**定价表维护**：`tools/dsh-cost/pricing.json` 是源文件，改完跑 `node .dsh/skills/token-budget/scripts/sync-vendor.mjs` 同步到 vendor。标 `_needVerify: true` 的单价是占位估算值，需从各平台控制台核实后覆盖。
