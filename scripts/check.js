'use strict';

/**
 * check.js —— 本地自检脚本
 *
 * 验证：cron 解析/下一次执行时间计算、触发器与 cron 互转、JSON 存储读写、真实命令执行。
 * 运行：npm run check
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const cron = require('../main/cron');
const trigger = require('../main/trigger');
const { Store } = require('../main/store');
const { Runner } = require('../main/runner');

let passed = 0;
let failed = 0;

function assert(name, condition, extra) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? `  -> ${extra}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/* ------------------------------ cron 引擎 ------------------------------ */

section('1. cron 表达式解析与下一次执行时间');

const base = new Date(2026, 8, 15, 14, 14, 18); // 2026-09-15 14:14:18

const cases = [
  { spec: '0 5 * * * *', expect: '2026-09-15 15:05:00', note: '每小时第 5 分钟（14:05 已过）' },
  { spec: '0 15 14 * * *', expect: '2026-09-15 14:15:00', note: '每天 14:15，未到当天时间' },
  { spec: '0 0 9 * * *', expect: '2026-09-16 09:00:00', note: '每天 09:00' },
  { spec: '0 30 3 * * 0', expect: '2026-09-20 03:30:00', note: '每周日 03:30' },
  { spec: '0 0 2 1 * *', expect: '2026-10-01 02:00:00', note: '每月 1 日 02:00' },
  { spec: '0 20 14 15 9 *', expect: '2026-09-15 14:20:00', note: '一次性：当日 14:20' },
  { spec: '0 0 8 1 1 *', expect: '2027-01-01 08:00:00', note: '每年 1 月 1 日 08:00' },
  { spec: '0 0/30 9-17 * * *', expect: '2026-09-15 14:30:00', note: '9-17 点每 30 分钟' },
  { spec: '0 */15 * * * *', expect: '2026-09-15 14:15:00', note: '每 15 分钟' },
];

