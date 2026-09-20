import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSettings, ThemeMode } from '../../shared/types'

const MAX_RECENTS = 10
const THEMES: ThemeMode[] = ['light', 'dark', 'system']
const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 24
const DEFAULT_FONT_SIZE = 14

function settingsFile(storageDir: string): string {
  return join(storageDir, 'settings.json')
}

/** 字号钳制：非法值回退默认，越界值收敛到 10-24 的整数 */
function clampFontSize(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_FONT_SIZE
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

export async function loadSettings(storageDir: string): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsFile(storageDir), 'utf-8')
    const data: unknown = JSON.parse(raw)
    if (data && typeof data === 'object') {
      const d = data as Partial<AppSettings>
      return {
        recentProjects: Array.isArray(d.recentProjects)
          ? d.recentProjects.filter((p): p is string => typeof p === 'string').slice(0, MAX_RECENTS)
          : [],
        theme: THEMES.includes(d.theme as ThemeMode) ? (d.theme as ThemeMode) : 'system',
        editorFontSize: clampFontSize(d.editorFontSize)
      }
    }
  } catch {
    // 设置文件不存在或损坏时按默认设置处理
  }
  return { recentProjects: [], theme: 'system', editorFontSize: DEFAULT_FONT_SIZE }
}

export async function saveSettings(storageDir: string, settings: AppSettings): Promise<void> {
  await mkdir(storageDir, { recursive: true })
  await writeFile(settingsFile(storageDir), JSON.stringify(settings, null, 2), 'utf-8')
}

/** 更新应用偏好（主题/编辑器字号），与最近项目合并持久化 */
export async function updateAppPreferences(
  storageDir: string,
  patch: Partial<Pick<AppSettings, 'theme' | 'editorFontSize'>>
): Promise<AppSettings> {
  const settings = await loadSettings(storageDir)
  if (patch.theme !== undefined && THEMES.includes(patch.theme)) settings.theme = patch.theme
  if (patch.editorFontSize !== undefined)
    settings.editorFontSize = clampFontSize(patch.editorFontSize)
  await saveSettings(storageDir, settings)
  return settings
}

export async function addRecentProject(
  storageDir: string,
  projectPath: string
): Promise<AppSettings> {
  const settings = await loadSettings(storageDir)
  settings.recentProjects = [
    projectPath,
    ...settings.recentProjects.filter((p) => p !== projectPath)
  ].slice(0, MAX_RECENTS)
  await saveSettings(storageDir, settings)
  return settings
}

export async function removeRecentProject(
  storageDir: string,
  projectPath: string
): Promise<AppSettings> {
  const settings = await loadSettings(storageDir)
  settings.recentProjects = settings.recentProjects.filter((p) => p !== projectPath)
  await saveSettings(storageDir, settings)
  return settings
}
