/**
 * 新闻聚合器 — 渲染引擎
 * 工程文件已锁定，后续仅需修改 data.json 即可更新内容。
 *
 * 职责：
 *   1. fetch('data.json') 获取数据 
 *      每次刷新都会拉取最新 JSON -->  fetch('data.json?t=' + Date.now())
 *   2. 将 JSON 驱动的数据渲染为 DOM
 *   3. 绑定交互事件
 *   4. 处理加载 / 错误状态
 */

(function () {
  'use strict';

  /* ---- DOM 引用 ---- */
  var siteTitleEl = document.getElementById('site-title');
  var gridEl      = document.getElementById('article-grid');
  var yearEl      = document.getElementById('footer-year');

  /* ---- 设置当前年份 ---- */
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  /* ---- 渲染 ---- */
  function render(data) {
    if (!data) { return; }

    // 站点标题
    if (siteTitleEl && data.siteTitle) {
      siteTitleEl.textContent = data.siteTitle;
    }

    // 文章网格渲染
    if (gridEl && Array.isArray(data.articles) && data.articles.length > 0) {
      gridEl.innerHTML = '';

      data.articles.forEach(function (article) {
        var card = buildCard(article);
        gridEl.appendChild(card);
      });
    }
  }

  /* ---- 构建单张卡片 ---- */
  function buildCard(article) {
    var card = document.createElement('article');
    card.className = 'card';
    card.setAttribute('data-id', article.id);

    // 占位图
    var image = document.createElement('div');
    image.className = 'card__image';
    image.style.backgroundColor = article.imagePlaceholder || '#e0e0e0';
    card.appendChild(image);

    // 卡片主体
    var body = document.createElement('div');
    body.className = 'card__body';

    // 分类标签
    if (article.category) {
      var tag = document.createElement('span');
      tag.className = 'card__category card__category--' + article.category;
      tag.textContent = article.category;
      body.appendChild(tag);
    }

    // 标题
    var title = document.createElement('h2');
    title.className = 'card__title';
    title.textContent = article.title;
    body.appendChild(title);

    // 摘要
    var summary = document.createElement('p');
    summary.className = 'card__summary';
    summary.textContent = article.summary;
    body.appendChild(summary);

    // 底部：来源 + 箭头
    var footer = document.createElement('div');
    footer.className = 'card__footer';

    if (article.source) {
      var source = document.createElement('span');
      source.className = 'card__source';
      source.textContent = article.source;
      footer.appendChild(source);
    }

    var arrow = document.createElement('span');
    arrow.className = 'card__arrow';
    arrow.textContent = '\u2197';
    footer.appendChild(arrow);

    body.appendChild(footer);
    card.appendChild(body);

    // 点击事件
    card.addEventListener('click', function () {
      console.log(article.id, article.title);
    });

    return card;
  }

  /* ---- 显示错误 ---- */
  function showError(message) {
    if (gridEl) {
      gridEl.innerHTML = '<p class="error">' + message + '</p>';
    }
  }

  /* ---- 入口：fetch 数据 ---- */
  fetch('data.json?t=' + Date.now())
    .then(function (response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      return response.json();
    })
    .then(function (data) {
      render(data);
    })
    .catch(function () {
      showError('数据加载失败，请检查 data.json');
    });
})();
