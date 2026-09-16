'use strict';

/**
 * runner.js —— 任务执行器
 *
 * 职责：
 *   1. 用系统 shell 执行任务指令，捕获 stdout / stderr
 *   2. 支持超时强制结束（Windows 用 taskkill /T /F，其它平台杀进程组）
 *   3. 写入执行日志，更新任务的「上次执行时间 / 累计执行次数」
 *   4. 按任务的「通知设置」触发通知
 */

const { spawn, execFile } = require('child_process');
const os = require('os');

const TASK_SUCCESS = 0;
const TASK_ERROR = -1;
const TASK_TIMEOUT = -2;

const MAX_OUTPUT = 256 * 1024; // 单路输出最大保留 256KB

function truncate(text) {
  const s = String(text || '');
  if (s.length <= MAX_OUTPUT) return s;
  return `${s.slice(0, MAX_OUTPUT)}\n...(输出过长已截断，共 ${s.length} 字符)`;
}

/** 根据设置解析出 shell 与参数 */
function resolveShell(settings) {
  const platform = os.platform();
  const configured = String((settings && settings.shell) || '').trim().toLowerCase();

  if (configured === 'cmd' || (!configured && platform === 'win32')) {
    return { file: 'cmd.exe', args: ['/d', '/s', '/c'] };
  }
  if (configured === 'powershell' || configured === 'pwsh') {
    return { file: configured === 'pwsh' ? 'pwsh.exe' : 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command'] };
  }
  if (configured === 'bash') {
    return { file: platform === 'win32' ? 'bash.exe' : '/bin/bash', args: ['-c'] };
  }
  if (configured === 'sh') {
    return { file: '/bin/sh', args: ['-c'] };
  }
  return { file: '/bin/bash', args: ['-c'] };
}

function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (os.platform() === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => { /* noop */ });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch (err) {
    try { child.kill('SIGKILL'); } catch (e) { /* noop */ }
  }
}

class Runner {
  constructor({ store, notifier }) {
    this.store = store;
    this.notifier = notifier || { send() {} };
  }

  /**
   * 执行任务
   * @param {object} task 任务对象
   * @param {{triggerBy?: string}} options triggerBy: schedule | manual | test
   * @returns {Promise<object>} 日志记录
   */
  run(task, options = {}) {
    const triggerBy = options.triggerBy || 'schedule';
    const settings = this.store.getSettings();
    const shell = resolveShell(settings);
    const startedAt = Date.now();
    const timeoutSec = Number(task.timeout) > 0 ? Number(task.timeout) : Number(settings.timeout) || 0;

    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(shell.file, [...shell.args, task.command], {
          cwd: options.cwd || process.cwd(),
          windowsHide: true,
          detached: os.platform() !== 'win32',
          env: Object.assign({}, process.env, {
            ICRONTAB_TASK_ID: String(task.id),
            ICRONTAB_TASK_NAME: task.taskName,
          }),
        });
      } catch (err) {
        const log = this._record(task, {
          output: '',
          error: `任务启动失败: ${err.message}`,
          status: TASK_ERROR,
          processTime: Date.now() - startedAt,
          triggerBy,
        });
        resolve(log);
        return;
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const timer = timeoutSec > 0
        ? setTimeout(() => {
          timedOut = true;
          stderr += `\n----------------------\n任务执行超过 ${timeoutSec} 秒，进程已被强制结束\n`;
          killTree(child);
        }, timeoutSec * 1000)
        : null;

      child.stdout.on('data', (chunk) => {
        if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8');
      });

      /** 统一收尾：只落库一次日志 */
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);

        const log = this._record(task, {
          output: stdout,
          error: payload.error,
          status: payload.status,
          processTime: Date.now() - startedAt,
          triggerBy,
        });
        resolve(log);
      };

      child.on('error', (err) => {
        finish({ status: TASK_ERROR, error: `${err.message}\n${stderr}` });
      });

      child.on('close', (code, signal) => {
        if (timedOut) {
          finish({
            status: TASK_TIMEOUT,
            error: `任务执行超时（${timeoutSec} 秒）后被强制结束\n${stderr}`,
          });
          return;
        }
        if (signal) {
          finish({ status: TASK_ERROR, error: `进程被信号 ${signal} 终止\n${stderr}` });
          return;
        }
        if (code === 0) {
          finish({ status: TASK_SUCCESS, error: stderr });
          return;
        }
        finish({ status: TASK_ERROR, error: `进程退出码 ${code}\n${stderr}` });
      });
    });
  }

  _record(task, { output, error, status, processTime, triggerBy }) {
    const finishedAt = Math.floor(Date.now() / 1000);
    const log = this.store.addLog({
      taskId: Number(task.id),
      taskName: task.taskName,
      output: truncate(output),
      error: truncate(error),
      status,
      processTime,
      triggerBy,
      createTime: Math.floor((Date.now() - processTime) / 1000) || finishedAt,
    });

    this.store.patchTask(task.id, {
      prevTime: finishedAt,
      executeTimes: Number(task.executeTimes || 0) + 1,
    });

    try {
      this.notifier.send({ task, log });
    } catch (err) { /* 通知失败不影响任务结果 */ }

    return log;
  }
}

module.exports = { Runner, TASK_SUCCESS, TASK_ERROR, TASK_TIMEOUT, resolveShell };
