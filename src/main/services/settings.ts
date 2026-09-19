import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface SettingsData {
  recentProjects: string[]
}

const MAX_RECENTS = 10

function settingsFile(storageDir: string): string {
  return join(storageDir, 'settings.json')
}

export function loadSettings(storageDir: string): SettingsData {
  const file = settingsFile(storageDir)
  try {
    if (existsSync(file)) {
      const data: unknown = JSON.parse(readFileSync(file, 'utf-8'))
      if (data && typeof data === 'object' && Array.isArray((data as SettingsData).recentProjects)) {
        return {
          recentProjects: (data as SettingsData).recentProjects
            .filter((p): p is string => typeof p === 'string')
            .slice(0, MAX_RECENTS)
        }
      }
    }
  } catch {
    // 设置文件损坏时按空设置处理
  }
  return { recentProjects: [] }
}

export function saveSettings(storageDir: string, settings: SettingsData): void {
  mkdirSync(storageDir, { recursive: true })
  writeFileSync(settingsFile(storageDir), JSON.stringify(settings, null, 2), 'utf-8')
}

export function addRecentProject(storageDir: string, projectPath: string): SettingsData {
  const settings = loadSettings(storageDir)
  settings.recentProjects = [
    projectPath,
    ...settings.recentProjects.filter((p) => p !== projectPath)
  ].slice(0, MAX_RECENTS)
  saveSettings(storageDir, settings)
  return settings
}

export function removeRecentProject(storageDir: string, projectPath: string): SettingsData {
  const settings = loadSettings(storageDir)
  settings.recentProjects = settings.recentProjects.filter((p) => p !== projectPath)
  saveSettings(storageDir, settings)
  return settings
}
