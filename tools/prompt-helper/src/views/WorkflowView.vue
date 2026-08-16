<script setup lang="ts">
// ============================================================
// 主工作流视图（WorkflowView）
// ------------------------------------------------------------
// 组装页面：吸顶工具条 → 锚点导航 → 步骤卡片瀑布流 → 草稿状态栏 → 输出面板。
// 这里也是"引擎盖"：保存历史、生成提示词、滚动高亮等页面级行为。
// ============================================================
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useWorkflowStore } from '@/stores/workflow'
import { useHistoryStore } from '@/stores/history'
import { useToast } from '@/composables/useToast'
import type { CompileInput } from '@/types/workflow'
import TopBar from '@/components/TopBar.vue'
import AnchorNav from '@/components/AnchorNav.vue'
import RecipeCard from '@/components/RecipeCard.vue'
import OutputPanel from '@/components/OutputPanel.vue'

const workflow = useWorkflowStore()
const history = useHistoryStore()
const { show } = useToast()

// ---------- 锚点高亮：滚动时找出"当前正在看哪一步" ----------
const activeStepId = ref('')
let scrollTimer: number | undefined

function onScroll() {
  window.clearTimeout(scrollTimer)
  scrollTimer = window.setTimeout(() => {
    const wf = workflow.currentWorkflow
    if (!wf) return
    for (const r of wf.recipes) {
      const el = document.getElementById(`step-${r.id}`)
      if (el) {
        const rect = el.getBoundingClientRect()
        if (rect.top < 140 && rect.bottom > 140) {
          activeStepId.value = r.id
          return
        }
      }
    }
  }, 60)
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

// ---------- 编译输入：把三层数据打包给编译器 ----------
const compileInput = computed<CompileInput>(() => ({
  workflow: workflow.currentWorkflow!,
  draft: workflow.draft,
  prefs: workflow.prefs,
}))

// ---------- 页面级操作 ----------
function saveHistory() {
  const wf = workflow.currentWorkflow
  if (!wf) return
  // 名称留空 → historyStore 自动生成"工作流名 · 日期"
  history.addEntry('', wf.id, wf.name, workflow.draft)
  show('已保存到历史记录')
}

function generate() {
  document.getElementById('output-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function confirmReset() {
  if (window.confirm('确定清空当前草稿吗？建议先「保存历史」留底。')) {
    workflow.resetDraft()
    show('已清空草稿')
  }
}
</script>

<template>
  <div>
    <TopBar
      v-if="workflow.currentWorkflow"
      :workflow="workflow.currentWorkflow"
      :filled="workflow.progress.filled"
      :total="workflow.progress.total"
      @save-history="saveHistory"
      @generate="generate"
    />

    <div class="main-inner">
      <template v-if="workflow.currentWorkflow">
        <AnchorNav :recipes="workflow.activeRecipes" :current-active-id="activeStepId" />

        <!-- 瀑布流：所有步骤上下排列，随时滚动回改 -->
        <RecipeCard
          v-for="(r, i) in workflow.activeRecipes"
          :key="r.id"
          :recipe="r"
          :index="i"
        />

        <div class="draft-bar">
          <span>草稿已自动保存 · 跳走或刷新不丢</span>
          <button
            type="button"
            style="border: none; background: none; color: var(--accent-strong); cursor: pointer; font-size: 13px"
            @click="confirmReset"
          >
            清空重填
          </button>
        </div>

        <OutputPanel :input="compileInput" />
      </template>

      <div v-else class="empty-hint">未找到该工作流的配置，请检查 src/configs/ 注册表</div>
    </div>
  </div>
</template>
