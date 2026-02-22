# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default {
  // other rules...
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json', './tsconfig.node.json'],
    tsconfigRootDir: __dirname,
  },
}
```

- Replace `plugin:@typescript-eslint/recommended` to `plugin:@typescript-eslint/recommended-type-checked` or `plugin:@typescript-eslint/strict-type-checked`
- Optionally add `plugin:@typescript-eslint/stylistic-type-checked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and add `plugin:react/recommended` & `plugin:react/jsx-runtime` to the `extends` list
# ytb-transcription

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
