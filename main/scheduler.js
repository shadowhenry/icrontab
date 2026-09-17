'use strict';

/**
 * scheduler.js —— 任务调度器
 *
 * 调度策略：为每个启用的任务计算下一次执行时间，用定时器精确触发；
 * 触发后重新计算下一次时间，形成循环。另有 20 秒的巡检定时器，
 * 用于处理系统休眠、时钟跳变导致的定时器漂移。
 * 并发控制：使用信号量限制同时在执行的任务数。
 */

const cron = require('./cron');
const trigger = require('./trigger');

const MAX_TIMEOUT = 2147483647; // setTimeout 的上限

class Semaphore {
  constructor(size) {
    this.size = Math.max(1, Number(size) || 8);
    this.active = 0;
    this.queue = [];
  }

  setSize(size) {
    this.size = Math.max(1, Number(size) || 8);
    this._drain();
  }

  acquire() {
    if (this.active < this.size) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    this._drain();
  }

  _drain() {
    while (this.active < this.size && this.queue.length) {
      const next = this.queue.shift();
      this.active++;
      next();
    }
  }

  get pending() {
    return this.queue.length;
  }
}

class Scheduler {
  /**
   * @param {object} deps
   * @param {import('./store').Store} deps.store
   * @param {import('./runner').Runner} deps.runner
   * @param {(event: string, payload: object) => void} [deps.emit] 事件回调，用于推送界面刷新
   */
  constructor({ store, runner, emit }) {
    this.store = store;
    this.runner = runner;
    this.emit = emit || (() => {});
    this.entries = new Map(); // taskId -> { spec, next, timer, running }
    this.pool = new Semaphore(store.getSettings().poolSize);
    this.watchdog = null;
  }

  /** 启动：按设置调整并发数，加载所有启用的任务，并开启巡检 */
  start() {
    this.pool.setSize(this.store.getSettings().poolSize);
    this.startAll();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = setInterval(() => this._watch(), 20000);
  }

