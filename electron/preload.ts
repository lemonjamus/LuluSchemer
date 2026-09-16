import { contextBridge, ipcRenderer } from 'electron'

interface ChunkMessage {
  id: string
  text?: string
  done?: boolean
  error?: string
}

// Everything the renderer may ask the main process to do. Nothing else is exposed.
contextBridge.exposeInMainWorld('lulu', {
  version: () => ipcRenderer.invoke('app:version'),

  ollama: {
    models: (base: string) => ipcRenderer.invoke('ollama:models', base),
    /** Resolves when the stream ends; onChunk receives raw SSE text. */
    chat: (id: string, base: string, body: unknown, onChunk: (text: string) => void) =>
      new Promise<void>((resolve, reject) => {
        const listener = (_event: unknown, message: ChunkMessage) => {
          if (message.id !== id) return
          if (message.text !== undefined) return onChunk(message.text)
          ipcRenderer.off('ollama:chunk', listener)
          if (message.error) reject(new Error(message.error))
          else resolve()
        }
        ipcRenderer.on('ollama:chunk', listener)
        ipcRenderer.send('ollama:chat', { id, base, body })
      }),
    abort: (id: string) => ipcRenderer.send('ollama:abort', id),
  },

  /** luluschemer:// links, e.g. the Supabase email confirmation coming back to the app. */
  onDeepLink: (callback: (url: string) => void) => {
    const listener = (_event: unknown, url: string) => callback(url)
    ipcRenderer.on('deep-link', listener)
    return () => ipcRenderer.off('deep-link', listener)
  },

  update: {
    check: () => ipcRenderer.invoke('update:check'),
    apply: () => ipcRenderer.invoke('update:apply'),
    onAvailable: (callback: (info: unknown) => void) => {
      const listener = (_event: unknown, info: unknown) => callback(info)
      ipcRenderer.on('update:available', listener)
      return () => ipcRenderer.off('update:available', listener)
    },
  },
})
