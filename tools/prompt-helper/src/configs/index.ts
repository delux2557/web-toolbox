// ============================================================
// 工作流配置出口（兼容层）
// ------------------------------------------------------------
// 工作流的"数据文件"（dashboard-troubleshoot.ts 等）仍在这里，
// 但注册已上移到 src/plugins/index.ts（统一插件注册表）。
// 本文件把插件表里 kind='workflow' 的插件投影为工作流列表，
// 让 stores/workflow.ts 等旧代码零改动继续工作。
// ============================================================
import type { WorkflowDef } from '@/types/workflow'
import { pluginRegistry } from '@/plugins'
import { dashboardTroubleshoot } from './dashboard-troubleshoot'
import { xiaohongshu } from './xiaohongshu'

// 保留这两个具名导出：新配置文件的"抄作业模板"引用它们，防止被摇树优化误删
export { dashboardTroubleshoot, xiaohongshu }

/** 全部工作流 = 插件表里 kind='workflow' 的投影 */
export const workflowRegistry: WorkflowDef[] = pluginRegistry
  .filter((p) => p.kind === 'workflow' && p.workflow !== undefined)
  .map((p) => p.workflow as WorkflowDef)

/** 按 id 查找工作流（找不到返回 undefined） */
export function getWorkflowById(id: string): WorkflowDef | undefined {
  return workflowRegistry.find((w) => w.id === id)
}

/** 按分类分组，供侧边栏渲染（返回 [分类名, 该分类下的工作流[]][]） */
export function groupWorkflowsByCategory(workflows: WorkflowDef[]): Array<[string, WorkflowDef[]]> {
  const map = new Map<string, WorkflowDef[]>()
  for (const wf of workflows) {
    const list = map.get(wf.category) ?? []
    list.push(wf)
    map.set(wf.category, list)
  }
  return [...map.entries()]
}
