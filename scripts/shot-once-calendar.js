'use strict';

/* 截图脚本：选择「一次」触发器并打开日历弹层 */
const run = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(500);
  const items = document.querySelectorAll('.tg-overview-item');
  if (!items.length) return 'overview not found';
  items[0].click();
  await sleep(400);
  const dateBtn = document.querySelector('[data-act="date"]');
  if (!dateBtn) return 'date btn not found';
  dateBtn.click();
  await sleep(400);
  return 'calendar opened';
};

run();
