import { app, BrowserWindow, ipcMain, net, protocol } from 'electron'
import { stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { disposeIpc, registerIpcHandlers } from './ipc'
import { getCurrentRoot, getMainWindow, setMainWindow } from './state'

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
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
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

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => setMainWindow(null))
  // 有未保存修改时先询问渲染层（渲染层确认后调用 app:confirm-close）
  win.on('close', (e) => {
    if (forceClose || quitting) return
    e.preventDefault()
    win.webContents.send('app:request-close')
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

app.whenReady().then(() => {
  registerIpcHandlers()
  registerMediaProtocol()
  // 渲染层确认可以关闭（无脏状态或用户已确认放弃/保存）后放行
  ipcMain.handle('app:confirm-close', () => {
    forceClose = true
    getMainWindow()?.close()
  })
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
