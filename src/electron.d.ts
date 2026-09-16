/** Bridge exposed by electron/preload.ts. Undefined in the browser build. */
export interface LuluUpdateInfo {
  version: string
  /** downloading: being fetched. ready: relaunch installs it. manual: open the download page. */
  state: 'downloading' | 'ready' | 'manual'
  url?: string
}

export interface LuluBridge {
  version(): Promise<string>
  /** luluschemer:// links (Supabase email confirmation). Returns an unsubscribe function. */
  onDeepLink(callback: (url: string) => void): () => void
  ollama: {
    models(base: string): Promise<string[]>
    chat(id: string, base: string, body: unknown, onChunk: (text: string) => void): Promise<void>
    abort(id: string): void
  }
  update: {
    check(): Promise<LuluUpdateInfo | null>
    apply(): Promise<boolean>
    onAvailable(callback: (info: LuluUpdateInfo) => void): () => void
  }
}

declare global {
  interface Window {
    lulu?: LuluBridge
  }
}

export {}
