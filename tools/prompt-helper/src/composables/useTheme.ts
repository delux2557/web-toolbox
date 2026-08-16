// ============================================================
// 明暗主题切换
// ------------------------------------------------------------
// 实现方式：给 <html> 标签设置 data-theme="light|dark"，
// tokens.css 里定义了 :root[data-theme="light"] 和 dark 两套 CSS 变量。
// 切换属性 = 全局换肤，这就是"CSS 变量 + data 属性"做主题的原理。
// ============================================================
import { ref, watchEffect } from 'vue'
import { STORAGE_KEYS } from './usePersistence'

type Theme = 'light' | 'dark'

/** 启动时读一次：本地记忆 → 系统偏好 → 默认 light */
function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEYS.theme)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const theme = ref<Theme>(getInitialTheme())

// watchEffect：任何一处代码修改 theme 的值，都会自动同步到 <html> 和 localStorage
watchEffect(() => {
  document.documentElement.setAttribute('data-theme', theme.value)
  localStorage.setItem(STORAGE_KEYS.theme, theme.value)
})

export function useTheme() {
  const toggle = () => {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
  }
  return { theme, toggle }
}
