/**
 * check-excel2sql-ui.mjs —— excel2sql 前端工具的「接线」校验（DOM 桩）
 *
 * 与 check-excel2sql.mjs 的分工：
 *   check-excel2sql.mjs   纯逻辑（解析 / 表头 / 类型 / 渲染），不需要 DOM
 *   本脚本                 界面装配：index.html 的 id 与 app.js 对得上吗？
 *                         事件真挂上了吗？点下去用户真能拿到东西吗？
 *
 * 为什么非要有这一层：逻辑全绿 + 界面一抛异常 = 用户看到的是白屏或「点了没反应」。
 * 纯函数测试对这条路径**完全无感**。
 *
 * 用法：node tools/_build/check-excel2sql-ui.mjs
 * 依赖：无（只用 Node 内建模块 + 工具自身的 .js + 一个记账式 DOM 桩）
 *
 * 桩的四条纪律（照 code-workspace/tests/wiring.mjs 的结论来）：
 *   1. getElementById 的注册表**从 index.html 的 id 预填**（含 hidden 属性），
 *      查不到就返回 null —— 于是「app.js 用到的 id 是否真实存在」变成一条免费断言；
 *   2. textContent 忠实建模（节点序列拼接，appendChild 不顶掉已有文本），
 *      否则「文本到底写没写进去」会假阴；
 *   3. 桩要留**可控的失败开关**（execCommand / clipboard），
 *      否则 execCommand 返回 false 那条降级分支永远走不到；
 *   4. 用到的 DOM 方法一个都不能缺 —— insertBefore / firstChild 这种"顺手就写"
 *      的 API 缺了会直接抛 TypeError，而报错点离根因很远。
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT_ARG = process.argv.slice(2).find((a) => !a.startsWith('--'));
const WB = resolve(ROOT_ARG || join(HERE, '..', '..'));       /* web-toolbox 根 */
const TOOL = join(WB, 'tools', 'excel2sql');
const JS = join(TOOL, 'js');

/* ==================================================================
 * 一、记账式 DOM 桩
 * ================================================================== */

const listeners = new Map();     /* id/document → Set(eventType) */
const docListeners = new Map();
const winListeners = new Map();
const missIds = [];              /* app.js 查了但 index.html 里没有的 id */
const registry = new Map();
const created = [];              /* 所有 createElement 出来的节点（含 tagName） */
const execCalls = [];
const errors = [];
const pendingTimers = [];

let execOk = true;               /* 降级分支的可控开关 */

function makeEl(id, tag) {
  const el = {
    id: id,
    tagName: String(tag || 'div').toUpperCase(),
    style: {}, dataset: {}, hidden: false, value: '',
    checked: false, disabled: false, title: '', innerHTML: '', placeholder: '',
    href: '', download: '', rel: '', files: null,
    /* ★ 文本与子节点放在**同一个序列**里 —— 真实 DOM 的 textContent 是
       「所有后代文本节点」的拼接，appendChild 不会顶掉已有文本。
       拆成两个字段会让「先给文本、再追加子节点」的代码在桩里表现不对，
       那时红的是桩而不是产品。 */
    _nodes: [],
    _a: {}, _h: {}, _parent: null,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } }
    },
    addEventListener(type, fn) {
      const key = (this === globalThis.document) ? 'document' : id;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(type);
      if (key === 'document') docListeners.set(type, fn);
      this._h[type] = fn;        /* 按**对象**再存一份：createElement 出来的 id 全一样 */
    },
    removeEventListener() {},
    setAttribute(k, v) { this._a[k] = String(v); },
    getAttribute(k) { return this._a[k] != null ? this._a[k] : null; },
    appendChild(n) { return this.insertBefore(n, null); },
    insertBefore(n, ref) {
      const i = ref ? this._nodes.indexOf(ref) : -1;
      if (i < 0) this._nodes.push(n); else this._nodes.splice(i, 0, n);
      if (n && typeof n === 'object') n._parent = this;
      return n;
    },
    removeChild(n) { const i = this._nodes.indexOf(n); if (i >= 0) this._nodes.splice(i, 1); return n; },
    remove() { if (this._parent) this._parent.removeChild(this); },
    click() { this._clicked = (this._clicked || 0) + 1; if (this._h.click) this._h.click({ stopPropagation() {} }); },
    select() { this._selected = true; },
    setSelectionRange() {},
    focus() {}, blur() {}, scrollIntoView() {},
    getBoundingClientRect() { return { width: 100, height: 100, top: 0, left: 0 }; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    contains() { return false; },
    get parentNode() { return this._parent; },
    get firstChild() { return this._nodes.length ? this._nodes[0] : null; },
    get childNodes() { return this._nodes.filter((n) => n && typeof n === 'object'); },
    get children() { return this.childNodes; }
  };
  Object.defineProperty(el, 'textContent', {
    get() { return this._nodes.map((n) => (typeof n === 'string' ? n : (n.textContent == null ? '' : n.textContent))).join(''); },
    set(v) { this._nodes = v == null ? [] : [String(v)]; }
  });
  /* 真实 DOM 里 className 与 classList 是联动的；不联动会让
     「断言 className」与「断言 classList」得到相反的结论 */
  Object.defineProperty(el, 'className', {
    get() { return [...this.classList._s].join(' '); },
    set(v) { this.classList._s = new Set(String(v == null ? '' : v).split(/\s+/).filter(Boolean)); }
  });
  return el;
}

const byId = (id) => {
  if (!registry.has(id)) { missIds.push(id); return null; }
  return registry.get(id);
};

const HTML = readFileSync(join(TOOL, 'index.html'), 'utf8');
/* ★ 剥掉 HTML 注释后的源码，供"某个名字/元素已经不存在了"这类断言使用。
   和 CSS 契约断言要先剥注释完全同源：注释里为说明历史决策而写的旧名字
   （例如那段解释"为什么改成页签"的注释里还留着「表头预览」），
   会让 `!has(HTML, …)` 恒假 —— 读起来像"改名没改干净"，其实只是注释。 */
const HTML_NO_COMMENT = HTML.replace(/<!--[\s\S]*?-->/g, '');

/** ★ 注册表从真实 HTML 预填：id 抄错 → byId 返回 null → 接线静默失败的守卫 */
function prefilledRegistry(html) {
  const ids = [];
  /* 连 tagName 一起带出来。桩里一律给 'div' 的话，「这个控件是原生 <select>」
     这类断言永远为假 —— 而它守的正是"别再退回平铺分段按钮"这条改版结论。 */
  for (const t of html.matchAll(/<([a-zA-Z][\w-]*)([^>]*?)\bid="([^"]+)"([^>]*?)\/?>/g)) {
    const el = makeEl(t[3], t[1]);
    /* 把 HTML 上的 hidden 属性搬进桩。不搬的话「初始隐藏」那几条断言
       其实是桩的默认值在过关，与 HTML 无关 —— 恒真的假守卫。 */
    if (/\shidden(\s|\/|>)/.test(t[0])) el.hidden = true;
    registry.set(t[3], el);
    ids.push(t[3]);
  }
  /* 兜底：属性换行等写法没被上面覆盖到的 id 仍要注册，否则 byId 会误报"拼写错" */
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
    if (!registry.has(m[1])) { registry.set(m[1], makeEl(m[1])); ids.push(m[1]); }
  }
  return ids;
}
const HTML_IDS = prefilledRegistry(HTML);

/* ---- 宿主全局 ---- */

const realSetTimeout = globalThis.setTimeout;
/* app.js 里的 toast 自动消失(2.4s)与 revokeObjectURL(10s) 会把事件循环拖住 10 秒。
   既不改时长（会篡改行为、让时序断言失真），也不 process.exit（可能截断 stdout）：
   记账下来，收尾时统一 clear。 */
globalThis.setTimeout = (fn, ms, ...a) => {
  const t = realSetTimeout(fn, ms, ...a);
  pendingTimers.push(t);
  return t;
};

globalThis.document = Object.assign(makeEl('document', 'document'), {
  getElementById: byId,
  createElement: (tag) => { const e = makeEl('(created)', tag); created.push(e); return e; },
  createElementNS: (_ns, tag) => { const e = makeEl('(created)', tag); created.push(e); return e; },
  createTextNode: (s) => { const t = makeEl('(text)', '#text'); t.textContent = s == null ? '' : String(s); return t; },
  documentElement: makeEl('html', 'html'),
  body: makeEl('body', 'body'),
  head: makeEl('head', 'head'),
  activeElement: null,
  execCommand(cmd) { execCalls.push(cmd); return execOk; }
});
globalThis.document.documentElement.setAttribute('data-theme', 'light');

globalThis.window = {
  isSecureContext: true,
  addEventListener(type, fn) {
    if (!winListeners.has(type)) winListeners.set(type, new Set());
    winListeners.get(type).add(fn);
  },
  removeEventListener() {},
  matchMedia: () => ({ matches: false })
};
globalThis.window.self = globalThis.window;
globalThis.window.top = globalThis.window;

globalThis.localStorage = {
  _s: new Map(),
  getItem(k) { return this._s.has(k) ? this._s.get(k) : null; },
  setItem(k, v) { this._s.set(k, String(v)); },
  removeItem(k) { this._s.delete(k); }
};
/* 刻意**不给** navigator.clipboard：本机 Node 没有它，正好覆盖 execCommand 降级分支 */

globalThis.requestAnimationFrame = (fn) => realSetTimeout(fn, 0);

/* Blob 用真的（sqlgen 的 byteLengthUtf8 要靠它拿准确字节数），
   只把 URL.createObjectURL 换掉，以便截获下载内容做逐字节核对 */
const downloads = [];
globalThis.URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:fake/' + downloads.length; };
globalThis.URL.revokeObjectURL = () => {};

const NODE_NOISE = /^\(node:\d+\)|Warning:|ExperimentalWarning|DeprecationWarning/;
process.on('warning', () => {});
/* ★★ 劫持 console.error 之前先留一份**没被劫持的**引用。
   否则连"自检自己崩了"这条致命错误也会被收进 errors 数组、永不打印 ——
   现场表现是「rc=1、输出在一半突然断掉、stderr 空」，看着像被谁 kill 了，
   而真正的原因（比如断言里读了已删除元素的 .textContent）一个字都看不到。
   真踩到：这一版把 headerHint 搬进抽屉后忘了同步断言，自检就静默死了。
   下面 main().catch 必须用 realConsoleError，不能用 console.error。 */
const realConsoleError = console.error.bind(console);
console.error = (...a) => { errors.push(a.map(String).join(' ')); };
process.on('unhandledRejection', (r) => errors.push('unhandledRejection: ' + (r && r.stack ? r.stack : r)));
const realErrors = () => errors.filter((e) => !NODE_NOISE.test(e));

/* ==================================================================
 * 二、断言小工具
 * ================================================================== */

