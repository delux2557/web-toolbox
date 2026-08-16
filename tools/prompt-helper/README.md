# Prompt Helper · AI 提示词工作台

> 把"向 AI 提问"变成"按最佳实践填空"——一款配置驱动的结构化提示词生成工具。

老王遇到看板数据异常时，按四个步骤填好现象 → SQL → DDL → 样例数据，一键编译成高质量排查提示词，发给 ChatGPT 一次就定位到根因。本工具就是这个"引导员"。

---

## 🚀 快速上手

```bash
npm install            # 安装依赖
npm run dev            # 启动开发服务器（默认 http://localhost:5173）
npm run test           # 跑单元测试
npm run build          # 单文件打包 → dist/latest/index.html（双击即用）
npm run release -- --version v1.0.0 --message "修复了XXX"   # 版本化发布
npm run preview        # 预览生产构建
```

### 📦 版本化发布（分发给别人）

每次迭代后，把整个应用打包成一个**独立的 `index.html`**（所有 JS/CSS 内联），发给同事/朋友——他们不需要装 Node.js，**双击就能用**（数据存各自浏览器 localStorage，互不影响）。

**普通打包**（最新版）：
```bash
npm run build
# → dist/latest/index.html（旧文件自动备份为 index.html.bak）
```

**版本化发布**（归档 + 发布说明）：
```bash
npm run release -- --version v1.2.0 --message "修复了XXX" --message "新增了YYY"
# → dist/v1.2.0/index.html          ← 带版本号的归档
# → dist/v1.2.0/RELEASE.md          ← 发布说明（自动生成）
# → dist/latest/index.html          ← 同步更新最新版（含 .bak 备份）
# → 自动清理 dist/ 下不属于任何版本的孤立文件
```

- 不写 `--version` 时自动读取 `package.json` 的 `version` 字段
- 每次发布，`latest/` 的旧文件会备份为 `latest/index.html.bak` 作回退
- 归档结构：`dist/v1.0.0/`、`dist/v1.1.0/`、… + `dist/latest/`（始终指向最新）

**注意事项**：
- 单文件约 130KB（gzip 47KB），无需优化；唯一外链是 Google Fonts（断网时自动回退系统字体）
- `file://` 协议下 `navigator.clipboard` 可能受限，代码已内置 `execCommand` 兜底
- 构建流程：`vite build` 先产到 `dist/.tmp-build/`（临时），再由 `scripts/build.mjs` 布置到正式位置——这是为了**避免 vite 清空 dist 时误删历史版本归档**

---

## 📁 项目结构

每行右侧是"这个目录/文件是干什么的"。**建议按顺序读**，5 分钟就能理解全貌。

