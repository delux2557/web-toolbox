# Web Toolbox

纯静态小工具集合站 + 前端探索学习实验场。零后端、零构建，可一键部署 GitHub Pages。

> ⚠️ 访问方式提醒：站内项目分两类——**静态工具**（如 en-words，双击 `file://` 即可用）与 **SPA / fetch 项目**（依赖 `fetch` 动态加载，必须通过 HTTP 服务访问：codebase-context、code-workspace、ppt-player、workbench）。后者可用 `build-snapshot.mjs` 打成可双击的单文件快照（见下方「单文件构建」）。

## 🛠 工具

| 工具 | 状态 | 说明 |
|------|------|------|
| 📖 [梦幻词栈 · 英语生词拾取器](./tools/en-words/) | ✅ 可用 | 粘贴英文 → 智能识别 TOP 生词 → 生词本复习；离线可用，支持 `file://` 直接打开 |
| 🔗 [Codebase Context](./tools/codebase-context/) | ✅ 可用 | 选择/拖拽项目文件夹 → 一键生成目录树 + 文件内容 Markdown，喂给 AI；纯浏览器聚合，数据不出设备。SPA 壳 + manifest 多版本注册（单文件 → 分离 → 代码高亮 → 场景化 System Prompt），**需 HTTP 服务访问**；也可打成单文件快照双击使用 |
| 🗂 [Code Workspace](./tools/code-workspace/) | ✅ 可用 | 浏览器里的文件管理器 + 代码编辑器：授权本地文件夹读写 → 目录树浏览、新建/重命名/移动/删除、离线 CodeMirror 6 改代码 `Ctrl+S` 写回磁盘；SPA 壳 + manifest 版本注册，零 CDN，**需 HTTP 服务访问**（也可打成单文件快照） |
| 📽 [PPT Player](./tools/ppt-player/) | ✅ 可用 | 演示文稿播放器：SPA 壳 + manifest 版本注册（V1 示例 / V2 纯 CSS 极简引擎），版本切换 + 导出单文件（DOM 克隆 + 资源内联）；**需 HTTP 服务访问** |
| 📝 [Assessment Studio](./tools/assessment-studio/test-v3.html) | ✅ 可用 | 在线考试系统 V3.3：练习/考试双模式 + 即时反馈 + 计时评分；单文件纯静态，支持 `file://` 直接打开 |
| 📋 [表格解析工具 · Table Helper](./tools/table-helper/) | ✅ 可用 | CSV / JSON / HTML 表格解析与互转：粘贴或导入 → 预览、排序筛选、导出；纯静态多模块架构，支持 `file://` 直接打开（独立纯静态页面，表格解析互转的主体实现） |
| 🧮 [Excel / CSV 转 SQL](./tools/excel2sql/) | ✅ 可用 | 把表格每一行转成可粘贴的 SQL：**UNION ALL 内联表** / **INSERT 分批** × **4 种方言**（SQL Server / MySQL / Oracle / PostgreSQL）；**表头行自动识别且可点选改判**（识别理由如实回显，宁可保守也不静默丢数据）；**列级类型统一**（同列混有文本则整列字符串化，躲开 `UNION ALL` 隐式转换）；零依赖原生解析 `.xlsx`（ZIP + `DecompressionStream('deflate-raw')`，无需任何第三方库）/ `.csv`（UTF-8↔GB18030 编码探测 + 分隔符探测）；**超 15 位整数保留为文本**（JS 双精度会悄悄改写末尾几位）、**纯日期默认按命令行版行为输出 `00:00:00`** 并提供精确判定开关；每份产物带头注释说明「哪些列是被迫按字符串输出的、为什么」；解析、生成全在本地，**文件不上传**。零依赖多文件静态页，**支持 `file://` 双击直接用** |
| { } [JSON 格式化](./tools/json-format/) | ✅ 可用 | 粘贴 JSON 或**把文件拖进来** → 格式化（2/4/Tab 缩进）/ 压缩 / **递归排序键名**（数组保序）/ 校验；结果可**一键复制**（带降级方案）或**下载成 .json**。报错带行号列号 + 中文解释 + 截断提示；超 15 位整数告警精度可能被改写，**重复键告警**（`JSON.parse` 只留最后一个、静默丢掉前面的）；输出区**语法高亮 + 缩进参考线**（键/字符串/数字/字面量分色；超大输出退成纯文本，判据是**元素数**而不是字节数——真正的成本是 DOM 节点）；大输入**分帧渐进渲染**（先出前 200 行、其余按帧补齐，顶部细进度条 + 顶栏「正在着色…」）；结果超过 **1 万行**时默认**只画开头那一段**（说明条报出总行数与实际画了多少，旁边「显示全部」按钮按需展开；**复制与下载任何时候拿到的都是完整结果**，与画到第几行无关）；导入大文件**先出「正在载入 X MB / N 行」再动手**（把大段文本塞进 textarea 是一次 1–3 秒的同步阻塞排版，冻住之前先说一句，而不是留一个没有任何解释的死界面）；输出区**自动换行开关**（`Alt+Z` 或顶栏按钮，输入 / 结果两栏同开同关，默认不折行；长串也会在格内断开，不只是按空白折）；零依赖单文件，**支持 `file://` 双击直接用**（无需 HTTP、无需构建） |
| ✨ [Prompt Helper](./tools/prompt-helper/) | ✅ 可用 | AI 提示词工作台：把提问变成按最佳实践填空（配置驱动模板）；插件化架构（PluginHost 宿主 + 可插拔插件）+ 多主题系统；Vite + Vue 构建，[在线版 release/latest.html](./tools/prompt-helper/release/latest.html)（单文件，可下载后双击使用） |
| 🔓 [URL 解码工具](./tools/url-helper/) | ✅ 可用 | 粘贴 URL（每行一个，支持批量）→ **自动循环解码**（最多 10 层，含定点保护防死循环）→ 提取帆软 `viewlet` / `reportlet` 文件路径（值多层编码时二次解码）；单条看**逐步解码过程**，多条出结果表并支持导出 CSV（含 BOM）/ 仅复制路径。零依赖单文件，**支持 `file://` 双击直接用** |
| 🧩 [URL 传参分析](./tools/param-analysis/) | ✅ 可用 | 粘贴 URL（支持批量）→ 结构拆解（协议 / 主机 / 端口 / 路径 / hash）+ **逐参数独立解码**（层数可见，`+` 按空格处理）+ **类型识别**（嵌套 URL / 嵌套查询串 / JSON / 时间戳 / Base64 疑似）+ 同名标注 + 帆软 `viewlet` / `reportlet` 高亮；**参数明细 / 参数宽表**双视图，导出 CSV（跟随当前视图）/ 复制 JSON；**不发起任何网络请求**。零依赖单文件，**支持 `file://` 双击直接用** |
| ⏱ 番茄时钟 | 🔜 占位 | 简洁番茄工作法计时器（规划中，后续继续做） |
| 🎨 调色板工具 | 🔜 占位 | 颜色拾取、渐变生成（规划中，后续继续做） |

