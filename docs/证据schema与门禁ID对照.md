# 证据文件 schema 与门禁 ID 对照 v0.1

> 配套《all-in-fde 方案 v0.3》§5.1 与[四道阻断门检查清单](./四道阻断门检查清单.md)。
>
> 这份文件定三件事：**31 条检查项的 ID**、**每条证据的形状**、**一道门怎么算过**。实现期照此写校验脚本，不再二次讨论字段名。

---

## 0 三条不可变的约定

1. **ID 一旦发布，不复用。** 删掉的项留空号，不重编——否则历史证据会指向另一件事。
2. **证据是历史，不是状态。** 重跑产生新文件，不覆盖旧文件；新文件用 `supersedes` 指向上一次。
3. **证据只能由脚本或卡片工具写出。** agent 只读。这条是 §2 P1 的硬补充，schema 里用 `by.kind` 留痕，独立复核时先看这一项。

---

## 1 ID 命名

`E{门号}-{序号}`，门号取 0、5、6、7，序号两位、从 1 起。

```text
E0-1 … E0-6    环境 6 项
E5-1 … E5-9    实现 9 项（每张票一套）
E6-1 … E6-10   人用 10 项（每次交付一套）
E7-1 … E7-6    交付 6 项
```

共 31 项。门号里的 1–4 是检查项（E1–E4），没有阻断证据文件，不在这里定义。

---

## 2 文件与目录

```text
.fde/evidence/
├── E0-2026-11-18T091500Z.json
├── E5-07-2026-11-18T103000Z.json
├── E6-01-2026-11-18T141000Z.json
└── E7-2026-11-18T160000Z.json
```

命名：`E{门号}-{对象}-{UTC 时间}.json`。

| 门 | 对象 | 例子 |
| --- | --- | --- |
| E0 | 无（同一天多次跑用时间区分） | `E0-2026-11-18T091500Z.json` |
| E5 | 票号 | `E5-07-2026-11-18T103000Z.json` |
| E6 | 验收卡号 | `E6-01-2026-11-18T141000Z.json` |
| E7 | 无 | `E7-2026-11-18T160000Z.json` |

文件名只用来排序与定位，**判定只读文件内容**——改名不影响结论，改内容会破坏 `supersedes` 链，复核时能看出来。

---

## 3 通用信封

```json
{
  "schema": "fde.evidence/v1",
  "gate": "E5",
  "target": "07",
  "revision": 2,
  "supersedes": "E5-07-2026-11-18T103000Z.json",
  "mode": "PASS",
  "by": { "kind": "script", "id": "bun run check" },
  "started_at": "2026-11-18T10:25:00+08:00",
  "finished_at": "2026-11-18T10:31:00+08:00",
  "cmd": "bun run check",
  "exit": 0,
  "artifact": ["reports/check-2026-11-18.log"],
  "summary": "typecheck/lint/arch/test/migrate 全绿，312 个测试通过",
  "items": [],
  "signature": null
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schema` | 是 | 固定 `fde.evidence/v1`，改结构时升版本，旧文件继续有效 |
| `gate` | 是 | `E0` / `E5` / `E6` / `E7` |
| `target` | 否 | E5 写票号，E6 写卡号；E0/E7 省略 |
| `revision` | 是 | 从 1 起，同一对象每重跑一次加 1 |
| `supersedes` | 否 | 上一份证据的文件名；首份为 `null` |
| `mode` | 是 | `PASS` / `FAIL` / `SKIP`，必须与 `items` 聚合结果一致 |
| `by` | 是 | `{"kind":"script"}` / `{"kind":"card"}` / `{"kind":"human"}` 三种，`id` 写执行者标识 |
| `started_at` / `finished_at` | 是 | ISO 8601，带时区 |
| `cmd` | 脚本必填 | 实际执行的命令，原样抄，不要润色 |
| `exit` | 脚本必填 | 原始退出码；不能把 1 写成 0 再补一句说明 |
| `artifact` | 否 | 产物路径数组，指向日志、截图、报告 |
| `summary` | 是 | ≤5 行，写「看到了什么」，不写「感觉没问题」 |
| `items` | 是 | 门内每一项的结论，见下节 |
| `signature` | 人卡/人工必填 | `{"by":"张三","at":"...","choice":"通过","note":""}` |

---

## 4 条目结构

