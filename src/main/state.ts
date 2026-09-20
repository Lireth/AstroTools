import type { BrowserWindow } from 'electron'
import type { ProjectInfo } from '../shared/types'

let currentProject: ProjectInfo | null = null
let mainWindow: BrowserWindow | null = null
// 窗口记忆开关（主进程侧缓存：close 事件为同步流程，无法等待异步读取设置）
let rememberWindow = true

export function setRememberWindow(value: boolean): void {
  rememberWindow = value
}

export function getRememberWindow(): boolean {
  return rememberWindow
}

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
