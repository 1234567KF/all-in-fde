# PRD 分卷清单（index.md 模板）

> 本文件是 `.fde/prd/index.md` 的模板。分卷模式下必须有此文件。

## 文档定位

- **SSOT 声明**：PRD 是业务事实的唯一真源。原型是 PRD 的可视化辅助，冲突时以 PRD 为准。工程约束归 AGENTS.md / DESIGN.md。
- **裁决优先级**：采集表审定版 > PRD > 原型 > spec

## 章节清单

| 文件 | 内容 | 版本 | 状态 | sealed_at | sealed_by |
| --- | --- | --- | --- | --- | --- |
| `00-decisions.md` | 核心决议 + 范围边界 + SSOT 声明 | 1.0 | draft | — | — |
| `01-roles.md` | 角色矩阵、隔离规则 | 1.0 | draft | — | — |
| `02-flows.md` | 主链/旁路/状态机 | 1.0 | draft | — | — |
| `03-ia-pages.md` | 全局导航、页面 ID 总表 | 1.0 | draft | — | — |
| `08-rules.md` | 跨页面跨角色硬规则 | 1.0 | draft | — | — |
| `09-acceptance.md` | AC 全集 | 1.0 | draft | — | — |
| `10-delivery-openitems.md` | 里程碑 + HOLD 台账 | 1.0 | draft | — | — |
| `web-marketing.md` | （纵切卷示例）Web 端营销域 | 1.0 | draft | — | — |

## 挂起项台账

| 编号 | 描述 | 提出人 | 提出日期 | 状态 | 决议 |
| --- | --- | --- | --- | --- | --- |
| HOLD-01 | … | … | … | OPEN / RESOLVED | … |

## 元信息

```yaml
version: "1.0"
status: draft | review | sealed
sealed_at: null | "2026-11-20T10:00:00+08:00"
sealed_by: "张三"
source: "采集表 v1.0，审定日期 2026-11-19"
ssot: "PRD > 原型；工程约束归 AGENTS.md / DESIGN.md"
```
