'use strict';

/**
 * cron.js —— 轻量 cron 表达式引擎（零依赖）
 *
 * 支持的表达式格式（参考 lisijie/webcron 的说明文档）：
 *   Seconds Minutes Hours DayofMonth Month [DayofWeek]
 * 即 5 域或 6 域，第二个可选域为「秒」。DayofWeek 可选。
 *
 * 每个域支持：星号(任意值)、问号、单个数值、区间 a-b、步长 a/n 与 * / n、枚举 a,b,c
 * 以及月份 / 星期的英文缩写（JAN-DEC / SUN-SAT）。DayofWeek：0=周日 ... 6=周六
 *
 * 该文件同时被 Electron 主进程（require）与渲染进程（<script> 标签，挂到 window.CronEngine）使用，
 * 因此整体包在 IIFE 中，避免污染全局作用域。
 */

(function () {

const MONTH_ALIAS = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const DOW_ALIAS = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

const DOW_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

class CronError extends Error {}

/** 把单个域展开成升序的数字数组 */
function parseField(raw, min, max, alias) {
  const field = String(raw || '').trim().toUpperCase();
  if (field === '' ) throw new CronError('表达式域不能为空');

  // * 与 ? 等价：都表示「任意值」
  if (field === '*' || field === '?') {
    return { values: range(min, max), wildcard: true };
  }

  const out = new Set();
  let wildcard = false;

  for (const part of field.split(',')) {
    let step = 1;
    let body = part;

    const slash = part.indexOf('/');
    if (slash >= 0) {
      body = part.slice(0, slash);
      step = Number(part.slice(slash + 1));
      if (!Number.isInteger(step) || step <= 0) {
        throw new CronError(`步长无效: ${part}`);
      }
    }

    if (body === '*' || body === '?' || body === '') {
      wildcard = true;
      const from = min;
      const to = max;
      for (let v = from; v <= to; v += step) out.add(v);
      continue;
    }

    const dash = body.indexOf('-');
    if (dash > 0) {
      const from = toNumber(body.slice(0, dash), min, max, alias);
      const to = toNumber(body.slice(dash + 1), min, max, alias);
      if (from > to) throw new CronError(`范围无效: ${part}`);
      for (let v = from; v <= to; v += step) out.add(v);
      continue;
    }

    const single = toNumber(body, min, max, alias);
    if (step > 1) {
      for (let v = single; v <= max; v += step) out.add(v);
    } else {
      out.add(single);
    }
  }

  const values = Array.from(out).sort((a, b) => a - b);
  if (!values.length) throw new CronError(`表达式域无效: ${field}`);
  return { values, wildcard };
}

function range(min, max) {
  const arr = [];
  for (let v = min; v <= max; v++) arr.push(v);
  return arr;
}

function toNumber(token, min, max, alias) {
  const t = String(token).trim().toUpperCase();
  let v;
  if (alias && Object.prototype.hasOwnProperty.call(alias, t)) {
    v = alias[t];
  } else {
    v = Number(t);
  }
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new CronError(`取值 ${token} 超出范围 ${min}-${max}`);
  }
  return v;
}

const cache = new Map();

/** 解析表达式，返回各域的取值数组；表达式非法时抛 CronError */
function parse(spec) {
  const key = String(spec || '').trim().replace(/\s+/g, ' ');
  if (cache.has(key)) {
    const cached = cache.get(key);
    if (cached instanceof Error) throw cached;
    return cached;
  }
  try {
    const result = parseUncached(key);
    cache.set(key, result);
    return result;
  } catch (err) {
    cache.set(key, err);
    throw err;
  }
}

function parseUncached(spec) {
  const parts = String(spec || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5 && parts.length !== 6) {
    throw new CronError('cron 表达式需要 5 或 6 个域（秒 分 时 日 月 [周]）');
  }
  const fields = parts.length === 6
    ? parts
    : ['0', ...parts]; // 5 域时秒固定为 0

  const seconds = parseField(fields[0], 0, 59, null);
  const minutes = parseField(fields[1], 0, 59, null);
  const hours = parseField(fields[2], 0, 23, null);
  const days = parseField(fields[3], 1, 31, null);
  const months = parseField(fields[4], 1, 12, MONTH_ALIAS);
  const weekdays = parseField(fields[5], 0, 6, DOW_ALIAS);

  return {
    spec: fields.join(' '),
    seconds: seconds.values,
    minutes: minutes.values,
    hours: hours.values,
    days: days.values,
    months: months.values,
    weekdays: weekdays.values,
    dayRestricted: !days.wildcard,
    weekdayRestricted: !weekdays.wildcard,
  };
}

/** 校验表达式，合法返回 true，否则返回错误信息 */
function validate(spec) {
  try {
    parse(spec);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

function matchDay(p, date) {
  const domHit = p.days.includes(date.getDate());
  const dowHit = p.weekdays.includes(date.getDay());
  if (p.dayRestricted && p.weekdayRestricted) return domHit || dowHit; // 标准 cron：两者都限定时取或
  if (p.dayRestricted) return domHit;
  if (p.weekdayRestricted) return dowHit;
  return true;
}

const MAX_SEARCH_DAYS = 366 * 10;

/** 计算 from 之后（不含 from 本身）的下一次执行时间，找不到返回 null */
function next(spec, from) {
  const p = parse(spec);
  const base = from ? new Date(from.getTime()) : new Date();
  if (Number.isNaN(base.getTime())) return null;

  let cursor = new Date(base.getTime() + 1000);
  cursor.setMilliseconds(0);

  for (let i = 0; i < MAX_SEARCH_DAYS; i++) {
    const day = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    if (p.months.includes(day.getMonth() + 1) && matchDay(p, day)) {
      const hit = firstTimeOfDay(p, day, cursor);
      if (hit) return hit;
    }
    cursor = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0);
  }
  return null;
}

function firstTimeOfDay(p, day, notBefore) {
  for (const h of p.hours) {
    for (const m of p.minutes) {
      for (const s of p.seconds) {
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, s, 0);
        if (candidate.getTime() >= notBefore.getTime()) return candidate;
      }
    }
  }
  return null;
}

/** 计算 from 之前（不含 from 本身）的上一次执行时间，找不到返回 null */
function prev(spec, from) {
  const p = parse(spec);
  const base = from ? new Date(from.getTime()) : new Date();
  let cursor = new Date(base.getTime() - 1000);
  cursor.setMilliseconds(0);

  for (let i = 0; i < MAX_SEARCH_DAYS; i++) {
    const day = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    if (p.months.includes(day.getMonth() + 1) && matchDay(p, day)) {
      const hit = lastTimeOfDay(p, day, cursor);
      if (hit) return hit;
    }
    cursor = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59);
    cursor = new Date(cursor.getTime() - 86400000 + 86400000); // 保持语义清晰
    cursor = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1, 23, 59, 59);
  }
  return null;
}

