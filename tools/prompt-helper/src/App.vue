<script setup lang="ts">
// ============================================================
// 应用根组件
// ------------------------------------------------------------
// 整体骨架：左侧边栏 + 主区域（插件宿主，按 kind 分发渲染）。
// 底座层不 import 任何具体插件，只 import 侧边栏和宿主容器。
// 底部挂载全局 Toast 提示层（任何组件 show() 都显示在这里）。
// ============================================================
import Sidebar from '@/components/Sidebar.vue'
import PluginHost from '@/views/PluginHost.vue'
import { useToast } from '@/composables/useToast'

const { toasts } = useToast()
</script>

<template>
  <div class="app-layout">
    <Sidebar />
    <main class="main-area">
      <PluginHost />
    </main>
  </div>

  <!-- 全局提示层 -->
  <div class="toast-wrap">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="toast show"
      :class="{ error: t.error }"
    >
      {{ t.text }}
    </div>
  </div>
</template>
