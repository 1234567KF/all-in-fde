# Spec：<模块中文名>（<module>）

## 元信息

- PRD 来源：§x.y / §x.z
- prd_refs: [§x.y, §x.z]
- REQ：REQ-X01, REQ-X02
- AC：AC-X01, AC-X02, AC-X03
- BR：BR-X01
- 依赖模块：（列出本模块依赖的其他模块）
- status: draft | sealed

## 1. 业务规则

（从 PRD 派生，细化到可实现粒度；含状态机、不变量、边界条件）

## 2. 数据契约

（Zod schema 草案、字段约束、枚举值；与 packages/shared 对齐）
（详细逐列定义见 spec/data-model.md，本节只列摘要）

## 3. 接口契约

（路由、请求/响应 schema、错误码；与 apps/api 对齐）
（全量路由汇总见 spec/api-map.md，本节只列本模块新增）

## 4. 页面与交互

> **UI 事实源裁决**：
> - 业务展示口径 = S7 原文投影（采集表审定版为准）
> - 视觉与组件形态 = 脚手架 DESIGN.md + packages/ui
> - 冲突时：前者赢业务语义，后者赢呈现形式

（页面 ID、组件树、表单校验规则；与 apps/web 对齐）

## 5. 验收谓词

（从 PRD AC- 派生，每条含 Given/When/Then + 数据断言）

| AC 编号 | Given | When | Then | 数据断言 |
| --- | --- | --- | --- | --- |
| AC-X01 | … | … | … | … |

## 6. 技术备注

（实现约束、性能要求、与现有模块的集成点）
