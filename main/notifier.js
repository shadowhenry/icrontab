'use strict';

/**
 * notifier.js —— 任务执行通知
 *
 * 通知策略（任务 notify 字段）：
 *   0 = 不通知
 *   1 = 仅当执行失败或超时时通知
 *   2 = 每次执行都通知
 *
 * 通知渠道：桌面通知（Electron Notification）、邮件（SMTP）、Webhook（HTTP POST）
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const STATUS_TEXT = {
  0: '成功',
  '-1': '失败',
  '-2': '超时',
};

function statusText(status) {
  return STATUS_TEXT[String(status)] || '未知';
}

function formatTime(ts) {
  const d = new Date(Number(ts) * 1000 || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function buildMail({ task, log }) {
  const status = statusText(log.status);
  const subject = `任务执行结果通知 #${task.id}: ${task.taskName} ${status}`;
  const output = String(log.output || '').slice(0, 4000);
  const error = String(log.error || '').slice(0, 4000);

  const text = [
    `任务ID：${task.id}`,
    `任务名称：${task.taskName}`,
    `触发方式：${log.triggerBy === 'manual' ? '手动执行' : log.triggerBy === 'test' ? '测试执行' : '定时调度'}`,
    `执行时间：${formatTime(log.createTime)}`,
    `执行耗时：${(Number(log.processTime) / 1000).toFixed(3)} 秒`,
    `执行状态：${status}`,
    '',
    '-------------以下是任务执行输出-------------',
    output || '(无输出)',
    error ? `\n-------------错误信息-------------\n${error}` : '',
    '',
    '本邮件由 icrontab 自动发出，请勿回复。',
  ].filter(Boolean).join('\n');

  const html = `
    <p>以下是任务执行结果：</p>
    <p>
      任务ID：${task.id}<br/>
      任务名称：${escapeHtml(task.taskName)}<br/>
      触发方式：${log.triggerBy === 'manual' ? '手动执行' : '定时调度'}<br/>
      执行时间：${formatTime(log.createTime)}<br/>
      执行耗时：${(Number(log.processTime) / 1000).toFixed(3)} 秒<br/>
      执行状态：<b style="color:${Number(log.status) === 0 ? '#1a7f37' : '#c62828'}">${status}</b>
    </p>
    <p>-------------以下是任务执行输出-------------</p>
    <pre style="background:#f6f6f6;padding:12px;border-radius:6px;white-space:pre-wrap">${escapeHtml(output || '(无输出)')}</pre>
    ${error ? `<p>错误信息：</p><pre style="background:#fff4f4;color:#c62828;padding:12px;border-radius:6px;white-space:pre-wrap">${escapeHtml(error)}</pre>` : ''}
    <p style="color:#888">本邮件由 icrontab 自动发出，请勿回复。</p>
  `;

  return { subject, text, html };
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function postWebhook(url, payload, timeout = 10000) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      resolve({ ok: false, message: 'Webhook 地址无效' });
      return;
    }
    const client = target.protocol === 'https:' ? https : http;
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = client.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
      },
      timeout,
    }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, message: 'Webhook 请求超时' });
    });
    req.on('error', (err) => resolve({ ok: false, message: err.message }));
    req.write(body);
    req.end();
  });
}

class Notifier {
  /**
   * @param {object} deps
   * @param {import('./store').Store} deps.store
   * @param {(title: string, body: string) => void} [deps.onDesktop] 桌面通知回调（由主进程注入 Electron Notification）
   * @param {(payload: object) => void} [deps.onEvent] 通知事件回调，用于在界面上提示
   */
  constructor({ store, onDesktop, onEvent, mailSender }) {
    this.store = store;
    this.onDesktop = onDesktop || (() => {});
    this.onEvent = onEvent || (() => {});
    this.mailSender = mailSender || null;
  }

  /** 判断是否需要发送通知 */
  shouldNotify(task, log) {
    const mode = Number(task.notify || 0);
    if (mode === 0) return false;
    if (mode === 1) return Number(log.status) !== 0;
    return mode === 2;
  }

  async send({ task, log }) {
    if (!this.shouldNotify(task, log)) return;
    const settings = this.store.getSettings();
    const status = statusText(log.status);
    const needsAttention = Number(log.status) !== 0;

    // 1) 桌面通知
    if (settings.notify && settings.notify.desktop && (needsAttention || Number(task.notify) === 2)) {
      try {
        this.onDesktop(
          `任务${status}：${task.taskName}`,
          `#${task.id} ${formatTime(log.createTime)} · 耗时 ${(Number(log.processTime) / 1000).toFixed(2)}s`,
        );
      } catch (err) { /* ignore */ }
    }

    // 2) 邮件通知
    const mailConf = (settings.notify && settings.notify.mail) || {};
    const recipients = String(task.notifyEmail || '').split(/[\n,;]/).map((s) => s.trim()).filter(Boolean);
    if (mailConf.enabled && recipients.length && this.mailSender) {
      try {
        const { subject, text, html } = buildMail({ task, log });
        await this.mailSender({
          host: mailConf.host,
          port: Number(mailConf.port) || 465,
          secure: mailConf.secure !== false,
          user: mailConf.user,
          pass: mailConf.pass,
          from: mailConf.from || mailConf.user,
          to: recipients,
          subject,
          text,
          html,
        });
        this.onEvent({ type: 'mail', ok: true, taskId: task.id });
      } catch (err) {
        this.onEvent({ type: 'mail', ok: false, taskId: task.id, message: err.message });
      }
    }

    // 3) Webhook 通知
    const webhookConf = (settings.notify && settings.notify.webhook) || {};
    const url = String(task.notifyWebhook || '').trim() || (webhookConf.enabled ? String(webhookConf.url || '').trim() : '');
    if (url) {
      const payload = {
        taskId: task.id,
        taskName: task.taskName,
        status: Number(log.status),
        statusText: status,
        triggerBy: log.triggerBy,
        startTime: formatTime(log.createTime),
        processTime: Number(log.processTime),
        output: String(log.output || '').slice(0, 4000),
        error: String(log.error || '').slice(0, 4000),
      };
      const res = await postWebhook(url, payload);
      this.onEvent({ type: 'webhook', ok: res.ok, taskId: task.id, message: res.message });
    }
  }
}

module.exports = { Notifier, statusText, formatTime, buildMail, postWebhook };
