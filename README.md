# YTB2Voice

An end-user desktop app that turns speech from YouTube videos into translated, AI-generated voice audio in your target language.

Core pipeline:
Download video -> Extract audio -> Speech-to-text -> Translate -> AI TTS -> Export results

---

## What this tool helps you do

- Paste one YouTube link and run the full pipeline automatically (no manual scripting)
- Output translated results in Chinese, English, or Japanese
- Switch between multiple translation and TTS providers in Settings
- Use built-in task queue (enqueue, pause/resume, reorder waiting tasks)
- Keep task history (review, retry, export audio/transcript/translation files)
- Auto-prepare runtime dependencies on first launch (`yt-dlp` / `ffmpeg` / Python / Whisper / Deno)

---

## 3 things to know first

1. This is a desktop app (Electron), not a web service.
2. Translation and TTS rely on third-party APIs you configure (your own API keys are required).
3. Please only process content you are legally allowed to use.

---

## 5-minute quick start (for end users)

### 1) Install the app

- Recommended: download the installer for your OS (macOS / Windows) from Releases
- Developers can also run from source (see below)

### 2) First launch: wait for runtime initialization

On first launch, the app downloads and installs required components (`yt-dlp`, `ffmpeg`, Whisper runtime, etc.).  
This can be slower than normal and is expected.

If your network limits access to GitHub or Python package mirrors, initialization may fail. Switch network and retry.

### 3) Open **Settings** and finish baseline config

At minimum, configure:

- **Translation**
  - Choose provider (e.g., MiniMax / DeepSeek / GLM / Kimi / Custom)
  - Fill API Key and Base URL
  - Select model
  - Run connectivity test

- **Text-to-Speech (TTS)**
  - Choose provider (e.g., MiniMax / OpenAI / GLM / Qwen)
  - Fill API Key and Base URL
  - Select TTS model, target language, and voice

Notes:

- Qwen has region endpoints (China / Singapore / US); select based on your key region
- For restricted videos, switch YouTube auth mode to Browser Cookies or Cookies file

### 4) Submit a task from the **Tasks** page

- Paste YouTube URL
- Choose target language
- Click Submit

The task enters the queue and runs in order. You can monitor status, progress, and logs in real time.

### 5) Get outputs

After completion, you can:

- Play synthesized audio
- Download exported results
- Open output directory
- Review/retry/re-export from History

---

## Common usage scenarios

### Scenario A: I just want Chinese dubbing quickly

- Set target language to `zh`
- Use the same provider for Translation and TTS (if you already have that key)
- Keep defaults first, tune later after one successful run

### Scenario B: YouTube video is restricted by region/permission

- Go to Settings -> YouTube Download Authentication
- Try `Browser Cookies` first (easiest on local machine)
- Use `Cookies file` for cross-device or automation environments

### Scenario C: I have many tasks and need queue control

- Submit tasks continuously; queue manages execution order
- Pause/resume and reorder waiting tasks in Queue page

---

## FAQ

### Q1: Why is the first run much slower?

The first run prepares runtime and model dependencies. It is a one-time cost. Later runs reuse cache and are typically much faster.

### Q2: Where should I check when a task fails?

Check task logs first, then locate failed stage:

- `downloading`: invalid URL, network issue, or insufficient auth
- `transcribing`: runtime/model preparation issue
- `translating` / `synthesizing`: API key / Base URL / model config / quota issues

### Q3: Why do I get 401/403?

- `401`: API key invalid, expired, or unauthorized
- `403`: provider policy/quota restrictions, or YouTube permission issue (try Cookies)

### Q4: TTS voice sounds unnatural. How to tune?

Adjust in small steps:

- `ttsSpeed`
- `ttsPitch`
- `ttsVolume`

Change only one parameter each time and compare with a short sample clip.

---

## Privacy & security notes

- Downloading, audio extraction, and transcription run mainly on your local machine
- Translation and TTS send text to your configured third-party providers
- Keep API keys only in app settings; never commit them to repo/logs

---

## Run from source (for developers)

Recommended environment:

- Node.js 20+
- npm 10+
- macOS / Windows

Start dev workflow:

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Common packaging commands:

```bash
npm run dist:mac
npm run dist:win
npm run dist:all
```

---

## Project structure (quick navigation)

- `src/`: Renderer UI (React)
- `electron/`: Main/preload process and task engine
- `electron/core/task-engine/`: Orchestration for download, transcription, translation, and TTS
- `electron/core/db/`: SQLite and DAOs
- `docs/`: Product docs, development breakdown, and release notes

---

If this is your first time using such a tool, start with one short video in the 5-minute quick start, then tune models and parameters gradually.

<details>
<summary>简体中文（点击展开）</summary>

## 中文说明

一个给普通用户用的桌面工具：把 YouTube 视频里的语音，自动变成你想听的目标语言音频。

核心流程是：  
下载视频 -> 提取音频 -> 语音转文字 -> 翻译 -> AI 配音 -> 导出结果

---

### 这个工具能帮你做什么