function lastTimeOfDay(p, day, notAfter) {
  const hours = [...p.hours].reverse();
  const minutes = [...p.minutes].reverse();
  const seconds = [...p.seconds].reverse();
  for (const h of hours) {
    for (const m of minutes) {
      for (const s of seconds) {
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, s, 0);
        if (candidate.getTime() <= notAfter.getTime()) return candidate;
      }
    }
  }
  return null;
}

/** 把表达式翻译成中文描述，用于列表展示 */
function describe(spec) {
  let p;
  try {
    p = parse(spec);
  } catch (err) {
    return String(spec || '');
  }
  const full = (arr, min, max) => arr.length === (max - min + 1);

  const secPart = full(p.seconds, 0, 59) ? null : fmtList(p.seconds, (v) => `${v}秒`);
  const timeOfDay = (h, m) => `${pad(h)}:${pad(m)}`;

  // 一次性（具体日 + 具体月 + 时分秒）
  if (!full(p.months, 1, 12) && p.months.length === 1 && p.days.length === 1
    && !full(p.hours, 0, 23) && p.hours.length === 1 && p.minutes.length === 1) {
    return `每年 ${p.months[0]}月${p.days[0]}日 ${timeOfDay(p.hours[0], p.minutes[0])}（仅执行一次）`;
  }
  if (full(p.months, 1, 12) && p.days.length === 1 && !full(p.hours, 0, 23)
    && p.hours.length === 1 && p.minutes.length === 1) {
    return `每月 ${p.days[0]} 日 ${timeOfDay(p.hours[0], p.minutes[0])}`;
  }
  if (p.weekdayRestricted && p.weekdays.length && !p.dayRestricted
    && !full(p.hours, 0, 23) && p.hours.length === 1 && p.minutes.length === 1) {
    const days = p.weekdays.map((d) => DOW_CN[d]).join('、');
    return `每周 ${days} ${timeOfDay(p.hours[0], p.minutes[0])}`;
  }
  if (full(p.hours, 0, 23) && p.minutes.length === 1) {
    return `每小时第 ${p.minutes[0]} 分`;
  }
  if (full(p.hours, 0, 23) && full(p.minutes, 0, 59) && full(p.seconds, 0, 59)) {
    return '每秒';
  }
  if (full(p.hours, 0, 23) && full(p.minutes, 0, 59)) {
    return secPart ? `每分钟（${secPart}）` : '每分钟';
  }
  if (!full(p.hours, 0, 23) && p.hours.length === 1 && p.minutes.length === 1) {
    return `每天 ${timeOfDay(p.hours[0], p.minutes[0])}`;
  }
  if (!full(p.hours, 0, 23) && p.minutes.length === 1
    && full(p.months, 1, 12) && !p.dayRestricted === false) {
    return `每天 ${fmtList(p.hours, (v) => `${pad(v)}点`)} 第 ${p.minutes[0]} 分`;
  }
  return p.spec;
}

function fmtList(arr, fn) {
  return arr.map(fn).join(', ');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

const API = {
  CronError,
  parse,
  validate,
  next,
  prev,
  describe,
  DOW_CN,
  pad,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API;
} else if (typeof window !== 'undefined') {
  window.CronEngine = API;
}
}());
