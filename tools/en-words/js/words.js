/**
 * words.js — 梦幻词栈 · 生词本 / 复习页
 *
 * 功能：
 *   - 统计条（总数/待复习/已掌握）
 *   - 自测模式（释义隐藏，点击揭示）
 *   - 朗读、标记掌握/取消、删除
 *   - 一键复制 / 下载 .txt
 *   - 数据源：localStorage enwords.book
 */
(function () {
  'use strict';

  const LS_WORD_BOOK = 'enwords.book';

  let testMode = false;
  let book = [];

  function loadBook() {
    book = WB.store.get(LS_WORD_BOOK, []);
  }

  function saveBook() {
    WB.store.set(LS_WORD_BOOK, book);
  }

  // ---- 统计更新 ----
  function updateStats() {
    const total = book.length;
    const mastered = book.filter(b => b.mastered).length;
    const review = total - mastered;

    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el('stat-total', total);
    el('stat-review', review);
    el('stat-mastered', mastered);
  }

  // ---- 列表事件委托（只绑定一次，不在 render 里重复添加） ----
  function onListClick(e) {
    // 例句点击：切换展开（阻止冒泡，避免触发卡片揭示）
    const exampleEl = e.target.closest('.book-example');
    if (exampleEl) {
      e.stopPropagation();
      exampleEl.classList.toggle('expanded');
      return;
    }

    const speakBtn = e.target.closest('.btn-icon-speak');
    if (speakBtn) {
      e.stopPropagation();
      WB.speak(speakBtn.dataset.word, 'en-US');
      return;
    }

    const masterBtn = e.target.closest('.master-btn');
    if (masterBtn) {
      e.stopPropagation();
      const idx = parseInt(masterBtn.dataset.idx);
      book[idx].mastered = true;
      saveBook();
      render();
      updateStats();
      return;
    }

    const unmasterBtn = e.target.closest('.unmaster-btn');
    if (unmasterBtn) {
      e.stopPropagation();
      const idx = parseInt(unmasterBtn.dataset.idx);
      book[idx].mastered = false;
      saveBook();
      render();
      updateStats();
      return;
    }

    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
      e.stopPropagation();
      const idx = parseInt(deleteBtn.dataset.idx);
      book.splice(idx, 1);
      saveBook();
      render();
      updateStats();
      return;
    }
  }

  // ---- 渲染列表 ----
  function render() {
    const list = document.getElementById('word-list');
    const empty = document.getElementById('empty-state');
    if (!list) return;

    list.innerHTML = '';

    if (book.length === 0) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    book.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'book-card' + (item.mastered ? ' mastered' : '');
      if (testMode && !item.mastered) {
        card.classList.add('test-hidden');
      }

      const dateStr = new Date(item.ts).toLocaleDateString('zh-CN');

      card.innerHTML = `
        <div class="book-card-row">
          <span class="book-word">${escapeHtml(item.w)}</span>
          <span class="book-phonetic">${escapeHtml(item.p)}</span>
          <span class="book-date">${dateStr}</span>
        </div>
        <div class="book-def">${escapeHtml(item.d)}</div>
        ${item.s ? `<div class="book-example">${escapeHtml(item.s)}</div>` : ''}
        <div class="book-actions">
          <button class="btn btn-sm btn-icon-speak" data-word="${escapeHtml(item.w)}" aria-label="朗读 ${item.w}">🔊</button>
          ${item.mastered
            ? '<button class="btn btn-secondary btn-sm unmaster-btn" data-idx="' + idx + '">取消掌握</button>'
            : '<button class="btn btn-primary btn-sm master-btn" data-idx="' + idx + '">标记已掌握</button>'
          }
          <button class="btn btn-danger btn-sm delete-btn" data-idx="${idx}">删除</button>
        </div>
      `;

      // 自测模式：点击卡片揭示
      if (testMode && !item.mastered) {
        card.addEventListener('click', function () {
          if (card.classList.contains('test-hidden')) {
            card.classList.remove('test-hidden');
            card.classList.add('test-reveal');
          } else {
            card.classList.remove('test-reveal');
            card.classList.add('test-hidden');
          }
        });
        card.style.cursor = 'pointer';
      }

      list.appendChild(card);
    });
  }

  // ---- 导出 ----
  function buildExportText() {
    return book.map(b => {
      const status = b.mastered ? '[已掌握]' : '[待复习]';
      return `${b.w} ${b.p}\n${b.d}\n${b.s}\n${status}\n---`;
    }).join('\n');
  }

  function copyAll() {
    const text = buildExportText();
    navigator.clipboard.writeText(text).then(() => {
      alert('已复制到剪贴板！');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      alert('已复制到剪贴板！');
    });
  }

  function downloadTxt() {
    const text = buildExportText();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-words.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---- 工具函数 ----
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ---- 初始化 ----
  function init() {
    loadBook();

    // 统计
    updateStats();

    // 列表事件委托（只绑定一次）
    const wordList = document.getElementById('word-list');
    if (wordList) wordList.addEventListener('click', onListClick);

    // 渲染
    render();

    // 自测模式
    document.getElementById('btn-test-mode').addEventListener('click', function () {
      testMode = !testMode;
      this.textContent = testMode ? '🔍 退出自测' : '🔍 自测模式';
      document.getElementById('test-indicator').style.display = testMode ? '' : 'none';
      render();
    });

    // 导出弹窗
    document.getElementById('btn-export').addEventListener('click', () => {
      WB.openOverlay('#export-overlay');
    });
    document.getElementById('btn-export-close').addEventListener('click', () => {
      WB.closeOverlay('#export-overlay');
    });
    WB.closeOnBackdrop('#export-overlay');

    document.getElementById('btn-copy-all').addEventListener('click', () => {
      copyAll();
      WB.closeOverlay('#export-overlay');
    });
    document.getElementById('btn-download-txt').addEventListener('click', () => {
      downloadTxt();
      WB.closeOverlay('#export-overlay');
    });

    // 页脚名言
    const quoteEl = document.getElementById('footer-quote');
    if (quoteEl) quoteEl.textContent = '"' + WB.getQuote() + '"';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
