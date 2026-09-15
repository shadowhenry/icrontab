'use strict';

/**
 * trigger.js —— 触发器模型
 *
 * 参考截图中的六种触发方式（一次 / 每小时 / 每天 / 每周 / 每月 / 每年），
 * 负责「触发器对象 <-> cron 表达式」的双向转换以及中文描述生成。
 *
 * 触发器对象结构：
 * {
 *   type: 'once' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom',
 *   time: 'HH:mm',          // 时分（24 小时制），once/daily/weekly/monthly/yearly 使用
 *   minute: 0,              // hourly 使用：每个小时的哪一分钟
 *   hours: [],              // hourly 使用：限定的小时（空数组=每小时）
 *   date: 'YYYY-MM-DD',     // once 使用：指定日期
 *   month: 1,               // yearly 使用
 *   day: 1,                 // monthly / yearly 使用
 *   weekdays: [],           // weekly 使用：0=周日 ... 6=周六
 *   days: [],               // monthly 使用：可多选
 *   cron: ''                // custom 使用：原始 cron 表达式
 * }
 *
 * 与 cron.js 一样，本文件同时供主进程（require）和渲染进程（script 标签）使用，整体包在 IIFE 中。
 */

(function () {

const cron = (typeof require === 'function')
  ? require('./cron')
  : window.CronEngine;

const TYPES = [
  { type: 'once', label: '一次', desc: '在选定的日期和时间', icon: 'clock' },
  { type: 'hourly', label: '每小时', desc: '在所选小时内每小时', icon: 'clock' },
  { type: 'daily', label: '每天', desc: '每天在选定的时间', icon: 'clock' },
  { type: 'weekly', label: '每周', desc: '每周在选定的一天', icon: 'clock' },
  { type: 'monthly', label: '每月', desc: '每月在选定的一天', icon: 'clock' },
  { type: 'yearly', label: '每年', desc: '每年在选定的日期', icon: 'clock' },
];

const TYPE_MAP = TYPES.reduce((acc, t) => {
  acc[t.type] = t;
  return acc;
}, {});

const DOW_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DOW_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function todayISO(date) {
  const d = date instanceof Date ? date : new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaultTrigger(type) {
  const now = new Date();
  const base = {
    type: type || 'daily',
    time: '09:00',
    minute: 0,
    hours: [],
    date: todayISO(now),
    month: now.getMonth() + 1,
    day: now.getDate(),
    weekdays: [now.getDay()],
    days: [now.getDate()],
    cron: '',
  };
  return base;
}

function parseTime(time) {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(time || '').trim());
  if (!m) return { hour: 9, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(m[1])));
  const minute = Math.min(59, Math.max(0, Number(m[2])));
  return { hour, minute };
}

/** 触发器 -> cron 表达式（6 域：秒 分 时 日 月 周） */
function toCron(trigger) {
  const t = Object.assign(defaultTrigger(), trigger || {});
  const { hour, minute } = parseTime(t.time);

  switch (t.type) {
    case 'once': {
      const [y, mo, d] = String(t.date || todayISO()).split('-').map(Number);
      return `0 ${minute} ${hour} ${d || 1} ${mo || 1} * ` + `#once:${y}-${pad(mo || 1)}-${pad(d || 1)}`;
    }
    case 'hourly': {
      const hours = Array.isArray(t.hours) && t.hours.length ? [...t.hours].sort((a, b) => a - b).join(',') : '*';
      return `0 ${Number(t.minute) || 0} ${hours} * * *`;
    }
    case 'daily':
      return `0 ${minute} ${hour} * * *`;
    case 'weekly': {
      const dows = Array.isArray(t.weekdays) && t.weekdays.length ? [...t.weekdays].sort((a, b) => a - b).join(',') : '*';
      return `0 ${minute} ${hour} * * ${dows}`;
    }
    case 'monthly': {
      const days = Array.isArray(t.days) && t.days.length ? [...t.days].sort((a, b) => a - b).join(',') : '1';
      return `0 ${minute} ${hour} ${days} * *`;
    }
    case 'yearly':
      return `0 ${minute} ${hour} ${Number(t.day) || 1} ${Number(t.month) || 1} *`;
    case 'custom':
      return String(t.cron || '0 0 9 * * *').trim();
    default:
      return `0 ${minute} ${hour} * * *`;
  }
}

/** 取出表达式尾部的一次性标记（内部使用，不参与 cron 解析） */
function splitSpec(spec) {
  const raw = String(spec || '').trim();
  const idx = raw.indexOf('#once:');
  if (idx < 0) return { spec: raw, onceDate: '' };
  return { spec: raw.slice(0, idx).trim(), onceDate: raw.slice(idx + 6) };
}

function isOnceSpec(spec) {
  return /#once:/.test(String(spec || ''));
}

/** cron 表达式 -> 触发器（尽力还原，用于兼容直接填写的 cron） */
function fromCron(spec) {
  const { spec: clean, onceDate } = splitSpec(spec);
  let p;
  try {
    p = cron.parse(clean);
  } catch (err) {
    return Object.assign(defaultTrigger('custom'), { cron: clean });
  }

  const full = (arr, min, max) => arr.length === (max - min + 1);
  const allSec = full(p.seconds, 0, 59) ? 0 : p.seconds[0];
  const oneMinute = p.minutes.length === 1;
  const oneHour = p.hours.length === 1;

  if (onceDate) {
    return Object.assign(defaultTrigger('once'), {
      date: onceDate,
      time: `${pad(p.hours[0])}:${pad(p.minutes[0])}`,
      cron: clean,
    });
  }

  if (p.minutes.length === 1 && full(p.hours, 0, 23) && !p.dayRestricted && !p.weekdayRestricted) {
    return Object.assign(defaultTrigger('hourly'), {
      minute: p.minutes[0],
      hours: [],
      cron: clean,
    });
  }

  if (p.minutes.length === 1 && !full(p.hours, 0, 23) && !p.dayRestricted && !p.weekdayRestricted) {
    return Object.assign(defaultTrigger('daily'), {
      time: `${pad(p.hours[0])}:${pad(p.minutes[0])}`,
      cron: clean,
    });
  }

  if (oneMinute && oneHour && !p.dayRestricted && p.weekdayRestricted) {
    return Object.assign(defaultTrigger('weekly'), {
      weekdays: p.weekdays.slice(),
      time: `${pad(p.hours[0])}:${pad(p.minutes[0])}`,
      cron: clean,
    });
  }

  if (oneMinute && oneHour && p.dayRestricted && !p.weekdayRestricted && full(p.months, 1, 12)) {
    return Object.assign(defaultTrigger('monthly'), {
      days: p.days.slice(),
      time: `${pad(p.hours[0])}:${pad(p.minutes[0])}`,
      cron: clean,
    });
  }

  if (oneMinute && oneHour && p.days.length === 1 && !full(p.months, 1, 12)) {
    return Object.assign(defaultTrigger('yearly'), {
      month: p.months[0],
      day: p.days[0],
      time: `${pad(p.hours[0])}:${pad(p.minutes[0])}`,
      cron: clean,
    });
  }

  return Object.assign(defaultTrigger('custom'), { cron: clean });
}

/** 触发器中文描述，用于任务列表的「触发方式」列 */
function describe(trigger) {
  const t = Object.assign(defaultTrigger(), trigger || {});
  const { hour, minute } = parseTime(t.time);
  const hm = `${pad(hour)}:${pad(minute)}`;

  switch (t.type) {
    case 'once':
      return `${t.date} ${hm}（仅一次）`;
    case 'hourly': {
      const hasHours = Array.isArray(t.hours) && t.hours.length;
      const prefix = hasHours ? `${t.hours.map((h) => `${pad(h)}点`).join('、')} 内` : '';
      return `${prefix}每小时第 ${Number(t.minute) || 0} 分`;
    }
    case 'daily':
      return `每天 ${hm}`;
    case 'weekly': {
      const dows = Array.isArray(t.weekdays) && t.weekdays.length
        ? t.weekdays.map((d) => DOW_CN[d]).join('、')
        : '每天';
      return `每周 ${dows} ${hm}`;
    }
    case 'monthly': {
      const days = Array.isArray(t.days) && t.days.length ? t.days.join('、') : '1';
      return `每月 ${days} 日 ${hm}`;
    }
    case 'yearly':
      return `每年 ${Number(t.month) || 1}月${Number(t.day) || 1}日 ${hm}`;
    case 'custom':
      return cron.describe(String(t.cron || ''));
    default:
      return hm;
  }
}

/** 触发器展示用的标签（列表中是「一次 / 每天」这类短标签） */
function typeLabel(trigger) {
  const t = Object.assign(defaultTrigger(), trigger || {});
  return (TYPE_MAP[t.type] || { label: '自定义' }).label;
}

const API = {
  TYPES,
  TYPE_MAP,
  DOW_CN,
  DOW_SHORT,
  defaultTrigger,
  toCron,
  fromCron,
  describe,
  typeLabel,
  parseTime,
  pad,
  isOnceSpec,
  splitSpec,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
} else if (typeof window !== 'undefined') {
  window.TriggerEngine = API;
}
}());
