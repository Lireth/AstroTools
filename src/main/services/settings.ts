import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSettings, PostSortMode, ThemeMode } from '../../shared/types'

const MAX_RECENTS = 10
const THEMES: ThemeMode[] = ['light', 'dark', 'system']
const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 24
const DEFAULT_FONT_SIZE = 14
const TAB_SIZES: number[] = [2, 4, 8]
const DEFAULT_TAB_SIZE = 2
const ZOOM_LEVELS: number[] = [0.9, 1, 1.25, 1.5]
const DEFAULT_ZOOM = 1
const SORT_MODES: PostSortMode[] = ['date-desc', 'date-asc', 'title']
const DEFAULT_SORT: PostSortMode = 'date-desc'

function settingsFile(storageDir: string): string {
  return join(storageDir, 'settings.json')
}

/** 字号钳制：非法值回退默认，越界值收敛到 10-24 的整数 */
function clampFontSize(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_FONT_SIZE
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

/** 缩进宽度校验：仅允许 2/4/8，非法值回退默认 */
function normalizeTabSize(value: unknown): number {
  return TAB_SIZES.includes(value as number) ? (value as number) : DEFAULT_TAB_SIZE
}

/** 界面缩放校验：仅允许预设档位，非法值回退默认 */
function normalizeZoom(value: unknown): number {
  return ZOOM_LEVELS.includes(value as number) ? (value as number) : DEFAULT_ZOOM
}

/** 排序方式校验：非法值回退默认 */
function normalizeSort(value: unknown): PostSortMode {
  return SORT_MODES.includes(value as PostSortMode) ? (value as PostSortMode) : DEFAULT_SORT
}

/** 布尔字段校验：非布尔值回退默认 */
function normalizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
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
        editorFontSize: clampFontSize(d.editorFontSize),
        editorWordWrap: normalizeBool(d.editorWordWrap, true),
        editorLineNumbers: normalizeBool(d.editorLineNumbers, true),
        editorTabSize: normalizeTabSize(d.editorTabSize),
        gitBadge: normalizeBool(d.gitBadge, true),
        fileWatch: normalizeBool(d.fileWatch, true),
        draftSnapshot: normalizeBool(d.draftSnapshot, true),
        editorPreview: normalizeBool(d.editorPreview, true),
        autoReopen: normalizeBool(d.autoReopen, false),
        uiZoom: normalizeZoom(d.uiZoom),
        rememberWindow: normalizeBool(d.rememberWindow, true),
        postSort: normalizeSort(d.postSort),
        newAsDraft: normalizeBool(d.newAsDraft, false)
      }
    }
  } catch {
    // 设置文件不存在或损坏时按默认设置处理
  }
  return {
    recentProjects: [],
    theme: 'system',
    editorFontSize: DEFAULT_FONT_SIZE,
    editorWordWrap: true,
    editorLineNumbers: true,
    editorTabSize: DEFAULT_TAB_SIZE,
    gitBadge: true,
    fileWatch: true,
    draftSnapshot: true,
    editorPreview: true,
    autoReopen: false,
    uiZoom: DEFAULT_ZOOM,
    rememberWindow: true,
    postSort: DEFAULT_SORT,
    newAsDraft: false
  }
}

export async function saveSettings(storageDir: string, settings: AppSettings): Promise<void> {
  await mkdir(storageDir, { recursive: true })
  await writeFile(settingsFile(storageDir), JSON.stringify(settings, null, 2), 'utf-8')
}

/** 更新应用偏好（除最近项目外的全部设置项），逐字段校验后合并持久化 */
export async function updateAppPreferences(
  storageDir: string,
  patch: Partial<Omit<AppSettings, 'recentProjects'>>
): Promise<AppSettings> {
  const settings = await loadSettings(storageDir)
  if (patch.theme !== undefined && THEMES.includes(patch.theme)) settings.theme = patch.theme
  if (patch.editorFontSize !== undefined)
    settings.editorFontSize = clampFontSize(patch.editorFontSize)
  if (patch.editorWordWrap !== undefined && typeof patch.editorWordWrap === 'boolean')
    settings.editorWordWrap = patch.editorWordWrap
  if (patch.editorLineNumbers !== undefined && typeof patch.editorLineNumbers === 'boolean')
    settings.editorLineNumbers = patch.editorLineNumbers
  if (patch.editorTabSize !== undefined)
    settings.editorTabSize = normalizeTabSize(patch.editorTabSize)
  if (patch.gitBadge !== undefined && typeof patch.gitBadge === 'boolean')
    settings.gitBadge = patch.gitBadge
  if (patch.fileWatch !== undefined && typeof patch.fileWatch === 'boolean')
    settings.fileWatch = patch.fileWatch
  if (patch.draftSnapshot !== undefined && typeof patch.draftSnapshot === 'boolean')
    settings.draftSnapshot = patch.draftSnapshot
  if (patch.editorPreview !== undefined && typeof patch.editorPreview === 'boolean')
    settings.editorPreview = patch.editorPreview
  if (patch.autoReopen !== undefined && typeof patch.autoReopen === 'boolean')
    settings.autoReopen = patch.autoReopen
  if (patch.uiZoom !== undefined) settings.uiZoom = normalizeZoom(patch.uiZoom)
  if (patch.rememberWindow !== undefined && typeof patch.rememberWindow === 'boolean')
    settings.rememberWindow = patch.rememberWindow
  if (patch.postSort !== undefined) settings.postSort = normalizeSort(patch.postSort)
  if (patch.newAsDraft !== undefined && typeof patch.newAsDraft === 'boolean')
    settings.newAsDraft = patch.newAsDraft
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

/** 清空最近项目列表 */
export async function clearRecentProjects(storageDir: string): Promise<AppSettings> {
  const settings = await loadSettings(storageDir)
  settings.recentProjects = []
  await saveSettings(storageDir, settings)
  return settings
}