function fmt(d) {
  if (!d) return 'null';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

cases.forEach((item) => {
  try {
    const next = cron.next(item.spec, base);
    assert(`${item.spec} → ${fmt(next)}（${item.note}）`, fmt(next) === item.expect, `期望 ${item.expect}`);
  } catch (err) {
    assert(`${item.spec} 解析`, false, err.message);
  }
});

assert('非法表达式报错', cron.validate('0 0 9 * *').ok === true && cron.validate('bad spec here').ok === false);
assert('域数量不足报错', cron.validate('0 9').ok === false);
assert('超出范围报错', cron.validate('0 0 25 * * *').ok === false);

section('2. 中文描述');
[
  ['0 0 9 * * *', '每天 09:00'],
  ['0 5 * * * *', '每小时第 5 分'],
  ['0 30 3 * * 0', '每周 周日 03:30'],
].forEach(([spec, expect]) => {
  const text = cron.describe(spec);
  assert(`${spec} → ${text}`, text.includes(expect), `期望包含 ${expect}`);
});

/* ------------------------------ 触发器 ------------------------------ */

section('3. 触发器 <-> cron 互转');

const triggerCases = [
  { type: 'once', input: { type: 'once', date: '2026-09-15', time: '14:20' }, cron: '0 20 14 15 9 *', reverse: 'once' },
  { type: 'hourly', input: { type: 'hourly', minute: 5, hours: [] }, cron: '0 5 * * * *', reverse: 'hourly' },
  { type: 'daily', input: { type: 'daily', time: '09:00' }, cron: '0 0 9 * * *', reverse: 'daily' },
  { type: 'weekly', input: { type: 'weekly', weekdays: [0], time: '03:30' }, cron: '0 30 3 * * 0', reverse: 'weekly' },
  { type: 'monthly', input: { type: 'monthly', days: [1], time: '02:00' }, cron: '0 0 2 1 * *', reverse: 'monthly' },
  { type: 'yearly', input: { type: 'yearly', month: 1, day: 1, time: '08:00' }, cron: '0 0 8 1 1 *', reverse: 'yearly' },
];

triggerCases.forEach((item) => {
  const full = trigger.toCron(item.input);
  const { spec } = trigger.splitSpec(full);
  assert(`${item.type} → ${spec}`, spec === item.cron, `期望 ${item.cron}`);

  // 带一次性标记的表达式应还原为「一次」，其它类型还原为对应类型
  const back = trigger.fromCron(full);
  assert(`${item.type} → cron → 触发器 = ${back.type}`, back.type === item.reverse, `实际 ${back.type}`);

  // 一次性任务带内部标记，其余不带
  assert(`${item.type} 表达式标记${item.type === 'once' ? '包含' : '不含'} #once`,
    trigger.isOnceSpec(full) === (item.type === 'once'));

  const next = cron.next(spec, base);
  assert(`${item.type} 能算出下一次执行时间：${fmt(next)}`, !!next);
});

assert('不带标记的 0 20 14 15 9 * 按「每年」解释', trigger.fromCron('0 20 14 15 9 *').type === 'yearly');
assert('一次性任务日期已过时不重复调度', !!trigger.fromCron('0 20 14 15 9 *  #once:2020-01-01').date);

/* ------------------------------ 存储 ------------------------------ */

section('4. JSON 存储');

const tmpDir = path.join(os.tmpdir(), `icrontab-check-${Date.now()}`);
const store = new Store();
store.init(tmpDir);

store.addGroup({ groupName: '测试分组', description: '自检用' });
assert('新增分组', store.listGroups().length === 2);

const task = store.addTask({
  taskName: '自检任务',
  command: 'echo hello-icrontab',
  cronSpec: '0 0 9 * * *',
  triggerType: 'daily',
  trigger: { type: 'daily', time: '09:00' },
  status: 1,
  timeout: 10,
});

assert('新增任务', !!task.id && store.getTask(task.id).taskName === '自检任务');
store.updateTask(Object.assign({}, task, { taskName: '自检任务-改' }));
assert('更新任务', store.getTask(task.id).taskName === '自检任务-改');

const log = store.addLog({ taskId: task.id, taskName: '自检任务', output: 'hi', status: 0, processTime: 12 });
assert('写入日志', store.listLogs({ taskId: task.id }).total === 1);

store.settings.logRetention = 3;
for (let i = 0; i < 6; i++) store.addLog({ taskId: task.id, output: `out-${i}` });
assert('日志按保留条数裁剪', store.listLogs({ pageSize: 0 }).total === 3, `实际 ${store.listLogs({ pageSize: 0 }).total}`);

assert('数据文件已落盘', fs.existsSync(path.join(tmpDir, 'tasks.json')) && fs.existsSync(path.join(tmpDir, 'logs.json')));

/* ------------------------------ 执行器 ------------------------------ */

section('5. 真实命令执行（Shell）');

const runner = new Runner({ store, notifier: { send() {} } });

(async () => {
  const execTask = store.addTask({
    taskName: '回声测试',
    command: 'echo hello-icrontab',
    cronSpec: '0 0 9 * * *',
    timeout: 15,
  });

  const success = await runner.run(execTask, { triggerBy: 'test' });
  assert(`执行成功任务：status=${success.status}`, success.status === 0, success.error);
  assert('捕获到标准输出', /hello-icrontab/.test(success.output), JSON.stringify(success.output));

  const failTask = store.addTask({
    taskName: '失败测试',
    command: os.platform() === 'win32' ? 'exit /b 3' : 'exit 3',
    cronSpec: '0 0 9 * * *',
    timeout: 15,
  });
  const failure = await runner.run(failTask, { triggerBy: 'test' });
  assert(`非零退出码记为失败：status=${failure.status}`, failure.status === -1, failure.error);

  const slowTask = store.addTask({
    taskName: '超时测试',
    command: os.platform() === 'win32' ? 'ping 127.0.0.1 -n 10 > nul' : 'sleep 10',
    cronSpec: '0 0 9 * * *',
    timeout: 2,
  });
  const timeoutLog = await runner.run(slowTask, { triggerBy: 'test' });
  assert(`超时任务被强制结束：status=${timeoutLog.status}`, timeoutLog.status === -2, JSON.stringify(timeoutLog.error));

  /* ------------------------------ 调度器 ------------------------------ */

  section('6. 调度器注册');

  const { Scheduler } = require('../main/scheduler');
  const scheduler = new Scheduler({ store, runner, emit: () => {} });
  const ok = scheduler.register(store.getTask(execTask.id));
  assert('注册启用中的任务', ok === true);
  assert('能查到下一次执行时间', !!scheduler.getEntry(execTask.id).next);
  scheduler.unregister(execTask.id);
  assert('注销任务', scheduler.getEntry(execTask.id) === null);

  /* ------------------------------ 汇总 ------------------------------ */

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\n结果：${passed} 项通过，${failed} 项失败\n`);
  process.exit(failed ? 1 : 0);
})();
