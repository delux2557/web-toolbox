/**
 * v3/script.js — V3 菜单驱动 · 数据驾驶舱版
 *
 * 特性：
 * 1. 侧边栏 4 菜单：全部书签 / 收藏夹 / 工具 / 数据驾驶舱
 * 2. 书签按 favorite / category 过滤
 * 3. 驾驶舱：KPI 指标卡 + ECharts 折线图 + 日志表格
 * 4. 刷新按钮动态更新驾驶舱数据
 * 5. 插件加载 + 书签 CRUD + 数据新鲜度
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'user_bookmarks';
  var settingsData = null;
  var metricsData = null;
  var chartInstance = null;
  var currentMenu = 'all';

  /* ==========================================================
     初始化
     ========================================================== */

  async function render() {
    try {
      settingsData = await fetchJSON('data/settings.json');
      metricsData = await fetchJSON('data/metrics.json');
    } catch (err) {
      console.error('[V3] 数据加载失败:', err);
      showError('数据加载失败，请刷新重试。');
      return;
    }

    renderSidebarUser(settingsData.userName);
    renderFreshness(settingsData.lastUpdated);
    initMenuListeners();
    switchMenu(currentMenu);
    injectManageUI();
    mountPlugins();
    handleDisabledPlugins();
  }

  async function fetchJSON(url) {
    var resp = await fetch(url);
    if (!resp.ok) throw new Error(url + ' 请求失败，状态码 ' + resp.status);
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
     侧边栏用户 + 新鲜度
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

    if (menu === 'dashboard') {
      bmView.style.display = 'none';
      dbView.style.display = 'block';
      renderDashboard();
    } else {
      bmView.style.display = 'block';
      dbView.style.display = 'none';
      var merged = getMergedBookmarks();
      renderBookmarks(merged, menu);
    }
  }

  /* ==========================================================
     书签渲染 + 过滤
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

    // 删除按钮
    var delBtn = document.createElement('button');
    delBtn.className = 'row-delete-btn';
    delBtn.innerHTML = '&times;';
    delBtn.title = '删除';
    delBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      removeBookmark(bm.id);
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

  function removeBookmark(id) {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      list = list.filter(function (b) { return b.id !== id; });
      saveUserBookmarks(list);
    } catch (e) {}
    refreshCurrentView();
  }

  function refreshCurrentView() {
    var merged = getMergedBookmarks();
    if (currentMenu === 'dashboard') {
      renderDashboard();
    } else {
      renderBookmarks(merged, currentMenu);
    }
    refreshManageList(merged);
  }

  /* ==========================================================
     驾驶舱渲染
     ========================================================== */

  function renderDashboard() {
    try {
      renderKPIs();
      renderChart();
      renderLogs();
    } catch (err) {
      console.error('[V3] 驾驶舱渲染失败:', err);
      var container = document.getElementById('view-dashboard');
      if (container) {
        container.innerHTML = '<p style="padding:2rem;color:#c44;">图表库加载失败，请刷新重试。</p>';
      }
    }
  }

  /* KPI 卡片 */
  function renderKPIs() {
    var grid = document.getElementById('kpi-grid');
    if (!grid || !metricsData || !metricsData.kpis) return;

    var frag = document.createDocumentFragment();
    metricsData.kpis.forEach(function (kpi) {
      var card = document.createElement('div');
      card.className = 'kpi-card';
      var changeClass = kpi.change && kpi.change.charAt(0) === '+' ? 'up' : 'down';
      card.innerHTML =
        '<span class="kpi-label">' + esc(kpi.label) + '</span>' +
        '<span class="kpi-value">' + formatKpiValue(kpi.value, kpi.label) + '</span>' +
        '<span class="kpi-change ' + changeClass + '">' + esc(kpi.change) + '</span>';
      frag.appendChild(card);
    });
    grid.innerHTML = '';
    grid.appendChild(frag);
  }

  function formatKpiValue(val, label) {
    if (typeof val === 'number') {
      if (label.indexOf('%') >= 0 || label.indexOf('率') >= 0) return val + '%';
      return val.toLocaleString();
    }
    return val;
  }

  /* ECharts 图表 */
  function renderChart() {
    var container = document.getElementById('chart-container');
    var placeholder = document.getElementById('chart-placeholder');
    if (!container || !metricsData) return;

    if (typeof echarts === 'undefined') {
      if (placeholder) placeholder.textContent = '图表库加载失败，请刷新重试。';
      return;
    }

    if (placeholder) placeholder.style.display = 'none';

    if (!chartInstance) {
      chartInstance = echarts.init(container);
    }

    var option = {
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: ['Day1', 'Day2', 'Day3', 'Day4', 'Day5', 'Day6', 'Day7'],
        axisLine: { lineStyle: { color: 'oklch(80% 0.005 220)' } },
        axisLabel: { color: 'oklch(55% 0.01 70)', fontSize: 11 }
      },
      yAxis: {
        type: 'value',
        name: '请求量',
        splitLine: { lineStyle: { color: 'oklch(90% 0.005 220)' } },
        axisLabel: { color: 'oklch(55% 0.01 70)', fontSize: 11 }
      },
      series: [{
        data: metricsData.trend || [],
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: 'oklch(58% 0.12 180)', width: 2 },
        itemStyle: { color: 'oklch(58% 0.12 180)' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'oklch(58% 0.12 180 / 0.25)' },
            { offset: 1, color: 'oklch(58% 0.12 180 / 0.02)' }
          ])
        }
      }]
    };

    chartInstance.setOption(option, true);

    // 响应式
    window.addEventListener('resize', function () {
      if (chartInstance) chartInstance.resize();
    });
  }

  /* 日志表格 */
  function renderLogs() {
    var tbody = document.getElementById('logs-tbody');
    if (!tbody || !metricsData || !metricsData.logs) return;

    var frag = document.createDocumentFragment();
    metricsData.logs.forEach(function (log) {
      var tr = document.createElement('tr');
      var statusClass = log.status === '成功' ? 'log-status-ok' : 'log-status-fail';
      tr.innerHTML =
        '<td>' + esc(log.time) + '</td>' +
        '<td>' + esc(log.user) + '</td>' +
        '<td>' + esc(log.action) + '</td>' +
        '<td class="' + statusClass + '">' + esc(log.status) + '</td>';
      frag.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(frag);
  }

  /* 驾驶舱刷新 */
  var refreshBtn = null;
  function bindRefresh() {
    refreshBtn = document.getElementById('dashboard-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async function () {
        refreshBtn.textContent = '⏳ 刷新中...';
        refreshBtn.disabled = true;
        try {
          metricsData = await fetchJSON('data/metrics.json?t=' + Date.now());
          // 轻微随机扰动模拟实时更新
          metricsData.kpis.forEach(function (kpi) {
            if (typeof kpi.value === 'number') {
              var delta = (Math.random() - 0.5) * 0.05 * kpi.value;
              kpi.value = Math.round(kpi.value + delta);
            }
          });
          metricsData.trend = metricsData.trend.map(function (v) {
            return Math.max(0, v + Math.round((Math.random() - 0.5) * 60));
          });
          renderKPIs();
          renderChart();
          renderLogs();
          refreshBtn.textContent = '✅ 已刷新';
        } catch (err) {
          console.error('[V3] 刷新失败:', err);
          refreshBtn.textContent = '❌ 刷新失败';
        }
        refreshBtn.disabled = false;
        setTimeout(function () { if (refreshBtn) refreshBtn.textContent = '🔄 刷新'; }, 2000);
      });
    }
  }

  /* ==========================================================
     书签管理面板
     ========================================================== */

  function injectManageUI() {
    if (document.getElementById('v3-manage-section')) return;
    var main = document.querySelector('.main-content');
    if (!main) return;

    var section = document.createElement('section');
    section.id = 'v3-manage-section';
    section.className = 'v2-manage-section';
    section.innerHTML =
      '<div class="v2-manage-header">' +
        '<span class="v2-manage-title">📂 管理书签</span>' +
        '<button class="v2-manage-btn-add" id="v3-btn-add">+ 添加</button>' +
      '</div>' +
      '<ul class="v2-manage-list" id="v3-manage-list"></ul>';
    main.appendChild(section);

    document.getElementById('v3-btn-add').addEventListener('click', function () {
      showModal();
    });
    refreshManageList(getMergedBookmarks());
  }

  function refreshManageList(bookmarks) {
    var list = document.getElementById('v3-manage-list');
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
        '<span class="v2-manage-item-icon">' + (bm.icon || '🔗') + '</span>' +
        '<span class="v2-manage-item-name">' + esc(bm.name) + '</span>' +
        '<button class="v2-manage-item-del" data-id="' + bm.id + '" title="删除">&times;</button>';
      frag.appendChild(li);
    });
    list.innerHTML = '';
    list.appendChild(frag);
    list.querySelectorAll('.v2-manage-item-del').forEach(function (btn) {
      btn.addEventListener('click', function () { removeBookmark(btn.getAttribute('data-id')); });
    });
  }

  /* 添加书签模态框 */
  function showModal() {
    var old = document.getElementById('v3-modal-overlay');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'v3-modal-overlay';
    overlay.className = 'v2-modal-overlay';
    overlay.innerHTML =
      '<div class="v2-modal">' +
        '<h3 class="v2-modal-title">添加书签</h3>' +
        '<label class="v2-modal-label">名称</label>' +
        '<input class="v2-modal-input" id="v3-modal-name" placeholder="书签名称" maxlength="60" />' +
        '<label class="v2-modal-label">链接</label>' +
        '<input class="v2-modal-input" id="v3-modal-url" placeholder="https://..." maxlength="500" />' +
        '<label class="v2-modal-label">图标 Emoji</label>' +
        '<input class="v2-modal-input" id="v3-modal-icon" placeholder="🚀" maxlength="4" />' +
        '<div class="v2-modal-actions">' +
          '<button class="v2-modal-btn v2-modal-btn-cancel" id="v3-modal-cancel">取消</button>' +
          '<button class="v2-modal-btn v2-modal-btn-confirm" id="v3-modal-confirm">确认</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.getElementById('v3-modal-cancel').addEventListener('click', function () { overlay.remove(); });
    document.getElementById('v3-modal-confirm').addEventListener('click', function () {
      var nm = (document.getElementById('v3-modal-name').value || '').trim();
      var url = (document.getElementById('v3-modal-url').value || '').trim();
      var icon = (document.getElementById('v3-modal-icon').value || '').trim() || '🔗';
      if (!nm) { document.getElementById('v3-modal-name').focus(); return; }
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        var list = raw ? JSON.parse(raw) : [];
        list.push({ id: 'u_' + Date.now(), name: nm, url: url, icon: icon, favorite: false, category: 'general' });
        saveUserBookmarks(list);
      } catch (e) {}
      overlay.remove();
      refreshCurrentView();
    });
    setTimeout(function () {
      var inp = document.getElementById('v3-modal-name');
      if (inp) inp.focus();
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
      script.onload = function () { console.log('[V3] 插件 %s 加载成功', plugin.id); };
      script.onerror = function () {
        console.error('[V3] 插件 %s 加载失败', plugin.id);
        showPluginError(mountTarget, plugin.id);
      };
      document.head.appendChild(script);
    } catch (err) { showPluginError(mountTarget, plugin.id); }
  }

  function handleDisabledPlugins() {
    var plugins = window.__PLUGINS__;
    if (!plugins) return;
    plugins.forEach(function (plugin) {
      if (!plugin.enabled) showPluginDisabled(plugin.id);
    });
  }

  function showPluginDisabled(id) {
    var target = document.getElementById('plugin-' + id);
    if (target) target.innerHTML = '<div class="plugin-placeholder">插件「' + id + '」未激活</div>';
  }

  function showPluginError(target, id) {
    target.innerHTML = '<div class="plugin-placeholder">插件「' + id + '」加载失败</div>';
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

  render().then(function () {
    bindRefresh();
  });
})();
