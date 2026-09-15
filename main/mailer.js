'use strict';

/**
 * mailer.js —— 极简 SMTP 客户端（零依赖，支持 465 隐式 TLS 与 587 STARTTLS）
 *
 * 对应 webcron 的 app/mail/mail.go：任务执行完成/失败时发送通知邮件。
 */

const net = require('net');
const tls = require('tls');

function encodeBase64(text) {
  return Buffer.from(String(text), 'utf8').toString('base64');
}

/** 按 RFC 2047 编码邮件头中的非 ASCII 内容 */
function encodeHeader(text) {
  const raw = String(text == null ? '' : text);
  if (/^[\x20-\x7e]*$/.test(raw)) return raw;
  return `=?UTF-8?B?${Buffer.from(raw, 'utf8').toString('base64')}?=`;
}

/** 简单的多行响应读取器 */
class SmtpConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.waiters = [];
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      this._drain();
    });
  }

  _drain() {
    while (this.waiters.length) {
      const { resolve, reject, timer } = this.waiters[0];
      const lines = this.buffer.split(/\r?\n/);
      let complete = -1;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\d{3} /.test(line)) {
          complete = i;
          break;
        }
      }
      if (complete < 0) return;
      const payload = lines.slice(0, complete + 1).join('\n');
      this.buffer = lines.slice(complete + 1).join('\n');
      this.waiters.shift();
      clearTimeout(timer);
      resolve(payload);
    }
  }

  read(timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new Error('SMTP 响应超时'));
      }, timeout);
      this.waiters.push({ resolve, reject, timer });
      this._drain();
    });
  }

  write(text) {
    this.socket.write(text);
  }

  async command(text, timeout) {
    if (text !== null && text !== undefined) this.write(`${text}\r\n`);
    return this.read(timeout);
  }
}

function assertCode(response, allowed) {
  const code = Number(String(response).slice(0, 3));
  if (!allowed.includes(code)) {
    throw new Error(`SMTP 错误响应：${String(response).split('\n').pop()}`);
  }
  return response;
}

/**
 * 发送邮件
 * @param {object} options { host, port, secure, user, pass, from, to, cc, subject, html, text }
 */
async function sendMail(options) {
  const {
    host, port = 465, secure = true, user = '', pass = '', from = '',
    to = [], cc = [], subject = '', html = '', text = '',
  } = options || {};

  if (!host) throw new Error('未配置 SMTP 服务器');
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) throw new Error('收件人不能为空');

  let socket;
  let conn;

  if (secure) {
    socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false });
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
      setTimeout(() => reject(new Error('连接 SMTP 服务器超时')), 15000);
    });
  } else {
    socket = net.connect({ host, port });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      setTimeout(() => reject(new Error('连接 SMTP 服务器超时')), 15000);
    });
  }

  conn = new SmtpConnection(socket);

  try {
    await assertCode(await conn.read(), [220]);

    let ehlo = await assertCode(await conn.command(`EHLO icrontab`), [250]);

    if (!secure && /STARTTLS/i.test(ehlo)) {
      await assertCode(await conn.command('STARTTLS'), [220]);
      socket = tls.connect({ socket, servername: host, rejectUnauthorized: false });
      await new Promise((resolve, reject) => {
        socket.once('secureConnect', resolve);
        socket.once('error', reject);
      });
      conn = new SmtpConnection(socket);
      ehlo = await assertCode(await conn.command('EHLO icrontab'), [250]);
    }

    if (user) {
      await assertCode(await conn.command('AUTH LOGIN'), [334]);
      await assertCode(await conn.command(encodeBase64(user)), [334]);
      await assertCode(await conn.command(encodeBase64(pass)), [235]);
    }

    const sender = from || user;
    await assertCode(await conn.command(`MAIL FROM:<${sender}>`), [250]);
    for (const rcpt of recipients) {
      await assertCode(await conn.command(`RCPT TO:<${rcpt}>`), [250, 251]);
    }
    for (const rcpt of cc.filter(Boolean)) {
      await assertCode(await conn.command(`RCPT TO:<${rcpt}>`), [250, 251]);
    }

    await assertCode(await conn.command('DATA'), [354]);

    const boundary = `--icrontab-${Date.now()}--`;
    const headerLines = [
      `From: ${encodeHeader(from || user)}`,
      `To: ${recipients.join(', ')}`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      `Date: ${new Date().toUTCString()}`,
      'Content-Type: multipart/alternative; boundary="' + boundary + '"',
      '',
    ];

    const bodyParts = [];
    if (text) {
      bodyParts.push(
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        splitBase64(Buffer.from(text, 'utf8').toString('base64')),
      );
    }
    bodyParts.push(
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      splitBase64(Buffer.from(html || `<pre>${escapeHtml(text)}</pre>`, 'utf8').toString('base64')),
      `--${boundary}--`,
      '',
    );

    const message = `${headerLines.join('\r\n')}\r\n${bodyParts.join('\r\n')}\r\n.`;
    conn.write(`${message}\r\n`);
    await assertCode(await conn.read(), [250]);

    try {
      conn.write('QUIT\r\n');
    } catch (err) { /* ignore */ }

    return { ok: true };
  } finally {
    try { socket.end(); } catch (err) { /* ignore */ }
  }
}

function splitBase64(text) {
  return String(text).replace(/(.{76})/g, '$1\r\n');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { sendMail, encodeHeader };
