# ytb-transcription

本项目是一个桌面端工具（Electron + React + TypeScript），用于把 YouTube 视频处理成可播放、可下载的目标语言语音。

核心流程：
- 下载视频（yt-dlp）
- 提取音频（ffmpeg）
- 语音转写（whisper）
- 文本翻译（可配置 Provider）
- 文本转语音（TTS）

## 近期更新（用户视角）

### 1. TTS Provider 新增「内置语音合成（Piper）」
- 设置页中的 TTS Provider 已支持 `内置语音合成（Piper）`。
- 使用 Piper 时，不再依赖云端 TTS 的 API Key / Base URL，主要依赖本地模型。
- 对你最直观的变化是：可以显著降低云端 TTS 成本。

### 2. 旧版 custom 已自动迁移到 Piper
- 如果你此前使用过 `TTS Provider = custom`，应用会自动迁移为 `piper`，无需手动改库。

### 3. 新增「检测 Piper 就绪状态」按钮
- 在设置页切换到 `内置语音合成（Piper）` 后，可以点击 `检测 Piper 就绪状态`。
- 检测会给出三项结果：
  - `Binary`（Piper 可执行文件）
  - `Model`（模型文件）
  - `Config`（可选配置文件）
- 你可以快速判断是“命令不可用”还是“模型路径错误”。

## 如何启用 Piper（给普通用户）

1. 打开设置页，选择 `TTS Provider = 内置语音合成（Piper）`。  
2. 在 `TTS 模型` 输入框填写 `.onnx` 模型路径（必填）。  
3. 可选填写：
   - Piper 可执行文件路径（不填则尝试系统 PATH 或内置资源）
   - Piper 配置文件路径（不填则尝试同名 `.onnx.json`）
4. 点击 `检测 Piper 就绪状态`，确认三项均为 OK。  
5. 保存设置后即可发起任务。  

提示：
- 若你使用的是项目内置资源打包版本，可把模型放在 `resources/piper/models/` 下，然后用相对路径填写模型名。

## Piper 常见报错与排查

### 1. Binary = FAIL（可执行文件不可用）

常见原因：
- 电脑里没有安装 `piper`，且应用内也没有打包对应平台二进制。
- `Piper 可执行文件路径` 填错，或文件没有执行权限（macOS/Linux）。

处理步骤：
1. 先清空设置里的 `Piper 可执行文件路径`，再点一次“检测 Piper 就绪状态”。  
2. 如果仍 FAIL，确认是否有以下文件（按平台）：
   - `resources/piper/darwin-arm64/piper`
   - `resources/piper/darwin-x64/piper`
   - `resources/piper/win32-x64/piper.exe`
   - `resources/piper/win32-arm64/piper.exe`
   - `resources/piper/linux-x64/piper`
   - `resources/piper/linux-arm64/piper`
3. macOS/Linux 下如果文件存在但仍 FAIL，给可执行权限后再试：

```bash
chmod +x /你的路径/piper
```

### 2. Model = FAIL（模型文件不存在）

常见原因：
- `TTS 模型` 填写的是错误路径。
- 模型文件不是 `.onnx`，或文件名拼写不一致。

处理步骤：
1. 优先填写绝对路径测试一次。  
2. 如果使用资源目录，确认模型在：
   - `resources/piper/models/你的模型.onnx`
3. 路径里有空格时，建议直接用输入框粘贴完整路径，避免手动输入错误。  

### 3. Config = FAIL（配置文件不存在）

说明：
- `Config` 是可选项。你不填 `Piper 配置文件路径` 时，系统会尝试自动使用同名 `.onnx.json`。

什么时候需要处理：
- 你明确填写了配置路径，但文件实际不存在。

处理步骤：
1. 不需要自定义配置时，直接清空 `Piper 配置文件路径`。  
2. 需要配置时，确认文件存在且与模型匹配（建议同目录同名）。  

### 4. 检测通过但任务仍失败

优先检查：
1. 模型与目标语言是否匹配（例如中文内容优先选中文模型）。  
2. 文本是否过长；可先用短文本快速验证。  
3. 重试后仍失败时，导出诊断日志并关注 `synthesizing` 阶段错误。  

## 开发与运行（本地）

```bash
npm install
npm run dev
```

质量检查：

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## YouTube 下载鉴权方式对比（用户视角）

当你在应用里下载 YouTube 视频时，通常会在设置里看到两种鉴权方式：

- `Browser Cookies`（浏览器 Cookies）
- `Cookies File`（Cookies 文件）

下面是从日常使用角度的对比。

### 1. Browser Cookies：更省心，适合本机日常使用

你不需要手动导出文件，程序会直接读取你在设置中选择的浏览器当前登录态（默认是 Chrome）。

优点：

- 操作简单，开箱即用
- 登录态通常更新鲜，不容易因为过期导致下载失败
- 不需要额外保存敏感 cookies 文件，泄露风险相对更低

可能遇到的情况：

- 依赖本机已安装并登录的浏览器
- 在少数系统环境下，可能受浏览器权限或数据库占用影响

适合你如果：

- 在自己电脑上长期使用
- 希望少折腾、成功率稳定

### 2. Cookies File：更可控，适合跨设备或自动化

你需要先从浏览器导出一份 Netscape 格式 cookies 文件，然后在设置中指定文件路径。

优点：

- 可移植，方便在不同机器或无浏览器环境使用
- 自动化脚本/服务器场景更容易统一配置

可能遇到的情况：

- 文件会过期，需要定期重新导出
- 文件本身是敏感凭据，保管不当会有安全风险
- 过期或异常时，常见表现是重试变多、速度变慢或 403/401

适合你如果：

- 需要在多台机器复用同一套下载配置
- 运行环境没有可直接读取的浏览器登录态

### 3. 快速选择建议

- 优先选 `Browser Cookies`：大多数本机用户体验更稳定。
- 必须跨机器/自动化时再选 `Cookies File`。
- 若你已使用 `Cookies File` 且下载变慢、重试频繁，先重新导出 cookies 再测试。
