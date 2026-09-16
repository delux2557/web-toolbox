# Web Toolbox

纯静态小工具集合站 + 前端探索学习实验场。零后端、零构建，可一键部署 GitHub Pages。

> ⚠️ 访问方式提醒：站内项目分两类——**静态工具**（如 en-words，双击 `file://` 即可用）与 **SPA / fetch 项目**（依赖 `fetch` 动态加载，必须通过 HTTP 服务访问：codebase-context、json_test、ppt-player、workbench）。

## 🛠 工具

| 工具 | 状态 | 说明 |
|------|------|------|
| 📖 [梦幻词栈 · 英语生词拾取器](./tools/en-words/) | ✅ 可用 | 粘贴英文 → 智能识别 TOP 生词 → 生词本复习；离线可用，支持 `file://` 直接打开 |
| 🔗 [Codebase Context](./tools/codebase-context/) | ✅ 可用 | 选择/拖拽项目文件夹 → 一键生成目录树 + 文件内容 Markdown，喂给 AI；纯浏览器聚合，数据不出设备。SPA 壳 + manifest 多版本注册（单文件 → 分离 → 代码高亮 → 场景化 System Prompt），**需 HTTP 服务访问** |
| 📽 [PPT Player](./tools/ppt-player/) | ✅ 可用 | 演示文稿播放器：SPA 壳 + manifest 版本注册（V1 示例 / V2 纯 CSS 极简引擎），版本切换 + 导出单文件（DOM 克隆 + 资源内联）；**需 HTTP 服务访问** |
| 📝 [Assessment Studio](./tools/assessment-studio/test-v3.html) | ✅ 可用 | 在线考试系统 V3.3：练习/考试双模式 + 即时反馈 + 计时评分；单文件纯静态，支持 `file://` 直接打开 |
| 📋 [表格解析工具 · Table Helper](./tools/table-helper/) | ✅ 可用 | CSV / JSON / HTML 表格解析与互转：粘贴或导入 → 预览、排序筛选、导出；纯静态多模块架构，支持 `file://` 直接打开（独立纯静态页面，表格解析互转的主体实现） |
| ✨ [Prompt Helper](./tools/prompt-helper/) | ✅ 可用 | AI 提示词工作台：把提问变成按最佳实践填空（配置驱动模板）；插件化架构（PluginHost 宿主 + 可插拔插件）+ 多主题系统；Vite + Vue 构建，[在线版 release/latest.html](./tools/prompt-helper/release/latest.html)（单文件，可下载后双击使用） |
| ⏱ 番茄时钟 | 🔜 占位 | 简洁番茄工作法计时器（规划中，后续继续做） |
| { } JSON 格式化 | 🔜 占位 | JSON 格式化、校验、树形浏览（规划中，后续继续做） |
| 🎨 调色板工具 | 🔜 占位 | 颜色拾取、渐变生成（规划中，后续继续做） |

## 🧪 前端探索学习项目

> 非正式工具，是我练习前端架构/数据驱动渲染的实验项目。二者都通过 `fetch` 加载数据与模块，**不能双击 `file://` 直接打开**，需通过 HTTP 服务访问（本地或 GitHub Pages）。

| 项目 | 探索方向 | 说明 |
|------|---------|------|
| [json_test](./tools/json_test/) | JSON 数据驱动渲染 | 数据与视图完全分离：`fetch('data.json?t=' + Date.now())` 动态加载新闻数据渲染卡片，含缓存绕过与加载/错误状态处理 |
| [workbench](./tools/workbench/) | 插件化应用架构 | manifest 声明式配置 + 核心加载器（core/loader.js 按 `activeVersion` 注入版本）+ 独立插件（todo / weather，`data-mount` 自动挂载）+ 数据驾驶舱（echarts + KPI/趋势/日志）+ 全局主题系统 |

## 本地使用

```bash
# 1) 静态工具（en-words / assessment-studio / table-helper）：直接双击 index.html（或 test-v3.html）即可

# 2) SPA / fetch 项目（codebase-context / json_test / ppt-player / workbench）：需启动 HTTP 服务
python -m http.server 8080
# 然后访问：
#   http://localhost:8080/tools/codebase-context/
#   http://localhost:8080/tools/json_test/
#   http://localhost:8080/tools/ppt-player/
#   http://localhost:8080/tools/workbench/
```

线上访问（GitHub Pages）：`https://delux2557.github.io/web-toolbox/tools/<项目名>/`

### 单文件构建（可选）

两个打包器分工不同，**按工具的架构选一个**即可：

| 打包器 | 适用架构 | 交互方式 |
|--------|---------|---------|
| `build-single.mjs` | 传统单页工具（完整 HTML + 多个 `<script src>`） | 在 `tools/<工具名>/build.config.json` 显式接入 |
| `build-snapshot.mjs` | **SPA 壳 + manifest 版本注册**（片段 entry + ESM src） | 读 `manifest.json`，**零配置**；一条命令打包任意历史版本 |

#### 1) 传统单页工具 → build-single

```bash
node tools/_build/build-single.mjs              # 构建所有已声明配置的工具
node tools/_build/build-single.mjs table-helper # 只构建指定工具
```

- 接入：在 `tools/<工具名>/build.config.json` 声明 `{ "entry": "index.html", "out": "dist/index.html" }`
- 传统多 script 工具（如 table-helper）原位内联、语义等价；ESM 源工具需加 `"esm": true` + `modules` 拓扑序清单

