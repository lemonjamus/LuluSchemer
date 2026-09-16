import { ipcMain } from 'electron'

// Local model calls run here, in the app's own process, so there is no browser origin
// to be blocked: no OLLAMA_ORIGINS, no CORS, no local-network permission prompt.
// Raw SSE text is forwarded to the renderer, which already knows how to parse it.

const controllers = new Map<string, AbortController>()

export function registerOllamaBridge() {
  ipcMain.handle('ollama:models', async (_event, base: string) => {
    const res = await fetch(`${base}/v1/models`)
    if (!res.ok) throw new Error(`local server returned ${res.status}`)
    const json = (await res.json()) as { data?: { id: string }[] }
    return (json.data ?? []).map((m) => m.id)
  })

  ipcMain.on('ollama:chat', async (event, { id, base, body }: { id: string; base: string; body: unknown }) => {
    const send = (message: Record<string, unknown>) => {
      if (!event.sender.isDestroyed()) event.sender.send('ollama:chunk', { id, ...message })
    }
    const controller = new AbortController()
    controllers.set(id, controller)
    try {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300)
        throw new Error(`Local model returned ${res.status}. ${detail || 'Is Ollama running?'}`)
      }
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        send({ text: decoder.decode(value, { stream: true }) })
      }
      send({ done: true })
    } catch (error) {
      const err = error as Error
      send(err.name === 'AbortError' ? { done: true } : { error: err.message })
    } finally {
      controllers.delete(id)
    }
  })

  ipcMain.on('ollama:abort', (_event, id: string) => {
    controllers.get(id)?.abort()
    controllers.delete(id)
  })
}
