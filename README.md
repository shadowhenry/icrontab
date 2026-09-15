# icrontab - 定时任务管理器

基于 **Electron + Layui** 的桌面定时任务管理器。调度与数据模型完整参考 [lisijie/webcron](https://github.com/lisijie/webcron)（Go + beego + MySQL），
并将其移植为 Electron 主进程 + JSON 文件存储，无需安装数据库。触发时间交互（触发器）参考 Zapier 风格实现。

![任务列表](shots/01-tasks.png)

## 功能特点

- 六种可视化触发方式：**一次 / 每小时 / 每天 / 每周 / 每月 / 每年**，底层统一转换为 cron 表达式（支持 5 / 6 域、秒级）
- 触发器交互：`+ 添加触发器` → 触发类型概览 → 一行式触发器（类型下拉 / 月历弹层 / HH:MM + AM/PM 时间弹层）
- 任务的启用 / 暂停 / 立即执行 / 批量操作，显示上次与下次执行时间
- 记录每次执行的输出、错误、耗时、退出状态；日志按保留条数自动裁剪
- 超时强杀进程（Windows 使用 `taskkill /T /F`，其它平台杀进程组）
- 并发控制：可配置同时执行的任务数上限（对应 webcron 的 `jobs.pool`）；任务可设置「只允许一个实例」
- 通知：桌面通知 + SMTP 邮件（465 SSL / 587 STARTTLS，零依赖实现）+ Webhook（JSON POST）
- 通知策略与 webcron 一致：不通知 / 仅失败时通知 / 每次都通知
- 分组管理、系统设置（命令解释器 / 默认超时 / 日志保留 / 开机自启 / 数据目录切换）
- 数据全部落盘为 JSON（`tasks.json` / `groups.json` / `logs.json` / `settings.json`），可直接备份迁移

## 快速开始

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

## 界面截图

| 触发器概览 | 月历弹层 | 时间弹层 | 每周多选 |
| --- | --- | --- | --- |
| ![触发器概览](shots/02-trigger-overview.png) | ![月历](shots/04-calendar.png) | ![时间](shots/05-timepicker.png) | ![每周](shots/06-weekly.png) |

## 项目结构

```
icrontab/
├── main/                 # Electron 主进程
│   ├── main.js           # 入口：窗口、IPC、组装各模块
│   ├── preload.js        # contextBridge 安全桥（window.icron）
│   ├── cron.js           # cron 引擎：解析 / next / prev / 中文描述（零依赖）
│   ├── trigger.js        # 触发器 <-> cron 双向转换
│   ├── store.js          # JSON 存储（对应 webcron 的 models + install.sql）
│   ├── scheduler.js      # 调度器（对应 webcron 的 app/jobs/cron.go + init.go）
│   ├── runner.js         # 执行器：shell 执行、超时强杀（对应 app/jobs/job.go）
│   ├── notifier.js       # 通知策略：桌面 / 邮件 / Webhook
│   └── mailer.js         # 极简 SMTP 客户端（零依赖）
├── renderer/             # 界面（Layui 主题，资源已本地化）
│   ├── index.html
│   ├── css/app.css
│   ├── js/bridge.js      # Electron IPC <-> 浏览器 localStorage 模拟
│   ├── js/trigger-picker.js  # 触发器交互组件（按截图实现）
│   ├── js/pages.js       # 任务列表 / 编辑 / 日志 / 分组 / 设置 / 帮助
│   └── js/app.js         # 路由与公共工具
├── scripts/              # 自检 / 预览服务 / 演示数据 / 截图脚本
└── vendor 源码参考        # .reference/webcron（lisijie/webcron 源码）
```

## 与 webcron 的对应关系

| webcron | icrontab |
| --- | --- |
| `app/jobs/cron.go`（调度注册） | `main/scheduler.js` |
| `app/jobs/job.go`（执行 / 超时 / 通知） | `main/runner.js` + `main/notifier.js` |
| `app/models/*.go` + `install.sql`（MySQL） | `main/store.js`（JSON 文件） |
| 邮件通知（`app/mail/mail.go`） | `main/mailer.js` + 桌面通知 + Webhook |
| `views/`（Bootstrap 2） | `renderer/`（Layui，触发器按截图交互） |

「一次」触发通过内部标记（`#once:日期`）实现：cron 表达式本身不含年域，任务执行完成后自动置为暂停。

## 打包 Windows 安装文件

```bash
npm run dist       # 产物: dist/icrontab-<version>-setup.exe（NSIS 安装向导）
npm run pack       # 仅输出免安装目录 dist/win-unpacked/
npm run icon       # 重新生成应用图标 build/icon.ico（纯 Python 实现，无需 Pillow）
npm run license    # 重新生成安装协议 build/license.rtf（中文以 \uN? 转义，规避 NSIS 代码页问题）
```

安装向导特性：可选择安装目录、自动创建桌面/开始菜单快捷方式；**卸载不删除用户数据**（任务 JSON 保存在用户数据目录，重装后仍在）。

协议页说明：中文 Windows 的 NSIS 按 ANSI 代码页解析纯文本 `.txt`，UTF-8 中文会乱码，因此协议页使用 `build/license.rtf`（由 `npm run license` 生成，RTF 内中文以 ASCII 的 `\uN?` 转义表示，任何语言环境都正确）。

国内网络注意：electron-builder 需要下载 NSIS / winCodeSign 等工具链，若直连 GitHub 超时，可预先从镜像下载到缓存（`%LOCALAPPDATA%\electron-builder\Cache\<工具名>\<文件名>`）：

| 缓存子目录 | 文件 | 镜像地址（npmmirror） |
| --- | --- | --- |
| `7zip@1.0.0` | `7zip-win-x64.tar.gz` | `.../electron-builder-binaries/7zip@1.0.0/7zip-win-x64.tar.gz` |
| `winCodeSign-2.6.0` | `winCodeSign-2.6.0.7z` | `.../electron-builder-binaries/winCodeSign-2.6.0/winCodeSign-2.6.0.7z` |
| `nsis-3.0.4.1` | `nsis-3.0.4.1.7z` | 同上规则 |
| `nsis-resources-3.4.1` | `nsis-resources-3.4.1.7z` | 同上规则 |
| `icons@1.1.0` | `icons-bundle.tar.gz` | 同上规则 |

（`...` = `https://npmmirror.com/mirrors`，并同时设置环境变量 `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR`）