```json
{
  "id": "E5-2",
  "mode": "PASS",
  "observed": "exit 0，312 个测试通过，0 skip",
  "evidence": ["reports/check-2026-11-18.log"],
  "note": ""
}
```

- `observed` 是一句可核对的事实，不是评价。
- `evidence` 是能打开的东西：日志路径、页面路由、截图、测试名。
- `note` 只在 SKIP 或 FAIL 时写：为什么跳过、差在哪。
- **同一文件里 `id` 不许重复**；缺项按 FAIL 处理，不按「没查」放过。

---

## 5 一道门怎么算过

| 门 | 通过条件 | SKIP 政策 |
| --- | --- | --- |
| E0 | E0-1…E0-6 全 PASS，或仅 E0-5 为 SKIP 且写明离线模板位置 | 仅 E0-5 允许 SKIP |
| E5 | E5-1…E5-9 全 PASS | 不允许 SKIP |
| E6 | E6-1…E6-10 全 PASS | 不允许 SKIP |
| E7 | E7-1…E7-6 全 PASS | 不允许 SKIP |

两条聚合规则：

- **缺项 = FAIL。** 校验脚本按 ID 全集比对，少一项就判该门不过——schema 表达不了「必须全在」，这一步由脚本做。
- **门 `mode` 与条目不一致 = 无效证据。** 宁可判无效，不要让人在信封上写 PASS 而条目里全是 FAIL。

### 5.1 附加硬约束（脚本执行，v0.4.0）

| 约束 | 判定 | 脚本 |
| --- | --- | --- |
| E6-9 只能由人产出 | `mode=PASS` 时 `by.kind` 必须是 `card`/`human` 且带 `signature.by`；`script` 产出的 E6-9 只能是 SKIP/FAIL | `verify-evidence.mjs` |
| 一条门一个文件 | 同 `gate+target` 出现两份相同 `revision` = 重复证据；交付前 `--strict` 报错 | `verify-evidence.mjs --strict` |
| E5-2 时效 | check 日志时间距 `started_at` ≤20 分钟 | 人工/脚本按 `checklist.md` 判 |
| E5-9 时序 | 复核记录文件必须先存在，E5-9 的 `evidence` 指向它 | `implement.md` 流程约束 |

### 5.2 换栈 / 换目录 / 换进程模型

复用同一套门，但证据按阶段分序列：文件名带阶段前缀（`E5-v2-code.json`），每份写 `supersedes: {"stage":"v1","note":"..."}`；旧阶段证据保留，不互相覆盖。

---

## 6 31 条对照表

「执行体」决定必填字段：`script` 要 `cmd` + `exit`；`card` 要 `signature.choice`；`human` 要 `signature` + `note`。

### E0 环境

| ID | 检查什么 | 执行体 | PASS 判据 |
| --- | --- | --- | --- |
| E0-1 | 运行时版本 | script | 两条版本命令退出 0 且落在支持区间 |
| E0-2 | git 可用、目录可 init | script | 退出 0 |
| E0-3 | 依赖可装（临时副本） | script | 安装退出 0，或失败信息可归因网络/权限 |
| E0-4 | 端口未被占用 | script | 探测显示空闲 |
| E0-5 | 模板仓库可达 | script | 5 秒内返回 |
| E0-6 | 磁盘与写权限 | script | 可写且剩余空间达标 |

### E5 实现（每张票）

| ID | 检查什么 | 执行体 | PASS 判据 |
| --- | --- | --- | --- |
| E5-1 | 验收谓词逐条有证据 | card | 3–5 条全有条目 |
| E5-2 | 门禁全绿 | script | `check` 退出 0，且日志时间距证据 `started_at` ≤20 分钟 |
| E5-3 | 测试静态检查 | script | 文件非空、接口存在、fixture 类型一致 |
| E5-4 | seam 预确认 | human | 每条测试标注边界与漏检说明 |
| E5-5 | 反恒真断言 | human | 期望值来源可指认 |
| E5-6 | 测行为不测实现 | human | 只经公开接口，mock 仅在外部边界 |
| E5-7 | 不变量负例 | script | 每条不变量至少一条负例 |
| E5-8 | 范围核对 | script | diff 未命中越界判据 |
| E5-9 | 独立复核 | human | 另一会话只读复核通过 |

### E6 人用（每次交付）

