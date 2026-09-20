import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IpcChannel } from '../shared/channels'
import type { Api } from '../shared/api'
import type { BuildState, DevServerState, PostMeta } from '../shared/types'

const api: Api = {
  getSettings: () => ipcRenderer.invoke(IpcChannel.settingsGet),
  savePreferences: (patch) => ipcRenderer.invoke(IpcChannel.settingsSave, patch),
  removeRecentProject: (path) => ipcRenderer.invoke(IpcChannel.settingsRemoveRecent, path),
  clearRecentProjects: () => ipcRenderer.invoke(IpcChannel.settingsClearRecent),
  selectProjectFolder: () => ipcRenderer.invoke(IpcChannel.projectSelect),
  openProject: (path) => ipcRenderer.invoke(IpcChannel.projectOpen, path),
  refreshProject: () => ipcRenderer.invoke(IpcChannel.projectRefresh),
  getCurrentProject: () => ipcRenderer.invoke(IpcChannel.projectGetCurrent),
  showProjectInFolder: () => ipcRenderer.invoke(IpcChannel.projectShowInFolder),
  openExternal: (url) => ipcRenderer.invoke(IpcChannel.shellOpenExternal, url),
  setUiZoom: (factor) => {
    webFrame.setZoomFactor(factor)
  },

  getGitStatus: () => ipcRenderer.invoke(IpcChannel.gitStatus),
  commitPosts: (ids, message) => ipcRenderer.invoke(IpcChannel.gitCommit, ids, message),

  listPosts: () => ipcRenderer.invoke(IpcChannel.postsList),
  readPost: (id) => ipcRenderer.invoke(IpcChannel.postsRead, id),
  createPost: (input) => ipcRenderer.invoke(IpcChannel.postsCreate, input),
  savePost: (input) => ipcRenderer.invoke(IpcChannel.postsSave, input),
  renamePost: (id, newFileName) => ipcRenderer.invoke(IpcChannel.postsRename, id, newFileName),
  deletePost: (id) => ipcRenderer.invoke(IpcChannel.postsDelete, id),
  bulkUpdatePosts: (ids, patch) => ipcRenderer.invoke(IpcChannel.postsBulkUpdate, ids, patch),
  checkLinks: () => ipcRenderer.invoke(IpcChannel.postsCheckLinks),
  getFrontmatterTemplate: (collection) => ipcRenderer.invoke(IpcChannel.postsTemplate, collection),

  listImages: () => ipcRenderer.invoke(IpcChannel.imagesList),
  importImages: () => ipcRenderer.invoke(IpcChannel.imagesImport),
  saveImage: (name, mime, data) => ipcRenderer.invoke(IpcChannel.imagesSave, name, mime, data),
  deleteImage: (relPath) => ipcRenderer.invoke(IpcChannel.imagesDelete, relPath),
  findUnusedImages: () => ipcRenderer.invoke(IpcChannel.imagesFindUnused),

  startDevServer: () => ipcRenderer.invoke(IpcChannel.devStart),
  stopDevServer: () => ipcRenderer.invoke(IpcChannel.devStop),
  onDevServerState: (cb) => {
    const handler = (_e: IpcRendererEvent, state: DevServerState): void => cb(state)
    ipcRenderer.on(IpcChannel.devState, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannel.devState, handler)
    }
  },

  startBuild: () => ipcRenderer.invoke(IpcChannel.buildStart),
  stopBuild: () => ipcRenderer.invoke(IpcChannel.buildStop),
  onBuildState: (cb) => {
    const handler = (_e: IpcRendererEvent, state: BuildState): void => cb(state)
    ipcRenderer.on(IpcChannel.buildState, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannel.buildState, handler)
    }
  },

  onPostsChanged: (cb) => {
    const handler = (_e: IpcRendererEvent, posts: PostMeta[]): void => cb(posts)
    ipcRenderer.on(IpcChannel.postsChanged, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannel.postsChanged, handler)
    }
  },

  onAppRequestClose: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on(IpcChannel.appRequestClose, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannel.appRequestClose, handler)
    }
  },
  confirmAppClose: () => ipcRenderer.invoke(IpcChannel.appConfirmClose)
}

contextBridge.exposeInMainWorld('api', api)
