# dsh-cost

DSH 会话的精准计费与 A/B 验证工具。直接读 `~/.dsh/sessions/**/session.v4.jsonl.zstd`，不依赖 DSH 插件、不联网、不改会话。

## 它回答四个问题

1. 这次任务花了多少钱（分输入未命中 / 输入命中 / 输出 / 生图）。
2. 时间花在哪（轮、步、LLM、工具、子代理）。
3. 缓存命中没有、命中率多少、缓存到底省了多少钱。
4. 用了某个技能/脚本后，是否**净**节省，而不是只省了 token。

## 快速开始

```powershell
# 1. 增量同步（可反复跑，只读新增/变化的会话）
node D:\all-in-fde\tools\dsh-cost\bin\dsh-cost.mjs sync

# 2. 总账
node D:\all-in-fde\tools\dsh-cost\bin\dsh-cost.mjs report

# 3. 单会话逐轮
node D:\all-in-fde\tools\dsh-cost\bin\dsh-cost.mjs session a244ad2e

# 4. 子代理成本树 / 技能成本 / 任务账本
node D:\all-in-fde\tools\dsh-cost\bin\dsh-cost.mjs tree
node D:\all-in-fde\tools\dsh-cost\bin\dsh-cost.mjs skills
node D:\all-in-fde\tools\dsh-cost\bin\dsh-cost.mjs tasks
```

输出都是 Markdown，直接贴文档或转 PPT。加 `--out 文件.md` 存盘。

## 自动运行（可选）

计费数据本来就在会话日志里，**不跑也不会丢**；`watch` 只是让报表随时是最新的。

登录 Windows 后自动在后台同步（当前用户，无需管理员）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\all-in-fde\tools\dsh-cost\scripts\install-autostart.ps1"
```

它注册计划任务 `DSH-Cost-Watch`：登录 30 秒后启动，每 60 秒增量同步一次，文件变化后 3 秒再补一次。

```powershell
# 看最近一次同步时间和结果
node D:\all-in-fde\tools\dsh-cost\bin\dsh-cost.mjs status

# 移除自启（不删账本）
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\all-in-fde\tools\dsh-cost\scripts\uninstall-autostart.ps1"
```

开销：每轮只 stat 30 个会话文件、解压变化的那个，约 0.1 秒；不调用模型，不产生 token。

> 它跟着 Windows 登录启动，不跟 DSH 进程绑定。DSH 没开时它只是空转；想做到“DSH 一启动就计费”，需要在 DSH 里写插件，另说。


## 数据从哪来

| 事实 | 会话日志字段 |
| --- | --- |
| 每次模型调用的精确用量 | `assistant/message.data.usage`：`inputTokens`（未命中）、`cacheReadTokens`（命中）、`cacheWriteTokens`、`outputTokens` |
| 调用属于哪个 provider/模型 | `assistant/message.data.message.source.{provider,model}` |
| 单步耗时 | `step/start` / `step/end` |
| 单轮边界与用户提示词 | `turn/start` / `turn/end` / `user/message` |
| 工具耗时 | `tool/call` / `tool/result` |
| 压缩调用（独立计费） | `compaction/summary.data.usage` |
| 子代理归属 | 子会话头的 `parentSession` + 父会话的 `subagent/catalog` |
| 子代理标签 | 子会话 `subagent/descriptor.data.label` |

`inputTokens` 是**未命中**部分，`cacheReadTokens` 是**命中**部分，两者相加才是完整输入。不要用 `totalTokens` 直接乘单价。

## 价格表

`pricing.json`，v2 结构：

- 按 `provider/model` 精确匹配，其次 `*/model` 通配，最后按 provider 的 `aliases`。
- 每条价格带 `currency`（CNY/USD），报表按 `fx` 折算成 `displayCurrency`。
- `peak` / `idle` 两个档；不分时段的 provider 把两者写成相同值。
- `tiers` 支持按输入 token 阶梯（如 MiniMax-M3 超过 512k 翻倍）。
- `media` 段按张/按次/按分辨率计价。

改价只改 `pricing.json`，历史 token 数不变，金额按新价重算。

## 归因规则

| 维度 | 规则 |
| --- | --- |
| 会话 | 每次调用只归到它自己的会话；子代理单独成会话 |
| 轮 | `turn` 号；任务标签在提示词里，**一旦出现后续轮次继承** |
| 任务 | `#task=doc-01`，可加 `#arm=A`、`#run=3` |
| 技能 | 两个口径：`生效期间`（最近加载的技能到下一个技能之前）与 `调用轮`（真正执行了 `skill` 工具的轮次） |
| 子代理 | 子会话总成本（含孙代理）加到父会话中发起它的那一轮 |
| 压缩 | 加到发起压缩的那一轮 |

