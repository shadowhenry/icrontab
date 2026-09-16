'use strict';

/**
 * main.js —— Electron 主进程
 *
 * 组装各模块：JSON 存储(store) -> 执行器(runner) -> 调度器(scheduler) -> 通知(notifier)，
 * 并通过 IPC 暴露给渲染进程。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, ipcMain, shell, Notification, dialog } = require('electron');

const { Store } = require('./store');
const { Runner } = require('./runner');
const { Scheduler } = require('./scheduler');
const { Notifier } = require('./notifier');
const { sendMail } = require('./mailer');
const cron = require('./cron');
const trigger = require('./trigger');

let mainWindow = null;
let store = null;
let runner = null;
let scheduler = null;
let notifier = null;

/* ----------------------------- 基础配置 ----------------------------- */

function bootstrapFile() {
  return path.join(app.getPath('userData'), 'bootstrap.json');
}

function readBootstrap() {
  try {
    const file = bootstrapFile();
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) { /* ignore */ }
  return {};
}

function writeBootstrap(data) {
  const file = bootstrapFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function resolveDataDir() {
  if (process.env.ICRONTAB_DATA_DIR) return process.env.ICRONTAB_DATA_DIR;
  const boot = readBootstrap();
  if (boot.dataDir) return boot.dataDir;
  return path.join(app.getPath('userData'), 'data');
}

/* ------------------- 调试用：截图模式（--shot-out=<png>） ------------------- */

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

async function runScreenshot(win) {
  const out = argValue('shot-out');
  if (!out) return;

  const route = argValue('shot-route');
  const script = argValue('shot-js');
  const wait = Number(argValue('shot-wait')) || 1500;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await sleep(600);

  if (route) {
    await win.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(route)};`);
    await sleep(700);
  }
  if (script) {
    try {
      const code = fs.readFileSync(script, 'utf8');
      const result = await win.webContents.executeJavaScript(code);
      if (result !== undefined) console.log('[shot-js]', JSON.stringify(result));
    } catch (err) {
      console.error('[shot-js] 执行失败:', err.message);
    }
  }
  await sleep(wait);

  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.toPNG());
  console.log(`[screenshot] 已保存: ${out}`);
  setTimeout(() => app.quit(), 200);
}

/* ----------------------------- 窗口 ----------------------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1030,
    height: 700,
    minWidth: 960,
    minHeight: 620,
    title: 'icrontab - 定时任务管理器',
    backgroundColor: '#f5f7fa',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  const shotOut = argValue('shot-out');
  if (shotOut) {
    mainWindow.webContents.on('console-message', (evt, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
    if (shotOut) runScreenshot(mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function pushEvent(event, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('task:event', { event, payload, at: Date.now() });
  }
}

/* ----------------------------- 初始化 ----------------------------- */

function initCore() {
  const dataDir = resolveDataDir();
  store = new Store();
  store.init(dataDir);

  notifier = new Notifier({
    store,
    mailSender: sendMail,
    onDesktop: (title, body) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title, body, silent: false });
      n.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
      n.show();
    },
    onEvent: (payload) => pushEvent('notify', payload),
  });

  runner = new Runner({ store, notifier });
  scheduler = new Scheduler({ store, runner, emit: pushEvent });
  scheduler.start();
}

function applyAutoLaunch(enabled) {
  try {
    if (app.isPackaged || process.env.ICRONTAB_ALLOW_AUTOLAUNCH === '1') {
      app.setLoginItemSettings({ openAtLogin: !!enabled });
    }
  } catch (err) { /* ignore */ }
}

/* ----------------------------- IPC ----------------------------- */

function registerIpc() {
  ipcMain.handle('app:info', () => {
    const settings = store.getSettings();
    return {
      version: app.getVersion(),
      name: 'icrontab',
      platform: os.platform(),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      dataDir: store.dir,
      autoLaunch: readBootstrap().autoLaunch === true,
      settings,
    };
  });

  /* ---------------- 任务 ---------------- */
  ipcMain.handle('tasks:list', (evt, query) => {
    const result = store.listTasks(query || {});
    const runtime = scheduler.snapshot();
    const groups = store.listGroups();
    const groupMap = groups.reduce((acc, g) => { acc[g.id] = g.groupName; return acc; }, {});

    result.list = result.list.map((task) => {
      const { spec } = trigger.splitSpec(task.cronSpec);
      const rt = runtime[task.id] || {};
      const nextTime = rt.next || (Number(task.status) === 1 && cron.validate(spec).ok
        ? (cron.next(spec, new Date()) || { getTime: () => 0 }).getTime()
        : 0);
      return Object.assign({}, task, {
        groupName: groupMap[task.groupId] || '未分组',
        cronClean: spec,
        triggerLabel: trigger.typeLabel(trigger.fromCron(task.cronSpec)),
        triggerText: trigger.describe(trigger.fromCron(task.cronSpec)),
        nextTime: nextTime ? Math.floor(nextTime / 1000) : 0,
        running: rt.running || 0,
        enabled: Number(task.status) === 1,
      });
    });
    return result;
  });

  ipcMain.handle('tasks:get', (evt, id) => {
    const task = store.getTask(id);
    return task || null;
  });

  ipcMain.handle('tasks:save', (evt, input) => {
    const check = cron.validate(trigger.splitSpec(input.cronSpec).spec);
    if (!check.ok) return { ok: false, message: `触发器表达式无效：${check.message}` };

    const isNew = !input.id;
    const task = isNew ? store.addTask(input) : store.updateTask(input);

    if (Number(task.status) === 1) {
      scheduler.register(task);
    } else {
      scheduler.unregister(task.id);
    }
    pushEvent('task:saved', { taskId: task.id });
    return { ok: true, task, isNew };
  });

  ipcMain.handle('tasks:delete', (evt, ids) => {
    (ids || []).forEach((id) => scheduler.unregister(id));
    store.deleteTasks(ids || []);
    (ids || []).forEach((id) => store.clearLogs(id));
    pushEvent('task:deleted', { ids });
    return { ok: true };
  });

  ipcMain.handle('tasks:batch', (evt, { action, ids }) => {
    const list = ids || [];
    if (!list.length) return { ok: false, message: '请选择要操作的任务' };

    list.forEach((id) => {
      const task = store.getTask(id);
      if (!task) return;
      if (action === 'active') {
        store.patchTask(id, { status: 1 });
        scheduler.register(store.getTask(id));
      } else if (action === 'pause') {
        store.patchTask(id, { status: 0 });
        scheduler.unregister(id);
      }
    });

    if (action === 'delete') {
      list.forEach((id) => scheduler.unregister(id));
      store.deleteTasks(list);
      list.forEach((id) => store.clearLogs(id));
    }

    pushEvent('task:batch', { action, ids: list });
    return { ok: true };
  });

  ipcMain.handle('tasks:toggle', (evt, { id, status }) => {
    const task = store.getTask(id);
    if (!task) return { ok: false, message: '任务不存在' };

    if (Number(status) === 1) {
      const { spec } = trigger.splitSpec(task.cronSpec);
      const next = cron.next(spec, new Date());
      if (!next) return { ok: false, message: '触发器表达式无效，无法启用' };
    }

    store.patchTask(id, { status: Number(status) });
    const updated = store.getTask(id);
    if (Number(status) === 1) scheduler.register(updated);
    else scheduler.unregister(id);
    pushEvent('task:toggle', { id, status });
    return { ok: true, task: updated };
  });

  ipcMain.handle('tasks:run', async (evt, id) => {
    try {
      const log = await scheduler.runNow(id, 'manual');
      return { ok: true, log };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });

  ipcMain.handle('tasks:runtime', () => scheduler.snapshot());

  /* ---------------- 日志 ---------------- */
  ipcMain.handle('logs:list', (evt, query) => store.listLogs(query || {}));
  ipcMain.handle('logs:get', (evt, id) => store.getLog(id));
  ipcMain.handle('logs:delete', (evt, ids) => {
    store.deleteLogs(ids || []);
    pushEvent('log:deleted', { ids });
    return { ok: true };
  });
  ipcMain.handle('logs:clear', (evt, taskId) => {
    store.clearLogs(taskId || 0);
    pushEvent('log:cleared', { taskId: taskId || 0 });
    return { ok: true };
  });

  /* ---------------- 分组 ---------------- */
  ipcMain.handle('groups:list', () => store.listGroups().map((g) => Object.assign({}, g, {
    taskCount: store.allTasks().filter((t) => Number(t.groupId) === Number(g.id)).length,
  })));
  ipcMain.handle('groups:save', (evt, input) => {
    try {
      const group = input.id ? store.updateGroup(input) : store.addGroup(input);
      pushEvent('group:saved', { id: group.id });
      return { ok: true, group };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
  ipcMain.handle('groups:delete', (evt, id) => {
    store.deleteGroup(id);
    pushEvent('group:deleted', { id });
    return { ok: true };
  });

  /* ---------------- 设置 ---------------- */
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:save', (evt, patch) => {
    const settings = store.updateSettings(patch || {});
    scheduler.refresh();
    if (patch && patch.autoLaunch !== undefined) {
      writeBootstrap(Object.assign(readBootstrap(), { autoLaunch: !!patch.autoLaunch }));
      applyAutoLaunch(patch.autoLaunch);
    }
    return { ok: true, settings };
  });

  /* ---------------- 系统 ---------------- */
  ipcMain.handle('system:openDataDir', async () => {
    await shell.openPath(store.dir);
    return { ok: true };
  });

  ipcMain.handle('system:changeDataDir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择数据目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    const dir = result.filePaths[0];
    const confirmed = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['切换', '取消'],
      defaultId: 0,
      cancelId: 1,
      message: `确定把数据目录切换到：\n${dir}\n\n（不会自动迁移原数据，可手动拷贝 JSON 文件）`,
    });
    if (confirmed.response !== 0) return { ok: false, canceled: true };

    writeBootstrap(Object.assign(readBootstrap(), { dataDir: dir }));
    scheduler.stop();
    store.init(dir);
    scheduler.start();
    pushEvent('settings:dataDirChanged', { dataDir: store.dir });
    return { ok: true, dataDir: store.dir };
  });

  /* ---------------- 触发器 / cron ---------------- */
  ipcMain.handle('cron:preview', (evt, payload) => {
    const input = payload || {};
    let spec = '';
    if (input.type === 'custom') {
      spec = String(input.cron || '').trim();
    } else {
      spec = trigger.toCron(input.trigger || input);
    }
    const clean = trigger.splitSpec(spec).spec;
    const check = cron.validate(clean);
    if (!check.ok) {
      return { ok: false, message: check.message, spec: clean };
    }
    const base = new Date();
    const times = [];
    let cursor = base;
    for (let i = 0; i < 5; i++) {
      const next = cron.next(clean, cursor);
      if (!next) break;
      times.push(next.getTime());
      cursor = next;
    }
    return {
      ok: true,
      spec: clean,
      describe: cron.describe(clean),
      triggerText: trigger.describe(trigger.fromCron(spec)),
      times,
    };
  });

  ipcMain.handle('dashboard:stats', () => {
    const stats = store.stats();
    const runtime = scheduler.snapshot();
    const tasks = store.allTasks();
    const upcoming = tasks
      .filter((t) => Number(t.status) === 1 && runtime[t.id] && runtime[t.id].next)
      .map((t) => ({ id: t.id, taskName: t.taskName, next: runtime[t.id].next }))
      .sort((a, b) => a.next - b.next)
      .slice(0, 6);
    const logs = store.listLogs({ page: 1, pageSize: 8 }).list;
    return Object.assign({}, stats, { upcoming, recentLogs: logs });
  });
}

/* ----------------------------- 生命周期 ----------------------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    initCore();
    registerIpc();
    createWindow();
    applyAutoLaunch(readBootstrap().autoLaunch === true);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (scheduler) scheduler.stop();
  });
}
