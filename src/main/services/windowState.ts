import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, screen, type BrowserWindow } from 'electron'

/** 持久化的窗口状态（window-state.json） */
interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

/** 未启用窗口记忆时的默认尺寸（与 createWindow 原默认一致） */
export const WINDOW_DEFAULTS = { width: 1320, height: 860 }

/** 恢复位置时允许的越界容差（像素），兼容任务栏/缩放引起的细微偏差 */
const BOUNDS_TOLERANCE = 10

function stateFile(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/**
 * 读取窗口状态。文件不存在/损坏时返回 null；
 * x/y 位于所有显示器工作区之外（如拔掉外接显示器）时仅恢复尺寸不恢复位置，
 * 防止窗口出现在不可见区域。
 */
export function loadWindowState(): WindowState | null {
  try {
    const d = JSON.parse(readFileSync(stateFile(), 'utf-8')) as Partial<WindowState>
    if (typeof d.width !== 'number' || typeof d.height !== 'number') return null
    const state: WindowState = {
      width: d.width,
      height: d.height,
      maximized: d.maximized === true
    }
    if (typeof d.x === 'number' && typeof d.y === 'number') {
      const visible = screen.getAllDisplays().some((disp) => {
        const a = disp.workArea
        return (
          d.x! >= a.x - BOUNDS_TOLERANCE &&
          d.y! >= a.y - BOUNDS_TOLERANCE &&
          d.x! + d.width! <= a.x + a.width + BOUNDS_TOLERANCE &&
          d.y! + d.height! <= a.y + a.height + BOUNDS_TOLERANCE
        )
      })
      if (visible) {
        state.x = d.x
        state.y = d.y
      }
    }
    return state
  } catch {
    // 文件不存在或损坏：按默认尺寸处理
    return null
  }
}

/**
 * 保存窗口状态（同步写入：close 事件可能在退出流程中触发，
 * 异步写入可能来不及完成就被 app.quit 截断）。
 */
export function saveWindowState(win: BrowserWindow): void {
  try {
    const state: WindowState = { ...win.getBounds(), maximized: win.isMaximized() }
    writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    // 保存失败不影响关闭流程
  }
}
