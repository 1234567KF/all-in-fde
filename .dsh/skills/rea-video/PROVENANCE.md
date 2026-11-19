# 来源与导入说明

## 上游

- 仓库：[JuneYaooo/rea-video](https://github.com/JuneYaooo/rea-video)
- 版本：`0.1.0`（`pyproject.toml`）
- 许可证：Apache-2.0（见本目录 `LICENSE` 与 `NOTICE`，版权归 JuneYaooo 及贡献者）
- 导入 commit：`e2acf601d212c63f9662cca58177588c2ba26006`
- 正文来源目录：`skills/rea-video/`

## 导入范围

只导入技能本体：`SKILL.md` 与 `references/` 下 13 份参考文件，共 14 个文件。

没有导入：

- `rea_video/`（Python 包源码，约 79 MB 仓库的主体）与 `pyproject.toml`。CLI 由 `pip install` 单独安装，不随本仓库分发；`references/setup.md` 里写了安装步骤，技能第一步会先跑 `rea-video --help` 检查。
- `docs/`、`eval/`、`docs/cases/`（案例视频与报告，占仓库绝大部分体积）、`.claude-plugin/`（Claude Code 插件清单）。
- 上游的 `i18n/` 多语言 README。

## 导入时做过的改动

无。`SKILL.md` 与 `references/` 逐字保留，`name` 与目录名一致，`description` 未改写——它原文就是中文触发描述，已符合本仓库的写法要求。

只新增了三份旁注文件：`META.json`、`PROVENANCE.md`、`CHANGELOG.md`。

## 运行前提

1. Python ≥ 3.10（本机 3.12 满足）。
2. **ffmpeg 在 PATH 上**。这是硬前提：拆镜、抽帧、分轨都依赖它。本机的应用程序控制策略会拦掉一部分二进制：MotionHarness 自带的那份 `ffmpeg.exe` 被拦（os error 4551），但从 `pip install imageio-ffmpeg` 拿到的 9.0.2 能正常执行，照它配 PATH 即可。
3. **ffprobe 在本机不可用**，同一策略会拦掉独立的 `ffprobe.exe`（换目录、自己编译都一样）。改由 PyAV 实现的等价调用代理，做法见 [tools/rea-video/README.md](../../tools/rea-video/README.md)。
4. rea-video 抽帧会往 `%TEMP%` 写文件，本机需要把 `TEMP`/`TMP` 指到工作区目录，否则 ffmpeg 报 `Permission denied`。
5. 首次拆解会下载人声分离模型（约 67 MB）到 `~/.cache/rea-video/models`；音效分轨另需 BandIt v2（约 149 MB）。
6. VLM 可选。没配也能跑，此时由能看图的 agent 自己充当复核者。

## 同步与恢复

上游升级后重新拉取正文（只覆盖这 14 个文件，不影响三份旁注）：

```powershell
$base = "https://raw.githubusercontent.com/JuneYaooo/rea-video/main/skills/rea-video"
$dst  = "skills/rea-video"
foreach ($f in @("SKILL.md","references/audio.md","references/capsule-cinema.md","references/chatcut.md","references/diy.md","references/hyperframes.md","references/materials.md","references/memory.md","references/output-template.md","references/remake-tools.md","references/remake.md","references/review.md","references/setup.md","references/taxonomy.md")) {
  Invoke-WebRequest -Uri "$base/$f" -OutFile "$dst/$f" -UseBasicParsing
}
```

同步后需一起改：`META.json` 的 `upstream.version` / `upstream.commit`、`CHANGELOG.md` 顶部版本。
