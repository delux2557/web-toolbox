<script setup lang="ts">
// ============================================================
// 通用弹窗（Modal）
// ------------------------------------------------------------
// 复用 components.css 的 .modal-overlay / .modal 结构。
// 用法：<Modal :open="xx" title="标题" @close="xx">
//         <template #default>正文</template>
//         <template #footer>按钮</template>
//       </Modal>
// 点击遮罩层或关闭按钮都会触发 close。
// ============================================================
defineProps<{ open: boolean; title?: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="emit('close')">
      <div class="modal wide" role="dialog" :aria-label="title">
        <div class="modal-head">
          <div class="modal-title">{{ title }}</div>
          <button class="modal-close" aria-label="关闭" @click="emit('close')">×</button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="modal-foot">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
