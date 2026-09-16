'use strict';

/**
 * app.js —— 应用外壳：路由、公共工具、事件订阅
 */

(function () {
  const api = window.api;
  const layer = window.layui.layer;
  const util = window.layui.util;

  /* ------------------------------ 公共工具 ------------------------------ */

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTime(ts) {
    if (!ts) return '-';
    const d = new Date(Number(ts) * 1000);
    if (Number.isNaN(d.getTime())) return '-';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function sizeFormat(size) {
    const n = Number(size) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  let toastTimer = null;
  function toast(message, isError) {
    const el = document.getElementById('app-toast');
    el.textContent = message;
    el.className = `app-toast show${isError ? ' error' : ''}`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = 'app-toast';
    }, 2600);
  }

  let loadingIndex = null;
  function loading(text) {
    loadingIndex = layer.load(2, { shade: [0.2, '#fff'], content: text || '处理中…' });
  }
  function closeLoading() {
    if (loadingIndex !== null) layer.close(loadingIndex);
    loadingIndex = null;
  }

  function confirm(message, onOk) {
    layer.confirm(message, {
      title: '操作确认',
      btn: ['确定', '取消'],
      icon: 3,
    }, (index) => {
      layer.close(index);
      onOk();
    });
  }

  function renderPager(el, { count, limit, curr, onJump }) {
    if (!el) return;
    if (!count) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = '<div id="pager-host"></div>';
    window.layui.laypage.render({
      elem: 'pager-host',
      count,
      limit,
      curr,
      layout: ['count', 'prev', 'page', 'next', 'limit', 'skip'],
      limits: [5, 10, 15, 20, 50],
      jump(_obj, first) {
        if (first) return;
        onJump(_obj.curr);
      },
    });
  }

  function bindRowActions(container, handlers) {
    container.querySelectorAll('[data-act]').forEach((btn) => {
      const row = btn.closest('tr');
      const id = row ? Number(row.getAttribute('data-id')) : NaN;
      btn.onclick = () => {
        const handler = handlers[btn.getAttribute('data-act')];
        if (handler) handler(id);
      };
    });
  }

  function openBatchMenu(ids, onPick) {
    const html = `
      <ul class="tg-menu" id="batch-menu">
        <li data-action="active">激活所选任务</li>
        <li data-action="pause">暂停所选任务</li>
        <li data-action="delete" style="color:var(--danger)">删除所选任务</li>
      </ul>`;
    const index = layer.open({
      type: 1,
      title: `批量操作（已选 ${ids.length} 个）`,
      area: ['260px', 'auto'],
      shade: 0.15,
      offset: 'auto',
      content: html,
      success: () => {
        document.querySelectorAll('#batch-menu li').forEach((li) => {
          li.onclick = () => {
            layer.close(index);
            onPick(li.getAttribute('data-action'));
          };
        });
      },
    });
  }

  function showLogDetail(log) {
    const statusText = { 0: '成功', '-1': '失败', '-2': '超时' }[String(log.status)] || '未知';
    const badgeClass = String(log.status) === '0' ? 'badge-on' : (String(log.status) === '-2' ? 'badge-warn' : 'badge-err');
    const html = `
      <div class="log-meta">
        <span class="badge ${badgeClass}">${statusText}</span>
        <span>任务：#${log.taskId} ${escapeHtml(log.taskName)}</span>
        <span>开始：${formatTime(log.createTime)}</span>
        <span>耗时：${(Number(log.processTime) / 1000).toFixed(3)} 秒</span>
        <span>触发：${log.triggerBy === 'manual' ? '手动' : '定时'}</span>
      </div>
      <div class="field-label">执行输出</div>
      <div class="log-pre">${escapeHtml(log.output || '（无输出）')}</div>
      ${log.error ? `<div class="field-label mt16">错误信息</div><div class="log-pre err">${escapeHtml(log.error)}</div>` : ''}`;

    layer.open({
      type: 1,
      title: `执行日志 #${log.id}`,
      area: ['860px', '640px'],
      content: html,
      btn: ['关闭'],
      yes: (index) => layer.close(index),
    });
  }

  window.AppUtil = {
    pad,
    escapeHtml,
    formatTime,
    sizeFormat,
    toast,
    loading,
    closeLoading,
    confirm,
    renderPager,
    bindRowActions,
    openBatchMenu,
    showLogDetail,
  };

  /* ------------------------------ 路由 ------------------------------ */

  const ROUTES = [
    { test: /^#\/tasks\/?$/, nav: 'tasks', run: (root, ctx) => window.Pages.tasks(root, ctx) },
    { test: /^#\/task\/new\/?$/, nav: 'tasks', run: (root, ctx, m) => window.Pages.taskEditor(root, ctx, { id: 0 }) },
    { test: /^#\/task\/edit\/(\d+)$/, nav: 'tasks', run: (root, ctx, m) => window.Pages.taskEditor(root, ctx, { id: Number(m[1]) }) },
    { test: /^#\/logs/, nav: 'logs', run: (root, ctx, m, query) => window.Pages.logs(root, ctx, query) },
    { test: /^#\/groups\/?$/, nav: 'groups', run: (root, ctx) => window.Pages.groups(root, ctx) },
    { test: /^#\/settings\/?$/, nav: 'settings', run: (root, ctx) => window.Pages.settings(root, ctx) },
    { test: /^#\/help\/?$/, nav: 'help', run: (root, ctx) => window.Pages.help(root, ctx) },
  ];

  const ctx = {
    state: {},
    navigate(hash) {
      if (window.location.hash === hash) {
        render();
        return;
      }
      window.location.hash = hash;
    },
    reload() {
      render();
    },
  };

  let currentNav = 'tasks';
  let rendering = false;

  function parseQuery(hash) {
    const idx = hash.indexOf('?');
    if (idx < 0) return {};
    const params = new URLSearchParams(hash.slice(idx + 1));
    const out = {};
    params.forEach((value, key) => { out[key] = value; });
    return out;
  }

  async function render() {
    if (rendering) return;
    rendering = true;
    const hash = window.location.hash || '#/tasks';
    const base = hash.split('?')[0];
    const query = parseQuery(hash);
    const view = document.getElementById('view');

    const route = ROUTES.find((r) => r.test.test(base)) || ROUTES[0];
    const match = route.test.exec(base);

    if (route.nav !== currentNav) {
      currentNav = route.nav;
      document.querySelectorAll('#app-nav .layui-nav-item').forEach((li) => {
        li.classList.toggle('layui-this', li.getAttribute('data-route') === route.nav);
      });
    }

    try {
      await route.run(view, ctx, match, query);
    } catch (err) {
      view.innerHTML = `<div class="card"><div class="empty"><div class="empty-title">页面渲染失败</div><div>${escapeHtml(err.message)}</div></div></div>`;
    } finally {
      rendering = false;
    }
  }

  /* ------------------------------ 启动 ------------------------------ */

  async function boot() {
    window.layui.use(['layer', 'laypage', 'form', 'util'], () => {
      /* 模块就绪 */
    });

    // 顶部信息条
    try {
      const info = await api.appInfo();
      const chip = document.getElementById('chip-datadir');
      chip.textContent = `数据目录：${info.dataDir}`;
      chip.title = `${info.dataDir}（点击打开）`;
      chip.onclick = () => api.openDataDir();
      if (window.isPreviewMode) {
        document.getElementById('chip-scheduler').innerHTML = '<i class="app-dot paused"></i>浏览器预览模式（数据仅存于 localStorage）';
      }
    } catch (err) { /* ignore */ }

    // toast 容器
    const toastEl = document.createElement('div');
    toastEl.id = 'app-toast';
    toastEl.className = 'app-toast';
    document.body.appendChild(toastEl);

    window.addEventListener('hashchange', render);
    await render();

    // 事件订阅：任务执行完成后刷新列表
    api.onEvent(async (message) => {
      const { event, payload } = message || {};
      if (event === 'task:finished') {
        const ok = payload && payload.log && Number(payload.log.status) === 0;
        toast(`任务「${(payload && payload.taskName) || ''}」执行${ok ? '成功' : '异常'}`);
        if ((window.location.hash || '').startsWith('#/tasks')) render();
      } else if (event === 'task:skipped') {
        toast(`任务「${payload.taskName}」上次执行尚未结束，本次已跳过`, true);
      } else if (event === 'task:error') {
        toast(payload.message || '调度异常', true);
      }
    });

    // 每 30 秒刷新一次「下次执行时间」
    setInterval(() => {
      const hash = window.location.hash || '#/tasks';
      if (hash.startsWith('#/tasks')) render();
    }, 30000);
  }

  window.addEventListener('DOMContentLoaded', boot);
}());
