# 技能索引

一个技能一个目录，位于 `.dsh/skills/`。版本号以各目录的 `META.json` 为准，根目录的 `skills.json` 是脚本生成的机器可读副本。

| 技能 | 版本 | 许可证 | 上游 | 说明 |
| --- | --- | --- | --- | --- |
| [all-in-fde](.dsh/skills/all-in-fde/) | 0.1.0 | MIT | 自研 | 把一段需求推进到可验收的小型 IT 系统 |
| [ai-flavor-guard](.dsh/skills/ai-flavor-guard/) | 0.1.0 | 未声明 | 本地自研 | 控制中文文本的 AI 味词汇 |
| [token-budget](.dsh/skills/token-budget/) | 0.2.0 | MIT | 自研 | Token 预算：plan / brief / squeeze / verify |
| [ponytail](.dsh/skills/ponytail/) | 5.3.3 | MIT | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | 写代码时的最小完整改动，先复用再新写 |
| [rea-video](.dsh/skills/rea-video/) | 0.1.0 | Apache-2.0 | [JuneYaooo/rea-video](https://github.com/JuneYaooo/rea-video) | 逆向拆解视频：逐镜判断实拍 / AI / 代码渲染，拆声音与包装，给复刻方案 |
| [dashi-ppt](.dsh/skills/dashi-ppt/) | 0.4.14 | 未声明 | 本地安装包 | 预置主题的 HTML 演示，可导出 PPTX / PDF |
| [guizang-ppt](.dsh/skills/guizang-ppt/) | 0.1.0 | AGPL-3.0 | [op7418/guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill) | 单文件网页 PPT，两套视觉风格 |
| [html-ppt](.dsh/skills/html-ppt/) | 0.1.0 | MIT | [lewislulu/html-ppt-skill](https://github.com/lewislulu/html-ppt-skill) | 静态 HTML 演示，主题与版式可组合 |
| [ppt-master](.dsh/skills/ppt-master/) | 6.9.0 | MIT | [hugohe3/ppt-master](https://github.com/hugohe3/ppt-master) | 可编辑 PPTX 生成与页面重建 |

## 每个目录里的文件

| 文件 | 作用 |
| --- | --- |
| `SKILL.md` | 技能正文，Agent 加载的入口 |
| `META.json` | 版本、许可、上游，版本号的唯一真源 |
| `PROVENANCE.md` | 来源、导入范围、许可证、恢复命令 |
| `CHANGELOG.md` | 该技能的变更记录 |
| `LICENSE` | 技能本体的许可证（第三方技能才有） |

规范见 [docs/skill-spec.md](docs/skill-spec.md)，版本策略见 [docs/versioning.md](docs/versioning.md)。
