<script setup lang="ts">
// ============================================================
// CSV / JSON 表格预览
// ------------------------------------------------------------
// 监听 textarea 的内容，自动识别是否为合法 CSV / JSON。
// 是 → 显示"渲染为表格预览"按钮，点击展开表格（前 50 行）。
// 数据解析逻辑在 src/utils/csv.ts（可独立测试）。
// ============================================================
import { computed, ref, watch } from 'vue'
import { parseTabular, type TableData } from '@/utils/csv'

const props = defineProps<{ text: string }>()

/** 解析结果；不是合法表格时为 null */
const table = computed<TableData | null>(() => parseTabular(props.text))

/** 是否展开预览表格 */
const expanded = ref(false)

// 内容变化后收起表格，避免表格和文本对不上
watch(
  () => props.text,
  () => {
    expanded.value = false
  },
)
</script>

<template>
  <div v-if="table">
    <button class="csv-toggle" type="button" @click="expanded = !expanded">
      {{ expanded ? '收起表格' : '渲染为表格预览' }}
    </button>
    <div v-if="expanded" class="csv-table-wrap">
      <table class="csv-table">
        <thead>
          <tr>
            <th v-for="(h, i) in table.header" :key="i">{{ h || `列 ${i + 1}` }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in table.rows" :key="ri">
            <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="expanded" class="csv-note">
      检测到 {{ table.format.toUpperCase() }} 数据 · 仅展示前 {{ table.rows.length }} 行 · 共
      {{ table.totalRows }} 行
    </div>
  </div>
</template>
