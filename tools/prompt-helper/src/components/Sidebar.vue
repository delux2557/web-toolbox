<script setup lang="ts">
// ============================================================
// 左侧边栏（Sidebar）
// ------------------------------------------------------------
// AI 对话式布局的左侧栏：
//   上：工作流场景列表（按分类分组，点击切换当前工作流）
//   下：历史记录列表（点击载入，hover 出"重命名/删除"）
//   底：主题切换 + 新建空白工作流
// ============================================================
import { ref } from 'vue'
import { useWorkflowStore } from '@/stores/workflow'
import { useHistoryStore } from '@/stores/history'
import { groupWorkflowsByCategory, workflowRegistry } from '@/configs'
import { useTheme } from '@/composables/useTheme'
import { useToast } from '@/composables/useToast'
import { formatDateTime } from '@/utils/format'
import Modal from './Modal.vue'

const workflow = useWorkflowStore()
const history = useHistoryStore()
const { theme, toggle } = useTheme()
const { show } = useToast()

const categories = groupWorkflowsByCategory(workflowRegistry)

// ---------- 重命名弹窗 ----------
const renameTarget = ref<{ id: string; name: string } | null>(null)
const renameDraft = ref('')
function openRename(id: string, name: string) {
  renameTarget.value = { id, name }
  renameDraft.value = name
}
function confirmRename() {
  if (renameTarget.value) {
    history.renameEntry(renameTarget.value.id, renameDraft.value)
    show('已重命名')
  }
  renameTarget.value = null
}

// ---------- 删除确认弹窗 ----------
const deleteTarget = ref<string | null>(null)
function confirmDelete() {
  if (deleteTarget.value) {
    history.removeEntries([deleteTarget.value])
    show('已删除该条历史')
  }
  deleteTarget.value = null
}

// ---------- 载入历史（自动备份当前草稿，永不丢数据） ----------
function loadHistory(id: string) {
  const entry = history.getById(id)
  if (!entry) return
  workflow.applyHistoryEntry(entry)
  show(`已载入：${entry.name}`)
}

// ---------- 新建空白工作流 ----------
function newWorkflow() {
  workflow.resetDraft()
  show('已新建空白工作流')
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-logo">P</div>
      <div class="sidebar-brand">Prompt Helper</div>
    </div>

    <div class="sidebar-body">
      <div class="sidebar-section-title">工作流场景</div>
      <template v-for="[cat, list] in categories" :key="cat">
        <div class="sidebar-section-title" style="font-size: 11.5px">{{ cat }}</div>
        <button
          v-for="wf in list"
          :key="wf.id"
          type="button"
          class="sidebar-item"
          :class="{ active: wf.id === workflow.currentWorkflowId }"
          @click="workflow.selectWorkflow(wf.id)"
        >
          {{ wf.name }}
          <span class="sidebar-item-desc">{{ wf.description }}</span>
        </button>
      </template>

      <div class="sidebar-section-title">
        <span>历史记录</span>
        <span>{{ history.entries.length }} 条</span>
      </div>
      <button
        v-if="history.entries.length === 0"
        type="button"
        class="sidebar-item"
        style="cursor: default; color: var(--text-3)"
      >
        暂无历史，填写后点「保存历史」
      </button>
      <div v-for="e in history.entries" :key="e.id" class="history-item" @click="loadHistory(e.id)">
        <div class="hi-title">{{ e.name }}</div>
        <div class="hi-meta">
          <span>{{ e.workflowName }} · {{ formatDateTime(e.createdAt) }}</span>
          <span class="hi-actions">
            <button type="button" @click.stop="openRename(e.id, e.name)">重命名</button>
            <button type="button" @click.stop="deleteTarget = e.id">删除</button>
          </span>
        </div>
      </div>
    </div>

    <div class="sidebar-footer">
      <span>深色主题</span>
      <label class="switch">
        <input type="checkbox" :checked="theme === 'dark'" @change="toggle" />
        <span class="track"></span>
      </label>
      <span style="flex: 1"></span>
      <button
        type="button"
        style="border: none; background: none; color: var(--text-3); cursor: pointer; font-size: 13px"
        title="清空当前草稿，重新开始"
        @click="newWorkflow"
      >
        新建
      </button>
    </div>
  </aside>

  <!-- 重命名弹窗 -->
  <Modal :open="!!renameTarget" title="重命名历史" @close="renameTarget = null">
    <input
      v-model="renameDraft"
      class="input"
      placeholder="输入新的名称"
      @keyup.enter="confirmRename"
    />
    <template #footer>
      <button type="button" class="btn btn-ghost btn-sm" @click="renameTarget = null">取消</button>
      <button type="button" class="btn btn-primary btn-sm" @click="confirmRename">保存</button>
    </template>
  </Modal>

  <!-- 删除确认弹窗 -->
  <Modal :open="!!deleteTarget" title="删除历史" @close="deleteTarget = null">
    <p style="margin: 0; color: var(--text-2)">删除后不可恢复，确定删除这条历史记录吗？</p>
    <template #footer>
      <button type="button" class="btn btn-ghost btn-sm" @click="deleteTarget = null">取消</button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        style="background: var(--danger)"
        @click="confirmDelete"
      >
        删除
      </button>
    </template>
  </Modal>
</template>
