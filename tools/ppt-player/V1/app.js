/**
 * AI PPT Player — V1 幻灯片引擎
 * 契约：window.__SLIDE_ENGINE__ = { init, goTo, destroy }
 */
(function () {
  'use strict';

  var DURATION_FALLBACK = 800; // transitionend 兜底超时

  var engine = {
    currentIndex: 0,
    totalPages: 0,
    isAnimating: false,
    slides: [],
    chartInstance: null,
    _onResize: null,

    /**
     * 初始化：接收 { totalPages }，隐藏所有页并显示第一页
     */
    init: function (config) {
      this.totalPages = (config && typeof config.totalPages === 'number')
        ? config.totalPages
        : this.slides.length;
      this.currentIndex = 0;
      this.isAnimating = false;

      this.slides.forEach(function (slide) {
        slide.classList.remove(
          'active',
          'exit-fade', 'exit-left', 'exit-right',
          'enter-fade', 'enter-left', 'enter-right'
        );
        slide.style.zIndex = '';
      });

      if (this.slides[0]) {
        this.slides[0].classList.add('active');
      }

      this.renderChart();
      this._bindResize();
    },

    /**
     * 翻页：返回 Promise，动画结束后 resolve
     */
    goTo: function (index, transition) {
      var self = this;

      // 防连点：动画进行中直接忽略
      if (this.isAnimating) return Promise.resolve();
      if (index === this.currentIndex) return Promise.resolve();
      if (index < 0 || index >= this.totalPages) return Promise.resolve();

      this.isAnimating = true;

      var from = this.slides[this.currentIndex];
      var to = this.slides[index];
      var dir = index > this.currentIndex ? 1 : -1;
      var mode = transition || 'fade';

      var exitClass, enterClass;
      if (mode === 'slide-left') { exitClass = 'exit-left'; enterClass = 'enter-right'; }
      else if (mode === 'slide-right') { exitClass = 'exit-right'; enterClass = 'enter-left'; }
      else { exitClass = 'exit-fade'; enterClass = 'enter-fade'; }

      return new Promise(function (resolve) {
        var done = false;

        function finish() {
          if (done) return;
          done = true;
          to.removeEventListener('transitionend', onTransitionEnd);

          from.classList.remove('active', exitClass);
          from.style.zIndex = '';

          to.classList.remove(enterClass);
          to.classList.add('active');
          to.style.zIndex = '';

          self.currentIndex = index;
          self.isAnimating = false;

          // 目标页可见后再渲染图表（懒渲染，规避隐藏容器尺寸为 0）
          self.renderChart();

          resolve();
        }

        function onTransitionEnd(e) {
          if (e.target === to &&
              (e.propertyName === 'transform' || e.propertyName === 'opacity')) {
            finish();
          }
        }

        // 目标页置于上层，避免交叉重叠时被遮挡
        to.style.zIndex = '2';
        from.style.zIndex = '1';

        // 目标页进入初始状态（无过渡）
        to.classList.add('active', enterClass);
        // 强制回流，提交初始状态
        void to.offsetWidth;
        // 触发目标页进入动画
        to.classList.remove(enterClass);
        // 触发当前页退出动画
        from.classList.add(exitClass);

        to.addEventListener('transitionend', onTransitionEnd);
        // 兜底：避免 transitionend 未触发导致卡死
        setTimeout(finish, DURATION_FALLBACK);
      });
    },

    /**
     * 销毁：清除图表实例与事件监听
     */
    destroy: function () {
      if (this._onResize) {
        window.removeEventListener('resize', this._onResize);
        this._onResize = null;
      }
      if (this.chartInstance) {
        try { this.chartInstance.dispose(); } catch (e) {}
        this.chartInstance = null;
        window.__chartInstance = null;
      }
    },

    /**
     * 渲染 ECharts（懒渲染：容器不可见时跳过）
     */
    renderChart: function () {
      var container = document.getElementById('chart-container');
      if (!container || typeof window.echarts === 'undefined') return;
      // display:none 时尺寸为 0，跳过，待可见后再渲染
      if (container.offsetWidth === 0 || container.offsetHeight === 0) return;

      if (!this.chartInstance) {
        this.chartInstance = window.echarts.init(container);
        window.__chartInstance = this.chartInstance;
      }
      this.chartInstance.setOption(buildChartOption(), true);
      this.chartInstance.resize();
    },

    _bindResize: function () {
      var self = this;
      this._onResize = function () {
        if (self.chartInstance) self.chartInstance.resize();
      };
      window.addEventListener('resize', this._onResize);
    }
  };

  function buildChartOption() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var ink = dark ? '#eef0f4' : '#16181d';
    var muted = dark ? '#9aa1ad' : '#6b7280';
    var line = dark ? '#2a2d35' : '#e5e3dd';
    var accent = dark ? '#7c9bff' : '#3b5bdb';
    var accentEnd = dark ? '#3d50b5' : '#6b7ff0';

    return {
      animationDuration: 800,
      animationEasing: 'cubicOut',
      grid: { left: 8, right: 8, top: 26, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: dark ? '#1b1d23' : '#ffffff',
        borderColor: line,
        textStyle: { color: ink }
      },
      xAxis: {
        type: 'category',
        data: ['Q1', 'Q2', 'Q3', 'Q4'],
        axisLine: { lineStyle: { color: line } },
        axisTick: { show: false },
        axisLabel: { color: muted }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: line, type: 'dashed' } },
        axisLabel: { color: muted }
      },
      series: [
        {
          name: '营收',
          type: 'bar',
          barWidth: '42%',
          data: [42, 68, 55, 90],
          itemStyle: {
            borderRadius: [6, 6, 0, 0],
            color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: accent },
              { offset: 1, color: accentEnd }
            ])
          },
          label: { show: true, position: 'top', color: muted }
        }
      ]
    };
  }

  /**
   * 编辑预留：为文本节点添加 contenteditable，并回传修改数据给壳
   */
  function attachEdit() {
    var selectors = ['h1', 'h2', 'h3', 'p', 'li', 'span'];
    engine.slides.forEach(function (slide, pageIndex) {
      selectors.forEach(function (sel) {
        var nodes = slide.querySelectorAll(sel);
        Array.prototype.forEach.call(nodes, function (node) {
          // 跳过 code（避免误编辑行内代码）
          if (node.tagName.toLowerCase() === 'code') return;
          node.setAttribute('contenteditable', 'true');
          node.setAttribute('spellcheck', 'false');
          node.addEventListener('input', function () {
            try {
              window.parent.postMessage({
                type: 'EDIT_CONTENT',
                page: pageIndex,
                data: {
                  tag: node.tagName.toLowerCase(),
                  text: node.textContent
                }
              }, '*');
            } catch (e) { /* 跨域或父窗口不可用时忽略 */ }
          });
        });
      });
    });
  }

  // 暴露契约
  window.__SLIDE_ENGINE__ = engine;

  // 文档加载完成后初始化
  window.addEventListener('load', function () {
    engine.slides = Array.prototype.slice.call(
      document.querySelectorAll('.slide-page')
    );
    engine.init({ totalPages: engine.slides.length });
    attachEdit();

    // 通知壳：引擎已就绪
    try {
      window.parent.postMessage(
        { type: 'SLIDE_READY', totalPages: engine.totalPages },
        '*'
      );
    } catch (e) {}
  });

  // 主题同步：接收壳下发的主题变更
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (d && d.type === 'THEME_CHANGE' && (d.theme === 'light' || d.theme === 'dark')) {
      document.documentElement.setAttribute('data-theme', d.theme);
      engine.renderChart();
    }
  });
})();