```
src/
├── main.ts                          ← 项目入口：挂载 Vue 应用 + 全局导入样式
├── App.vue                          ← 应用根组件：侧边栏 + 主区 + 全局 Toast
├── vite-env.d.ts                    ← Vite/TS 类型声明
│
├── types/
│   └── workflow.ts                  ← ★ 全项目的"宪法"：所有数据结构的定义
│                                      新增任何字段都先改这里，再去改组件和编译器
│
├── configs/                         ← ★ 工作流配置（"配置驱动"的核心）
│   ├── index.ts                     ←   工作流注册表（新增场景在这里加一行）
│   ├── dashboard-troubleshoot.ts    ←   示例：看板数据问题排查（大数据）
│   └── xiaohongshu.ts               ←   示例：小红书文案创作（新媒体）
│
├── stores/                          ← Pinia 状态管理
│   ├── workflow.ts                  ←   当前工作流 / 草稿 / 用户偏好
│   └── history.ts                   ←   历史存档列表
│
├── composables/                     ← 组合式函数（Vue 3 复用逻辑的方式）
│   ├── usePersistence.ts            ←   localStorage 封装（可插拔，未来换 IndexedDB）
│   ├── useTheme.ts                  ←   明暗主题（改 <html data-theme>）
│   └── useToast.ts                  ←   全局轻提示队列
│
├── compilers/                       ← 编译器（核心业务逻辑）
│   ├── index.ts                     ←   Markdown / JSON / XML 三种格式编译
│   └── index.test.ts                ←   编译器的单元测试（改编译器前先看这里）
│
├── utils/                           ← 通用工具
│   ├── csv.ts                       ←   CSV / JSON 检测与表格解析
│   ├── csv.test.ts                  ←   解析器的单元测试
│   └── format.ts                    ←   时间格式化、文件大小、XML 转义、id 生成
│
├── components/                      ← UI 组件（"配置驱动"的渲染层）
│   ├── Sidebar.vue                  ←   左侧边栏：场景列表 + 历史记录
│   ├── TopBar.vue                   ←   顶栏：进度条 + 保存历史 + 生成提示词
│   ├── AnchorNav.vue                ←   步骤锚点导航（点击跳转 + 高亮当前步骤）
│   ├── RecipeCard.vue               ←   单个步骤卡片（含跳过开关 + 临时插字段）
│   ├── FieldRenderer.vue            ←   ★ 动态字段渲染器（text/textarea/file 三种类型）
│   ├── CsvPreview.vue               ←   CSV/JSON 自动检测 + 表格预览
│   ├── OutputPanel.vue              ←   输出面板：格式切换 + 复制 + 下载
│   └── Modal.vue                    ←   通用弹窗
│
├── views/
│   └── WorkflowView.vue             ← 主工作流视图：组装上面所有组件
│
└── styles/
    ├── design-extras.css            ← 补充 design-system 缺失的样式
    │                                 （侧边栏/输入框/锚点/步骤卡片等）
    └── themes/                      ← 主题系统（v1.5+，多维主题）
        ├── color.css                ← 颜色层：data-color="light|dark"
        ├── styles.css               ← 形态层：data-style="clean|glass|industrial"
        └── index.css                ← 主题入口（main.ts 最后导入）
```

**主题架构（v1.5+）**：明暗（`data-color`）与视觉风格（`data-style`）是两个独立维度，可自由组合出 2×3 套主题。视觉权威在 `src/styles/themes/`（后加载覆盖）；`design-system/` 提供默认基底（v1.5 起也收敛了硬编码，随风格变量联动）。切换主题时**任何 Vue 组件代码零改动**——这就是"CSS 变量 + data 属性"换肤的原理。

---

## 🧩 怎么新增一个工作流场景

**核心承诺：新增一个业务场景，只改两个文件，零修改任何组件代码。**

### 第一步：写一个配置文件

在 `src/configs/` 下新建一个文件，命名按业务类型，例如 `bug-reproduce.ts`（Bug 复现流程）：

```ts
import type { WorkflowDef } from '@/types/workflow'

export const bugReproduce: WorkflowDef = {
  id: 'bug-reproduce',                              // 唯一 id（小写英文+连字符）
  category: '软件开发',                              // 侧边栏分组
  name: 'Bug 复现流程',                              // 显示名
  description: '一步步引导复现 Bug 并整理给 AI',     // 侧边栏副标题
  recipes: [
    {
      id: 'overview-step',
      name: 'Bug 概览',
      description: '一句话说清出了什么问题',         // 步骤引导
      fields: [
        {
          id: 'bug-title',
          type: 'text',
          label: 'Bug 标题',
          placeholder: '例如：用户头像上传后显示错位',
          defaultValue: '请描述 Bug：【】',           // 兜底样板句
          help: 'AI 看第一眼就靠这句话',
        },
      ],
      promptTemplate: '## Bug 概览\n{{bug-title}}',  // 可选：自定义编译格式
    },
    {
      id: 'repro-step',
      name: '复现步骤',
      fields: [
        {
          id: 'steps',
          type: 'textarea',
          label: '操作步骤',
          placeholder: '1. 打开... 2. 点击... 3. 看到...',
          defaultValue: '复现步骤：【】',
          multiple: true,                            // 允许添加多份
        },
      ],
      // 没写 promptTemplate → 自动按"字段名 + 内容"组装
    },
    {
      id: 'env-step',
      name: '环境信息',
      optional: true,                                 // 整步可跳过
      fields: [
        {
          id: 'os',
          type: 'text',
          label: '操作系统',
          defaultValue: 'OS: Windows 11',
        },
      ],
    },
  ],
}
```

