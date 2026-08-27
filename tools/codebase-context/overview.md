# 交付说明 — 代码库上下文聚合工具（SPA 版本化，无闪烁）

## 版本基线

* 当前基线 **v7.0.1**，从 v7 起独立迭代；v4–v6 及更早版本已归档，目录与清单条目已移除，后续仅保留 v7 线。

* **v7.0.1 说明**：过滤规则可视化与透明度 —— 规则管理面板、结果区规则摘要、被跳过明细（含原因）、单文件放行、就地重聚合，并对新增 UI 进行了移动端适配与质感打磨。

## 目录结构

```
(根目录)
├── index.html        ← 壳（SPA）：骨架屏 + 主题前置 + fetch 注入版本
├── manifest.json     ← 版本注册表（latest 字段优先，语义版本兜底）
├── V7/               ← 当前版本（v7），ES Modules 化
│   ├── index.html    ← 应用页（由壳注入到根作用域，或直接访问）
│   ├── style.css     ← 设计令牌 + 组件样式（明暗主题，oklch）
│   └── src/
│       ├── main.js        ← 入口：流程状态机 + 事件挂载 + 启动
│       ├── state.js       ← 应用可变状态（含缓存/重聚合）
│       ├── dom.js         ← DOM 引用集中管理
│       ├── utils.js       ← 工具（格式化 / toast / 并发映射）
│       ├── security.js    ← HTML 转义等
│       ├── constants.js   ← 常量（并发数 / 复制上限 / 兜底场景）
│       ├── filters.js     ← 三层过滤规则模型 + 规则持久化 / 摘要
│       ├── filesystem.js  ← 遍历 / 分类 / 读取（含缓存）
│       ├── rules.js       ← 过滤规则面板 / 被跳过明细 / 就地重聚合 UI
│       ├── markdown.js    ← 导出 Markdown（System Prompt 注入）
│       ├── export.js      ← 复制 / 下载分流
│       ├── tree.js        ← 目录树构建与渲染
│       ├── preview.js     ← 内容预览（折叠感知 + 目录联动定位）
│       ├── renderer.js    ← Markdown → HTML（highlight.js + 高亮配色）
│       ├── scenario.js    ← 场景模板加载（scenarios.json / 兜底）
│       └── theme.js       ← 明暗主题 + 行号记忆
├── data/
│   ├── scenarios.json ← 场景模板（纯配置，零硬编码）
│   └── filters.json   ← 出厂过滤规则（忽略目录/文件 + 文本扩展名白名单）
└── overview.md        ← 本文档
```

## 过滤规则三层模型

1. **代码内置默认**（兜底）：`src/filters.js` 的 `FILTER_DEFAULTS`。
2. **出厂默认**：`data/filters.json`，可被覆盖加载。
3. **用户规则**：localStorage（`cca-user-rules`），由可视化面板增删，优先级最高；支持追加扩展名白名单、增量忽略目录/文件名、强制放行单个文件、调整大小上限与「无扩展名」开关，并可导入/导出 JSON。

优先级（高→低）：强制包含（放行）> 目录忽略 > 文件名忽略 > 内置硬规则 > 无扩展名 > 扩展名白名单。

## 无闪烁原理

1. **不跳转**：壳是单页 SPA，`fetch` 版本片段后用 `innerHTML` 注入 `#app`，页面从不离开，无整页导航闪断。
2. **骨架屏**：首屏 HTML 内置脉冲点 `.loader-shell`，异步拉取 manifest + 版本片段期间全程兜底。
3. **主题前置**：壳 `<head>` 里同步执行主题引导脚本，**首帧前**给 `<html>` 设 `data-theme`（与 V7/theme.js 共用 `cca-theme` key），消除「白→黑」主题闪。
4. **防 FOUC**：loader 先抽取版本片段里的 `<link>` 注入 `<head>` 并等其 `onload`，再注入标记 + 执行脚本。

## 壳加载流程

`fetch(manifest.json)` → 判定最新（`latest` 优先 / 语义版本最大兜底）→ `fetch(entry/index.html)` → 抽取 `<link>` 预加载 → `innerHTML` 注入 `#app` → 重新创建 `<script>` 执行内联/外链脚本。

## manifest.json

```json
{
  "schemaVersion": 1,
  "latest": "v7",
  "versions": [
    { "id": "v7", "version": "7.0.1", "label": "过滤规则配置化 · 可视化与透明度", "entry": "V7/index.html", "build": "config-driven", "buildTime": "2026-08-26 10:30" }
  ]
}
```

## 运行方式

* **必须用本地服务器**（fetch 注入方案下，`file://` 会被浏览器拦截 fetch 本地文件，壳会显示友好引导）：

  ```
  cd 项目根目录
  python -m http.server 8000
  # 打开 http://localhost:8000
  ```

* 后续迭代：在 `src/` 内改代码并升 `manifest.json` 与壳 `FALLBACK_MANIFEST`（两处需保持同步）的 `version` / `label` / `buildTime`。

## 校验结果

* `src/` 下各模块均通过 `node --check`。

* 浏览器验证：页面加载无 JS 错误；规则面板 / 结果区摘要 / 被跳过明细在桌面与移动端均正常渲染，明暗主题与既有风格一致。

* `data/scenarios.json` 解析通过；`data/filters.json` 解析通过（忽略目录/文件 + 文本扩展名白名单）。

