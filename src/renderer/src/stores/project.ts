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

  async function removeRecent(path: string): Promise<void> {
    await window.api.removeRecentProject(path)
    await init()
  }

  return { info, recents, opening, init, openByPath, selectAndOpen, refresh, removeRecent }
})
