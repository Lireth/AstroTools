import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ThemeMode } from '@shared/types'

/** 应用主题到文档根节点（Element Plus 暗色变量 + 自定义变量均挂在 html.dark 下） */
export function applyTheme(theme: ThemeMode): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<ThemeMode>('system')
  const editorFontSize = ref(14)
  const loaded = ref(false)

  const isDark = computed(
    () =>
      theme.value === 'dark' ||
      (theme.value === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  )

  async function load(): Promise<void> {
    const s = await window.api.getSettings()
    theme.value = s.theme
    editorFontSize.value = s.editorFontSize
    applyTheme(theme.value)
    loaded.value = true
  }

  function setTheme(value: ThemeMode): void {
    theme.value = value
    applyTheme(value)
    void window.api.savePreferences({ theme: value })
  }

  function setEditorFontSize(size: number): void {
    editorFontSize.value = size
    void window.api.savePreferences({ editorFontSize: size })
  }

  // 跟随系统模式下响应系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme.value === 'system') applyTheme('system')
  })

  return { theme, editorFontSize, loaded, isDark, load, setTheme, setEditorFontSize }
})