### 第二步：注册到工作流表

打开 `src/configs/index.ts`，加两行：

```ts
import { bugReproduce } from './bug-reproduce'  // 1. 引入

export const workflowRegistry: WorkflowDef[] = [
  dashboardTroubleshoot,
  xiaohongshu,
  bugReproduce,                                 // 2. 加进数组
]
```

### 完成

打开应用，侧边栏"软件开发"分类下就出现了「Bug 复现流程」。所有组件（字段渲染、编译器、输出面板、跳过开关……）**自动适配**，不需要改任何 Vue 文件。

### 字段类型速查

| `type` | 渲染成 | 适用场景 |
|---|---|---|
| `text` | 单行输入框 | 短文本（标题、标签） |
| `textarea` | 多行文本框 + 自动 CSV/JSON 预览 | 长文本、代码、样例数据 |
| `file` | 拖拽上传区 | 附件（V1 只记录文件名+大小，不读内容） |

### 字段可选属性

| 属性 | 作用 |
|---|---|
| `placeholder` | 输入框占位提示文字 |
| `defaultValue` | **样板句**：用户没填时编译用这个；既是引导也是兜底 |
| `multiple: true` | 允许添加多份（点"添加一份"按钮） |
| `optional: true` | 字段或步骤可跳过（界面显示"跳过本步"开关） |
| `help` | 字段下方的辅助说明文字 |

### 编译模板语法

每个 `Recipe` 可选 `promptTemplate`，里面用 `{{fieldId}}` 引用该步骤的字段：

```ts
promptTemplate: '请分析：\n## {{title}}\n\n## {{detail}}'
```

**不写模板也能用**——编译器会自动按"步骤名 + 字段 + 内容"组装。新手建议先不写模板，等熟悉了再加。

### "魔法"配置

用户可以"隐藏步骤 / 隐藏字段 / 改样板句 / 调字段顺序"，这些**都不用配**，运行时用户自己操作，会自动存到 localStorage（key 见 `usePersistence.ts` 的 `STORAGE_KEYS`）。

---

## 🛠 常见开发任务

### 调整样式

视觉全部来自 `design-system/`（上游基底）+ `src/styles/design-extras.css`（业务补充）+ `src/styles/themes/`（主题权威层，v1.5+）。改 design-extras 里某个类的样式，立即热更新生效。明暗/风格通过 CSS 变量自动切换（侧边栏底部"色系 × 风格"选择器）。

### 修改编译器规则

`src/compilers/index.ts` 是核心业务逻辑。改完必须跑 `npm run test`——单元测试覆盖了：模板插值、默认兜底、跳过/隐藏、multiple、file、自动汇编、JSON/XML 输出。

### 添加新的"全局功能"（比如导出 PDF）

1. 在 `src/utils/` 加工具函数
2. 在 `src/components/` 加 UI 组件
3. 在 `WorkflowView.vue` 里组合进来
4. **不需要**改配置或编译器

### localStorage 数据格式

| key | 内容 |
|---|---|
| `ph:theme` | `'light'` / `'dark'` |
| `ph:prefs` | `WorkflowPrefs` 对象（隐藏/样板句偏好） |
| `ph:draft:{workflowId}` | `WorkflowDraft` 草稿（每个工作流一份） |
| `ph:history` | `HistoryEntry[]` 历史存档列表 |

浏览器 DevTools → Application → Local Storage 可查看和手动修改。

---

## 📦 技术栈

- **Vue 3.5** + Composition API
- **Vite 8** 构建
- **TypeScript 5.9**（strict 严格模式）
- **Pinia 4** 状态管理
- **Vitest 4** 单元测试
- 零第三方 UI 库：所有样式来自 `design-system/` + 项目层 `styles/`（themes 主题系统）

---

## 📝 备注

- localStorage 有 5MB 容量限制；如果用户填了大量文本接近上限，`usePersistence.ts` 会静默降级（不抛错），数据可能丢失——这是浏览器限制。
- `recommendationGraph` 智能推荐气泡、V2 文件内容读取、IndexedDB、多语言、工作流并行编辑——这些都预留了架构位，等真实需求出现时再加，不做"想象中需要的功能"。