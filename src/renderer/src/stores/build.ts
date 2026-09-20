import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BuildState } from '@shared/types'

export const useBuildStore = defineStore('build', () => {
  const state = ref<BuildState>({ status: 'idle' })
  let unsubscribe: (() => void) | null = null

  /** 在布局挂载时调用一次，订阅主进程构建状态推送 */
  function init(): void {
    if (unsubscribe) return
    unsubscribe = window.api.onBuildState((s) => {
      state.value = s
    })
  }

  async function start(): Promise<void> {
    await window.api.startBuild()
  }

  async function stop(): Promise<void> {
    await window.api.stopBuild()
  }

  return { state, init, start, stop }
})
