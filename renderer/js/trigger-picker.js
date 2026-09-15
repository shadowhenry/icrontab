'use strict';

/**
 * trigger-picker.js —— 触发器选择组件
 *
 * 交互参考截图：
 *   1. 未设置触发器时显示「+ 添加触发器」虚线按钮；
 *   2. 点击后弹出「概况」列表，列出六种触发方式（一次/每小时/每天/每周/每月/每年）；
 *   3. 选中后折叠为一行：[图标] [一次 ▾] 在 [2026年9月15日] 于 [2:20 PM] [删除]；
 *   4. 日期按钮弹出月历浮层，时间按钮弹出 HH : MM + AM/PM 浮层。
 */

(function () {
  const T = window.TriggerEngine;
  const cron = window.CronEngine;

  const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7.2V12l3.2 2"></path></svg>';
  const ICON_CARET = '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"></path><path d="M10 11v6M14 11v6"></path></svg>';
  const ICON_PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"></path></svg>';
  const ICON_NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg>';

  const MONTH_CN = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

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

  function formatDateCN(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '选择日期';
    return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
  }

  function to12h(hour) {
    const h = Number(hour) || 0;
    const period = h < 12 ? 'AM' : 'PM';
    const display = h % 12 === 0 ? 12 : h % 12;
    return { display, period };
  }

  function formatTime(hour, minute) {
    const { display, period } = to12h(hour);
    return `${display}:${pad(minute)} ${period}`;
  }

  class TriggerPicker {
    /**
     * @param {HTMLElement} container 承载组件的容器
     * @param {{value?: object, onChange?: Function, compact?: boolean}} options
     */
    constructor(container, options) {
      this.container = container;
      this.options = options || {};
      this.value = this.options.value ? JSON.parse(JSON.stringify(this.options.value)) : null;
      this.overviewOpen = !this.value;
      this.popover = null;
      this.calendarMonth = new Date();
      this.onChange = this.options.onChange || (() => {});

      this._onDocClick = (evt) => {
        if (!this.popover) return;
        if (this.popover.el.contains(evt.target)) return;
        if (this.container.contains(evt.target)) return;
        this.closePopover();
      };
      this._onKeydown = (evt) => {
        if (evt.key === 'Escape') this.closePopover();
      };
      this._onReposition = () => this.closePopover();

      document.addEventListener('mousedown', this._onDocClick);
      document.addEventListener('keydown', this._onKeydown);
      window.addEventListener('resize', this._onReposition);
      window.addEventListener('scroll', this._onReposition, true);

      this.render();
    }

    destroy() {
      document.removeEventListener('mousedown', this._onDocClick);
      document.removeEventListener('keydown', this._onKeydown);
      window.removeEventListener('resize', this._onReposition);
      window.removeEventListener('scroll', this._onReposition, true);
      this.closePopover();
      this.container.innerHTML = '';
    }

    /* ------------------------------ 取值 ------------------------------ */

    getValue() {
      return this.value ? JSON.parse(JSON.stringify(this.value)) : null;
    }

    /** 返回用于保存的 cron 表达式（一次性任务带 #once 标记） */
    getCron() {
      if (!this.value) return '';
      return T.toCron(this.value);
    }

    /** 用于界面展示的 cron（去掉内部标记） */
    getCleanCron() {
      return T.splitSpec(this.getCron()).spec;
    }

    setValue(value) {
      this.value = value ? JSON.parse(JSON.stringify(value)) : null;
      this.overviewOpen = !this.value;
      this.render();
    }

    _update(patch) {
      this.value = Object.assign({}, this.value || T.defaultTrigger(), patch);
      this.render();
      this.onChange(this.getValue(), this.getCron());
    }

    /* ------------------------------ 渲染 ------------------------------ */

    render() {
      if (!this.value) {
        this.container.innerHTML = `
          <div class="tg">
            <div class="tg-title">触发器</div>
            <button type="button" class="tg-add" data-act="open-overview"><span class="tg-plus">+</span> 添加触发器</button>
            <div data-slot="overview"></div>
          </div>`;
        if (this.overviewOpen) this._renderOverview();
        this.container.querySelector('[data-act="open-overview"]').onclick = () => {
          this.overviewOpen = true;
          this.render();
        };
        return;
      }

      const t = this.value;
      const typeInfo = T.TYPE_MAP[t.type] || { label: '自定义' };
      const rowParts = [];

      rowParts.push(`<button type="button" class="tg-icon tg-icon-btn" data-act="type" title="切换触发方式">${ICON_CLOCK}</button>`);
      rowParts.push(`<button type="button" class="tg-seg" data-act="type">${escapeHtml(typeInfo.label)} ${ICON_CARET}</button>`);

      if (t.type === 'once') {
        rowParts.push('<span class="tg-word">在</span>');
        rowParts.push(`<button type="button" class="tg-seg" data-act="date">${escapeHtml(formatDateCN(t.date))}</button>`);
        rowParts.push('<span class="tg-word">于</span>');
        rowParts.push(`<button type="button" class="tg-seg" data-act="time">${escapeHtml(this._timeText())}</button>`);
      } else if (t.type === 'hourly') {
        rowParts.push(`<span class="tg-word">每小时的第</span>`);
        rowParts.push(`<button type="button" class="tg-seg" data-act="minute">${pad(t.minute || 0)} 分</button>`);
      } else if (t.type === 'daily') {
        rowParts.push('<span class="tg-word">于</span>');
        rowParts.push(`<button type="button" class="tg-seg" data-act="time">${escapeHtml(this._timeText())}</button>`);
      } else if (t.type === 'weekly') {
        rowParts.push('<span class="tg-word">在</span>');
        rowParts.push(`<button type="button" class="tg-seg" data-act="weekday">${escapeHtml(this._weekdayText())}</button>`);
        rowParts.push('<span class="tg-word">于</span>');
        rowParts.push(`<button type="button" class="tg-seg" data-act="time">${escapeHtml(this._timeText())}</button>`);
      } else if (t.type === 'monthly') {
        rowParts.push('<span class="tg-word">在</span>');
        rowParts.push(`<button type="button" class="tg-seg" data-act="day">${escapeHtml(this._dayText())}</button>`);
        rowParts.push('<span class="tg-word">于</span>');
        rowParts.push(`<button type="button" class="tg-seg" data-act="time">${escapeHtml(this._timeText())}</button>`);
      } else if (t.type === 'yearly') {
        rowParts.push('<span class="tg-word">在</span>');
        rowParts.push(`<button type="button" class="tg-seg" data-act="monthday">${escapeHtml(this._monthDayText())}</button>`);
        rowParts.push('<span class="tg-word">于</span>');
        rowParts.push(`<button type="button" class="tg-seg" data-act="time">${escapeHtml(this._timeText())}</button>`);
      }

      rowParts.push(`<button type="button" class="tg-trash" data-act="remove" title="移除触发器">${ICON_TRASH}</button>`);

      this.container.innerHTML = `
        <div class="tg">
          <div class="tg-title">触发器</div>
          <div class="tg-row">${rowParts.join('')}</div>
          <div data-slot="extra"></div>
          <div data-slot="hint"></div>
        </div>`;

      this._bindRow();
      this._renderExtra();
      this._renderHint();
    }

    _timeText() {
      const { hour, minute } = T.parseTime(this.value.time);
      return formatTime(hour, minute);
    }

    _weekdayText() {
      const list = Array.isArray(this.value.weekdays) && this.value.weekdays.length
        ? this.value.weekdays
        : [new Date().getDay()];
      if (list.length === 7) return '每天';
      return list.slice().sort((a, b) => a - b).map((d) => T.DOW_CN[d]).join('、');
    }

    _dayText() {
      const list = Array.isArray(this.value.days) && this.value.days.length ? this.value.days : [1];
      return `每月 ${list.slice().sort((a, b) => a - b).join('、')} 日`;
    }

    _monthDayText() {
      return `${Number(this.value.month) || 1}月${Number(this.value.day) || 1}日`;
    }

    _renderOverview() {
      const slot = this.container.querySelector('[data-slot="overview"]');
      if (!slot) return;
      const current = this.value ? this.value.type : '';
      slot.innerHTML = `
        <div class="tg-overview mt8">
          <div class="tg-overview-head">概况</div>
          <ul class="tg-overview-list">
            ${T.TYPES.map((item) => `
              <li class="tg-overview-item${item.type === current ? ' active' : ''}" data-type="${item.type}">
                <span class="tg-icon">${ICON_CLOCK}</span>
                <span class="tg-overview-text"><b>${item.label}</b><small>${item.desc}</small></span>
              </li>`).join('')}
          </ul>
        </div>`;

      slot.querySelectorAll('.tg-overview-item').forEach((el) => {
        el.onclick = () => {
          const type = el.getAttribute('data-type');
          this.overviewOpen = false;
          this._applyType(type);
        };
      });
    }

    /** 切换触发方式，保留已填的时间信息 */
    _applyType(type) {
      const now = new Date();
      const base = T.defaultTrigger(type);
      if (this.value) {
        const { hour, minute } = T.parseTime(this.value.time);
        base.time = `${pad(hour)}:${pad(minute)}`;
        if (this.value.minute !== undefined && type === 'hourly') base.minute = this.value.minute;
        if (type === 'once' && this.value.date) base.date = this.value.date;
        if (type === 'weekly' && this.value.weekdays && this.value.weekdays.length) base.weekdays = this.value.weekdays.slice();
        if (type === 'monthly' && this.value.days && this.value.days.length) base.days = this.value.days.slice();
        if (type === 'yearly') {
          base.month = this.value.month || base.month;
          base.day = this.value.day || base.day;
        }
      }
      if (type === 'weekly' && !base.weekdays.length) base.weekdays = [now.getDay()];
      if (type === 'monthly' && !base.days.length) base.days = [now.getDate()];
      this._update(base);
    }

    _bindRow() {
      const typeBtn = this.container.querySelectorAll('[data-act="type"]');
      typeBtn.forEach((btn) => {
        btn.onclick = (evt) => {
          evt.stopPropagation();
          this.toggleTypeMenu(btn);
        };
      });

      const dateBtn = this.container.querySelector('[data-act="date"]');
      if (dateBtn) dateBtn.onclick = (evt) => { evt.stopPropagation(); this.toggleCalendar(dateBtn); };

      const timeBtn = this.container.querySelector('[data-act="time"]');
      if (timeBtn) timeBtn.onclick = (evt) => { evt.stopPropagation(); this.toggleTimePicker(timeBtn); };

      const minuteBtn = this.container.querySelector('[data-act="minute"]');
      if (minuteBtn) minuteBtn.onclick = (evt) => { evt.stopPropagation(); this.toggleMinutePicker(minuteBtn); };

      const removeBtn = this.container.querySelector('[data-act="remove"]');
      if (removeBtn) {
        removeBtn.onclick = () => {
          this.value = null;
          this.overviewOpen = true;
          this.render();
          this.onChange(null, '');
        };
      }
    }

    /** 触发器下方的附加参数区 */
    _renderExtra() {
      const slot = this.container.querySelector('[data-slot="extra"]');
      if (!slot) return;
      const t = this.value;

      if (t.type === 'hourly') {
        const hours = Array.isArray(t.hours) ? t.hours : [];
        const all = hours.length === 0;
        slot.innerHTML = `
          <div class="tg-extra">
            <span class="tg-extra-label">在所选小时内每小时执行：</span>
            <div class="tg-chips">
              <button type="button" class="tg-chip${all ? ' active' : ''}" data-hour="all">全天</button>
              ${Array.from({ length: 24 }, (_, h) => `<button type="button" class="tg-chip${hours.includes(h) ? ' active' : ''}" data-hour="${h}">${pad(h)}</button>`).join('')}
            </div>
          </div>`;
        slot.querySelectorAll('[data-hour]').forEach((btn) => {
          btn.onclick = () => {
            const value = btn.getAttribute('data-hour');
            if (value === 'all') {
              this._update({ hours: [] });
              return;
            }
            const h = Number(value);
            const next = new Set(Array.isArray(this.value.hours) ? this.value.hours : []);
            if (next.has(h)) next.delete(h);
            else next.add(h);
            this._update({ hours: Array.from(next).sort((a, b) => a - b) });
          };
        });
        return;
      }

      if (t.type === 'weekly') {
        const selected = Array.isArray(t.weekdays) ? t.weekdays : [];
        slot.innerHTML = `
          <div class="tg-extra">
            <span class="tg-extra-label">在每周的：</span>
            <div class="tg-chips">
              ${T.DOW_CN.map((label, idx) => `<button type="button" class="tg-chip${selected.includes(idx) ? ' active' : ''}" data-dow="${idx}">${label}</button>`).join('')}
            </div>
          </div>`;
        slot.querySelectorAll('[data-dow]').forEach((btn) => {
          btn.onclick = () => {
            const dow = Number(btn.getAttribute('data-dow'));
            const next = new Set(Array.isArray(this.value.weekdays) ? this.value.weekdays : []);
            if (next.has(dow)) next.delete(dow);
            else next.add(dow);
            this._update({ weekdays: Array.from(next).sort((a, b) => a - b) });
          };
        });
        return;
      }

      if (t.type === 'monthly') {
        const selected = Array.isArray(t.days) ? t.days : [];
        slot.innerHTML = `
          <div class="tg-extra" style="align-items:flex-start">
            <span class="tg-extra-label">在每月的：</span>
            <div class="tg-daygrid" style="flex:1">
              ${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<button type="button" class="tg-daycell${selected.includes(d) ? ' active' : ''}" data-day="${d}">${d}</button>`).join('')}
            </div>
          </div>`;
        slot.querySelectorAll('[data-day]').forEach((btn) => {
          btn.onclick = () => {
            const day = Number(btn.getAttribute('data-day'));
            const next = new Set(Array.isArray(this.value.days) ? this.value.days : []);
            if (next.has(day)) next.delete(day);
            else next.add(day);
            this._update({ days: Array.from(next).sort((a, b) => a - b) });
          };
        });
        return;
      }

      if (t.type === 'yearly') {
        slot.innerHTML = `
          <div class="tg-extra">
            <span class="tg-extra-label">在每年的：</span>
            <select class="select" data-year-month style="width:110px">
              ${MONTH_CN.map((label, idx) => `<option value="${idx + 1}"${Number(t.month) === idx + 1 ? ' selected' : ''}>${label}</option>`).join('')}
            </select>
            <select class="select" data-year-day style="width:100px">
              ${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<option value="${d}"${Number(t.day) === d ? ' selected' : ''}>${d} 日</option>`).join('')}
            </select>
          </div>`;
        const monthSel = slot.querySelector('[data-year-month]');
        const daySel = slot.querySelector('[data-year-day]');
        if (monthSel) monthSel.onchange = () => this._update({ month: Number(monthSel.value) });
        if (daySel) daySel.onchange = () => this._update({ day: Number(daySel.value) });
        return;
      }

      slot.innerHTML = '';
    }

    /** 展示 cron 表达式与后续执行时间预览 */
    _renderHint() {
      const slot = this.container.querySelector('[data-slot="hint"]');
      if (!slot) return;
      const spec = this.getCleanCron();
      const check = cron.validate(spec);
      if (!check.ok) {
        slot.innerHTML = `<div class="field-hint text-danger">表达式有误：${escapeHtml(check.message)}</div>`;
        return;
      }

      const times = [];
      let cursor = new Date();
      for (let i = 0; i < 3; i++) {
        const next = cron.next(spec, cursor);
        if (!next) break;
        times.push(next);
        cursor = next;
      }
      const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

      slot.innerHTML = `
        <div class="field-hint">
          <span class="app-mono cell-cron">${escapeHtml(spec)}</span>
          &nbsp;${times.length ? `接下来：${times.map(fmt).join(' · ')}` : '（无后续执行时间）'}
        </div>`;
    }

    /* ------------------------------ 浮层 ------------------------------ */

    closePopover() {
      if (this.popover && this.popover.el && this.popover.el.parentNode) {
        this.popover.el.parentNode.removeChild(this.popover.el);
      }
      this.popover = null;
      this._clearBackdrop();
    }

    _clearBackdrop() {
      const port = document.getElementById('tg-portal');
      if (!port) return;
      const backdrop = port.querySelector('.tg-backdrop');
      if (backdrop && this.popover && this.popover.withBackdrop) return;
      if (backdrop) backdrop.remove();
    }

    _openPopover(anchor, html, opts) {
      const options = opts || {};
      this.closePopover();

      if (options.withBackdrop) {
        const port = document.getElementById('tg-portal');
        if (port && !port.querySelector('.tg-backdrop')) {
          const backdrop = document.createElement('div');
          backdrop.className = 'tg-backdrop';
          backdrop.style.cssText = 'position:absolute;inset:0;pointer-events:auto;background:transparent';
          backdrop.onclick = () => this.closePopover();
          port.appendChild(backdrop);
        }
      }

      const port = document.getElementById('tg-portal');
      const el = document.createElement('div');
      el.className = `tg-popover${options.className ? ` ${options.className}` : ''}`;
      el.innerHTML = html;
      port.appendChild(el);

      const rect = anchor.getBoundingClientRect();
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      let left = options.alignRight ? rect.right - width : rect.left;
      left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
      let top = rect.bottom + 8;
      if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 8);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;

      this.popover = { el, anchor, withBackdrop: !!options.withBackdrop };
      return el;
    }

    toggleTypeMenu(anchor) {
      if (this.popover && this.popover.kind === 'type') {
        this.closePopover();
        return;
      }
      const html = `<ul class="tg-menu">${T.TYPES.map((t) => `<li data-type="${t.type}" class="${this.value && this.value.type === t.type ? 'active' : ''}">${t.label}</li>`).join('')}</ul>`;
      const el = this._openPopover(anchor, html, { className: 'tg-popover-menu', withBackdrop: true });
      if (this.popover) this.popover.kind = 'type';
      el.querySelectorAll('li').forEach((li) => {
        li.onclick = () => {
          this.closePopover();
          this._applyType(li.getAttribute('data-type'));
        };
      });
    }

    toggleCalendar(anchor) {
      if (this.popover && this.popover.kind === 'calendar') {
        this.closePopover();
        return;
      }
      const iso = this.value.date || T.defaultTrigger().date;
      const parts = iso.split('-').map(Number);
      this.calendarMonth = new Date(parts[0], parts[1] - 1, 1);
      this._renderCalendar(anchor);
    }

    _renderCalendar(anchor) {
      const html = `
        <div class="tg-cal">
          <div class="tg-cal-head">
            <button type="button" class="tg-cal-nav" data-nav="-1">${ICON_PREV}</button>
            <span class="tg-cal-title"></span>
            <button type="button" class="tg-cal-nav" data-nav="1">${ICON_NEXT}</button>
          </div>
          <div class="tg-cal-week">${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => `<span>${d}</span>`).join('')}</div>
          <div class="tg-cal-grid" data-grid></div>
        </div>`;

      if (this.popover && this.popover.kind === 'calendar') {
        this.popover.el.innerHTML = html;
      } else {
        this._openPopover(anchor, html, { className: 'tg-popover-cal', withBackdrop: true });
        if (this.popover) this.popover.kind = 'calendar';
      }

      const el = this.popover.el;
      el.querySelector('[data-nav="-1"]').onclick = () => {
        this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() - 1, 1);
        this._renderCalendar(anchor);
      };
      el.querySelector('[data-nav="1"]').onclick = () => {
        this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() + 1, 1);
        this._renderCalendar(anchor);
      };

      const year = this.calendarMonth.getFullYear();
      const month = this.calendarMonth.getMonth();
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      el.querySelector('.tg-cal-title').textContent = `${months[month]} ${year}`;

      const selected = this.value.date || '';
      const todayISO = T.defaultTrigger().date;
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const prevDays = new Date(year, month, 0).getDate();

      const cells = [];
      for (let i = firstDay - 1; i >= 0; i--) {
        const d = prevDays - i;
        cells.push({ day: d, muted: true, iso: '' });
      }
      for (let d = 1; d <= daysInMonth; d++) {
        cells.push({ day: d, muted: false, iso: `${year}-${pad(month + 1)}-${pad(d)}` });
      }
      while (cells.length % 7 !== 0 || cells.length < 42) {
        const d = cells.length - firstDay - daysInMonth + 1;
        cells.push({ day: d, muted: true, iso: '' });
        if (cells.length >= 42) break;
      }

      const grid = el.querySelector('[data-grid]');
      grid.innerHTML = cells.map((cell) => {
        const classes = ['tg-cal-day'];
        if (cell.muted) classes.push('muted');
        if (cell.iso && cell.iso === selected) classes.push('selected');
        if (cell.iso && cell.iso === todayISO) classes.push('today');
        return `<button type="button" class="${classes.join(' ')}" data-iso="${cell.iso}">${cell.day}</button>`;
      }).join('');

      grid.querySelectorAll('.tg-cal-day').forEach((btn) => {
        btn.onclick = () => {
          const iso = btn.getAttribute('data-iso');
          if (!iso) return;
          this.closePopover();
          this._update({ date: iso });
        };
      });
    }

    toggleTimePicker(anchor) {
      if (this.popover && this.popover.kind === 'time') {
        this.closePopover();
        return;
      }
      const { hour, minute } = T.parseTime(this.value.time);
      const html = `
        <div class="tg-time-wrap">
          <input class="tg-time-field" data-hour value="${pad(hour)}" inputmode="numeric" maxlength="2">
          <span class="tg-time-colon">:</span>
          <input class="tg-time-field" data-minute value="${pad(minute)}" inputmode="numeric" maxlength="2">
        </div>
        <div class="tg-ampm">
          <button type="button" data-period="AM" class="${hour < 12 ? 'active' : ''}">AM</button>
          <button type="button" data-period="PM" class="${hour >= 12 ? 'active' : ''}">PM</button>
        </div>`;
      this._openPopover(anchor, html, { className: 'tg-popover-time', withBackdrop: true });
      if (this.popover) this.popover.kind = 'time';

      const el = this.popover.el;
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.gap = '8px';

      const hourInput = el.querySelector('[data-hour]');
      const minuteInput = el.querySelector('[data-minute]');

      const commit = () => {
        let h = Math.min(23, Math.max(0, Number(hourInput.value) || 0));
        let m = Math.min(59, Math.max(0, Number(minuteInput.value) || 0));
        this._update({ time: `${pad(h)}:${pad(m)}` });
      };

      hourInput.onchange = commit;
      hourInput.onblur = commit;
      minuteInput.onchange = commit;
      minuteInput.onblur = commit;
      hourInput.onkeydown = (evt) => { if (evt.key === 'Enter') commit(); };
      minuteInput.onkeydown = (evt) => { if (evt.key === 'Enter') commit(); };

      el.querySelectorAll('[data-period]').forEach((btn) => {
        btn.onclick = () => {
          const period = btn.getAttribute('data-period');
          const h = Number(hourInput.value) || 0;
          let next = h % 12;
          if (period === 'PM') next += 12;
          if (next === h) {
            // 仅更新高亮
            el.querySelectorAll('[data-period]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            return;
          }
          this.closePopover();
          this._update({ time: `${pad(next)}:${pad(Number(minuteInput.value) || 0)}` });
        };
      });

      setTimeout(() => hourInput.select(), 30);
    }

    toggleMinutePicker(anchor) {
      if (this.popover && this.popover.kind === 'minute') {
        this.closePopover();
        return;
      }
      const current = Number(this.value.minute) || 0;
      const html = `<div class="tg-cal">
        <div class="tg-overview-head" style="padding:4px 6px 8px">选择每小时的第几分钟</div>
        <div class="tg-daygrid" style="grid-template-columns:repeat(6,1fr)">
          ${Array.from({ length: 60 }, (_, i) => `<button type="button" class="tg-daycell${i === current ? ' active' : ''}" data-min="${i}">${i}</button>`).join('')}
        </div>
      </div>`;
      this._openPopover(anchor, html, { className: 'tg-popover-min', withBackdrop: true });
      if (this.popover) this.popover.kind = 'minute';
      this.popover.el.querySelectorAll('[data-min]').forEach((btn) => {
        btn.onclick = () => {
          this.closePopover();
          this._update({ minute: Number(btn.getAttribute('data-min')) });
        };
      });
    }
  }

  window.TriggerPicker = TriggerPicker;
  window.TriggerPickerHelpers = { formatDateCN, formatTime, pad, escapeHtml };
}());