## 🧪 前端探索学习项目

> 非正式工具，是我练习前端架构的实验项目。依赖 `fetch` 加载数据与模块，**不能双击 `file://` 直接打开**，需通过 HTTP 服务访问（本地或 GitHub Pages）。

| 项目 | 探索方向 | 说明 |
|------|---------|------|
| [workbench](./tools/workbench/) | 插件化应用架构 | manifest 声明式配置 + 核心加载器（core/loader.js 按 `activeVersion` 注入版本）+ 独立插件（todo / weather，`data-mount` 自动挂载）+ 数据驾驶舱（echarts + KPI/趋势/日志）+ 全局主题系统 |

## 本地使用

```bash
# 1) 静态工具（en-words / assessment-studio / table-helper / excel2sql / json-format）：直接双击 index.html（或 test-v3.html）即可

# 2) SPA / fetch 项目（codebase-context / code-workspace / ppt-player / workbench）：需启动 HTTP 服务
python -m http.server 8080
# 然后访问：
#   http://localhost:8080/tools/codebase-context/
#   http://localhost:8080/tools/code-workspace/
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

### 单工具自检：Excel / CSV 转 SQL

`tools/excel2sql/` 的逻辑是"算错了也不报错、只是数据悄悄变样"的那一类，所以按**两层**自检，
两层都是零依赖（只用 Node 内建模块 + 工具自身 `.js`），不需要浏览器、不需要装任何包：

```bash
node tools/_build/check-excel2sql.mjs      # 第 1 层：纯逻辑（解析 / 表头 / 类型 / 渲染）
node tools/_build/check-excel2sql-ui.mjs   # 第 2 层：界面接线（DOM 桩 + 真实操作序列）
```

两层分工不是重复，而是因为**纯函数全绿 + 界面一抛异常 = 用户看到白屏或「点了没反应」**：

- **第 1 层（108 项）** 把 `js/` 下四个模块按页面加载顺序拼进一个函数体直接跑，覆盖
  零依赖解析真 `.xlsx`（两个夹具：openpyxl 的 `inlineStr` 与真实 Excel 的 `sharedStrings`）、
  表头打分与两道保护、列级类型统一、四方言的字面量与转义（含 `']'`、`'` 的注入防护）、
  日期兼容模式开关、性能护栏阈值；另含一批**静态一致性**断言（`app.js` 引用的 id 都在 `index.html`、
  脚本加载顺序、`settings` 每个键都真接进了 `sqlOptions()`）。
