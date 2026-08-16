<script setup lang="ts">
// ============================================================
// 插件宿主（PluginHost）
// ------------------------------------------------------------
// 主区容器：根据 launcher 当前激活的插件，按 kind 分发渲染。
// 底座层唯一的知识：kind 字段。它不认识任何具体插件——
// 工作流型交给现有引擎，组件型交给 <component :is>。
// ============================================================
import { useLauncherStore } from '@/stores/launcher'
import WorkflowView from '@/views/WorkflowView.vue'

const launcher = useLauncherStore()
</script>

<template>
  <!-- kind=workflow → 复用现有工作流引擎（编译/字段/历史/CSV 预览全保留） -->
  <WorkflowView v-if="launcher.activePlugin?.kind === 'workflow'" />

  <!-- kind=component → 动态组件渲染（底座不知道组件内部是什么） -->
  <component
    v-else-if="launcher.activePlugin?.kind === 'component' && launcher.activePlugin.component"
    :is="launcher.activePlugin.component"
  />

  <div v-else class="empty-hint">插件不存在或未配置</div>
</template>
