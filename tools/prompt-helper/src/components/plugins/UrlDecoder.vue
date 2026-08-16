<script setup lang="ts">
// ============================================================
// 示例组件型插件：URL / 文本编解码器（UrlDecoder）
// ------------------------------------------------------------
// 这是一个"普通 Vue 组件"，证明插件化架构的形态：
//   - 底座（PluginHost）只负责 <component :is="..."> 把它放上去，
//     完全不知道它内部在做什么
//   - 它只依赖平台的"标准工具箱"：设计系统类名（.panel/.input/.btn）、
//     useToast 提示、usePersistence 存历史（可选）
//   - 主题自动适配：用了 tokens 变量，暗色模式自动变色，零额外代码
// 新插件照抄这个文件的结构即可。
// ============================================================
import { ref } from 'vue'
import { useToast } from '@/composables/useToast'

const input = ref('')
const output = ref('')
const mode = ref<'decode' | 'encode'>('decode')
const { show } = useToast()

function run() {
  const text = input.value.trim()
  if (!text) {
    show('请先输入内容', true)
    return
  }
  try {
    output.value =
      mode.value === 'decode'
        ? decodeURIComponent(text) // URL 解码
        : encodeURIComponent(text) // URL 编码
  } catch {
    show('解码失败：内容不是合法的 URL 编码格式', true)
    output.value = ''
  }
}

async function copy() {
  if (!output.value) {
    show('没有可复制的内容', true)
    return
  }
  try {
    await navigator.clipboard.writeText(output.value)
    show('已复制到剪贴板')
  } catch {
    show('复制失败，请手动选择复制', true)
  }
}
</script>

<template>
  <div class="panel" style="max-width: 720px">
    <div class="panel-head">
      URL / 文本编解码器
      <span style="flex: 1"></span>
      <span class="label">输入 → 结果</span>
    </div>
    <div class="panel-body">
      <div class="field-block">
        <div class="field-label">输入内容</div>
        <textarea
          v-model="input"
          class="textarea mono"
          placeholder="粘贴要解码/编码的文本，如：https%3A%2F%2Fexample.com%2F%3Fa%3D1"
          style="min-height: 110px"
        ></textarea>
      </div>

      <div class="step-actions" style="margin-top: 0">
        <button type="button" class="btn btn-ghost btn-sm" @click="mode = 'decode'">解码</button>
        <button type="button" class="btn btn-ghost btn-sm" @click="mode = 'encode'">编码</button>
        <button type="button" class="btn btn-primary btn-sm" @click="run">执行</button>
      </div>

      <div v-if="output" class="field-block" style="margin-top: 16px">
        <div class="field-label">
          结果（{{ mode === 'decode' ? '已解码' : '已编码' }}）
          <span class="fl-actions">
            <button type="button" @click="copy">复制</button>
          </span>
        </div>
        <pre class="output-pre" style="max-height: 260px">{{ output }}</pre>
      </div>
    </div>
  </div>
</template>
