// ============================================================
// 插件契约（PluginManifest）—— 平台的内核"宪法"
// ------------------------------------------------------------
// 设计哲学：底座（应用壳）不认识任何具体插件，只认识这份契约。
// 新增能力 = 在 plugins/index.ts 注册一份 manifest，不改任何核心代码。
//
// 两类插件：
//   kind='workflow'  → 数据驱动，复用现有工作流引擎（编译/字段/历史/CSV 预览）
//   kind='component' → 自定义 Vue 组件，走动态组件渲染（<component :is>）
//
// 未来扩展（本版本不实现，契约已预留字段）：
//   roles[]          → 角色过滤（本地无账号体系，角色由用户设置选择）
//   kind='connector' / 'agent' → 连接器 / AI 代理（接入 services/ 抽象层）
// ============================================================
import type { Component } from 'vue'
import type { WorkflowDef } from './workflow'

export type PluginKind = 'workflow' | 'component'

export interface PluginManifest {
  /** 插件唯一标识，如 'url-decoder'（工作流型 = workflow.id） */
  id: string
  /** 显示名称（侧边栏） */
  name: string
  /** 所属分类（侧边栏分组），如 "大数据"、"新媒体"、"开发工具" */
  category: string
  /** 一句话说明（侧边栏副标题） */
  description: string
  /** 插件类型：按 kind 分发渲染 */
  kind: PluginKind
  /** 可见角色（预留）：空数组 = 所有人可见 */
  roles?: string[]
  /** kind='workflow' 时必须提供：完整的工作流定义 */
  workflow?: WorkflowDef
  /** kind='component' 时必须提供：自定义组件（建议用 defineAsyncComponent 懒加载） */
  component?: Component
}
