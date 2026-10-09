                // ================================================================
                // 在线考试系统 · core.js —— 核心逻辑，也是跨文件「全局交接面」所在
                // ================================================================
                // 拆分契约（最佳实践）：
                // 1) 本项目为标准「经典脚本」顺序加载，非 ES 模块。跨文件共享统一收敛到本文件顶部
                //    声明为全局变量/函数(window 上可见)，其他模块依赖它们时必须在本文件之后加载。
                // 2) 全局交接面（被 parser/sample/storage/export 依赖）：
                //    - 数据与状态：examData / mode / userAnswers / feedbackMap / isSubmitted / currentIndex
                //    - 计时状态：timerSeconds / timerStarted / timerStartTs（配合 beginTimer/stopTimer/resetTimerState 使用）
                //    - 关键函数：loadExamData(data) / setMode(m, persist) / renderAll()
                //    - 对外回调：window.loadEmbedded(data)（供自包含导出的考生端/嵌入数据使用，见 export.js）
                // 3) 可被复用的状态请尽量收口在本文件，避免分布到各模块造成隐性顺序耦合。
                // ================================================================
                // 1. 数据状态 & 核心变量
                // ================================================================
                let examData = null;               // { title, questions: [ { id, type, content, options, answer } ] }
                // 内置题库版本号：仅当「当前载入的是内置题库」时才有值。用于让浏览器本地进度跟随题库版本失效，
                // 避免题库更新后旧的本地备份（如上一版示例题）把页面顶掉。（见 storage.js 的 tryRestoreFromStorage）
                let activeBankVersion = null;
                let userAnswers = {};             // { 0: [0], 1: [1,2], ... } 索引 -> 答案数组(索引)
                let currentIndex = 0;
                let isSubmitted = false;
                let timerSeconds = 0;
                let timerInterval = null;
                let timerVisible = true;
                // 计时起点语义 V3.4：首次作答(选中任一题选项)才启动，而非「载入试卷即计时」
                let timerStarted = false;    // 是否已开始计时
                let timerStartTs = 0;        // 计时起点的绝对时间戳(毫秒)，用于后台/休眠/刷新后的精度恢复
                // V3.3: 双模式状态
                let mode = 'practice';             // 'practice'(即时反馈) | 'exam'(交卷判分)
                let feedbackMap = {};              // qIdx -> 'correct'|'wrong'|'partial' (练习模式判定结果)
                let judgeTimers = {};              // qIdx -> 延时判定 timer id
                let lastSegHtml = '';              // 进度段增量更新缓存
                let lastGridHtml = '';             // 题号网格增量更新缓存
                const APP_VERSION = 'V3.3'; // 版本号 (显示于帮助弹层)
        
                // DOM 引用
                const $ = id => document.getElementById(id);
                const slider = $('slider');
                const emptyState = $('emptyState');
                const totalQDisplay = $('totalQDisplay');
                const answeredCount = $('answeredCount');
                const totalCount = $('totalCount');
                const prevBtn = $('prevBtn');
                const nextBtn = $('nextBtn');
                const submitBtn = $('submitBtn');
                const gridToggleBtn = $('gridToggleBtn');
                const drawerOverlay = $('drawerOverlay');
                const gridContainer = $('gridContainer');
                const drawerClose = $('drawerClose');
                const fileInput = $('fileInput');
                const loadSampleBtn = $('loadSampleBtn');
                const exportBtn = $('exportBtn');
                const resetBtn = $('resetBtn');
                const timerDisplay = $('timerDisplay');
                const timerPill = $('timerPill');
                const timerToggle = $('timerToggle');
                const iconEye = $('iconEye');
                const iconEyeOff = $('iconEyeOff');
                const examName = $('examName');
                // V3: 管理/进度/结果/帮助相关
                const toolbar = $('toolbar');
                const manageBtn = $('manageBtn');
                const manageMenu = $('manageMenu');
                const progressSegments = $('progressSegments');
                const templateBtn = $('templateBtn');
                const helpBtn = $('helpBtn');
                const helpModal = $('helpModal');
                const helpCloseBtn = $('helpCloseBtn');
                const helpTemplateCsvBtn = $('helpTemplateCsvBtn');
                const helpTemplateJsonBtn = $('helpTemplateJsonBtn');
                const resultModal = $('resultModal');
                const ringFill = $('ringFill');
                const resultScore = $('resultScore');
                const resultDetail = $('resultDetail');
                const resultVerdict = $('resultVerdict');
                const resultCloseBtn = $('resultCloseBtn');
                // V3.3: 确认 Modal + 模式切换
                const confirmModal = $('confirmModal');
                const confirmTitle = $('confirmTitle');
                const confirmMsg = $('confirmMsg');
                const confirmCancelBtn = $('confirmCancelBtn');
                const confirmOkBtn = $('confirmOkBtn');
                const modeSeg = $('modeSeg');
                const legendCorrect = $('legendCorrect');
                const legendWrong = $('legendWrong');
                const menuSampleBtn = $('menuSampleBtn');
                const menuExportBtn = $('menuExportBtn');
                const menuTemplateBtn = $('menuTemplateBtn');
                const menuResetBtn = $('menuResetBtn');
                // V3.1: 主题切换
                const themeBtn = $('themeBtn');
                const iconSun = $('iconSun');
                const iconMoon = $('iconMoon');
                const appVersion = $('appVersion');
                // V3.5: 作答回顾 + 只练错题
                const reviewBtn = $('reviewBtn');
                const resultReviewBtn = $('resultReviewBtn');
                const reviewModal = $('reviewModal');
                const reviewCloseBtn = $('reviewCloseBtn');
                const reviewSeg = $('reviewSeg');
                const reviewList = $('reviewList');
                const reviewContext = $('reviewContext');
                const reviewRetryBtn = $('reviewRetryBtn');
                const reviewBackNavBtn = $('reviewBackNavBtn');
                const revCorrect = $('revCorrect');
                const revPartial = $('revPartial');
                const revWrong = $('revWrong');
                const revBlank = $('revBlank');
                const revAll = $('revAll');
                const revWrongN = $('revWrongN');
                // V3.5: 回顾与会话状态
                let reviewOnlyWrong = false;   // 回顾面板当前过滤: false=全部题, true=只看错题
                let reviewExpandedIdx = null;  // 回顾面板当前展开复盘详情的题索引 (null=全部收起)
                let retryActive = false;       // 是否正处于「只练错题」会话
                let retrySnapshot = null;      // 进入重练前的原卷快照 {exam,answers,feedback,submitted}
        
                // ================================================================
                // 2. 工具 & 辅助
                // ================================================================
                function formatTime(sec) {
                    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
                    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
                    const s = String(sec % 60).padStart(2, '0');
                    return `${h}:${m}:${s}`;
                }
        
                // HTML 转义：所有插入 innerHTML 的外部数据必须先过此函数 (防 XSS)
                function escapeHTML(str) {
                    if (str == null) return '';
                    return String(str)
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#39;');
                }
        
                // V3.3: 安全绑定 —— 元素可能不存在(考生端导出版移除了管理元素)，null 时静默跳过
                function bind(el, evt, fn) { if (el) el.addEventListener(evt, fn); }
        
                // V3.6: 把选项索引数组渲染为可读文本 (用于回顾详情/错题本展示作答与答案)
                function optionsToText(q, idxs) {
                    const arr = Array.isArray(idxs) ? idxs : [];
                    if (arr.length === 0) return '未作答';
                    const names = arr.map(i => (q.options && q.options[i] != null) ? String(q.options[i]) : ('选项' + (i + 1)));
                    return names.map(n => escapeHTML(n)).join('、');
                }
        
                // V3.6: 应用内轻量 toast —— 替代原生 alert 的提示性信息。
                // 非阻塞、自动消失、可堆叠，深色浅色均随主题；需在 body 上创建容器。
                let toastContainer = null;
                function ensureToastContainer() {
                    if (toastContainer) return toastContainer;
                    toastContainer = document.createElement('div');
                    toastContainer.className = 'toast-zone';
                    toastContainer.setAttribute('aria-live', 'polite');
                    document.body.appendChild(toastContainer);
                    return toastContainer;
                }
                function showToast(text, type) {
                    const zone = ensureToastContainer();
                    const t = document.createElement('div');
                    t.className = type === 'error' ? 'toast toast-error' : 'toast';
                    t.textContent = text;
                    zone.appendChild(t);
                    requestAnimationFrame(() => t.classList.add('show'));
                    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
                }
        
                // ================================================================
                // V3.8: 弹层通用能力 —— 焦点陷阱 / 背景隔离 / 焦点归还
                // ================================================================
                // 改前每个弹层各自为政：只有确认框和回顾面板顺手 .focus() 了一下。
                // 既没把焦点关在弹层内（Tab 会一路穿到遮罩后的题卡和按钮，键盘用户直接"走丢"），
                // 关闭后焦点也停在 body（想回到刚才那个按钮得从头 Tab 一遍）。
                // 这里统一成一套：打开入栈 → 焦点进弹层 → 隔离背景；关闭出栈 → 焦点还给触发元素。
                const LAYER_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
                    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

                const layerStack = [];       // 打开中的弹层，后进先出；只有最上层接收键盘
                let layerReturnFocus = null; // 打开最上层之前焦点在哪，关闭时还回去

                // 只认带 role="dialog" 的弹层容器（五个弹层都有），避免误把 toast 之类当弹层
                function layerEls() {
                    return Array.from(document.querySelectorAll('[role="dialog"]'));
                }
                function topLayer() { return layerStack[layerStack.length - 1] || null; }

                // 弹层里当前可聚焦、且真的可见的元素（display:none 的子树 rect 为 0，会被滤掉）
                function focusableIn(root) {
                    return Array.from(root.querySelectorAll(LAYER_FOCUSABLE)).filter((el) => {
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
                    });
                }

                // 背景隔离：有弹层打开时主内容区 inert（键盘与读屏都进不去）；
                // 叠加时（例如从回顾里弹出确认框）只有最上层可交互，下面那层一并隔离。
                // inert 是 Baseline 2023 的能力；老浏览器上退化成"只靠下面的 Tab 陷阱兜底"，不影响可用。
                function syncLayerInert() {
                    const top = topLayer();
                    const appEl = document.getElementById('app');
                    if (appEl) appEl.inert = layerStack.length > 0;
                    layerEls().forEach((el) => {
                        el.inert = layerStack.includes(el) && el !== top;
                    });
                }

                // 打开弹层：入栈 → 焦点进弹层 → 隔离背景
                function openLayer(el, opts = {}) {
                    if (!el || layerStack.includes(el)) return;
                    if (layerStack.length === 0) layerReturnFocus = document.activeElement;
                    el.classList.add('open');
                    layerStack.push(el);
                    syncLayerInert();
                    // 初始焦点：显式指定 > 面板内第一个可聚焦元素 > 面板自身（临时 tabindex=-1）
                    const target = opts.initialFocus || focusableIn(el)[0];
                    if (target) { target.focus(); return; }
                    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
                    el.focus();
                }

                // 关闭弹层：出栈 → 焦点还给触发元素；还有下层时交给新的最上层
                function closeLayer(el) {
                    const i = layerStack.indexOf(el);
                    if (i === -1) { el.classList.remove('open'); return; }
                    layerStack.splice(i, 1);
                    el.classList.remove('open');
                    syncLayerInert();
                    if (layerStack.length > 0) {
                        const t = focusableIn(topLayer())[0];
                        if (t) t.focus();
                        return;
                    }
                    const back = layerReturnFocus;
                    layerReturnFocus = null;
                    // 只归还给"仍在文档里且仍可见"的元素；否则焦点原地不动（别硬塞给 body）
                    if (back && document.contains(back) && back.getBoundingClientRect().width > 0) back.focus();
                }

                // V3.3: 通用确认 Modal (替代原生 confirm) —— 返回 Promise，resolve(true/false)
                let confirmCallback = null;
                function askConfirm(opts) {
                    return new Promise((resolve) => {
                        if (!confirmModal) { resolve(true); return; }
                        confirmTitle.textContent = opts.title || '确认操作';
                        confirmMsg.textContent = opts.msg || '';
                        confirmOkBtn.textContent = opts.okText || '确定';
                        confirmOkBtn.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
                        confirmCallback = (val) => { resolve(val); confirmCallback = null; };
                        openLayer(confirmModal, { initialFocus: confirmOkBtn });
                    });
                }
                function closeConfirm() {
                    if (confirmModal) closeLayer(confirmModal);
                }
        
                // ================================================================
                // V3: 管理/考生端切换 + 模板下载 + 帮助
                // ================================================================
                function updateToolbarVisibility() {
                    const hasExam = !!(examData && examData.questions && examData.questions.length);
                    if (toolbar) toolbar.classList.toggle('hidden', hasExam);
                    if (manageBtn) manageBtn.classList.toggle('hidden', !hasExam); // 考生端(导出版)无管理元素，需守卫
                }
        
                function closeManageMenu() {
                    manageMenu.classList.remove('open');
                    manageBtn.setAttribute('aria-expanded', 'false');
                }
        
        
                function openHelpModal() { if (helpModal) openLayer(helpModal); }
                function closeHelpModal() { if (helpModal) closeLayer(helpModal); }
        
                // ================================================================
                // V3.3: 练习模式即时反馈 —— 判定引擎
                // ================================================================
                // 判定结果: 'correct' 全对 | 'partial' 部分对(仅多选) | 'wrong' 错
                function judgeAnswer(q, userAns) {
                    const answer = q.answer || [];
                    const user = userAns || [];
                    const exactMatch = user.length === answer.length &&
                        user.every(v => answer.includes(v)) && answer.every(v => user.includes(v));
                    if (exactMatch) return 'correct';
                    if (q.type === 'multi' && user.length > 0) {
                        // 多选：选了至少一个正确答案，但不完整/含错项 → partial
                        if (user.some(v => answer.includes(v))) return 'partial';
                    }
                    return 'wrong';
                }
        
                // 单选/判断: 点击后延时判定 (防手滑误触，给零点几秒确认时间)
                function scheduleJudge(qIdx) {
                    clearJudge(qIdx);
                    judgeTimers[qIdx] = setTimeout(() => {
                        delete judgeTimers[qIdx];
                        judgeQuestion(qIdx);
                    }, 500);
                }
                function clearJudge(qIdx) {
                    if (judgeTimers[qIdx]) { clearTimeout(judgeTimers[qIdx]); delete judgeTimers[qIdx]; }
                }
                function clearAllJudges() {
                    Object.keys(judgeTimers).forEach(i => clearJudge(parseInt(i)));
                }
        
                // 执行判定 (练习模式)：写 feedbackMap → 锁定 → 渲染 → 统计 → 播报
                function judgeQuestion(qIdx) {
                    if (isSubmitted || feedbackMap[qIdx] != null) return;
                    const q = examData && examData.questions[qIdx];
                    if (!q) return;
                    const user = userAnswers[qIdx];
                    if (!user || user.length === 0) return;
                    feedbackMap[qIdx] = judgeAnswer(q, user);
                    renderCurrentCard();
                    updateStatsAndProgress();
                    updateGrid();
                    announceFeedback(qIdx);
                    scheduleSave();
                }
        
                // sr-only 读屏播报 (仅判定时)
                const liveRegion = document.createElement('div');
                liveRegion.className = 'sr-only';
                liveRegion.setAttribute('aria-live', 'polite');
                document.addEventListener('DOMContentLoaded', () => { document.body.appendChild(liveRegion); });
                function announceFeedback(qIdx) {
                    const r = feedbackMap[qIdx];
                    const label = r === 'correct' ? '回答正确' : (r === 'partial' ? '部分正确，还有遗漏或误选' : '回答错误');
                    liveRegion.textContent = '';
                    setTimeout(() => { liveRegion.textContent = `第 ${qIdx + 1} 题：${label}`; }, 50);
                }
        
                // 已答统计: 练习模式 = 已判定；考试模式 = 有答案
                function isAnswered(i) {
                    if (mode === 'practice') return !!feedbackMap[i];
                    return !!(userAnswers[i] && userAnswers[i].length > 0);
                }
        
                // ================================================================
                // 3. 渲染引擎
                // ================================================================
                function renderAll() {
                    if (!examData || !examData.questions || examData.questions.length === 0) {
                        emptyState.classList.remove('hidden');
                        slider.classList.add('hidden');
                        totalQDisplay.textContent = '0 题';
                        if (examName) examName.textContent = '考试系统';
                        answeredCount.textContent = '0';
                        totalCount.textContent = '0';
                        // V3.1: 清空分段进度条 (修复重置后残留)
                        if (progressSegments) progressSegments.innerHTML = '';
                        updateToolbarVisibility();
                        return;
                    }
        
                    emptyState.classList.add('hidden');
                    slider.classList.remove('hidden');
        
                    const qs = examData.questions;
                    totalCount.textContent = qs.length;
                    totalQDisplay.textContent = `${qs.length} 题`;
                    // V3.2: 显示试卷名称 (方案 A)；超长由 CSS 省略号截断
                    if (examName) examName.textContent = examData.title || '考试系统';
                    // 浏览器标签页标题同步为卷名：导出的考生端若沿用导出时的静态 <title>，
                    // 换卷后标签页仍写着上一份卷子的名字，容易误判成「打开的还是旧卷」。
                    if (examData.title) document.title = examData.title;
        
                    // 构建 slider 卡片 (content/options 均需转义，防 XSS)
                    slider.innerHTML = qs.map((q, idx) => {
                        const typeLabel = q.type === 'single' ? '单选题' : q.type === 'multi' ? '多选题' : '判断题';
                        const isJudge = q.type === 'judge';
                        const isMulti = q.type === 'multi';
                        // V3: 判断题 ✓/✕ 大按钮形态；radio/checkbox 语义化
                        const roleAttr = isMulti ? 'role="checkbox" aria-checked="false"' : 'role="radio" aria-checked="false"';
                        const optionsHtml = (q.options || []).map((opt, oi) => {
                            const marker = isJudge ? (oi === 0 ? '✓' : '✕') : isMulti ? '□' : String.fromCharCode(65 + oi);
                            const cls = `option-item ${isMulti ? 'multi' : ''}${isJudge ? ' judge' : ''}`;
                            return `<div class="${cls}" data-q="${idx}" data-opt="${oi}" tabindex="0" ${roleAttr}>
                                        <span class="marker">${marker}</span>
                                        <span class="text">${escapeHTML(opt)}</span>
                                    </div>`;
                        }).join('');
                        // V3.3: 多选题常驻「确认本题」槽位 (固定高度占位，判定反馈零形变；禁用态极淡；考试模式不渲染)
                        const confirmSlot = isMulti && mode !== 'exam'
                            ? `<div class="confirm-slot" data-confirm-slot="${idx}"><button type="button" class="confirm-btn" data-confirm="${idx}" disabled>确认本题</button></div>`
                            : '';
        
                        return `<div class="question-card" data-index="${idx}">
                                    <div class="q-badge">${typeLabel} · 第 ${idx+1} 题</div>
                                    <div class="q-text">${escapeHTML(q.content)}</div>
                                    <div class="options-list${isJudge ? ' judge' : ''}">${optionsHtml}</div>
                                    ${confirmSlot}
                                </div>`;
                    }).join('');
        
                    // 更新状态 & 激活 (选项事件通过 slider 事件委托，无需重复绑定)
                    updateToolbarVisibility();
                    updateStatsAndProgress();
                    goToQuestion(currentIndex, false);
                    updateNavButtons();
                    updateGrid();
        
                    // 如果已经交卷，应用批改样式 (V3.1: 刷新恢复不再自动弹出成绩 Modal，仅保留批改样式)
                    if (isSubmitted && mode !== 'practice') {
                        applyReviewToAllCards();
                    } else if (mode === 'practice' && isSubmitted) {
                        // V3.3: 练习模式完成恢复 —— 已判定题保留反馈，未判定题锁定但不泄露答案
                        document.querySelectorAll('.question-card').forEach((card, idx) => {
                            if (feedbackMap[idx] == null) {
                                card.querySelectorAll('.option-item').forEach(el => el.classList.add('locked'));
                                const slot = card.querySelector('.confirm-slot');
                                if (slot) {
                                    slot.classList.add('done');
                                    const b = slot.querySelector('.confirm-btn');
                                    if (b) b.disabled = true;
                                }
                            }
                        });
                        renderCurrentCard();
                    } else {
                        closeResultModal();
                        disableAllOptions(false);
                    }
        
                    updateSubmitLabel();
                    updateReviewBtn();
                    // 存储备份
                    saveToStorage();
                }
        
                function goToQuestion(index, smooth = true) {
                    const cards = document.querySelectorAll('.question-card');
                    if (!cards.length) return;
                    const idx = Math.max(0, Math.min(index, cards.length - 1));
                    // V3.3: 练习模式兜底 —— 离开前，当前题(单选/判断)已选未判则立即判定
                    if (mode === 'practice' && !isSubmitted && currentIndex !== idx) {
                        const cq = examData && examData.questions[currentIndex];
                        if (cq && (cq.type === 'single' || cq.type === 'judge')) {
                            clearJudge(currentIndex);
                            judgeQuestion(currentIndex);
                        }
                    }
                    currentIndex = idx;
        
                    cards.forEach((card, i) => {
                        card.classList.toggle('active', i === idx);
                    });
        
                    // 滑动位移 (根据实际宽度计算)
                    const stage = document.getElementById('stage');
                    const offset = -idx * 100;
                    slider.style.transform = `translateX(${offset}%)`;
        
                    updateNavButtons();
                    updateStatsAndProgress();
                    updateGrid();
                    // V3.3: 切题/恢复时渲染当前题选中与反馈样式 (修复切回后样式丢失)
                    renderCurrentCard();
                    // 高亮当前题号
                    document.querySelectorAll('.grid-item').forEach((el, i) => {
                        el.classList.toggle('current', i === idx);
                    });
                }
        
                function updateStatsAndProgress() {
                    if (!examData) return;
                    const total = examData.questions.length;
                    let answered = 0;
                    for (let i = 0; i < total; i++) {
                        if (isAnswered(i)) answered++;
                    }
                    answeredCount.textContent = answered;
                    // V3: 分段进度条 (每题一格)；V3.3: 练习模式按判定结果着色 + 增量更新
                    if (progressSegments) {
                        const html = examData.questions.map((q, i) => {
                            let cls = 'progress-seg';
                            if (mode === 'practice') {
                                if (feedbackMap[i] === 'correct') cls += ' correct';
                                else if (feedbackMap[i] != null) cls += ' wrong';
                            } else if (isAnswered(i)) {
                                cls += ' answered';
                            }
                            if (i === currentIndex) cls += ' current';
                            return `<div class="${cls}" data-seg="${i}" role="button" aria-label="第 ${i+1} 题"></div>`;
                        }).join('');
                        if (html !== lastSegHtml) { progressSegments.innerHTML = html; lastSegHtml = html; }
                    }
                }
        
                function updateNavButtons() {
                    const total = examData ? examData.questions.length : 0;
                    prevBtn.disabled = currentIndex === 0 || !examData;
                    nextBtn.disabled = currentIndex >= total - 1 || !examData;
                }
        
                // 选项点击处理 (由 slider 上的事件委托统一分发)
                function handleOptionClick(item) {
                    if (isSubmitted) return;
                    const qIdx = parseInt(item.dataset.q);
                    const optIdx = parseInt(item.dataset.opt);
                    if (isNaN(qIdx) || isNaN(optIdx)) return;
                    // V3.3: 练习模式已判定题锁定 (键盘路径 pointer-events 拦不住，此处兜底)
                    if (mode === 'practice' && feedbackMap[qIdx] != null) return;
                    const q = examData.questions[qIdx];
                    if (!q) return;
                    // V3.3: 答案变更，取消待执行的延时判定
                    clearJudge(qIdx);
        
                    let current = userAnswers[qIdx] || [];
        
                    if (q.type === 'single' || q.type === 'judge') {
                        // 单选/判断: 替换
                        if (current.length === 1 && current[0] === optIdx) {
                            // 取消选中
                            delete userAnswers[qIdx];
                        } else {
                            userAnswers[qIdx] = [optIdx];
                        }
                    } else if (q.type === 'multi') {
                        // 多选: toggle
                        const idx = current.indexOf(optIdx);
                        if (idx > -1) {
                            current.splice(idx, 1);
                            if (current.length === 0) delete userAnswers[qIdx];
                            else userAnswers[qIdx] = current;
                        } else {
                            current.push(optIdx);
                            current.sort((a, b) => a - b);
                            userAnswers[qIdx] = current;
                        }
                    }
        
                    // V3.4: 首次作答即启动计时 (语义：真正动手答题才开始，而非打开页面)
                    if (!timerStarted) beginTimer();
                    // 重新渲染当前卡片 (更新样式)
                    renderCurrentCard();
                    updateStatsAndProgress();
                    updateGrid();
                    scheduleSave();
                    // V3.3: 单选/判断 → 延时判定 (防手滑)；多选 → 等考生点「确认本题」
                    if (mode === 'practice' && (q.type === 'single' || q.type === 'judge')) {
                        if (userAnswers[qIdx] && userAnswers[qIdx].length > 0) scheduleJudge(qIdx);
                    }
                }
        
                // V3.3: 多选「确认本题」→ 立即判定
                function handleConfirmClick(btn) {
                    const qIdx = parseInt(btn.dataset.confirm);
                    if (isNaN(qIdx)) return;
                    if (mode !== 'practice' || isSubmitted || feedbackMap[qIdx] != null) return;
                    judgeQuestion(qIdx);
                }
        
                // V3.3: 判定后替换 marker 符号 (形状通道，色觉障碍可读；仅判定时覆盖)
                function setMarker(el, ch) {
                    const m = el.querySelector('.marker');
                    if (m) m.textContent = ch;
                }
        
                // V3.3: 多选确认按钮状态 (零形变：槽位常驻，仅 opacity/文字变化)
                function updateConfirmBtn(slot, qIdx, result, selected) {
                    const btn = slot.querySelector('.confirm-btn');
                    if (!btn) return;
                    if (mode !== 'practice' || isSubmitted || result != null) {
                        slot.classList.add('done');
                        btn.disabled = true;
                        return;
                    }
                    slot.classList.remove('done');
                    const has = selected && selected.length > 0;
                    btn.disabled = !has;
                    btn.textContent = has ? `确认本题 · 已选 ${selected.length} 项` : '确认本题';
                }
        
                function renderCurrentCard() {
                    const cards = document.querySelectorAll('.question-card');
                    if (!cards.length) return;
                    const card = cards[currentIndex];
                    if (!card) return;
                    const qIdx = currentIndex;
                    const q = examData.questions[qIdx];
                    const selected = userAnswers[qIdx] || [];
                    const opts = card.querySelectorAll('.option-item');
                    const result = feedbackMap[qIdx];
                    opts.forEach((el, i) => {
                        const isSel = selected.includes(i);
                        el.classList.toggle('selected', isSel);
                        el.setAttribute('aria-checked', isSel ? 'true' : 'false');
                        el.classList.remove('correct-reveal', 'wrong-reveal', 'miss-reveal', 'locked', 'disabled');
                        if (isSubmitted && mode !== 'practice') {
                            // 考试模式批改 (交卷后)；漏选提示仅多选
                            const correct = q.answer || [];
                            const isCorrect = correct.includes(i);
                            if (isSel && isCorrect) {
                                el.classList.add('correct-reveal');
                            } else if (isSel && !isCorrect) {
                                el.classList.add('wrong-reveal');
                            } else if (!isSel && isCorrect && q.type === 'multi') {
                                el.classList.add('miss-reveal');
                            }
                            el.classList.add('disabled');
                        } else if (mode === 'practice' && result) {
                            // V3.3: 练习模式即时反馈 —— 只改色/边框/符号，零布局变化
                            const correctAns = q.answer || [];
                            const isCorrect = correctAns.includes(i);
                            if (isCorrect && isSel) {
                                el.classList.add('correct-reveal');
                                setMarker(el, '✓');
                            } else if (isCorrect && !isSel && q.type === 'multi') {
                                // 漏选提示仅多选 (口径 #7)
                                el.classList.add('miss-reveal');
                                setMarker(el, '✓');
                            } else if (!isCorrect && isSel) {
                                el.classList.add('wrong-reveal');
                                setMarker(el, '✕');
                            }
                            el.classList.add('locked');
                        } else if (mode === 'practice' && isSubmitted) {
                            // 完成练习后未判定的题: 锁定但不泄露答案
                            el.classList.add('locked');
                        }
                    });
                    // V3.3: 多选确认按钮状态同步
                    const slot = card.querySelector('.confirm-slot');
                    if (slot) updateConfirmBtn(slot, qIdx, result, selected);
                    // 练习模式：判定通过后，把该题「解析」就地贴在选项下方（未判定/考试模式则移除）
                    let inlineFb = card.querySelector('.q-inline-fb');
                    if (mode === 'practice' && result && q.explain) {
                        if (!inlineFb) {
                            inlineFb = document.createElement('div');
                            inlineFb.className = 'q-inline-fb';
                            card.appendChild(inlineFb);
                        }
                        inlineFb.dataset.r = result;
                        inlineFb.innerHTML = '<span class="q-inline-tag">解析</span>' + escapeHTML(q.explain);
                    } else if (inlineFb) {
                        inlineFb.remove();
                    }
                }
        
                function disableAllOptions(disabled) {
                    document.querySelectorAll('.option-item').forEach(el => {
                        if (disabled) el.classList.add('disabled');
                        else el.classList.remove('disabled');
                    });
                }
        
                // ================================================================
                // 4. 交卷 & 判分
                // ================================================================
                // 判分：考试模式严格匹配 (数组完全一致)；练习模式按已判定结果统计 (未判定不计对)
                function calculateScore() {
                    const total = examData ? examData.questions.length : 0;
                    let correct = 0;
                    if (mode === 'practice') {
                        examData.questions.forEach((q, idx) => {
                            if (feedbackMap[idx] === 'correct') correct++;
                        });
                    } else {
                        examData.questions.forEach((q, idx) => {
                            const user = userAnswers[idx] || [];
                            const answer = q.answer || [];
                            if (user.length === answer.length && user.every(v => answer.includes(v)) && answer.every(v => user
                                    .includes(v))) {
                                correct++;
                            }
                        });
                    }
                    const score = total ? Math.round((correct / total) * 100) : 0;
                    return { correct, total, score };
                }
        
                // 对所有卡片应用批改样式 (交卷时 + 刷新恢复时复用)
                function applyReviewToAllCards() {
                    document.querySelectorAll('.question-card').forEach((card, idx) => {
                        const q = examData.questions[idx];
                        if (!q) return;
                        const selected = userAnswers[idx] || [];
                        const opts = card.querySelectorAll('.option-item');
                        opts.forEach((el, i) => {
                            const correctAns = q.answer || [];
                            const isCorrect = correctAns.includes(i);
                            const isSel = selected.includes(i);
                            el.classList.add('disabled');
                            el.classList.remove('miss-reveal');
                            if (isSel && isCorrect) {
                                el.classList.add('correct-reveal');
                            } else if (isSel && !isCorrect) {
                                el.classList.add('wrong-reveal');
                            } else if (!isSel && isCorrect && q.type === 'multi') {
                                // V3.3: 漏选提示仅多选 (两种模式统一)；单选/判断不提示正确答案位置
                                el.classList.add('miss-reveal');
                            } else {
                                el.classList.remove('correct-reveal', 'wrong-reveal');
                            }
                        });
                    });
                }
        
                async function submitExam() {
                    if (!examData || isSubmitted) return;
                    const total = examData.questions.length;
                    let answered = 0;
                    for (let i = 0; i < total; i++) {
                        if (isAnswered(i)) answered++;
                    }
                    const missing = total - answered;
                    const label = mode === 'practice' ? '完成练习' : '交卷判分';
                    let ok;
                    if (missing > 0) {
                        ok = await askConfirm({
                            title: `确定${label}吗？`,
                            msg: `还有 ${missing} 题未${mode === 'practice' ? '完成判定' : '作答'}，确定${label}吗？`,
                            okText: '确定'
                        });
                    } else {
                        ok = await askConfirm({
                            title: `确定${label}吗？`,
                            msg: mode === 'practice' ? '全部题目已完成，确定查看练习成绩吗？' : '确定交卷并查看成绩吗？',
                            okText: '确定'
                        });
                    }
                    if (!ok) return;
        
                    isSubmitted = true;
                    clearAllJudges();
                    // 停止计时器
                    stopTimer();
                    updateReviewBtn();
        
                    const r = calculateScore();
                    showResultBanner(r.score, r.correct, r.total);
        
                    if (mode !== 'practice') {
                        // 考试模式: 刷新所有卡片显示正确答案
                        applyReviewToAllCards();
                    } else {
                        // 练习模式: 未判定的题锁定 (不泄露答案)，已判定题的反馈保持不变
                        document.querySelectorAll('.question-card').forEach((card, idx) => {
                            if (feedbackMap[idx] == null) {
                                const slot = card.querySelector('.confirm-slot');
                                if (slot) {
                                    slot.classList.add('done');
                                    const b = slot.querySelector('.confirm-btn');
                                    if (b) b.disabled = true;
                                }
                                card.querySelectorAll('.option-item').forEach(el => el.classList.add('locked'));
                            }
                        });
                        renderCurrentCard();
                    }
        
                    updateGrid();
                    saveToStorage();
                    updateSubmitLabel();
                }
        
                // V3: 成绩结果 Modal + SVG 圆环分数动画
                const RING_CIRCUMFERENCE = 2 * Math.PI * 60; // ≈ 377
                let resultAnimId = null; // 圆环数字动画句柄
                function showResultBanner(score, correct, total) {
                    if (!resultModal) return;
                    openLayer(resultModal);
                    resultDetail.textContent = `正确 ${correct} / ${total} 题`;
                    resultVerdict.textContent = score >= 60 ? '通过' : '继续加油';
                    resultVerdict.className = 'result-verdict ' + (score >= 60 ? 'pass' : 'fail');
                    // 圆环动画：先复位，再过渡到目标值
                    ringFill.style.transition = 'none';
                    ringFill.style.strokeDashoffset = RING_CIRCUMFERENCE;
                    resultScore.textContent = '0%';
                    void ringFill.getBoundingClientRect(); // 强制重排，保证动画从头播放
                    ringFill.style.transition = 'stroke-dashoffset 0.9s cubic-bezier(0.22, 0.61, 0.36, 1)';
                    ringFill.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - score / 100);
                    // 分数数字递增 (缓动)
                    const start = performance.now();
                    const duration = 900;
                    const step = (now) => {
                        const p = Math.min(1, (now - start) / duration);
                        resultScore.textContent = Math.round(score * (1 - Math.pow(1 - p, 3))) + '%';
                        if (p < 1) resultAnimId = requestAnimationFrame(step);
                    };
                    resultAnimId = requestAnimationFrame(step);
                }
        
                function closeResultModal() {
                    if (resultAnimId) { cancelAnimationFrame(resultAnimId); resultAnimId = null; }
                    if (resultModal) closeLayer(resultModal);
                }
        
                // ================================================================
                // V3.1: 明暗主题切换 (默认亮色，偏好存 localStorage)
                // ================================================================
                function applyTheme(theme) {
                    const prev = document.documentElement.getAttribute('data-theme');
                    document.documentElement.setAttribute('data-theme', theme);
                    // V3.2: 仅主题实际变化时持久化，避免初始化时冗余写入
                    if (prev !== theme) {
                        try { localStorage.setItem('exam_theme', theme); } catch (e) { /* 忽略存储失败 */ }
                    }
                    // 图标表示"将要切换到的目标"：亮色显示月亮、暗色显示太阳
                    iconSun.classList.toggle('hidden', theme !== 'dark');
                    iconMoon.classList.toggle('hidden', theme === 'dark');
                    themeBtn.setAttribute('aria-pressed', String(theme === 'dark'));
                    themeBtn.setAttribute('aria-label', theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题');
                }
        
                function toggleTheme() {
                    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
                    applyTheme(next);
                }
        
                function initTheme() {
                    if (appVersion) appVersion.textContent = APP_VERSION;
                    const current = document.documentElement.getAttribute('data-theme') || 'light';
                    applyTheme(current);
                }
        
                // ================================================================
                // V3.3: 答题模式管理 (练习·即时反馈 / 考试·交卷判分)
                // ================================================================
                function setMode(m, persist) {
                    mode = (m === 'exam') ? 'exam' : 'practice';
                    if (modeSeg) {
                        modeSeg.querySelectorAll('.seg-btn').forEach(b => {
                            b.classList.toggle('active', b.dataset.mode === mode);
                        });
                    }
                    updateSubmitLabel();
                    if (persist !== false) {
                        try { localStorage.setItem('exam_mode', mode); } catch (e) { /* 忽略 */ }
                    }
                }
        
                function updateSubmitLabel() {
                    if (!submitBtn) return;
                    if (isSubmitted) {
                        submitBtn.textContent = mode === 'practice' ? '已完成' : '已交卷';
                    } else {
                        submitBtn.textContent = mode === 'practice' ? '完成练习' : '交卷判分';
                    }
                }
        
                // 切换模式 (管理端)：清空进度后应用新模式
                async function switchMode(m) {
                    if (m === mode) return;
                    const ok = await askConfirm({
                        title: '切换答题模式',
                        msg: '切换将清空当前答题进度与判定结果，确定继续吗？',
                        okText: '切换'
                    });
                    if (!ok) { setMode(mode, false); return; }
                    // 清空进度，保留试卷
                    userAnswers = {};
                    feedbackMap = {};
                    clearAllJudges();
                    lastSegHtml = '';
                    lastGridHtml = '';
                    isSubmitted = false;
                    currentIndex = 0;
                    resetTimerState();
                    setMode(m);
                    if (examData) {
                        renderAll();
                    }
                    closeResultModal();
                    closeConfirm();
                }
        
                // ================================================================
                // 5. 题号网格 (抽屉)
                // ================================================================
                function updateGrid() {
                    if (!examData) return;
                    const qs = examData.questions;
                    // 只重建内容；点击跳转由 gridContainer 上的一次性事件委托处理；V3.3: 增量更新
                    const html = qs.map((q, idx) => {
                        let cls = 'grid-item';
                        if (mode === 'practice') {
                            if (feedbackMap[idx] === 'correct') cls += ' correct';
                            else if (feedbackMap[idx] != null) cls += ' wrong';
                        } else if (isAnswered(idx)) {
                            cls += ' answered';
                        }
                        if (currentIndex === idx) cls += ' current';
                        return `<div class="${cls}" data-gidx="${idx}" role="button" tabindex="0" aria-label="第 ${idx+1} 题">${idx+1}</div>`;
                    }).join('');
                    if (html !== lastGridHtml) { gridContainer.innerHTML = html; lastGridHtml = html; }
                    // V3.3: 图例按模式切换
                    const practice = mode === 'practice';
                    if (legendCorrect) legendCorrect.classList.toggle('hidden', !practice);
                    if (legendWrong) legendWrong.classList.toggle('hidden', !practice);
                    const answeredSw = document.querySelector('.legend .s-answered');
                    if (answeredSw) answeredSw.classList.toggle('hidden', practice);
                }
        
                // 打开题号抽屉。题目多时面板封顶、由网格内部滚动（见 css/app.css .grid-questions），
                // 这里顺手把「当前题」滚进可视区 —— 否则 70 题时打开抽屉还得自己在 14 行里找。
                function openDrawer() {
                    openLayer(drawerOverlay);
                    const cur = gridContainer && gridContainer.querySelector('.grid-item.current');
                    // display 刚从 none 变 flex，这里同步取布局即可（会强制一次 layout）
                    if (cur) cur.scrollIntoView({ block: 'center', inline: 'nearest' });
                }
        
                function closeDrawer() { closeLayer(drawerOverlay); }
        
                // ================================================================
                // V3.5: 作答回顾 + 只练错题
                // ================================================================
                // 入口：交卷后可经「回顾」按钮 / 成绩弹层「查看回顾」打开。
                // 支持：全部题 / 只看错题 两种过滤；练习模式下可「只练错题」(错题 = 答错 + 部分对 + 未答)。
                function updateReviewBtn() {
                    // 交卷后才显示「回顾」入口 (isSubmitted 由 submitExam / 恢复逻辑维护)
                    if (reviewBtn) reviewBtn.style.display = isSubmitted ? '' : 'none';
                    // 「错题重练」会话中，底部导航常驻「返回原卷」，随时可回原卷
                    if (reviewBackNavBtn) reviewBackNavBtn.style.display = retryActive ? '' : 'none';
                }
        
                function closeReview() {
                    if (reviewModal) closeLayer(reviewModal);
                }
        
                // 打开回顾面板 (仅交卷后可用)
                function openReview() {
                    if (!examData || !isSubmitted) return;
                    const total = examData.questions.length;
                    let correct = 0, partial = 0, wrong = 0, blank = 0;
                    examData.questions.forEach((q, idx) => {
                        const ans = userAnswers[idx] || [];
                        const res = feedbackMap[idx];
                        if (ans.length === 0) blank++;
                        else if (res === 'correct') correct++;
                        else if (res === 'partial') partial++;
                        else wrong++;
                    });
                    revCorrect.textContent = correct;
                    revPartial.textContent = partial;
                    revWrong.textContent = wrong;
                    revBlank.textContent = blank;
                    revAll.textContent = total;
                    // 只看错题 = 非全对(含部分对与未答)，保证与过滤/重练口径一致
                    revWrongN.textContent = total - correct;
                    reviewContext.textContent = `共 ${total} 题 · ${mode === 'practice' ? '练习模式' : '考试模式'}`;
                    // 动作按钮：练习模式且非重练会话时可只练错题；「返回原卷」常驻在主界面底部导航，回顾内不再重复
                    if (reviewRetryBtn) reviewRetryBtn.style.display = mode === 'practice' && !retryActive ? 'inline-flex' : 'none';
                    reviewExpandedIdx = null; // 重新打开时收起所有详情
                    renderReviewList();
                    if (reviewModal) openLayer(reviewModal, { initialFocus: reviewCloseBtn });
                }
        
                // 渲染回顾列表 (全部 / 只看错题)；点条目展开「复盘详情」：我的作答/正确答案/解析
                function renderReviewList() {
                    if (!examData) { reviewList.innerHTML = '<div class="review-empty">无数据</div>'; return; }
                    const wrongFilter = (idx) => {
                        const ans = userAnswers[idx] || [];
                        const res = feedbackMap[idx];
                        return ans.length === 0 || res === 'wrong' || res === 'partial';
                    };
                    const indices = [];
                    examData.questions.forEach((q, idx) => {
                        if (!reviewOnlyWrong || wrongFilter(idx)) indices.push(idx);
                    });
                    if (indices.length === 0) {
                        reviewList.innerHTML = `<div class="review-empty">${reviewOnlyWrong ? '没有错题' : '无题目'}</div>`;
                        return;
                    }
                    reviewList.innerHTML = indices.map((globalIdx) => {
                        const q = examData.questions[globalIdx];
                        const ans = userAnswers[globalIdx] || [];
                        const res = feedbackMap[globalIdx];
                        let cls, tag;
                        if (ans.length === 0) { cls = 's-blank'; tag = '未答'; }
                        else if (res === 'correct') { cls = 's-ok'; tag = '答对'; }
                        else if (res === 'partial') { cls = 's-partial'; tag = '部分对'; }
                        else { cls = 's-wrong'; tag = '答错'; }
                        const expanded = reviewExpandedIdx === globalIdx;
                        const mineTxt = optionsToText(q, ans);
                        const correctTxt = optionsToText(q, q.answer);
                        const explain = q.explain ? escapeHTML(q.explain) : null;
                        return `<div class="review-item ${cls}${expanded ? ' open' : ''}" data-idx="${globalIdx}" role="button" tabindex="0" aria-expanded="${expanded}" title="点击展开复盘详情">
                                    <div class="review-line">
                                        <div class="review-num">${globalIdx + 1}</div>
                                        <div class="review-text">${escapeHTML(q.content)}</div>
                                        <div class="review-tag">${tag}</div>
                                    </div>
                                    <div class="review-detail${expanded ? ' show' : ''}">
                                        <div class="rd-row"><span class="rd-label">我的作答</span><span class="rd-value">${mineTxt}</span></div>
                                        <div class="rd-row"><span class="rd-label">正确答案</span><span class="rd-value rd-answer">${correctTxt}</span></div>
                                        <div class="rd-row rd-explain"><span class="rd-label">解析</span><span class="rd-value">${explain || '<em class="rd-none">本题未提供解析</em>'}</span></div>
                                    </div>
                                </div>`;
                    }).join('');
                    // 点击条目展开/收起复盘详情 (单开手风琴)
                    reviewList.querySelectorAll('.review-item').forEach(el => {
                        el.addEventListener('click', () => {
                            const idx = parseInt(el.dataset.idx, 10);
                            if (isNaN(idx)) return;
                            reviewExpandedIdx = reviewExpandedIdx === idx ? null : idx;
                            renderReviewList();
                        });
                    });
                }
        
                // 切换回顾过滤 (全部 / 只看错题)
                function switchReviewFilter(filter) {
                    reviewOnlyWrong = filter === 'wrong';
                    reviewExpandedIdx = null; // 切换过滤时收起已展开的详情
                    if (reviewSeg) {
                        reviewSeg.querySelectorAll('.seg-btn').forEach(b => {
                            b.classList.toggle('active', b.dataset.filter === filter);
                        });
                    }
                    renderReviewList();
                }
        
                // 只练错题 (练习模式)：提取错题子集进入新一轮练习，可返回原卷
                // 仅允许一层，防止嵌套重练导致重置/返回原卷行为混乱。
                function retryWrongQuestions() {
                    if (mode !== 'practice' || !isSubmitted || !examData) return;
                    if (retryActive) {
                        if (typeof showToast === 'function') showToast('已在错题重练中，请先返回原卷');
                        return;
                    }
                    const total = examData.questions.length;
                    const wrongIndices = [];
                    examData.questions.forEach((q, idx) => {
                        const ans = userAnswers[idx] || [];
                        const res = feedbackMap[idx];
                        if (ans.length === 0 || res === 'wrong' || res === 'partial') wrongIndices.push(idx);
                    });
                    if (wrongIndices.length === 0) {
                        if (typeof showToast === 'function') showToast('没有可练习的错题');
                        return;
                    }
                    // 保存原卷快照，供「返回原卷」恢复
                    retrySnapshot = {
                        exam: JSON.parse(JSON.stringify(examData)),
                        answers: JSON.parse(JSON.stringify(userAnswers)),
                        feedback: JSON.parse(JSON.stringify(feedbackMap)),
                        submitted: isSubmitted
                    };
                    const wrongExam = {
                        title: `${examData.title} · 错题重练`,
                        questions: wrongIndices.map(idx => examData.questions[idx])
                    };
                    retryActive = true;
                    closeReview();
                    // loadExamData 会重置答案/判定/计时并渲染错题子卷 (子卷期间主界面常驻「返回原卷」)
                    loadExamData(wrongExam);
                }
        
                // 返回原卷：从「错题重练」会话恢复进入前的完整原卷与答题状态
                function backToOriginalExam() {
                    if (!retryActive || !retrySnapshot) return;
                    examData = retrySnapshot.exam;
                    userAnswers = retrySnapshot.answers;
                    feedbackMap = retrySnapshot.feedback;
                    isSubmitted = retrySnapshot.submitted;
                    retryActive = false;
                    retrySnapshot = null;
                    lastSegHtml = '';
                    lastGridHtml = '';
                    closeReview();
                    renderAll();   // renderAll → updateReviewBtn 会按 retryActive=false 收起主界面「返回原卷」
                }
        
                // ================================================================
                // 6. 计时器
                // ================================================================
                // 计时器：基于绝对时间戳的秒表，后台/休眠/系统时间不漂移(误差不累积)
                function tick() {
                    timerSeconds = Math.floor((Date.now() - timerStartTs) / 1000);
                    if (timerVisible) {
                        timerDisplay.textContent = formatTime(timerSeconds);
                    }
                    scheduleSave(); // 防抖写入，避免每秒序列化
                }
        
                // 「首次作答」或已开始会话「继续」时启动 (管理端/考生端统一)
                function beginTimer() {
                    if (isSubmitted) return; // V3.1: 已交卷不再计时
                    if (timerInterval) return;
                    timerStarted = true;
                    if (!timerStartTs) timerStartTs = Date.now();
                    timerInterval = setInterval(tick, 1000);
                    tick(); // 立即刷新一次，弥补启动瞬间的延迟
                }
        
                function stopTimer() {
                    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
                }
        
                // 复位为「未开始」：停止并停在 00:00:00，等首次作答再启动
                function resetTimerState() {
                    stopTimer();
                    timerStarted = false;
                    timerStartTs = 0;
                    timerSeconds = 0;
                    timerDisplay.textContent = '00:00:00';
                }
        
                function toggleTimerVisibility() {
                    timerVisible = !timerVisible;
                    timerPill.classList.toggle('hidden-timer', !timerVisible);
                    // V3: eye / eye-off 图标切换
                    iconEye.classList.toggle('hidden', !timerVisible);
                    iconEyeOff.classList.toggle('hidden', timerVisible);
                    timerToggle.setAttribute('aria-pressed', String(!timerVisible));
                    timerToggle.setAttribute('aria-label', timerVisible ? '隐藏计时' : '显示计时');
                    if (timerVisible) {
                        timerDisplay.textContent = formatTime(timerSeconds);
                    }
                }
        
                // ================================================================
                // 7. 载入数据 (JSON / CSV)
                // ================================================================
                function loadExamData(data, bankVersion) {
                    // 重置状态
                    if (timerInterval) {
                        clearInterval(timerInterval);
                        timerInterval = null;
                    }
                    // 只有「内置默认题库」会带版本号；导入的试卷与导出的考生端一律为 null，其本地进度不受题库版本影响
                    activeBankVersion = bankVersion || null;
                    isSubmitted = false;
                    submitBtn.disabled = false;
                    userAnswers = {};
                    feedbackMap = {};
                    clearAllJudges();
                    lastSegHtml = '';
                    lastGridHtml = '';
                    currentIndex = 0;
                    resetTimerState();
                    timerVisible = true;
                    timerDisplay.classList.remove('hidden-timer');
        
                    examData = data;
                    renderAll();
                    updateSubmitLabel();
                    clearStorage();
                    saveToStorage();
                    closeResultModal();
                }
        
                // ---- 绑定 UI ----
                document.addEventListener('DOMContentLoaded', function() {
                    // V3.1: 考生端模式 (导出的「考试客户端.html」不含管理功能)
                    const isClient = !!window.__EXAM_CLIENT_MODE__;
        
                    // V3.3: 初始化答题模式 (考生端取导出固化值；管理端取上次偏好)
                    if (window.__EXAM_MODE__ === 'exam' || window.__EXAM_MODE__ === 'practice') {
                        setMode(window.__EXAM_MODE__, false);
                    } else if (!isClient) {
                        try {
                            const savedMode = localStorage.getItem('exam_mode');
                            setMode(savedMode === 'exam' || savedMode === 'practice' ? savedMode : 'practice', false);
                        } catch (e) {
                            setMode('practice', false);
                        }
                    }
        
                    // 启动优先级：把「卷子从哪来」和「作答要不要恢复」分开看，别混成一件事。
                    //
                    // ① 导出的考生端（有嵌入数据）：候选卷子唯一且明确 = 嵌入的那一份。
                    //    先看本地进度是否**属于这份卷子** —— 属于就恢复（刷新不丢作答），
                    //    不属于（或压根没有）才用嵌入卷子开新一场。
                    //    ★ 这里曾经写成 `if (嵌入) loadEmbedded() else if (!tryRestore()) ...`，
                    //      于是考生端永远走不到恢复分支：每开一次就重置 userAnswers、还把旧备份覆盖掉，
                    //      表现为「刷新即丢作答，而且退不回上一题」。卷子是权威 ≠ 作答记录也要丢。
                    // ② 普通页面（无嵌入数据）：仍是 本地进度 > 内置默认题库。
                    const embeddedExam = (window.__EMBEDDED_EXAM__ &&
                        Array.isArray(window.__EMBEDDED_EXAM__.questions) &&
                        typeof loadEmbedded === 'function') ? window.__EMBEDDED_EXAM__ : null;
                    if (embeddedExam) {
                        if (!tryRestoreFromStorage(embeddedExam)) loadEmbedded(embeddedExam);
                    } else if (!tryRestoreFromStorage()) {
                        loadDefaultExam();
                    }
        
                    // ---- 事件委托 (只绑定一次) ----
                    // 选项点击：委托到 slider，避免每次 renderAll 重复绑定
                    slider.addEventListener('click', (e) => {
                        // V3.3: 多选「确认本题」
                        const confirmBtn = e.target.closest('.confirm-btn');
                        if (confirmBtn && !confirmBtn.disabled) { handleConfirmClick(confirmBtn); return; }
                        const item = e.target.closest('.option-item');
                        if (item) handleOptionClick(item);
                    });
                    // 防错位兜底：万一浏览器把 overflow 容器滚动了（聚焦滚动 / 旧浏览器不支持 overflow:clip），
                    // 立刻把偏移归零。滑块定位只依赖 transform，本容器任何时候都不该有滚动偏移。
                    const stageEl = document.getElementById('stage');
                    if (stageEl) {
                        stageEl.addEventListener('scroll', () => {
                            if (stageEl.scrollLeft !== 0) stageEl.scrollLeft = 0;
                            if (stageEl.scrollTop !== 0) stageEl.scrollTop = 0;
                        }, { passive: true });
                    }

                    // 题号跳转：委托到 gridContainer，避免每次 updateGrid 重复绑定
                    gridContainer.addEventListener('click', (e) => {
                        const el = e.target.closest('.grid-item');
                        if (!el) return;
                        const idx = parseInt(el.dataset.gidx);
                        if (!isNaN(idx)) {
                            goToQuestion(idx);
                            closeDrawer();
                        }
                    });
        
                    // 上一题/下一题
                    prevBtn.addEventListener('click', () => { if (currentIndex > 0) goToQuestion(currentIndex - 1); });
                    nextBtn.addEventListener('click', () => {
                        const total = examData ? examData.questions.length : 0;
                        if (currentIndex < total - 1) goToQuestion(currentIndex + 1);
                    });
        
                    // V3: 键盘快捷键 (左右切题 / A-D 选答案 / 聚焦选项时 Enter/空格)
                    document.addEventListener('keydown', (e) => {
                        // V3.8: 弹层打开时先接管 Tab。必须排在最前面 ——
                        // 放到 INPUT/TEXTAREA 的早退之后，弹层内输入框上按 Tab 就会直接穿出去。
                        if (e.key === 'Tab' && layerStack.length > 0) {
                            const top = topLayer();
                            const items = focusableIn(top);
                            if (items.length === 0) { e.preventDefault(); return; }
                            const first = items[0];
                            const last = items[items.length - 1];
                            const active = document.activeElement;
                            const inside = top.contains(active);
                            if (e.shiftKey) {
                                if (!inside || active === first) { e.preventDefault(); last.focus(); }
                            } else if (!inside || active === last) {
                                e.preventDefault();
                                first.focus();
                            }
                            return;
                        }
                        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                        if (e.isComposing) return; // V3.1: 中文输入法组合输入不触发快捷键
                        // V3.8: Esc 一律关「当前最上层」弹层。原来写的是回顾优先于抽屉的固定顺序，
                        // 叠加时会关错层；确认框还要按"取消"语义 resolve(false)。
                        if (e.key === 'Escape' && layerStack.length > 0) {
                            e.preventDefault();
                            const topId = topLayer().id;
                            if (topId === 'confirmModal') { closeConfirm(); if (confirmCallback) confirmCallback(false); }
                            else if (topId === 'reviewModal') closeReview();
                            else if (topId === 'drawerOverlay') closeDrawer();
                            else if (topId === 'resultModal') closeResultModal();
                            else if (topId === 'helpModal') closeHelpModal();
                            return;
                        }
                        const targetOpt = e.target && e.target.classList && e.target.classList.contains('option-item');
                        if ((e.key === 'Enter' || e.key === ' ') && targetOpt) {
                            e.preventDefault();
                            handleOptionClick(e.target);
                            return;
                        }
                        const targetGrid = e.target && e.target.classList && e.target.classList.contains('grid-item');
                        if ((e.key === 'Enter' || e.key === ' ') && targetGrid) {
                            e.preventDefault();
                            e.target.click();
                            return;
                        }
                        if (e.key === 'ArrowLeft') { e.preventDefault();
                            prevBtn.click(); }
                        if (e.key === 'ArrowRight') { e.preventDefault();
                            nextBtn.click(); }
                        // V3.3: 键盘选项映射动态化 (支持 4+ 选项：a,b,c,d,e,f...)
                        if (examData && !isSubmitted && /^[a-z]$/i.test(e.key)) {
                            const opts = document.querySelectorAll('.question-card.active .option-item');
                            const optIdx = e.key.toLowerCase().charCodeAt(0) - 97;
                            const item = opts[optIdx];
                            if (item) { e.preventDefault();
                                handleOptionClick(item); }
                        }
                    });
        
                    // 题号网格
                    gridToggleBtn.addEventListener('click', openDrawer);
                    drawerClose.addEventListener('click', closeDrawer);
                    drawerOverlay.addEventListener('click', (e) => { if (e.target === drawerOverlay) closeDrawer(); });
        
                    // 交卷 / 完成练习
                    submitBtn.addEventListener('click', submitExam);
        
                    // V3.3: 通用确认 Modal (替代原生 confirm)
                    bind(confirmOkBtn, 'click', () => { closeConfirm(); if (confirmCallback) confirmCallback(true); });
                    bind(confirmCancelBtn, 'click', () => { closeConfirm(); if (confirmCallback) confirmCallback(false); });
                    if (confirmModal) {
                        confirmModal.addEventListener('click', (e) => {
                            if (e.target === confirmModal) { closeConfirm(); if (confirmCallback) confirmCallback(false); }
                        });
                    }
        
                    // V3.1: 考生端模式不加载管理功能 (导出的 HTML 为纯净考生端)
                    if (!isClient) {
                        // 文件导入核心(选择器 + 拖拽共用)：读取 → 解析 → 载入
                        // V3.6: 抽取为复用函数，供 fileInput 与全局拖拽 drop 使用，避免逻辑分叉
                        function importFile(file) {
                            const reader = new FileReader();
                            reader.onload = function(ev) {
                                try {
                                    const text = ev.target.result;
                                    const data = file.name.endsWith('.json') ? parseJSON(text) : parseCSV(text);
                                    // V3.2: JSON/CSV 未提供标题时，用文件名作试卷名
                                    if (!data.title) data.title = file.name.replace(/\.(csv|json)$/i, '');
                                    loadExamData(data);
                                } catch (err) {
                                    if (typeof showToast === 'function') showToast('解析失败: ' + err.message, 'error');
                                    else alert('解析失败: ' + err.message);
                                }
                            };
                            reader.readAsText(file);
                        }
        
                        // 文件上传 (bind 守卫: 考生端导出版这些元素不存在，null 时静默跳过)
                        bind(fileInput, 'change', function(e) {
                            const file = this.files[0];
                            if (!file) return;
                            fileInput.value = '';
                            importFile(file);
                        });
        
                        // V3.6: 全局拖拽导入 —— 把 .csv/.json 文件拖放到页面任意处即可导入。
                        // 完美贴合"单页工具"直觉；同一动作(选择器/拖拽)共用 importFile，无逻辑分叉。
                        // 注意：目标元素必须 preventDefault+stopPropagation，否则浏览器默认行为是"打开文件"。
                        // 视觉反馈：dragenter 计数(避免子元素进出反复闪烁)，>0 时显示遮罩提示，离开/放下即隐藏。
                        let dragDepth = 0;
                        function hasFiles(e) {
                            return e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files');
                        }
                        function updateDragOverlay() {
                            document.body.classList.toggle('drag-over', dragDepth > 0);
                        }
                        document.addEventListener('dragover', function(e) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = hasFiles(e) ? 'copy' : 'none';
                        });
                        document.addEventListener('dragenter', function(e) {
                            e.preventDefault();
                            if (hasFiles(e)) { dragDepth++; updateDragOverlay(); }
                        });
                        document.addEventListener('dragleave', function(e) {
                            e.preventDefault();
                            if (dragDepth > 0) { dragDepth--; updateDragOverlay(); }
                        });
                        document.addEventListener('drop', function(e) {
                            e.preventDefault();
                            dragDepth = 0;
                            updateDragOverlay();
                            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                            if (file) importFile(file);
                        });
        
                        // 载入内置默认题库
                        bind(loadSampleBtn, 'click', loadDefaultExam);
                        bind(menuSampleBtn, 'click', () => { closeManageMenu(); loadDefaultExam(); });
        
                        // 导出
                        bind(exportBtn, 'click', exportSelfContained);
                        bind(menuExportBtn, 'click', () => { closeManageMenu(); exportSelfContained(); });
        
                        // 模板 / 帮助弹层
                        bind(templateBtn, 'click', openHelpModal);
                        bind(helpBtn, 'click', openHelpModal);
                        bind(menuTemplateBtn, 'click', () => { closeManageMenu(); openHelpModal(); });
                        bind(helpCloseBtn, 'click', closeHelpModal);
                        bind(helpTemplateCsvBtn, 'click', downloadCSVTemplate);
                        bind(helpTemplateJsonBtn, 'click', downloadJSONTemplate);
                        if (helpModal) helpModal.addEventListener('click', (e) => { if (e.target === helpModal) closeHelpModal(); });
        
                        // 管理菜单
                        bind(manageBtn, 'click', (e) => {
                            e.stopPropagation();
                            const open = manageMenu.classList.toggle('open');
                            manageBtn.setAttribute('aria-expanded', String(open));
                        });
                        document.addEventListener('click', closeManageMenu);
                        bind(menuResetBtn, 'click', () => { closeManageMenu(); resetBtn.click(); });
        
                        // V3.3: 答题模式切换
                        bind(modeSeg, 'click', (e) => {
                            const btn = e.target.closest('.seg-btn');
                            if (btn && btn.dataset.mode) switchMode(btn.dataset.mode);
                        });
        
                        // 重置 (V3.3: 改用项目内确认 Modal)
                        bind(resetBtn, 'click', async function() {
                            const ok = await askConfirm({
                                title: '重置进度',
                                msg: '将清空当前试卷的答题进度与判定结果，确定吗？',
                                okText: '重置',
                                danger: true
                            });
                            if (!ok) return;
                            clearStorage();
                            // 重置进度 = 保留当前试卷，仅清答案/判定/计时（重新作答本卷）；不回退到空状态。
                            userAnswers = {};
                            feedbackMap = {};
                            clearAllJudges();
                            lastSegHtml = '';
                            lastGridHtml = '';
                            isSubmitted = false;
                            currentIndex = 0;
                            resetTimerState();
                            updateSubmitLabel();
                            renderAll();           // 试卷仍在，直接进入可重新作答状态
                            closeResultModal();
                        });
                    }
        
                    // 结果 Modal 关闭 (考生端保留：按钮 + 点击遮罩)
                    resultCloseBtn.addEventListener('click', closeResultModal);
                    resultModal.addEventListener('click', (e) => { if (e.target === resultModal) closeResultModal(); });
        
                    // V3.5: 作答回顾 + 只练错题 (管理端/考生端均保留，考生端不依赖管理元素)
                    bind(reviewBtn, 'click', openReview);
                    bind(resultReviewBtn, 'click', () => { closeResultModal(); openReview(); });
                    bind(reviewCloseBtn, 'click', closeReview);
                    if (reviewModal) {
                        reviewModal.addEventListener('click', (e) => { if (e.target === reviewModal) closeReview(); });
                    }
                    bind(reviewSeg, 'click', (e) => {
                        const btn = e.target.closest('.seg-btn');
                        if (btn && btn.dataset.filter) switchReviewFilter(btn.dataset.filter);
                    });
                    bind(reviewRetryBtn, 'click', retryWrongQuestions);
                    // 底部导航「返回原卷」(错题重练会话常驻，唯一入口)
                    bind(reviewBackNavBtn, 'click', backToOriginalExam);
                    // 回顾面板内点击条目可跳题，回车/空格触达等价
                    bind(reviewList, 'keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            const item = e.target.closest('.review-item');
                            if (item) { e.preventDefault(); item.click(); }
                        }
                    });
        
                    // 分段进度条点击跳题 (事件委托)
                    progressSegments.addEventListener('click', (e) => {
                        const seg = e.target.closest('.progress-seg');
                        if (seg) {
                            const idx = parseInt(seg.dataset.seg);
                            if (!isNaN(idx)) goToQuestion(idx);
                        }
                    });
        
                    // V3.1: 明暗主题切换 + 版本号
                    initTheme();
                    themeBtn.addEventListener('click', toggleTheme);
        
                    // 计时器隐藏切换
                    timerToggle.addEventListener('click', toggleTimerVisibility);
                });
        
                // 当窗口变化时，修正滑动位置
                let resizeTimer;
                window.addEventListener('resize', function() {
                    clearTimeout(resizeTimer);
                    resizeTimer = setTimeout(() => {
                        if (examData) goToQuestion(currentIndex, false);
                    }, 100);
                });
        
                // 页面卸载前，flush 防抖中未写入的备份
                window.addEventListener('beforeunload', function() {
                    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
                    if (savePending) saveToStorage();
                });
