# PRD 分卷清单（index.md 模板）

> 本文件是 `.fde/prd/index.md` 的模板。分卷模式下必须有此文件。
> 章节结构遵循 `assets/prd-template.md` 的 10 章 + 2 附录稳定结构。

## 文档定位

- **SSOT 声明**：PRD 是业务事实的唯一真源。原型是 PRD 的可视化辅助，冲突时以 PRD 为准。工程约束归 AGENTS.md / DESIGN.md。
- **裁决优先级**：采集表审定版 > PRD > 原型 > spec
- **MECE 保证**：采集表 S0–S15 每张表在 PRD 中有且仅有一个主落点（映射表见 `assets/prd-template.md`「MECE 保证」节）

## 章节清单

| 文件 | PRD 章节 | 内容 | 采集表主源 | 版本 | 状态 | sealed_at | sealed_by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `00-decisions.md` | §0 + §1 + §9 | 信息优先级 + 核心决议 + 概述 + 非功能约束 | S0/S1/S2 + S10/S12 | 1.0 | draft | — | — |
| `01-roles.md` | §2 | 角色矩阵、隔离规则、页面权限、账号规则 | S3/S4 | 1.0 | draft | — | — |
| `02-flows.md` | §3 | 主链/旁路/状态机 | S5/S6 | 1.0 | draft | — | — |
| `03-ia-pages.md` | §4 | 全局导航、页面 ID 总表、跨端交互规范 | S7 页头 | 1.0 | draft | — | — |
| `08-rules.md` | §7 | 跨页面跨角色硬规则（判定、门控、计算方式） | S6/S11 | 1.0 | draft | — | — |
| `09-acceptance.md` | §8 | AC 全集 | S11 | 1.0 | draft | — | — |
| `10-delivery-openitems.md` | §10 | 里程碑 + 上线准备 + HOLD/待确认台账 + 决议追踪 + 覆盖核对 | S13/S14/S15 | 1.0 | draft | — | — |
| `<端>-<域>.md` | §5 + §6 | 纵切卷：功能规格 + 接口规格（按端×域拆） | S7/S8/S9 + S10 | 1.0 | draft | — | — |
| `glossary.md` | 附录 B | 术语表（可选，也可并入 spec/glossary.md） | S2 | 1.0 | draft | — | — |

> **保留字**：`index`、`decisions`、`roles`、`flows`、`ia-pages`、`rules`、`acceptance`、`delivery-openitems`、`glossary` 不得用作纵切卷名。
> **纵切卷命名**：`<端>-<域>.md`，kebab-case。端 = web/h5/app/admin；域 = 业务域英文标识。某端×域内容 > 500 行时拆卷。

## 编号追溯矩阵（附录 A，附于此文件或独立）

| 编号家族 | 采集表 Sheet | PRD 章节 | spec 文件 | 说明 |
| --- | --- | --- | --- | --- |
| REQ- | S1/S7 | §1/§5 | spec/<module>.md §1 | 需求条目 |
| AC- | S11 | §8 | spec/<module>.md §5 | 验收标准 |
| BR- | S6/S7/S11 | §7 | spec/<module>.md §1 | 业务规则 |
| R- | S3 | §2 | spec/<module>.md 元信息 | 角色 |
| PG- | S7 | §4/§5 | spec/<module>.md §4 | 页面 |
| FLD- | S8 | §5 | spec/data-model.md | 字段 |
| ENT- | S9 | §5 | spec/data-model.md | 实体 |
| ST- | S6 | §3 | spec/<module>.md §1 | 状态/步骤 |
| CON- | S10 | §9 | AGENTS.md / spec | 约束 |
| TERM- | S2 | §1/附录B | spec/glossary.md | 术语 |
| HOLD- | S13/S14 | §10 | index.md | 挂起项 |
| D- | S14 | §10 | — | 决议 |
| IN- | S0 | §1 | — | 输入原文 |

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
