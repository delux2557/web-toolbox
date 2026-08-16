# Context 设计系统移植包 · 新手使用指南

> 这套文件是从你桌面上那个静态项目（`样式提取/V5/style.css`）提取出来的"外观资产"。
> 它不是成品页面，而是一套**设计系统**：定义了颜色、字体、圆角、按钮、面板等样式规则。
> 把它装进你的 Vue + Vite 项目后，你的页面就能拥有和原项目一样的视觉质感。

---

## 一、文件清单

```
design-system/
├── tokens.css        ★ 设计令牌：全部颜色 / 字体 / 圆角 / 阴影（改这里全局生效）
├── components.css    ★ 通用组件样式：按钮 / 面板 / 开关 / 弹窗 / Toast 等
├── README.md          ← 你正在看的这份指南
└── demo.html          在浏览器打开它，可预览这套样式的实际效果
```

**两句话总结：**
- `tokens.css` 是"色卡 + 字体 + 圆角"的仓库，**必须引入**。
- `components.css` 是现成的组件样式（按钮、面板、弹窗…），**按需引入**。你不用它也行，只要会用 `var(--xxx)`，自己写组件也能保持风格统一。

---

## 二、快速接入 Vue + Vite（5 步）

### 第 1 步：创建项目（如果还没建）

```bash
npm create vite@latest my-app -- --template vue
cd my-app
npm install
```

### 第 2 步：拷贝文件

把 `tokens.css` 和 `components.css` 复制到项目的 `src/styles/` 目录（没有就新建）。

### 第 3 步：引入样式（`src/main.js`）

```js
import { createApp } from 'vue'
import './style.css'           // 删掉脚手架自带的 style.css 也可以
import './styles/tokens.css'   // ★ 必选
import './styles/components.css' // 可选（用现成组件样式时引入）
import App from './App.vue'

createApp(App).mount('#app')
```

### 第 4 步：加字体（`index.html` 的 `<head>` 里）

原项目用的两款字体，需要从 Google Fonts 加载（也可以换成你喜欢的）：

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

### 第 5 步：设置主题

在 `index.html` 的 `<html>` 标签上**先手动写一个默认主题**（推荐 light），然后由 JS 接管切换：

```html
<html lang="zh-CN" data-theme="light">
```

> `data-theme` 只有两个合法值：`light` / `dark`。**不写的话，页面会保持浅色**（因为 tokens.css 里浅色令牌写在通用块之外，但 `--bg` 等默认值是 light 块里定义的，详见常见问题 1）。

---

## 三、明暗主题切换（Vue 版实现）

原项目用「`<html>` 上加 `data-theme` 属性 + CSS 变量」实现双主题。在 Vue 里，最干净的做法是写一个组合式函数（composable）。

### 1. 新建 `src/composables/useTheme.js`

```js
import { ref, watchEffect } from 'vue'

const STORAGE_KEY = 'app-theme'   // localStorage 的键名，可自定义

// 启动时读一次：本地记忆 → 系统偏好 → 默认 light
const stored = localStorage.getItem(STORAGE_KEY)
const theme = ref(stored === 'dark' || stored === 'light'
  ? stored
  : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
)

watchEffect(() => {
  document.documentElement.setAttribute('data-theme', theme.value)
  localStorage.setItem(STORAGE_KEY, theme.value)
})

export function useTheme() {
  const toggle = () => { theme.value = theme.value === 'light' ? 'dark' : 'light' }
  return { theme, toggle }
}
```

### 2. 在组件里使用（`App.vue` 示例）

```vue
<script setup>
import { useTheme } from './composables/useTheme'
const { theme, toggle } = useTheme()
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <div class="logo">
          <!-- 放你的 Logo 图标 -->
        </div>
        <div class="brand-text">
          <span class="brand-name">你的项目名</span>
          <span class="brand-sub">一句副标题</span>
        </div>
      </div>
      <div class="topbar-actions">
        <button class="icon-btn" :title="'切换为' + (theme === 'light' ? '深色' : '浅色') + '主题'" @click="toggle">
          <!-- 太阳/月亮图标切换 -->
        </button>
      </div>
    </header>
    <main>
      <!-- 你的页面内容 -->
    </main>
    <footer class="statusbar">
      <span class="stat">状态栏文字</span>
    </footer>
  </div>
</template>
```

### 3. 可选：防主题闪烁

如果觉得切换时会有"闪白"，可以在 `index.html` 的 `<head>` 里加一段内联脚本（在 CSS 生效前就设置好主题，原理和原项目一致）：

```html
<script>
  (function () {
    var KEY = 'app-theme';
    var t = localStorage.getItem(KEY);
    if (t !== 'dark' && t !== 'light') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  })();
</script>
```

> 注意：这段脚本的 `KEY` 要和 `useTheme.js` 里的 `STORAGE_KEY` 保持一致。

---

## 四、变量速查表（tokens.css 里都能改什么）

### 颜色语义（最常用）

