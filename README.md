# X Feedback Loop Rewriter

浏览器端的 X 兴趣画像纠偏插件骨架。当前版本已经包含：

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

## 下一步

1. 增强 X 页面适配和动作稳定性
2. 引入真实的候选内容打分
3. 增加更细的节奏控制和失败恢复
4. 增加每日效果评估与趋势面板
