// ============================================================
// 核心类型定义（全项目的"宪法"）
// ------------------------------------------------------------
// 整个工具的设计哲学：配置驱动。
// 页面渲染什么、怎么编译提示词，全部由这份类型描述的数据决定。
// 新增一个业务场景（如"Bug 复现流程"），只需要：
//   1. 在 src/configs/ 下新建一个配置文件
//   2. 在 src/configs/index.ts 注册一行
// 完全不需要改任何组件代码。
// ============================================================

// ---------- 字段类型 ----------
// text     ：单行输入框（短文本，如"问题描述"）
// textarea ：多行文本框（长文本、代码、日志，如 SQL/DDL）
// file     ：文件上传区（V1 只记录文件名与大小，不读取文件内容）
export type FieldType = 'text' | 'textarea' | 'file'

// ---------- 字段原子（Field Atom）----------
// 一个"字段"就是一个最小可复用单元。
// 例如"问题描述"字段可以同时被"看板排查"和"SQL 优化"两个工作流使用。
export interface FieldMeta {
  /** 字段唯一标识，如 'issue-desc'。在模板中用 {{issue-desc}} 引用它 */
  id: string
  /** 渲染成哪种输入控件 */
  type: FieldType
  /** 界面显示的名称，如"问题描述" */
  label: string
  /** 输入框里的占位提示文字 */
  placeholder: string
  /**
   * 默认样板句（兜底值）：用户没输入时，编译提示词会自动使用它。
   * 它既是"引导示例"，也是"保底内容"，保证生成结果永远完整可用。
   */
  defaultValue: string
  /** 用户当前实际填写的值（运行时填充，配置阶段留空） */
  value?: FieldValue
  /** 是否允许添加多份内容（例如贴多份样例数据） */
  multiple?: boolean
  /** 是否为可选字段（用户可留空） */
  optional?: boolean
  /** 字段下方的辅助说明文字 */
  help?: string
}

// ---------- 字段的值 ----------
// 根据 type + multiple 组合：
//   text / textarea 单份  -> string
//   text / textarea 多份  -> string[]
//   file                 -> FileMeta[]
export type FieldValue = string | string[] | FileMeta[]

// 文件上传的元信息（V1 不存文件内容，防止撑爆 localStorage）
export interface FileMeta {
  name: string
  size: number
  type?: string
}

// ---------- 步骤（Recipe）----------
// 一个 Recipe = 工作流中的"一步"，包含若干字段。
// 例如"看板排查"的"问题描述"步骤。
export interface Recipe {
  /** 步骤唯一标识，如 'desc-step' */
  id: string
  /** 步骤名，如"第一步：问题描述" */
  name: string
  /** 步骤引导说明（展示在步骤卡片顶部） */
  description?: string
  /** 该步骤包含的字段（有序，按数组顺序渲染） */
  fields: FieldMeta[]
  /**
   * 编译模板（可选）：使用 {{fieldId}} 引用本步骤内的字段。
   * 例如："请分析以下问题：\n{{issue-desc}}"
   * 不写模板也没关系，编译器会自动按"步骤名 + 字段 + 内容"组装。
   */
  promptTemplate?: string
  /** 整步是否可跳过（如"贴报错日志"这一步经常用不到） */
  optional?: boolean
}

// ---------- 工作流定义（WorkflowDef）----------
// 一个完整的工作流 = 按顺序执行的一组步骤。
export interface WorkflowDef {
  /** 工作流唯一标识，如 'dashboard-troubleshoot' */
  id: string
  /** 所属分类（侧边栏按此分组），如"大数据"、"新媒体" */
  category: string
  /** 工作流名称，如"看板数据问题排查" */
  name: string
  /** 一句话说明这个工作流是干什么的 */
  description: string
  /** 有序的步骤列表 */
  recipes: Recipe[]
}

// ---------- 运行时：步骤草稿 ----------
// 用户在每一步填写的数据（含跳过状态、临时插入的字段）
export interface StepDraft {
  /** 用户是否跳过了这一步（跳过后编译时整步不输出） */
  skipped: boolean
  /** 该步骤各字段的值：fieldId -> 用户输入 */
  fields: Record<string, FieldValue>
  /** 用户临时插入的自定义字段（仅本次会话有效，不会写进全局配置） */
  tempFields: TempField[]
}

// 临时插入的字段（和 FieldMeta 一样，但由用户在界面上动态创建）
export interface TempField {
  /** 运行时生成的唯一 id，如 'temp-1755300000000' */
  id: string
  /** 字段名称（用户自己输入，如"执行计划"） */
  label: string
  /** 字段类型（V1 只支持 text/textarea） */
  type: 'text' | 'textarea'
  /** 用户填的值 */
  value: string
}

// ---------- 运行时：工作流草稿 ----------
// 当前正在编辑的工作流的完整快照（自动保存到 localStorage）
export interface WorkflowDraft {
  workflowId: string
  /** recipeId -> 该步骤的草稿 */
  stepDrafts: Record<string, StepDraft>
}

// ---------- 运行时：用户偏好 ----------
// 用户的个性化设置（跨会话保留）。与草稿分离：
//   草稿 = 每次填的内容；偏好 = 用户对工作流本身的定制。
export interface WorkflowPrefs {
  /** 用户隐藏的步骤（recipeId 列表），如老王永远用不到"贴报错" */
  hiddenRecipeIds: string[]
  /** 用户隐藏的字段（key 为 `${recipeId}.${fieldId}`） */
  hiddenFieldIds: string[]
  /** 用户调整过的字段顺序：recipeId -> 有序 fieldId 列表 */
  fieldOrder: Record<string, string[]>
  /** 用户修改过的样板句：`${recipeId}.${fieldId}` -> 新样板文字 */
  customDefaults: Record<string, string>
}

// ---------- 运行时：历史存档 ----------
// 用户点"保存历史"生成的一条记录（类似 AI 聊天记录，可回看、载入、删除）
export interface HistoryEntry {
  /** 存档唯一 id */
  id: string
  /** 显示名称，默认"工作流名 · 日期"，用户可重命名 */
  name: string
  /** 属于哪个工作流 */
  workflowId: string
  /** 冗余保存工作流名称（配置删除后历史仍可展示） */
  workflowName: string
  /** 存档时刻的内容快照 */
  draft: WorkflowDraft
  createdAt: number
  updatedAt: number
}

// ---------- 编译输出 ----------
export type OutputFormat = 'markdown' | 'json' | 'xml'

// 编译器输入：工作流定义 + 草稿 + 用户偏好（三者叠加出最终提示词）
export interface CompileInput {
  workflow: WorkflowDef
  draft: WorkflowDraft
  prefs: WorkflowPrefs
}