| 变量 | 含义 | 典型用途 |
|---|---|---|
| `--bg` | 页面背景 | `body` 背景 |
| `--surface` | 卡片/面板表面 | 面板、按钮底色 |
| `--surface-2` / `--surface-3` | 次级表面 | hover 背景、进度条槽 |
| `--border` / `--border-strong` | 边框（弱/强） | 卡片描边、输入框描边 |
| `--text` / `--text-2` / `--text-3` | 文字主/次/弱 | 标题、正文、辅助说明 |
| `--accent` | 品牌强调色 | 主按钮、链接、选中态 |
| `--accent-strong` | 强调色加深 | hover、进度条 |
| `--accent-soft` | 强调色浅底 | 徽章底、引用块底 |
| `--accent-ink` | 强调色上的文字 | 主按钮文字 |
| `--success` / `--warn` / `--danger` | 成功/警告/危险 | 状态提示 |
| `--glass` | 毛玻璃半透明 | 顶栏、状态栏背景 |

**想换主题色？** 只需要改 `tokens.css` 里 light 和 dark 两块中的 `--accent` / `--accent-strong` / `--accent-soft` / `--accent-ink` 四个变量（建议用 OKLCH 或 HSL 表示，Hex 也可以）。

### 其它令牌

| 变量 | 含义 |
|---|---|
| `--font-sans` / `--font-mono` | 正文（无衬线）/ 代码（等宽）字体 |
| `--radius-s/m/l` | 小/中/大圆角（7/10/16px） |
| `--shadow-1/2` | 轻/重阴影（深色主题自动为 none） |
| `--ease-out` | 统一缓动曲线，所有动效用它保持一致 |
| `--hl-*` | 代码高亮配色（配合 highlight.js） |

---

## 五、常用组件速查

| 想实现 | 用这些类名 |
|---|---|
| 页面骨架 | `.app` > `.topbar` + `main` + `.statusbar` |
| 主按钮 / 次按钮 / 小按钮 | `.btn.btn-primary` / `.btn.btn-ghost` / `.btn.btn-sm` |
| 开关 | `<label class="switch"><input type="checkbox"><span class="track"></span>文字</label>` |
| 指标徽章 | `.chip`（内含 `.k` 标签 + `.v` 数值，加 `.warn` 变警告色） |
| 双栏工作区 | `.results` > `.toolbar` + `.layout`（左侧 `.panel` 树 + 右侧 `.panel` 内容） |
| 弹窗 | `.modal-overlay` > `.modal`（含 `.modal-head/.modal-body/.modal-foot`） |
| 轻提示 | `.toast-wrap` 容器 + `.toast`，JS 加 `.show` 显示，`.error` 变红 |
| 加载中 | `.spinner` 转圈；`.progress-bar` 内 `.progress-fill` 是进度条 |
| 空状态首页 | `.empty` > `.empty-card`（含 `.empty-badge`、`h1`、`.lead`、`.dropzone`） |
| 拖拽上传区 | `.dropzone`（JS 拖入时加 `.drag` 类） |
| 氛围背景光 | 页面顶部放一个 `<div class="bg-glow" aria-hidden="true"></div>` |

> 想快速看效果？直接用浏览器打开 `demo.html`，点右上角月亮/太阳图标切换主题。

---

## 六、原项目 ↔ 移植包对照（方便你以后查）

| 原项目文件 | 移植包 | 说明 |
|---|---|---|
| `V5/style.css` 顶部变量段 | `tokens.css` | 原样提取，仅加了注释 |
| `V5/style.css` 组件段 | `components.css` | id 选择器改类名、删业务样式 |
| `V5/index.html` | demo.html | 演示用途 |
| `V5/app.js` | ❌ 未提取 | 功能逻辑（扫描/渲染），需按新项目需求用 Vue 重写 |
| `data/scenarios.json` | ❌ 未提取 | 场景配置数据，需要时复制 JSON 即可 |

---

## 七、常见问题（FAQ）

**1. 只引入 tokens.css，页面背景怎么没变色？**
检查 `<html>` 上有没有 `data-theme="light"` 或 `data-theme="dark"`。浅色令牌定义在 `:root[data-theme="light"]` 里，不写属性就匹配不到。也可以给 tokens.css 的 light 块再补一条 `:root` 选择器做兜底（新手建议直接写属性，最直观）。

**2. 深色模式下阴影没了，是 bug 吗？**
不是。原项目刻意在深色模式关闭阴影（`--shadow-1/2: none`），深色背景上阴影本来就看不见，关了更干净。

**3. 颜色为什么长这样 `oklch(97.6% 0.005 240)`？**
OKLCH 是比 hex/rgb 更科学的现代色彩表示（人类感知均匀）。绝大多数浏览器都支持，不需要转换。如果你想用普通 hex，直接替换成 `#f8f9fb` 这种写法即可，不影响其它功能。

**4. 我不用 Google Fonts 可以吗？**
可以。把 `--font-sans` / `--font-mono` 改成系统字体栈即可，例如 `system-ui, "Microsoft YaHei", sans-serif`。风格会有细微差异，但整体依然协调。

**5. 想改间距/尺寸？**
原项目没有全局间距变量（间距直接用 `gap`/`padding` 数值），你可以在 `tokens.css` 的通用块里自己加一组 `--space-1: 4px; --space-2: 8px; --space-3: 12px; …`，然后逐步替换。

---

## 八、接下来可以做的事

1. **先看效果**：打开 `demo.html` 预览这套样式。
2. **搭骨架**：新建 Vue 项目 → 按第二节 5 步接入 → 抄第三节的顶栏结构。
3. **换品牌色**：把 `--accent` 系列改成你项目的主色调（一键全局生效，这就是设计系统的威力）。
4. 需要我帮你**创建 Vue 项目并把这套系统接进去**，随时说一声。
