/**
 * v5/script.js — V5 插件独立入口 + 管理精简版
 *
 * 架构：
 * - 5 菜单：全部书签 / 收藏夹 / 工具 / 数据驾驶舱 / 插件
 * - 书签视图 header 内嵌 "+ 添加" 按钮（管理功能内联化）
 * - 行内 × 删除保留
 * - 插件独立视图，与书签/驾驶舱平级
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'user_bookmarks';
  var settingsData = null;
  var metricsData = null;
  var chartInstance = null;
  var currentMenu = 'all';

  /* ==========================================================
     入口
     ========================================================== */

  async function render() {
    try {
      settingsData = await fetchJSON('data/settings.json');
      metricsData = await fetchJSON('data/metrics.json');
    } catch (err) {
      console.error('[V5] 数据加载失败:', err);
      showError('数据加载失败，请刷新重试。');
      return;
    }

    renderSidebarUser(settingsData.userName);
    renderFreshness(settingsData.lastUpdated);
    initMenuListeners();
    bindAddButton();
    switchMenu(currentMenu);
    mountPlugins();
  }

  async function fetchJSON(url) {
    var resp = await fetch(url);
    if (!resp.ok) throw new Error(url + ' 请求失败');
    return resp.json();
  }

  /* ==========================================================
     数据合并
     ========================================================== */

  function getMergedBookmarks() {
    if (!settingsData) return [];
    var base = (settingsData.bookmarks || []).slice();
    var userBookmarks = null;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) userBookmarks = JSON.parse(raw);
    } catch (e) {}

    if (!Array.isArray(userBookmarks) || userBookmarks.length === 0) return base;

    var map = {};
    base.forEach(function (b) { if (b.id) map[b.id] = b; });
    userBookmarks.forEach(function (b) { if (b.id) map[b.id] = b; });

    var merged = [], seen = {};
    base.forEach(function (b) {
      if (map[b.id]) { merged.push(map[b.id]); seen[b.id] = true; }
    });
    userBookmarks.forEach(function (b) {
      if (b.id && !seen[b.id]) merged.push(b);
    });
    return merged;
  }

  function saveUserBookmarks(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) {}
  }

  /* ==========================================================
     侧边栏
     ========================================================== */

  function renderSidebarUser(name) {
    var avatar = document.getElementById('avatar');
    var span = document.getElementById('sidebar-username');
    if (avatar && name) avatar.textContent = name.charAt(0).toUpperCase();
    if (span && name) span.textContent = name;
  }

  function renderFreshness(lastUpdated) {
    var footer = document.querySelector('.sidebar-footer');
    if (!footer || !lastUpdated) return;
    var diffHours = (Date.now() - new Date(lastUpdated).getTime()) / 36e5;
    var color = diffHours > 48 ? 'color:#e74c3c;font-weight:600;' :
                diffHours > 24 ? 'color:#f39c12;font-weight:600;' : '';
    var el = document.createElement('div');
    el.className = 'sidebar-freshness';
    el.innerHTML = '<span style="font-size:0.7rem;' + color + '">\uD83D\uDCC5 ' + lastUpdated + '</span>';
    el.style.cssText = 'margin-top:6px;line-height:1.4;';
    footer.insertBefore(el, footer.firstChild);
  }

  /* ==========================================================
     菜单切换
     ========================================================== */

  function initMenuListeners() {
    var items = document.querySelectorAll('.nav-item');
    items.forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        items.forEach(function (ni) { ni.classList.remove('active'); });
        item.classList.add('active');
        currentMenu = item.getAttribute('data-menu') || 'all';
        switchMenu(currentMenu);
      });
    });
  }

  function switchMenu(menu) {
    var bmView = document.getElementById('view-bookmarks');
    var dbView = document.getElementById('view-dashboard');
    var plView = document.getElementById('view-plugins');

    // 全部隐藏
    [bmView, dbView, plView].forEach(function (v) { if (v) v.style.display = 'none'; });

    if (menu === 'dashboard') {
      dbView.style.display = 'block';
      renderDashboard();
      // 绑定刷新按钮（可能尚未绑定）
      bindRefresh();
    } else if (menu === 'plugins') {
      plView.style.display = 'block';
      renderPluginView();
    } else {
      bmView.style.display = 'block';
      renderBookmarks(getMergedBookmarks(), menu);
    }
  }

  /* ==========================================================
     书签渲染
     ========================================================== */

  function renderBookmarks(bookmarks, filterType) {
    var list = document.getElementById('bookmark-list');
    var countEl = document.getElementById('bookmark-count');
    var titleEl = document.getElementById('content-title');
    if (!list) return;

    var titles = { all: '全部书签', favorites: '收藏夹', tools: '工具' };
    var filtered = filterByType(bookmarks, filterType);

    if (titleEl) titleEl.textContent = titles[filterType] || '全部书签';
    if (countEl) countEl.textContent = filtered.length + ' 项';

    if (filtered.length === 0) {
      list.innerHTML = '<div class="bookmark-empty">该分类下暂无书签</div>';
      return;
    }

    var frag = document.createDocumentFragment();
    filtered.forEach(function (bm) { frag.appendChild(createBookmarkRow(bm)); });
    list.innerHTML = '';
    list.appendChild(frag);
  }

  function filterByType(bookmarks, type) {
    if (type === 'favorites') {
      return bookmarks.filter(function (b) { return b.favorite === true; });
    }
    if (type === 'tools') {
      return bookmarks.filter(function (b) { return b.category === 'tool'; });
    }
    return bookmarks;
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

    var delBtn = document.createElement('button');
    delBtn.className = 'row-delete-btn';
    delBtn.innerHTML = '&times;';
    delBtn.title = '删除';
    delBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      removeAndRefresh(bm.id);
    });

    var arrow = document.createElement('span');
    arrow.className = 'row-arrow';
    arrow.textContent = '\u2192';

    a.appendChild(icon);
    a.appendChild(body);
    a.appendChild(delBtn);
    a.appendChild(arrow);
    return a;
  }

  /* ---- 删除 + 重渲染 ---- */
  function removeAndRefresh(id) {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      list = list.filter(function (b) { return b.id !== id; });
      saveUserBookmarks(list);
    } catch (e) {}
    renderBookmarks(getMergedBookmarks(), currentMenu);
  }

  /* ---- "+ 添加" 按钮 ---- */
  function bindAddButton() {
    var btn = document.getElementById('header-btn-add');
    if (!btn) return;
    btn.addEventListener('click', function () { showModal(); });
  }

  function showModal() {
    var old = document.getElementById('v5-modal-overlay');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'v5-modal-overlay';
    overlay.className = 'v2-modal-overlay';
    overlay.innerHTML =
      '<div class="v2-modal">' +
        '<h3 class="v2-modal-title">添加书签</h3>' +
        '<label class="v2-modal-label">名称</label>' +
        '<input class="v2-modal-input" id="v5-modal-name" placeholder="书签名称" maxlength="60" />' +
        '<label class="v2-modal-label">链接</label>' +
        '<input class="v2-modal-input" id="v5-modal-url" placeholder="https://..." maxlength="500" />' +
        '<label class="v2-modal-label">图标 Emoji</label>' +
        '<input class="v2-modal-input" id="v5-modal-icon" placeholder="🚀" maxlength="4" />' +
        '<div class="v2-modal-actions">' +
          '<button class="v2-modal-btn v2-modal-btn-cancel" id="v5-modal-cancel">取消</button>' +
          '<button class="v2-modal-btn v2-modal-btn-confirm" id="v5-modal-confirm">确认</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.getElementById('v5-modal-cancel').addEventListener('click', function () { overlay.remove(); });
    document.getElementById('v5-modal-confirm').addEventListener('click', function () {
      var nm = (document.getElementById('v5-modal-name').value || '').trim();
      var url = (document.getElementById('v5-modal-url').value || '').trim();
      var icon = (document.getElementById('v5-modal-icon').value || '').trim() || '🔗';
      if (!nm) { document.getElementById('v5-modal-name').focus(); return; }
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        var list = raw ? JSON.parse(raw) : [];
        list.push({ id: 'u_' + Date.now(), name: nm, url: url, icon: icon, favorite: false, category: 'general' });
        saveUserBookmarks(list);
      } catch (e) {}
      overlay.remove();
      renderBookmarks(getMergedBookmarks(), currentMenu);
    });
    setTimeout(function () {
      var inp = document.getElementById('v5-modal-name');
      if (inp) inp.focus();
    }, 100);
  }

  /* ==========================================================
     驾驶舱
     ========================================================== */

  function renderDashboard() {
    try {
      renderKPIs();
      renderChart();
      renderLogs();
    } catch (err) {
      var container = document.getElementById('view-dashboard');
      if (container) {
        container.innerHTML = '<p style="padding:2rem;color:#c44;">图表库加载失败，请刷新重试。</p>';
      }
    }
  }

  function renderKPIs() {
    var grid = document.getElementById('kpi-grid');
    if (!grid || !metricsData || !metricsData.kpis) return;
    var frag = document.createDocumentFragment();
    metricsData.kpis.forEach(function (kpi) {
      var card = document.createElement('div');
      card.className = 'kpi-card';
      var cls = kpi.change && kpi.change.charAt(0) === '+' ? 'up' : 'down';
      card.innerHTML =
        '<span class="kpi-label">' + esc(kpi.label) + '</span>' +
        '<span class="kpi-value">' + fmtKpi(kpi.value, kpi.label) + '</span>' +
        '<span class="kpi-change ' + cls + '">' + esc(kpi.change) + '</span>';
      frag.appendChild(card);
    });
    grid.innerHTML = '';
    grid.appendChild(frag);
  }

  function fmtKpi(val, label) {
    if (typeof val === 'number') {
      if (label.indexOf('%') >= 0 || label.indexOf('率') >= 0) return val + '%';
      return val.toLocaleString();
    }
    return val;
  }

  function renderChart() {
    var container = document.getElementById('chart-container');
    var placeholder = document.getElementById('chart-placeholder');
    if (!container || !metricsData) return;
    if (typeof echarts === 'undefined') {
      if (placeholder) placeholder.textContent = '图表库加载失败，请刷新重试。';
      return;
    }
    if (placeholder) placeholder.style.display = 'none';
    if (!chartInstance) chartInstance = echarts.init(container);

    var option = {
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category', data: ['Day1','Day2','Day3','Day4','Day5','Day6','Day7'],
        axisLabel: { color: 'oklch(55% 0.01 70)', fontSize: 11 }
      },
      yAxis: {
        type: 'value', name: '请求量',
        splitLine: { lineStyle: { color: 'oklch(90% 0.005 220)' } },
        axisLabel: { color: 'oklch(55% 0.01 70)', fontSize: 11 }
      },
      series: [{
        data: metricsData.trend || [],
        type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
        lineStyle: { color: 'oklch(58% 0.12 180)', width: 2 },
        itemStyle: { color: 'oklch(58% 0.12 180)' },
        areaStyle: { color: new echarts.graphic.LinearGradient(0,0,0,1,[
          { offset: 0, color: 'oklch(58% 0.12 180 / 0.25)' },
          { offset: 1, color: 'oklch(58% 0.12 180 / 0.02)' }
        ])}
      }]
    };
    chartInstance.setOption(option, true);
  }

  function renderLogs() {
    var tbody = document.getElementById('logs-tbody');
    if (!tbody || !metricsData || !metricsData.logs) return;
    var frag = document.createDocumentFragment();
    metricsData.logs.forEach(function (log) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + esc(log.time) + '</td>' +
        '<td>' + esc(log.user) + '</td>' +
        '<td>' + esc(log.action) + '</td>' +
        '<td class="' + (log.status === '成功' ? 'log-status-ok' : 'log-status-fail') + '">' + esc(log.status) + '</td>';
      frag.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(frag);
  }

  var refreshBound = false;

  function bindRefresh() {
    if (refreshBound) return;
    refreshBound = true;
    var btn = document.getElementById('dashboard-refresh');
    if (!btn) { refreshBound = false; return; }
    btn.addEventListener('click', async function () {
      btn.textContent = '⏳ 刷新中...';
      btn.disabled = true;
      try {
        metricsData = await fetchJSON('data/metrics.json?t=' + Date.now());
        metricsData.kpis.forEach(function (kpi) {
          if (typeof kpi.value === 'number') {
            kpi.value = Math.round(kpi.value + (Math.random() - 0.5) * 0.05 * kpi.value);
          }
        });
        metricsData.trend = metricsData.trend.map(function (v) {
          return Math.max(0, v + Math.round((Math.random() - 0.5) * 60));
        });
        renderKPIs();
        renderChart();
        renderLogs();
        btn.textContent = '✅ 已刷新';
      } catch (err) {
        btn.textContent = '❌ 刷新失败';
      }
      btn.disabled = false;
      setTimeout(function () { if (btn) btn.textContent = '🔄 刷新'; }, 2000);
    });
  }

  /* ==========================================================
     插件视图
     ========================================================== */

  function renderPluginView() {
    // 确保所有插件挂载点就位
    var grid = document.getElementById('plugin-grid');
    if (!grid) return;
    mountPlugins();
  }

  /* ==========================================================
     插件加载
     ========================================================== */

  function mountPlugins() {
    var plugins = window.__PLUGINS__;
    if (!plugins || plugins.length === 0) return;
    plugins.forEach(function (plugin) {
      if (!plugin.enabled) return;
      var target = document.getElementById('plugin-' + plugin.id);
      if (!target) return;
      // 防止重复加载：检查是否已有插件根节点
      if (target.children.length > 0 && !target.querySelector('.plugin-placeholder')) return;
      tryLoadPlugin(plugin, target);
    });
  }

  function tryLoadPlugin(plugin, mountTarget) {
    try {
      var script = document.createElement('script');
      script.src = plugin.src;
      script.async = true;
      script.dataset.mount = mountTarget.id;
      script.onload = function () { console.log('[V5] 插件 %s 加载成功', plugin.id); };
      script.onerror = function () {
        mountTarget.innerHTML = '<div class="plugin-placeholder">插件「' + plugin.id + '」加载失败</div>';
      };
      document.head.appendChild(script);
    } catch (err) {
      mountTarget.innerHTML = '<div class="plugin-placeholder">插件「' + plugin.id + '」加载失败</div>';
    }
  }

  /* ==========================================================
     工具
     ========================================================== */

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function showError(msg) {
    var el = document.querySelector('.main-content');
    if (el) el.innerHTML = '<p style="padding:2rem;color:#c44;">' + esc(msg) + '</p>';
  }

  /* ==========================================================
     启动
     ========================================================== */

  render();
})();
