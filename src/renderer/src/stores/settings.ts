import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ThemeMode } from '@shared/types'

// 同一查询的 MediaQueryList 缓存为模块级单例，避免各处重复调用 matchMedia
const darkMedia = window.matchMedia('(prefers-color-scheme: dark)')
// 系统主题变化监听的解除函数；null 表示当前未注册
let systemThemeCleanup: (() => void) | null = null

/** 应用主题到文档根节点（Element Plus 暗色变量 + 自定义变量均挂在 html.dark 下） */
export function applyTheme(theme: ThemeMode): void {
  const dark = theme === 'dark' || (theme === 'system' && darkMedia.matches)
  document.documentElement.classList.toggle('dark', dark)
}

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<ThemeMode>('system')
  const editorFontSize = ref(14)
  const loaded = ref(false)

  const isDark = computed(
    () => theme.value === 'dark' || (theme.value === 'system' && darkMedia.matches)
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

  // 跟随系统模式下响应系统主题变化。
  // 监听器随 store 创建注册；store 重建（如 HMR）时先解除旧监听，避免叠加与过期闭包。
  if (systemThemeCleanup) systemThemeCleanup()
  const onSystemThemeChange = (): void => {
    if (theme.value === 'system') applyTheme('system')
  }
  darkMedia.addEventListener('change', onSystemThemeChange)
  systemThemeCleanup = (): void => {
    darkMedia.removeEventListener('change', onSystemThemeChange)
    systemThemeCleanup = null
  }

  return { theme, editorFontSize, loaded, isDark, load, setTheme, setEditorFontSize }
})
