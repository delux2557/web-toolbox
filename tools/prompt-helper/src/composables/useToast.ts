// ============================================================
// 轻提示（Toast）
// ------------------------------------------------------------
// 全局唯一的提示队列：任何组件调用 show() 都能弹出提示，
// 自动 2.6 秒后消失。渲染位置在 App.vue（挂载一次即可）。
// ============================================================
import { ref } from 'vue'

interface ToastMsg {
  id: number
  text: string
  error?: boolean
}

/** 全局提示队列（模块级状态，所有组件共享） */
const toasts = ref<ToastMsg[]>([])

export function useToast() {
  function show(text: string, error = false) {
    const id = Date.now() + Math.random()
    toasts.value.push({ id, text, error })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 2600)
  }
  return { toasts, show }
}
