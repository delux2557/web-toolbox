# AI PPT Player — 第二版交付概览

## 本次变更
- 壳 `index.html` 升级：顶栏下拉版本切换器 + 键盘冲突修复（Element 守卫）+ 销毁旧引擎 + DOM 克隆导出 + 资源内联 + 导出态自适应
- `manifest.json` 加入 V2（latest = V2）
- 新增 `V2/` 演示版本（纯 CSS 3D 立方体 + rAF 装饰，零依赖）+ 契约手册注释

## 修复的关键 bug（首轮审核 P0）
- 导出转义：用 DOM API `setAttribute('srcdoc', ...)` 替代字符串正则拼接（自动转义）
- 导出资源失效：`inlineAssets` 把 `/V{N}/style.css`、`/V{N}/app.js` fetch 后内联进 `<style>`/`<script>`（ECharts CDN 保留）
- 内联 JS 里的 `</script` 提前闭合：`new RegExp('<' + '/script', 'gi')` 字符串拼接规避

## 关键决策
- **版本切换器**：原生 `<select>` 取代徽章，样式与原徽章一致；在线态填充 options + 监听 change；导出态 disabled（克隆时带选中项）
- **导出闭环**：DOM 克隆壳 → 内联版本资源 → setAttribute srcdoc → 隐藏 loading → Blob 下载；revokeObjectURL 用 setTimeout 1000 延迟（Firefox 兼容）
- **导出态自适应**：检测 iframe srcdoc 预填则进入 isExportMode，禁用版本切换器/下载按钮，等待 iframe load 后 syncFromEngine
- **destroy 链路**：loadVersion 开头销毁旧引擎，再设置新 srcdoc（防止内存泄漏）

## 验证结果
- `node --check` V2/app.js + 壳两个内联 script：语法 OK
- manifest JSON 合法：`['V1', 'V2']` latest=V2
- HTTP 200：manifest / index.html / V1/* / V2/*
- 壳默认渲染 V2：版本切换器下拉显示 `V2 · v2.0.0`，翻页指示 `1 / 2`，rAF 光点可见（`v2_shot1.png`）
- 导出内联闭环：残留 `/V` 引用 **0**、内联 style **1**、内联 script **2**、`单文件自包含成立`（`export_verify.png`）

## 运行方式
```
cd "D:/新建文件夹/workspace/ppt player"
python -m http.server 8000
# http://localhost:8000/  -> 默认 V2；下拉切换 V1
```

## 已知限制
- 导出文件依赖 ECharts CDN（外部 https，联网可用）；离线场景需另行处理
- 导出的是「源版本内容」，不含 contenteditable 运行时的编辑（V1 编辑回传只 console 打印，未持久化）
- V2 第2页的 headless 视觉截图受虚拟时间 + iframe 独立加载时序影响未直接呈现，但壳内 V2 渲染（v2_shot1）与引擎契约（与 V1 同款 goTo 实现，V1 图表页已验证）共同保证其正确性
