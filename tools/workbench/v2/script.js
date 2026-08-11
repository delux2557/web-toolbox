/**
 * v2/script.js — V2 侧边栏版渲染引擎
 *
 * 职责：
 * 1. 从 data/settings.json 获取书签，合并 localStorage 用户数据
 * 2. 左侧导航栏 + 列表视图 + 删除按钮 + 数据新鲜度指示器
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
      console.error('[V2] 书签数据加载失败:', err);
      showBookmarkError();
      return;
    }

    var mergedBookmarks = getMergedData();
    renderSidebarUser(settingsData.userName);
    renderFreshness(settingsData.lastUpdated);
    renderBookmarkList(mergedBookmarks, 'all');
    initNavFilter(mergedBookmarks);
    injectManageUI(mergedBookmarks);

    mountPlugins();
    handleDisabledPlugins();
  }

  /* ==========================================================
     数据获取 & 合并
     ========================================================== */

  async function fetchSettings() {
    var resp = await fetch('data/settings.json');
    if (!resp.ok) throw new Error('settings.json 请求失败，状态码 ' + resp.status);
    return resp.json();
  }

  function getMergedData() {
    if (!settingsData) return [];

    var base = Array.isArray(settingsData.bookmarks) ? settingsData.bookmarks.slice() : [];
    var userBookmarks = null;

    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) userBookmarks = JSON.parse(raw);
    } catch (e) {
      console.warn('[V2] localStorage 书签数据损坏，回退到默认值', e);
    }

    if (!Array.isArray(userBookmarks) || userBookmarks.length === 0) return base;

    var mergedMap = {};
    base.forEach(function (b) { if (b.id) mergedMap[b.id] = b; });
    userBookmarks.forEach(function (b) { if (b.id) mergedMap[b.id] = b; });

    var merged = [];
    var seen = {};
    base.forEach(function (b) {
      if (mergedMap[b.id]) { merged.push(mergedMap[b.id]); seen[b.id] = true; }
    });
    userBookmarks.forEach(function (b) {
      if (b.id && !seen[b.id]) merged.push(b);
    });

    return merged;
  }

  function saveUserBookmarks(bookmarks) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks)); } catch (e) {}
  }

  /* ==========================================================
     数据新鲜度
     ========================================================== */

  function renderFreshness(lastUpdated) {
    var footer = document.querySelector('.sidebar-footer');
    if (!footer || !lastUpdated) return;

    var diffMs = Date.now() - new Date(lastUpdated).getTime();
    var diffHours = diffMs / (1000 * 60 * 60);

    var color = '';
    if (diffHours > 48) color = 'color:#e74c3c;font-weight:600;';
    else if (diffHours > 24) color = 'color:#f39c12;font-weight:600;';

    var el = document.createElement('div');
    el.className = 'sidebar-freshness';
    el.innerHTML = '<span style="font-size:0.7rem;' + color + '">\uD83D\uDCC5 ' + lastUpdated + '</span>';
    el.style.cssText = 'margin-top:6px;line-height:1.4;';
    footer.insertBefore(el, footer.firstChild);
  }

  /* ==========================================================
     侧边栏用户
     ========================================================== */

  function renderSidebarUser(userName) {
    var avatar = document.getElementById('avatar');
    var nameSpan = document.getElementById('sidebar-username');
    if (avatar && userName) avatar.textContent = userName.charAt(0).toUpperCase();
    if (nameSpan && userName) nameSpan.textContent = userName;
  }

  /* ==========================================================
     书签列表
     ========================================================== */

  function renderBookmarkList(bookmarks, activeCategory) {
    var list = document.getElementById('bookmark-list');
    var countEl = document.getElementById('bookmark-count');
    var titleEl = document.getElementById('content-title');
    if (!list) return;

    var titles = { all: '全部书签', favorites: '收藏夹', tools: '工具' };
    var filtered = Array.isArray(bookmarks) ? bookmarks : [];

    if (titleEl) titleEl.textContent = titles[activeCategory] || '全部书签';
    if (countEl) countEl.textContent = filtered.length + ' 项';

    if (filtered.length === 0) {
      list.innerHTML = '<div class="bookmark-empty">该分类下暂无书签</div>';
      return;
    }

    var fragment = document.createDocumentFragment();
    filtered.forEach(function (bm) { fragment.appendChild(createBookmarkRow(bm)); });
    list.innerHTML = '';
    list.appendChild(fragment);
  }

  function createBookmarkRow(bm) {
    var a = document.createElement('a');
    a.className = 'bookmark-row';
    a.href = bm.url || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = bm.name;

    var icon = document.createElement('span');
    icon.className = 'row-icon';
    icon.textContent = bm.icon || '\uD83D\uDD17';

    var body = document.createElement('span');
    body.className = 'row-body';

    var name = document.createElement('span');
    name.className = 'row-name';
    name.textContent = bm.name;

    var url = document.createElement('span');
    url.className = 'row-url';
    url.textContent = bm.url || '';

    body.appendChild(name);
    body.appendChild(url);

    var arrow = document.createElement('span');
    arrow.className = 'row-arrow';
    arrow.textContent = '\u2192';

    // 删除按钮
    var delBtn = document.createElement('button');
    delBtn.className = 'row-delete-btn';
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
    a.appendChild(arrow);

    return a;
  }

  function removeBookmark(id) {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      list = list.filter(function (b) { return b.id !== id; });
      saveUserBookmarks(list);
    } catch (e) {}
    var merged = getMergedData();
    navigateBookmarks(merged);
  }

  function navigateBookmarks(merged) {
    var active = document.querySelector('.nav-item.active');
    var category = active ? active.getAttribute('data-category') || 'all' : 'all';
    renderBookmarkList(merged, category);
    refreshManageListV2(merged);
  }

  function showBookmarkError() {
    var list = document.getElementById('bookmark-list');
    if (list) list.innerHTML = '<div class="bookmark-empty">书签数据读取失败。</div>';
  }

  /* ==========================================================
     导航筛选
     ========================================================== */

  function initNavFilter(bookmarks) {
    var navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        navItems.forEach(function (ni) { ni.classList.remove('active'); });
        item.classList.add('active');
        var category = item.getAttribute('data-category') || 'all';
        renderBookmarkList(bookmarks, category);
      });
    });
  }

  /* ==========================================================
     管理 UI
     ========================================================== */

  function injectManageUI(bookmarks) {
    if (document.getElementById('v2-manage-section')) return;

    var main = document.querySelector('.main-content');
    if (!main) return;

    var section = document.createElement('section');
    section.id = 'v2-manage-section';
    section.className = 'v2-manage-section';

    section.innerHTML =
      '<div class="v2-manage-header">' +
        '<span class="v2-manage-title">\u{1F4C2} 管理书签</span>' +
        '<button class="v2-manage-btn-add" id="v2-btn-add">+ 添加</button>' +
      '</div>' +
      '<ul class="v2-manage-list" id="v2-manage-list"></ul>';

    main.appendChild(section);

    document.getElementById('v2-btn-add').addEventListener('click', function () {
      showModalV2(null);
    });

    refreshManageListV2(bookmarks);
  }

  function refreshManageListV2(bookmarks) {
    var list = document.getElementById('v2-manage-list');
    if (!list) return;
    if (!bookmarks || bookmarks.length === 0) {
      list.innerHTML = '<li class="v2-manage-empty">暂无书签</li>';
      return;
    }
    var frag = document.createDocumentFragment();
    bookmarks.forEach(function (bm) {
      var li = document.createElement('li');
      li.className = 'v2-manage-item';
      li.innerHTML =
        '<span class="v2-manage-item-icon">' + (bm.icon || '\uD83D\uDD17') + '</span>' +
        '<span class="v2-manage-item-name">' + escapeTextV2(bm.name) + '</span>' +
        '<button class="v2-manage-item-del" data-id="' + bm.id + '" title="删除">&times;</button>';
      frag.appendChild(li);
    });
    list.innerHTML = '';
    list.appendChild(frag);
    list.querySelectorAll('.v2-manage-item-del').forEach(function (btn) {
      btn.addEventListener('click', function () { removeBookmark(btn.getAttribute('data-id')); });
    });
  }

  /* ==========================================================
     模态框
     ========================================================== */

  function showModalV2(editData) {
    var old = document.getElementById('v2-modal-overlay');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'v2-modal-overlay';
    overlay.className = 'v2-modal-overlay';
    overlay.innerHTML =
      '<div class="v2-modal">' +
        '<h3 class="v2-modal-title">添加书签</h3>' +
        '<label class="v2-modal-label">名称</label>' +
        '<input class="v2-modal-input" id="v2-modal-name" placeholder="书签名称" maxlength="60" />' +
        '<label class="v2-modal-label">链接</label>' +
        '<input class="v2-modal-input" id="v2-modal-url" placeholder="https://..." maxlength="500" />' +
        '<label class="v2-modal-label">图标 Emoji</label>' +
        '<input class="v2-modal-input" id="v2-modal-icon" placeholder="🚀" maxlength="4" />' +
        '<div class="v2-modal-actions">' +
          '<button class="v2-modal-btn v2-modal-btn-cancel" id="v2-modal-cancel">取消</button>' +
          '<button class="v2-modal-btn v2-modal-btn-confirm" id="v2-modal-confirm">确认</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.getElementById('v2-modal-cancel').addEventListener('click', function () { overlay.remove(); });
    document.getElementById('v2-modal-confirm').addEventListener('click', function () {
      var name = (document.getElementById('v2-modal-name').value || '').trim();
      var url  = (document.getElementById('v2-modal-url').value || '').trim();
      var icon = (document.getElementById('v2-modal-icon').value || '').trim() || '\uD83D\uDD17';
      if (!name) { document.getElementById('v2-modal-name').focus(); return; }

      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        var list = raw ? JSON.parse(raw) : [];
        list.push({ id: 'u_' + Date.now(), name: name, url: url, icon: icon });
        saveUserBookmarks(list);
      } catch (e) {}

      overlay.remove();
      var merged = getMergedData();
      navigateBookmarks(merged);
    });

    setTimeout(function () {
      var input = document.getElementById('v2-modal-name');
      if (input) input.focus();
    }, 100);
  }

  /* ==========================================================
     插件
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
      script.onload = function () { console.log('[V2] 插件 %s 加载成功', plugin.id); };
      script.onerror = function () {
        console.error('[V2] 插件 %s 加载失败', plugin.id);
        showPluginError(mountTarget, plugin.id);
      };
      document.head.appendChild(script);
    } catch (err) {
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
    if (target) target.innerHTML = '<div class="plugin-placeholder">插件「' + pluginId + '」未激活</div>';
  }

  function showPluginError(target, pluginId) {
    target.innerHTML = '<div class="plugin-placeholder">插件「' + pluginId + '」加载失败</div>';
  }

  /* ==========================================================
     工具
     ========================================================== */

  function escapeTextV2(s) {
    var div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
  }

  /* ==========================================================
     启动
     ========================================================== */

  render();
})();
