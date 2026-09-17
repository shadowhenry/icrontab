# icrontab 项目笔记（长期）

## 项目定位
- icrontab = 参考 webcron（lisijie/webcron）思路自研的 Electron 桌面定时任务管理器：Electron 主进程调度 + JSON 文件存储 + Layui 绿色主题界面。原 webcron 源码与全部引用已按用户要求移除（无 `.reference/`）。
- 用户明确要求：数据层用 JSON 文件，不要 MySQL；界面用 Layui 主题（主绿 #16b777）。

## 架构速查
- 调度链路：`main/scheduler.js`（注册/巡检/并发池）→ `main/runner.js`（shell+超时）→ `main/store.js`（JSON 落盘）→ `main/notifier.js`（桌面/邮件/Webhook）。
- cron 引擎 `main/cron.js` 与触发器 `main/trigger.js` 是双环境模块（Node require / 浏览器 window.*），渲染层 `bridge.js` 在非 Electron 环境自动切换 localStorage 模拟（带内置演示数据），因此 `npm run preview`（127.0.0.1:4173）可在浏览器预览整个界面。
- 「一次」触发 = cron 加内部标记 `#once:YYYY-MM-DD`，执行完成后自动置为暂停（cron 无年域的兜底方案）。
- 触发器交互组件 `renderer/js/trigger-picker.js` 按 Zapier 截图实现，是项目的标志性交互，改动需对照用户提供的四张截图（添加触发器/类型下拉/月历/AM-PM 时间弹层）。

## 常用命令
- `npm start` 启动；`npm run check` 54 项自检；`npm run preview` 浏览器预览；`node scripts/seed-demo.js` 造演示数据（写入 .demo-data）。
- 界面截图验证（必须在 escalate/禁用沙箱下执行）：`ICRONTAB_DATA_DIR=<dir> ./node_modules/electron/dist/electron.exe . --shot-out=<png> --shot-route=<hash> --shot-js=<js> --shot-wait=<ms>`。

## 环境注意事项
- **Electron 截图在默认沙箱下会静默退出（exit 0、无输出、不出图），必须用 `dangerouslyDisableSandbox: true` 运行**；`electron --version` 这类无窗口调用不受影响，别据此误判。
- **后台任务（run_in_background）方式启动 electron 会因 GPU 进程崩溃而失败**，Electron 相关验证必须前台运行；隐藏窗口后 `capturePage` 永久阻塞，托盘/隐藏逻辑测试不能用截图流程。
- 清理 electron/icrontab 进程用 PowerShell `Stop-Process`；bash 里 `taskkill //IM` 在此环境会报「无效参数 / '//IM'」。
- 启动 Electron 前必须 `unset ELECTRON_RUN_AS_NODE`（宿主全局设了 1）；已安装的 icrontab.exe 会占单实例锁，先 Stop-Process。
- bash 需先 `export PATH="/c/Program Files/Git/usr/bin:$PATH"`；`./node_modules/.bin/electron` 包装脚本失效，直接调 `node_modules/electron/dist/electron.exe`。
- 同一文件不要并行发多个 Edit（会互相覆盖），改同一文件要串行。

## UI 约定
- 风格：外框留白大、行内行距小、整体紧凑精致；表格风格以「执行日志」页为基准（行高约 40px、时间两行、操作列纯文字按钮单行）。
- 布局：`.app-body` 可纵向滚动（overflow-y:auto），任务/日志/分组页内容固定一屏（每页 5 条）；任务列表 id 正序。
- 表格：自适应列宽 + 横向滚动兜底，操作列 sticky 右固定；覆盖 Layui 内建样式需双类选择器 + `!important`。