let pass = 0, fail = 0;
function section(name) { console.log('\n' + name); console.log('-'.repeat(Math.max(24, name.length))); }
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (extra ? '\n        → ' + extra : '')); }
};
const has = (hay, needle) => String(hay).indexOf(needle) >= 0;

const kids = (el) => (el ? el.childNodes : []);
function allDesc(el, out) {
  out = out || [];
  for (const n of kids(el)) { out.push(n); allDesc(n, out); }
  return out;
}
const findCls = (el, cls) => allDesc(el).find((n) => has(n.className, cls)) || null;
const findTag = (el, tag) => allDesc(el).find((n) => n.tagName === tag) || null;
const findByText = (el, t) => allDesc(el).find((n) => n.textContent === t) || null;
/* ★ 动作按钮必须按 tagName 找：包裹它的 .esq-notice-act 容器 textContent 与按钮
   完全相同，findByText 会先命中那个**没有 click 处理器**的 div —— 断言「有按钮」
   照样通过，点下去却什么也没发生。这是被真跑一遍才暴露出来的假守卫。 */
const findButton = (el, t) => allDesc(el).find((n) => n.tagName === 'BUTTON' && n.textContent === t) || null;
/* ★ 两种入参都接受：元素（读它的 textContent）或**已经取好的字符串**。
   只认元素的话，把 `hasText(byId('x'), …)` 换成 `hasText(someText(), …)` 会静默变成
   `hasText(undefined, …)` → 读到 "undefined" → 断言恒假（不是恒真，但一样是"测试自己在骗人"）。
   这一版把两处断言的载体从状态栏换成抽屉文本时就踩到了。 */
const hasText = (el, t) => has(typeof el === 'string' ? el : (el ? String(el.textContent) : ''), t);

const fireClick = (el) => { if (el && el._h.click) { el._h.click({ stopPropagation() {}, preventDefault() {} }); return true; } return false; };
const fireChange = (el) => { if (el && el._h.change) { el._h.change({ target: el }); return true; } return false; };
const fireInput = (el) => { if (el && el._h.input) { el._h.input({ target: el }); return true; } return false; };
const fireBlur = (el) => { if (el && el._h.blur) { el._h.blur({ target: el }); return true; } return false; };
const tick = (ms = 40) => new Promise((r) => realSetTimeout(r, ms));
/* 自动生成的防抖窗口是 350ms，之后 generate() 自己还有一次 setTimeout 让帧。
   凡是"改完设置等它自动重算"的地方都等这个值。 */
const AUTO_WAIT = 420;
/* 「防抖窗口内先不算」那条断言要的是一个**能区分**的观测量：generate() 是 async，
   得先让出一个 macrotask 它才会走到渲染。AUTO_PROBE 取 60ms —— 大于 0（够 flush
   setTimeout(0)），远小于防抖窗口 350ms，所以「立刻算」的变异在这个点上就会露出来。 */
const AUTO_PROBE = 60;
/* 下拉/输入框改成 select 之后，"选一个值"变成两步：写 value + 触发 change */
const pick = (sel, val) => { sel.value = val; fireChange(sel); };

/* 产物预览现在是真的 DOM 节点（app.js 的 renderTokens），
   所以直接读 textContent 就是**渲染出来的文本**，不必反解析 innerHTML */
const previewSql = () => byId('resultCode').textContent;
/* 改版后「表头为什么落这一行」与「产物的编码约定」都搬进了「详情」抽屉 ——
   它们以前分别在状态栏和产物区下方各占一行，和抽屉里的内容本来就是同一件事。
   于是"表头理由""编码约定""逐列类型"这些断言的载体统一改成这个。 */
const detailsText = () => byId('detailsBody').textContent;
const firstSelect = (s) => String(s).split('\n').find((l) => l.indexOf('SELECT') >= 0) || '';
const downloadedSql = async (i) => (downloads[i] ? await downloads[i].text() : null);

const makeFile = (name, bytes) => ({
  name: name,
  size: bytes.length,
  async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
});
const enc = (s) => new TextEncoder().encode(s);
const anchorsOf = () => created.filter((n) => n.tagName === 'A');

/* ==================================================================
 * 三、主流程
 * ================================================================== */

