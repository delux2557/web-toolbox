<script setup lang="ts">
// ============================================================
// 锚点导航（AnchorNav）
// ------------------------------------------------------------
// 瀑布流页面顶部的一排"步骤胶囊"：点击平滑滚动到对应步骤；
// 当前视口所在步骤高亮；已填的步骤显示完成色；跳过的显示删除线。
// 相当于把"分步向导的进度条"改造成了瀑布流友好版。
// ============================================================
import type { Recipe } from '@/types/workflow'
import { useWorkflowStore } from '@/stores/workflow'

const props = defineProps<{ recipes: Recipe[]; currentActiveId: string }>()
const store = useWorkflowStore()

function scrollTo(recipeId: string) {
  document.getElementById(`step-${recipeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** 计算每个步骤的状态（用于胶囊样式） */
function stateOf(r: Recipe): 'done' | 'skipped' | '' {
  const sd = store.draft.stepDrafts[r.id]
  if (sd?.skipped) return 'skipped'
  const hasValue =
    r.fields.some((f) => {
      const v = sd?.fields[f.id]
      return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
    }) || (sd?.tempFields.length ?? 0) > 0
  return hasValue ? 'done' : ''
}
</script>

<template>
  <nav class="anchor-nav" aria-label="步骤导航">
    <button
      v-for="(r, i) in recipes"
      :key="r.id"
      type="button"
      class="anchor-pill"
      :class="[stateOf(r), { active: r.id === currentActiveId }]"
      @click="scrollTo(r.id)"
    >
      {{ i + 1 }} {{ r.name }}
    </button>
  </nav>
</template>
