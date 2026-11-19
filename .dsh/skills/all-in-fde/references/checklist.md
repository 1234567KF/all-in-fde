# 门与证据（checklist）

技能自带的最小门禁手册。完整版在仓库的 `docs/证据schema与门禁ID对照.md`，但技能被单独安装时只认这一份。

## 四道阻断门

| 门 | 判什么 | 执行体 | 通过条件 |
| --- | --- | --- | --- |
| E0 环境 | 运行时、git、端口、依赖、磁盘、模板可达 | 脚本 | 六项全 PASS，或 SKIP 已写原因 |
| E5 实现 | 每票验收谓词有证据、数据断言不为零 | 脚本 + 复核 | 九项全 PASS |
| E6 人用 | 冷启动后真实后端能登录、核心旅程能走 | 人卡 + 脚本 | 十项全过，卡上无「有问题」 |
| E7 交付 | 干净目录可起、可回滚 | 脚本 | 六项全 PASS |

E1 收活、E2 切片、E3 起架、E4 契约只记录、不阻断。

## 31 条检查项

| 门 | 条目 |
| --- | --- |
| E0 | 1 运行时 / 2 git / 3 依赖可装 / 4 端口空闲 / 5 模板可达 / 6 磁盘与写权限 |
| E5 | 1 验收谓词逐条有证据 / 2 门禁全绿 / 3 测试静态检查 / 4 seam 预确认 / 5 反恒真断言 / 6 测行为不测实现 / 7 不变量负例 / 8 范围核对 / 9 独立复核 |
| E6 | 1 删库重置 / 2 后端冷启动 / 3 前端启动 / 4 逐角色登录 / 5 禁用与改密 / 6 核心旅程 / 7 异常分支 / 8 控制台无 A 类错 / 9 验收卡 / 10 E2E 真实模式 |
| E7 | 1 干净目录 / 2 按 README 装与起 / 3 冒烟 / 4 回滚 / 5 内网坐标扫描 / 6 已知问题登记 |

ID 形如 `E5-3`。发布后不复用；删项留空号。

## 证据文件

一条门一个文件，放 `.fde/evidence/`：`E0-<日期>.json`、`E5-<票号>.json`、`E6-<卡号>.json`、`E7-<日期>.json`。

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

## 聚合规则

- 缺项 = 该门不过（脚本按 ID 全集比对）；
- 门 `mode=PASS` 但有条目 FAIL = 证据无效；
- 除 E0-5 外，SKIP 不算通过；
- 校验脚本：`scripts/verify-evidence.mjs <证据目录>`，退出 0 才算过。

## 验收卡

E6-9 的卡：3–5 项，每项指到可打开的东西（文件行号、页面路由、截图、测试名），其中固定一项「抽 1–2 笔数据手工验算」。卡的结果由卡片工具落盘，不手写。
