<script setup lang="ts">
// ============================================================
// 输出面板（OutputPanel）
// ------------------------------------------------------------
// 把编译结果展示出来：支持 Markdown / JSON / XML 三种格式切换，
// 一键复制到剪贴板、下载成文件。编译逻辑在 src/compilers/index.ts。
// ============================================================
import { computed, ref } from 'vue'
import type { CompileInput, OutputFormat } from '@/types/workflow'
import { compile } from '@/compilers'
import { useToast } from '@/composables/useToast'

const props = defineProps<{ input: CompileInput }>()
const { show } = useToast()

const format = ref<OutputFormat>('markdown')

/** 编译结果是纯计算：任何输入变化都会自动重新生成 */
const output = computed(() => compile(props.input, format.value))

const fileName = computed(
  () => `prompt-${props.input.workflow.name}.${format.value === 'markdown' ? 'md' : format.value}`,
)

async function copy() {
  try {
    await navigator.clipboard.writeText(output.value)
    show('已复制到剪贴板')
  } catch {
    // 兜底：file:// 协议下 Clipboard API 可能不可用（非安全上下文），
    // 退回老式 execCommand 方案
    try {
      const ta = document.createElement('textarea')
      ta.value = output.value
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      show(ok ? '已复制到剪贴板' : '复制失败，请手动选择复制', !ok)
    } catch {
      show('复制失败，请手动选择复制', true)
    }
  }
}

function download() {
  const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.value
  a.click()
  URL.revokeObjectURL(url)
  show('已开始下载')
}
</script>

<template>
  <section id="output-panel" class="output-panel">
    <div class="output-head">
      <span class="oh-title">生成的提示词</span>
      <select v-model="format" class="select-control" aria-label="输出格式">
        <option value="markdown">Markdown</option>
        <option value="json">JSON</option>
        <option value="xml">XML</option>
      </select>
    </div>
    <pre class="output-pre">{{ output }}</pre>
    <div class="output-foot">
      <span class="of-tip">未填字段会自动使用样板句兜底，保证提示词完整可用</span>
      <button type="button" class="btn btn-ghost btn-sm" @click="copy">复制</button>
      <button type="button" class="btn btn-primary btn-sm" @click="download">下载</button>
    </div>
  </section>
</template>
