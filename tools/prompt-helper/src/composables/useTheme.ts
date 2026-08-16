// ============================================================
// 多维主题系统（Color Scheme × Visual Style）
// ------------------------------------------------------------
// 两个独立维度，任意组合：
//   color（色系）→ data-color="light|dark"     颜色层 themes/color.css
//   style（风格）→ data-style="clean|glass|industrial"  形态层 themes/styles.css
// 切换 = 改 <html> 属性 = 全局换肤（CSS 变量机制，零 JS 业务逻辑改动）。
//
// 兼容：v1.4.0 之前的用户偏好存的是 ph:theme='light|dark'，
// 启动时自动迁移到 ph:color，老用户主题不丢失。
// ============================================================
import { ref, watchEffect } from 'vue'
import { STORAGE_KEYS } from './usePersistence'

export type ColorScheme = 'light' | 'dark'
export type VisualStyle = 'clean' | 'glass' | 'industrial'

/** 默认风格：清新极简（最适合长时间文本/表格处理） */
export const DEFAULT_STYLE: VisualStyle = 'clean'

/** 老版本数据迁移：ph:theme → ph:color（只执行一次） */
function migrateLegacyTheme() {
  const legacy = localStorage.getItem('ph:theme')
  if (legacy === 'light' || legacy === 'dark') {
    if (localStorage.getItem(STORAGE_KEYS.color) === null) {
      localStorage.setItem(STORAGE_KEYS.color, legacy)
    }
    localStorage.removeItem('ph:theme')
  }
}

/** 读取色系：本地记忆 → 系统偏好 → 默认 light */
function getInitialColor(): ColorScheme {
  const stored = localStorage.getItem(STORAGE_KEYS.color)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

migrateLegacyTheme()
const color = ref<ColorScheme>(getInitialColor())
const style = ref<VisualStyle>(
  (localStorage.getItem(STORAGE_KEYS.style) as VisualStyle | null) ?? DEFAULT_STYLE,
)

// watchEffect：任何一处修改 color/style，都会同步到 <html> 与 localStorage
watchEffect(() => {
  const el = document.documentElement
  // data-theme 保留给旧 CSS 选择器（如 tokens.css 的代码高亮变量）作兼容
  el.setAttribute('data-theme', color.value)
  el.setAttribute('data-color', color.value)
  el.setAttribute('data-style', style.value)
  localStorage.setItem(STORAGE_KEYS.color, color.value)
  localStorage.setItem(STORAGE_KEYS.style, style.value)
})

export function useTheme() {
  /** 切换明暗 */
  const toggleColor = () => {
    color.value = color.value === 'light' ? 'dark' : 'light'
  }
  /** 切换视觉风格 */
  const setStyle = (s: VisualStyle) => {
    style.value = s
  }
  return { color, style, toggleColor, setStyle }
}
