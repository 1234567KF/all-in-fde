# DSH + MiniMax 图像插件 + MotionHarness 安装教程

这份教程分两半：前半给人看，照着一步步敲就行；后半给 AI 代理看，把整段贴给能执行命令的 AI（如 DeepSeek Harness 里的 agent），它就能替你装好。

全程在 Windows 上验证过（2026-11-20）。macOS / Linux 的差异会单独标注。

---

## 第一部分：人操作版

### 第 0 步：先确认三件事

| 检查项 | 怎么查 | 要求 |
|---|---|---|
| Node.js | 终端里敲 `node -v` | 没有也行，后面会用脚本自动装 |
| PowerShell 执行策略 | 管理员 PowerShell 敲 `Get-ExecutionPolicy` | 若是 `Restricted`/`AllSigned`，npm 的 .ps1 包装脚本会被拦，用后面的 `.cmd` 绕法 |
| 应用控制策略（WDAC） | 管理员 PowerShell 敲 `Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard | Select-Object CodeIntegrityPolicyEnforcementStatus` | 值为 `2` 说明强制开启，未签名的 exe（MotionHarness、部分 ffmpeg）会被拦，见第 4 步 |

### 第 1 步：装 DeepSeek Harness（DSH）

DSH 是带图形界面的 AI 代理运行环境，本教程后面所有工具都跑在它旁边或里面。

1. 拿到 DSH 安装包（`.exe` 或解压目录），双击安装或解压到任意目录，例如 `D:\Program Files\DSH`。
2. 启动后在浏览器打开它给出的地址（形如 `http://127.0.0.1:57358`），这就是工作界面。
3. 记下你工作的目录（比如 `D:\all-in-fde`），后面叫它"工作区"。

### 第 2 步：装 Node.js（如果第 0 步里没有）

```powershell
winget install OpenJS.NodeJS.LTS
```

装完新开一个终端，`node -v` 能输出版本号即可。

### 第 3 步：装 MiniMax 图像插件（minimax-h3-image）

这个插件给 DSH 增加一个 `generate_image` 工具，AI 可以用 MiniMax 的 image-01 模型画图。

1. **准备 API Key**：去 MiniMax 控制台拿你的 `MINIMAX_API_KEY`。
2. **设置环境变量**（二选一）：
   ```powershell
   # 方式 A：当前用户永久生效
   [Environment]::SetEnvironmentVariable("MINIMAX_API_KEY", "你的key", "User")

   # 方式 B：放进 DSH 的凭据库（如果 DSH 支持 credential store）
   ```
   设完重启 DSH，让新变量生效。
3. **安装插件**：把写好的插件目录（含 `index.js` 和清单文件）放到 DSH 插件目录，然后在 DSH 的插件管理里启用。手动做法：
   ```powershell
   # 假设插件源码放在工作区的 minimax-image-plugin 目录
   # 在 DSH 会话里直接说："安装 <路径> 这个插件并启用"
   ```
   DSH 内置了插件管理器，AI 会调它完成注册、启用。
4. **验证**：在 DSH 会话里让 AI"生成一张图试试"。能出图就装好了。注意两点：
   - 这个插件**不会自动触发**——只有你明确要图，AI 才会调用它；做动画时不会自己画图。
   - Key 没配好时报错通常是鉴权失败，回头检查第 2 小步。

### 第 4 步：装 MotionHarness CLI（mh）

```powershell
npm install -g @motionharness/cli
```

> **执行策略被拦怎么办**：PowerShell 可能拒绝运行 `npm.ps1`。改用 cmd 包装器：
> ```powershell
> npm.cmd install -g @motionharness/cli
> ```
> 之后所有 `mh` 命令同理，用 `& "$env:USERPROFILE\.local\node\mh.cmd"` 调用。

装完自检：

```powershell
& "$env:USERPROFILE\.local\node\mh.cmd" doctor
```

看到 `"ok":true` 即核心可用。**注意**：doctor 输出里 ffmpeg/ffprobe 若报"应用程序控制策略已阻止此文件 (os error 4551)"，说明机器开了 WDAC 强制模式，mh 自带的 ffmpeg 跑不了。不影响预览和 Studio，只影响导出 mp4。解法见第 5 步。

### 第 5 步：处理 WDAC 拦截（可选，按需做）

症状：任何未签名 exe 一运行就被杀，报 os error 4551。

两条路，选一条：

- **路线 A（推荐，彻底）**：删掉强制规则并重启。管理员 PowerShell：
  ```powershell
  Set-RuleOption -FilePath "C:\Windows\System32\CodeIntegrity\CiPolicies\Active\{你的策略GUID}.cip" -Option 3 -Delete
  Restart-Computer
  ```
  策略 GUID 用这条命令找：`Get-ChildItem C:\Windows\System32\CodeIntegrity\CiPolicies\Active`，挑体积最大的那个 `.cip`。
- **路线 B（不动系统）**：找一个不在拦截名单里的 ffmpeg。实测 imageio-ffmpeg 带的二进制可以跑：
  ```powershell
  pip install imageio-ffmpeg
  # 找到它的 ffmpeg.exe，复制到工作区 .tmp\bin\，mh 渲染时用 MH_FFMPEG 指向它
  ```

