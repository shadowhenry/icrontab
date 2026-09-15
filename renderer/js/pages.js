'use strict';

/**
 * pages.js —— 各页面渲染与交互
 * 页面：任务列表 / 任务编辑 / 执行日志 / 分组管理 / 系统设置 / 使用帮助
 */

(function () {
  const api = window.api;
  const T = window.TriggerEngine;
  const U = () => window.AppUtil;

  const STATUS_TEXT = { 0: '成功', '-1': '失败', '-2': '超时' };

  function statusBadge(status) {
    const s = String(status);
    if (s === '0') return '<span class="badge badge-on">成功</span>';
    if (s === '-1') return '<span class="badge badge-err">失败</span>';
    if (s === '-2') return '<span class="badge badge-warn">超时</span>';
    return '<span class="badge badge-off">未知</span>';
  }

  function triggerBadge(triggerBy) {
    if (triggerBy === 'manual') return '<span class="badge badge-info">手动</span>';
    if (triggerBy === 'test') return '<span class="badge badge-off">测试</span>';
    return '<span class="badge badge-off">定时</span>';
  }

  const Pages = {};

  /* ============================== 任务列表 ============================== */

  Pages.tasks = async function (root, ctx) {
    const state = ctx.state.tasks || (ctx.state.tasks = { page: 1, pageSize: 10, groupId: 0, status: '', keyword: '' });
    const util = U();

    const [stats, groups] = await Promise.all([api.stats(), api.listGroups()]);

    root.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">任务总数</div><div class="stat-value">${stats.taskTotal}</div></div>
        <div class="stat-card"><div class="stat-label">启用中</div><div class="stat-value" style="color:var(--success)">${stats.taskActive}</div></div>
        <div class="stat-card"><div class="stat-label">已暂停</div><div class="stat-value" style="color:var(--text-muted)">${stats.taskPaused}</div></div>
        <div class="stat-card"><div class="stat-label">今日执行</div><div class="stat-value">${stats.todayRuns}</div></div>
        <div class="stat-card"><div class="stat-label">今日失败</div><div class="stat-value" style="color:${stats.todayFailed ? 'var(--danger)' : 'var(--text)'}">${stats.todayFailed}</div></div>
        <div class="stat-card"><div class="stat-label">分组数量</div><div class="stat-value">${stats.groupTotal}</div></div>
      </div>

      <div class="card">
        <div class="toolbar">
          <button class="btn" id="btn-batch" lay-dropdown="{注}">批量操作 <i class="layui-icon layui-icon-down" style="font-size:12px"></i></button>
          <button class="btn btn-primary" id="btn-new">+ 新建任务</button>
          <div class="spacer"></div>
          <select class="select" id="f-group" style="width:150px">
            <option value="0">全部分组</option>
            ${groups.map((g) => `<option value="${g.id}"${Number(state.groupId) === Number(g.id) ? ' selected' : ''}>${util.escapeHtml(g.groupName)}</option>`).join('')}
          </select>
          <select class="select" id="f-status" style="width:120px">
            <option value="">全部状态</option>
            <option value="1"${String(state.status) === '1' ? ' selected' : ''}>启用中</option>
            <option value="0"${String(state.status) === '0' ? ' selected' : ''}>已暂停</option>
          </select>
          <input class="input" id="f-keyword" style="width:220px" placeholder="搜索任务名称 / 指令" value="${util.escapeHtml(state.keyword)}">
          <button class="btn" id="btn-search">搜索</button>
        </div>

        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th style="width:36px"><input type="checkbox" id="chk-all"></th>
                <th style="width:50px">ID</th>
                <th style="width:90px">状态</th>
                <th>任务</th>
                <th style="width:250px">触发方式</th>
                <th style="width:150px">上次执行</th>
                <th style="width:150px">下次执行</th>
                <th style="width:260px">操作</th>
              </tr>
            </thead>
            <tbody id="task-body"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody>
          </table>
        </div>
        <div class="pager" id="pager"></div>
      </div>`;

    const body = root.querySelector('#task-body');

    async function reload() {
      const result = await api.listTasks(state);
      const util2 = U();

      if (!result.list.length) {
        body.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="empty-title">还没有任务</div><div>点击右上角「+ 新建任务」创建第一个定时任务</div></div></td></tr>`;
      } else {
        body.innerHTML = result.list.map((task) => `
          <tr data-id="${task.id}">
            <td><input type="checkbox" class="chk-row" value="${task.id}"></td>
            <td class="text-muted">${task.id}</td>
            <td>${Number(task.status) === 1 ? '<span class="badge badge-on"><i class="app-dot" style="width:6px;height:6px;box-shadow:none"></i>启用</span>' : '<span class="badge badge-off">暂停</span>'}</td>
            <td>
              <div class="cell-name">${util2.escapeHtml(task.taskName)}</div>
              <div class="cell-desc" title="${util2.escapeHtml(task.description || task.command)}">${util2.escapeHtml(task.description || task.command)}</div>
            </td>
            <td>
              <div>${util2.escapeHtml(task.triggerText)}</div>
              <span class="cell-cron">${util2.escapeHtml(task.cronClean)}</span>
            </td>
            <td class="cell-time">${task.prevTime ? util2.formatTime(task.prevTime) : '-'}</td>
            <td class="cell-time">${Number(task.status) === 1 && task.nextTime ? util2.formatTime(task.nextTime) : '-'}</td>
            <td>
              <div class="row-actions">
                ${Number(task.status) === 1
    ? `<button class="btn btn-sm" data-act="pause">暂停</button>`
    : `<button class="btn btn-sm" data-act="active">激活</button>`}
                <button class="btn btn-sm" data-act="run">执行</button>
                <button class="btn btn-sm" data-act="edit">编辑</button>
                <button class="btn btn-sm" data-act="logs">日志</button>
                <button class="btn btn-sm btn-danger" data-act="delete">删除</button>
              </div>
            </td>
          </tr>`).join('');
      }

      U().renderPager(root.querySelector('#pager'), {
        count: result.total,
        limit: state.pageSize,
        curr: state.page,
        onJump: (page) => {
          state.page = page;
          reload();
        },
      });

      U().bindRowActions(body, {
        active: async (id) => { await api.toggleTask(id, 1); U().toast('任务已激活'); reload(); },
        pause: async (id) => { await api.toggleTask(id, 0); U().toast('任务已暂停'); reload(); },
        run: async (id) => {
          U().confirm('该功能建议只用来做任务测试，确定要立即执行该任务吗？', async () => {
            U().loading('正在执行…');
            const res = await api.runTask(id);
            U().closeLoading();
            if (!res || res.ok === false) {
              U().toast((res && res.message) || '执行失败', true);
            } else {
              U().toast('执行完成');
            }
            reload();
          });
        },
        edit: (id) => ctx.navigate(`#/task/edit/${id}`),
        logs: (id) => ctx.navigate(`#/logs?taskId=${id}`),
        delete: (id) => {
          U().confirm('删除任务会同时删除它的执行日志，确定删除？', async () => {
            await api.deleteTasks([id]);
            U().toast('已删除');
            reload();
          });
        },
      });
    }

    root.querySelector('#btn-new').onclick = () => ctx.navigate('#/task/new');
    root.querySelector('#f-group').onchange = (e) => { state.groupId = e.target.value; state.page = 1; reload(); };
    root.querySelector('#f-status').onchange = (e) => { state.status = e.target.value; state.page = 1; reload(); };
    root.querySelector('#btn-search').onclick = () => {
      state.keyword = root.querySelector('#f-keyword').value.trim();
      state.page = 1;
      reload();
    };
    root.querySelector('#f-keyword').onkeydown = (e) => { if (e.key === 'Enter') root.querySelector('#btn-search').click(); };
    root.querySelector('#chk-all').onclick = (e) => {
      root.querySelectorAll('.chk-row').forEach((chk) => { chk.checked = e.target.checked; });
    };
    root.querySelector('#btn-batch').onclick = () => {
      const ids = Array.from(root.querySelectorAll('.chk-row:checked')).map((chk) => Number(chk.value));
      if (!ids.length) { U().toast('请先勾选要操作的任务', true); return; }
      U().openBatchMenu(ids, async (action) => {
        if (action === 'delete') {
          U().confirm(`确定删除选中的 ${ids.length} 个任务？`, async () => {
            await api.batchTasks('delete', ids);
            U().toast('已删除');
            reload();
          });
          return;
        }
        await api.batchTasks(action, ids);
        U().toast(action === 'active' ? '已批量激活' : '已批量暂停');
        reload();
      });
    };

    await reload();
  };

  /* ============================== 任务编辑 ============================== */

  Pages.taskEditor = async function (root, ctx, params) {
    const util = U();
    const id = params && params.id ? Number(params.id) : 0;
    const [task, groups, settings] = await Promise.all([
      id ? api.getTask(id) : Promise.resolve(null),
      api.listGroups(),
      api.getSettings(),
    ]);

    if (id && !task) {
      root.innerHTML = '<div class="card"><div class="empty"><div class="empty-title">任务不存在</div></div></div>';
      return;
    }

    const notifyMode = task ? Number(task.notify) : 1;
    const trigger = task && task.trigger ? task.trigger : null;
    const initialTrigger = task ? (trigger || T.fromCron(task.cronSpec)) : null;

    root.innerHTML = `
      <div class="editor-head">
        <button class="btn btn-ghost" id="back">← 返回</button>
        <input class="input" id="task-name" placeholder="给任务起个名字，例如：订单数据同步" value="${util.escapeHtml(task ? task.taskName : '')}">
        <div class="editor-actions">
          <label class="switch" title="启用/暂停"><input type="checkbox" id="task-status"${!task || Number(task.status) === 1 ? ' checked' : ''}><span></span></label>
          ${task ? `<button class="btn" id="btn-run">立即执行</button>` : ''}
          <button class="btn btn-primary" id="btn-save">保存任务</button>
        </div>
      </div>

      <div class="card">
        <div id="tg-host"></div>
      </div>

      <div class="card">
        <div class="field" style="margin-bottom:0">
          <label class="field-label">指令</label>
          <textarea class="textarea code" id="task-command" placeholder="例如：node D:/jobs/sync-orders.js --mode=incr">${util.escapeHtml(task ? task.command : '')}</textarea>
          <div class="field-hint">任务触发时交给系统 shell 执行。Windows 默认使用 <span class="app-mono">cmd.exe</span>，可在「系统设置」中切换为 PowerShell / Bash。</div>
        </div>
      </div>

      <div class="card">
        <div class="field-label">通知</div>
        <div class="radio-row" id="notify-row">
          <div class="radio-card${notifyMode === 2 ? ' active' : ''}" data-notify="2">每次都通知 <small>电子邮件 + 应用通知</small></div>
          <div class="radio-card${notifyMode === 1 ? ' active' : ''}" data-notify="1">仅失败时通知 <small>推荐</small></div>
          <div class="radio-card${notifyMode === 0 ? ' active' : ''}" data-notify="0">不通知 <small>只记录日志</small></div>
        </div>

        <div class="grid-2 mt16">
          <div class="field" style="margin-bottom:0">
            <label class="field-label">通知邮箱</label>
            <textarea class="textarea" id="notify-email" style="min-height:64px" placeholder="多个邮箱用换行或逗号分隔，例如：ops@example.com">${util.escapeHtml(task ? task.notifyEmail : '')}</textarea>
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field-label">Webhook 地址</label>
            <textarea class="textarea" id="notify-webhook" style="min-height:64px" placeholder="执行结果会以 JSON 形式 POST 到该地址">${util.escapeHtml(task ? task.notifyWebhook : '')}</textarea>
          </div>
        </div>
      </div>

      <details class="card editor-advanced"${task ? ' open' : ''}>
        <summary>高级设置（分组 / 超时 / 并发 / 描述）</summary>
        <div class="grid-2 mt16">
          <div class="field" style="margin-bottom:0">
            <label class="field-label">所属分组</label>
            <select class="select" id="task-group">
              <option value="0">未分组</option>
              ${groups.map((g) => `<option value="${g.id}"${task && Number(task.groupId) === Number(g.id) ? ' selected' : ''}>${util.escapeHtml(g.groupName)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field-label">执行超时（秒）</label>
            <input class="input" id="task-timeout" type="number" min="0" placeholder="0 表示不限制" value="${task && task.timeout ? task.timeout : ''}">
            <div class="field-hint">超过该时长会强制结束进程；留空或 0 表示按系统默认（${settings.timeout ? `${settings.timeout} 秒` : '不限制'}）。</div>
          </div>
        </div>
        <div class="mt16">
          <label class="field-label">并发控制</label>
          <div class="radio-row" id="concurrent-row">
            <div class="radio-card${!task || Number(task.concurrent) === 0 ? ' active' : ''}" data-concurrent="0">允许并行 <small>上次未结束也照常触发</small></div>
            <div class="radio-card${task && Number(task.concurrent) === 1 ? ' active' : ''}" data-concurrent="1">只允许一个实例 <small>上次未结束时跳过本次</small></div>
          </div>
        </div>
        <div class="field mt16" style="margin-bottom:0">
          <label class="field-label">任务描述</label>
          <textarea class="textarea" id="task-desc" style="min-height:60px" placeholder="这个任务是做什么的？">${util.escapeHtml(task ? task.description : '')}</textarea>
        </div>
      </details>`;

    const picker = new window.TriggerPicker(root.querySelector('#tg-host'), {
      value: initialTrigger,
      onChange: () => { /* 实时预览已在组件内部展示 */ },
    });

    let notify = notifyMode;
    let concurrent = task && Number(task.concurrent) === 1 ? 1 : 0;

    root.querySelectorAll('#notify-row .radio-card').forEach((card) => {
      card.onclick = () => {
        root.querySelectorAll('#notify-row .radio-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        notify = Number(card.getAttribute('data-notify'));
      };
    });

    root.querySelectorAll('#concurrent-row .radio-card').forEach((card) => {
      card.onclick = () => {
        root.querySelectorAll('#concurrent-row .radio-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        concurrent = Number(card.getAttribute('data-concurrent'));
      };
    });

    root.querySelector('#back').onclick = () => ctx.navigate('#/tasks');

    const runBtn = root.querySelector('#btn-run');
    if (runBtn) {
      runBtn.onclick = () => {
        U().confirm('确定立即执行一次该任务吗？', async () => {
          U().loading('正在执行…');
          const res = await api.runTask(id);
          U().closeLoading();
          if (!res || res.ok === false) U().toast((res && res.message) || '执行失败', true);
          else U().toast('执行完成，可在执行日志中查看输出');
        });
      };
    }

    root.querySelector('#btn-save').onclick = async () => {
      const name = root.querySelector('#task-name').value.trim();
      const command = root.querySelector('#task-command').value.trim();
      const cronSpec = picker.getCron();

      if (!name) { U().toast('请填写任务名称', true); return; }
      if (!cronSpec) { U().toast('请添加触发器', true); return; }
      if (!command) { U().toast('请填写执行指令', true); return; }

      const payload = {
        id: id || 0,
        taskName: name,
        command,
        triggerType: (picker.getValue() || {}).type || 'custom',
        trigger: picker.getValue(),
        cronSpec,
        status: root.querySelector('#task-status').checked ? 1 : 0,
        groupId: Number(root.querySelector('#task-group').value) || 0,
        timeout: Number(root.querySelector('#task-timeout').value) || 0,
        concurrent,
        notify,
        notifyEmail: root.querySelector('#notify-email').value.trim(),
        notifyWebhook: root.querySelector('#notify-webhook').value.trim(),
        description: root.querySelector('#task-desc').value.trim(),
      };

      U().loading('保存中…');
      const res = await api.saveTask(payload);
      U().closeLoading();
      if (!res || res.ok === false) {
        U().toast((res && res.message) || '保存失败', true);
        return;
      }
      U().toast('保存成功');
      ctx.navigate('#/tasks');
    };
  };

  /* ============================== 执行日志 ============================== */

  Pages.logs = async function (root, ctx, params) {
    const util = U();
    const state = ctx.state.logs || (ctx.state.logs = { page: 1, pageSize: 15, taskId: 0, status: '' });
    if (params && params.taskId) state.taskId = Number(params.taskId);

    const tasks = (await api.listTasks({ page: 1, pageSize: 0 })).list;

    root.innerHTML = `
      <div class="card">
        <div class="card-title">执行日志</div>
        <div class="card-sub">记录每次任务的开始时间、耗时、退出状态与完整输出</div>
        <div class="toolbar">
          <select class="select" id="f-task" style="width:240px">
            <option value="0">全部任务</option>
            ${tasks.map((t) => `<option value="${t.id}"${Number(state.taskId) === Number(t.id) ? ' selected' : ''}>#${t.id} ${util.escapeHtml(t.taskName)}</option>`).join('')}
          </select>
          <select class="select" id="f-status" style="width:130px">
            <option value="">全部状态</option>
            <option value="0"${String(state.status) === '0' ? ' selected' : ''}>成功</option>
            <option value="-1"${String(state.status) === '-1' ? ' selected' : ''}>失败</option>
            <option value="-2"${String(state.status) === '-2' ? ' selected' : ''}>超时</option>
          </select>
          <div class="spacer"></div>
          <button class="btn" id="btn-clear">清空日志</button>
        </div>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th style="width:60px">ID</th>
                <th>任务</th>
                <th style="width:80px">触发</th>
                <th style="width:160px">开始时间</th>
                <th style="width:100px">耗时</th>
                <th style="width:90px">状态</th>
                <th style="width:110px">输出大小</th>
                <th style="width:150px">操作</th>
              </tr>
            </thead>
            <tbody id="log-body"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody>
          </table>
        </div>
        <div class="pager" id="pager"></div>
      </div>`;

    const body = root.querySelector('#log-body');

    async function reload() {
      const result = await api.listLogs(state);
      const util2 = U();
      if (!result.list.length) {
        body.innerHTML = '<tr><td colspan="8"><div class="empty"><div class="empty-title">暂无执行记录</div><div>任务执行后这里会显示每次运行的输出与状态</div></div></td></tr>';
      } else {
        body.innerHTML = result.list.map((log) => `
          <tr>
            <td class="text-muted">${log.id}</td>
            <td class="cell-name">#${log.taskId} ${util2.escapeHtml(log.taskName)}</td>
            <td>${triggerBadge(log.triggerBy)}</td>
            <td class="cell-time">${util2.formatTime(log.createTime)}</td>
            <td class="cell-time">${(Number(log.processTime) / 1000).toFixed(2)}s</td>
            <td>${statusBadge(log.status)}</td>
            <td class="cell-time">${util2.sizeFormat((log.output || '').length)}</td>
            <td>
              <div class="row-actions">
                <button class="btn btn-sm" data-act="view" data-id="${log.id}">查看</button>
                <button class="btn btn-sm btn-danger" data-act="del" data-id="${log.id}">删除</button>
              </div>
            </td>
          </tr>`).join('');
      }

      U().renderPager(root.querySelector('#pager'), {
        count: result.total,
        limit: state.pageSize,
        curr: state.page,
        onJump: (page) => { state.page = page; reload(); },
      });

      body.querySelectorAll('[data-act="view"]').forEach((btn) => {
        btn.onclick = async () => {
          const log = await api.getLog(Number(btn.getAttribute('data-id')));
          if (log) U().showLogDetail(log);
        };
      });
      body.querySelectorAll('[data-act="del"]').forEach((btn) => {
        btn.onclick = () => {
          U().confirm('确定删除这条日志？', async () => {
            await api.deleteLogs([Number(btn.getAttribute('data-id'))]);
            U().toast('已删除');
            reload();
          });
        };
      });
    }

    root.querySelector('#f-task').onchange = (e) => { state.taskId = Number(e.target.value); state.page = 1; reload(); };
    root.querySelector('#f-status').onchange = (e) => { state.status = e.target.value; state.page = 1; reload(); };
    root.querySelector('#btn-clear').onclick = () => {
      const tip = Number(state.taskId) > 0 ? '确定清空该任务的所有日志？' : '确定清空全部执行日志？';
      U().confirm(tip, async () => {
        await api.clearLogs(Number(state.taskId) || 0);
        U().toast('已清空');
        reload();
      });
    };

    await reload();
  };

  /* ============================== 分组管理 ============================== */

  Pages.groups = async function (root, ctx) {
    const util = U();

    async function render() {
      const groups = await api.listGroups();
      root.innerHTML = `
        <div class="card">
          <div class="card-title">分组管理</div>
          <div class="card-sub">用分组给任务归类，任务列表中可按分组筛选</div>
          <div class="toolbar">
            <button class="btn btn-primary" id="btn-add">+ 新建分组</button>
            <div class="spacer"></div>
            <span class="text-muted" style="font-size:12px">共 ${groups.length} 个分组</span>
          </div>
          <div class="table-wrap">
            <table class="grid">
              <thead>
                <tr>
                  <th style="width:60px">ID</th>
                  <th style="width:220px">分组名称</th>
                  <th>说明</th>
                  <th style="width:120px">任务数</th>
                  <th style="width:160px">操作</th>
                </tr>
              </thead>
              <tbody>
                ${groups.length ? groups.map((g) => `
                  <tr>
                    <td class="text-muted">${g.id}</td>
                    <td class="cell-name">${util.escapeHtml(g.groupName)}</td>
                    <td class="text-muted">${util.escapeHtml(g.description || '-')}</td>
                    <td>${g.taskCount}</td>
                    <td>
                      <div class="row-actions">
                        <button class="btn btn-sm" data-act="edit" data-id="${g.id}">编辑</button>
                        <button class="btn btn-sm btn-danger" data-act="del" data-id="${g.id}">删除</button>
                      </div>
                    </td>
                  </tr>`).join('')
    : '<tr><td colspan="5"><div class="empty"><div class="empty-title">暂无分组</div></div></td></tr>'}
              </tbody>
            </table>
          </div>
        </div>`;

      root.querySelector('#btn-add').onclick = () => openEditor(null);

      root.querySelectorAll('[data-act="edit"]').forEach((btn) => {
        btn.onclick = () => openEditor(groups.find((g) => Number(g.id) === Number(btn.getAttribute('data-id'))));
      });
      root.querySelectorAll('[data-act="del"]').forEach((btn) => {
        btn.onclick = () => {
          U().confirm('删除分组后，组内任务会变为「未分组」，确定删除？', async () => {
            await api.deleteGroup(Number(btn.getAttribute('data-id')));
            U().toast('已删除');
            render();
          });
        };
      });
    }

    function openEditor(group) {
      const layer = window.layui.layer;
      layer.open({
        type: 1,
        title: group ? '编辑分组' : '新建分组',
        area: ['460px', 'auto'],
        content: `
          <div class="field">
            <label class="field-label">分组名称</label>
            <input class="input" id="g-name" value="${group ? U().escapeHtml(group.groupName) : ''}" placeholder="例如：数据同步">
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field-label">说明</label>
            <textarea class="textarea" id="g-desc" style="min-height:60px" placeholder="可选">${group ? U().escapeHtml(group.description || '') : ''}</textarea>
          </div>`,
        btn: ['保存', '取消'],
        yes: async (index) => {
          const name = document.querySelector('#g-name').value.trim();
          const description = document.querySelector('#g-desc').value.trim();
          if (!name) { U().toast('分组名称不能为空', true); return; }
          const res = await api.saveGroup({ id: group ? group.id : 0, groupName: name, description });
          if (res && res.ok === false) { U().toast(res.message, true); return; }
          layer.close(index);
          U().toast('保存成功');
          render();
        },
      });
    }

    await render();
  };

  /* ============================== 系统设置 ============================== */

  Pages.settings = async function (root, ctx) {
    const util = U();
    const [info, settings] = await Promise.all([api.appInfo(), api.getSettings()]);
    const mail = (settings.notify && settings.notify.mail) || {};
    const webhook = (settings.notify && settings.notify.webhook) || {};

    root.innerHTML = `
      <div class="card">
        <div class="card-title">数据存储</div>
        <div class="card-sub">任务、分组、日志与设置均保存在本地 JSON 文件中，无需数据库</div>
        <div class="field" style="margin-bottom:0">
          <label class="field-label">数据目录</label>
          <div style="display:flex;gap:10px">
            <input class="input app-mono" id="data-dir" value="${util.escapeHtml(info.dataDir || '')}" readonly>
            <button class="btn" id="btn-open-dir">打开目录</button>
            <button class="btn" id="btn-change-dir">切换目录</button>
          </div>
          <div class="field-hint">包含 <span class="app-mono">tasks.json</span>、<span class="app-mono">groups.json</span>、<span class="app-mono">logs.json</span>、<span class="app-mono">settings.json</span>，可直接备份或迁移。</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">执行设置</div>
        <div class="grid-2">
          <div class="field" style="margin-bottom:0">
            <label class="field-label">命令解释器</label>
            <select class="select" id="set-shell">
              <option value=""${!settings.shell ? ' selected' : ''}>跟随系统（${info.platform === 'win32' ? 'cmd.exe' : '/bin/bash'}）</option>
              <option value="cmd"${settings.shell === 'cmd' ? ' selected' : ''}>cmd.exe</option>
              <option value="powershell"${settings.shell === 'powershell' ? ' selected' : ''}>PowerShell</option>
              <option value="bash"${settings.shell === 'bash' ? ' selected' : ''}>Bash</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field-label">同时执行的任务数上限</label>
            <input class="input" id="set-pool" type="number" min="1" max="64" value="${settings.poolSize || 8}">
            <div class="field-hint">对应 webcron 的 jobs.pool，超出上限的任务会排队等待。</div>
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field-label">默认超时（秒）</label>
            <input class="input" id="set-timeout" type="number" min="0" value="${settings.timeout || 0}">
            <div class="field-hint">任务未单独设置超时时使用，0 表示不限制。</div>
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field-label">日志保留条数</label>
            <input class="input" id="set-retention" type="number" min="100" value="${settings.logRetention || 2000}">
            <div class="field-hint">超出后自动删除最早的日志，避免 JSON 文件无限增长。</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">通知</div>
        <div class="field">
          <label class="field-label">桌面通知</label>
          <label class="switch"><input type="checkbox" id="set-desktop"${settings.notify && settings.notify.desktop ? ' checked' : ''}><span></span></label>
          <span class="text-muted" style="font-size:12px;margin-left:10px">任务失败或按任务设置需要通知时，弹出系统通知</span>
        </div>
        <div class="field">
          <label class="field-label">邮件通知（SMTP）</label>
          <label class="switch"><input type="checkbox" id="set-mail-enabled"${mail.enabled ? ' checked' : ''}><span></span></label>
          <span class="text-muted" style="font-size:12px;margin-left:10px">开启后，任务通知邮箱中的地址会收到执行结果邮件</span>
        </div>
        <div class="grid-2">
          <div class="field" style="margin-bottom:0">
            <label class="field-label">SMTP 服务器</label>
            <input class="input" id="set-mail-host" placeholder="smtp.example.com" value="${util.escapeHtml(mail.host || '')}">
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field-label">端口 / 加密</label>
            <div style="display:flex;gap:10px">
              <input class="input" id="set-mail-port" type="number" value="${mail.port || 465}" style="width:120px">
              <select class="select" id="set-mail-secure">
                <option value="1"${mail.secure !== false ? ' selected' : ''}>SSL（465）</option>
                <option value="0"${mail.secure === false ? ' selected' : ''}>STARTTLS（587）</option>
              </select>
            </div>
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field-label">账号</label>
            <input class="input" id="set-mail-user" value="${util.escapeHtml(mail.user || '')}">
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field-label">密码 / 授权码</label>
            <input class="input" id="set-mail-pass" type="password" value="${util.escapeHtml(mail.pass || '')}">
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field-label">发件人</label>
            <input class="input" id="set-mail-from" placeholder="留空则使用账号" value="${util.escapeHtml(mail.from || '')}">
          </div>
        </div>
        <div class="field mt16" style="margin-bottom:0">
          <label class="field-label">默认 Webhook 地址</label>
          <input class="input" id="set-webhook-url" placeholder="https://example.com/hooks/icrontab" value="${util.escapeHtml(webhook.url || '')}">
          <div class="field-hint">任务未单独填写 Webhook 时使用该地址，执行结果以 JSON 形式 POST 过去。</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">其它</div>
        <div class="field">
          <label class="field-label">开机自动启动</label>
          <label class="switch"><input type="checkbox" id="set-autolaunch"${info.autoLaunch ? ' checked' : ''}${info.platform === 'browser-preview' ? ' disabled' : ''}><span></span></label>
          ${info.platform === 'browser-preview' ? '<span class="text-muted" style="font-size:12px;margin-left:10px">仅桌面端可用</span>' : ''}
        </div>
        <div class="log-meta">
          <span>icrontab ${util.escapeHtml(info.version)}</span>
          <span>Electron ${util.escapeHtml(info.electron)}</span>
          <span>Node ${util.escapeHtml(info.node)}</span>
          <span>平台 ${util.escapeHtml(info.platform)}</span>
        </div>
        <button class="btn btn-primary" id="btn-save">保存设置</button>
      </div>`;

    root.querySelector('#btn-open-dir').onclick = async () => {
      const res = await api.openDataDir();
      if (res && res.ok === false) U().toast(res.message || '该环境不支持', true);
    };
    root.querySelector('#btn-change-dir').onclick = async () => {
      const res = await api.changeDataDir();
      if (res && res.ok) {
        U().toast('数据目录已切换');
        ctx.reload();
      } else if (res && res.message) {
        U().toast(res.message, true);
      }
    };

    root.querySelector('#btn-save').onclick = async () => {
      const payload = {
        shell: root.querySelector('#set-shell').value,
        poolSize: Number(root.querySelector('#set-pool').value) || 8,
        timeout: Number(root.querySelector('#set-timeout').value) || 0,
        logRetention: Number(root.querySelector('#set-retention').value) || 2000,
        notify: {
          desktop: root.querySelector('#set-desktop').checked,
          mail: {
            enabled: root.querySelector('#set-mail-enabled').checked,
            host: root.querySelector('#set-mail-host').value.trim(),
            port: Number(root.querySelector('#set-mail-port').value) || 465,
            secure: root.querySelector('#set-mail-secure').value === '1',
            user: root.querySelector('#set-mail-user').value.trim(),
            pass: root.querySelector('#set-mail-pass').value,
            from: root.querySelector('#set-mail-from').value.trim(),
          },
          webhook: {
            enabled: !!root.querySelector('#set-webhook-url').value.trim(),
            url: root.querySelector('#set-webhook-url').value.trim(),
            method: 'POST',
          },
        },
        autoLaunch: root.querySelector('#set-autolaunch').checked,
      };
      U().loading('保存中…');
      const res = await api.saveSettings(payload);
      U().closeLoading();
      if (!res || res.ok === false) { U().toast('保存失败', true); return; }
      U().toast('设置已保存');
    };
  };

  /* ============================== 使用帮助 ============================== */

  Pages.help = async function (root) {
    root.innerHTML = `
      <div class="card">
        <div class="card-title">触发方式说明</div>
        <div class="card-sub">icrontab 提供六种可视化触发方式，底层统一转换为 cron 表达式</div>
        <table class="grid">
          <thead><tr><th style="width:140px">触发方式</th><th style="width:200px">含义</th><th>示例表达式</th></tr></thead>
          <tbody>
            <tr><td class="cell-name">一次</td><td class="text-muted">在选定的日期和时间执行一次</td><td><span class="app-mono">0 20 14 15 9 *</span></td></tr>
            <tr><td class="cell-name">每小时</td><td class="text-muted">在所选小时内每小时执行</td><td><span class="app-mono">0 5 * * * *</span>（每小时第 5 分）</td></tr>
            <tr><td class="cell-name">每天</td><td class="text-muted">每天在选定的时间执行</td><td><span class="app-mono">0 0 9 * * *</span></td></tr>
            <tr><td class="cell-name">每周</td><td class="text-muted">每周在选定的一天执行</td><td><span class="app-mono">0 30 3 * * 0</span>（每周日 03:30）</td></tr>
            <tr><td class="cell-name">每月</td><td class="text-muted">每月在选定的一天执行</td><td><span class="app-mono">0 0 2 1 * *</span></td></tr>
            <tr><td class="cell-name">每年</td><td class="text-muted">每年在选定的日期执行</td><td><span class="app-mono">0 0 8 1 1 *</span></td></tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title">Cron 表达式</div>
        <div class="card-sub">表达式以空格分隔，共 5 或 6 个域，第二个可选域为「秒」</div>
        <div class="help-code">Seconds Minutes Hours DayofMonth Month [DayofWeek]

Seconds      0-59   支持 * / , -
Minutes      0-59   支持 * / , -
Hours        0-23   支持 * / , -
DayofMonth   1-31   支持 * / , - ?
Month        1-12   支持 * / , -   也可写 JAN-DEC
DayofWeek    0-6    支持 * / , - ? 也可写 SUN-SAT（0 = 周日）

*    任意值      ?    不指定（仅日/周可用）
-    区间，如 5-20
/    步长，如 0/30 表示每 30 分钟
,    枚举，如 5,20</div>
        <div class="field-hint mt8">示例：</div>
        <div class="help-code mt8">0 0 10,14,16 * * ?    每天 10 点、14 点、16 点执行
0 0/30 9-17 * * ?     朝九晚五之间每 30 分钟执行
0 15 10 ? * MON-FRI   周一至周五 10:15 执行
0 15 10 15 * ?        每月 15 日 10:15 执行</div>
      </div>

      <div class="card">
        <div class="card-title">与 lisijie/webcron 的对应关系</div>
        <div class="card-sub">本项目在逻辑上完整参考了 webcron，并把后端从 Go + MySQL 换成 Electron 主进程 + JSON 文件</div>
        <ul class="help-list">
          <li><b>webcron 的 app/jobs/cron.go</b> → <span class="app-mono">main/scheduler.js</span>：任务注册、注销、下一次执行时间计算、并发池（jobs.pool）</li>
          <li><b>webcron 的 app/jobs/job.go</b> → <span class="app-mono">main/runner.js</span>：shell 执行、超时强杀、输出记录</li>
          <li><b>webcron 的 app/models/*.go + install.sql</b> → <span class="app-mono">main/store.js</span>：任务 / 分组 / 日志 / 设置，落盘为 JSON</li>
          <li><b>webcron 的邮件通知</b> → <span class="app-mono">main/notifier.js + main/mailer.js</span>：桌面通知、SMTP 邮件、Webhook</li>
          <li><b>webcron 的 views（Bootstrap）</b> → <span class="app-mono">renderer/*</span>：改用 Layui 主题，触发器交互按截图实现</li>
        </ul>
      </div>`;
  };

  window.Pages = Pages;
  window.PagesHelpers = { statusBadge, triggerBadge, STATUS_TEXT };
}());