- **第 2 层（202 项）** 用一个**记账式 DOM 桩**加载全部 7 个脚本，然后按真实用户路径走一遍：
  拖入文件 → 表头识别与点选改判 → 换方言 → 切包裹方式 → 开关日期模式 → 生成 → 下载 → 退回空态。
  三条桩上的纪律值得记下来：① `getElementById` 的注册表**从 `index.html` 预填**（含 `hidden` 属性），
  查不到就返回 `null` —— 于是"id 拼错"变成一条免费断言；② `textContent` 按真实 DOM 语义建模
  （节点序列拼接，`appendChild` 不顶掉已有文本），否则"文本有没有写进去"会假阴；
  ③ `execCommand` 留**可控的失败开关**，把"复制两条路都不通"那条降级分支真跑到。
  另有一节**静态契约**直接读源文件：桩不解析 HTML 文本，所以排版类前提（`[hidden]` 的 `!important`、
  分栏由 grid 表达、次级文字对比度门槛、窄屏堆叠的 flex 前提）只能在这一层守。

两层都做过**反向实验**（故意改坏源文件，逐条确认"该红的那条真红了、且还原来即绿"）。
这一步抓出过三个测试自身的问题：一条**假守卫**（断言"有动作按钮"却命中了没有 click 处理器的包裹层
`<div>`）、一处**覆盖盲区**（「裸 SELECT」包裹方式从没被点开过）、以及一条**选错载体的断言**
（"含第 2 行"在"保守取第 1 行"的兜底文案里也成立）。顺带发现产品侧两个真问题并修掉：
`innerHTML` 拼字符串（改为纯 DOM 节点）、分段控件每点一次就重建按钮（按钮被换成新对象、丢掉键盘焦点）。

### 反向实验（mutation testing）：Excel / CSV 转 SQL

自检回答"现在过不过"，反向实验回答"**测试还咬不咬人**"：把源文件故意改坏一处，
期望闸门变红、而且红的正是那条该红的断言。断言一旦变成恒真（假守卫）或覆盖不到（盲区），这里立刻暴露 ——
这是唯一能测"测试本身"的机制。

```bash
node tools/_build/mutation-excel2sql.mjs            # 跑全部用例
node tools/_build/mutation-excel2sql.mjs --only=ui  # 只跑界面接线那几类
```

用例表在 `tools/_build/mutation-cases.json`：每条 = 一处（或多处）变异 + `expect`（**失败行里必须出现的子串**），
后者保证不只是"变红了"，还"红对了地方"。当前 11 条用例全部咬到。

**不接进 CI**，因为 ① 它会改源文件；② 每条用例都要起一次子进程跑整道闸门，偏慢。改完断言或布局后手动跑一次即可。

两条硬规矩（都是踩出来的）：

- **变异必须自证真的动到了文件**。`find` 命中 0 处或 >1 处一律判为"用例自身无效"并报错退出 ——
  否则就是空转变绿。真踩过：变异串里写了 `\n`，而源文件是 **CRLF**，`replace` 静默无操作，
  于是"改坏了还全绿"，差点误判成假守卫。runner 现按目标文件真实行尾自适应。
- **`expect` 要写具体的断言文案**，别只判"有没有失败"。同一次改坏常常连带多条断言变红，
  只判"红了"会掩盖"该红的那条其实没红"。

迁移进仓库后立刻抓到的**真问题**：`分栏结构由 grid 表达` 这条用的是全文正则
`/\.esq-layout\s*\{[^}]*grid-template-columns/` —— 窄屏媒体查询里那条 `.esq-layout` 同样带
`grid-template-columns`，所以**桌面基础规则被删掉之后它照样绿**。已改为只取**首条**（即基础）规则。

