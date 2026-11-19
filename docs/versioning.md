# 版本策略

## 两层版本号

| 层级 | 位置 | 用途 |
| --- | --- | --- |
| 仓库版本 | `CHANGELOG.md` 顶部、git tag `v0.1.0` | 技能库本身：规范、脚本、归档动作 |
| 技能版本 | `.dsh/skills/<name>/META.json` 的 `version` | 单个技能：行为、触发词、目录结构 |

两者独立。仓库升到 `v0.2.0` 不代表每个技能都变，某个技能升到 `2.0.0` 也不要求仓库跟着升。

## 技能版本怎么定

- **MAJOR**：不兼容变化。触发词含义变了、输入输出约定变了、目录结构变了、依赖的运行环境升级了。
- **MINOR**：新增能力。加了新模板、新脚本、新可选参数，旧用法仍然有效。
- **PATCH**：文字修正、脚本修 bug、依赖补丁、格式调整。

导入第三方技能时，能拿到上游版本号就用上游版本（例如 `ppt-master` 6.9.0、`dashi-ppt` 0.4.14）。上游没写版本，从 `0.1.0` 起算，并在 `META.json` 的 `upstream.version` 留空。

## 三处版本必须一致

1. `META.json` 的 `version`
2. `CHANGELOG.md` 顶部最新一条 `## [x.y.z] - YYYY-MM-DD`
3. `SKILL.md` 的 `metadata.version`（如果写了）

`scripts/check-skills.mjs` 会校验这三处，不一致时报错。

## CHANGELOG 写法

顶部加新条目，不要改历史条目：

```markdown
## [0.2.0] - 2026-11-20

### Added
- 新增 `templates/report/`，支持季度汇报版式。

### Changed
- 触发词增加「季度汇报」。

### Fixed
- 修正 `scripts/render.mjs` 在路径含空格时的报错。
```

分类只用 `Added`、`Changed`、`Deprecated`、`Removed`、`Fixed`、`Security`。空分类删掉，不要留标题。

## Git 标签

| 场景 | 标签格式 | 例子 |
| --- | --- | --- |
| 仓库发布 | `v<仓库版本>` | `v0.1.0` |
| 单个技能发布 | `skills/<name>/v<技能版本>` | `skills/ppt-master/v6.9.0` |

打标签前确认工作区干净、`check-skills.mjs` 通过、`skills.json` 已同步。

```powershell
git tag -a "skills/ppt-master/v6.9.0" -m "ppt-master 6.9.0"
git tag -n
```

## 同步上游

1. 拿上游版本号和 commit。
2. 覆盖对应目录（保留 `META.json`、`PROVENANCE.md`、`CHANGELOG.md`）。
3. 更新 `META.json` 的 `version`、`upstream.version`、`upstream.commit`、`importedAt`、`importedFrom`。
4. 在 `CHANGELOG.md` 顶部记一条，写明上游版本和本次删改。
5. 跑校验脚本，单独提交：`feat(<skill>): 同步上游 x.y.z`。
