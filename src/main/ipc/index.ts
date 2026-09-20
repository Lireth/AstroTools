import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { discoverCollections, readProjectInfo, validateAstroProject } from '../services/astroProject'
import { DevServerManager } from '../services/devServer'
import { importImage, listImages, saveImage } from '../services/imageService'
import {
  bulkUpdatePosts,
  buildFrontmatterTemplate,
  clearPostCache,
  createPost,
  deletePost,
  readPost,
  renamePost,
  savePost,
  scanPosts
} from '../services/postService'
import { checkLinks } from '../services/linkChecker'
import { addRecentProject, loadSettings, removeRecentProject } from '../services/settings'
import { getCurrentProject, getCurrentRoot, getMainWindow, setCurrentProject } from '../state'

function requireRoot(): string {
  const root = getCurrentRoot()
  if (!root) throw new Error('尚未打开 Astro 项目')
  return root
}

function currentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

const IMAGE_FILTER = {
  name: '图片',
  extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'ico', 'bmp']
}

let devManager: DevServerManager | null = null

export function registerIpcHandlers(): void {
  devManager = new DevServerManager((state) => {
    getMainWindow()?.webContents.send('dev:state', state)
  })

  // ---- 设置 / 最近项目 ----
  ipcMain.handle('settings:get', () => loadSettings(app.getPath('userData')))
  ipcMain.handle('settings:remove-recent', (_e, path: string) =>
    removeRecentProject(app.getPath('userData'), path)
  )

  // ---- 项目 ----
  ipcMain.handle('project:select', async () => {
    const win = currentWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '选择 Astro 博客项目文件夹',
      properties: ['openDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('project:open', async (_e, path: string) => {
    const validation = await validateAstroProject(path)
    if (!validation.ok) throw new Error(validation.reason ?? '不是有效的 Astro 项目')
    void devManager?.stop()
    const previousRoot = getCurrentRoot()
    const info = await readProjectInfo(path)
    setCurrentProject(info)
    if (previousRoot && previousRoot !== path) clearPostCache(previousRoot)
    addRecentProject(app.getPath('userData'), path)
    return info
  })

  ipcMain.handle('project:refresh', async () => {
    const root = requireRoot()
    const info = await readProjectInfo(root)
    setCurrentProject(info)
    return info
  })

  ipcMain.handle('project:show-in-folder', async () => {
    await shell.openPath(requireRoot())
  })

  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('仅允许打开 http/https 链接')
    return shell.openExternal(url)
  })

  // ---- 文章 ----
  ipcMain.handle('posts:list', async () => {
    const root = requireRoot()
    return scanPosts(root, await discoverCollections(root))
  })

  ipcMain.handle('posts:read', (_e, id: string) => readPost(requireRoot(), id))

  ipcMain.handle('posts:create', async (_e, input) => {
    const root = requireRoot()
    return createPost(root, input, await discoverCollections(root))
  })

  ipcMain.handle('posts:save', (_e, input) => savePost(requireRoot(), input))

  ipcMain.handle('posts:rename', (_e, id: string, newFileName: string) =>
    renamePost(requireRoot(), id, newFileName)
  )

  ipcMain.handle('posts:delete', async (_e, id: string) => {
    await deletePost(requireRoot(), id, shell.trashItem)
  })

  ipcMain.handle('posts:bulk-update', (_e, ids: string[], patch) =>
    bulkUpdatePosts(requireRoot(), ids, patch)
  )

  ipcMain.handle('posts:check-links', async () => {
    const root = requireRoot()
    return checkLinks(root, await discoverCollections(root))
  })

  ipcMain.handle('posts:template', async (_e, collection: string) => {
    const root = requireRoot()
    return buildFrontmatterTemplate(root, collection, await discoverCollections(root))
  })

  // ---- 图片 ----
  ipcMain.handle('images:list', () => listImages(requireRoot()))

  ipcMain.handle('images:import', async () => {
    const root = requireRoot()
    const win = currentWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '选择要导入的图片',
      filters: [IMAGE_FILTER],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return importImage(root, result.filePaths[0])
  })

  // 编辑器粘贴/拖入的图片数据（渲染进程以 Uint8Array 传输）
  ipcMain.handle('images:save', (_e, name: string, mime: string, data: Uint8Array) =>
    saveImage(requireRoot(), name, mime, data)
  )

  // ---- dev server ----
  ipcMain.handle('dev:start', async () => {
    const project = getCurrentProject()
    const manager = devManager
    if (!project) throw new Error('尚未打开 Astro 项目')
    if (!manager) throw new Error('dev server 管理器未初始化')
    await manager.start(project.path, project.packageManager)
  })
  ipcMain.handle('dev:stop', async () => {
    await devManager?.stop()
  })
}

/** 应用退出前停止 dev server 子进程 */
export async function disposeIpc(): Promise<void> {
  await devManager?.stop()
}
