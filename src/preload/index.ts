import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { Api } from '../shared/api'
import type { BuildState, DevServerState, PostMeta } from '../shared/types'

const api: Api = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  removeRecentProject: (path) => ipcRenderer.invoke('settings:remove-recent', path),
  selectProjectFolder: () => ipcRenderer.invoke('project:select'),
  openProject: (path) => ipcRenderer.invoke('project:open', path),
  refreshProject: () => ipcRenderer.invoke('project:refresh'),
  showProjectInFolder: () => ipcRenderer.invoke('project:show-in-folder'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  listPosts: () => ipcRenderer.invoke('posts:list'),
  readPost: (id) => ipcRenderer.invoke('posts:read', id),
  createPost: (input) => ipcRenderer.invoke('posts:create', input),
  savePost: (input) => ipcRenderer.invoke('posts:save', input),
  renamePost: (id, newFileName) => ipcRenderer.invoke('posts:rename', id, newFileName),
  deletePost: (id) => ipcRenderer.invoke('posts:delete', id),
  bulkUpdatePosts: (ids, patch) => ipcRenderer.invoke('posts:bulk-update', ids, patch),
  checkLinks: () => ipcRenderer.invoke('posts:check-links'),
  getFrontmatterTemplate: (collection) => ipcRenderer.invoke('posts:template', collection),

  listImages: () => ipcRenderer.invoke('images:list'),
  importImages: () => ipcRenderer.invoke('images:import'),
  saveImage: (name, mime, data) => ipcRenderer.invoke('images:save', name, mime, data),
  deleteImage: (relPath) => ipcRenderer.invoke('images:delete', relPath),
  findUnusedImages: () => ipcRenderer.invoke('images:find-unused'),

  startDevServer: () => ipcRenderer.invoke('dev:start'),
  stopDevServer: () => ipcRenderer.invoke('dev:stop'),
  onDevServerState: (cb) => {
    const handler = (_e: IpcRendererEvent, state: DevServerState): void => cb(state)
    ipcRenderer.on('dev:state', handler)
    return () => {
      ipcRenderer.removeListener('dev:state', handler)
    }
  },

  startBuild: () => ipcRenderer.invoke('build:start'),
  stopBuild: () => ipcRenderer.invoke('build:stop'),
  onBuildState: (cb) => {
    const handler = (_e: IpcRendererEvent, state: BuildState): void => cb(state)
    ipcRenderer.on('build:state', handler)
    return () => {
      ipcRenderer.removeListener('build:state', handler)
    }
  },

  onPostsChanged: (cb) => {
    const handler = (_e: IpcRendererEvent, posts: PostMeta[]): void => cb(posts)
    ipcRenderer.on('posts:changed', handler)
    return () => {
      ipcRenderer.removeListener('posts:changed', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
