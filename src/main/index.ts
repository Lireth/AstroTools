import { app, BrowserWindow, ipcMain, net, protocol } from 'electron'
import { stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { disposeIpc, registerIpcHandlers } from './ipc'
import { IpcChannel } from '../shared/channels'
import { loadSettings } from './services/settings'
import { loadWindowState, saveWindowState, WINDOW_DEFAULTS } from './services/windowState'
import {
  getRememberWindow,
  getCurrentRoot,
  getMainWindow,
  setMainWindow,
  setRememberWindow
} from './state'

const MEDIA_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp'
}

// media:// 协议需在 app ready 前注册特权，供渲染进程以 <img> 加载本地图片
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

let forceClose = false
let quitting = false

function createWindow(): void {
  // 窗口记忆开启时恢复上次大小/位置（位置越界时仅恢复尺寸）
  const state = getRememberWindow() ? loadWindowState() : null
  const win = new BrowserWindow({
    width: state?.width ?? WINDOW_DEFAULTS.width,
    height: state?.height ?? WINDOW_DEFAULTS.height,
    ...(state?.x !== undefined && state?.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: 'AstroBlog Manager',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      webviewTag: true
    }
  })
  if (state?.maximized) win.maximize()

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => setMainWindow(null))
  // 窗口记忆：close 可能在"确认关闭"流程中被 preventDefault，
  // 但此时记录当前 bounds 也无副作用（下次关闭会再次覆盖）
  win.on('close', () => {
    if (getRememberWindow()) saveWindowState(win)
  })
  // 有未保存修改时先询问渲染层（渲染层确认后调用 app:confirm-close）
  win.on('close', (e) => {
    if (forceClose || quitting) return
    e.preventDefault()
    win.webContents.send(IpcChannel.appRequestClose)
  })
  setMainWindow(win)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'local') return new Response('bad request', { status: 400 })
      const root = getCurrentRoot()
      if (!root) return new Response('no project open', { status: 404 })

      const publicRoot = resolve(root, 'public')
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const abs = resolve(publicRoot, rel)
      if (abs !== publicRoot && !abs.startsWith(publicRoot + sep)) {
        return new Response('forbidden', { status: 403 })
      }
      let st
      try {
        st = await stat(abs)
      } catch {
        return new Response('not found', { status: 404 })
      }
      if (!st.isFile()) {
        return new Response('not found', { status: 404 })
      }

      const res = await net.fetch(pathToFileURL(abs).toString())
      const headers = new Headers(res.headers)
      headers.set(
        'Content-Type',
        MEDIA_MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
      )
      return new Response(res.body, { status: res.status, headers })
    } catch (err) {
      return new Response(String(err), { status: 500 })
    }
  })
}

app.setName('astroblog-manager')

// E2E 测试钩子：设置 ASTROTOOLS_E2E=<端口> 时开启 CDP 远程调试（仅测试用）
if (process.env['ASTROTOOLS_E2E']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['ASTROTOOLS_E2E'])
}

app.whenReady().then(async () => {
  registerIpcHandlers()
  registerMediaProtocol()
  // 渲染层确认可以关闭（无脏状态或用户已确认放弃/保存）后放行
  ipcMain.handle(IpcChannel.appConfirmClose, () => {
    forceClose = true
    getMainWindow()?.close()
  })
  // 创建窗口前读取窗口记忆开关（close 事件为同步流程，需主进程侧缓存）
  try {
    setRememberWindow((await loadSettings(app.getPath('userData'))).rememberWindow)
  } catch {
    // 读取失败按默认开启处理
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 退出前确保 dev server 子进程被结束
app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  void disposeIpc().finally(() => app.quit())
})
