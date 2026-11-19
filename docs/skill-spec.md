# 技能目录规范

## 目录名

`.dsh/skills/<name>/`，`<name>` 与 `SKILL.md` frontmatter 的 `name` 完全一致，只用小写字母、数字和连字符。

## 文件职责

| 文件 | 谁维护 | 作用 |
| --- | --- | --- |
| `SKILL.md` | 技能作者 | 技能正文和触发说明，Agent 加载的入口 |
| `META.json` | 本仓库 | 版本、许可、上游等元数据，版本号的唯一真源 |
| `PROVENANCE.md` | 本仓库 | 来源、导入范围、导入时的删改、恢复命令 |
| `CHANGELOG.md` | 本仓库 | 该技能的变更记录，顶部版本必须等于 `META.json` |
| `README.md` | 技能作者（可选） | 给人看的说明，不影响 Agent 加载 |
| `LICENSE` | 上游或作者 | 技能本体的许可证，第三方技能必须保留 |
| `references/` `scripts/` `assets/` `templates/` | 技能作者（可选） | 引用资料、脚本、素材、模板 |

`META.json`、`PROVENANCE.md`、`CHANGELOG.md` 是本仓库加的旁注文件，不参与技能运行时。同步上游时不要用上游文件覆盖这三份。

## SKILL.md frontmatter

```yaml
---
name: example-skill
description: 一句话说明这个技能在什么情况下被加载。
metadata:
  version: "0.1.0"          # 可选，写了就必须与 META.json 一致
---
```

`name` 和 `description` 必填。`description` 要写触发条件，不要写功能广告。

目录名与 `SKILL.md` 的 `name` 不一致时（例如上游把技能命名为 `guizang-ppt-skill`，目录名按本仓库规则缩成 `guizang-ppt`），以目录名为准，并在 `META.json` 和 `PROVENANCE.md` 里写明差异；校验脚本对这种情况只报警告。

## META.json 字段

```json
{
  "name": "example-skill",
  "version": "0.1.0",
  "entry": "SKILL.md",
  "description": "一句话说明。",
  "license": "MIT",
  "redistributable": true,
  "upstream": {
    "url": "https://github.com/owner/repo",
    "version": "1.2.3",
    "commit": "可选，导入时的上游 commit"
  },
  "importedAt": "2026-11-18",
  "importedFrom": "导入时本机路径"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 与目录名、`SKILL.md` 的 `name` 一致 |
| `version` | 是 | 语义化版本 `MAJOR.MINOR.PATCH` |
| `entry` | 是 | 入口文件名，通常是 `SKILL.md` |
| `description` | 是 | 一句话说明，与 `SKILL.md` 的 `description` 同源 |
| `license` | 是 | SPDX 标识，如 `MIT`、`AGPL-3.0`；没有许可证写 `UNLICENSED` |
| `redistributable` | 是 | 能否随仓库公开分发 |
| `upstream` | 否 | 上游地址与版本，自研技能写 `null` |
| `importedAt` | 否 | 导入日期 `YYYY-MM-DD` |
| `importedFrom` | 否 | 导入时的本机源路径 |

## 仓库级文件

- `skills.json`：由 `scripts/sync-index.mjs` 生成，位于仓库根，不要手改。记录每个技能的文件数、字节数和内容指纹，用来发现未登记的改动。
- `SKILLS.md`：技能索引，人工维护的表格。

## 禁止事项

- 不提交 `node_modules/`、`dist/`、`output/`、`uploads/`、日志。
- 不提交密钥、令牌、带签名的 URL、内网地址。
- 单个文件不超过 50 MB，仓库总量控制在 100 MB 以内。
- `SKILL.md` 和脚本里不写死本机绝对路径，用技能根目录相对路径。
- 不把上游技能的内容改写成“自己的”，来源必须写进 `PROVENANCE.md`。
