import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, ThemeMode } from '../../shared/types'

const MAX_RECENTS = 10
const THEMES: ThemeMode[] = ['light', 'dark', 'system']

function settingsFile(storageDir: string): string {
  return join(storageDir, 'settings.json')
}

export function loadSettings(storageDir: string): AppSettings {
  const file = settingsFile(storageDir)
  try {
    if (existsSync(file)) {
      const data: unknown = JSON.parse(readFileSync(file, 'utf-8'))
      if (data && typeof data === 'object') {
        const d = data as Partial<AppSettings>
        return {
          recentProjects: Array.isArray(d.recentProjects)
            ? d.recentProjects.filter((p): p is string => typeof p === 'string').slice(0, MAX_RECENTS)
            : [],
          theme: THEMES.includes(d.theme as ThemeMode) ? (d.theme as ThemeMode) : 'system',
          editorFontSize:
            typeof d.editorFontSize === 'number' && d.editorFontSize >= 10 && d.editorFontSize <= 24
              ? Math.round(d.editorFontSize)
              : 14
        }
      }
    }
  } catch {
    // 设置文件损坏时按默认设置处理
  }
  return { recentProjects: [], theme: 'system', editorFontSize: 14 }
}

export function saveSettings(storageDir: string, settings: AppSettings): void {
  mkdirSync(storageDir, { recursive: true })
  writeFileSync(settingsFile(storageDir), JSON.stringify(settings, null, 2), 'utf-8')
}

/** 更新应用偏好（主题/编辑器字号），与最近项目合并持久化 */
export function updateAppPreferences(
  storageDir: string,
  patch: Partial<Pick<AppSettings, 'theme' | 'editorFontSize'>>
): AppSettings {
  const settings = loadSettings(storageDir)
  if (patch.theme !== undefined) settings.theme = patch.theme
  if (patch.editorFontSize !== undefined) settings.editorFontSize = patch.editorFontSize
  saveSettings(storageDir, settings)
  return settings
}

export function addRecentProject(storageDir: string, projectPath: string): AppSettings {
  const settings = loadSettings(storageDir)
  settings.recentProjects = [
    projectPath,
    ...settings.recentProjects.filter((p) => p !== projectPath)
  ].slice(0, MAX_RECENTS)
  saveSettings(storageDir, settings)
  return settings
}

export function removeRecentProject(storageDir: string, projectPath: string): AppSettings {
  const settings = loadSettings(storageDir)
  settings.recentProjects = settings.recentProjects.filter((p) => p !== projectPath)
  saveSettings(storageDir, settings)
  return settings
}
