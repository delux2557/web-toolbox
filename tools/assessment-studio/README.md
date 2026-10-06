# Assessment Studio · 在线考试系统

练习 / 考试双模式的自测平台：单选题 + 多选题 + 判断题，支持即时反馈、就地解析、计时、
进度分段条、题号导航、作答回顾、错题重练，可导出成给考生的单文件客户端。

## 目录结构

```
assessment-studio/
├── index.html            # 源码入口（结构 + 外链引用）。改结构改这里
├── css/
│   ├── tokens.css        # CSS 变量 + 暗色主题
│   └── app.css           # 版面与组件样式
├── js/
│   ├── theme-boot.js     # 首帧主题（防 FOUC），必须最先执行
│   ├── app.js            # 核心：状态 / DOM / 渲染 / 判分 / 模式 / 网格 / 计时 / 初始化
│   ├── parser.js         # CSV / JSON 试卷解析
│   ├── default-exam.js   # 内置默认题库（进页面即练的英语 70 题）
│   ├── storage.js        # localStorage 进度恢复 / 备份
│   └── export.js         # 模板下载 + 自包含单文件导出
├── build.config.json     # 交给 tools/_build/build-single.mjs
└── dist/                 # 构建产物（已 gitignore，勿手改）
```

**脚本顺序即依赖顺序**（`app.js` → `parser.js` → `default-exam.js` → `storage.js` → `export.js`），
拼接器按出现顺序内联，调整顺序前先确认跨文件的全局函数依赖。

## 日常使用

```bash
# 直接多文件运行（无需构建）
#   本地 HTTP：任意静态服务器指向本目录
#   file://  ：双击 index.html 也可（脚本均为传统 <script>，非 ESM）

# 打单文件（供离线分发 / 双击使用）
node tools/_build/build-single.mjs assessment-studio   # → dist/index.html
```

## 改题库

- 题库在 `js/default-exam.js` 的 `DEFAULT_EXAM`，字段：`{ id, type, content, options, answer, explain }`；
  `type` 取 `single` / `multi` / `judge`，`answer` 是**选项下标数组**（判断题 `[0]`=正确、`[1]`=错误）。
- 改完题库请**同时改 `bankVersion`**：浏览器本地进度按题库版本失效，版本不变会导致用户拿到
  与新题库错位的旧进度。
- 题目/解析里若出现 `<` `>`（尤其 `</script>`），**必须写成 `\u003c` / `\u003e`** —— 拼接器是把本文件
  原样内联进 `<script>` 的，字面 `</script>` 会提前闭合标签、把后面的代码变成页面文本。
  当前题库不含这类字符（已核对：字面 `<`/`>` 均为 0 处），所以文件里看不到转义；以后加题时留神。
