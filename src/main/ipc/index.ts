import { watch, type FSWatcher } from 'node:fs'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import {
  contentConfigCandidates,
  discoverCollections,
  readProjectInfo,
  validateAstroProject
} from '../services/astroProject'
import { BuildRunner } from '../services/buildRunner'
import { DevServerManager } from '../services/devServer'
import { deleteImage, findUnusedImages, importImage, listImages, saveImage } from '../services/imageService'
import { pathExists } from '../services/paths'
import { gitCommit, gitStatus } from '../services/gitService'
import { addRecentProject, loadSettings, removeRecentProject, updateAppPreferences } from '../services/settings'
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
let buildRunner: BuildRunner | null = null

// ---- 文章文件监听（外部修改自动刷新列表） ----
let postsWatchers: FSWatcher[] = []
let rescanTimer: NodeJS.Timeout | null = null
let watchingRoot: string | null = null
// 代际计数：startPostsWatch 内部有多处 await，快速连续切换项目时，
// 旧的启动流程可能在新一轮 stopPostsWatch 之后才恢复执行并注册 watcher（竞态泄漏）。
// 每次 stop/start 都会使代际 +1，进行中的启动流程在恢复后校验代际，过期即中止并关闭已创建的 watcher。
let watchGeneration = 0

function stopPostsWatch(): void {
  watchGeneration++
  if (rescanTimer) {
    clearTimeout(rescanTimer)
    rescanTimer = null
  }
  for (const w of postsWatchers) {
    try {
      w.close()
    } catch {
      // 忽略已关闭的 watcher
    }
  }
  postsWatchers = []
  watchingRoot = null
}

async function startPostsWatch(root: string): Promise<void> {
  stopPostsWatch()
  const generation = watchGeneration
  watchingRoot = root

  // 防抖重扫：git pull / 其他编辑器的连续改动合并为一次增量扫描并推送
  const rescanAndPush = async (): Promise<void> => {
    if (watchingRoot !== root) return
    try {
      const collections = await discoverCollections(root, { force: true })
      const posts = await scanPosts(root, collections)
      getMainWindow()?.webContents.send('posts:changed', posts)
    } catch {
      // 项目可能在切换中，忽略
    }
  }
  const schedule = (): void => {
    if (rescanTimer) clearTimeout(rescanTimer)
    rescanTimer = setTimeout(() => {
      rescanTimer = null
      void rescanAndPush()
    }, 500)
  }

  // 发现集合目录；失败（如项目正在切换中）则放弃启动，避免成为 unhandled rejection
  let targets: string[]
  try {
    targets = [
      ...(await discoverCollections(root)).map((c) => c.dir),
      ...contentConfigCandidates(root)
    ]
  } catch {
    return
  }
  for (const t of targets) {
    // await 之后校验代际：已被新的启动/停止取代则立即中止，关闭本次已创建的 watcher
    if (generation !== watchGeneration) return
    if (!(await pathExists(t))) continue
    try {
      const w = watch(t, { recursive: true }, schedule)
      if (generation !== watchGeneration) {
        try {
          w.close()
        } catch {
          // 忽略已关闭的 watcher
        }
        return
      }
      postsWatchers.push(w)
    } catch {
      // 单个目标监听失败不影响整体
    }
  }
}

export function registerIpcHandlers(): void {
  devManager = new DevServerManager((state) => {
    getMainWindow()?.webContents.send('dev:state', state)
  })
  buildRunner = new BuildRunner((state) => {
    getMainWindow()?.webContents.send('build:state', state)
  })

  // ---- 设置 / 最近项目 ----
  ipcMain.handle('settings:get', () => loadSettings(app.getPath('userData')))
  ipcMain.handle('settings:save', (_e, patch) => updateAppPreferences(app.getPath('userData'), patch))
  ipcMain.handle('settings:remove-recent', (_e, path: string) =>
    removeRecentProject(app.getPath('userData'), path)
  )

  // ---- git ----
  ipcMain.handle('git:status', () => gitStatus(requireRoot()))
  ipcMain.handle('git:commit', (_e, ids: string[], message: string) =>
    gitCommit(requireRoot(), ids, message)
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
    void startPostsWatch(path)
    await addRecentProject(app.getPath('userData'), path)
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
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return Promise.all(result.filePaths.map((p) => importImage(root, p)))
  })

  // 编辑器粘贴/拖入的图片数据（渲染进程以 Uint8Array 传输）
  ipcMain.handle('images:save', (_e, name: string, mime: string, data: Uint8Array) =>
    saveImage(requireRoot(), name, mime, data)
  )

  ipcMain.handle('images:delete', async (_e, relPath: string) => {
    await deleteImage(requireRoot(), relPath, shell.trashItem)
  })

  ipcMain.handle('images:find-unused', () => findUnusedImages(requireRoot()))

  // ---- 生产构建 ----
  ipcMain.handle('build:start', () => {
    const project = getCurrentProject()
    if (!project) throw new Error('尚未打开 Astro 项目')
    buildRunner?.start(project.path, project.packageManager)
  })
  ipcMain.handle('build:stop', async () => {
    await buildRunner?.stop()
  })

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

/** 应用退出前停止 dev server / 构建子进程与文件监听 */
export async function disposeIpc(): Promise<void> {
  stopPostsWatch()
  await Promise.all([devManager?.stop(), buildRunner?.stop()])
}
