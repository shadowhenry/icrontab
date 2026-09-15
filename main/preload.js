'use strict';

/**
 * preload.js —— 渲染进程与主进程之间的安全桥
 * 渲染进程只能通过 window.icron 访问以下受控接口。
 */

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('icron', {
  isElectron: true,

  appInfo: () => invoke('app:info'),

  // 任务
  listTasks: (query) => invoke('tasks:list', query),
  getTask: (id) => invoke('tasks:get', id),
  saveTask: (task) => invoke('tasks:save', task),
  deleteTasks: (ids) => invoke('tasks:delete', ids),
  batchTasks: (action, ids) => invoke('tasks:batch', { action, ids }),
  toggleTask: (id, status) => invoke('tasks:toggle', { id, status }),
  runTask: (id) => invoke('tasks:run', id),
  taskRuntime: () => invoke('tasks:runtime'),

  // 日志
  listLogs: (query) => invoke('logs:list', query),
  getLog: (id) => invoke('logs:get', id),
  deleteLogs: (ids) => invoke('logs:delete', ids),
  clearLogs: (taskId) => invoke('logs:clear', taskId),

  // 分组
  listGroups: () => invoke('groups:list'),
  saveGroup: (group) => invoke('groups:save', group),
  deleteGroup: (id) => invoke('groups:delete', id),

  // 设置
  getSettings: () => invoke('settings:get'),
  saveSettings: (patch) => invoke('settings:save', patch),

  // 系统
  openDataDir: () => invoke('system:openDataDir'),
  changeDataDir: () => invoke('system:changeDataDir'),
  stats: () => invoke('dashboard:stats'),
  cronPreview: (payload) => invoke('cron:preview', payload),

  // 事件订阅，返回取消订阅函数
  onEvent: (handler) => {
    const listener = (evt, message) => handler(message);
    ipcRenderer.on('task:event', listener);
    return () => ipcRenderer.removeListener('task:event', listener);
  },
});
