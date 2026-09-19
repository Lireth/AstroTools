/// <reference types="vite/client" />
/// <reference types="element-plus/global" />

import type { DefineComponent } from 'vue'
import type { Api } from '@shared/api'

declare global {
  interface Window {
    api: Api
  }
}

// <webview> 标签（Electron 内嵌浏览器）的类型声明
declare module 'vue' {
  interface GlobalComponents {
    webview: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  }
}

export {}
