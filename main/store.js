'use strict';

/**
 * store.js —— JSON 文件存储层（替代 webcron 的 MySQL）
 *
 * 数据文件：
 *   <dataDir>/tasks.json     任务
 *   <dataDir>/groups.json    任务分组
 *   <dataDir>/logs.json      执行日志
 *   <dataDir>/settings.json  系统设置
 *
 * 写入采用「先写临时文件再重命名」的方式，避免进程异常退出造成数据损坏。
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  dataDir: '',
  shell: '',                 // 留空表示跟随系统：Windows 用 cmd.exe，其它用 /bin/bash
  poolSize: 8,               // 同时执行的任务数上限
  timeout: 0,                // 默认超时（秒），0 表示不限制（内部按 24 小时兜底）
  logRetention: 2000,        // 日志最大保留条数
  notify: {
    desktop: true,
    mail: {
      enabled: false,
      host: '',
      port: 465,
      secure: true,
      user: '',
      pass: '',
      from: '',
    },
    webhook: {
      enabled: false,
      url: '',
      method: 'POST',
    },
  },
};

class Store {
  constructor() {
    this.dir = '';
    this.tasks = [];
    this.groups = [];
    this.logs = [];
    this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  /** 初始化数据目录，目录不存在时自动创建并写入初始数据 */
  init(dataDir) {
    this.dir = dataDir;
    fs.mkdirSync(this.dir, { recursive: true });

    this.tasks = this._read('tasks.json', []);
    this.groups = this._read('groups.json', []);
    this.logs = this._read('logs.json', []);
    const settings = this._read('settings.json', null);
    if (settings) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, settings, {
        notify: Object.assign({}, DEFAULT_SETTINGS.notify, settings.notify || {}),
      });
    }
    this.settings.dataDir = this.dir;

    if (!this.groups.length) {
      const now = Math.floor(Date.now() / 1000);
      this.groups = [
        { id: 1, groupName: '默认分组', description: '未分类的定时任务', createTime: now },
      ];
      this._write('groups.json', this.groups);
    }
    if (!fs.existsSync(path.join(this.dir, 'settings.json'))) {
      this._write('settings.json', this.settings);
    }
    return this.settings;
  }

  _file(name) {
    return path.join(this.dir, name);
  }

  _read(name, fallback) {
    const file = this._file(name);
    try {
      if (!fs.existsSync(file)) return fallback;
      const text = fs.readFileSync(file, 'utf8').trim();
      if (!text) return fallback;
      return JSON.parse(text);
    } catch (err) {
      // 数据损坏时备份原文件，避免直接丢失
      try {
        fs.renameSync(file, `${file}.broken-${Date.now()}`);
      } catch (e) { /* ignore */ }
      return fallback;
    }
  }

  _write(name, data) {
    const file = this._file(name);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  _nextId(list) {
    return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  }

  /* ------------------------------- 设置 ------------------------------- */

  getSettings() {
    return JSON.parse(JSON.stringify(this.settings));
  }

  updateSettings(patch) {
    this.settings = Object.assign({}, this.settings, patch || {}, {
      notify: Object.assign({}, this.settings.notify, (patch && patch.notify) || {}),
    });
    this.settings.dataDir = this.dir;
    this._write('settings.json', this.settings);
    return this.getSettings();
  }

  /* ------------------------------- 分组 ------------------------------- */

  listGroups() {
    return this.groups.slice().sort((a, b) => a.id - b.id);
  }

  getGroup(id) {
    return this.groups.find((g) => Number(g.id) === Number(id)) || null;
  }

  addGroup({ groupName, description }) {
    const name = String(groupName || '').trim();
    if (!name) throw new Error('分组名称不能为空');
    const group = {
      id: this._nextId(this.groups),
      groupName: name,
      description: String(description || '').trim(),
      createTime: Math.floor(Date.now() / 1000),
    };
    this.groups.push(group);
    this._write('groups.json', this.groups);
    return group;
  }

  updateGroup(patch) {
    const group = this.getGroup(patch.id);
    if (!group) throw new Error('分组不存在');
    if (patch.groupName !== undefined) {
      const name = String(patch.groupName).trim();
      if (!name) throw new Error('分组名称不能为空');
      group.groupName = name;
    }
    if (patch.description !== undefined) group.description = String(patch.description).trim();
    this._write('groups.json', this.groups);
    return group;
  }

  deleteGroup(id) {
    this.groups = this.groups.filter((g) => Number(g.id) !== Number(id));
    let changed = false;
    this.tasks.forEach((t) => {
      if (Number(t.groupId) === Number(id)) {
        t.groupId = 0;
        changed = true;
      }
    });
    this._write('groups.json', this.groups);
    if (changed) this._write('tasks.json', this.tasks);
    return true;
  }

  /* ------------------------------- 任务 ------------------------------- */

  listTasks({ page = 1, pageSize = 20, groupId = 0, keyword = '', status = '' } = {}) {
    let list = this.tasks.slice();
    if (Number(groupId) > 0) list = list.filter((t) => Number(t.groupId) === Number(groupId));
    if (keyword) {
      const kw = String(keyword).toLowerCase();
      list = list.filter((t) => `${t.taskName} ${t.command} ${t.description}`.toLowerCase().includes(kw));
    }
    if (status === 0 || status === 1 || status === '0' || status === '1') {
      list = list.filter((t) => Number(t.status) === Number(status));
    }
    list.sort((a, b) => b.id - a.id);

    const total = list.length;
    if (pageSize > 0) {
      const offset = (page - 1) * pageSize;
      list = list.slice(offset, offset + pageSize);
    }
    return { list, total, page, pageSize };
  }

  allTasks() {
    return this.tasks.slice().sort((a, b) => a.id - b.id);
  }

  getTask(id) {
    return this.tasks.find((t) => Number(t.id) === Number(id)) || null;
  }

  addTask(input) {
    const task = this._normalizeTask(input);
    if (!task.taskName) throw new Error('任务名称不能为空');
    if (!task.cronSpec) throw new Error('触发器不能为空');
    if (!task.command) throw new Error('执行指令不能为空');

    task.id = this._nextId(this.tasks);
    task.createTime = Math.floor(Date.now() / 1000);
    task.executeTimes = 0;
    task.prevTime = 0;
    this.tasks.push(task);
    this._write('tasks.json', this.tasks);
    return task;
  }

  updateTask(input) {
    const task = this.getTask(input.id);
    if (!task) throw new Error('任务不存在');
    const patch = this._normalizeTask(input, task);
    if (!patch.taskName) throw new Error('任务名称不能为空');
    if (!patch.cronSpec) throw new Error('触发器不能为空');
    if (!patch.command) throw new Error('执行指令不能为空');
    Object.assign(task, patch);
    this._write('tasks.json', this.tasks);
    return task;
  }

  _normalizeTask(input, base) {
    const src = input || {};
    const prev = base || {};
    const notify = src.notify !== undefined ? Number(src.notify) : Number(prev.notify || 0);
    return {
      id: prev.id || src.id || 0,
      groupId: src.groupId !== undefined ? Number(src.groupId) || 0 : Number(prev.groupId || 0),
      taskName: String(src.taskName !== undefined ? src.taskName : prev.taskName || '').trim(),
      description: String(src.description !== undefined ? src.description : prev.description || '').trim(),
      triggerType: src.triggerType || prev.triggerType || 'daily',
      trigger: src.trigger !== undefined ? src.trigger : (prev.trigger || null),
      cronSpec: String(src.cronSpec !== undefined ? src.cronSpec : prev.cronSpec || '').trim(),
      command: String(src.command !== undefined ? src.command : prev.command || '').trim(),
      status: src.status !== undefined ? Number(src.status) : Number(prev.status || 0),
      concurrent: src.concurrent !== undefined ? (Number(src.concurrent) ? 1 : 0) : Number(prev.concurrent || 0),
      notify,
      notifyEmail: String(src.notifyEmail !== undefined ? src.notifyEmail : prev.notifyEmail || '').trim(),
      notifyWebhook: String(src.notifyWebhook !== undefined ? src.notifyWebhook : prev.notifyWebhook || '').trim(),
      timeout: src.timeout !== undefined ? Number(src.timeout) || 0 : Number(prev.timeout || 0),
      executeTimes: Number(prev.executeTimes || 0),
      prevTime: Number(prev.prevTime || 0),
      createTime: Number(prev.createTime || 0),
    };
  }

  /** 仅更新运行时字段（状态、上次执行时间、执行次数） */
  patchTask(id, patch) {
    const task = this.getTask(id);
    if (!task) return null;
    Object.assign(task, patch);
    this._write('tasks.json', this.tasks);
    return task;
  }

  deleteTasks(ids) {
    const set = new Set(ids.map(Number));
    this.tasks = this.tasks.filter((t) => !set.has(Number(t.id)));
    this._write('tasks.json', this.tasks);
    return true;
  }

  /* ------------------------------- 日志 ------------------------------- */

  addLog(log) {
    const record = Object.assign({
      id: this._nextId(this.logs),
      taskId: 0,
      taskName: '',
      output: '',
      error: '',
      status: 0,
      processTime: 0,
      triggerBy: 'schedule',
      createTime: Math.floor(Date.now() / 1000),
    }, log || {});
    record.id = this._nextId(this.logs);
    this.logs.push(record);
    this.trimLogs();
    this._write('logs.json', this.logs);
    return record;
  }

  listLogs({ taskId = 0, page = 1, pageSize = 20, status = '' } = {}) {
    let list = this.logs.slice();
    if (Number(taskId) > 0) list = list.filter((l) => Number(l.taskId) === Number(taskId));
    if (status === 0 || status === -1 || status === -2 || String(status) === '0'
      || String(status) === '-1' || String(status) === '-2') {
      list = list.filter((l) => Number(l.status) === Number(status));
    }
    list.sort((a, b) => b.id - a.id);
    const total = list.length;
    if (pageSize > 0) {
      const offset = (page - 1) * pageSize;
      list = list.slice(offset, offset + pageSize);
    }
    return { list, total, page, pageSize };
  }

  getLog(id) {
    return this.logs.find((l) => Number(l.id) === Number(id)) || null;
  }

  deleteLogs(ids) {
    const set = new Set(ids.map(Number));
    this.logs = this.logs.filter((l) => !set.has(Number(l.id)));
    this._write('logs.json', this.logs);
    return true;
  }

  /** 按任务清理日志，taskId 为 0 时清空全部 */
  clearLogs(taskId) {
    this.logs = Number(taskId) > 0 ? this.logs.filter((l) => Number(l.taskId) !== Number(taskId)) : [];
    this._write('logs.json', this.logs);
    return true;
  }

  /** 按日志保留条数裁剪，避免 JSON 文件无限膨胀 */
  trimLogs() {
    const limit = Number(this.settings.logRetention) || 0;
    if (limit > 0 && this.logs.length > limit) {
      this.logs.sort((a, b) => a.id - b.id);
      this.logs = this.logs.slice(this.logs.length - limit);
    }
    return this.logs.length;
  }

  /** 统计信息，用于首页概览 */
  stats() {
    const now = Math.floor(Date.now() / 1000);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayTs = Math.floor(startOfDay.getTime() / 1000);

    return {
      taskTotal: this.tasks.length,
      taskActive: this.tasks.filter((t) => Number(t.status) === 1).length,
      taskPaused: this.tasks.filter((t) => Number(t.status) !== 1).length,
      groupTotal: this.groups.length,
      logTotal: this.logs.length,
      todayRuns: this.logs.filter((l) => Number(l.createTime) >= todayTs).length,
      todayFailed: this.logs.filter((l) => Number(l.createTime) >= todayTs && Number(l.status) !== 0).length,
      now,
    };
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
