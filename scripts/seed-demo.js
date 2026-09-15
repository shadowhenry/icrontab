'use strict';

/**
 * seed-demo.js —— 生成演示数据（可选）
 *
 * 用法：node scripts/seed-demo.js [数据目录]
 * 不传目录时使用 <项目>/.demo-data ，用于界面预览或首次体验。
 */

const path = require('path');
const { Store } = require('../main/store');

const dir = process.argv[2] || path.join(__dirname, '..', '.demo-data');
const store = new Store();
store.init(dir);

if (store.listGroups().length < 3) {
  store.addGroup({ groupName: '数据同步', description: '各业务系统的数据同步任务' });
  store.addGroup({ groupName: '报表统计', description: '日报 / 周报统计任务' });
}

const now = Math.floor(Date.now() / 1000);
const demoTasks = [
  {
    taskName: '订单数据同步',
    description: '每小时把订单表增量同步到数据仓库',
    groupId: 2,
    triggerType: 'hourly',
    trigger: { type: 'hourly', minute: 5, hours: [] },
    cronSpec: '0 5 * * * *',
    command: 'node D:/jobs/sync-orders.js --mode=incr',
    status: 1,
    concurrent: 1,
    notify: 1,
    notifyEmail: 'ops@example.com',
    timeout: 600,
  },
  {
    taskName: '每日经营报表',
    description: '每天 09:00 生成前一日经营报表并推送',
    groupId: 3,
    triggerType: 'daily',
    trigger: { type: 'daily', time: '09:00' },
    cronSpec: '0 0 9 * * *',
    command: 'python D:/jobs/daily_report.py',
    status: 1,
    concurrent: 1,
    notify: 2,
    notifyEmail: 'boss@example.com',
    timeout: 1800,
  },
  {
    taskName: '清理临时文件',
    description: '每周日凌晨清理服务器临时目录',
    groupId: 1,
    triggerType: 'weekly',
    trigger: { type: 'weekly', weekdays: [0], time: '03:30' },
    cronSpec: '0 30 3 * * 0',
    command: 'find /tmp -type f -mtime +7 -delete',
    status: 0,
    concurrent: 1,
    notify: 1,
    timeout: 300,
  },
  {
    taskName: '月度账单归档',
    description: '每月 1 日把上月账单归档到对象存储',
    groupId: 2,
    triggerType: 'monthly',
    trigger: { type: 'monthly', days: [1], time: '02:00' },
    cronSpec: '0 0 2 1 * *',
    command: 'node D:/jobs/archive-bills.js',
    status: 1,
    concurrent: 1,
    notify: 1,
    notifyWebhook: 'https://example.com/hooks/icrontab',
    timeout: 3600,
  },
];

demoTasks.forEach((task) => {
  const exists = store.allTasks().some((t) => t.taskName === task.taskName);
  if (exists) return;
  const created = store.addTask(task);
  if (Number(created.status) === 1) {
    store.patchTask(created.id, { prevTime: now - 1800, executeTimes: 12 });
  }
  store.addLog({
    taskId: created.id,
    taskName: created.taskName,
    output: `[demo] ${created.command} 执行完成`,
    status: 0,
    processTime: 1200 + Math.floor(Math.random() * 3000),
    createTime: now - 1800,
  });
});

console.log(`演示数据已写入：${dir}`);
console.log(`任务 ${store.allTasks().length} 个，分组 ${store.listGroups().length} 个，日志 ${store.listLogs({ pageSize: 0 }).total} 条`);
