'use strict';

/* 截图脚本：选择「每天」触发器并打开时间弹层 */
const run = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(500);
  const items = document.querySelectorAll('.tg-overview-item');
  if (!items.length) return 'overview not found';
  items[2].click();
  await sleep(400);
  const timeBtn = document.querySelector('[data-act="time"]');
  if (!timeBtn) return 'time btn not found';
  timeBtn.click();
  await sleep(400);
  return 'time picker opened';
};

run();
