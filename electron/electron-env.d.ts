/// <reference types="vite-plugin-electron/electron-env" />
import type { RendererAPI } from './ipc/channels'

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

declare global {
  // Used in Renderer process, expose in `preload.ts`
  interface Window {
    appApi: RendererAPI
  }
}

export {}
