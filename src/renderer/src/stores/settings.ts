import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { PostSortMode, ThemeMode } from '@shared/types'

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
  const editorWordWrap = ref(true)
  const editorLineNumbers = ref(true)
  const editorTabSize = ref(2)
  const gitBadge = ref(true)
  const fileWatch = ref(true)
  const draftSnapshot = ref(true)
  const editorPreview = ref(true)
  const autoReopen = ref(false)
  const uiZoom = ref(1)
  const rememberWindow = ref(true)
  const postSort = ref<PostSortMode>('date-desc')
  const newAsDraft = ref(false)
  const loaded = ref(false)

  const isDark = computed(
    () => theme.value === 'dark' || (theme.value === 'system' && darkMedia.matches)
  )

  async function load(): Promise<void> {
    const s = await window.api.getSettings()
    theme.value = s.theme
    editorFontSize.value = s.editorFontSize
    editorWordWrap.value = s.editorWordWrap
    editorLineNumbers.value = s.editorLineNumbers
    editorTabSize.value = s.editorTabSize
    gitBadge.value = s.gitBadge
    fileWatch.value = s.fileWatch
    draftSnapshot.value = s.draftSnapshot
    editorPreview.value = s.editorPreview
    autoReopen.value = s.autoReopen
    uiZoom.value = s.uiZoom
    rememberWindow.value = s.rememberWindow
    postSort.value = s.postSort
    newAsDraft.value = s.newAsDraft
    window.api.setUiZoom(s.uiZoom)
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

  function setEditorWordWrap(value: boolean): void {
    editorWordWrap.value = value
    void window.api.savePreferences({ editorWordWrap: value })
  }

  function setEditorLineNumbers(value: boolean): void {
    editorLineNumbers.value = value
    void window.api.savePreferences({ editorLineNumbers: value })
  }

  function setEditorTabSize(size: number): void {
    editorTabSize.value = size
    void window.api.savePreferences({ editorTabSize: size })
  }

  function setGitBadge(value: boolean): void {
    gitBadge.value = value
    void window.api.savePreferences({ gitBadge: value })
  }

  function setFileWatch(value: boolean): void {
    fileWatch.value = value
    void window.api.savePreferences({ fileWatch: value })
  }

  function setDraftSnapshot(value: boolean): void {
    draftSnapshot.value = value
    void window.api.savePreferences({ draftSnapshot: value })
  }

  function setEditorPreview(value: boolean): void {
    editorPreview.value = value
    void window.api.savePreferences({ editorPreview: value })
  }

  function setAutoReopen(value: boolean): void {
    autoReopen.value = value
    void window.api.savePreferences({ autoReopen: value })
  }

  function setUiZoom(factor: number): void {
    uiZoom.value = factor
    window.api.setUiZoom(factor)
    void window.api.savePreferences({ uiZoom: factor })
  }

  function setRememberWindow(value: boolean): void {
    rememberWindow.value = value
    void window.api.savePreferences({ rememberWindow: value })
  }

  function setPostSort(value: PostSortMode): void {
    postSort.value = value
    void window.api.savePreferences({ postSort: value })
  }

  function setNewAsDraft(value: boolean): void {
    newAsDraft.value = value
    void window.api.savePreferences({ newAsDraft: value })
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

  return {
    theme,
    editorFontSize,
    editorWordWrap,
    editorLineNumbers,
    editorTabSize,
    gitBadge,
    fileWatch,
    draftSnapshot,
    editorPreview,
    autoReopen,
    uiZoom,
    rememberWindow,
    postSort,
    newAsDraft,
    loaded,
    isDark,
    load,
    setTheme,
    setEditorFontSize,
    setEditorWordWrap,
    setEditorLineNumbers,
    setEditorTabSize,
    setGitBadge,
    setFileWatch,
    setDraftSnapshot,
    setEditorPreview,
    setAutoReopen,
    setUiZoom,
    setRememberWindow,
    setPostSort,
    setNewAsDraft
  }
})
