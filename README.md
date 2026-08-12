# Web Toolbox

纯静态小工具集合站 + 前端探索学习实验场。零后端、零构建，可一键部署 GitHub Pages。

> ⚠️ 访问方式提醒：本站分两类内容——**工具**（双击 `file://` 即可用）与**学习项目**（依赖 `fetch` 动态加载，必须通过 HTTP 服务访问）。

## 🛠 工具

| 工具 | 状态 | 说明 |
|------|------|------|
| 📖 [梦幻词栈 · 英语生词拾取器](./tools/en-words/) | ✅ 可用 | 粘贴英文 → 智能识别 TOP 生词 → 生词本复习；离线可用，支持 `file://` 直接打开 |
| 🔗 [Codebase Context](./tools/codebase-context/) | ✅ 可用 | 选择/拖拽项目文件夹 → 一键生成目录树 + 文件内容 Markdown，喂给 AI；纯浏览器聚合，数据不出设备，支持 `file://` 打开 |
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
# 1) 工具（en-words / codebase-context）：直接双击 index.html 即可
#    - codebase-context 在 file:// 下使用"上传文件夹"模式；
#      在 HTTPS / localhost 下额外支持目录选择 API（showDirectoryPicker）与剪贴板复制，体验完整

# 2) 学习项目（json_test / workbench）：需启动 HTTP 服务
python -m http.server 8080
# 然后访问：
#   http://localhost:8080/tools/json_test/
#   http://localhost:8080/tools/workbench/
```

线上访问（GitHub Pages）：`https://delux2557.github.io/web-toolbox/tools/<项目名>/`

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
-   Codebase Context 基于 File System Access API + 拖拽/上传多通道遍历，浏览器端聚合代码库为 Markdown
-   学习项目采用数据驱动渲染 / 插件化架构（fetch + manifest 声明式配置），需 HTTP 服务

## 后续计划

-   继续开发占位工具：⏱ 番茄时钟、{ } JSON 格式化、🎨 调色板工具
-   继续迭代学习项目：json_test（更多渲染模式）、workbench（更多插件与版本演进）
