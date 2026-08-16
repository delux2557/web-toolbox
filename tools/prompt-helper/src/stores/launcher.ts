// ============================================================
// 插件启动器（Launcher Store）
// ------------------------------------------------------------
// 记录"当前打开的是哪个插件"，主区（PluginHost）按它分发渲染。
// 状态持久化到 localStorage，刷新后停留在上次的插件上。
// 底座层只依赖这个 store + pluginRegistry，不认识具体插件。
// ============================================================
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { getPluginById, pluginRegistry } from '@/plugins'
import type { PluginManifest } from '@/types/plugin'
import { load, save, STORAGE_KEYS } from '@/composables/usePersistence'

export const useLauncherStore = defineStore('launcher', () => {
  /** 当前激活的插件 id（默认第一个；刷新后从 localStorage 恢复） */
  const activePluginId = ref<string>(
    load<string | null>(STORAGE_KEYS.activePlugin, null) ?? pluginRegistry[0]!.id,
  )

  // 自动持久化
  watch(activePluginId, (id) => save(STORAGE_KEYS.activePlugin, id))

  /** 当前激活的插件 manifest */
  const activePlugin = computed<PluginManifest | undefined>(() =>
    getPluginById(activePluginId.value),
  )

  /** 切换到某个插件（主区会随之重新渲染） */
  function activate(id: string) {
    activePluginId.value = id
  }

  return { activePluginId, activePlugin, activate }
})
