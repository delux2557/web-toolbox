// ============================================================
// 示例工作流 1：看板数据问题排查（大数据场景）
// ------------------------------------------------------------
// 这就是"老王"的故事线：
//   问题描述 →（可选）报错日志 → 取数 SQL → 底层表 DDL + 样例数据
// 四步填完，一键编译成高质量排查提示词交给 AI。
//
// 📖 学习提示：这个文件里没有任何组件代码，纯数据。
// 想加一个新场景，照葫芦画瓢新建一个文件即可。
// ============================================================
import type { WorkflowDef } from '@/types/workflow'

export const dashboardTroubleshoot: WorkflowDef = {
  id: 'dashboard-troubleshoot',
  category: '大数据',
  name: '看板数据问题排查',
  description: '业务反馈看板数字不对时，引导你补齐现象、SQL、DDL 与样例数据，一次定位根因',
  recipes: [
    {
      id: 'desc-step',
      name: '问题描述',
      description: '先把现象说清楚：哪个指标、哪个时间段、预期多少、实际多少。AI 最怕模糊。',
      fields: [
        {
          id: 'issue-desc',
          type: 'text',
          label: '问题现象',
          placeholder: '例如：昨日 GMV 显示 120 万，实际应为 150 万',
          defaultValue: '请描述现象：指标【】，时间段【】，预期【】，实际【】',
          help: '填得越具体，AI 定位越快。数值和时间段是关键。',
        },
      ],
      // 编译模板：{{issue-desc}} 会被用户输入（或默认样板）替换
      promptTemplate: '## 问题描述\n{{issue-desc}}',
    },
    {
      id: 'error-step',
      name: '报错 / 异常日志',
      description: '如果有报错堆栈或异常日志，贴在这里；没有可以直接跳过。',
      optional: true,
      fields: [
        {
          id: 'error-log',
          type: 'textarea',
          label: '报错堆栈 / 日志',
          placeholder: '如有报错堆栈，请粘贴在此',
          defaultValue: '无报错日志',
          optional: true,
        },
      ],
    },
    {
      id: 'sql-step',
      name: '取数 SQL 与上游存储过程',
      description: '看板是从哪个 SQL / 存储过程取数的？整段贴过来，别截图。',
      fields: [
        {
          id: 'sql-code',
          type: 'textarea',
          label: '取数 SQL / 存储过程',
          placeholder: '从数据库客户端复制粘贴，代码会自动保持等宽字体',
          defaultValue: '-- 请粘贴看板取数 SQL 与上游加工该数据的存储过程',
        },
      ],
      promptTemplate: '## 取数 SQL 与上游存储过程\n```sql\n{{sql-code}}\n```',
    },
    {
      id: 'ddl-step',
      name: '底层表 DDL 与样例数据',
      description: '涉及的表结构长什么样？再给 10 行左右的真实样例数据（CSV 格式会自动表格预览）。',
      fields: [
        {
          id: 'ddl-code',
          type: 'textarea',
          label: '建表语句（DDL）',
          placeholder: '粘贴 CREATE TABLE ... 建表语句',
          defaultValue: '-- 请粘贴涉及的底层表建表语句',
        },
        {
          id: 'sample-data',
          type: 'textarea',
          label: '样例数据（CSV）',
          placeholder: 'date,gmv,channel\n2026-08-15,1200000,小程序',
          defaultValue: 'date,gmv,channel\n2026-08-15,1200000,小程序\n2026-08-14,1320000,小程序',
          help: 'CSV / JSON 格式会自动识别，可一键切换为表格预览',
          multiple: true,
        },
      ],
      promptTemplate:
        '## 底层表 DDL\n```sql\n{{ddl-code}}\n```\n\n## 样例数据\n```csv\n{{sample-data}}\n```',
    },
  ],
}
