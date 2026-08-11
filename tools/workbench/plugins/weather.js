/**
 * plugins/weather.js — Weather 天气插件
 *
 * 规范：
 * - 通过 window.WeatherPlugin 暴露全局接口
 * - Open-Meteo 免费 API（无需 Key）+ localStorage 缓存（TTL 30min）
 * - 预设城市快速切换 + 刷新按钮
 * - 样式完全独立封装（wp-* BEM 命名，不依赖任何外部 CSS）
 * - data-mount 自动挂载
 */
(function () {
  'use strict';

  var CACHE_KEY = 'weather_cache';
  var CACHE_TTL = 30 * 60 * 1000; // 30 分钟

  /* ---- 预设城市（经纬度）---- */
  var CITIES = [
    { name: '北京', lat: 39.9042, lon: 116.4074 },
    { name: '上海', lat: 31.2304, lon: 121.4737 },
    { name: '深圳', lat: 22.5431, lon: 114.0579 },
    { name: '杭州', lat: 30.2741, lon: 120.1551 },
    { name: '成都', lat: 30.5728, lon: 104.0668 }
  ];

  /* ---- 天气代码 → emoji + 描述 ---- */
  var WMO_CODES = {
    0:  { icon: '☀️', text: '晴天' },
    1:  { icon: '🌤️', text: '少云' },
    2:  { icon: '⛅', text: '多云' },
    3:  { icon: '☁️', text: '阴天' },
    45: { icon: '🌫️', text: '雾' },
    48: { icon: '🌫️', text: '雾凇' },
    51: { icon: '🌦️', text: '小毛毛雨' },
    53: { icon: '🌦️', text: '毛毛雨' },
    55: { icon: '🌦️', text: '大毛毛雨' },
    61: { icon: '🌧️', text: '小雨' },
    63: { icon: '🌧️', text: '中雨' },
    65: { icon: '🌧️', text: '大雨' },
    71: { icon: '🌨️', text: '小雪' },
    73: { icon: '🌨️', text: '中雪' },
    75: { icon: '🌨️', text: '大雪' },
    80: { icon: '🌦️', text: '阵雨' },
    95: { icon: '⛈️', text: '雷暴' }
  };

  /* ==========================================================
     WeatherPlugin
     ========================================================== */

  function WeatherPlugin(container) {
    injectStyles();
    this.container = container;
    this.currentCity = CITIES[0];

    // 尝试读取缓存城市
    try {
      var saved = localStorage.getItem('weather_city');
      if (saved) {
        var found = CITIES.find(function (c) { return c.name === saved; });
        if (found) this.currentCity = found;
      }
    } catch (e) {}

    this._render();
    this._loadData();
  }

  /* ---- 数据获取 ---- */

  WeatherPlugin.prototype._loadData = async function () {
    var self = this;

    // 先检查缓存
    var cached = null;
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (raw) cached = JSON.parse(raw);
    } catch (e) {}

    if (cached && cached.city === self.currentCity.name && (Date.now() - cached.ts) < CACHE_TTL) {
      self._updateUI(cached.data);
      return;
    }

    self._setStatus('加载中...');

    try {
      var url = 'https://api.open-meteo.com/v1/forecast' +
        '?latitude=' + self.currentCity.lat +
        '&longitude=' + self.currentCity.lon +
        '&current_weather=true' +
        '&hourly=relativehumidity_2m' +
        '&timezone=Asia%2FShanghai';

      var resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      var json = await resp.json();
      var cw = json.current_weather;

      var data = {
        temp: Math.round(cw.temperature),
        windspeed: cw.windspeed,
        weathercode: cw.weathercode,
        humidity: json.hourly ? json.hourly.relativehumidity_2m[0] : null
      };

      // 缓存
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          city: self.currentCity.name,
          ts: Date.now(),
          data: data
        }));
      } catch (e) {}

      self._updateUI(data);
    } catch (err) {
      console.warn('[Weather] API 请求失败:', err.message);
      // 降级：使用过期缓存
      if (cached) {
        self._updateUI(cached.data);
        self._setBadge('缓存');
      } else {
        self._showError();
      }
    }
  };

  /* ---- UI 渲染 ---- */

  WeatherPlugin.prototype._render = function () {
    var self = this;

    this.container.innerHTML =
      '<div class="wp-root">' +
        '<div class="wp-header">' +
          '<span class="wp-title">天气</span>' +
          '<span class="wp-badge" id="wp-badge"></span>' +
        '</div>' +

        '<div class="wp-city-row">' +
          '<select class="wp-select" id="wp-select"></select>' +
        '</div>' +

        '<div class="wp-main" id="wp-main">' +
          '<span class="wp-icon" id="wp-icon">--</span>' +
          '<span class="wp-temp" id="wp-temp">--°C</span>' +
          '<span class="wp-desc" id="wp-desc">--</span>' +
        '</div>' +

        '<div class="wp-details" id="wp-details">' +
          '<span class="wp-detail-item">' +
            '<span class="wp-detail-label">风速</span>' +
            '<span class="wp-detail-value" id="wp-wind">-- km/h</span>' +
          '</span>' +
          '<span class="wp-detail-item">' +
            '<span class="wp-detail-label">湿度</span>' +
            '<span class="wp-detail-value" id="wp-humid">--%</span>' +
          '</span>' +
        '</div>' +

        '<div class="wp-actions">' +
          '<button class="wp-btn-refresh" id="wp-refresh">🔄 刷新</button>' +
        '</div>' +
      '</div>';

    // 填充城市下拉
    var sel = this.container.querySelector('#wp-select');
    if (sel) {
      CITIES.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = c.name;
        if (c.name === self.currentCity.name) opt.selected = true;
        sel.appendChild(opt);
      });
    }

    this._bindEvents();
  };

  WeatherPlugin.prototype._updateUI = function (data) {
    var wmo = WMO_CODES[data.weathercode] || { icon: '🌈', text: '未知' };

    setText('wp-icon', wmo.icon);
    setText('wp-temp', data.temp + '°C');
    setText('wp-desc', wmo.text);
    setText('wp-wind', data.windspeed + ' km/h');
    setText('wp-humid', data.humidity != null ? data.humidity + '%' : '--');
    setText('wp-badge', '');
  };

  WeatherPlugin.prototype._showError = function () {
    setText('wp-icon', '⚠️');
    setText('wp-temp', '--°C');
    setText('wp-desc', '网络异常');
    setText('wp-wind', '-- km/h');
    setText('wp-humid', '--');
    setText('wp-badge', '离线');
  };

  WeatherPlugin.prototype._setStatus = function (text) {
    setText('wp-desc', text);
  };

  WeatherPlugin.prototype._setBadge = function (text) {
    setText('wp-badge', text);
  };

  /* ---- 事件 ---- */

  WeatherPlugin.prototype._bindEvents = function () {
    var self = this;

    var sel = this.container.querySelector('#wp-select');
    if (sel) {
      sel.addEventListener('change', function () {
        var name = sel.value;
        var city = CITIES.find(function (c) { return c.name === name; });
        if (city) {
          self.currentCity = city;
          try { localStorage.setItem('weather_city', name); } catch (e) {}
          self._loadData();
        }
      });
    }

    var btn = this.container.querySelector('#wp-refresh');
    if (btn) {
      btn.addEventListener('click', function () {
        btn.textContent = '⏳';
        btn.disabled = true;
        // 清除缓存强制刷新
        try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
        self._loadData().finally(function () {
          btn.textContent = '🔄 刷新';
          btn.disabled = false;
        });
      });
    }
  };

  /* ==========================================================
     样式注入（只注入一次）
     ========================================================== */

  var _stylesInjected = false;

  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;

    var style = document.createElement('style');
    style.setAttribute('data-plugin', 'weather');
    style.textContent = [
      '.wp-root {',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;',
      '  color: oklch(25% 0.01 70); line-height: 1.5;',
      '}',

      '.wp-header {',
      '  display: flex; align-items: center; justify-content: space-between;',
      '  margin-bottom: 8px;',
      '}',
      '.wp-title { font-size: 0.875rem; font-weight: 600; }',
      '.wp-badge { font-size: 0.7rem; color: oklch(55% 0.01 70); background: oklch(92% 0.01 70); padding: 1px 6px; border-radius: 3px; }',

      '.wp-city-row { margin-bottom: 10px; }',
      '.wp-select {',
      '  width: 100%; padding: 6px 8px; font-size: 0.8125rem;',
      '  border: 1px solid oklch(88% 0.005 220); border-radius: 3px;',
      '  background: oklch(100% 0 0); color: inherit; outline: none;',
      '  box-sizing: border-box; cursor: pointer;',
      '}',

      '.wp-main {',
      '  display: flex; align-items: center; gap: 10px;',
      '  padding: 12px 0; margin-bottom: 8px;',
      '}',
      '.wp-icon { font-size: 2.2rem; line-height: 1; flex-shrink: 0; }',
      '.wp-temp { font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }',
      '.wp-desc { font-size: 0.8125rem; color: oklch(50% 0.01 70); }',

      '.wp-details {',
      '  display: flex; gap: 16px; margin-bottom: 10px;',
      '  padding: 8px 10px; border-radius: 4px;',
      '  background: oklch(96% 0.01 70);',
      '}',
      '.wp-detail-item { display: flex; flex-direction: column; gap: 2px; }',
      '.wp-detail-label { font-size: 0.7rem; color: oklch(58% 0.01 70); text-transform: uppercase; letter-spacing: 0.04em; }',
      '.wp-detail-value { font-size: 0.8125rem; font-weight: 600; }',

      '.wp-actions { display: flex; justify-content: flex-end; }',
      '.wp-btn-refresh {',
      '  padding: 4px 12px; font-size: 0.75rem; font-weight: 500;',
      '  color: oklch(58% 0.12 180); background: oklch(94% 0.03 180);',
      '  border: 1px solid oklch(88% 0.03 180); border-radius: 3px;',
      '  cursor: pointer; transition: all 120ms ease-out; box-sizing: border-box;',
      '}',
      '.wp-btn-refresh:hover { background: oklch(58% 0.12 180); color: #fff; border-color: oklch(58% 0.12 180); }',
      '.wp-btn-refresh:disabled { opacity: 0.5; cursor: not-allowed; }',

      /* 暗色模式 */
      '@media (prefers-color-scheme: dark) {',
      '  .wp-root { color: oklch(88% 0.005 220); }',
      '  .wp-badge { color: oklch(52% 0.005 220); background: oklch(22% 0.005 220); }',
      '  .wp-select {',
      '    border-color: oklch(28% 0.005 220);',
      '    background: oklch(18% 0.005 220); color: oklch(88% 0.005 220);',
      '  }',
      '  .wp-desc { color: oklch(60% 0.005 220); }',
      '  .wp-details { background: oklch(20% 0.005 220); }',
      '  .wp-detail-label { color: oklch(48% 0.005 220); }',
      '  .wp-btn-refresh { background: oklch(22% 0.04 180); border-color: oklch(30% 0.03 180); }',
      '}'
    ].join('\n');

    document.head.appendChild(style);
  }

  /* ==========================================================
     工具
     ========================================================== */

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /* ==========================================================
     自启动
     ========================================================== */

  function bootstrap() {
    var scripts = document.getElementsByTagName('script');
    var mountId = null;
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('weather.js') !== -1) {
        mountId = scripts[i].getAttribute('data-mount');
        break;
      }
    }
    if (!mountId) {
      console.warn('[Weather] 未找到 data-mount，插件未挂载');
      return;
    }
    var container = document.getElementById(mountId);
    if (!container) {
      console.warn('[Weather] 挂载目标 #%s 不存在', mountId);
      return;
    }
    new WeatherPlugin(container);
  }

  window.WeatherPlugin = WeatherPlugin;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
