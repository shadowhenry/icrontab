<h1 align="center">
  <img src="build/icon.png" alt="icrontab logo" width="44" height="44" valign="middle">
  icrontab - 定时任务管理器
</h1>

<p align="center">基于 <b>Electron + Layui</b> 的桌面定时任务管理器，数据以 JSON 文件落盘，无需安装数据库。</p>

<p align="center">
  <img src="build/shots/20-tasks.png" alt="icrontab 任务列表" width="820">
</p>

## 功能特点

- 六种可视化触发方式：**一次 / 每小时 / 每天 / 每周 / 每月 / 每年**，底层统一转换为 cron 表达式（支持 5 / 6 域、秒级）
- 触发器交互：`+ 添加触发器` → 触发类型概览 → 一行式触发器（类型下拉 / 月历弹层 / HH:MM + AM/PM 时间弹层）
- 任务的启用 / 暂停 / 立即执行 / 批量操作，显示上次与下次执行时间
- 记录每次执行的输出、错误、耗时、退出状态；日志按保留条数自动裁剪
- 超时强杀进程（Windows 使用 `taskkill /T /F`，其它平台杀进程组）
- 并发控制：可配置同时执行的任务数上限；任务可设置「只允许一个实例」
- 通知：桌面通知 + SMTP 邮件（465 SSL / 587 STARTTLS，零依赖实现）+ Webhook（JSON POST）
- 通知策略：不通知 / 仅失败时通知 / 每次都通知
- 分组管理、系统设置（命令解释器 / 默认超时 / 日志保留 / 开机自启 / 数据目录切换）
- 数据全部落盘为 JSON（`tasks.json` / `groups.json` / `logs.json` / `settings.json`），可直接备份迁移

## 技术架构

| 层 | 技术 |
| --- | --- |
| 界面 | Layui 2.x（资源本地化）+ 原生 JS，无前端框架 |
| 主进程 | Electron（Node.js），负责调度、执行、存储、通知 |
| 数据存储 | JSON 文件（原子写入：先写临时文件再重命名） |
| 打包 | electron-builder（Windows NSIS / macOS dmg） |

```
icrontab/
├── main/                 # Electron 主进程
│   ├── main.js           # 入口：窗口、IPC、组装各模块
│   ├── preload.js        # contextBridge 安全桥（window.icron）
│   ├── cron.js           # cron 引擎：解析 / next / prev / 中文描述（零依赖）
│   ├── trigger.js        # 触发器 <-> cron 双向转换
│   ├── store.js          # JSON 文件存储层
│   ├── scheduler.js      # 调度器：定时器精确触发 + 巡检防漂移 + 并发池
│   ├── runner.js         # 执行器：shell 执行、超时强杀
│   ├── notifier.js       # 通知策略：桌面 / 邮件 / Webhook
│   └── mailer.js         # 极简 SMTP 客户端（零依赖）
├── renderer/             # 界面（Layui 主题，资源已本地化）
│   ├── index.html
│   ├── css/app.css
│   ├── js/bridge.js      # Electron IPC <-> 浏览器 localStorage 模拟
│   ├── js/trigger-picker.js  # 触发器交互组件
│   ├── js/pages.js       # 任务列表 / 编辑 / 日志 / 分组 / 设置 / 帮助
│   └── js/app.js         # 路由与公共工具
└── scripts/              # 自检 / 预览服务 / 演示数据 / 截图脚本
```

## 快速开发

```bash
npm install        # 安装依赖（electron + layui）
npm start          # 启动应用
```

其它命令：

```bash
npm run check      # 自检：cron 解析 / 触发器互转 / JSON 存储 / 真实命令执行
npm run preview    # 浏览器预览界面（localStorage 模拟数据，无需 Electron）
npm run seed-demo  # 生成演示数据到 .demo-data
npm run dev        # 启动并打开 DevTools
```

指定数据目录（默认在系统用户数据目录下）：

```bash
ICRONTAB_DATA_DIR=D:/path/to/data npm start
```

## 打包

数据文件（JSON）位于用户数据目录，安装 / 卸载均不影响任务数据。

### Windows

```bash
npm run dist     # 产物: dist/icrontab-<version>-setup.exe（NSIS 安装向导）
npm run pack     # 仅输出免安装目录 dist/win-unpacked/
```

安装向导支持自定义安装目录、创建桌面与开始菜单快捷方式。

### macOS

```bash
npm run dist:mac   # 产物: dist/icrontab-<version>.dmg
npm run dist:all   # 一次打包双平台（Windows NSIS + macOS dmg）
```

macOS 图标使用 `build/icon.png`（运行 `npm run icon` 一并生成）；建议在 macOS 环境或 CI 的 macOS 节点打包 dmg。

### 其它命令

```bash
npm run icon       # 重新生成应用图标（build/icon.ico 与 build/icon.png，纯 Python，无需 Pillow）
npm run license    # 重新生成安装协议（build/license.rtf，RTF 内中文以转义规避 NSIS 代码页乱码）
```

## License

本项目基于 [MIT 协议](LICENSE) 开源。
