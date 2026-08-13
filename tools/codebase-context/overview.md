# 交付说明 — 代码库上下文聚合工具（SPA 版本化，无闪烁）

## 目录结构
```
(根目录)
├── index.html       ← 壳（SPA）：骨架屏 + 主题前置 + fetch 注入版本
├── manifest.json    ← 版本注册表（latest 字段优先，语义版本兜底）
├── V1/index.html    ← v1 片段（内联 <style> + 内联 <script>）
├── V2/index.html    ← v2 片段（<link> + 标记 + <script src>，根相对路径）
├── V2/style.css     ← v2 全部样式（蓝紫 Indigo OKLCH）
├── V2/app.js        ← v2 全部逻辑
├── V3/index.html    ← v3 片段（代码高亮版：修复徽章对比度 + 新文案 + highlight.js）
├── V3/style.css     ← v3 样式（徽章对比度修复 + hljs token 配色）
├── V3/app.js        ← v3 逻辑（动态加载 highlight.js + 高亮渲染）
└── overview.md      ← 本文档
```

## V3 相对 V2 的改动
1. **徽章对比度修复**：`.empty-badge` / `.preview-banner` 文字色 `--accent-ink` → `--accent-strong`，亮暗色均回到 ~7:1（AA）。
2. **文案**：lead 改为「…复制或下载后直接用于 AI 对话」。
3. **代码高亮**：`app.js` 动态加载 highlight.js（cdnjs 11.9.0 common build），`renderCodeBlock` 用 `hljs.highlight` 生成高亮 HTML，行号模式用 `splitHighlighted` 保证 `<span>` 平衡；`style.css` 用 OKLCH token 定义明暗两套 `.hljs-*` 配色（不引入主题 CSS，只引入 JS）。

## 无闪烁原理
1. **不跳转**：壳是单页 SPA，`fetch` 版本片段后用 `innerHTML` 注入 `#app`，页面从不离开，无整页导航闪断。
2. **骨架屏**：首屏 HTML 内置脉冲点 `.loader-shell`，异步拉取 manifest + 版本片段期间全程兜底。
3. **主题前置**：壳 `<head>` 里同步执行主题引导脚本，**首帧前**给 `<html>` 设 `data-theme`（与 V2/app.js 共用 `cca-theme` key），消除「白→黑」主题闪。
4. **防 FOUC**：loader 先抽取版本片段里的 `<link>` 注入 `<head>` 并等其 `onload`，再注入标记 + 执行脚本。

## 壳加载流程
`fetch(manifest.json)` → 判定最新（`latest` 优先 / 语义版本最大兜底）→ `fetch({version}/index.html)` → 抽取 `<link>` 预加载 → `innerHTML` 注入 `#app` → 重新创建 `<script>` 执行内联/外链脚本。

## manifest.json
```json
{
  "schemaVersion": 1,
  "latest": "v3",
  "versions": [
    { "id": "v1", "version": "1.0.0", "label": "单文件版", "entry": "V1/index.html" },
    { "id": "v2", "version": "2.0.0", "label": "分离版（HTML/CSS/JS）", "entry": "V2/index.html" },
    { "id": "v3", "version": "3.0.0", "label": "代码高亮版", "entry": "V3/index.html" }
  ]
}
```

## 运行方式
- **必须用本地服务器**（fetch 注入方案下，`file://` 会被浏览器拦截 fetch 本地文件，壳会显示友好引导）：
  ```
  cd 项目根目录
  python -m http.server 8000
  # 打开 http://localhost:8000
  ```
- 未来加新版：在 `manifest.json` 的 `versions` 增项、更新 `latest`，壳无需改动。

## 校验结果
- `V3/app.js` 通过 `node --check`。
- 高亮冒烟测试通过：`splitHighlighted` 多行注释 span 平衡、`highlightCode` 兜底/支持语言/不支持语言、`renderCodeBlock` 转义防 XSS 与行号模式 span 平衡。
- 服务器实测：壳 / manifest（latest=v3）/ V1 / V2 / V3 片段均正确返回。
