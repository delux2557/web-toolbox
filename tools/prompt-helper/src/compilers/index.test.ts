// ============================================================
// 编译器单元测试
// ------------------------------------------------------------
// 核心业务逻辑的"保险丝"：保证值兜底、模板插值、跳过/隐藏
// 等规则永远符合预期。改编译器时先跑一遍这里。
// ============================================================
import { describe, expect, it } from 'vitest'
import { compile } from './index'
import { dashboardTroubleshoot } from '@/configs/dashboard-troubleshoot'
import { xiaohongshu } from '@/configs/xiaohongshu'
import type { CompileInput, WorkflowDraft, WorkflowPrefs } from '@/types/workflow'

/** 构造一份测试输入：默认全空草稿 + 空偏好 */
function makeInput(draft?: Partial<WorkflowDraft>, prefs?: Partial<WorkflowPrefs>): CompileInput {
  return {
    workflow: dashboardTroubleshoot,
    draft: {
      workflowId: 'dashboard-troubleshoot',
      stepDrafts: {},
      ...draft,
    },
    prefs: {
      hiddenRecipeIds: [],
      hiddenFieldIds: [],
      fieldOrder: {},
      customDefaults: {},
      ...prefs,
    },
  }
}

describe('Markdown 编译', () => {
  it('全空草稿：用默认样板句兜底，输出完整且包含所有步骤', () => {
    const out = compile(makeInput(), 'markdown')
    expect(out).toContain('# 看板数据问题排查')
    expect(out).toContain('## 问题描述')
    expect(out).toContain('## 报错 / 异常日志')
    expect(out).toContain('## 取数 SQL 与上游存储过程')
    expect(out).toContain('## 底层表 DDL 与样例数据')
    // 默认样板句出现在输出里（兜底生效）
    expect(out).toContain('请描述现象：指标【】')
    expect(out).toContain('无报错日志')
  })

  it('模板插值：用户输入替换 {{fieldId}} 占位', () => {
    const out = compile(
      makeInput({
        stepDrafts: {
          'desc-step': {
            skipped: false,
            fields: { 'issue-desc': '昨日 GMV 显示 120 万，实际应为 150 万' },
            tempFields: [],
          },
        },
      }),
      'markdown',
    )
    expect(out).toContain('昨日 GMV 显示 120 万，实际应为 150 万')
    expect(out).not.toContain('请描述现象：指标【】')
  })

  it('跳过整步：输出中不包含该步骤', () => {
    const out = compile(
      makeInput({
        stepDrafts: {
          'error-step': { skipped: true, fields: {}, tempFields: [] },
        },
      }),
      'markdown',
    )
    expect(out).not.toContain('报错 / 异常日志')
  })

  it('用户偏好隐藏步骤：输出中不包含该步骤', () => {
    const out = compile(makeInput(undefined, { hiddenRecipeIds: ['error-step'] }), 'markdown')
    expect(out).not.toContain('报错 / 异常日志')
  })

  it('无模板的步骤自动汇编（字段名 + 内容）', () => {
    const out = compile(
      makeInput({
        stepDrafts: {
          'error-step': {
            skipped: false,
            fields: { 'error-log': 'java.lang.NullPointerException' },
            tempFields: [],
          },
        },
      }),
      'markdown',
    )
    expect(out).toContain('### 报错堆栈 / 日志')
    expect(out).toContain('java.lang.NullPointerException')
  })

  it('multiple 多份内容：编号列出', () => {
    const out = compile(
      makeInput({
        stepDrafts: {
          'ddl-step': {
            skipped: false,
            fields: { 'sample-data': ['第一份数据', '第二份数据'] },
            tempFields: [],
          },
        },
      }),
      'markdown',
    )
    expect(out).toContain('1. 第一份数据')
    expect(out).toContain('2. 第二份数据')
  })

  it('multiple 只有一份时直接展示，不强行加 "1."', () => {
    const out = compile(
      makeInput({
        stepDrafts: {
          'ddl-step': {
            skipped: false,
            fields: { 'sample-data': ['只有一份'] },
            tempFields: [],
          },
        },
      }),
      'markdown',
    )
    expect(out).toContain('只有一份')
    expect(out).not.toContain('1. ')
  })

  it('文件字段：输出文件名与大小', () => {
    const out = compile(
      {
        workflow: xiaohongshu,
        draft: {
          workflowId: xiaohongshu.id,
          stepDrafts: {
            'cover-step': {
              skipped: false,
              fields: { 'cover-refs': [{ name: '参考图.png', size: 2048 }] },
              tempFields: [],
            },
          },
        },
        prefs: {
          hiddenRecipeIds: [],
          hiddenFieldIds: [],
          fieldOrder: {},
          customDefaults: {},
        },
      },
      'markdown',
    )
    expect(out).toContain('参考图.png (2.0 KB)')
  })

  it('用户改过的样板句优先于配置默认', () => {
    const out = compile(
      makeInput(undefined, { customDefaults: { 'desc-step.issue-desc': '老王专用描述样板' } }),
      'markdown',
    )
    expect(out).toContain('老王专用描述样板')
  })
})

describe('JSON / XML 编译', () => {
  it('JSON：可被 JSON.parse 解析且结构正确', () => {
    const out = compile(makeInput(), 'json')
    const data = JSON.parse(out) as { workflow: string; steps: Array<{ name: string }> }
    expect(data.workflow).toBe('看板数据问题排查')
    expect(data.steps.some((s) => s.name === '问题描述')).toBe(true)
  })

  it('XML：包含 workflow 根节点与字段，特殊字符被转义', () => {
    const out = compile(
      makeInput({
        stepDrafts: {
          'desc-step': {
            skipped: false,
            fields: { 'issue-desc': 'GMV < 150 万 & 报表' },
            tempFields: [],
          },
        },
      }),
      'xml',
    )
    expect(out).toContain('<workflow name="看板数据问题排查">')
    expect(out).toContain('GMV &lt; 150 万 &amp; 报表')
  })
})
