/**
 * plugins/todo.js — Todo 待办插件
 *
 * 规范：
 * - 通过 window.TodoPlugin 暴露全局接口
 * - 自带增删 + localStorage 持久化（key: todo_list）
 * - 样式完全独立封装（tp-* BEM 命名，不依赖 V1/V2 CSS）
 * - 无数据时显示预设示例
 *
 * 挂载：加载脚本时自动检测 data-mount 属性定位目标容器
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'todo_list';

  // 预设示例待办
  var DEFAULT_TODOS = [
    '熟悉 V2 新布局',
    '配置常用书签',
    '浏览插件系统文档'
  ];

  /* ==========================================================
     TodoPlugin 构造函数
     ========================================================== */

  function TodoPlugin(container) {
    injectStyles();
    this.container = container;
    this.todos = loadTodos();
    this._render();
    this._bindEvents();
  }

  /* ---- 数据层 ---- */

  function loadTodos() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('[Todo] localStorage 读取失败，使用预设数据', e);
    }
    // 首次使用 / 数据异常 → 写入预设
    saveTodos(DEFAULT_TODOS);
    return DEFAULT_TODOS.slice();
  }

  function saveTodos(todos) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    } catch (e) {
      console.warn('[Todo] localStorage 写入失败', e);
    }
  }

  /* ---- 样式注入（只注入一次，全局共享） ---- */

  var _stylesInjected = false;

  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;

    var style = document.createElement('style');
    style.setAttribute('data-plugin', 'todo');
    style.textContent = [
      /* 容器 */
      '.tp-root {',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;',
      '  color: oklch(25% 0.01 70);',
      '  line-height: 1.5;',
      '}',

      /* 头部 — 与 wp-header 对齐 */
      '.tp-header {',
      '  display: flex; align-items: center; justify-content: space-between;',
      '  margin-bottom: 8px;',
      '}',
      '.tp-title {',
      '  font-size: 0.875rem; font-weight: 600; letter-spacing: -0.01em;',
      '}',
      '.tp-badge {',
      '  font-size: 0.7rem; color: oklch(55% 0.01 70);',
      '  background: oklch(92% 0.01 70);',
      '  padding: 1px 6px; border-radius: 3px;',
      '}',

      /* 输入行 — 更精致的边框 */
      '.tp-input-row {',
      '  display: flex; gap: 6px; margin-bottom: 10px;',
      '}',
      '.tp-input {',
      '  flex: 1; min-width: 0;',
      '  padding: 7px 10px;',
      '  font-size: 0.8125rem;',
      '  border: 1px solid oklch(88% 0.005 220);',
      '  border-radius: 4px;',
      '  background: oklch(100% 0 0);',
      '  color: inherit;',
      '  outline: none;',
      '  transition: border-color 150ms ease-out, box-shadow 150ms ease-out;',
      '  box-sizing: border-box;',
      '}',
      '.tp-input:focus {',
      '  border-color: oklch(58% 0.12 180);',
      '  box-shadow: 0 0 0 2px oklch(58% 0.12 180 / 0.12);',
      '}',
      '.tp-input::placeholder { color: oklch(65% 0.01 70); }',

      /* 添加按钮 — 与 refresh 按钮风格对齐 */
      '.tp-btn-add {',
      '  flex-shrink: 0;',
      '  padding: 0 14px;',
      '  font-size: 0.75rem; font-weight: 500;',
      '  color: oklch(58% 0.12 180);',
      '  background: oklch(94% 0.03 180);',
      '  border: 1px solid oklch(88% 0.03 180);',
      '  border-radius: 3px;',
      '  cursor: pointer;',
      '  transition: all 120ms ease-out;',
      '  box-sizing: border-box;',
      '}',
      '.tp-btn-add:hover {',
      '  background: oklch(58% 0.12 180);',
      '  color: #fff;',
      '  border-color: oklch(58% 0.12 180);',
      '}',

      /* 列表 */
      '.tp-list {',
      '  list-style: none; margin: 0; padding: 0;',
      '  display: flex; flex-direction: column; gap: 1px;',
      '  background: oklch(91% 0.003 220);',
      '  border: 1px solid oklch(91% 0.003 220);',
      '  border-radius: 4px; overflow: hidden;',
      '}',

      /* 单项 — 带背景的行 */
      '.tp-item {',
      '  display: flex; align-items: center; gap: 8px;',
      '  padding: 6px 10px;',
      '  background: oklch(100% 0 0);',
      '  transition: background 120ms ease-out;',
      '}',
      '.tp-item:hover { background: oklch(94% 0.03 180); }',

      /* 勾选 */
      '.tp-check {',
      '  flex-shrink: 0;',
      '  width: 16px; height: 16px;',
      '  border: 1.5px solid oklch(78% 0.005 220);',
      '  border-radius: 3px;',
      '  cursor: pointer;',
      '  transition: all 120ms ease-out;',
      '  box-sizing: border-box;',
      '}',
      '.tp-item:hover .tp-check { border-color: oklch(60% 0.01 70); }',
      '.tp-item--done .tp-check {',
      '  background: oklch(58% 0.12 180);',
      '  border-color: oklch(58% 0.12 180);',
      '}',

      '.tp-item--done .tp-text {',
      '  text-decoration: line-through;',
      '  color: oklch(60% 0.01 70);',
      '}',

      '.tp-text {',
      '  flex: 1; min-width: 0;',
      '  font-size: 0.8125rem;',
      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
      '}',

      /* 删除按钮 */
      '.tp-btn-del {',
      '  flex-shrink: 0;',
      '  width: 22px; height: 22px;',
      '  display: flex; align-items: center; justify-content: center;',
      '  font-size: 0.85rem; line-height: 1;',
      '  color: oklch(55% 0.01 70);',
      '  background: none; border: none; border-radius: 3px;',
      '  cursor: pointer;',
      '  opacity: 0;',
      '  transition: all 120ms ease-out;',
      '  box-sizing: border-box;',
      '}',
      '.tp-item:hover .tp-btn-del { opacity: 1; }',
      '.tp-btn-del:hover {',
      '  color: #c0392b;',
      '  background: oklch(92% 0.03 15);',
      '}',

      /* 进度条 — 与 weather details 对齐 */
      '.tp-progress {',
      '  margin-top: 8px; padding: 8px 10px;',
      '  border-radius: 4px;',
      '  background: oklch(96% 0.01 70);',
      '  font-size: 0.75rem; color: oklch(50% 0.01 70);',
      '  display: flex; align-items: center; gap: 8px;',
      '}',
      '.tp-progress-bar {',
      '  flex: 1; height: 4px;',
      '  background: oklch(88% 0.005 220);',
      '  border-radius: 2px; overflow: hidden;',
      '}',
      '.tp-progress-fill {',
      '  height: 100%;',
      '  background: oklch(58% 0.12 180);',
      '  border-radius: 2px;',
      '  transition: width 300ms ease-out;',
      '}',

      /* 暗色模式 */
      '@media (prefers-color-scheme: dark) {',
      '  .tp-root { color: oklch(88% 0.005 220); }',
      '  .tp-badge { color: oklch(52% 0.005 220); background: oklch(22% 0.005 220); }',
      '  .tp-input {',
      '    border-color: oklch(28% 0.005 220);',
      '    background: oklch(18% 0.005 220);',
      '    color: oklch(88% 0.005 220);',
      '  }',
      '  .tp-input:focus {',
      '    border-color: oklch(68% 0.12 180);',
      '    box-shadow: 0 0 0 2px oklch(68% 0.12 180 / 0.2);',
      '  }',
      '  .tp-input::placeholder { color: oklch(38% 0.005 220); }',
      '  .tp-list { background: oklch(24% 0.005 220); border-color: oklch(24% 0.005 220); }',
      '  .tp-item { background: oklch(19% 0.005 220); }',
      '  .tp-item:hover { background: oklch(22% 0.04 180); }',
      '  .tp-item--done .tp-text { color: oklch(40% 0.01 70); }',
      '  .tp-check { border-color: oklch(35% 0.005 220); }',
      '  .tp-btn-del { color: oklch(45% 0.01 70); }',
      '  .tp-btn-del:hover { color: oklch(65% 0.15 15); background: oklch(28% 0.03 15); }',
      '  .tp-progress { background: oklch(20% 0.005 220); color: oklch(52% 0.005 220); }',
      '  .tp-progress-bar { background: oklch(28% 0.005 220); }',
      '}'
    ].join('\n');

    document.head.appendChild(style);
  }

  /* ---- 渲染 ---- */

  TodoPlugin.prototype._render = function () {
    var self = this;

    var doneCount = this.todos.filter(function () { return false; }).length; // 全部未完成（简化）

    this.container.innerHTML =
      '<div class="tp-root">' +
        '<div class="tp-header">' +
          '<span class="tp-title">待办清单</span>' +
          '<span class="tp-badge" id="tp-badge">' + self._pendingCount() + '</span>' +
        '</div>' +
        '<div class="tp-input-row">' +
          '<input class="tp-input" type="text" placeholder="添加新待办..." maxlength="120" />' +
          '<button class="tp-btn-add" title="添加">添加</button>' +
        '</div>' +
        '<ul class="tp-list"></ul>' +
        '<div class="tp-progress">' +
          '<span>进度</span>' +
          '<span class="tp-progress-bar"><span class="tp-progress-fill" id="tp-progress-fill"></span></span>' +
          '<span id="tp-progress-text">0%</span>' +
        '</div>' +
      '</div>';

    this.listEl = this.container.querySelector('.tp-list');
    this.inputEl = this.container.querySelector('.tp-input');
    this.badgeEl = this.container.querySelector('#tp-badge');

    this._renderList();
  };

  TodoPlugin.prototype._renderList = function () {
    var self = this;
    if (!this.listEl) return;

    var fragment = document.createDocumentFragment();

    this.todos.forEach(function (text, index) {
      var li = document.createElement('li');
      li.className = 'tp-item';
      li.innerHTML =
        '<span class="tp-check" data-index="' + index + '"></span>' +
        '<span class="tp-text">' + escapeHtml(text) + '</span>' +
        '<button class="tp-btn-del" data-index="' + index + '" title="删除">&times;</button>';
      fragment.appendChild(li);
    });

    this.listEl.innerHTML = '';
    this.listEl.appendChild(fragment);

    this._updateCount();
  };

  TodoPlugin.prototype._updateCount = function () {
    if (this.badgeEl) {
      this.badgeEl.textContent = this._pendingCount();
    }

    // 更新进度条（基于当前列表的 tp-item--done 数量）
    var total = this.todos.length;
    var doneItems = this.listEl ? this.listEl.querySelectorAll('.tp-item--done').length : 0;
    var pct = total > 0 ? Math.round((doneItems / total) * 100) : 0;

    var fill = document.getElementById('tp-progress-fill');
    var text = document.getElementById('tp-progress-text');
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = pct + '%';
  };

  TodoPlugin.prototype._pendingCount = function () {
    return this.todos.length + ' 项';
  };

  /* ---- 事件绑定 ---- */

  TodoPlugin.prototype._bindEvents = function () {
    var self = this;

    // 添加按钮
    var btnAdd = this.container.querySelector('.tp-btn-add');
    if (btnAdd) {
      btnAdd.addEventListener('click', function () { self._addTodo(); });
    }

    // 回车提交
    if (this.inputEl) {
      this.inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') self._addTodo();
      });
    }

    // 委托：删除 & 勾选
    if (this.listEl) {
      this.listEl.addEventListener('click', function (e) {
        var btnDel = e.target.closest('.tp-btn-del');
        if (btnDel) {
          var idx = parseInt(btnDel.getAttribute('data-index'), 10);
          self._removeTodo(idx);
          return;
        }

        var check = e.target.closest('.tp-check');
        if (check) {
          var item = check.closest('.tp-item');
          if (item) item.classList.toggle('tp-item--done');
        }
      });
    }
  };

  TodoPlugin.prototype._addTodo = function () {
    var text = (this.inputEl.value || '').trim();
    if (!text) return;

    this.todos.push(text);
    saveTodos(this.todos);
    this.inputEl.value = '';
    this._renderList();
    this.inputEl.focus();
  };

  TodoPlugin.prototype._removeTodo = function (index) {
    if (index < 0 || index >= this.todos.length) return;
    this.todos.splice(index, 1);
    saveTodos(this.todos);
    this._renderList();
  };

  /* ==========================================================
     工具函数
     ========================================================== */

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ==========================================================
     自启动：检测挂载目标
     ========================================================== */

  function bootstrap() {
    var scripts = document.getElementsByTagName('script');
    var mountId = null;

    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('todo.js') !== -1) {
        mountId = scripts[i].getAttribute('data-mount');
        break;
      }
    }

    if (!mountId) {
      console.warn('[Todo] 未找到 data-mount 属性，插件未挂载');
      return;
    }

    var container = document.getElementById(mountId);
    if (!container) {
      console.warn('[Todo] 挂载目标 #%s 不存在', mountId);
      return;
    }

    new TodoPlugin(container);
  }

  // 暴露全局接口
  window.TodoPlugin = TodoPlugin;

  // 自动启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