| ID | 检查什么 | 执行体 | PASS 判据 |
| --- | --- | --- | --- |
| E6-1 | 删库重置 | script | 库文件不存在或重置命令退出 0 |
| E6-2 | 后端冷启动 | script | 种子账号数等于预期 |
| E6-3 | 前端启动 | script | 端口与配置一致 |
| E6-4 | 逐角色登录 | card | 每个角色登录成功并落对页面 |
| E6-5 | 禁用与改密 | card | 拒绝与弹窗行为正确 |
| E6-6 | 核心旅程 | card | 主路径每步有可见结果 |
| E6-7 | 异常分支 | card | 403/409/空态/超长输入表现正确 |
| E6-8 | 控制台无 A 类报错 | human | Playwright `console`/`pageerror` 监听，A 类错误 0 条；截图或日志可查 |
| E6-9 | 验收卡无「有问题」 | card | 3–5 项全部通过，含一项数据手工验算；只能由 `card-evidence.mjs` 落盘并带 `signature.by` |
| E6-10 | E2E 真实模式 | script | 真实后端链路退出 0 |

### E7 交付

| ID | 检查什么 | 执行体 | PASS 判据 |
| --- | --- | --- | --- |
| E7-1 | 干净目录 | script | 目标目录不含依赖与数据库 |
| E7-2 | 按 README 装与起 | script | 复跑日志退出 0 |
| E7-3 | 冒烟 | script | 首页、登录、主路径通过 |
| E7-4 | 回滚 | script | 退回上一版能启动 |
| E7-5 | 内网坐标扫描 | script | 扫描器退 0（三态：0/1/2） |
| E7-6 | 已知问题登记 | human | 清单存在且含复现方式 |

---

