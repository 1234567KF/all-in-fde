# 来源说明

## 基本信息

| 项 | 内容 |
| --- | --- |
| 技能名 | `ppt-master` |
| 版本 | 6.9.0 |
| 上游 | https://github.com/hugohe3/ppt-master |
| 上游版本 | 6.9.0 |
| 导入日期 | 2026-11-18 |
| 导入来源 | `D:\all-in-fde\.dsh\skills\ppt-master` |

作者：Hugo He。版本号取自 `SKILL.md` frontmatter 的 `metadata.version`，与 `metadata.official_repository` 指向的上游一致。

## 导入范围

完整保留 13214 个文件：

| 目录 | 文件数 | 体积 |
| --- | --- | --- |
| `templates/` | 12450 | 约 24 MB |
| `scripts/` | 570 | 约 14 MB |
| `references/` | 165 | 约 3 MB |
| `workflows/` | 23 | 约 0.3 MB |

另有 `SKILL.md`、`LICENSE`、`README`、`SPONSORS.md`、`SPONSORS_CN.md`、`requirements.txt`、`.env.example`。

## 与上游的差异

技能内容未改动，只新增了本仓库的旁注文件。

## 许可证

MIT，版权 2025-2026 Hugo He，全文见 `skills/ppt-master/LICENSE`。再分发时保留许可证与版权声明。

## 恢复命令

Python 依赖：

```powershell
cd skills/ppt-master
pip install -r requirements.txt
```

`.env.example` 是上游给的配置样例，复制成 `.env` 后填自己的值；`.env` 已在 `.gitignore` 中排除。
