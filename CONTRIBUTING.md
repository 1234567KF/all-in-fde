# 贡献指南

## 目录约定

- 一个技能一个目录，目录名等于 `SKILL.md` frontmatter 里的 `name`，用 kebab-case。
- 必需文件：`SKILL.md`、`META.json`、`PROVENANCE.md`、`CHANGELOG.md`。
- 可选目录：`references/`、`scripts/`、`assets/`、`templates/`。
- 不提交 `node_modules/`、`dist/`、`output/`、日志和本地配置。已在 `.gitignore` 里列出。

完整的文件职责和字段定义见 [docs/skill-spec.md](docs/skill-spec.md)。

## 提交信息

采用 Conventional Commits，scope 写技能名：

```text
feat(ppt-master): 归档 6.9.0 快照
fix(html-ppt): 修正 SKILL.md 的触发词拼写
docs(repo): 补充发布检查清单
chore(skills): 同步 skills.json
```

- `feat` 新增技能或技能能力
- `fix` 修正错误
- `docs` 只改文档
- `chore` 清单、脚本、格式类改动

一个提交只做一件事。升级第三方技能时单独一个提交，并在正文写清上游版本或 commit。

## 版本号

语义化版本，每个技能独立计算：

- MAJOR：触发词、输入输出约定、目录结构发生不兼容变化
- MINOR：新增能力，旧用法仍然可用
- PATCH：文字修正、脚本修 bug、依赖补丁

`META.json` 的 `version` 是唯一真源，`CHANGELOG.md` 顶部的版本号必须与它一致，`SKILL.md` 若写了 `metadata.version` 也要一致。校验脚本会检查这三处。

规则细节见 [docs/versioning.md](docs/versioning.md)。

## 提交前自检

```powershell
node scripts/check-skills.mjs
node scripts/sync-index.mjs
git status --short
```

`check-skills.mjs` 报错时不要提交。缺许可证记为警告，标记 `redistributable: true` 却没有许可证才是错误；两类情况都记在 [NOTICE.md](NOTICE.md)。
