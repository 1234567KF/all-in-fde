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