#### 2) 版本快照 → build-snapshot（codebase-context / code-workspace / ppt-player）

把「某个版本」打成**可 file:// 双击、可外发**的单文件 HTML —— 壳、loader、fetch 依赖全部消除：

```bash
node tools/_build/build-snapshot.mjs                     # 所有可识别工具的 latest
node tools/_build/build-snapshot.mjs codebase-context    # 指定工具（默认 latest）
node tools/_build/build-snapshot.mjs codebase-context@v7 # 指定版本 id（历史版本也能打）
node tools/_build/build-snapshot.mjs --list              # 列出可打包的工具与版本
node tools/_build/build-snapshot.mjs --release           # 输出到 tools/<name>/release/（入库分享）
node tools/_build/build-snapshot.mjs --strict            # 存在阻塞型外链则构建失败（CI 用）
```

产物默认落在 `tools/<name>/dist/<name>-<版本id>.html`（`dist/` 已被 gitignore）。

> **并行开发友好**：打包器**只读**工具目录下的源文件，唯一写入是产物本身（不生成中间文件、不改源码、不往工具目录写配置）。所以工具哪怕正在被别的分支/开发者迭代，也随时可以打包 —— 快照 = 打包那一刻的源码状态，等迭代收尾后重跑一次即自动跟随，没有任何登记步骤。
>
> 反过来说：`verify-snapshot.mjs` 验收的是 `dist/` 里**现存**的产物，源码改过之后要先重新构建再验收。

**打进去的东西**（都是自动识别，不看配置）：

1. 片段 entry（如 `V7/index.html`）→ 从壳 `index.html` 借 `<head>` 骨架（丢弃其 loader 引导脚本）
2. 本地 `<link rel=stylesheet>` → `<style>`；图标 → data URI；其它本地 `<link>` → 移除
3. `<script type="module" src>` → **自动解析 import 图**（拓扑序）→ 模块注册表（每个模块独立作用域，杜绝重名冲突）；传统 `<script src>` 原位内联
4. `data/**.json` 与模块内 `fetch("...")` → 内联数据表 + fetch 垫片（**源码零改写**）
5. `new URL(rel, import.meta.url)` / `import(url)` → 虚拟基址 + 动态导入垫片（**vendor 懒加载包照样懒加载**，如 code-workspace 的 1.4MB CodeMirror）
6. 版本元数据（`data-version` / `window.__APP_META__`）+ 版本徽章（原壳逻辑的精简等价实现）

**构建期硬自检**（失败即中止，不产出半成品）：每个模块 `new Function` 语法检查、bundle 整体语法检查、产物无残留 `import/export/import.meta`、无残留本地 `<script src>` / `<link href>`、动态导入目标必须都在注册表内。

**外链分两档**：字体托管（视觉降级，功能不受影响）与**阻塞型外链**（CDN 脚本/样式，离线时功能失效 —— 例如 codebase-context 的 highlight.js CDN，离线时自动回落纯文本高亮）。想彻底离线就把它 vendor 到本地，或在 `build.snapshot.json` 的 `allowRemote` 里显式声明可接受。

可选覆盖配置 `tools/<name>/build.snapshot.json`：

```json
{ "dataDirs": ["data"], "extraAssets": ["vendor/x.js"], "allowRemote": ["https://example.com/"] }
```

#### 产物验收（不开浏览器）

```bash
node tools/_build/verify-snapshot.mjs                     # 验收所有 dist/*.html
node tools/_build/verify-snapshot.mjs tools/code-workspace/dist/code-workspace-v1.html
```

用最小 DOM 桩在 Node 里真跑一遍产物，覆盖「构建期语法通过 ≠ 运行时能跑」的盲区：脚本可执行、注册表完整、**每个模块都能实例化**（含 vendor 大包）、内联数据与 fetch 垫片命中、动态导入目标已内联。`SNAPSHOT_DEBUG=1` 会打印失败堆栈。

## 拾词 · 功能说明

「梦幻词栈」是一个离线英语生词识别工具：

-   **智能识别**：粘贴英文文本，自动分析词频，筛选 TOP 生词
-   **离线词典**：基于 CET4/CET6 分级词库，完全不依赖网络
-   **生词本**：加入生词本后可在复习页进行自测、标记掌握、导出
-   **纯浏览器**：所有数据存储在 localStorage，不离开你的设备

### 数据来源

离线词典数据来自 [ECDICT](https://github.com/skywind3000/ECDICT)（skywind3000 开源项目），
选取 CET4/CET6 词条构建子集，在此致谢。

## 技术路线

-   纯静态 HTML/CSS/JS，零外部依赖
-   词典数据以 `window.EWDICT` 形式通过 `<script>` 加载（en-words）
-   识别引擎使用策略模式，为二期 AI 识别预留扩展点
-   学习项目采用数据驱动渲染 / 插件化架构（fetch + manifest 声明式配置），需 HTTP 服务
-   Codebase Context 演进为 SPA 壳 + manifest 版本注册（fetch 注入版本片段 + 防 FOUC 预加载 + highlight.js 代码高亮），底层仍为 File System Access API / 拖拽 / 上传多通道聚合，需 HTTP 服务

## 后续计划

-   继续开发占位工具：⏱ 番茄时钟、{ } JSON 格式化、🎨 调色板工具
-   继续迭代学习项目：json_test（更多渲染模式）、workbench（更多插件与版本演进）