- 粘贴一个 YouTube 链接，自动跑完整流程，不需要手动拼接脚本
- 支持中文/英文/日文目标语言（用于翻译结果输出）
- 支持多种翻译与 TTS 服务提供方（在设置页可切换）
- 内置任务队列：可排队、暂停/恢复、调整等待任务顺序
- 保留任务历史：可查看、重试、导出音频/转录/翻译文件
- 首次运行自动准备必要运行环境（`yt-dlp` / `ffmpeg` / Python / Whisper / Deno）

---

### 先看这 3 件事（避免踩坑）

1. 这是桌面端应用（Electron），不是网页服务。
2. 翻译和 TTS 依赖你配置的第三方 API（需要你自己的 API Key）。
3. 请只处理你有合法使用权的内容，避免版权或平台条款风险。

---

### 5 分钟上手（普通用户版）

#### 1) 安装应用

- 推荐从仓库的 Releases 页面下载对应系统安装包（macOS / Windows）
- 如果你是开发者，也可以从源码运行（见下方）

#### 2) 首次启动，等待运行环境初始化

首次运行会自动下载和安装一些组件（例如 `yt-dlp`、`ffmpeg`、Whisper 相关运行时）。  
这一步会比平时慢，属于正常现象。

如果你的网络对 GitHub / Python 包源有限制，初始化可能失败，可先切换网络后重试。

#### 3) 打开「设置」并完成基础配置

至少需要配置两块：

- **翻译设置**
  - 选择翻译 Provider（如 MiniMax / DeepSeek / GLM / Kimi / Custom）
  - 填写 API Key、Base URL
  - 选择翻译模型
  - 可点击「连通测试」先验证

- **语音合成设置（TTS）**
  - 选择 TTS Provider（如 MiniMax / OpenAI / GLM / Qwen）
  - 填写 API Key、Base URL
  - 选择 TTS 模型、目标语言、音色

补充：

- Qwen 提供了中国/新加坡/美国区域入口，按你的 Key 所属区域选即可
- 遇到受限视频可在「YouTube 下载鉴权」里切换 Browser Cookies 或 Cookies 文件

#### 4) 回到「任务」页提交链接

- 粘贴 YouTube 链接
- 选择目标语言
- 点击「提交任务」

任务会进入队列并按顺序执行。你可以在任务页实时看到状态、进度与日志。

#### 5) 获取结果

任务完成后可以：

- 直接播放合成音频
- 下载导出结果
- 打开所在目录
- 在「历史」页回看、重试或再次导出

---

### 常见使用场景

#### 场景 A：只想快速得到中文配音

- 目标语言选 `zh`
- 翻译和 TTS 选择你已有 Key 的同一家服务商（通常最省事）
- 保持默认参数，先跑通一条任务再微调

#### 场景 B：YouTube 视频报权限或地区限制

- 设置 -> YouTube 下载鉴权
- 优先尝试 `Browser Cookies`（对本机用户最省心）
- 如果跨设备或自动化环境，再用 `Cookies 文件`

#### 场景 C：任务多，怕互相打断

- 直接连续提交，交给队列排队
- 在「队列」页暂停/恢复，或调整 waiting 任务顺序

---

### 常见问题（FAQ）

#### Q1：为什么第一次特别慢？

首次会自动准备运行环境和模型依赖，属于一次性成本。后续会使用缓存，通常明显更快。

#### Q2：任务失败后应该先看哪里？

先看任务页日志，重点关注失败阶段：

- `downloading`：通常是链接无效、网络问题或鉴权不足
- `transcribing`：通常是运行时/模型准备问题
- `translating` / `synthesizing`：通常是 API Key、Base URL、模型配置错误或额度问题

#### Q3：为什么提示 401/403？

- `401`：多为 API Key 不正确、过期或无权限
- `403`：多为服务端拒绝、额度/策略限制，或 YouTube 下载权限不足（可尝试 Cookies）

#### Q4：语音听起来不自然，怎么调？

在设置里先小步调整：

- `ttsSpeed`（语速）
- `ttsPitch`（音调）
- `ttsVolume`（音量）

每次只改一项，先跑短视频样例对比，最容易找到合适参数。

---

### 隐私与安全说明

- 下载、抽音频、转录等环节主要在本地执行
- 翻译和 TTS 会把文本发送到你配置的第三方服务
- API Key 只应保存在你自己的应用设置中，不要提交到仓库或日志

---

### 从源码运行（开发者）

环境建议：

- Node.js 20+
- npm 10+
- macOS / Windows

启动开发环境：

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

常用打包命令：

```bash
npm run dist:mac
npm run dist:win
npm run dist:all
```

---

### 项目结构（快速定位）

- `src/`：前端界面（React）
- `electron/`：主进程与任务执行引擎
- `electron/core/task-engine/`：下载、转录、翻译、TTS 的编排逻辑
- `electron/core/db/`：SQLite 数据与 DAO
- `docs/`：产品文档、开发拆解与发布说明

---

如果你是第一次接触这类工具，建议按「5 分钟上手」先跑通一条短视频任务，再逐步调模型和参数。

</details>
