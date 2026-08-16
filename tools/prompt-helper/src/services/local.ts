// ============================================================
// 本地实现（LocalApiProvider）—— 单文件分发下的能力边界
// ------------------------------------------------------------
// 纯前端、零后端的约束下，平台能力按以下方式落地：
//   persist / load  → localStorage（按插件隔离 key 空间）
//   aiGenerate      → 用户自备 API Key + OpenAI 兼容接口（fetch）
//   pushConnector   → 用户配置 webhook URL；未配置时降级为复制到剪贴板
// 边界（写进 ARCHITECTURE.md）：无 OAuth、无定时任务、无云端聚合；
// 需要这些能力时切换到 HttpApiProvider。
// ============================================================
import type { ApiProvider } from './types'
import { load, save } from '@/composables/usePersistence'

/** 插件数据 key：ph:plugin:{pluginId}:{key} */
const pluginKey = (pluginId: string, key: string) => `ph:plugin:${pluginId}:${key}`

export class LocalApiProvider implements ApiProvider {
  async persist(pluginId: string, key: string, data: unknown): Promise<void> {
    save(pluginKey(pluginId, key), data)
  }

  async load(pluginId: string, key: string): Promise<unknown | null> {
    return load<unknown | null>(pluginKey(pluginId, key), null)
  }

  /**
   * AI 生成（OpenAI 兼容接口）：用户自备 Key。
   * Key 与 baseUrl 存 localStorage（ph:ai:key / ph:ai:baseUrl），
   * 不出本机；仅在调用时发往配置的接口地址。
   */
  async aiGenerate(model: string, prompt: string): Promise<string> {
    const apiKey = load<string | null>('ph:ai:key', null)
    if (!apiKey) {
      throw new Error('未配置 AI Key：请在「设置」中填写（数据仅存本地）')
    }
    const baseUrl = load<string>('ph:ai:baseUrl', 'https://api.openai.com/v1').replace(/\/$/, '')
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`AI 请求失败（${res.status}）：${detail.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = data.choices?.[0]?.message?.content
    if (!text) throw new Error('AI 响应为空')
    return text
  }

  /**
   * 推送结果到外部系统：
   * 1. 已配置 webhook（ph:webhook:{connectorId}）→ POST JSON
   * 2. 未配置 → 降级为复制到剪贴板（保证"能出去"，只是手动）
   */
  async pushConnector(connectorId: string, payload: unknown): Promise<void> {
    const webhook = load<string | null>(`ph:webhook:${connectorId}`, null)
    if (webhook) {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`推送失败（${res.status}）`)
      return
    }
    // 降级：复制到剪贴板，提示用户手动粘贴
    const text =
      typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
    await navigator.clipboard.writeText(text)
  }
}
