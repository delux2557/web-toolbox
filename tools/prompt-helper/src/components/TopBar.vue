<script setup lang="ts">
// ============================================================
// 顶栏（TopBar）
// ------------------------------------------------------------
// 吸顶工具条：工作流名称 + 完成度进度条 + 两个主操作按钮。
// 只负责展示和转发事件，具体逻辑在父级 WorkflowView。
// ============================================================
import type { WorkflowDef } from '@/types/workflow'

defineProps<{ workflow: WorkflowDef; filled: number; total: number }>()
defineEmits<{ 'save-history': []; generate: [] }>()
</script>

<template>
  <div class="workflow-toolbar">
    <div class="wt-title">{{ workflow.name }}</div>
    <div class="wt-progress">
      <div class="wt-progress-bar">
        <div
          class="wt-progress-fill"
          :style="{ width: total > 0 ? Math.round((filled / total) * 100) + '%' : '0%' }"
        ></div>
      </div>
      <span class="wt-count">{{ filled }}/{{ total }}</span>
    </div>
    <button type="button" class="btn btn-ghost" @click="$emit('save-history')">保存历史</button>
    <button type="button" class="btn btn-primary" @click="$emit('generate')">生成提示词</button>
  </div>
</template>
