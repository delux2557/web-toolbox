// ============================================================
// 插件注册表（统一入口）
// ------------------------------------------------------------
// 新增插件 = 在这里加一个 manifest，核心代码零改动。
//
// 两种接入方式：
//   kind='workflow'  → 复用现有工作流引擎（看板排查、小红书…）
//   kind='component' → 自定义组件（用 defineAsyncComponent 懒加载：
//                       开发模式 Vite 自动分包，单文件打包时全量内联）
// ============================================================
import { defineAsyncComponent } from 'vue'
import type { PluginManifest } from '@/types/plugin'
import { dashboardTroubleshoot } from '@/configs/dashboard-troubleshoot'
import { xiaohongshu } from '@/configs/xiaohongshu'

// 组件型插件：懒加载（点击才编译/加载；单文件模式下全部内联）
const UrlDecoder = defineAsyncComponent(() => import('@/components/plugins/UrlDecoder.vue'))
const TableHelper = defineAsyncComponent(() => import('@/components/plugins/TableHelper.vue'))

/** 全部插件（新增插件：在这里加一行） */
export const pluginRegistry: PluginManifest[] = [
  {
    id: 'dashboard-troubleshoot',
    name: '看板数据问题排查',
    category: '大数据',
    description: '业务反馈看板数字不对时，补齐现象、SQL、DDL 与样例数据，一次定位根因',
    kind: 'workflow',
    workflow: dashboardTroubleshoot,
  },
  {
    id: 'xiaohongshu-copywriting',
    name: '小红书文案创作',
    category: '新媒体',
    description: '按爆款标题 → 封面配图 → 正文互动 → 下期规划四步稳定产出种草笔记',
    kind: 'workflow',
    workflow: xiaohongshu,
  },
  {
    id: 'url-decoder',
    name: 'URL 解码',
    category: '开发工具',
    description: 'URL / 文本编解码小工具（组件型插件示例）',
    kind: 'component',
    component: UrlDecoder,
  },
  {
    id: 'table-helper',
    name: '表格助手',
    category: '数据处理',
    description: '粘贴表格代码，一键导出 CSV / JSON',
    kind: 'component',
    component: TableHelper,
  },
]

/** 按 id 查找插件（找不到返回 undefined） */
export function getPluginById(id: string): PluginManifest | undefined {
  return pluginRegistry.find((p) => p.id === id)
}

/** 按分类分组，供侧边栏渲染（返回 [分类名, 插件[]][]） */
export function groupPluginsByCategory(
  plugins: PluginManifest[],
): Array<[string, PluginManifest[]]> {
  const map = new Map<string, PluginManifest[]>()
  for (const p of plugins) {
    const list = map.get(p.category) ?? []
    list.push(p)
    map.set(p.category, list)
  }
  return [...map.entries()]
}
