<script setup lang="ts">
// ============================================================
// 步骤卡片（RecipeCard）
// ------------------------------------------------------------
// 瀑布流里的"一步"：展示步骤名、引导语、该步的所有字段。
// 可选步骤显示"跳过本步"开关；任何步骤都可以隐藏（用户偏好）。
// 底部支持"临时插入自定义字段"（仅本次会话有效）。
// ============================================================
import { computed, ref } from 'vue'
import type { Recipe } from '@/types/workflow'
import { useWorkflowStore } from '@/stores/workflow'
import FieldRenderer from './FieldRenderer.vue'

const props = defineProps<{ recipe: Recipe; index: number }>()
const store = useWorkflowStore()

const draft = computed(() => store.draft.stepDrafts[props.recipe.id])
const skipped = computed(() => draft.value?.skipped ?? false)
const tempLabel = ref('')

/** 该步是否"已填"（任意字段有值即可，用于状态徽标和锚点样式） */
const filled = computed(() => {
  const sd = draft.value
  if (!sd) return false
  return (
    props.recipe.fields.some((f) => {
      const v = sd.fields[f.id]
      return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
    }) || sd.tempFields.length > 0
  )
})

/** 过滤掉用户隐藏的字段 */
const visibleFields = computed(() =>
  props.recipe.fields.filter(
    (f) => !store.prefs.hiddenFieldIds.includes(`${props.recipe.id}.${f.id}`),
  ),
)

function addTemp() {
  if (!tempLabel.value.trim()) return
  store.addTempField(props.recipe.id, tempLabel.value.trim())
  tempLabel.value = ''
}
</script>

<template>
  <section
    :id="`step-${recipe.id}`"
    class="step-card"
    :class="{ 'skipped-step': skipped }"
  >
    <div class="step-head">
      <span class="step-index" :class="{ muted: skipped }">{{ index + 1 }}</span>
      <span class="step-name">{{ recipe.name }}</span>
      <span v-if="skipped" class="step-badge skipped">已跳过</span>
      <span v-else-if="filled" class="step-badge filled">已填</span>
      <span v-else-if="recipe.optional" class="step-badge optional">可选</span>
      <span style="flex: 1"></span>
      <span style="display: flex; gap: 8px; font-size: 12px; color: var(--text-3)">
        <label v-if="recipe.optional" class="switch" title="跳过本步，编译时忽略">
          <input type="checkbox" :checked="skipped" @change="store.toggleSkip(recipe.id)" />
          <span class="track"></span>
          跳过本步
        </label>
        <button
          class="fh-btn"
          type="button"
          title="在侧边栏中隐藏本步骤"
          style="border: none; background: none; color: var(--text-3); cursor: pointer"
          @click="store.toggleHiddenRecipe(recipe.id)"
        >
          隐藏本步
        </button>
      </span>
    </div>

    <p v-if="recipe.description" class="step-desc">{{ recipe.description }}</p>

    <div v-if="!skipped">
      <!-- 配置里定义的字段（动态渲染，不认识的类型也能优雅降级） -->
      <FieldRenderer
        v-for="field in visibleFields"
        :key="field.id"
        :recipe-id="recipe.id"
        :field="field"
      />

      <!-- 用户临时插入的字段 -->
      <div v-for="tf in draft?.tempFields ?? []" :key="tf.id" class="field-block">
        <div class="field-label">
          <span>{{ tf.label }}<span style="color: var(--text-3); font-size: 12px">（临时）</span></span>
          <span class="fl-actions">
            <button type="button" @click="store.removeTempField(recipe.id, tf.id)">删除</button>
          </span>
        </div>
        <textarea
          :value="tf.value"
          class="textarea"
          placeholder="填写临时字段内容"
          @input="
            tf.value = ($event.target as HTMLTextAreaElement).value
          "
        ></textarea>
      </div>

      <!-- 插入临时字段的入口 -->
      <div class="step-actions">
        <input
          v-model="tempLabel"
          class="input"
          style="max-width: 220px"
          placeholder="临时字段名（如：执行计划）"
          @keyup.enter="addTemp"
        />
        <button type="button" class="btn btn-ghost btn-sm" @click="addTemp">＋ 插入字段</button>
      </div>
    </div>
  </section>
</template>
