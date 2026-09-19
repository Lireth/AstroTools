import type { BrowserWindow } from 'electron'
import type { ProjectInfo } from '../shared/types'

let currentProject: ProjectInfo | null = null
let mainWindow: BrowserWindow | null = null

export function setCurrentProject(info: ProjectInfo | null): void {
  currentProject = info
}

export function getCurrentProject(): ProjectInfo | null {
  return currentProject
}

export function getCurrentRoot(): string | null {
  return currentProject?.path ?? null
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
