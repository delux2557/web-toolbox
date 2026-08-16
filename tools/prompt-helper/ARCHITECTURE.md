# 架构文档（ARCHITECTURE）

> 本项目的定位不是"一个工具"，而是**企业效率胶水平台**：
> 把日常重复的"人肉操作"固化为可配置的流程；把散落的"小工具"变成可插拔的插件；把"提示词"变成 AI 能力的统一入口。

---

## 一、三层架构

```
┌─────────────────────────────────────────────────────┐
│ 底座层 · 应用壳（不认识任何插件）                      │
│   App.vue（骨架） · Sidebar（插件列表）               │
│   PluginHost（按 kind 分发） · TopBar · Toast · 主题  │
├─────────────────────────────────────────────────────┤
│ 内核层 · 插件契约与运行时（不可变，扩能力才改这里）      │
│   types/plugin.ts（PluginManifest 契约）             │
│   plugins/index.ts（注册表） · stores/launcher.ts     │
│   stores/pluginBus.ts（通信总线） · services/（平台服务）│
├─────────────────────────────────────────────────────┤
│ 插件层 · 按契约接入（新增能力全在这里，不改内核）        │
│   kind='workflow'  → 数据驱动，复用现有工作流引擎       │
│   kind='component' → 自定义 Vue 组件                  │
└─────────────────────────────────────────────────────┘
支撑：design-system（视觉令牌） · Pinia（共享状态） · localStorage（本地优先）
```

**铁律**：底座层禁止 `import` 具体插件；插件只依赖"契约 + 标准工具箱"（composables、services、设计系统类名），不依赖底座内部。

---

## 二、插件契约（PluginManifest）

见 `src/types/plugin.ts`。两类插件：

| kind | 形态 | 渲染方式 | 适用 |
|---|---|---|---|
| `workflow` | `WorkflowDef` 数据 | 现有工作流引擎（编译/字段/历史/CSV 预览） | 多步骤引导式任务（看板排查、小红书） |
| `component` | Vue 组件 | `<component :is>` 动态渲染 | 单页小工具（URL 解码、代码格式化） |

### 新增一个插件（两处改动，零改核心）

**1. workflow 型**：`src/configs/` 新建数据文件（照 `dashboard-troubleshoot.ts` 抄）→ 注册表加一行。

**2. component 型**：`src/components/plugins/` 新建组件（照 `UrlDecoder.vue` 抄，顶部有注释模板）→ 注册表加一行：

```ts
// src/plugins/index.ts
const MyTool = defineAsyncComponent(() => import('@/components/plugins/MyTool.vue'))

{ id: 'my-tool', name: '我的工具', category: '开发工具',
  description: '一句话说明', kind: 'component', component: MyTool },
```

---

## 三、插件通信规则

- **唯一通道**：`usePluginBus`（类型化事件总线）或共享 Store 的**公开 action**。
- **禁止**：插件直接 import 另一个插件组件内部的组件/状态（会破坏松耦合）。
- 新增事件在 `src/stores/pluginBus.ts` 的 `BusEvents` 接口声明（类型安全，写错事件名编译直接报错）。
- 订阅后记得退订（`on` 返回取消函数，组件 `onUnmounted` 时调用）。

---

## 四、平台服务抽象（services/）与能力边界

插件通过 `api`（见 `src/services/index.ts`）访问平台能力，**不感知本地还是云端**：

| 能力 | 本地实现（LocalApiProvider） | 云端实现（未来 HttpApiProvider） |
|---|---|---|
| `persist/load` | localStorage（按插件隔离命名空间） | 服务端数据库 |
| `aiGenerate` | 用户自备 API Key + OpenAI 兼容接口 | 服务端代理（Key 不外泄） |
| `pushConnector` | webhook URL / 降级为复制 | 服务端推送（可 OAuth） |

**纯前端能力边界（当前单文件分发）**：
- ✅ 可做：本地存储、AI 生成（用户自备 Key）、webhook 推送、复制粘贴
- ❌ 不可做：OAuth 授权、无用户操作的定时任务、云端聚合、多端同步

**服务端演进**：实现 `HttpApiProvider` → 在 `services/index.ts` 切换 → **所有插件零改动**。

---

## 五、双轨构建（预留）

当前以**单文件分发**为主（`npm run build` / `npm run release` → 一个自包含 HTML，双击即用）。

为插件量大/内网部署预留的分支（未启用）：

```bash
# vite.config.ts 中：
#   process.env.SINGLE_FILE === 'false' 时跳过 viteSingleFile，输出代码拆分版
# package.json 中：
#   "build:multi": "cross-env SINGLE_FILE=false vue-tsc --noEmit && vite build"
```

两个版本的取舍：
- **单文件**：体积随插件数量线性增长（当前 140KB，100 个插件约 1~3MB），换取零安装零部署
- **拆分版**：首屏只加载核心，插件按需加载，适合内网静态服务器部署

---

## 六、演进路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 1（当前） | PluginManifest + 统一注册表 + 组件型插件示例 + 通信总线 + 服务抽象 | ✅ v1.3.0 |
| Phase 2 | `roles[]` 角色过滤（本地无账号，角色由用户在设置选择）+ 插件级设置面板 | 预留 |
| Phase 3 | connector/agent 型插件（webhook 连接器、AI 代理，基于 services/） | 预留 |
| Phase 4 | HttpApiProvider（有服务端后切换，插件零改动） | 预留 |
