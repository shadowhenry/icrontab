'use strict';

/**
 * bridge.js —— 数据桥
 *
 * 在 Electron 中直接转发到 preload 暴露的 window.icron；
 * 在普通浏览器中打开时（用于界面预览/调试），退化为基于 localStorage 的
 * 模拟实现，接口签名完全一致，因此界面代码无需区分运行环境。
 */

(function () {
  const isElectron = typeof window.icron !== 'undefined' && window.icron.isElectron === true;
  const cron = window.CronEngine;
  const triggerEngine = window.TriggerEngine;

  /* ------------------------- 浏览器预览用模拟实现 ------------------------- */

  const LS_KEY = 'icrontab.preview.db';
  const listeners = [];

  function seed() {
    const now = Math.floor(Date.now() / 1000);
    return {
      groups: [
        { id: 1, groupName: '默认分组', description: '未分类的定时任务', createTime: now },
        { id: 2, groupName: '数据同步', description: '各业务系统的数据同步任务', createTime: now },
        { id: 3, groupName: '报表统计', description: '日报/周报统计任务', createTime: now },
      ],
      tasks: [
        {
          id: 1,
          groupId: 2,
          taskName: '订单数据同步',
          description: '每小时把订单表增量同步到数据仓库',
          triggerType: 'hourly',
          trigger: { type: 'hourly', minute: 5, hours: [] },
          cronSpec: '0 5 * * * *',
          command: 'node D:/jobs/sync-orders.js --mode=incr',
          status: 1,
          concurrent: 1,
          notify: 1,
          notifyEmail: 'ops@example.com',
          notifyWebhook: '',
          timeout: 600,
          executeTimes: 128,
          prevTime: now - 1800,
          createTime: now - 86400 * 20,
        },
        {
          id: 2,
          groupId: 3,
          taskName: '每日经营报表',
          description: '每天 09:00 生成前一日经营报表并推送到企业微信',
          triggerType: 'daily',
          trigger: { type: 'daily', time: '09:00' },
          cronSpec: '0 0 9 * * *',
          command: 'python D:/jobs/daily_report.py --date=yesterday',
          status: 1,
          concurrent: 1,
          notify: 2,
          notifyEmail: 'boss@example.com',
          notifyWebhook: '',
          timeout: 1800,
          executeTimes: 42,
          prevTime: now - 3600 * 6,
          createTime: now - 86400 * 30,
        },
        {
          id: 3,
          groupId: 1,
          taskName: '清理临时文件',
          description: '每周日凌晨清理服务器临时目录',
          triggerType: 'weekly',
          trigger: { type: 'weekly', weekdays: [0], time: '03:30' },
          cronSpec: '0 30 3 * * 0',
          command: 'find /tmp -type f -mtime +7 -delete',
          status: 0,
          concurrent: 1,
          notify: 1,
          notifyEmail: '',
          notifyWebhook: '',
          timeout: 300,
          executeTimes: 6,
          prevTime: now - 86400 * 3,
          createTime: now - 86400 * 40,
        },
        {
          id: 4,
          groupId: 2,
          taskName: '月度账单归档',
          description: '每月 1 日把上月账单归档到对象存储',
          triggerType: 'monthly',
          trigger: { type: 'monthly', days: [1], time: '02:00' },
          cronSpec: '0 0 2 1 * *',
          command: 'node D:/jobs/archive-bills.js',
          status: 1,
          concurrent: 1,
          notify: 1,
          notifyEmail: '',
          notifyWebhook: 'https://example.com/hooks/icrontab',
          timeout: 3600,
          executeTimes: 3,
          prevTime: now - 86400 * 12,
          createTime: now - 86400 * 60,
        },
      ],
      logs: [
        { id: 1, taskId: 2, taskName: '每日经营报表', output: '生成报表完成：昨日 GMV 128,430.00 元\n推送企业微信成功', error: '', status: 0, processTime: 8421, triggerBy: 'schedule', createTime: now - 3600 * 6 },
        { id: 2, taskId: 1, taskName: '订单数据同步', output: '同步完成：新增 1,204 条，更新 87 条', error: '', status: 0, processTime: 1320, triggerBy: 'schedule', createTime: now - 1800 },
        { id: 3, taskId: 1, taskName: '订单数据同步', output: '连接数据仓库超时', error: 'Error: connect ETIMEDOUT 10.0.3.21:8123\n    at Socket.<anonymous> (sync-orders.js:88:17)', status: -1, processTime: 300012, triggerBy: 'schedule', createTime: now - 5400 },
        { id: 4, taskId: 3, taskName: '清理临时文件', output: '删除 218 个文件，释放 1.2GB', error: '', status: 0, processTime: 640, triggerBy: 'manual', createTime: now - 86400 * 3 },
        { id: 5, taskId: 4, taskName: '月度账单归档', output: '', error: '任务执行超时（3600 秒）后被强制结束', status: -2, processTime: 3600000, triggerBy: 'schedule', createTime: now - 86400 * 12 },
      ],
      settings: {
        dataDir: '（浏览器预览模式，数据保存在 localStorage）',
        shell: '',
        poolSize: 8,
        timeout: 0,
        logRetention: 2000,
        notify: {
          desktop: true,
          mail: { enabled: false, host: '', port: 465, secure: true, user: '', pass: '', from: '' },
          webhook: { enabled: false, url: '', method: 'POST' },
        },
      },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) { /* ignore */ }
    const db = seed();
    save(db);
    return db;
  }

  function save(db) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(db));
    } catch (err) { /* ignore */ }
  }

  function emit(event, payload) {
    const message = { event, payload, at: Date.now() };
    listeners.forEach((fn) => {
      try { fn(message); } catch (err) { /* ignore */ }
    });
  }

  let db = null;
  const nextId = (list) => list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;

  const mock = {
    async appInfo() {
      db = db || load();
      return {
        version: '1.0.0-preview',
        name: 'icrontab',
        platform: 'browser-preview',
        electron: '-',
        node: '-',
        dataDir: db.settings.dataDir,
        autoLaunch: false,
        settings: db.settings,
      };
    },

    async listTasks(query) {
      db = db || load();
      const q = query || {};
      let list = db.tasks.slice();
      if (Number(q.groupId) > 0) list = list.filter((t) => Number(t.groupId) === Number(q.groupId));
      if (q.keyword) {
        const kw = String(q.keyword).toLowerCase();
        list = list.filter((t) => `${t.taskName} ${t.command} ${t.description}`.toLowerCase().includes(kw));
      }
      if (q.status === 0 || q.status === 1) list = list.filter((t) => Number(t.status) === Number(q.status));
      list.sort((a, b) => b.id - a.id);
      const total = list.length;
      const page = Number(q.page) || 1;
      const pageSize = q.pageSize === 0 ? 0 : Number(q.pageSize) || 20;
      if (pageSize > 0) list = list.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

      const groups = db.groups.reduce((acc, g) => { acc[g.id] = g.groupName; return acc; }, {});
      return {
        list: list.map((task) => {
          const { spec } = triggerEngine.splitSpec(task.cronSpec);
          const t = triggerEngine.fromCron(task.cronSpec);
          const next = Number(task.status) === 1 ? cron.next(spec, new Date()) : null;
          return Object.assign({}, task, {
            groupName: groups[task.groupId] || '未分组',
            cronClean: spec,
            triggerLabel: triggerEngine.typeLabel(t),
            triggerText: triggerEngine.describe(t),
            nextTime: next ? Math.floor(next.getTime() / 1000) : 0,
            running: 0,
            enabled: Number(task.status) === 1,
          });
        }),
        total,
        page,
        pageSize,
      };
    },

    async getTask(id) {
      db = db || load();
      return db.tasks.find((t) => Number(t.id) === Number(id)) || null;
    },

    async saveTask(input) {
      db = db || load();
      const check = cron.validate(triggerEngine.splitSpec(input.cronSpec).spec);
      if (!check.ok) return { ok: false, message: `触发器表达式无效：${check.message}` };

      if (input.id) {
        const task = db.tasks.find((t) => Number(t.id) === Number(input.id));
        if (!task) return { ok: false, message: '任务不存在' };
        Object.assign(task, input);
        save(db);
        emit('task:saved', { taskId: task.id });
        return { ok: true, task, isNew: false };
      }

      const task = Object.assign({
        executeTimes: 0,
        prevTime: 0,
        createTime: Math.floor(Date.now() / 1000),
      }, input, { id: nextId(db.tasks) });
      db.tasks.push(task);
      save(db);
      emit('task:saved', { taskId: task.id });
      return { ok: true, task, isNew: true };
    },

    async deleteTasks(ids) {
      db = db || load();
      const set = new Set((ids || []).map(Number));
      db.tasks = db.tasks.filter((t) => !set.has(Number(t.id)));
      db.logs = db.logs.filter((l) => !set.has(Number(l.taskId)));
      save(db);
      emit('task:deleted', { ids });
      return { ok: true };
    },

    async batchTasks(action, ids) {
      db = db || load();
      (ids || []).forEach((id) => {
        const task = db.tasks.find((t) => Number(t.id) === Number(id));
        if (!task) return;
        if (action === 'active') task.status = 1;
        if (action === 'pause') task.status = 0;
      });
      if (action === 'delete') {
        const set = new Set((ids || []).map(Number));
        db.tasks = db.tasks.filter((t) => !set.has(Number(t.id)));
        db.logs = db.logs.filter((l) => !set.has(Number(l.taskId)));
      }
      save(db);
      emit('task:batch', { action, ids });
      return { ok: true };
    },

    async toggleTask(id, status) {
      db = db || load();
      const task = db.tasks.find((t) => Number(t.id) === Number(id));
      if (!task) return { ok: false, message: '任务不存在' };
      if (Number(status) === 1) {
        const { spec } = triggerEngine.splitSpec(task.cronSpec);
        if (!cron.next(spec, new Date())) return { ok: false, message: '触发器表达式无效，无法启用' };
      }
      task.status = Number(status);
      save(db);
      emit('task:toggle', { id, status });
      return { ok: true, task };
    },

    async runTask(id) {
      db = db || load();
      const task = db.tasks.find((t) => Number(t.id) === Number(id));
      if (!task) return { ok: false, message: '任务不存在' };
      await new Promise((resolve) => setTimeout(resolve, 600));
      const log = {
        id: nextId(db.logs),
        taskId: task.id,
        taskName: task.taskName,
        output: `[预览模式] 执行指令：${task.command}\n任务执行完成`,
        error: '',
        status: 0,
        processTime: 820,
        triggerBy: 'manual',
        createTime: Math.floor(Date.now() / 1000),
      };
      db.logs.push(log);
      task.prevTime = log.createTime;
      task.executeTimes = Number(task.executeTimes || 0) + 1;
      save(db);
      emit('task:finished', { taskId: task.id, taskName: task.taskName, log });
      return { ok: true, log };
    },

    async taskRuntime() {
      return {};
    },

    async listLogs(query) {
      db = db || load();
      const q = query || {};
      let list = db.logs.slice();
      if (Number(q.taskId) > 0) list = list.filter((l) => Number(l.taskId) === Number(q.taskId));
      if (q.status === 0 || q.status === -1 || q.status === -2) {
        list = list.filter((l) => Number(l.status) === Number(q.status));
      }
      list.sort((a, b) => b.id - a.id);
      const total = list.length;
      const page = Number(q.page) || 1;
      const pageSize = q.pageSize === 0 ? 0 : Number(q.pageSize) || 20;
      if (pageSize > 0) list = list.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
      return { list, total, page, pageSize };
    },

    async getLog(id) {
      db = db || load();
      return db.logs.find((l) => Number(l.id) === Number(id)) || null;
    },

    async deleteLogs(ids) {
      db = db || load();
      const set = new Set((ids || []).map(Number));
      db.logs = db.logs.filter((l) => !set.has(Number(l.id)));
      save(db);
      return { ok: true };
    },

    async clearLogs(taskId) {
      db = db || load();
      db.logs = Number(taskId) > 0 ? db.logs.filter((l) => Number(l.taskId) !== Number(taskId)) : [];
      save(db);
      return { ok: true };
    },

    async listGroups() {
      db = db || load();
      return db.groups.map((g) => Object.assign({}, g, {
        taskCount: db.tasks.filter((t) => Number(t.groupId) === Number(g.id)).length,
      }));
    },

    async saveGroup(input) {
      db = db || load();
      if (!String(input.groupName || '').trim()) return { ok: false, message: '分组名称不能为空' };
      if (input.id) {
        const group = db.groups.find((g) => Number(g.id) === Number(input.id));
        Object.assign(group, input);
      } else {
        db.groups.push({
          id: nextId(db.groups),
          groupName: input.groupName,
          description: input.description || '',
          createTime: Math.floor(Date.now() / 1000),
        });
      }
      save(db);
      return { ok: true };
    },

    async deleteGroup(id) {
      db = db || load();
      db.groups = db.groups.filter((g) => Number(g.id) !== Number(id));
      db.tasks.forEach((t) => {
        if (Number(t.groupId) === Number(id)) t.groupId = 0;
      });
      save(db);
      return { ok: true };
    },

    async getSettings() {
      db = db || load();
      return db.settings;
    },

    async saveSettings(patch) {
      db = db || load();
      db.settings = Object.assign({}, db.settings, patch || {}, {
        notify: Object.assign({}, db.settings.notify, (patch && patch.notify) || {}),
      });
      save(db);
      return { ok: true, settings: db.settings };
    },

    async openDataDir() {
      return { ok: false, message: '浏览器预览模式不支持打开数据目录' };
    },

    async changeDataDir() {
      return { ok: false, canceled: true, message: '浏览器预览模式不支持切换数据目录' };
    },

    async stats() {
      db = db || load();
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const todayTs = Math.floor(startOfDay.getTime() / 1000);
      const running = db.tasks.filter((t) => Number(t.status) === 1);
      const upcoming = running.map((t) => {
        const { spec } = triggerEngine.splitSpec(t.cronSpec);
        const next = cron.next(spec, new Date());
        return next ? { id: t.id, taskName: t.taskName, next: next.getTime() } : null;
      }).filter(Boolean).sort((a, b) => a.next - b.next).slice(0, 6);

      return {
        taskTotal: db.tasks.length,
        taskActive: running.length,
        taskPaused: db.tasks.length - running.length,
        groupTotal: db.groups.length,
        logTotal: db.logs.length,
        todayRuns: db.logs.filter((l) => Number(l.createTime) >= todayTs).length,
        todayFailed: db.logs.filter((l) => Number(l.createTime) >= todayTs && Number(l.status) !== 0).length,
        upcoming,
        recentLogs: db.logs.slice().sort((a, b) => b.id - a.id).slice(0, 8),
      };
    },

    async cronPreview(payload) {
      const input = payload || {};
      const spec = input.type === 'custom'
        ? String(input.cron || '').trim()
        : triggerEngine.toCron(input.trigger || input);
      const clean = triggerEngine.splitSpec(spec).spec;
      const check = cron.validate(clean);
      if (!check.ok) return { ok: false, message: check.message, spec: clean };

      const times = [];
      let cursor = new Date();
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
        triggerText: triggerEngine.describe(triggerEngine.fromCron(spec)),
        times,
      };
    },

    onEvent(handler) {
      listeners.push(handler);
      return () => {
        const idx = listeners.indexOf(handler);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };

  window.api = isElectron ? window.icron : mock;
  window.isPreviewMode = !isElectron;
}());
