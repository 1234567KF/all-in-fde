# 来源与导入说明

## 上游

- 仓库：[DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)
- 版本：`5.3.3`（`package.json`）
- 许可证：MIT（见本目录 `LICENSE`，版权归 DietrichGebert）
- 正文来源文件：`.openclaw/skills/ponytail/SKILL.md`（该仓库为多宿主生成的单技能形态）

## 导入范围

只导入主技能 `ponytail` 一份。上游另有五个命令技能（`ponytail-review`、`ponytail-audit`、`ponytail-debt`、`ponytail-gain`、`ponytail-help`）与 always-on 规则注入、跨宿主 hooks，全部未导入——本仓库只需要「写代码时更省」这一条，多导会把技能数量和常驻成本一起抬起来。

## 导入时做过的改动

1. `description` 从英文改成中文触发描述，加了触发词（写代码、实现功能、重构、精简这段）。正文逐字未动。
2. 新增 `references/fde-usage.md`（本仓库自写）：在 all-in-fde 里的触发位置、档位选择、与门禁的优先级。
3. 新增 `META.json`、`PROVENANCE.md`、`CHANGELOG.md` 三份旁注文件。

## 同步与恢复

重新拉取上游正文（会覆盖正文，`description` 需按上面第 1 条再改一次）：

```bash
curl -L https://raw.githubusercontent.com/DietrichGebert/ponytail/main/.openclaw/skills/ponytail/SKILL.md -o skills/ponytail/SKILL.md
```

上游升级后需同步：`META.json` 的 `version` 与 `upstream.version`、`CHANGELOG.md` 顶部版本、`references/fde-usage.md`（若规则章节变了）。

## 中文参考

[yangqingwang/agent-skills-zh](https://github.com/yanqingwang/agent-skills-zh) 有社区中文翻译（非上游官方）。本仓库未采用译文，理由：译文会落后上游版本，且与 `PROVENANCE.md` 的逐字还原要求冲突；如需中文正文，以该译文为参考、在本目录另开分支维护，不要直接覆盖 `SKILL.md`。