## 7 JSON Schema（draft 2020-12）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "fde.evidence/v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema", "gate", "revision", "mode", "by", "started_at", "finished_at", "summary", "items"],
  "properties": {
    "schema": { "const": "fde.evidence/v1" },
    "gate": { "enum": ["E0", "E5", "E6", "E7"] },
    "target": { "type": "string", "pattern": "^[0-9A-Za-z-]+$" },
    "revision": { "type": "integer", "minimum": 1 },
    "supersedes": { "type": ["string", "null"] },
    "mode": { "enum": ["PASS", "FAIL", "SKIP"] },
    "by": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind", "id"],
      "properties": {
        "kind": { "enum": ["script", "card", "human"] },
        "id": { "type": "string", "minLength": 1, "maxLength": 120 }
      }
    },
    "started_at": { "type": "string", "format": "date-time" },
    "finished_at": { "type": "string", "format": "date-time" },
    "cmd": { "type": "string", "minLength": 1 },
    "exit": { "type": "integer" },
    "artifact": { "type": "array", "items": { "type": "string" }, "uniqueItems": true },
    "summary": { "type": "string", "minLength": 1, "maxLength": 600 },
    "signature": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "required": ["by", "at", "choice"],
      "properties": {
        "by": { "type": "string", "minLength": 1, "maxLength": 40 },
        "at": { "type": "string", "format": "date-time" },
        "choice": { "type": "string", "minLength": 1, "maxLength": 40 },
        "note": { "type": "string", "maxLength": 200 }
      }
    },
    "items": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "mode", "observed"],
        "properties": {
          "id": { "type": "string", "pattern": "^E(0-[1-6]|5-[1-9]|6-(?:[1-9]|10)|7-[1-6])$" },
          "mode": { "enum": ["PASS", "FAIL", "SKIP"] },
          "observed": { "type": "string", "minLength": 1, "maxLength": 300 },
          "evidence": { "type": "array", "items": { "type": "string" }, "uniqueItems": true },
          "note": { "type": "string", "maxLength": 300 }
        }
      }
    }
  },
  "allOf": [
    {
      "if": { "properties": { "by": { "properties": { "kind": { "const": "script" } } } } },
      "then": { "required": ["cmd", "exit"] }
    },
    {
      "if": { "properties": { "by": { "properties": { "kind": { "enum": ["card", "human"] } } } } },
      "then": { "required": ["signature"], "properties": { "signature": { "type": "object" } } }
    },
    {
      "if": { "properties": { "gate": { "const": "E0" } } },
      "then": { "properties": { "items": { "minItems": 6, "maxItems": 6 } } }
    },
    {
      "if": { "properties": { "gate": { "const": "E5" } } },
      "then": { "properties": { "items": { "minItems": 9, "maxItems": 9 }, "target": { "type": "string" } }, "required": ["target"] }
    },
    {
      "if": { "properties": { "gate": { "const": "E6" } } },
      "then": { "properties": { "items": { "minItems": 10, "maxItems": 10 }, "target": { "type": "string" } }, "required": ["target"] }
    },
    {
      "if": { "properties": { "gate": { "const": "E7" } } },
      "then": { "properties": { "items": { "minItems": 6, "maxItems": 6 } } }
    }
  ]
}
```

**schema 管形状，不管完整性。** 「E5 的九项必须恰好是 E5-1 到 E5-9」这种集合判断，JSON Schema 表达不了（`contains` 不能表达「全都包含一次」）。校验脚本要做三件事：schema 校验、按门取 ID 全集比对、聚合 `mode` 与条目是否一致。

---

## 8 三个例子

**PASS（脚本）**

```json
{
  "schema": "fde.evidence/v1", "gate": "E5", "target": "07", "revision": 1, "supersedes": null,
  "mode": "PASS",
  "by": { "kind": "script", "id": "bun run check" },
  "started_at": "2026-11-18T10:25:00+08:00", "finished_at": "2026-11-18T10:31:00+08:00",
  "cmd": "bun run check", "exit": 0,
  "artifact": ["reports/check-2026-11-18.log"],
  "summary": "五道门禁全绿，312 测试通过",
  "items": [
    { "id": "E5-2", "mode": "PASS", "observed": "exit 0，312 tests", "evidence": ["reports/check-2026-11-18.log"] }
  ],
  "signature": null
}
```

**FAIL（脚本）**

```json
{
  "schema": "fde.evidence/v1", "gate": "E7", "revision": 1, "supersedes": null,
  "mode": "FAIL",
  "by": { "kind": "script", "id": "e7-clean-run" },
  "started_at": "2026-11-18T16:00:00+08:00", "finished_at": "2026-11-18T16:04:00+08:00",
  "cmd": "e7-clean-run <target>", "exit": 1,
  "summary": "干净目录装依赖失败：README 缺 bun install 之前的 bun 版本要求",
  "items": [
    { "id": "E7-2", "mode": "FAIL", "observed": "step 2 退出 1", "evidence": ["logs/e7-1600.log"], "note": "README 未写 bun 版本前置" }
  ],
  "signature": null
}
```

**SKIP（人卡）**

```json
{
  "schema": "fde.evidence/v1", "gate": "E6", "target": "01", "revision": 1, "supersedes": null,
  "mode": "SKIP",
  "by": { "kind": "card", "id": "E6-01" },
  "started_at": "2026-11-18T14:00:00+08:00", "finished_at": "2026-11-18T14:02:00+08:00",
  "summary": "第 5 项「禁用账号」暂不可测：当前数据模型无 disabled 字段",
  "items": [
    { "id": "E6-5", "mode": "SKIP", "observed": "users 表无 disabled 字段", "note": "P0 前补字段或裁剪该条，二选一" }
  ],
  "signature": { "by": "张", "at": "2026-11-18T14:02:00+08:00", "choice": "跳过并登记", "note": "已记入已知问题" }
}
```

> 注意：E6 出现 SKIP 时整门不算过，进度停在 A5。SKIP 不是通关捷径，是给人看的分歧记录。

---

## 9 与检查清单的对应

| 检查清单 | 本文档 | 关系 |
| --- | --- | --- |
| 每道门的勾选项 | 每道门的 `items[].id` | 一一对应，清单改一项，schema 的 ID 集合跟着改 |
| 证据最小字段 | §3 信封 | 清单只说「要什么」，这里说「存成什么」 |
| 三态 PASS/FAIL/SKIP | `mode` 字段 | 同一套值，不另起名字 |
| 门禁维护规则 | §0 三条约定 | 删项留空号、重跑不覆盖 |

---

## 10 改这份文件要动几处

新增一条检查项，四处同步：

1. 检查清单加一条勾选项
2. 本文档 §6 对照表加一行
3. §7 schema 的 `id` 正则与门级 `minItems`
4. 校验脚本的 ID 全集

删一条检查项：清单、对照表、正则、全集都删，但**ID 留空号不重排**，并在 §6 标注「已废弃」。

改字段名：升 `schema` 版本到 `fde.evidence/v2`，旧文件继续有效（校验脚本按版本分派），不许原地改 `v1` 的含义。
