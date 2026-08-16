// ============================================================
// 示例工作流 2：小红书文案创作（新媒体场景）
// ------------------------------------------------------------
// 证明"配置驱动"的通用性：同一个渲染引擎，换一套配置，
// 就变成了完全不同的业务场景。这一步还演示了 file 类型字段。
// ============================================================
import type { WorkflowDef } from '@/types/workflow'

export const xiaohongshu: WorkflowDef = {
  id: 'xiaohongshu-copywriting',
  category: '新媒体',
  name: '小红书文案创作',
  description: '按"爆款标题 → 封面配图 → 正文互动 → 下期规划"四步工业流程，稳定产出种草笔记',
  recipes: [
    {
      id: 'topic-step',
      name: '选题与标题',
      description: '确定本期主题，并给出 3 个备选标题，让 AI 帮你选出最可能爆的那个。',
      fields: [
        {
          id: 'topic',
          type: 'text',
          label: '核心主题',
          placeholder: '例如：通勤 15 分钟搞定的工作午餐便当',
          defaultValue: '本期要分享的主题：【】',
        },
        {
          id: 'titles',
          type: 'text',
          label: '备选标题',
          placeholder: '输入 1 个标题后点"添加一份"继续加',
          defaultValue: '备选标题：【】',
          multiple: true,
        },
      ],
      promptTemplate: '## 选题与标题\n主题：{{topic}}\n\n备选标题：\n{{titles}}',
    },
    {
      id: 'cover-step',
      name: '封面与配图',
      description: '描述你想要的封面风格，也可以上传参考图（V1 只记录文件名）。',
      fields: [
        {
          id: 'cover-style',
          type: 'textarea',
          label: '封面 / 配图风格要求',
          placeholder: '例如：暖色调、食物特写、大字标题居中、3:4 竖版',
          defaultValue: '封面风格要求：【】',
        },
        {
          id: 'cover-refs',
          type: 'file',
          label: '参考图上传',
          placeholder: '拖拽图片到此处，或点击选择文件',
          defaultValue: '（未上传参考图）',
          multiple: true,
        },
      ],
      promptTemplate: '## 封面与配图\n{{cover-style}}\n\n参考图：{{cover-refs}}',
    },
    {
      id: 'content-step',
      name: '正文与互动话术',
      description: '给出正文大纲、互动问题和话题标签，AI 会按小红书口吻成稿。',
      fields: [
        {
          id: 'body',
          type: 'textarea',
          label: '正文大纲 / 要点',
          placeholder: '列出想讲的核心内容点',
          defaultValue: '正文要点：【】',
        },
        {
          id: 'hooks',
          type: 'textarea',
          label: '互动问题与话术',
          placeholder: '例如：姐妹们平时午餐都怎么解决？',
          defaultValue: '互动问题：【】',
        },
        {
          id: 'hashtags',
          type: 'text',
          label: '话题标签',
          placeholder: '用逗号分隔，例如：打工人便当, 快手菜, 一人食',
          defaultValue: '#打工人日常 #快手美食',
        },
      ],
      promptTemplate:
        '## 正文与互动话术\n正文要点：\n{{body}}\n\n互动话术：\n{{hooks}}\n\n话题标签：{{hashtags}}',
    },
    {
      id: 'next-step',
      name: '下期内容规划',
      description: '顺手把下期主题定下来，形成持续更新的内容节奏。',
      optional: true,
      fields: [
        {
          id: 'next-topic',
          type: 'text',
          label: '下期主题方向',
          placeholder: '例如：办公室 3 分钟拉伸操',
          defaultValue: '下期主题：【】',
        },
      ],
      promptTemplate: '## 下期内容规划\n{{next-topic}}',
    },
  ],
}
