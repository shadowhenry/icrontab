'use strict';

/* 截图脚本：选择「每周」触发器，展示星期多选 */
const run = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(500);
  const items = document.querySelectorAll('.tg-overview-item');
  if (!items.length) return 'overview not found';
  items[3].click();
  await sleep(400);
  const chips = document.querySelectorAll('[data-dow]');
  if (chips.length) {
    chips[1].click();
    chips[3].click();
    chips[5].click();
  }
  await sleep(300);
  return 'weekly selected';
};

run();