### 仓库自检：门户一致性

同一份「工具清单」在仓库里存了两份 —— 本 README 的「🛠 工具」表与根 `index.html` 的卡片网格，
两边没有任何机制强制同步，于是必然漂移。历史上已真实发生过两回：code-workspace 上线了门户里没有卡片；
json-format 上线了，那张「JSON 格式化」还挂着 `disabled` 占位卡。

```bash
node tools/_build/check-portal-sync.mjs    # 退出码 0 = 一致，1 = 有漂移
```

比对 10 项：可用/占位条目数、**双向集合差**（README 有门户缺 / 门户有 README 缺）、显示名一致、
链接目标真实存在（防「删了目录忘删卡片」）、**状态交叉**（README 标 ✅ 可用但门户仍是「敬请期待」占位卡，以及反向）。

两点设计取舍：

- **按语义条目比对，不用 slug 关键字 grep**。卡片标题是中文显示名（「JSON 格式化」），既不含 slug `json-format`
  也不含被删的 `json_test` —— `grep -rn` 会显示"无残留"而卡还挂在那儿，这次就是这么踩的。
- **只比「🛠 工具」一节**。下方「🧪 前端探索学习项目」是 README 里明确声明过的非正式实验项目，按设计不进门户。

### 持续集成

`.github/workflows/ci.yml` 在 **PR** 与 **push 到 main** 上跑同样 8 道闸门（也是本地一条条能跑通的命令）：

| 闸门 | 断言 |
|------|------|
| `check-portal-sync.mjs` | 10 · 门户一致性 |
| `code-workspace/tests/run-all.mjs` | 253 · 悬空引用 / 逻辑 / 接线 / 文档防过期 |
| `json-format/tests/format.test.mjs` | 344 · 形态契约 / 报错定位 / 词法器 / 重复键（含线性度） / 高亮与参考线 / 渐进渲染 / 大结果视口化与「显示全部」 / 导入先出提示 / 主题外观契约 / 自动换行开关 / UI 冒烟 |
| `check-excel2sql.mjs` | 108 · 解析 / 表头 / 类型 / 四方言渲染 / 静态一致性 |
| `check-excel2sql-ui.mjs` | 202 · DOM 桩下的界面接线与真实操作序列 + 静态契约（布局/对比度门槛） |
| `build-single.mjs` | 传统单页内联产物 |
| `build-snapshot.mjs` | SPA 快照（codebase-context / code-workspace / ppt-player） |
| `verify-snapshot.mjs` | 19 · 快照产物在 vm 里真跑一遍 |

几个刻意的选择：

- **`checks` 是 main 的 required status check**，不是「只会跑」的摆设：红了 PR 会被 GitHub 判成
  `blocked`，合并按钮按不动（实测 `mergeable_state: blocked`）。注意分支保护里
  `enforce_admins = false` —— 仓库 owner 仍可显式绕过（也正因如此，ops 才能直推 main 做收尾），
  这道规则对协作者 / 机器人是硬拦。
- **没有 `npm install`，没有 cache**。仓库零依赖，全是零构建的静态工具 + 零依赖 Node 脚本；加安装步骤只是噪音。
- **构建只读已提交的源文件**（`vendor/codemirror` 是入库的），产物落进 gitignore 的 `dist/`，
  所以 CI 里能从零复现。构建是**确定性**的 —— 同一份源码重建出的快照与本地逐字节一致（`md5` 已验证），
  否则「CI 绿」就没有意义。
- **`build-snapshot` 不加 `--strict`**：codebase-context 有一处阻塞型外链（highlight.js CDN，离线时回落纯文本高亮），
  `--strict` 会把它判成失败。
- Node 锁 **22**（脚本用到 `import.meta.dirname`，需 ≥ 20.11）；`actions/checkout` 与 `actions/setup-node` 用 **v7**。

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

-   继续开发占位工具：⏱ 番茄时钟、🎨 调色板工具
-   继续迭代学习项目：workbench（更多插件与版本演进）
-   JSON 格式化后续可加：**输出区语法高亮 + 缩进参考线**（需先把输出区从 `<textarea>` 换成 `<pre>`，并引入通用 `tokenize` 词法器）、**重复键检测**（`JSON.parse` 会静默丢掉前面的重复键，只能在原始文本上扫）、树形折叠浏览、JSONPath 过滤、与 code-workspace 打通（选中文件直接格式化）
