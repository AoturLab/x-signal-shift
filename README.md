# X Feedback Loop Rewriter

浏览器端的 X 兴趣画像纠偏插件。它通过主题驱动的自动搜索、浏览、停留、主页访问和低频互动，尝试重塑 X 对账号兴趣画像的判断，逐步削弱信息茧房。

当前版本包含：

1. Manifest V3 扩展结构
2. popup 配置面板
3. background 调度器和自动会话触发
4. content 行为执行器
5. 策略引擎初版
6. 本地状态和统计存储

## 开发

```bash
npm install
npm run typecheck
npm run build
npm run release
```

构建产物位于 `dist/`。
release 压缩包位于 `releases/`。

## 加载方式

1. 打开 Chrome 或 Edge 的扩展管理页
2. 打开“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择本项目的 `dist/` 目录

## 当前目录

1. `src/background`
   会话调度、状态管理、自动启动和消息协调

2. `src/content`
   页面识别和行为执行

3. `src/strategy`
   主题扩展和会话策略生成

4. `src/shared`
   类型、常量、消息协议和本地存储

5. `public`
   `manifest.json` 和 `popup.html`

## 功能概览

1. 主题配置、自定义关键词和语言偏好
2. 基于页面结构的自动搜索、详情页打开和作者主页访问
3. 候选内容打分与主题匹配
4. 日级自动调度、失败恢复和基础节奏控制
5. 每日训练统计与 7 天趋势面板
