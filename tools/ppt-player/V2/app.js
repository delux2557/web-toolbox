/**
 * AI PPT Player — V2 极简引擎（纯 CSS 动画 + 原生 JS，零依赖）
 * 契约：window.__SLIDE_ENGINE__ = { init, goTo, destroy }
 * 严格遵守「PPT 生成 Agent 开发规范（契约手册）」，详见 index.html <head> 注释块。
 */
(function () {
  'use strict';

  var DURATION_FALLBACK = 800; // transitionend 兜底超时

  var engine = {
    currentIndex: 0,
    totalPages: 0,
    isAnimating: false,
    slides: [],
    _rafId: null,
    _orb: null,
    _orbAngle: 0,
    _onResize: null,

    /**
     * 初始化：设置 totalPages，显示第一页，启动 rAF 装饰动画
     */
    init: function (config) {
      this.totalPages = (config && typeof config.totalPages === 'number')
        ? config.totalPages
        : this.slides.length;
      this.currentIndex = 0;
      this.isAnimating = false;

      this.slides.forEach(function (s) {
        s.classList.remove(
          'active',
          'exit-fade', 'exit-left', 'exit-right',
          'enter-fade', 'enter-left', 'enter-right'
        );
        s.style.zIndex = '';
      });

      if (this.slides[0]) this.slides[0].classList.add('active');

      this._orb = document.getElementById('orb');
      this._startOrbit();
      this._bindResize();
    },

    /**
     * 翻页：防连点锁 + transitionend，动画结束 resolve()
     */
    goTo: function (index, transition) {
      var self = this;

      // 防连点：动画进行中直接忽略（绝不报错）
      if (this.isAnimating) return Promise.resolve();
      if (index === this.currentIndex) return Promise.resolve();
      if (index < 0 || index >= this.totalPages) return Promise.resolve();

      this.isAnimating = true;

      var from = this.slides[this.currentIndex];
      var to = this.slides[index];
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
          to.removeEventListener('transitionend', onEnd);

          from.classList.remove('active', exitClass);
          from.style.zIndex = '';

          to.classList.remove(enterClass);
          to.classList.add('active');
          to.style.zIndex = '';

          self.currentIndex = index;
          self.isAnimating = false;
          resolve();
        }

        function onEnd(e) {
          if (e.target === to &&
              (e.propertyName === 'transform' || e.propertyName === 'opacity')) {
            finish();
          }
        }

        to.style.zIndex = '2';
        from.style.zIndex = '1';

        to.classList.add('active', enterClass);
        void to.offsetWidth;           // 强制回流，提交初始状态
        to.classList.remove(enterClass);
        from.classList.add(exitClass);

        to.addEventListener('transitionend', onEnd);
        setTimeout(finish, DURATION_FALLBACK);
      });
    },

    /**
     * 销毁：清除 rAF 动画与事件监听
     */
    destroy: function () {
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      if (this._onResize) {
        window.removeEventListener('resize', this._onResize);
        this._onResize = null;
      }
    },

    /**
     * rAF 驱动装饰光点沿椭圆轨迹运动（供 destroy 清理）
     */
    _startOrbit: function () {
      var self = this;
      var orb = this._orb;
      if (!orb) return;
      var RX = 440, RY = 220;

      function step() {
        self._orbAngle += 0.02;
        var x = Math.cos(self._orbAngle) * RX;
        var y = Math.sin(self._orbAngle) * RY;
        orb.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
        self._rafId = requestAnimationFrame(step);
      }
      this._rafId = requestAnimationFrame(step);
    },

    _bindResize: function () {
      var self = this;
      this._onResize = function () { /* V2 无图表实例，无需 resize 动作 */ };
      window.addEventListener('resize', this._onResize);
    }
  };

  /**
   * 编辑预留：为文本节点加 contenteditable，回传修改数据给壳
   */
  function attachEdit() {
    var selectors = ['h1', 'h2', 'h3', 'p', 'li', 'span'];
    engine.slides.forEach(function (slide, pageIndex) {
      selectors.forEach(function (sel) {
        Array.prototype.forEach.call(slide.querySelectorAll(sel), function (node) {
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
            } catch (e) { /* 父窗口不可用时忽略 */ }
          });
        });
      });
    });
  }

  // 暴露契约
  window.__SLIDE_ENGINE__ = engine;

  window.addEventListener('load', function () {
    engine.slides = Array.prototype.slice.call(document.querySelectorAll('.slide-page'));
    engine.init({ totalPages: engine.slides.length });
    attachEdit();

    // 就绪通知
    try {
      window.parent.postMessage({ type: 'SLIDE_READY', totalPages: engine.totalPages }, '*');
    } catch (e) {}
  });

  // 主题同步
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (d && d.type === 'THEME_CHANGE' && (d.theme === 'light' || d.theme === 'dark')) {
      document.documentElement.setAttribute('data-theme', d.theme);
    }
  });
})();
