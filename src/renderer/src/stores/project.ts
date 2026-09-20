import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ProjectInfo } from '@shared/types'

export const useProjectStore = defineStore('project', () => {
  const info = ref<ProjectInfo | null>(null)
  const recents = ref<string[]>([])
  const opening = ref(false)

  async function init(): Promise<void> {
    const settings = await window.api.getSettings()
    recents.value = settings.recentProjects
  }

  async function openByPath(path: string): Promise<ProjectInfo> {
    opening.value = true
    try {
      info.value = await window.api.openProject(path)
      await init()
      return info.value
    } finally {
      opening.value = false
    }
  }

  async function selectAndOpen(): Promise<ProjectInfo | null> {
    const path = await window.api.selectProjectFolder()
    if (!path) return null
    return openByPath(path)
  }

  async function refresh(): Promise<void> {
    info.value = await window.api.refreshProject()
  }

  /** 渲染层重载（崩溃/刷新）后恢复会话：主进程仍持有当前项目时直接取回，不重新扫描 */
  async function restore(): Promise<void> {
    if (info.value) return
    const current = await window.api.getCurrentProject()
    if (current) info.value = current
  }

  async function removeRecent(path: string): Promise<void> {
    await window.api.removeRecentProject(path)
    await init()
  }

  return { info, recents, opening, init, openByPath, selectAndOpen, refresh, restore, removeRecent }
})
