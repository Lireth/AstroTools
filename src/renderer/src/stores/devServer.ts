import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DevServerState } from '@shared/types'

export const useDevServerStore = defineStore('devServer', () => {
  const state = ref<DevServerState>({ status: 'idle' })
  let unsubscribe: (() => void) | null = null

  /** 在布局挂载时调用一次，订阅主进程状态推送 */
  function init(): void {
    if (unsubscribe) return
    unsubscribe = window.api.onDevServerState((s) => {
      state.value = s
    })
  }

  /** 布局卸载时调用，解除主进程状态订阅 */
  function dispose(): void {
    unsubscribe?.()
    unsubscribe = null
  }

  async function start(): Promise<void> {
    await window.api.startDevServer()
  }

  async function stop(): Promise<void> {
    await window.api.stopDevServer()
  }

  return { state, init, dispose, start, stop }
})
