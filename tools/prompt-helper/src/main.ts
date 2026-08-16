// ============================================================
// 项目入口：挂载 Vue 应用 + 全局导入样式
// 注意：设计系统的样式必须在这里全局导入，
// 组件内部不要再写 <style scoped> 包裹这些全局类（保持单一来源）。
// ============================================================
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '../design-system/tokens.css'
import '../design-system/components.css'
import './styles/design-extras.css'
import App from './App.vue'

createApp(App).use(createPinia()).mount('#app')