### 第 6 步：打开 Studio 做动画

```powershell
# 建工程
mkdir my-animation; cd my-animation
# 写 mh.json 和 src/scene.js（模板见第二部分）

# 预览某几帧（不需要 ffmpeg）
mh preview --time 1.5 --output .tmp/frame.png

# 多帧对比图
mh preview --times "[1,3,6,9]" --contact-sheet --columns 4

# 打开浏览器编辑器，实时看效果、打标记
mh open
```

Studio 打开后浏览器会自动弹出地址（形如 `http://127.0.0.1:54283/...`）。在画面上框选区域写评论，就是"AI 标记"，AI 读 `mh marker list` 就能收到你的修改要求。

---

## 第二部分：AI 代操作版

把下面整段复制给有命令行执行能力的 AI 代理。占位符 `<工作区>`、`<MiniMaxKey>` 替换成实际值。

```text
任务：在本机安装 DSH 全家桶（Node → MiniMax 图像插件 → MotionHarness），按顺序执行，每步验证后再进行下一步。全部命令在 PowerShell 中运行；遇 npm.ps1 被执行策略拦截时一律改用 npm.cmd / mh.cmd。

1. 检查 node -v。缺失则 winget install OpenJS.NodeJS.LTS，提示用户重开终端后继续。

2. 配置 MiniMax 图像插件：
   a. [Environment]::SetEnvironmentVariable("MINIMAX_API_KEY","<MiniMaxKey>","User")
   b. 将插件目录（含 index.js，注册 generate_image 工具，模型 image-01）放入 DSH 插件加载路径并用 DSH 插件管理器启用。
   c. 验证：请用户在 DSH 会话里发"生成一张测试图"，能返回图片即成功。提醒用户：该插件只在明确要求画图时触发，不会自动介入其他任务。

3. 安装 MotionHarness：
   a. npm.cmd install -g @motionharness/cli
   b. & "$env:USERPROFILE\.local\node\mh.cmd" doctor，确认 JSON 输出 ok:true。
   c. 若 doctor 报 ffmpeg/ffprobe "应用程序控制策略已阻止此文件 (os error 4551)"：
      先 Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard 查 CodeIntegrityPolicyEnforcementStatus；
      值为 2 说明 WDAC 强制。给用户两个选项并等用户决定，不要擅自改系统策略：
        选项A：管理员执行 Set-RuleOption -FilePath "C:\Windows\System32\CodeIntegrity\CiPolicies\Active\<最大.cip>" -Option 3 -Delete 后重启；
        选项B：pip install imageio-ffmpeg，取其 ffmpeg.exe 存到 <工作区>\.tmp\bin\，后续渲染命令前设 $env:MH_FFMPEG="<工作区>\.tmp\bin\ffmpeg.exe"。
      仅预览/Studio 可跳过本小步。

4. 建立示例动画工程 <工作区>\demo：
   a. mh.json：{"version":3,"projectType":"standard","runtimeVersion":1,"entry":"src/scene.js","width":1280,"height":720,"duration":10,"fps":30}（必须无 BOM，UTF-8 保存）。
   b. src/scene.js：export default function({root,width,height,pixelRatio}) 返回 {prepareFrame(time),dispose()}；time 为绝对秒数，同一 time 重复调用必须得到同一画面（禁用 Math.random，用 mulberry32 等确定性随机；dt 钳制 ≤0.05s，时间回退时清空粒子缓存）。
   c. 中文内容一律用 UTF-8 写文件，不要用 Set-Content 默认编码（GBK 会损坏中文）。
   d. 验证：mh preview --project <工作区>\demo --times "[0,2,5,8]" --contact-sheet --output-dir .tmp\poses，读取 manifest 确认 complete:true 且各帧文件存在。
   e. 收尾：mh open --project <工作区>\demo，把返回的 url 交给用户。

5. 回报格式：逐条列出 步骤→命令→关键输出→结论（成功/失败+原因）。失败时给出下一条建议命令，等待用户确认后继续。
```

---

## 常见坑速查

| 现象 | 原因 | 解法 |
|---|---|---|
| `npm : 无法加载文件 npm.ps1` | 执行策略 | 用 `npm.cmd` |
| exe 启动即报 os error 4551 | WDAC 强制 | 上面第 5 步两条路线 |
| `mh.json Invalid JSON` | 文件带 BOM | 用 UTF-8 无 BOM 重写 |
| scene.js 中文变乱码 | PowerShell Set-Content 按 GBK 写 | 用编辑器/工具的 UTF-8 写入 |
| 导出的 mp4 是空的 | 场景不可重复定位 | 去掉 Math.random，改成确定性写法 |
| Studio 没自动弹 | 浏览器未关联或端口占用 | 手动打开 `mh open` 输出的 url |
| 生成的图不是你要的 | 以为插件会自动介入 | 插件只响应明确的画图请求，直接说"画一张 XX" |
