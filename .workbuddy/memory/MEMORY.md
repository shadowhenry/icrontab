# icrontab 项目笔记（长期）

## 项目定位
- icrontab = webcron（lisijie/webcron）的 Electron 桌面移植版：Electron 主进程调度 + JSON 文件存储 + Layui 绿色主题界面。
- 参考源码保留在 `.reference/webcron`，改动调度/数据逻辑时可对照原 Go 实现。
- 用户明确要求：数据层用 JSON 文件，不要 MySQL；界面用 Layui 主题（主绿 #16b777）。

## 架构速查
- 调度链路：`main/scheduler.js`（注册/巡检/并发池）→ `main/runner.js`（shell+超时）→ `main/store.js`（JSON 落盘）→ `main/notifier.js`（桌面/邮件/Webhook）。
- cron 引擎 `main/cron.js` 与触发器 `main/trigger.js` 是双环境模块（Node require / 浏览器 window.*），渲染层 `bridge.js` 在非 Electron 环境自动切换 localStorage 模拟，因此 `npm run preview`（127.0.0.1:4173）可在浏览器预览整个界面。
- 「一次」触发 = cron 加内部标记 `#once:YYYY-MM-DD`，执行完成后自动置为暂停（cron 无年域的兜底方案）。
- 触发器交互组件 `renderer/js/trigger-picker.js` 按 Zapier 截图实现，是项目的标志性交互，改动需对照用户提供的四张截图（添加触发器/类型下拉/月历/AM-PM 时间弹层）。

## 常用命令
- `npm start` 启动；`npm run check` 54 项自检；`npm run preview` 浏览器预览；`node scripts/seed-demo.js` 造演示数据（写入 .demo-data）。
- 界面截图验证：`ICRONTAB_DATA_DIR=<dir> electron . --shot-out=<png> --shot-route=<hash> --shot-js=<js>`。

## 环境注意事项
- 启动 Electron 前必须 `unset ELECTRON_RUN_AS_NODE`（宿主全局设了 1）。
- bash 需先 `export PATH="/c/Program Files/Git/usr/bin:$PATH"`。
- UI 风格偏好：外框留白大、行内行距小、整体紧凑精致。
