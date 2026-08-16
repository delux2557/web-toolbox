// ============================================================
// 编译器（核心业务逻辑）
// ------------------------------------------------------------
// 职责：把「工作流定义 + 用户草稿 + 用户偏好」三层叠加，
// 编译成最终提示词（Markdown / JSON / XML 三种格式）。
//
// 值的三层兜底优先级（值从哪来）：
//   1. 用户当前输入（草稿）
//   2. 用户修改过的样板句（偏好）
//   3. 字段默认样板句（配置）
// ============================================================
import type {
  CompileInput,
  FieldMeta,
  FieldValue,
  FileMeta,
  OutputFormat,
  Recipe,
  WorkflowPrefs,
  WorkflowDraft,
} from '@/types/workflow'
import { escapeXml, formatFileSize } from '@/utils/format'

/** 编译后的单个字段（给三个格式编译器共用） */
export interface CompiledField {
  id: string
  label: string
  value: string
}

/** 编译后的单个步骤 */
export interface CompiledStep {
  recipe: Recipe
  fields: CompiledField[]
}

// ---------- 1. 解析层：三层叠加 → 中间结构 ----------

/** 取一个字段的"最终值"（按上面的三层优先级） */
function resolveFieldValue(
  field: FieldMeta,
  recipeId: string,
  draft: WorkflowDraft,
  prefs: WorkflowPrefs,
): FieldValue | undefined {
  const userValue = draft.stepDrafts[recipeId]?.fields[field.id]
  // 用户填了 → 用用户的（注意 [] 算没填）
  if (userValue !== undefined && userValue !== '' && !(Array.isArray(userValue) && userValue.length === 0)) {
    return userValue
  }
  // 用户改过样板句 → 用用户版样板
  const custom = prefs.customDefaults[`${recipeId}.${field.id}`]
  if (custom !== undefined) return custom
  // 兜底：配置里的默认样板句
  return field.defaultValue
}

/** 把任意形态的字段值序列化成可展示的文本 */
function serializeValue(raw: FieldValue | undefined): string {
  if (raw === undefined || raw === null) return ''
  if (Array.isArray(raw)) {
    if (raw.length === 0) return ''
    // FileMeta[]（文件列表）→ "文件名 (大小)"
    if (typeof raw[0] === 'object') {
      return (raw as FileMeta[]).map((f) => `${f.name} (${formatFileSize(f.size)})`).join('\n')
    }
    // string[]：只有一份时直接展示（不强行加 "1."），多份才加编号
    if ((raw as string[]).length === 1) return raw[0] as string
    return (raw as string[]).map((s, i) => `${i + 1}. ${s}`).join('\n')
  }
  return raw
}

/**
 * 主解析函数：遍历所有步骤，过滤隐藏/跳过，
 * 产出每个步骤的"名称 + 字段列表"，供各格式编译器消费。
 */
export function buildCompiledSteps(input: CompileInput): CompiledStep[] {
  const { workflow, draft, prefs } = input
  const steps: CompiledStep[] = []

  for (const recipe of workflow.recipes) {
    // 用户隐藏了整个步骤 → 不编译
    if (prefs.hiddenRecipeIds.includes(recipe.id)) continue
    const stepDraft = draft.stepDrafts[recipe.id]
    // 用户跳过了这一步 → 不编译
    if (stepDraft?.skipped) continue

    const fields: CompiledField[] = []

    // 配置里定义的字段
    for (const field of recipe.fields) {
      // 用户隐藏了单个字段 → 跳过（但仍会被模板的默认值兜底）
      if (prefs.hiddenFieldIds.includes(`${recipe.id}.${field.id}`)) continue
      fields.push({
        id: field.id,
        label: field.label,
        value: serializeValue(resolveFieldValue(field, recipe.id, draft, prefs)),
      })
    }

    // 用户临时插入的字段（本次会话有效）
    for (const tf of stepDraft?.tempFields ?? []) {
      fields.push({ id: tf.id, label: tf.label, value: tf.value })
    }

    steps.push({ recipe, fields })
  }

  return steps
}

// ---------- 2. 模板渲染 ----------

/** 模板插值：把 {{fieldId}} 替换为字段值（字段不存在则替换为空） */
function renderTemplate(tpl: string, fields: Map<string, CompiledField>): string {
  return tpl.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, id: string) => fields.get(id)?.value ?? '')
}

/** 没有模板时的自动汇编：按"字段名 + 内容"组装 */
function autoAssemble(fields: CompiledField[]): string {
  return fields
    .map((f) => `### ${f.label}\n${f.value || '（未填写）'}`)
    .join('\n\n')
}

/**
 * 决定一个步骤用模板渲染还是自动汇编：
 * 只有当模板引用的字段全部存在时才用模板，否则自动汇编
 * （防止模板里引用了不存在的字段导致内容丢失）。
 */
function renderStep(recipe: Recipe, fields: CompiledField[]): string {
  const tpl = recipe.promptTemplate
  if (tpl) {
    const referenced = [...tpl.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)].map((m) => m[1])
    const allResolved = referenced.every((id) => fields.some((f) => f.id === id))
    if (allResolved) return renderTemplate(tpl, new Map(fields.map((f) => [f.id, f])))
  }
  return autoAssemble(fields)
}

// ---------- 3. 三个格式的编译器 ----------

/** Markdown：最适合直接粘给 AI 的格式 */
export function compileMarkdown(input: CompileInput): string {
  const steps = buildCompiledSteps(input)
  if (steps.length === 0) return ''

  const lines: string[] = [`# ${input.workflow.name}`, '']
  for (const step of steps) {
    lines.push(`## ${step.recipe.name}`)
    if (step.recipe.description) lines.push(`> ${step.recipe.description}`)
    lines.push('', renderStep(step.recipe, step.fields), '')
  }
  return lines.join('\n').trim() + '\n'
}

/** JSON：结构化数据，方便程序消费 */
export function compileJson(input: CompileInput): string {
  const steps = buildCompiledSteps(input)
  const data = {
    workflow: input.workflow.name,
    steps: steps.map((s) => ({
      name: s.recipe.name,
      fields: Object.fromEntries(s.fields.map((f) => [f.id, f.value])),
    })),
  }
  return JSON.stringify(data, null, 2)
}

/** XML：结构化数据的另一种表达 */
export function compileXml(input: CompileInput): string {
  const steps = buildCompiledSteps(input)
  const inner = steps
    .map(
      (s) =>
        `  <step name="${escapeXml(s.recipe.name)}">\n` +
        s.fields
          .map((f) => `    <field id="${escapeXml(f.id)}">${escapeXml(f.value)}</field>`)
          .join('\n') +
        `\n  </step>`,
    )
    .join('\n')
  return `<workflow name="${escapeXml(input.workflow.name)}">\n${inner}\n</workflow>`
}

/** 统一入口：按格式分发 */
export function compile(input: CompileInput, format: OutputFormat): string {
  switch (format) {
    case 'markdown':
      return compileMarkdown(input)
    case 'json':
      return compileJson(input)
    case 'xml':
      return compileXml(input)
  }
}
