/**
 * IPC 通道名单一来源（single source of truth）。
 * 主进程 ipcMain.handle/send 与 preload ipcRenderer.invoke/on 共用本表，
 * 两侧拼写错误可在编译期发现，而非运行时报 "No handler registered"。
 *
 * 命名约定：
 * - invoke：渲染层 → 主进程（ipcMain.handle / ipcRenderer.invoke）
 * - push：主进程 → 渲染层事件推送（webContents.send / ipcRenderer.on）
 */
export const IpcChannel = {
  // ---- 设置 / 最近项目 ----
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsRemoveRecent: 'settings:remove-recent',

  // ---- 项目 ----
  projectSelect: 'project:select',
  projectOpen: 'project:open',
  projectRefresh: 'project:refresh',
  projectShowInFolder: 'project:show-in-folder',
  shellOpenExternal: 'shell:open-external',

  // ---- git ----
  gitStatus: 'git:status',
  gitCommit: 'git:commit',

  // ---- 文章 ----
  postsList: 'posts:list',
  postsRead: 'posts:read',
  postsCreate: 'posts:create',
  postsSave: 'posts:save',
  postsRename: 'posts:rename',
  postsDelete: 'posts:delete',
  postsBulkUpdate: 'posts:bulk-update',
  postsCheckLinks: 'posts:check-links',
  postsTemplate: 'posts:template',

  // ---- 图片 ----
  imagesList: 'images:list',
  imagesImport: 'images:import',
  imagesSave: 'images:save',
  imagesDelete: 'images:delete',
  imagesFindUnused: 'images:find-unused',

  // ---- 生产构建 ----
  buildStart: 'build:start',
  buildStop: 'build:stop',

  // ---- dev server ----
  devStart: 'dev:start',
  devStop: 'dev:stop',

  // ---- 应用生命周期 ----
  appConfirmClose: 'app:confirm-close',

  // ---- push（主进程 → 渲染层） ----
  devState: 'dev:state',
  buildState: 'build:state',
  postsChanged: 'posts:changed',
  appRequestClose: 'app:request-close'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

/**
 * 外部修改冲突错误的 message 前缀（跨进程契约）。
 * Electron 的 invoke 拒绝值只保留 Error.message 字符串，无法传递自定义属性，
 * 因此主进程 savePost 检测到文件被外部修改时以该前缀抛错，
 * 渲染层据此弹出"覆盖外部版本 / 取消"确认。
 */
export const EXTERNAL_MODIFIED_PREFIX = 'external-modified:'
