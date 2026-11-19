# 安装

仓库根就是 `.dsh` 的上级目录，下载到目标位置即可用，不需要再复制或安装。

## 装到某个项目

```powershell
npx giget@latest gh:1234567KF/all-in-fde "<项目路径>"
```

macOS / Linux 同一句，路径换成 `"<项目路径>"` 即可。

完成后目录是：

```text
<项目路径>\.dsh\skills\<技能名>\
<项目路径>\.dsh\bundles\fde-presets\
```

打开该项目，DSH 就会加载这些技能。

## 装到全局

所有项目都能用：

```powershell
npx giget@latest gh:1234567KF/all-in-fde/skills "$env:USERPROFILE\.dsh\skills"
```

```bash
npx giget@latest gh:1234567KF/all-in-fde/skills "$HOME/.dsh/skills"
```

只要技能、不要文档和脚本时，用这条更省事。

## 只装一个技能

```powershell
npx giget@latest gh:1234567KF/all-in-fde/skills/token-budget "<项目路径>\.dsh\skills\token-budget"
```

## 装完验证

技能都是纯文本加脚本，落盘即用。唯一带外部依赖的是 `token-budget`，它自带 `vendor/dsh-cost`：

```powershell
node "<项目路径>\.dsh\skills\token-budget\scripts\doctor.mjs"
```

`bin ✓`、`pricing ✓` 都过就说明依赖已找到。

想让账本跨项目共享，再把它装到用户目录（可选）：

```powershell
node "<项目路径>\.dsh\skills\token-budget\scripts\install.mjs"
```

装完 `dsh-cost` 在 `~/.dsh/dsh-cost`，账本和报表也写在那里，不进技能目录。

## 更新

重复执行同一条命令并加 `--force`：

```powershell
npx giget@latest gh:1234567KF/all-in-fde "<项目路径>" --force
```

## 卸载

删目录即可，没有系统级写入：

```powershell
Remove-Item "<项目路径>\.dsh\skills\<技能名>" -Recurse
```

`token-budget` 如果装过 `dsh-cost`，再删 `~/.dsh/dsh-cost`。
