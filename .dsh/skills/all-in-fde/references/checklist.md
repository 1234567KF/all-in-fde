# 门与证据（checklist）

技能自带的最小门禁手册。完整版在仓库的 `docs/证据schema与门禁ID对照.md`，但技能被单独安装时只认这一份。

## 四道阻断门

| 门 | 判什么 | 执行体 | 通过条件 |
| --- | --- | --- | --- |
| E0 环境 | 运行时、git、端口、依赖、磁盘、模板可达 | 脚本 | 六项全 PASS，或 SKIP 已写原因 |
| E5 实现 | 每票验收谓词有证据、数据断言不为零 | 脚本 + 复核 | 九项全 PASS |
| E6 人用 | 冷启动后真实后端能登录、核心旅程能走 | 人卡 + 脚本 | 十项全过，卡上无「有问题」 |
| E7 交付 | 干净目录可起、可回滚 | 脚本 | 六项全 PASS |

E1 收活、E2 切片、E3 起架、E4 契约只记录、不阻断。其中 **E3 的证据必须含 `starter`（`name@ref`）或 `skipped` 加原因**——两者都没有，E3 判红，用来挡住「静默自建脚手架」。

## 31 条检查项

| 门 | 条目 |
| --- | --- |
| E0 | 1 运行时 / 2 git / 3 依赖可装 / 4 端口空闲 / 5 脚手架可达 / 6 磁盘与写权限 |
| E5 | 1 验收谓词逐条有证据 / 2 门禁全绿 / 3 测试静态检查 / 4 seam 预确认 / 5 反恒真断言 / 6 测行为不测实现 / 7 不变量负例 / 8 范围核对 / 9 独立复核 |
| E6 | 1 删库重置 / 2 后端冷启动 / 3 前端启动 / 4 逐角色登录 / 5 禁用与改密 / 6 核心旅程 / 7 异常分支 / 8 控制台无 A 类错 / 9 验收卡 / 10 E2E 真实模式 |
| E7 | 1 干净目录 / 2 按 README 装与起 / 3 冒烟 / 4 回滚 / 5 内网坐标扫描 / 6 已知问题登记 |

ID 形如 `E5-3`。发布后不复用；删项留空号。

## 证据文件

一条门一个文件（同一 `gate + target` 只保留一份，重跑**覆盖同名文件**或升 `revision` 并写 `supersedes`），放 `.fde/evidence/`：`E0-<日期>.json`、`E5-<票号>.json`、`E6-<卡号>.json`、`E7-<日期>.json`。

最小字段：

```json
{
  "schema": "fde.evidence/v1",
  "gate": "E5",
  "target": "W1-T03",
  "revision": 1,
  "supersedes": null,
  "mode": "PASS",
  "by": { "kind": "script", "id": "bun run check" },
  "started_at": "2026-11-18T10:25:00+08:00",
  "finished_at": "2026-11-18T10:31:00+08:00",
  "cmd": "bun run check",
  "exit": 0,
  "artifact": ["reports/check.log"],
  "summary": "五道门禁全绿，312 测试通过",
  "items": [{ "id": "E5-2", "mode": "PASS", "observed": "exit 0", "evidence": ["reports/check.log"] }],
  "signature": null
}
```

- `by.kind=script` 必须有 `cmd` 与 `exit`；`by.kind=card|human` 必须有 `signature`。
- `mode` 三态：PASS / FAIL / SKIP。
- 证据只能由脚本或卡片工具写出，agent 只读。

### 合法性硬约束（v0.4.0 新增）

1. **E6-9 只能由验收卡产出**：`by.kind` 必须是 `card`/`human`，且带 `signature.by`。脚本产出的 E6 里 E6-9 只能是 `SKIP`（待人点选）或 `FAIL`；判 `PASS` 一律无效。注意连带效应：冷启动脚本证据里 E6-9 是 `SKIP`，所以它的门级 `mode` 必须是 `FAIL`，等人点选后由卡片证据转 PASS。
2. **一条门一个文件**：同一 `gate+target` 出现两份 `revision` 相同的证据 = 重复证据。交付前 `node scripts/verify-evidence.mjs --strict` 必须过。
3. **E5-2 的 check 日志必须在 20 分钟内**：引用昨天的全绿日志给今天的票背书不算证据；日志文件 mtime 与 `started_at` 相差超过 20 分钟即判 E5-2 无效（`verify-evidence.mjs` 会核对，`--strict` 下报错；找不到日志文件同样报错）。
4. **E5-9 必须先复核、后出证据**：独立复核结论要落在文件里（如 `.fde/evidence/qa-review-<阶段>.md`），E5-9 的 `evidence` 指向该文件；先出证据、后补复核的，视为顺序无效。`--strict` 下 E5-9 的 `evidence` 至少要有一个路径真实存在，否则报「复核记录不存在」；复核文件的 mtime 若晚于证据的 `finished_at`（容差 1 分钟），报「先复核、后出证据」。

## 换栈 / 换目录 / 换进程模型

v1 → v2 这类「大动作」（换脚手架、换目录、换端口模型）会复用同一套门。为了不让证据混在一起：

- 新阶段证据文件名带阶段前缀：`E5-v2-code.json`、`E6-v2-01.json`；
- 每个新文件写 `supersedes: {"stage": "v1", "note": "换脚手架重建"}`；
- 旧阶段证据不要删，留在目录里（校验器按 `target` 分组，不会互相覆盖）。

## 聚合规则

- 缺项 = 该门不过（脚本按 ID 全集比对）；
- 门 `mode=PASS` 但有条目 FAIL = 证据无效；
- 除 E0-5 外，SKIP 不算通过；
- 校验脚本：`node scripts/verify-evidence.mjs <证据目录> [--strict]`，退出 0 才算过。

## 验收卡

E6-9 的卡：3–5 项，每项指到可打开的东西（文件行号、页面路由、截图、测试名），其中固定一项「抽 1–2 笔数据手工验算」。

卡片由人填，**只能经 `scripts/card-evidence.mjs` 落盘**：

```bash
node scripts/card-evidence.mjs \
  --card .fde/cards/E6-01.md \
  --from .fde/evidence/E6-coldstart.json \
  --by "张三"
```

- 任一项未点选 → 脚本拒绝封卡（退出 1），E6 保持人未验收；
- 任一项「有问题」→ 写出 FAIL 证据并列出问题；
- 其余九项只能来自 `--from` 的脚本证据，卡片不许编造。

**E6 的最终状态以 `E6-<卡号>.json`（`by.kind=card`）为准**；`E6-<脚本>.json` 是它的输入，保留作 artifact，两者 `target` 不同、不互相覆盖。

**对外汇报逐门报状态**（如「E0 PASS / E5 PASS / E6 FAIL（待人点选）/ E7 PASS」），不写「四门全绿」这种总括词。
