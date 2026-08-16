// ============================================================
// 工作流注册表
// ------------------------------------------------------------
// 所有工作流配置都注册在这里。新增场景只需两步：
//   1. 在 src/configs/ 下新建 xxx.ts（照 dashboard-troubleshoot.ts 抄）
//   2. 把新配置加进下面的 workflowRegistry 数组
// 组件和状态管理完全不需要动。
// ============================================================
import type { WorkflowDef } from '@/types/workflow'
import { dashboardTroubleshoot } from './dashboard-troubleshoot'
import { xiaohongshu } from './xiaohongshu'

/** 全部工作流（新增场景：在这里加一行） */
export const workflowRegistry: WorkflowDef[] = [dashboardTroubleshoot, xiaohongshu]

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