## A/B 验证

```powershell
# 同一任务跑两组，提示词里带标签（标签会继承，后续轮次不用重复写）
# 基线： #task=doc-01 #arm=A #run=1
# 候选： #task=doc-01 #arm=B #run=1

node D:\all-in-fde\tools\dsh-cost\bin\dsh-cost.mjs compare --task doc-01 --base A --cand B
node D:\all-in-fde\tools\dsh-cost\bin\dsh-cost.mjs compare --task doc-01 --judgments bench\judgments.json
```

判定规则（写死在 `src/ab.mjs`）：

- 至少 4 对；8 对以上才比较稳。
- 配对节省 ≥10%，且 bootstrap 95% CI 下界 > 0，才算“证据支持”。
- 提供 `judgments.json` 时，候选合格率低于基线 → 判为“省了 token 但质量下降”，不算节省。

## 数据位置

- 从仓库 `tools/dsh-cost` 直接跑：数据在 `tools/dsh-cost/data`、报表在 `tools/dsh-cost/reports`。
- 安装到 `~/.dsh/dsh-cost` 后：数据在 `~/.dsh/dsh-cost/data`、报表在 `~/.dsh/dsh-cost/reports`。
- 两种情况都可用 `--data DIR` 覆盖；`token-budget` 会自动解析到已安装目录。

## 重置计费

清空账本和报表，从当前会话开始重新计。会话日志本身不动，只是不再纳入统计。

```powershell
# 先看会删什么、起点是哪
node D:\all-in-fde\tools\dsh-cost\bin\dsh-cost.mjs reset --dry-run

# 从当前会话开始（含本会话已产生的调用）
node D:\all-in-fde\tools\dsh-cost\bin\dsh-cost.mjs reset

# 从指定时刻开始（此刻归零，本会话此前的调用也不计）
node D:\all-in-fde\tools\dsh-cost\bin\dsh-cost.mjs reset --at now
node D:\all-in-fde\tools\dsh-cost\bin\dsh-cost.mjs reset --at 2026-11-18T12:00:00+08:00
```

`reset` 会：

1. 删除 `data/sessions`、`data/index.json`、`data/media.jsonl`、`data/squeeze`、`data/watch*.json/log` 和 `reports/`；
2. 写 `data/epoch.json` 作为计费起点；
3. 只同步当前会话及其子代理，范围外的账本文件会被清理。

之后所有报表、`compare`、`token-budget verify` 都会自动按 `epoch.json` 过滤。想恢复全量历史，删除 `data/epoch.json` 再 `sync --force` 即可。

## 已知边界

- 标题生成、联网搜索、失败重试的请求没有 usage，只在报表“未计入”里计数。
- 生图/视频/语音不是 LLM 调用，不进会话日志；用 `media add` 记录（见下）。
- 子代理是独立会话，看单会话金额时用 `tree` 的合计，别把父子相加两次。
- 会话被中断/恢复时，工具耗时按所在步封顶，避免把挂机时间算成工具时间。

## 生图/视频记账

```powershell
node ...\dsh-cost.mjs media add --provider minimax-cn --model h3-image --variant 4k --qty 2 --amount 0.36 --task ppt-01
node ...\dsh-cost.mjs media
```

`--amount` 是本次实际扣费；不传则按 `pricing.json` 的 `media` 单价 × 数量。单价为空时报表会显示“待填”，不会瞎猜。
