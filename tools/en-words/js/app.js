/**
 * app.js — 梦幻词栈 · 英语生词拾取器
 *
 * 架构：
 *   识别引擎使用策略模式：strategies = { dict: 离线词典, ai: AI占位 stub }
 *   二期只需替换 ai 策略的实现，不改 UI 结构。
 *
 * 识别流程：
 *   1. 分词（正则匹配英文单词）
 *   2. 文内词频统计
 *   3. 已知词基线过滤（设置项「我的水平」+ localStorage 用户标记）
 *   4. 候选排序（词频降序，同频时词频 f 小者优先）
 *   5. 取 TOP N
 */

(function () {
  'use strict';

  // ========== 常量 ==========
  const STORE_PREFIX = 'enwords.';
  const LS_WORD_BOOK = STORE_PREFIX + 'book';
  const LS_SETTINGS = STORE_PREFIX + 'settings';
  const LS_KNOWN = STORE_PREFIX + 'known';
  const LS_DAILY = STORE_PREFIX + 'daily';

  // 高频基础词 Top 2000（简化版，用于基线过滤）
  const HIGH_FREQ_2000 = new Set([
    'the','be','to','of','and','a','in','that','have','i','it','for','not','on','with',
    'he','as','you','do','at','this','but','his','by','from','they','we','her','she',
    'or','an','will','my','one','all','would','there','their','what','so','up','out',
    'if','about','who','get','which','go','me','when','make','can','like','time','no',
    'just','him','know','take','person','into','year','your','good','some','could',
    'them','see','other','than','then','now','look','only','come','its','over','think',
    'also','back','after','use','two','how','our','work','first','well','way','even',
    'new','want','because','any','these','give','day','most','us','great','big','may',
    'say','each','before','world','father','mother','more','many','little','old','high',
    'long','small','hand','place','man','woman','child','life','different','large',
    'still','own','let','might','show','ask','number','off','need','try','part','turn',
    'start','home','keep','put','find','name','last','set','move','head','far','both',
    'side','run','change','help','home','need','real','left','right','young','point',
    'read','never','open','close','hard','story','page','word','begin','song','city',
    'land','water','door','house','tree','river','morning','night','today','always',
    'sun','moon','eat','drink','play','live','walk','air','fire','food','sleep',
    'warm','cold','dark','light','happy','sad','nice','bad','sure','best','love',
    'call','feel','stand','sit','watch','hear','tell','grow','die','fall','hold',
    'bring','write','carry','thank','stop','happen','remember','forget','become',
    'kind','true','enough','whole','important','simple','clear','easy','free','full',
    'together','along','away','quite','really','already','almost','perhaps','soon',
    'yet','ago','ever','still','again','early','late','sometimes','often','usually',
    'oh','yes','hello','sorry','please','okay','hi','excuse','ladies','gentlemen',
    'welcome','bye','goodbye','thanks','wellcome','morning','evening','afternoon',
    'mister','miss','mrs','mr','ms','dr','professor','doctor','sir','madam',
    'university','school','college','class','student','teacher','book','library',
    'computer','internet','phone','car','bus','train','plane','music','art','science',
    'history','language','english','math','study','learn','teach','research','idea',
    'problem','question','answer','example','fact','reason','result','effect','cause',
    'people','government','company','business','money','market','price','cost','value',
    'country','state','nation','president','law','war','peace','power','right',
    'family','friend','party','group','team','community','society','culture','system',
    'information','data','report','news','paper','letter','email','message','note',
    'issue','case','level','process','development','change','action','service',
    'experience','skill','education','health','environment','nature','technology',
    'industry','product','quality','design','project','plan','program','support',
    'future','past','present','space','earth','human','body','mind','heart','soul'
    // 扩展常用词 (~200 补充)
    ,'smile','laugh','cry','angry','afraid','brave','strong','weak','rich','poor',
    'fast','slow','short','tall','beautiful','ugly','clean','dirty','noisy','quiet',
    'quick','slow','fresh','soft','hard','hot','dry','wet','above','below','across',
    'around','behind','beside','between','during','inside','outside','through','under',
    'upon','within','without','another','everybody','everyone','everything','myself',
    'yourself','himself','herself','itself','nobody','nothing','somebody','something',
    'break','build','buy','catch','choose','cut','draw','drive','explain','fight',
    'fly','hope','imagine','lead','lie','lose','meet','offer','pass','pick','promise',
    'raise','reach','save','sell','send','sing','smile','speak','spend','teach',
    'throw','travel','understand','wear','win','wonder'
  ]);

  // ========== 识别策略 ==========
  const strategies = {
    /**
     * 离线词典策略：基于本地 window.EWDICT 数据
     */
    dict: function (text, config) {
      const words = tokenize(text);
      if (words.length === 0) return [];

      // 文内词频统计
      const freq = countFreq(words);

      // 构建已知词集合
      const knownWords = buildKnownSet(config.level);

      // 检查词典是否加载
      const dictLoaded = typeof window.EWDICT !== 'undefined' && Object.keys(window.EWDICT).length > 0;

      // 候选生词：不在已知集合中
      const candidates = [];
      for (const [word, count] of freq) {
        if (!knownWords.has(word)) {
          candidates.push({ word, count });
        }
      }

      // 排序：文内词频降序，同频时词频 f 小（更生僻）优先
      candidates.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const fa = dictLoaded && window.EWDICT[a.word] ? window.EWDICT[a.word][3] : 99999;
        const fb = dictLoaded && window.EWDICT[b.word] ? window.EWDICT[b.word][3] : 99999;
        return fa - fb;
      });

      // 取 TOP N
      const tops = candidates.slice(0, config.topN);

      // 组装结果
      return tops.map(c => {
        const w = c.word;
        let phonetic = '';
        let definition = '离线词典未收录';
        let tags = '';
        let frqVal = 0;

        if (dictLoaded && window.EWDICT[w]) {
          const entry = window.EWDICT[w];
          phonetic = entry[0] || '';
          definition = entry[1] || definition;
          tags = entry[2] || '';
          frqVal = entry[3] || 0;
        }

        // 提取原文例句（包含该词的句子）
        const sentence = extractSentence(text, w);

        return {
          word: w,
          phonetic: phonetic,
          definition: definition,
          tags: tags,
          freq: frqVal,
          sentence: sentence,
          count: c.count
        };
      });
    },

    /**
     * AI 策略占位（二期实现）
     */
    ai: function (text, config) {
      // 二期：调后端 API 获取 AI 识别的生词列表
      // 参数: text - 原文, config.level - 水平, config.topN - 数量
      // 返回格式与 dict 策略相同
      console.warn('AI 识别策略尚未接入（二期功能）');
      return [];
    }
  };

  // ========== 分词 ==========
  // 匹配英文单词（含缩写如 don't, it's）
  function tokenize(text) {
    const matches = text.match(/[a-zA-Z']+/g);
    if (!matches) return [];
    return matches
      .map(w => w.toLowerCase().replace(/^'+|'+$/g, ''))
      .filter(w => w.length > 1 && !/^'+$/.test(w));
  }

  // ========== 词频统计 ==========
  function countFreq(words) {
    const map = new Map();
    for (const w of words) {
      map.set(w, (map.get(w) || 0) + 1);
    }
    // 转为数组，按频次降序排序
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }

  // ========== 已知词集合 ==========
  function buildKnownSet(level) {
    const known = new Set(HIGH_FREQ_2000);

    // 从词典添加 cet4 词
    if (typeof window.EWDICT !== 'undefined') {
      for (const [word, entry] of Object.entries(window.EWDICT)) {
        const tags = entry[2] || '';
        if (level === 'postgrad') {
          // 考研基线：cet4 + cet6 都算已知
          if (tags.includes('cet4') || tags.includes('cet6')) {
            known.add(word);
          }
        } else if (level === 'cet6') {
          // 六级基线：高频 + cet4 已知
          if (tags.includes('cet4')) {
            known.add(word);
          }
        } else {
          // 四级基线：高频 + cet4 已知（cet4 本身也是）
          if (tags.includes('cet4')) {
            known.add(word);
          }
        }
      }
    }

    // 用户标记为「我认识」的词（localStorage）
    const userKnown = WB.store.get(LS_KNOWN, []);
    userKnown.forEach(w => known.add(w));

    return known;
  }

  // ========== 提取例句 ==========
  function extractSentence(text, word) {
    const MAX_LEN = 140;
    const lowerWord = word.toLowerCase();

    // 后行断言在旧浏览器可能不支持，try/catch 降级
    let sentences;
    try {
      sentences = text.split(/(?<=[.!?])\s+/);
    } catch {
      sentences = text.split(/[.!?]\s+/).map((s, i, arr) => i < arr.length - 1 ? s + '.' : s);
    }

    for (const s of sentences) {
      if (s.toLowerCase().includes(lowerWord)) {
        return truncateSentence(s.trim(), word, MAX_LEN);
      }
    }
    // 降级：返回包含该词的片段
    const idx = text.toLowerCase().indexOf(lowerWord);
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + 80);
      return '...' + text.slice(start, end).trim() + '...';
    }
    return '';
  }

  /**
   * 以目标词为中心，前后各取约一半 MaxLen 字符，在单词边界处截断
   */
  function truncateSentence(sentence, word, maxLen) {
    if (sentence.length <= maxLen) return sentence;

    const lower = sentence.toLowerCase();
    const wIdx = lower.indexOf(word.toLowerCase());
    if (wIdx < 0) return sentence.slice(0, maxLen).replace(/\S+$/, '') + '…';

    const half = Math.floor(maxLen / 2);
    let start = Math.max(0, wIdx - half);
    let end = Math.min(sentence.length, wIdx + word.length + half);

    // 向前调整到单词边界
    if (start > 0) {
      while (start > 0 && /\w/.test(sentence[start - 1])) start--;
    }
    // 向后调整到单词边界
    if (end < sentence.length) {
      while (end < sentence.length && /\w/.test(sentence[end])) end++;
    }

    let result = '';
    if (start > 0) result += '…';
    result += sentence.slice(start, end).trim();
    if (end < sentence.length) result += '…';
    return result;
  }

  // ========== 识别入口（异步管线，为 AI 延迟预留） ==========
  async function recognizeAsync(text) {
    const config = getConfig();
    const method = config.method || 'dict';
    const strategy = strategies[method] || strategies.dict;
    // 离线词典即时 resolve，AI 二期会有真实延迟
    const result = strategy(text, config);
    // 统一包装为 Promise 以触发骨架屏管线
    return Promise.resolve(result);
  }

  // ========== 设置管理 ==========
  function getConfig() {
    return WB.store.get(LS_SETTINGS, {
      topN: 10,
      level: 'cet6',
      dailyGoal: 10,
      method: 'dict'
    });
  }

  function saveConfig(cfg) {
    WB.store.set(LS_SETTINGS, cfg);
  }

  // ========== 今日进度 ==========
  function getDaily() {
    const today = new Date().toISOString().slice(0, 10);
    const data = WB.store.get(LS_DAILY, { date: today, picked: 0, added: 0 });
    if (data.date !== today) {
      return { date: today, picked: 0, added: 0 };
    }
    return data;
  }

  function updateDaily(picked, added) {
    const d = getDaily();
    if (picked !== undefined) d.picked += picked;
    if (added !== undefined) d.added += added;
    WB.store.set(LS_DAILY, d);
  }

  // ========== 生词本管理 ==========
  function addToBook(wordData) {
    const book = WB.store.get(LS_WORD_BOOK, []);
    // 避免重复
    if (book.find(b => b.w === wordData.word)) return false;
    book.push({
      w: wordData.word,
      p: wordData.phonetic || '',
      d: wordData.definition || '',
      s: wordData.sentence || '',
      ts: Date.now(),
      mastered: false
    });
    WB.store.set(LS_WORD_BOOK, book);
    return true;
  }

  function markKnown(word) {
    const known = WB.store.get(LS_KNOWN, []);
    if (!known.includes(word)) {
      known.push(word);
      WB.store.set(LS_KNOWN, known);
    }
  }

  // ========== 进度条更新 ==========
  function updateProgressBar() {
    const cfg = getConfig();
    const daily = getDaily();
    const total = daily.picked + daily.added;
    const goal = cfg.dailyGoal;
    const pct = Math.min(100, Math.round((total / goal) * 100));

    const textEl = document.getElementById('progress-text');
    const fillEl = document.getElementById('progress-fill');
    if (textEl) textEl.textContent = total + ' / ' + goal;
    if (fillEl) fillEl.style.width = pct + '%';
    const bar = fillEl && fillEl.parentElement;
    if (bar) bar.setAttribute('aria-valuenow', total);
  }

  // ========== 骨架屏渲染 ==========
  function renderSkeletons(count) {
    const grid = document.getElementById('results-grid');
    const empty = document.getElementById('empty-state');
    const title = document.getElementById('results-title');
    const backLink = document.querySelector('.back-to-input');
    if (!grid) return;

    if (empty) empty.style.display = 'none';
    if (title) title.classList.remove('visible');
    if (backLink) backLink.classList.remove('visible');
    grid.innerHTML = '';

    for (let i = 0; i < count; i++) {
      const card = document.createElement('div');
      card.className = 'skeleton-card';
      card.innerHTML = `
        <div class="skeleton-line wide"></div>
        <div class="skeleton-line short"></div>
        <div class="skeleton-line medium"></div>
        <div class="skeleton-line block"></div>
      `;
      grid.appendChild(card);
    }
  }

  // ========== Toast 通知 ==========
  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    if (toastTimer) clearTimeout(toastTimer);
    el.textContent = msg;
    el.classList.add('show');
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      toastTimer = null;
    }, 2000);
  }

  // ========== 滚动到结果 + 焦点移交 ==========
  function scrollToResults() {
    const title = document.getElementById('results-title');
    const backLink = document.querySelector('.back-to-input');
    if (title) title.classList.add('visible');
    if (backLink) backLink.classList.add('visible');

    // 移动端 (<1024px) 自动滚动；桌面端双栏结果已在视口内
    if (window.innerWidth < 1024 && title) {
      const motionOk = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
      title.focus({ preventScroll: true });
      title.scrollIntoView({
        behavior: motionOk ? 'smooth' : 'auto',
        block: 'start'
      });
    }
  }

  // ========== 结果存储（用于展开/收起引用） ==========
  let currentResults = [];

  // ========== 渲染结果卡片（渐进展示：默认 6 张，展开全部） ==========
  const INITIAL_COUNT = 6;

  function renderResults(results) {
    const grid = document.getElementById('results-grid');
    const empty = document.getElementById('empty-state');
    const title = document.getElementById('results-title');
    const countEl = document.getElementById('results-count');
    const backLink = document.querySelector('.back-to-input');
    const expandWrap = document.getElementById('results-expand');
    if (!grid) return;

    currentResults = results;
    grid.innerHTML = '';

    if (title) title.classList.add('visible');
    if (countEl) countEl.textContent = results.length;
    if (backLink) backLink.classList.add('visible');

    if (results.length === 0) {
      if (empty) empty.style.display = '';
      if (title) title.classList.remove('visible');
      if (backLink) backLink.classList.remove('visible');
      if (expandWrap) expandWrap.classList.remove('visible');
      return;
    }
    if (empty) empty.style.display = 'none';

    // 渲染 initial 或 full
    const visible = results.slice(0, INITIAL_COUNT);
    const remaining = results.length - INITIAL_COUNT;
    appendCards(visible, 0);

    // 展开/收起按钮
    if (expandWrap) {
      if (remaining > 0) {
        expandWrap.classList.add('visible');
        expandWrap.innerHTML = `<button class="btn btn-ghost btn-sm" id="btn-expand-toggle">还有 ${remaining} 个 · 展开</button>`;
      } else {
        expandWrap.classList.remove('visible');
      }
    }
  }

  /** 追加卡片到 grid，startIdx 为序号起始 */
  function appendCards(items, startIdx) {
    const grid = document.getElementById('results-grid');
    if (!grid) return;
    const book = WB.store.get(LS_WORD_BOOK, []);
    const bookMap = new Map(book.map(b => [b.w, b]));

    items.forEach((item, i) => {
      const rank = startIdx + i + 1;
      const inBook = bookMap.get(item.word);
      const isNotFound = item.definition === '离线词典未收录';

      const card = document.createElement('div');
      card.className = 'word-card' + (inBook && inBook.mastered ? ' mastered' : '') + (isNotFound ? ' not-found' : '');
      card.innerHTML = `
        <span class="card-badge">#${rank}</span>
        <div class="card-word-row">
          <span class="card-word">${escapeHtml(item.word)}</span>
          <span class="card-phonetic">${escapeHtml(item.phonetic)}</span>
          <button class="btn-speak" aria-label="朗读 ${item.word}" data-word="${escapeHtml(item.word)}">🔊</button>
        </div>
        <div class="card-definition">${escapeHtml(item.definition)}</div>
        ${item.sentence ? `<div class="card-example">${highlightWord(item.sentence, item.word)}</div>` : ''}
        <div class="card-actions">
          ${inBook
            ? '<button class="btn btn-secondary btn-sm added-btn" disabled>已在生词本</button>'
            : '<button class="btn btn-primary btn-sm add-btn" data-word="' + escapeHtml(item.word) + '">+ 加入生词本</button>'
          }
          <button class="btn btn-ghost btn-sm know-btn" data-word="${escapeHtml(item.word)}">我认识</button>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  // ========== 结果卡片事件委托 ==========
  function bindResultEvents() {
    const grid = document.getElementById('results-grid');
    if (!grid) return;
    grid.onclick = function (e) {
      // 例句点击：切换展开
      const exampleEl = e.target.closest('.card-example');
      if (exampleEl) {
        exampleEl.classList.toggle('expanded');
        return;
      }
      const speakBtn = e.target.closest('.btn-speak');
      if (speakBtn) {
        const w = speakBtn.dataset.word;
        WB.speak(w, 'en-US');
        return;
      }

      const addBtn = e.target.closest('.add-btn');
      if (addBtn) {
        const w = addBtn.dataset.word;
        const item = currentResults.find(r => r.word === w);
        if (item && addToBook(item)) {
          addBtn.textContent = '已在生词本';
          addBtn.disabled = true;
          addBtn.classList.remove('btn-primary');
          addBtn.classList.add('btn-secondary');
          updateDaily(undefined, 1);
          updateProgressBar();
        }
        return;
      }

      const knowBtn = e.target.closest('.know-btn');
      if (knowBtn) {
        const w = knowBtn.dataset.word;
        markKnown(w);
        const cardEl = knowBtn.closest('.word-card');
        if (cardEl) {
          cardEl.style.opacity = '0';
          cardEl.style.transform = 'scale(0.9)';
          setTimeout(() => cardEl.remove(), 250);
        }
        return;
      }
    };
  }

  // ========== 高亮例句中的目标词 ==========
  function highlightWord(sentence, word) {
    const escaped = escapeHtml(sentence);
    const regex = new RegExp('\\b(' + escapeRegex(word) + ')\\b', 'gi');
    return escaped.replace(regex, '<strong>$1</strong>');
  }

  // ========== 工具函数 ==========
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ========== 示例文本 ==========
  const SAMPLE_TEXTS = [
    // 示例 1：科技新闻（含六级词）
    `Artificial intelligence has become ubiquitous in modern society, transforming industries from healthcare to transportation. Despite the tremendous potential, many experts remain skeptical about the ethical implications of autonomous systems. Researchers emphasize that transparency and accountability must be prioritized to mitigate potential risks. The proliferation of AI-powered tools has sparked intense debate among policymakers, who grapple with the dilemma of fostering innovation while safeguarding public welfare. Meanwhile, consumers exhibit a paradoxical attitude: they enthusiastically embrace smart assistants yet express apprehension about privacy intrusions. This ambivalence highlights the need for comprehensive regulatory frameworks that reconcile technological progress with fundamental human values.`,

    // 示例 2：文学片段（含六级词）
    `The autumn leaves swirled in the crisp evening breeze, casting intricate shadows across the cobblestone path. Sarah felt an inexplicable nostalgia as she wandered through the quaint neighborhood, reminiscing about her childhood expeditions with her grandfather. He had been a man of formidable patience and profound wisdom, who believed that curiosity was the quintessential human virtue. "Adversity," he would murmur, adjusting his spectacles, "is merely the crucible in which character is forged." Those seemingly mundane walks had cultivated in her a resilience and empathy that proved indispensable throughout her turbulent career. Now, standing at the crossroads of ambition and contentment, she finally understood the subtle elegance of his philosophy.`
  ];

  // ========== 初始化 ==========
  function init() {
    // 设置按钮
    document.getElementById('btn-settings').addEventListener('click', () => {
      const cfg = getConfig();
      document.getElementById('setting-topn').value = cfg.topN;
      document.getElementById('setting-level').value = cfg.level;
      document.getElementById('setting-daily').value = cfg.dailyGoal;
      document.getElementById('setting-method').value = cfg.method;
      WB.openOverlay('#settings-overlay');
    });

    // 保存设置
    document.getElementById('btn-settings-save').addEventListener('click', () => {
      const cfg = {
        topN: parseInt(document.getElementById('setting-topn').value),
        level: document.getElementById('setting-level').value,
        dailyGoal: parseInt(document.getElementById('setting-daily').value),
        method: document.getElementById('setting-method').value
      };
      saveConfig(cfg);
      WB.closeOverlay('#settings-overlay');
      updateProgressBar();
    });

    document.getElementById('btn-settings-close').addEventListener('click', () => {
      WB.closeOverlay('#settings-overlay');
    });

    // 示例文本
    document.getElementById('btn-example').addEventListener('click', () => {
      WB.openOverlay('#example-overlay');
    });
    document.getElementById('btn-example-close').addEventListener('click', () => {
      WB.closeOverlay('#example-overlay');
    });
    document.querySelectorAll('.example-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const idx = parseInt(this.dataset.idx);
        document.getElementById('text-input').value = SAMPLE_TEXTS[idx];
        WB.closeOverlay('#example-overlay');
      });
    });

    // 识别按钮（异步管线：骨架屏 → 识别 → 卡片 → toast → 滚动）
    document.getElementById('btn-recognize').addEventListener('click', async () => {
      const text = document.getElementById('text-input').value.trim();
      if (!text) return;

      const btn = document.getElementById('btn-recognize');
      const cfg = getConfig();

      // 按钮加载态
      btn.disabled = true;
      btn.textContent = '识别中…';

      // 渲染骨架屏
      renderSkeletons(Math.min(6, cfg.topN));

      let results;
      try {
        results = await recognizeAsync(text);
      } catch {
        results = [];
      }

      // 渲染真实卡片
      renderResults(results);
      updateDaily(results.length, undefined);
      updateProgressBar();

      // 恢复按钮
      btn.disabled = false;
      btn.textContent = '✨ 识别 TOP 生词';

      // Toast 通知
      if (results.length > 0) {
        showToast('已拾取 ' + results.length + ' 个生词');
      }

      // 滚动到结果
      scrollToResults();
    });

    // 展开/收起（事件委托，按钮动态渲染）
    const expandWrap = document.getElementById('results-expand');
    if (expandWrap) {
      expandWrap.addEventListener('click', (e) => {
        const btn = e.target.closest('#btn-expand-toggle');
        if (!btn) return;
        const grid = document.getElementById('results-grid');
        if (!grid) return;

        if (btn.textContent.includes('展开')) {
          const remaining = currentResults.slice(INITIAL_COUNT);
          appendCards(remaining, INITIAL_COUNT);
          expandWrap.innerHTML = '<button class="btn btn-ghost btn-sm" id="btn-expand-toggle">收起</button>';
        } else {
          grid.innerHTML = '';
          appendCards(currentResults.slice(0, INITIAL_COUNT), 0);
          expandWrap.innerHTML = `<button class="btn btn-ghost btn-sm" id="btn-expand-toggle">还有 ${currentResults.length - INITIAL_COUNT} 个 · 展开</button>`;
        }
      });
    }

    // 关闭弹窗（点击背景）
    WB.closeOnBackdrop('#settings-overlay');
    WB.closeOnBackdrop('#example-overlay');

    // 页脚名言
    const quoteEl = document.getElementById('footer-quote');
    if (quoteEl) quoteEl.textContent = '"' + WB.getQuote() + '"';

    // 进度条
    updateProgressBar();

    // 卡片事件委托
    bindResultEvents();
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
