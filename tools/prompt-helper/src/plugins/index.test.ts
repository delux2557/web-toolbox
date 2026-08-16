// ============================================================
// 插件注册表单元测试
// ------------------------------------------------------------
// 保证"新增插件只改注册表"这件事不会悄悄破坏平台契约：
//   - id 全局唯一
//   - kind='workflow' 的插件必须携带完整 WorkflowDef，且 id 一致
//   - kind='component' 的插件必须携带组件
// ============================================================
import { describe, expect, it } from 'vitest'
import { pluginRegistry } from './index'

describe('插件注册表契约', () => {
  it('id 全局唯一，且分类/名称非空', () => {
    const ids = pluginRegistry.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of pluginRegistry) {
      expect(p.name.trim().length).toBeGreaterThan(0)
      expect(p.category.trim().length).toBeGreaterThan(0)
    }
  })

  it('workflow 型插件：携带完整工作流定义，且 manifest.id === workflow.id', () => {
    const workflows = pluginRegistry.filter((p) => p.kind === 'workflow')
    expect(workflows.length).toBeGreaterThan(0)
    for (const p of workflows) {
      expect(p.workflow).toBeDefined()
      expect(p.workflow!.id).toBe(p.id)
      expect(p.workflow!.recipes.length).toBeGreaterThan(0)
      expect(p.component).toBeUndefined()
    }
  })

  it('component 型插件：携带组件，且不应携带 workflow', () => {
    const components = pluginRegistry.filter((p) => p.kind === 'component')
    expect(components.length).toBeGreaterThan(0)
    for (const p of components) {
      expect(p.component).toBeDefined()
      expect(p.workflow).toBeUndefined()
    }
  })
})