  stop() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.stopAll();
  }

  /** 设置变更后调用（并发数、Shell 等） */
  refresh() {
    this.pool.setSize(this.store.getSettings().poolSize);
  }

  startAll() {
    this.store.allTasks().forEach((task) => {
      if (Number(task.status) === 1) this.register(task);
    });
    return this.entries.size;
  }

  stopAll() {
    Array.from(this.entries.keys()).forEach((id) => this.unregister(id));
  }

  /** 注册（启用）一个任务 */
  register(task) {
    const id = Number(task.id);
    this.unregister(id);

    const { spec } = trigger.splitSpec(task.cronSpec);
    const check = cron.validate(spec);
    if (!check.ok) {
      this.emit('task:error', { taskId: id, message: `cron 表达式无效：${check.message}` });
      return false;
    }

    const entry = { taskId: id, spec: task.cronSpec, next: null, timer: null, running: 0 };
    this.entries.set(id, entry);
    this._arm(entry);
    this.emit('task:registered', { taskId: id, next: entry.next });
    return true;
  }

  unregister(taskId) {
    const entry = this.entries.get(Number(taskId));
    if (!entry) return false;
    if (entry.timer) clearTimeout(entry.timer);
    this.entries.delete(Number(taskId));
    this.emit('task:unregistered', { taskId: Number(taskId) });
    return true;
  }

  isRegistered(taskId) {
    return this.entries.has(Number(taskId));
  }

  getEntry(taskId) {
    const entry = this.entries.get(Number(taskId));
    if (!entry) return null;
    return { taskId: entry.taskId, next: entry.next, running: entry.running };
  }

  snapshot() {
    const result = {};
    this.entries.forEach((entry, id) => {
      result[id] = {
        next: entry.next ? entry.next.getTime() : null,
        running: entry.running,
      };
    });
    return result;
  }

  /* ----------------------------- 内部实现 ----------------------------- */

  _specOf(task) {
    // 表达式可能带有一次性标记（#once:...），计算时需去掉
    const raw = String(task.cronSpec || '');
    const idx = raw.indexOf('#once:');
    return (idx >= 0 ? raw.slice(0, idx) : raw).trim();
  }

  _onceDate(task) {
    const raw = String(task.cronSpec || '');
    const idx = raw.indexOf('#once:');
    return idx >= 0 ? raw.slice(idx + 6).trim() : '';
  }

  _arm(entry) {
    if (entry.timer) clearTimeout(entry.timer);

    const task = this.store.getTask(entry.taskId);
    if (!task) {
      this.entries.delete(entry.taskId);
      return;
    }

    const spec = this._specOf(task);
    const next = cron.next(spec, new Date());
    if (!next) {
      entry.next = null;
      entry.timer = null;
      this.emit('task:error', { taskId: entry.taskId, message: '无法计算下一次执行时间' });
      return;
    }

    // 一次性任务：若指定日期已过，则不再调度
    const onceDate = this._onceDate(task);
    if (onceDate) {
      const today = new Date();
      const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      if (onceDate < todayISO) {
        entry.next = null;
        entry.timer = null;
        this.emit('task:error', { taskId: entry.taskId, message: '一次性任务的指定时间已过' });
        return;
      }
    }

    entry.next = next;
    const delay = Math.min(Math.max(next.getTime() - Date.now(), 0), MAX_TIMEOUT);
    entry.timer = setTimeout(() => this._fire(entry.taskId), delay);
    this.emit('task:scheduled', { taskId: entry.taskId, next: next.getTime() });
  }

  /** 巡检：定时器漂移或系统休眠后重新校准 */
  _watch() {
    this.entries.forEach((entry, id) => {
      const task = this.store.getTask(id);
      if (!task || Number(task.status) !== 1) {
        this.unregister(id);
        return;
      }
      const spec = this._specOf(task);
      const expected = cron.next(spec, new Date(Date.now() - 1000));
      if (!expected) return;
      if (!entry.next || !entry.timer || Math.abs(expected.getTime() - entry.next.getTime()) > 1000) {
        this._arm(entry);
      }
    });
  }

  /** 定时触发 */
  async _fire(taskId) {
    const entry = this.entries.get(Number(taskId));
    const task = this.store.getTask(taskId);
    if (!entry || !task || Number(task.status) !== 1) return;

    const isOnce = /#once:/.test(String(task.cronSpec || ''));

    if (Number(task.concurrent) === 1 && entry.running > 0) {
      this.emit('task:skipped', { taskId, taskName: task.taskName });
      this._arm(entry);
      return;
    }

    // 一次性任务：先停掉调度，执行完不再重复
    if (isOnce) {
      this.unregister(taskId);
    } else {
      // 立刻排下一次，避免任务执行耗时导致漏掉周期
      this._arm(entry);
    }

    const run = async () => {
      entry.running++;
      this.emit('task:started', { taskId, taskName: task.taskName });
      try {
        const log = await this.runner.run(task, { triggerBy: 'schedule' });
        this.emit('task:finished', { taskId, taskName: task.taskName, log });
      } finally {
        entry.running--;
      }
    };

    // concurrent=1：同一任务不允许并行，等待上一个实例结束；concurrent=0：允许并行执行
    const allowedParallel = Number(task.concurrent) === 1;

    if (allowedParallel) {
      await this.pool.acquire();
      try {
        await run();
      } finally {
        this.pool.release();
      }
    } else {
      this.pool.acquire().then(async () => {
        try {
          await run();
        } finally {
          this.pool.release();
        }
      });
    }

    if (isOnce) {
      this.store.patchTask(taskId, { status: 0 });
      this.emit('task:disabled', { taskId, reason: 'once' });
    }
  }

  /** 立即执行，不改变任务启用状态 */
  async runNow(taskId, triggerBy = 'manual', options = {}) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error('任务不存在');
    const entry = this.entries.get(Number(taskId));
    if (entry) entry.running++;
    this.emit('task:started', { taskId: Number(taskId), taskName: task.taskName });
    await this.pool.acquire();
    try {
      const log = await this.runner.run(task, { triggerBy, onOutput: options.onOutput });
      this.emit('task:finished', { taskId: Number(taskId), taskName: task.taskName, log });
      return log;
    } finally {
      this.pool.release();
      if (entry) entry.running--;
    }
  }
}

module.exports = { Scheduler, Semaphore };
