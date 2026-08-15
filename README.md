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
# 1) 静态工具（en-words / assessment-studio）：直接双击 index.html（或 test-v3.html）即可

# 2) SPA / fetch 项目（codebase-context / json_test / ppt-player / workbench）：需启动 HTTP 服务
python -m http.server 8080
# 然后访问：
#   http://localhost:8080/tools/codebase-context/
#   http://localhost:8080/tools/json_test/
#   http://localhost:8080/tools/ppt-player/
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
-   学习项目采用数据驱动渲染 / 插件化架构（fetch + manifest 声明式配置），需 HTTP 服务
-   Codebase Context 演进为 SPA 壳 + manifest 版本注册（fetch 注入版本片段 + 防 FOUC 预加载 + highlight.js 代码高亮），底层仍为 File System Access API / 拖拽 / 上传多通道聚合，需 HTTP 服务

## 后续计划

-   继续开发占位工具：⏱ 番茄时钟、{ } JSON 格式化、🎨 调色板工具
-   继续迭代学习项目：json_test（更多渲染模式）、workbench（更多插件与版本演进）
