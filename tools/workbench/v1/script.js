/**
 * v1/script.js — V1 经典卡片版渲染引擎
 *
 * 职责：
 * 1. 从 data/settings.json 获取书签，合并 localStorage 用户数据
 * 2. 渲染卡片网格 + 删除按钮 + 数据新鲜度指示器
 * 3. 书签管理：添加模态框 + localStorage 持久化
 * 4. 读取 window.__PLUGINS__ 挂载插件
 *
 * 注意：所有 fetch/src URL 以项目根目录为基准。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'user_bookmarks';
  var settingsData = null;

  /* ==========================================================
     渲染入口
     ========================================================== */

  async function render() {
    try {
      settingsData = await fetchSettings();
    } catch (err) {
      console.error('[V1] 书签数据加载失败:', err);
      showGridError();
      return;
    }

    var mergedBookmarks = getMergedData();
    renderGreeting(settingsData.userName);
    renderFreshness(settingsData.lastUpdated);
    renderBookmarks(mergedBookmarks);
    injectManageUI(mergedBookmarks);

    mountPlugins();
  }

  /* ==========================================================
     数据获取 & 合并
     ========================================================== */

  async function fetchSettings() {
    var resp = await fetch('data/settings.json');
    if (!resp.ok) throw new Error('settings.json 请求失败，状态码 ' + resp.status);
    return resp.json();
  }

  /**
   * 合并 settings.json 书签 + localStorage user_bookmarks
   * localStorage 中同 id 的书签覆盖 settings 中的
   */
  function getMergedData() {
    if (!settingsData) return [];

    var base = Array.isArray(settingsData.bookmarks) ? settingsData.bookmarks.slice() : [];
    var userBookmarks = null;

    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        userBookmarks = JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[V1] localStorage 书签数据损坏，回退到默认值', e);
    }

    if (!Array.isArray(userBookmarks) || userBookmarks.length === 0) return base;

    // 以 id 为 key 合并：用户数据覆盖/追加
    var mergedMap = {};
    base.forEach(function (b) { if (b.id) mergedMap[b.id] = b; });
    userBookmarks.forEach(function (b) { if (b.id) mergedMap[b.id] = b; });

    var merged = [];
    var seen = {};
    // 先按 base 顺序，再追加 user 中新增的
    base.forEach(function (b) {
      if (mergedMap[b.id]) {
        merged.push(mergedMap[b.id]);
        seen[b.id] = true;
      }
    });
    userBookmarks.forEach(function (b) {
      if (b.id && !seen[b.id]) {
        merged.push(b);
      }
    });

    return merged;
  }

  function saveUserBookmarks(bookmarks) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
    } catch (e) {
      console.warn('[V1] localStorage 写入失败', e);
    }
  }

  /* ==========================================================
     数据新鲜度
     ========================================================== */

  function renderFreshness(lastUpdated) {
    var header = document.querySelector('.wb-header');
    if (!header || !lastUpdated) return;

    var el = document.createElement('div');
    el.className = 'wb-freshness';

    var diffMs = Date.now() - new Date(lastUpdated).getTime();
    var diffHours = diffMs / (1000 * 60 * 60);

    var color = '';
    if (diffHours > 48) {
      color = 'color:#c0392b;font-weight:600;';
    } else if (diffHours > 24) {
      color = 'color:#f39c12;font-weight:600;';
    }

    el.innerHTML = '<span style="' + color + '">\uD83D\uDCC5 数据更新于：' + lastUpdated + '</span>';
    el.style.cssText = 'font-size:var(--text-xs);margin-top:4px;';
    header.appendChild(el);
  }

  /* ==========================================================
     渲染书签卡片
     ========================================================== */

  function renderGreeting(userName) {
    var el = document.getElementById('greeting');
    if (el && userName) el.textContent = userName + ' 的工作台';
  }

  function renderBookmarks(bookmarks) {
    var grid = document.getElementById('bookmark-grid');
    if (!grid) return;

    if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
      grid.innerHTML = '<p class="plugin-placeholder">暂无书签，请使用下方管理功能添加。</p>';
      return;
    }

    var fragment = document.createDocumentFragment();
    bookmarks.forEach(function (bm) { fragment.appendChild(createBookmarkCard(bm)); });
    grid.innerHTML = '';
    grid.appendChild(fragment);
  }

  function createBookmarkCard(bm) {
    var a = document.createElement('a');
    a.className = 'bookmark-card';
    a.href = bm.url || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = bm.name;
    a.setAttribute('data-bookmark-id', bm.id || '');

    var icon = document.createElement('span');
    icon.className = 'card-icon';
    icon.textContent = bm.icon || '\uD83D\uDD17';

    var body = document.createElement('span');
    body.className = 'card-body';

    var name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = bm.name;

    var url = document.createElement('span');
    url.className = 'card-url';
    url.textContent = bm.url || '';

    body.appendChild(name);
    body.appendChild(url);

    // 删除按钮
    var delBtn = document.createElement('button');
    delBtn.className = 'card-delete-btn';
    delBtn.innerHTML = '&times;';
    delBtn.title = '删除此书签';
    delBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      removeBookmark(bm.id);
    });

    a.appendChild(icon);
    a.appendChild(body);
    a.appendChild(delBtn);

    return a;
  }

  function removeBookmark(id) {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      list = list.filter(function (b) { return b.id !== id; });
      saveUserBookmarks(list);
    } catch (e) {
      console.warn('[V1] 删除书签失败', e);
    }
    // 重新渲染
    var merged = getMergedData();
    renderBookmarks(merged);
    // 更新管理面板列表
    refreshManageList(merged);
  }

  function showGridError() {
    var grid = document.getElementById('bookmark-grid');
    if (grid) {
      grid.innerHTML = '<p class="plugin-placeholder">书签数据读取失败，请检查 data/settings.json 文件。</p>';
    }
  }

  /* ==========================================================
     书签管理 UI
     ========================================================== */

  function injectManageUI(bookmarks) {
    // 避免重复注入
    if (document.getElementById('v1-manage-section')) return;

    var main = document.querySelector('.wb-main');
    if (!main) return;

    var section = document.createElement('section');
    section.id = 'v1-manage-section';
    section.className = 'wb-manage-section';

    section.innerHTML =
      '<div class="manage-header">' +
        '<span class="manage-title">\u{1F4C2} 管理书签</span>' +
        '<button class="manage-btn-add" id="v1-btn-add">+ 添加</button>' +
      '</div>' +
      '<ul class="manage-list" id="v1-manage-list"></ul>';

    main.appendChild(section);

    // 绑定添加按钮
    document.getElementById('v1-btn-add').addEventListener('click', function () {
      showModal(null, bookmarks);
    });

    refreshManageList(bookmarks);
  }

  function refreshManageList(bookmarks) {
    var list = document.getElementById('v1-manage-list');
    if (!list) return;

    if (!bookmarks || bookmarks.length === 0) {
      list.innerHTML = '<li class="manage-empty">暂无书签</li>';
      return;
    }

    var frag = document.createDocumentFragment();
    bookmarks.forEach(function (bm) {
      var li = document.createElement('li');
      li.className = 'manage-item';
      li.innerHTML =
        '<span class="manage-item-icon">' + (bm.icon || '\uD83D\uDD17') + '</span>' +
        '<span class="manage-item-name">' + escapeText(bm.name) + '</span>' +
        '<span class="manage-item-url">' + escapeText(bm.url || '') + '</span>' +
        '<button class="manage-item-del" data-id="' + bm.id + '">&times;</button>';
      frag.appendChild(li);
    });

    list.innerHTML = '';
    list.appendChild(frag);

    // 委托删除
    list.querySelectorAll('.manage-item-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        removeBookmark(btn.getAttribute('data-id'));
      });
    });
  }

  /* ==========================================================
     添加书签模态框
     ========================================================== */

  function showModal(editData, bookmarks) {
    // 移除旧模态
    var old = document.getElementById('v1-modal-overlay');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'v1-modal-overlay';
    overlay.className = 'v1-modal-overlay';
    overlay.innerHTML =
      '<div class="v1-modal">' +
        '<h3 class="v1-modal-title">添加书签</h3>' +
        '<label class="v1-modal-label">名称</label>' +
        '<input class="v1-modal-input" id="v1-modal-name" placeholder="书签名称" maxlength="60" value="' + (editData ? escapeAttr(editData.name) : '') + '" />' +
        '<label class="v1-modal-label">链接</label>' +
        '<input class="v1-modal-input" id="v1-modal-url" placeholder="https://..." maxlength="500" value="' + (editData ? escapeAttr(editData.url) : '') + '" />' +
        '<label class="v1-modal-label">图标 Emoji</label>' +
        '<input class="v1-modal-input" id="v1-modal-icon" placeholder="🚀" maxlength="4" value="' + (editData ? escapeAttr(editData.icon) : '') + '" />' +
        '<div class="v1-modal-actions">' +
          '<button class="v1-modal-btn v1-modal-btn-cancel" id="v1-modal-cancel">取消</button>' +
          '<button class="v1-modal-btn v1-modal-btn-confirm" id="v1-modal-confirm">确认</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // 关闭
    var close = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.getElementById('v1-modal-cancel').addEventListener('click', close);

    // 确认
    document.getElementById('v1-modal-confirm').addEventListener('click', function () {
      var name = (document.getElementById('v1-modal-name').value || '').trim();
      var url = (document.getElementById('v1-modal-url').value || '').trim();
      var icon = (document.getElementById('v1-modal-icon').value || '').trim() || '\uD83D\uDD17';

      if (!name) {
        document.getElementById('v1-modal-name').focus();
        return;
      }

      // 保存到 localStorage
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        var list = raw ? JSON.parse(raw) : [];
        var newBookmark = {
          id: 'u_' + Date.now(),
          name: name,
          url: url,
          icon: icon
        };
        list.push(newBookmark);
        saveUserBookmarks(list);
      } catch (e) {
        console.warn('[V1] 保存书签失败', e);
      }

      close();
      // 重新渲染
      var merged = getMergedData();
      renderBookmarks(merged);
      refreshManageList(merged);
    });

    // 自动聚焦名称输入框
    setTimeout(function () {
      var input = document.getElementById('v1-modal-name');
      if (input) input.focus();
    }, 100);
  }

  /* ==========================================================
     插件系统
     ========================================================== */

  function mountPlugins() {
    var plugins = window.__PLUGINS__;
    if (!plugins || plugins.length === 0) return;

    plugins.forEach(function (plugin) {
      if (!plugin.enabled) return;
      var target = document.getElementById('plugin-' + plugin.id);
      if (!target) return;
      tryLoadPlugin(plugin, target);
    });
  }

  function tryLoadPlugin(plugin, mountTarget) {
    try {
      var script = document.createElement('script');
      script.src = plugin.src;
      script.async = true;
      script.dataset.mount = mountTarget.id;
      script.onload = function () { console.log('[V1] 插件 %s 加载成功', plugin.id); };
      script.onerror = function () {
        console.error('[V1] 插件 %s 加载失败', plugin.id);
        showPluginError(mountTarget, plugin.id);
      };
      document.head.appendChild(script);
    } catch (err) {
      console.error('[V1] 插件 %s 初始化异常:', plugin.id, err);
      showPluginError(mountTarget, plugin.id);
    }
  }

  function handleDisabledPlugins() {
    var plugins = window.__PLUGINS__;
    if (!plugins) return;
    plugins.forEach(function (plugin) {
      if (!plugin.enabled) showPluginDisabled(plugin.id);
    });
  }

  function showPluginDisabled(pluginId) {
    var target = document.getElementById('plugin-' + pluginId);
    if (target) {
      target.innerHTML = '<div class="plugin-placeholder">插件「' + pluginId + '」未激活</div>';
    }
  }

  function showPluginError(target, pluginId) {
    target.innerHTML = '<div class="plugin-placeholder">插件「' + pluginId + '」加载失败</div>';
  }

  /* ==========================================================
     工具函数
     ========================================================== */

  function escapeText(s) {
    var div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
  }

  function escapeAttr(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ==========================================================
     启动
     ========================================================== */

  handleDisabledPlugins();
  render();
})();