async function main() {
  /* ---------------------------------------------------------------
   * [1] 加载脚本：接线到底通没通
   * ------------------------------------------------------------- */
  section('1. 加载全部脚本（捕获加载期异常）');
  const order = ['theme.js', 'utils.js', 'dialects.js', 'headers.js', 'reader.js', 'sqlgen.js', 'app.js'];
  const src = order.map((f) => '/* ==== ' + f + ' ==== */\n' + readFileSync(join(JS, f), 'utf8')).join('\n;\n');

  let loadError = null;
  try {
    /* 全部拼进同一个函数体：各文件的顶层 const 落在同一个作用域，
       app.js 的 IIFE 因此能看见 E2sUtils 等命名空间（等价于 index.html 的 script 串联） */
    new Function(src)();
  } catch (e) { loadError = e; }
  ok('7 个脚本顺序加载无异常', !loadError, loadError && loadError.stack);
  ok('加载期没有 console.error', realErrors().length === 0, realErrors().join(' | '));

  /* ★ 免费断言：注册表从 index.html 预填、查不到返回 null，
     于是「app.js 的 $('id') 有没有打错」被自动守住 */
  ok('app.js 引用的 id 都在 index.html 里（共 ' + HTML_IDS.length + ' 个 id，无拼写错）',
    missIds.length === 0, '查不到的 id：' + [...new Set(missIds)].join(', '));

  /* ---------------------------------------------------------------
   * [2] 事件真的挂上了（挂不上 = 点了没反应）
   * ------------------------------------------------------------- */
  section('2. 事件绑定');
  const expectBind = [
    ['dropZone', 'click'], ['dropZone', 'keydown'], ['dropZone', 'dragenter'],
    ['dropZone', 'dragover'], ['dropZone', 'dragleave'], ['dropZone', 'drop'],
    ['fileInput', 'change'], ['btnSample', 'click'], ['sheetSelect', 'change'],
    ['tableInput', 'input'], ['tableInput', 'blur'],
    ['batchInput', 'input'], ['batchInput', 'blur'],
    ['optEmptyNull', 'change'], ['optInferTypes', 'change'], ['optLegacyDate', 'change'],
    ['btnGenerate', 'click'], ['btnCopy', 'click'], ['btnDownload', 'click'],
    ['btnTips', 'click'], ['btnCloseModal', 'click'], ['btnCloseModalX', 'click'],
    ['tipModal', 'click'], ['themeToggle', 'click'],
    ['btnReselect', 'click'], ['btnDetails', 'click'],
    ['btnCloseDetails', 'click'], ['btnCloseDetailsX', 'click'], ['detailsDrawer', 'click']
  ];
  const notBound = expectBind
    .filter(([id, type]) => !(listeners.get(id) || new Set()).has(type))
    .map(([id, type]) => id + ':' + type);
  ok(expectBind.length + ' 处事件绑定齐全', notBound.length === 0, '缺：' + notBound.join(', '));
  ok('Escape 关闭弹窗挂在 document 上', docListeners.has('keydown'));
  ok('全局监听没有滥用（app.js 不该往 window 上挂东西）', winListeners.size === 0,
    [...winListeners.keys()].join(', '));

  /* ---------------------------------------------------------------
   * [3] 启动态
   * ------------------------------------------------------------- */
  section('3. 启动后的初始态');
  ok('空态卡可见', byId('emptyCard').hidden === false);
  /* ★ 选对载体：改版后「表头预览」与「SQL 产物」都住在 workState 内部，
     空态时该断言的是**整个工作态**不可见。继续断言那两个 panel 各自的 hidden
     会变成恒真（HTML 里本就没给它们加 hidden），是一条假守卫。 */
  ok('工作态初始隐藏（数据预览 / SQL 产物 / 状态栏都在它里面）', byId('workState').hidden === true);
  /* ★ 只断言"占位层可见"这个结构事实。桩不解析 HTML 文本，
     占位层里那句「配置好左侧选项后点生成 SQL」读出来永远是空串 ——
     文案由 [18] 的静态契约层直接读源文件来守。 */
  ok('产物区初始显示占位提示（不是空白面板）', byId('resultPlaceholder').hidden === false);
  ok('复制 / 下载初始禁用（还没有产物可拿）',
    byId('btnCopy').disabled === true && byId('btnDownload').disabled === true);
  ok('「详情」按钮初始隐藏（没有数据源就没有识别详情）', byId('btnDetails').hidden === true);
  ok('生成按钮初始禁用（没有数据源）', byId('btnGenerate').disabled === true);
  /* ★ 右侧是「SQL 产物 / 表头预览」两个页签分时复用整列空间。
     早前两块上下各占一半：SQL 只有 79px（约 4 行）、表头 159px，都读不了。
     真机实测合页签后 SQL 拿到 523px（26 行）、表头 543px。 */
  ok('右侧默认停在「SQL 产物」页签（表头那页收起）',
    byId('resultCard').hidden === false && byId('headerCard').hidden === true);
  ok('产物统计初始隐藏（还没有产物）', byId('sqlStats').hidden === true);
  ok('生成状态位初始隐藏（没有正在跑的任务）', byId('genState').hidden === true);
  ok('「⋯」菜单初始收起', byId('moreMenu').hidden === true);
  ok('表头页签的提示圆点初始不显示', byId('tabHeaderDot').hidden === true);
  ok('工作表下拉初始隐藏', byId('sheetWrap').hidden === true);
  ok('CSV 专属开关初始隐藏', byId('inferWrap').hidden === true);
  ok('空态徽章渲染了 4 个', kids(byId('emptyFeatures')).length === 4,
    '实际 ' + kids(byId('emptyFeatures')).length);
  ok('环境告警为空（Node 有 DecompressionStream）',
    kids(byId('envNotice')).length === 0,
    byId('envNotice').textContent);

  /* ---------------------------------------------------------------
   * [4] 加载示例数据 -> 表头自动识别
   * ------------------------------------------------------------- */
  section('4. 加载示例数据（第 1 行是标题，看它会不会被跳过）');
  errors.length = 0;
  const sampleClick = byId('btnSample')._h.click;
  ok('取到「加载示例数据」的 click', typeof sampleClick === 'function');
  sampleClick({ stopPropagation() {} });
  await tick();

  ok('文件行显示出来', byId('fileRow').hidden === false);
  ok('文件名正确', has(byId('fileName').textContent, '示例-门店销售明细.xlsx'), byId('fileName').textContent);
  ok('文件行标了「示例数据」', has(byId('fileMeta').textContent, '示例数据'), byId('fileMeta').textContent);
  ok('单工作表时不显示下拉', byId('sheetWrap').hidden === true);
  ok('工作态登场、空态卡退场',
    byId('workState').hidden === false && byId('emptyCard').hidden === true);
  ok('生成按钮解锁', byId('btnGenerate').disabled === false);

  /* ★ 这里刻意加了一条否定判据：识别落到"保守取第 1 行"那一支时，说明文本里
     也会出现「第 2 行」（它在解释为什么没选第 2 行）—— 只查"含第 2 行"的断言
     在两支下都成立，是个假守卫。 */
  ok('自动识别说明写在第 2 行（跳过了标题行）',
    hasText(detailsText(), '第 2 行') && !hasText(detailsText(), '保守取第 1 行'),
    detailsText());
  ok('提示了「第 1 行会整行跳过」', hasText(byId('headerNotice'), '整行跳过'),
    byId('headerNotice').textContent);
  ok('提示里给了「用第 1 行做表头」的动作入口',
    !!findButton(byId('headerNotice'), '用第 1 行做表头'), byId('headerNotice').textContent);

  const table = findTag(byId('headerPicker'), 'TABLE');
  ok('渲染出了表头选择表', !!table);
  const rowsNow = () => kids(findTag(byId('headerPicker'), 'TBODY'));
  const trs = rowsNow();
  ok('示例 9 行全部渲染（1 标题 + 1 表头 + 7 数据）', trs.length === 9, '实际 ' + trs.length);
  ok('第 2 行被标成表头（is-head）', has(trs[1].className, 'is-head'), trs[1].className);
  ok('第 1 行被标成跳过（is-skipped）', has(trs[0].className, 'is-skipped'), trs[0].className);
  ok('数据行没有多余标记', trs[2].className === '', '"' + trs[2].className + '"');

  const headerTr = kids(findTag(table, 'THEAD'))[0];
  ok('列头 = 行号列 + A..J（11 格）', kids(headerTr).length === 11, '实际 ' + kids(headerTr).length);
  ok('列头第一个是「行」', kids(headerTr)[0].textContent === '行');
  ok('第 11 列列头是 J', kids(headerTr)[10].textContent === 'J', kids(headerTr)[10].textContent);

  /* 数据行 trs[2] 对应示例第 1 行数据；格子 0 是行号，1..10 是 A..J */
  const c = kids(trs[2]);
  ok('★ 超长订单号按原文渲染（没被双精度改写成 ...992）',
    c[9] && c[9].textContent === '9007199254740993', c[9] && c[9].textContent);
  ok('前导零条码保持 0071234', c[8] && c[8].textContent === '0071234', c[8] && c[8].textContent);
  ok('多行文本在预览里保留换行',
    c[10] && c[10].textContent === '常温堆头\n买二赠一', JSON.stringify(c[10] && c[10].textContent));
  ok('空单元格渲染成空串（不是 "null"/"undefined"）',
    kids(trs[3])[10] && kids(trs[3])[10].textContent === '',
    JSON.stringify(kids(trs[3])[10] && kids(trs[3])[10].textContent));
  ok('悬停提示写明单元格类型',
    has(c[9].title, '超长数字') && has(c[1].title, '文本'),
    c[9].title + ' / ' + c[1].title);

  /* ---------------------------------------------------------------
   * [5] 生成 SQL（默认 SQL Server + UNION ALL + WITH 包裹）
   * ------------------------------------------------------------- */
  section('5. 生成 SQL（SQL Server / UNION ALL / WITH 包裹）');
  errors.length = 0;
  fireClick(byId('btnGenerate'));
  await tick();

  ok('产物占位提示退场（真产物上屏）', byId('resultPlaceholder').hidden === true);
  ok('生成路径无未捕获异常', realErrors().length === 0, realErrors().join(' | '));
  ok('数据行数 = 7', byId('statRows').textContent === '7', byId('statRows').textContent);
  ok('列数 = 10', byId('statCols').textContent === '10', byId('statCols').textContent);
  ok('产物大小非 0', /[1-9]/.test(byId('statSize').textContent), byId('statSize').textContent);
  ok('耗时已回填', /(ms|s)$/.test(byId('statTime').textContent), byId('statTime').textContent);
  /* ★ 以前这几个数字占着产物卡头部的一整行 chip，而「产物大小」与下方小字逐字重复、
     「行数列数耗时」在详情抽屉里也有 —— 同一屏里说三遍。
     现在收进状态栏一段（腾出的位置给了复制/下载），并补上真正缺的那个数字：
     SQL 总行数（它以前只藏在产物下方的小字里，而它才是决定"要看多久"的量）。 */
  ok('产物统计段随产物出现', byId('sqlStats').hidden === false);
  ok('★ 常显 SQL 总行数（以前只藏在下方小字里）',
    Number(byId('statSqlLines').textContent) > 0, byId('statSqlLines').textContent);
  ok('★ 提示条不再重复统计数字（同一屏不说两遍）',
    !/\d+\s*行\s*\/\s*[\d.]+\s*(KB|B)/.test(detailsText()), detailsText());
  ok('生成完成后状态栏闪出耗时反馈',
    hasText(byId('genState'), '已生成') && byId('genState').hidden === false,
    byId('genState').textContent);

  const sql = previewSql();
  ok('头注释写了行数 x 列数', has(sql, '-- 由 excel2sql 生成：7 行 x 10 列'));
  ok('头注释写了方言与格式', has(sql, '方言：SQL Server') && has(sql, '输出格式：union'));
  ok('WITH 包裹（SQL Server 用方括号）', has(sql, 'WITH [HARDCODE] AS ('));
  ok('结尾 SELECT * FROM', has(sql, 'SELECT * FROM [HARDCODE];'));
  ok('UNION ALL 独立成行（Oracle 语法错的老坑）', has(sql, '\nUNION ALL\n'));
  ok('列名带 AS 别名且被引用', has(sql, 'AS [门店]') && has(sql, 'AS [订单号]'));
  ok('数字列不加引号', has(sql, '120 AS [销量]'), firstSelect(sql));
  ok('文本列加 N 前缀与引号', has(sql, "N'东城店' AS [门店]"));
  ok('★ 纯日期按命令行版行为输出 00:00:00',
    has(sql, "N'2026-03-01 00:00:00' AS [销售日期]"), firstSelect(sql));
  ok('超长订单号按文本输出（带引号）', has(sql, "'9007199254740993' AS [订单号]"));
  ok('前导零条码按文本输出', has(sql, "'0071234' AS [条码]"));
  ok('多行文本按 CHAR(10) 拼接', has(sql, "N'常温堆头' + CHAR(10) + N'买二赠一'"));
  ok('空备注写 NULL', has(sql, 'NULL AS [备注]'));
  ok('注释里提醒了不要直接用于生产导入', has(sql, '请勿直接用于生产批量导入'));

  /* ★ 载体换了：改版后「表头理由 + 逐列类型 + 耗时」都收进「详情」抽屉 ——
     它们常驻在产物卡上会一直占屏，把真正要读的 SQL 挤下去。
     这几条断言因此改读 detailsBody。继续读 resultNotice 会永远为假，
     那不是"没提示"，是读错了地方（选错载体）。
     注意 detailsBody 是**每次渲染就重算**的，不必先打开抽屉。 */
  const details = () => byId('detailsBody').textContent;
  ok('「整列按字符串输出」的分档写进详情', hasText(byId('detailsBody'), '整列按字符串输出'));
  ok('超长数字列的原因单独说明（不是笼统的"文本"）',
    hasText(byId('detailsBody'), '精度丢失'), details().slice(0, 220));
  ok('表头识别理由带上了「跳过前 N 行」', hasText(byId('detailsBody'), '跳过前 1 行'), details().slice(0, 220));
  ok('详情里写明了预处理 / 渲染耗时',
    hasText(byId('detailsBody'), '预处理') && hasText(byId('detailsBody'), '渲染'));
  ok('★ 逐列类型明细不再常驻产物卡（否则会一直占屏）',
    !hasText(byId('resultNotice'), '整列按字符串输出'), byId('resultNotice').textContent.slice(0, 200));
  ok('提示条说明产物编码与换行',
    hasText(detailsText(), 'UTF-8') && hasText(detailsText(), 'LF'),
    detailsText());

  /* ---------------------------------------------------------------
   * [5b] 状态栏与详情抽屉 —— 零碎信息改版后的落点
   * ------------------------------------------------------------- */
  section('5b. 状态栏摘要与详情抽屉');
  /* ★★ 改版后「表头落在第几行」不再占用状态栏那行 —— 它和抽屉里的内容是同一件事。
     所以这里改成**一正一反**两条：抽屉里必须写清楚，状态栏里必须不再重复。
     只测"抽屉里有"会漏掉"状态栏又抄了一遍"，只测"状态栏没有"会漏掉"信息被删干净了"。 */
  ok('★ 表头落点写进抽屉（含理由与跳过的行）',
    hasText(detailsText(), '自动识别选第 2 行') && hasText(detailsText(), '第 1 行整行跳过'),
    detailsText().slice(0, 120));
  /* ★★ 这条要**同时**管住"文字"和"载体"。只查文字的话，把
     `<span id="headerHint">` 塞回状态栏（哪怕暂时没人往里写）也照样绿 ——
     而那个空壳就是同类问题的入口。反向实验实测：只查文字时这条漏掉，
     只有静态的元素检查响了，也就是"红了但不是该红的那条"。 */
  ok('★ 状态栏不再重复表头落点（解释性文字只留一处）',
    !hasText(byId('statusBar'), '第 2 行') && !hasText(byId('statusBar'), '表头') &&
    !/id="headerHint"/.test(HTML_NO_COMMENT),
    byId('statusBar').textContent);
  /* ★ 条数改挂在按钮内部的独立小胶囊里（按钮的可读名保持稳定的「详情」），
     所以断言要读**真正的载体**：detailsCount 的文本 + 按钮的 aria-label。
     只读 btnDetails.textContent 是读不到的 —— DOM 桩没有 HTML 解析出来的父子树，
     那句静态的「详情」在 HTML 里、不在 JS 写的节点里。 */
  ok('「详情」按钮已出现，条数挂在独立小胶囊里',
    byId('btnDetails').hidden === false && byId('detailsCount').hidden === false &&
    /^\d+$/.test(byId('detailsCount').textContent),
    'detailsCount="' + byId('detailsCount').textContent + '"');
  ok('★ 详情条数写进了 aria-label（读屏也听得到，且标签文字保持稳定）',
    /详情（\d+ 条）/.test(String(byId('btnDetails').getAttribute('aria-label') || '')),
    String(byId('btnDetails').getAttribute('aria-label')));
  ok('★ 「详情」的静态文案在 HTML 里（JS 只往胶囊里填数字）',
    /id="btnDetails"[^>]*>\s*详情/.test(HTML));
  ok('抽屉初始是关的（内容已备好，只是不上屏）', byId('detailsDrawer').hidden === true);
  ok('抽屉按「表头识别 / 列输出类型 / 产物约定 / 处理耗时」四组呈现',
    ['表头识别', '列输出类型', '产物约定', '处理耗时'].every((t) => hasText(byId('detailsBody'), t)),
    details().slice(0, 160));
  /* ★ 去重也要守住：总量数字归状态栏，抽屉里不许再抄一遍。
     以前抽屉的「处理耗时」组里有"合计 X ms，产物 N 行 × M 列 / size"，
     与状态栏逐字重复 —— 用户看到的"弹出框里有重复内容"就是这个。 */
  ok('★ 抽屉不再重复状态栏的总量数字（行 × 列 / 体积 / 合计耗时）',
    !/合计\s*[\d.]+\s*(ms|s|秒)/.test(detailsText()) &&
    !/\d+\s*行\s*×\s*\d+\s*列/.test(detailsText()) &&
    !/[\d.]+\s*(KB|B)\b/.test(detailsText()),
    detailsText().slice(0, 200));
  ok('★ 产物编码约定也搬进抽屉了（原来挂在产物区下方占一整行）',
    hasText(detailsText(), 'UTF-8 无 BOM') && hasText(detailsText(), 'LF 换行'),
    detailsText().slice(-160));

  fireClick(byId('btnDetails'));
  ok('点「详情」打开抽屉', byId('detailsDrawer').hidden === false);
  fireClick(byId('btnCloseDetails'));
  ok('点「关闭」收起抽屉', byId('detailsDrawer').hidden === true);
  fireClick(byId('btnDetails'));
  fireClick(byId('btnCloseDetailsX'));
  ok('点右上角 × 收起抽屉', byId('detailsDrawer').hidden === true);
  fireClick(byId('btnDetails'));
  byId('detailsDrawer')._h.click({ target: byId('detailsDrawer') });
  ok('点遮罩收起抽屉', byId('detailsDrawer').hidden === true);
  fireClick(byId('btnDetails'));
  docListeners.get('keydown')({ key: 'Escape' });
  ok('Escape 收起抽屉', byId('detailsDrawer').hidden === true);
  docListeners.get('keydown')({ key: 'a' });
  ok('Escape 之外不误关（没有把 keydown 全吃掉）', byId('detailsDrawer').hidden === true);

  /* ---------------------------------------------------------------
   * [6] 下载：拿完整产物做逐字节核对
   * ------------------------------------------------------------- */
  section('6. 下载：产物与预览是否一致、文件名是否与命令行版同构');
  fireClick(byId('btnDownload'));
  await tick();
  const dl = await downloadedSql(0);
  ok('触发了下载', dl !== null);
  ok('文件名 = {源名}_{表名}_hardcode.sql（与命令行版 default_filename 同构）',
    anchorsOf().some((a) => a.download === '示例-门店销售明细_销售明细_hardcode.sql'),
    anchorsOf().map((a) => a.download).join(' | '));
  ok('产物没有 BOM（与命令行版 write_sql 一致）', dl && dl.charCodeAt(0) !== 0xFEFF);
  ok('产物以换行结尾', dl && dl.endsWith('\n'));
  ok('产物开头就是头注释', dl && dl.startsWith('-- 由 excel2sql 生成'));
  ok('★ 小产物：预览内容与下载产物逐字节相同（高亮没有篡改文本）',
    dl === previewSql(),
    'dl=' + JSON.stringify(dl && dl.slice(0, 60)) + ' pv=' + JSON.stringify(previewSql().slice(0, 60)));

  /* ---------------------------------------------------------------
   * [6b] 文件名安全化 —— 用**带空格的表名**才测得出（示例表名本来就安全）
   * ------------------------------------------------------------- */
  section('6b. 文件名安全化（表名里的空格不能原样带进文件名）');
  byId('fileInput').files = [makeFile('订单 明细 2026年3月.csv', enc('a,b\n1,2\n'))];
  fireChange(byId('fileInput'));
  await tick(80);
  const anchorsBefore = anchorsOf().length;
  fireClick(byId('btnGenerate'));
  await tick();
  fireClick(byId('btnDownload'));
  await tick();
  const dlAnchor = anchorsOf()[anchorsBefore];
  ok('生成了新的下载文件名', !!dlAnchor && !!dlAnchor.download, dlAnchor && dlAnchor.download);
  /* 源文件主干按命令行版一样原样保留（那是用户自己的文件名），
     而**表名**部分必须走 safeFileStem —— 不带安全化时会带出空格 */
  ok('★ 文件名里的表名部分被安全化（空格 -> 下划线）',
    dlAnchor && has(dlAnchor.download, '订单_明细_2026年3月_hardcode.sql'),
    dlAnchor && dlAnchor.download);

  /* 回到示例数据，保证后面几节的前提不变 */
  byId('btnSample')._h.click({ stopPropagation() {} });
  await tick(80);
  ok('重新载入示例后回到第 2 行表头',
    hasText(detailsText(), '第 2 行') && !hasText(detailsText(), '保守取第 1 行'),
    detailsText());

  /* ---------------------------------------------------------------
   * [7] 换方言 -> Oracle
   * ------------------------------------------------------------- */
  section('7. 切到 Oracle（TO_DATE / FROM dual / CHR(10) / ||）');
  /* 先产出一份，才有"改设置 → 旧产物过期"这件事可谈 */
  fireClick(byId('btnGenerate'));
  await tick();

  const diaSel = byId('dialectSelect');
  ok('方言是原生下拉（不再是平铺的分段按钮）', diaSel.tagName === 'SELECT', diaSel.tagName);
  /* ★ 载体换了：改设置不再挂一条「产物已过期，点这里重新生成」的黄条 ——
     那套东西的**全部前提**就是"要手点才更新"。现在防抖 350ms 自动重算，
     所以这里等它算完，直接验证产物真的变了。 */
  pick(diaSel, 'oracle');
  ok('下拉选中值跟着设置走', diaSel.value === 'oracle', diaSel.value);
  await tick(AUTO_WAIT);
  ok('★ 改方言后自动重算（不再需要手点「生成 SQL」）',
    has(byId('resultCode').textContent, 'WITH "HARDCODE" AS ('), previewSql().split('\n')[0]);
  ok('自动重算不再挂「设置已变更」黄条（那套提示随手动按钮一起退役）',
    !hasText(byId('resultNotice'), '设置已变更'), byId('resultNotice').textContent.slice(0, 90));

  const oraSql = previewSql();
  ok('标识符改用双引号', has(oraSql, 'WITH "HARDCODE" AS ('));
  ok('每条 SELECT 补上 FROM dual', has(oraSql, ' FROM dual'));
  ok('★ 日期走 TO_DATE（格式串与 Python 版一致）',
    has(oraSql, "TO_DATE('2026-03-01 00:00:00','YYYY-MM-DD HH24:MI:SS')"), firstSelect(oraSql));
  ok('多行文本用 CHR(10) 与 || 拼接', has(oraSql, "'常温堆头' || CHR(10) || '买二赠一'"));
  ok('方言说明写进提示', hasText(detailsText(), 'FROM dual'), detailsText());

  /* ---------------------------------------------------------------
   * [7b] 裸 SELECT（wrap=plain）
   * 默认走的是 WITH 包裹，这一支**必须显式点一次**才覆盖得到 ——
   * 反向实验里"把 UNION ALL 的换行去掉"注入到这支上却零报红，才发现是盲区。
   * ------------------------------------------------------------- */
  section('7b. 裸 SELECT 包裹方式（wrap=plain）');
  const wrapSel = byId('wrapSelect');
  pick(wrapSel, 'plain');
  await tick(AUTO_WAIT);
  const plainSql = previewSql();
  ok('没有 WITH 包裹', !has(plainSql, 'WITH '), plainSql.split('\n')[5]);
  ok('没有收尾的 SELECT * FROM', !has(plainSql, 'SELECT * FROM'));
  ok('★ UNION ALL 仍独立成行（否则 Oracle 会拼出 FROM dualUNION ALL）',
    has(plainSql, '\nUNION ALL\n'), plainSql.split('\n')[5]);
  ok('每条 SELECT 仍以 FROM dual 收尾', has(plainSql, ' FROM dual\n'), plainSql.split('\n')[5]);
  pick(wrapSel, 'cte');
  await tick(AUTO_WAIT);
  ok('切回 WITH 包裹后恢复', has(previewSql(), 'WITH "HARDCODE" AS ('));

  /* ---------------------------------------------------------------
   * [8] 日期兼容模式开关 —— 用户点名要的那个开关
   * ------------------------------------------------------------- */
  section('8. 日期兼容模式开关（默认对齐命令行版；关掉后按单元格格式精确判定）');
  const legacy = byId('optLegacyDate');
  ok('开关默认是「开」（对齐命令行版）', legacy.checked === true);
  legacy.checked = false;
  fireChange(legacy);
  fireClick(byId('btnGenerate'));
  await tick();
  const dateOff = previewSql();
  const dateCalls = (dateOff.match(/TO_DATE\([^)]*\)/g) || []);
  ok('★ 关闭后纯日期不带时间',
    has(dateOff, "TO_DATE('2026-03-01','YYYY-MM-DD')"), dateCalls.slice(0, 2).join(' / '));
  ok('关闭后不再出现 00:00:00', !has(dateOff, '00:00:00'), dateCalls.join(' / '));

  legacy.checked = true;
  fireChange(legacy);
  fireClick(byId('btnGenerate'));
  await tick();
  ok('重新打开后恢复 00:00:00', has(previewSql(), '2026-03-01 00:00:00'));

  /* ---------------------------------------------------------------
   * [9] 换 MySQL
   * ------------------------------------------------------------- */
  section('9. 切到 MySQL（反引号 / CHAR(10 USING utf8mb4)）');
  pick(byId('dialectSelect'), 'mysql');
  await tick(AUTO_WAIT);
  const mySql = previewSql();
  ok('标识符改用反引号', has(mySql, 'WITH `HARDCODE` AS ('));
  ok('★ 换行写 CHAR(10 USING utf8mb4)（裸 CHAR(10) 会让 CTAS 落成 varbinary）',
    has(mySql, 'CHAR(10 USING utf8mb4)'));
  ok('MySQL 字符串不加 N 前缀', has(mySql, "'东城店' AS `门店`"), firstSelect(mySql));
  ok('方言说明已根据 MySQL 更新（不再提 dual）', !hasText(detailsText(), 'FROM dual'),
    detailsText());

  /* ---------------------------------------------------------------
   * [10] 切到 INSERT 分批
   * ------------------------------------------------------------- */
  section('10. 切到 INSERT 分批（控件联动 + 产物形态）');
  const fmtSel = byId('formatSelect');
  ok('输出形式是原生下拉', fmtSel.tagName === 'SELECT', fmtSel.tagName);
  /* ★ 这一对显隐互换曾经就是「卡片高度跳动」的源头：左栏内容实测 632px，
     正好顶满面板（余量 0）—— 切到 INSERT 时冒出来的「每批行数」多出 33px，
     面板立刻出滚动条，观感上就是高度在跳。改成下拉后每项恒定 34px。 */
  pick(fmtSel, 'insert');
  ok('「包裹方式」行隐藏（对 INSERT 无意义）', byId('wrapSegs').hidden === true);
  ok('「每批行数」行出现', byId('batchWrap').hidden === false);
  await tick(AUTO_WAIT);
  const insSql = previewSql().split('\n').filter((l) => !l.startsWith('--')).join('\n');
  ok('产物变成 INSERT INTO', insSql.startsWith('INSERT INTO'), insSql.slice(0, 60));
  ok('列清单在表名后', has(insSql, '(`门店`, `商品`'), insSql.slice(0, 100));
  ok('用 VALUES 而不是 UNION ALL', has(insSql, 'VALUES') && !has(insSql, 'UNION ALL'));
  ok('每行是一个括号元组', has(insSql, "('东城店', '纯牛奶 250ml'"), insSql.slice(insSql.indexOf('VALUES'), insSql.indexOf('VALUES') + 80));
  ok('提示里写了每批行数', hasText(detailsText(), 'INSERT 每批 500 行'));

  pick(fmtSel, 'union');
  ok('切回后「包裹方式」行回来', byId('wrapSegs').hidden === false);
  ok('切回后「每批行数」行收起', byId('batchWrap').hidden === true);

  /* ---------------------------------------------------------------
   * [11] 手动改表头行 -> 再恢复自动识别
   * ------------------------------------------------------------- */
  section('11. 手动改表头行（点预览里的某一行）');
  fireClick(rowsNow()[0]);
  ok('点第 1 行后提示改成「手动指定」',
    hasText(detailsText(), '手动指定的第 1 行'), detailsText().slice(0, 120));
  ok('第 1 行变成 is-head、不再是 is-skipped',
    has(rowsNow()[0].className, 'is-head') && !has(rowsNow()[0].className, 'is-skipped'),
    rowsNow()[0].className);
  ok('第 2 行不再是表头', !has(rowsNow()[1].className, 'is-head'), rowsNow()[1].className);
  ok('出现「恢复自动识别」的入口',
    hasText(byId('headerNotice'), '手动指定') &&
    !!findButton(byId('headerNotice'), '恢复自动识别'));

  fireClick(byId('btnGenerate'));
  await tick();
  ok('把标题行当表头 -> 数据变 8 行（标题行成了数据）',
    byId('statRows').textContent === '8', byId('statRows').textContent);
  ok('空列名被自动补成 col_N（没有留下无名列）',
    has(previewSql(), 'AS `col_2`'), firstSelect(previewSql()));

  fireClick(findButton(byId('headerNotice'), '恢复自动识别'));
  ok('恢复自动识别后回到第 2 行',
    hasText(detailsText(), '第 2 行'), detailsText());
  fireClick(byId('btnGenerate'));
  await tick();
  ok('恢复后数据回到 7 行', byId('statRows').textContent === '7', byId('statRows').textContent);

  /* ---------------------------------------------------------------
   * [12] 表名输入框
   * ------------------------------------------------------------- */
  section('12. 表名输入框');
  byId('tableInput').value = 'sale_detail';
  fireInput(byId('tableInput'));
  fireClick(byId('btnGenerate'));
  await tick();
  ok('自定义表名生效', has(previewSql(), '`sale_detail`'), previewSql().split('\n')[5]);

  byId('tableInput').value = '';
  fireInput(byId('tableInput'));
  fireBlur(byId('tableInput'));
  ok('清空后失焦回落 HARDCODE', byId('tableInput').value === 'HARDCODE', byId('tableInput').value);
  fireClick(byId('btnGenerate'));
  await tick();
  ok('产物里没有空标识符', !has(previewSql(), '``') && has(previewSql(), '`HARDCODE`'));

  /* ---------------------------------------------------------------
   * [13] 复制：降级分支必须真跑到
   * ------------------------------------------------------------- */
  section('13. 复制 SQL（execCommand 降级 + 失败分支）');
  errors.length = 0;
  fireClick(byId('btnCopy'));
  await tick(80);
  ok('复制路径无未捕获异常', realErrors().length === 0, realErrors().join(' | '));
  ok('走了 execCommand 降级（本环境没有 navigator.clipboard）',
    execCalls.length >= 1, '调用 ' + execCalls.length + ' 次');
  ok('降级成功时提示成功', hasText(byId('toast'), '已复制'), byId('toast').textContent);
  const tas = created.filter((t) => t.tagName === 'TEXTAREA');
  ok('降级路径自己造了 textarea 并填入完整产物',
    tas.length >= 1 && tas[tas.length - 1].value.length > 100,
    'textarea 数 ' + tas.length + '，末个长度 ' + (tas.length ? tas[tas.length - 1].value.length : 0));
  ok('临时 textarea 用完从 body 上摘掉了', kids(globalThis.document.body).indexOf(tas[tas.length - 1]) < 0);

  /* 反例：连降级也失败时必须如实报错，不假装复制成功 */
  execOk = false;
  byId('toast').textContent = '';
  fireClick(byId('btnCopy'));
  await tick(80);
  ok('★ 两条路都不通时如实报错（不假装成功）',
    hasText(byId('toast'), '拦下'), byId('toast').textContent);
  execOk = true;

  /* ---------------------------------------------------------------
   * [14] 使用提示弹窗
   * ------------------------------------------------------------- */
  section('14. 使用提示弹窗');
  ok('初始隐藏', byId('tipModal').hidden === true);
  fireClick(byId('btnTips'));
  ok('点问号打开', byId('tipModal').hidden === false);
  fireClick(byId('btnCloseModal'));
  ok('点「知道了」关闭', byId('tipModal').hidden === true);
  fireClick(byId('btnTips'));
  fireClick(byId('btnCloseModalX'));
  ok('点右上角 × 关闭', byId('tipModal').hidden === true);
  fireClick(byId('btnTips'));
  byId('tipModal')._h.click({ target: byId('tipModal') });
  ok('点遮罩关闭', byId('tipModal').hidden === true);
  fireClick(byId('btnTips'));
  docListeners.get('keydown')({ key: 'Escape' });
  ok('Escape 关闭', byId('tipModal').hidden === true);
  docListeners.get('keydown')({ key: 'a' });
  ok('Escape 之外不关（没有把 keydown 全吃掉）', byId('tipModal').hidden === true);

  /* ---------------------------------------------------------------
   * [15] 主题切换与持久化
   * ------------------------------------------------------------- */
  section('15. 主题切换与持久化');
  const inlineKey = (HTML.match(/var KEY = '([^']+)'/) || [, ''])[1];
  const themeJsKey = (readFileSync(join(JS, 'theme.js'), 'utf8').match(/localStorage\.setItem\('([^']+)'/) || [, ''])[1];
  ok('★ 内联首帧脚本与 theme.js 用的是同一个 key（不一致会让主题记不住）',
    !!inlineKey && inlineKey === themeJsKey, inlineKey + ' vs ' + themeJsKey);

  byId('themeToggle')._h.click({});
  ok('点击后写进 localStorage', localStorage.getItem(inlineKey) === 'dark',
    String(localStorage.getItem(inlineKey)));
  byId('themeToggle')._h.click({});
  ok('再点切回 light', localStorage.getItem(inlineKey) === 'light',
    String(localStorage.getItem(inlineKey)));

  /* ---------------------------------------------------------------
   * [16] 设置持久化
   * ------------------------------------------------------------- */
  section('16. 设置持久化');
  const saved = JSON.parse(localStorage.getItem('excel2sql-settings') || '{}');
  ok('设置被写进 localStorage', Object.keys(saved).length >= 8, JSON.stringify(saved).slice(0, 140));
  ok('方言被记住（MySQL）', saved.dialect === 'mysql', saved.dialect);
  ok('表名被记住（回落后的 HARDCODE）', saved.table === 'HARDCODE', saved.table);
  ok('三个开关都被记住',
    saved.emptyAsNull === false && saved.inferTypes === false && saved.legacyDateMode === true,
    JSON.stringify([saved.emptyAsNull, saved.inferTypes, saved.legacyDateMode]));

  /* ★ 反例：localStorage 里塞非法值时不能白屏，要回落默认 */
  localStorage.setItem('excel2sql-settings', JSON.stringify({
    dialect: 'db2', fmt: 'nope', wrap: 'nope', batchSize: -5, table: null
  }));
  let reloadError = null;
  try { new Function(src)(); } catch (e) { reloadError = e; }
  ok('★ 持久化内容非法时回落默认而不是白屏', !reloadError, reloadError && reloadError.stack);
  const activeDia = byId('dialectSelect').value;
  ok('非法方言回落 SQL Server', activeDia === 'sqlserver', activeDia);
  ok('非法 fmt 回落 union（包裹方式行重新出现）', byId('wrapSegs').hidden === false,
    'true 说明 fmt 是 insert，回落失败');

  /* ---------------------------------------------------------------
   * [17] 真文件 IO 主路径
   * ------------------------------------------------------------- */
  section('17. 真实文件 IO（假 File 句柄，真的调进 readFile）');
  localStorage._s.clear();       /* 不影响已加载到内存的设置 */

  /* 17a. 拖拽一个 CSV 进来 —— 覆盖 drop 路径（不是点按钮选文件） */
  errors.length = 0;
  const csvFile = makeFile('门店.csv', enc('门店,销量,单价\n东城店,120,3.5\n西城店,64,8.9\n'));
  byId('dropZone')._h.drop({ preventDefault() {}, dataTransfer: { files: [csvFile] } });
  await tick(80);
  ok('拖拽路径无未捕获异常', realErrors().length === 0, realErrors().join(' | '));
  ok('拖进来的 CSV 被解析（文件名上了文件行）',
    hasText(byId('fileName'), '门店.csv'), byId('fileName').textContent);
  ok('CSV 的编码与分隔符被标出来',
    hasText(byId('fileMeta'), 'UTF-8') && hasText(byId('fileMeta'), '逗号'),
    byId('fileMeta').textContent);
  ok('★ 只有 CSV 才显示「自动推断数字」开关', byId('inferWrap').hidden === false);
  ok('CSV 表头识别为第 1 行', hasText(detailsText(), '第 1 行'), detailsText());

  fireClick(byId('btnGenerate'));
  await tick();
  ok('CSV 默认整列按字符串（没有类型信息）',
    has(previewSql(), "'120'") && has(previewSql(), "'3.5'"), firstSelect(previewSql()));

  byId('optInferTypes').checked = true;
  fireChange(byId('optInferTypes'));
  fireClick(byId('btnGenerate'));
  await tick();
  ok('打开「自动推断数字」后数字列不加引号',
    has(previewSql(), '120 AS') && !has(previewSql(), "'120'"), firstSelect(previewSql()));

  /* 17b. 空串 / NULL（CSV 才测得出：逗号之间的空字段） */
  byId('optInferTypes').checked = false;
  fireChange(byId('optInferTypes'));
  byId('fileInput').files = [makeFile('空值.csv', enc('a,b\nx,\n,7\n'))];
  fireChange(byId('fileInput'));
  await tick(80);
  fireClick(byId('btnGenerate'));
  await tick();
  ok('默认保留空串（写成 空字符串字面量）', has(previewSql(), "'' AS"),
    previewSql().split('\n').find((l) => l.indexOf('SELECT') >= 0));
  byId('optEmptyNull').checked = true;
  fireChange(byId('optEmptyNull'));
  fireClick(byId('btnGenerate'));
  await tick();
  ok('打开「空串视为 NULL」后写成 NULL', has(previewSql(), 'NULL AS'),
    previewSql().split('\n').find((l) => l.indexOf('SELECT') >= 0));

  /* 17c. .xls 必须给可操作的提示，而不是硬解析或静默失败 */
  errors.length = 0;
  byId('fileInput').files = [makeFile('老表.xls', new Uint8Array([0xD0, 0xCF, 0x11, 0xE0]))];
  fireChange(byId('fileInput'));
  await tick(80);
  ok('.xls 被拒绝而不是硬解析', hasText(byId('envNotice'), '不支持 .xls'),
    byId('envNotice').textContent.slice(0, 90));
  ok('给出了可操作的建议（另存为 .xlsx）', hasText(byId('envNotice'), '另存为 .xlsx'));
  ok('失败后回到空态（不留一份假数据在上面）',
    byId('emptyCard').hidden === false && byId('workState').hidden === true);

  /* 17d. 真 xlsx 夹具：ZIP + DecompressionStream 全链路 */
  errors.length = 0;
  byId('fileInput').files = [makeFile('excel-style.xlsx', new Uint8Array(readFileSync(join(TOOL, 'test-fixtures', 'excel-style.xlsx'))))];
  fireChange(byId('fileInput'));
  await tick(150);
  ok('真 xlsx 解析无未捕获异常', realErrors().length === 0, realErrors().join(' | '));
  ok('xlsx 标记为 XLSX', hasText(byId('fileMeta'), 'XLSX'), byId('fileMeta').textContent);
  ok('xlsx 不显示「自动推断数字」开关（本来就有类型信息）', byId('inferWrap').hidden === true);
  ok('xlsx 解出了表头与数据（生成按钮可用）', byId('btnGenerate').disabled === false);
  fireClick(byId('btnGenerate'));
  await tick();
  ok('xlsx 的日期列被识别成日期（走 numFmt 判定）',
    has(previewSql(), '2024-11-11'), firstSelect(previewSql()));
  ok('xlsx 的超长数字保精度', has(previewSql(), '9007199254740993'));

  /* 17e. 大产物：预览必须截断，但截断后仍是产物的真前缀 */
  const bigLines = ['n,v'];
  for (let i = 1; i <= 75; i++) bigLines.push('r' + i + ',' + i);
  byId('fileInput').files = [makeFile('大表.csv', enc(bigLines.join('\n') + '\n'))];
  fireChange(byId('fileInput'));
  await tick(120);
  fireClick(byId('btnGenerate'));
  await tick(80);
  const beforeDl = downloads.length;
  fireClick(byId('btnDownload'));
  await tick(120);
  const bigDl = await downloadedSql(beforeDl);
  const pv = previewSql();
  const cut = pv.indexOf('\n-- …');
  ok('大产物：预览被截断（不把 157 行全塞进 DOM）',
    cut > 0 && bigDl.length > pv.length, 'cut=' + cut + ' dl=' + (bigDl ? bigDl.length : -1));
  ok('截断处写明了还有多少行没显示', hasText(byId('resultCode'), '还有'));
  ok('★ 截断后仍是产物的真前缀（没有漏字/错位）', bigDl.startsWith(pv.slice(0, cut)),
    'pv 前 60：' + JSON.stringify(pv.slice(0, 60)));
  ok('行数统计正确（75 行）', byId('statRows').textContent === '75', byId('statRows').textContent);
  ok('75 行不触发「UNION ALL 变慢」提示（阈值 2000 之内）',
    !hasText(byId('resultNotice'), '变慢'), byId('resultNotice').textContent.slice(0, 160));

  /* ---------------------------------------------------------------
   * [17f] 「重新选择」回到空态：进得去也要出得来
   * ------------------------------------------------------------- */
  section('17f. 重新选择文件（退回空态）');
  ok('前提：此刻工作态是可见的', byId('workState').hidden === false);
  fireClick(byId('btnReselect'));
  ok('点「重新选择」退回空态', byId('emptyCard').hidden === false && byId('workState').hidden === true);
  ok('空态里没有残留上一次的数据源（文件行收起）', byId('fileRow').hidden === true);
  ok('产物被清掉，复制 / 下载重新禁用',
    byId('btnCopy').disabled === true && byId('btnDownload').disabled === true);
  ok('状态栏摘要清空（不留上一个文件的识别理由）', detailsText() === '');
  ok('「详情」按钮跟着收起', byId('btnDetails').hidden === true);
  ok('CSV 专属开关也收起（回到 xlsx 语境）', byId('inferWrap').hidden === true);
  byId('btnSample')._h.click({ stopPropagation() {} });
  await tick(80);
  ok('退回后能再次载入（工作态重新登场）',
    byId('workState').hidden === false && byId('emptyCard').hidden === true);

  /* ---------------------------------------------------------------
   * [17g] 右侧页签 / 自动换行 / 「⋯」菜单 / 防抖自动生成
   * ------------------------------------------------------------- */
  section('17g. 右侧页签、自动换行、⋯ 菜单与自动生成');

  ok('前提：此刻停在「SQL 产物」页签',
    byId('resultCard').hidden === false && byId('headerCard').hidden === true);
  fireClick(byId('tabHeader'));
  ok('点「数据预览」切过去', byId('headerCard').hidden === false && byId('resultCard').hidden === true);
  ok('★ 切过去后数据预览真的在渲染（不是空壳）',
    !!findTag(byId('headerPicker'), 'TABLE'));
  /* ★★ 持久化断言必须拿**非默认值**判。settings.tab 的默认值就是 'result'，
     而 17g 之前有大量交互（下拉 / 开关 / Alt+Z）都会整份 saveSettings()，
     早把 'result' 写进 localStorage 了 —— 于是「存了没有」根本区分不出来：
     把 switchTab 里那句 saveSettings() 删掉，断言照样绿（反向实验实测抓到的
     第一条假守卫）。切到 'header' 之后立刻读，才真的能咬住。 */
  ok('★ 切到「数据预览」（非默认页签）后立刻落盘',
    JSON.parse(localStorage.getItem('excel2sql-settings') || '{}').tab === 'header',
    String(JSON.parse(localStorage.getItem('excel2sql-settings') || '{}').tab));
  fireClick(byId('tabResult'));
  ok('点回「SQL 产物」', byId('resultCard').hidden === false && byId('headerCard').hidden === true);
  ok('★ 落盘跟着切回 result（每次切换都写，不是只写第一次）',
    JSON.parse(localStorage.getItem('excel2sql-settings') || '{}').tab === 'result',
    String(JSON.parse(localStorage.getItem('excel2sql-settings') || '{}').tab));

  /* Alt+Z 自动换行：用户点名要的那个"避免横向滚动" */
  ok('自动换行初始关（默认保持缩进层次）',
    byId('resultCode').classList.contains('is-wrap') === false);
  docListeners.get('keydown')({ key: 'z', altKey: true, preventDefault() {} });
  ok('★ Alt+Z 打开自动换行（与 VS Code 同款键位）',
    byId('resultCode').classList.contains('is-wrap') === true);
  ok('Alt+Z 之后偏好被记住',
    JSON.parse(localStorage.getItem('excel2sql-settings') || '{}').wordWrap === true);
  docListeners.get('keydown')({ key: 'z', altKey: true, preventDefault() {} });
  ok('再按一次关掉（是开关不是单向打开）',
    byId('resultCode').classList.contains('is-wrap') === false);

  /* 「⋯」菜单：生成按钮退居于此 */
  ok('菜单初始收起', byId('moreMenu').hidden === true);
  fireClick(byId('btnMore'));
  ok('点「⋯」展开', byId('moreMenu').hidden === false);
  ok('展开时 aria-expanded 同步', byId('btnMore').getAttribute('aria-expanded') === 'true');
  docListeners.get('keydown')({ key: 'Escape' });
  ok('Escape 收掉菜单', byId('moreMenu').hidden === true);
  fireClick(byId('btnMore'));
  docListeners.get('click')();
  ok('点别处也收掉菜单（不留浮层挡着）', byId('moreMenu').hidden === true);
  fireClick(byId('btnMore'));
  fireClick(byId('btnGenerate'));
  await tick();
  ok('点菜单里的「立即重新生成」会顺手收起菜单', byId('moreMenu').hidden === true);

  /* 防抖自动生成：全程不点任何"生成"按钮 */
  byId('tableInput').value = 'auto_tbl';
  fireInput(byId('tableInput'));
  /* ★★ 这里必须先让出一个 macrotask 再断言。generate() 是 async 的，第一句就是
     `await U.nextFrame()`；在同步栈里断言时它还没走到渲染 —— 于是把防抖拿掉
     改成"一变就立刻算"，同步断言照样绿（反向实验实测抓到的第二条假守卫）。
     让出 AUTO_PROBE（60ms，足够 flush 掉 setTimeout(0)，又远小于 350ms 防抖窗口）
     之后，"没等窗口就出结果"才真的能被观测到。 */
  await tick(AUTO_PROBE);
  ok('★ 防抖窗口内先不算（连打表名不会每敲一个字跑一遍）',
    !has(byId('resultCode').textContent, 'auto_tbl'), previewSql().split('\n')[0]);
  await tick(AUTO_WAIT);
  ok('★★ 防抖结束后自动产出（全程没点过任何生成按钮）',
    has(byId('resultCode').textContent, 'auto_tbl'), previewSql().split('\n')[0]);
  byId('tableInput').value = 'HARDCODE';
  fireInput(byId('tableInput'));
  await tick(AUTO_WAIT);
  ok('改回表名同样自动跟上', has(byId('resultCode').textContent, '[HARDCODE]') ||
    has(byId('resultCode').textContent, '`HARDCODE`') || has(byId('resultCode').textContent, '"HARDCODE"'),
    previewSql().split('\n')[0]);

  /* ---------------------------------------------------------------
   * [17h] 分级策略：大文件必须降级为手动
   * ------------------------------------------------------------- */
  /* ★★ 这一节是补漏。上面的自动生成全用 7 行小夹具，于是「导入路径」从没被覆盖到 ——
     真机 6001 行 CSV 实测：本该只给一句提示、不产出 SQL，却直接吐了 12,009 行
     （778 KB）。根因是 applyBook 末尾图省事写了「延后一拍直接 generate(true)」，
     整个绕过了 autoEnabled() 的阈值判定；而 232 条断言全绿，因为没人拖过大文件进来。
     ★ 教训：**「分级」这种按条件分叉的策略，两个分支都要有真夹具打过去**，
     只测小文件等于只测了一半。 */
  section('17h. 分级策略：超过阈值的文件降级为手动');
  errors.length = 0;
  const bigCsvLines = ['工单号,工序,设备,数量'];
  for (let i = 1; i <= 6001; i++) bigCsvLines.push('WO' + i + ',SMT-' + (i % 12) + ',EQ-' + (i % 40) + ',' + (i % 97));
  const bigCsv = makeFile('big-6001.csv', enc(bigCsvLines.join('\n')));
  byId('dropZone')._h.drop({ preventDefault() {}, dataTransfer: { files: [bigCsv] } });
  await tick(AUTO_WAIT);
  ok('拖大文件无未捕获异常', realErrors().length === 0, realErrors().join(' | '));
  ok('★★ 超过阈值的文件不自动出 SQL（导入路径也要受分级约束）',
    !has(byId('resultCode').textContent, 'WO1') && byId('sqlStats').hidden === true,
    '产物行数=' + previewSql().split('\n').length + '，统计段 hidden=' + byId('sqlStats').hidden);
  ok('★★ 占位层说明了为什么没自动算、以及怎么手动触发',
    byId('resultPlaceholder').hidden === false &&
    hasText(byId('resultPlaceholder'), '5,000') &&
    hasText(byId('resultPlaceholder'), '手动'),
    byId('resultPlaceholder').textContent.slice(0, 120));
  ok('降级后复制 / 下载一并禁用（没有产物可导）',
    byId('btnCopy').disabled === true && byId('btnDownload').disabled === true);
  /* ★★ 真机还抓到一条：降级时状态栏永久挂着「处理中…」。
     根因是 applySettingsToUI 里那句 `setBusy(state.busy)` —— 此刻 busy 仍为 true 且没带
     label，于是状态行被写成「处理中…」；而配对的 setBusy(false) 刻意不动状态行
     （免得抹掉刚闪出来的「已生成」），这句就再也下不去了。明明什么都没在算。
     修法是给这行加 owner 标记，让 setBusy 写的由 setBusy 收。 */
  ok('★★ 降级为手动时状态栏不残留「处理中…」（它曾经永久挂住）',
    byId('genState').hidden === true, byId('genState').textContent);
  /* 手动分支必须真的能用，否则"降级"就成了"功能消失" */
  byId('tableInput').value = 'big_tbl';
  fireInput(byId('tableInput'));
  await tick(AUTO_WAIT);
  ok('降级后改设置不会偷偷恢复自动计算', byId('sqlStats').hidden === true);
  fireClick(byId('btnGenerate'));
  await tick(AUTO_WAIT);
  ok('★ 点了「立即重新生成」照样能出结果（降级不等于禁用）',
    has(byId('resultCode').textContent, 'big_tbl') && byId('sqlStats').hidden === false,
    '产物行数=' + previewSql().split('\n').length);
  /* 回到小文件，确认分级是**逐次判定**而不是一次降级就永久手动 */
  const backCsv = makeFile('small.csv', enc('门店,销量\n东城店,120\n'));
  byId('dropZone')._h.drop({ preventDefault() {}, dataTransfer: { files: [backCsv] } });
  await tick(AUTO_WAIT);
  ok('★ 换回小文件又自动出结果（分级是逐次判的，不粘住）',
    has(byId('resultCode').textContent, '东城店') && byId('sqlStats').hidden === false,
    previewSql().split('\n')[0]);

  /* ---------------------------------------------------------------
   * [18] 静态契约：让界面静默失效的那几处
   * ------------------------------------------------------------- */
  section('18. 静态契约');
  const css = readFileSync(join(TOOL, 'css', 'styles.css'), 'utf8');
  /* ★★ 断言前先剥掉注释。注释里提到某个选择器（比如"以前是 `.esq-right { … }`"这种
     说明历史决策的写法）会被 /\.esq-right\s*\{([^}]*)\}/ 先命中，拿到的是**注释里的
     示例代码**而不是真实规则 —— 于是"旧结构已删掉"这件事断言不出来。
     这轮改版真踩到了：.esq-right 已经换成 flex，断言却读出 `grid-template-rows`，
     因为上面那段历史注释里正好留着旧规则的原文。 */
  const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  /* app.js 用 `el.hidden = true` 隐藏 .esq-segs（display:grid）与 .esq-field（display:flex）。
     没有这条 !important，class 里的 display 会盖过 hidden —— 症状是控件「关不掉」，
     而且**没有任何报错**。 */
  ok('★ styles.css 有 [hidden] { display: none !important }（否则网格/弹性布局上的 hidden 会失效）',
    /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(css));
  ok('提示条样式存在（.esq-notice / .esq-notice.is-warn）',
    has(css, '.esq-notice') && has(css, '.esq-notice.is-warn'));
  ok('产物预览样式存在（.esq-code）', has(css, '.esq-code'));
  ok('表头选择表样式存在（.esq-picker + is-head）',
    has(css, '.esq-picker') && has(css, '.esq-picker tbody tr.is-head'));
  /* 新版布局：左窄栏 + 右列上下分栏 + 贴底状态栏，靠 grid 表达结构 */
  ok('工作态外壳样式存在（.esq-work / .esq-work-top / .esq-layout / .esq-status）',
    has(css, '.esq-work') && has(css, '.esq-work-top') && has(css, '.esq-layout') && has(css, '.esq-status'));
  /* ★ 取**第一条** .esq-layout / .esq-right 规则 = 桌面基础规则（媒体查询一律写在文件末尾）。
     不要直接全文搜 /\.esq-layout\s*\{[^}]*grid-template-columns/ ——
     窄屏媒体查询里那条 .esq-layout 同样带 grid-template-columns，
     基础规则被改坏之后它照样让断言通过。这是反向实验（mutation-excel2sql.mjs）
     实测抓到的第一条假守卫，别退回去。 */
  const baseLayout = (cssRules.match(/\.esq-layout\s*\{([^}]*)\}/) || [])[1] || '';
  ok('★ 分栏结构由 grid 表达（列宽比"靠 DOM 顺序凑"更耐改）',
    /grid-template-columns/.test(baseLayout), baseLayout.trim().slice(0, 72));

  /* ★★ 右侧从「上下各占一半」改成「页签分时复用」，这一组是配套守卫。
     旧结构那个坑必须钉住：`.esq-right` 若是 grid 且带 `grid-template-rows: auto minmax(...)`，
     配上子项的 `max-height: 百分比` —— 两条规则互不知情：auto 轨道按 max-content 定高，
     而百分比是相对**那条轨道**算的，卡片只渲染一小截却占着整条轨道，
     中间平白空出 200+ px 的死区（真机 246px），SQL 只剩 79px ≈ 4 行。
     实测对照：改成页签后 SQL 可视涨到 523px（26 行）。 */
  const baseRight = (cssRules.match(/\.esq-right\s*\{([^}]*)\}/) || [])[1] || '';
  ok('★ 右列是纵向弹性容器（页签行 + 页签内容）',
    /display\s*:\s*flex/.test(baseRight) && /flex-direction\s*:\s*column/.test(baseRight),
    baseRight.trim().slice(0, 72));
  ok('★★ 右列不再用「按 max-content 定高的自动轨道 + 百分比限高」组合（那会留死区）',
    !/grid-template-rows/.test(baseRight), baseRight.trim().slice(0, 90));
  /* 同上：一律用「选择器 + {」的形式，避免 has() 的子串匹配把
     .esq-tabbar / .esq-tabbody / .esq-pane-result 当成 .esq-tab / .esq-pane 本身。 */
  ok('★ 页签三件套样式存在（.esq-tab / .esq-tabbar / .esq-tabbody / .esq-pane）',
    /\.esq-tabbar\s*\{/.test(cssRules) && /\.esq-tab\s*[\{,]/.test(cssRules) &&
    /\.esq-tabbody\s*\{/.test(cssRules) && /\.esq-pane\s*\{/.test(cssRules));
  ok('★ 自动换行样式存在（.esq-code.is-wrap，Alt+Z 靠它消掉横向滚动条）',
    /\.esq-code\.is-wrap\s*\{[^}]*white-space\s*:\s*pre-wrap/.test(cssRules));
  /* ★ 用 `\.esq-row\s*\{` 而不是 has(css,'.esq-row') —— 后者是**子串匹配**，
     `.esq-rownum`（产物左侧的行号列）里照样含 `.esq-row`，
     于是这个选择器就算被整个删掉，断言也会永远通过。 */
  ok('★ 左栏改成行内字段（.esq-row + .esq-select），平铺的分段按钮已退场',
    /\.esq-row\s*\{/.test(cssRules) && /\.esq-select\s*\{/.test(cssRules) && !/\.esq-seg\s*\{/.test(cssRules));
  ok('空态卡片样式存在（.esq-empty-card，且限宽不铺满全屏）',
    /\.esq-empty-card\s*\{[^}]*max-width/.test(cssRules));
  /* 抽屉的"列表版式"现在与提示弹窗共用（.modal-body ul/li）——
     所以这里断言的是承载样式的类，而不是已经不再需要独立规则的那个类名。 */
  ok('详情抽屉样式存在（.esq-drawer + 分组与分组标题）',
    has(css, '.esq-drawer') && has(css, '.esq-detail-title') && has(css, '.esq-detail-group'));
  ok('产物占位样式存在（.esq-placeholder）', has(css, '.esq-placeholder'));

  /* ---- ★★ 弹窗列表项的排版模型（这一版修的就是它）----
     `.modal-body li` 一旦是 flex 容器，li 里的 <strong>/<kbd>/<code> 会**各自变成一个
     flex item**，被 gap 打散成并排的"列"，整段话不再按文本流换行 —— 真机实测：
     「解析完全在浏览器里完成，文件不会上传到任何服务器。」渲染出 3 个 flex item，
     <strong> 被甩到 x=737 单独站一列；另一条渲染出 4 个，两个 <strong> 并排落在同一行。
     用户看到的就是"详情内容没对齐、观感乱"。这条断言钉住它别再退回去。 */
  const modalLi = (cssRules.match(/\.modal-body li\s*\{([^}]*)\}/) || [])[1] || '';
  ok('★★ 弹窗列表项不是 flex 容器（否则行内标记会各自成列）',
    !!modalLi && !/display\s*:\s*flex/.test(modalLi) && /padding-left/.test(modalLi),
    modalLi.trim().slice(0, 90));
  ok('★★ 项目符号用绝对定位 + padding-left（这才是真正的悬挂缩进）',
    /\.modal-body li::before\s*\{[^}]*position\s*:\s*absolute/.test(cssRules));
  ok('★ 抽屉的分组标题与提示弹窗同一档规格（两个弹窗是一个体系）',
    /\.esq-detail-title\s*\{[^}]*font-size\s*:\s*12px/.test(cssRules) &&
    /\.modal-sec-title\s*\{[^}]*font-size\s*:\s*12px/.test(cssRules));
  ok('★ 使用提示按「支持范围 / 数据安全 / 使用要点」分了组',
    ['支持范围', '数据安全', '使用要点'].every((t) => has(HTML, '>' + t + '<')));
  ok('★ 死样式已清掉（.esq-hint / .esq-status-note / .chip 都不再存在）',
    !has(cssRules, '.esq-hint') && !has(cssRules, '.esq-status-note') && !has(cssRules, '.chip'));

  /* ---- ★ 次级文字对比度：别把 --text-3 的 L 取到 58% ----
     `--text-3` 承载 11~12px 的次级说明（.esq-field-hint / .esq-drop-sub /
     .esq-file-meta / .esq-detail-empty），属"正文尺寸"，必须过 WCAG AA 的 4.5:1。
     L=58% 恰好是**明暗两条对比度曲线的交点** —— 亮底与暗底都只有 4.21:1，
     两边同时卡线，而且从截图上看不出任何异常。亮色要往下走、暗色要往上走。
     实测阶梯（_ui-shots 的对比度探针 / CDP 真机量）：亮色 56%→4.58、暗色 60%→4.58。 */
  const l3light = Number((css.match(/--text-3:\s*oklch\((\d+)%/) || [])[1]);
  const l3dark = Number((css.match(/--text-3:\s*oklch\((\d+)%\s+0\.01\s+240\)/) || [])[1]);
  ok('★ 亮色 --text-3 不过亮（≤57%，否则次级文字跌破 AA 4.5:1）',
    Number.isFinite(l3light) && l3light <= 57, 'L=' + l3light + '%');
  ok('★ 暗色 --text-3 不过暗（≥59%，同一条 4.21:1 陷阱的另一侧）',
    Number.isFinite(l3dark) && l3dark >= 59, 'L=' + l3dark + '%');
  ok('★ 两套主题的 --text-3 没有同时停在 58%（那正是 4.21:1 的交点）',
    !(l3light === 58 && l3dark === 58), `亮 ${l3light}% / 暗 ${l3dark}%`);

  /* ---- ★ 窄屏堆叠：必须把 .esq-layout 的 flex:1 收掉 ----
     ≤1000px 时三块面板改为纵向堆叠。若仍保留 flex:1，高度会被视口均分、
     每块被压扁后各自内部滚动，「生成 SQL」直接被挤出面板可视区（真机 900×860 实测）。
     这条断言守的是"堆叠模式下由外层统一滚动"这个结构前提。 */
  const narrow = (css.match(/@media\s*\(max-width:\s*1000px\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  ok('★ 窄屏媒体查询存在', narrow.length > 0);
  ok('★ 窄屏下 .esq-layout 不再均分视口高度（否则面板被压扁、按钮挤出视野）',
    /\.esq-layout\s*\{[^}]*flex\s*:\s*0\s+0\s+auto/.test(narrow));
  ok('★ 窄屏下滚动交给 .esq-work-top 统一承担（避免"套娃双滚动"）',
    /\.esq-work-top\s*\{[^}]*overflow\s*:\s*auto/.test(narrow) &&
    /\.esq-settings\s+\.panel-body[^{]*\{[^}]*overflow\s*:\s*visible/.test(narrow));
  ok('窄屏下 picker / code 仍各自限高（SQL 可能几千行，不限高会把页面拉成几屏）',
    /\.esq-picker\s*,\s*\.esq-code\s*\{[^}]*max-height/.test(narrow));

  /* 占位层的「文案」由这里守。上面 [3] 只能证明这一层显示着，
     读不到里面写了什么 —— DOM 桩不解析 HTML 文本，读源文件才是硬证据。 */
  const html = HTML;
  const phBlock = html.match(/<div class="esq-placeholder" id="resultPlaceholder">([\s\S]*?)<\/div>/);
  ok('★ 占位层确实写了引导文案（不是空壳）',
    !!phBlock && has(phBlock[1], 'SQL'),
    phBlock ? phBlock[1].replace(/\s+/g, ' ').trim().slice(0, 80) : '没匹配到占位层');
  ok('占位层给的是下一步动作（指向左侧设置）',
    !!phBlock && has(phBlock[1], '生成'),
    phBlock ? phBlock[1].replace(/\s+/g, ' ').trim().slice(0, 80) : '没匹配到占位层');

  /* ---------------------------------------------------------------
   * [19] 文案与信息架构（这一轮按 UI 反馈做的收敛）
   * ------------------------------------------------------------- */
  section('19. 文案去重 / 页签顺序 / 空态记号');

  /* ① 常驻的副标题不该和空态徽标说同一句话 —— 两边都在讲"数据不离开浏览器"，
        而其中一处（空态）在载入文件后就消失了，等于把常驻位置浪费掉。 */
  const brandSub = (HTML.match(/<span class="brand-sub">([\s\S]*?)<\/span>/) || [])[1] || '';
  const badge = (HTML.match(/<div class="empty-badge">([\s\S]*?)<\/div>/) || [])[1] || '';
  ok('★ 顶栏副标题改说「能力」，不再和空态徽标重复隐私话术',
    !!brandSub && !has(brandSub, '不离开浏览器') && !has(brandSub, '本地'),
    brandSub.trim());
  ok('★ 隐私话术只在「选文件那一刻」说一次（空态徽标）',
    has(badge, '不会离开浏览器') || has(badge, '不离开浏览器'), badge.trim());
  ok('★ 空态徽标带放大镜记号（与 codebase-context 的空态同一套记号）',
    has(badge, '🔎'), badge.trim());

  /* ② 空态那句 lead：说「动作 + 拿到什么」，不列操作步骤。
        原文是「选一个 Excel / CSV 文件，确认表头行，挑好方言 —— …」——
        三个微操作堆在标题下面，既啰嗦又和下面的能力条重复。 */
  const lead = (HTML.match(/<p class="empty-lead">([\s\S]*?)<\/p>/) || [])[1] || '';
  ok('★ 空态引导语不再罗列操作步骤（"确认表头行 / 挑好方言"这类）',
    !!lead && !has(lead, '确认表头行') && !has(lead, '挑好方言') && !has(lead, '挑方言'),
    lead.trim());
  ok('★ 空态引导语说清了"拿到什么"',
    has(lead, 'SQL') && (has(lead, '拖') || has(lead, '拖入')), lead.trim());

  /* ③ 能力条第 4 条原来写「列级统一 躲开 UNION ALL 隐式转换」：
        "躲开"是口语，"UNION ALL" 是上下文才懂的缩写（这里只用了 union 一种形式）。 */
  const featureBlock = (readFileSync(join(JS, 'app.js'), 'utf8').match(/const FEATURES = \[([\s\S]*?)\];/) || [])[1] || '';
  ok('★ 能力条不再用口语化动词与缩写（"躲开" / "UNION ALL"）',
    !!featureBlock && !has(featureBlock, '躲开') && !has(featureBlock, 'UNION ALL') &&
    has(featureBlock, '列级类型统一'),
    featureBlock.replace(/\s+/g, ' ').trim().slice(0, 150));

  /* ④ 页签顺序 = 阅读顺序：数据源在左、产物在右。
        用 HTML 源码里的**出现位置**判断，而不是"元素存不存在"——
        后者对调顺序也照样通过（这条自己就是个易写成假守卫的地方）。 */
  const iTabHeader = HTML.indexOf('id="tabHeader"');
  const iTabResult = HTML.indexOf('id="tabResult"');
  ok('★ 页签顺序：数据预览在左、SQL 产物在右（数据源在读序的前面）',
    iTabHeader > 0 && iTabResult > 0 && iTabHeader < iTabResult,
    'tabHeader@' + iTabHeader + ' vs tabResult@' + iTabResult);
  /* ★ 注释里那段说明历史决策的文字仍写着「表头预览」，所以这类断言必须读剥过注释的源码 */
  const htmlNoComment = HTML_NO_COMMENT;
  ok('★ 页签文案改成「数据预览」（不再叫"表头预览"—— 那只是其中一列的事）',
    /id="tabHeader"[\s\S]{0,200}?>数据预览</.test(htmlNoComment) &&
    !has(htmlNoComment, '表头预览'));
  /* 面板顺序也要跟着：DOM 顺序 = 视觉顺序 = 阅读顺序 */
  const iPaneHeader = HTML.indexOf('id="headerCard"');
  const iPaneResult = HTML.indexOf('id="resultCard"');
  ok('★ 面板顺序与页签顺序一致（headerCard 在 resultCard 之前）',
    iPaneHeader > 0 && iPaneResult > 0 && iPaneHeader < iPaneResult);
  ok('★ 默认仍停在「SQL 产物」页签（拿来就是要 SQL；数据有问题时左页签亮圆点）',
    /class="esq-tab is-active" id="tabResult"/.test(HTML));

  /* ⑤ 两个"随处都在讲同一件事"的元素不许回来：状态栏的解释性文字、产物区的编码小字 */
  ok('★ index.html 里已无 codeHint / headerHint 元素（内容都归了抽屉）',
    !has(HTML, 'id="codeHint"') && !has(HTML, 'id="headerHint"'));
  ok('★ 产物面板里不再挂常驻小字（esq-hint 已清掉）', !has(HTML, 'class="esq-hint"'));

  console.log('\n' + '='.repeat(60));
  console.log('断言通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log(fail ? '\n结论：界面接线有问题。' : '全部通过。');
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => {
    /* 走没被劫持的那个 console.error（见上面的 realConsoleError）——
       否则这段唯一的致命错误报告会被吞进 errors 数组，只留下一个 rc=1 和半截输出。 */
    realConsoleError('\n接线自检异常终止（这是自检自己的 bug，不是产品的问题）：', e);
    process.exitCode = 1;
  })
  .finally(() => {
    /* 清掉 toast / revokeObjectURL 的长定时器，让进程干净退出。
       不用 process.exit()：那可能截断已经写进 stdout 缓冲的输出。 */
    for (const t of pendingTimers) clearTimeout(t);
  });
