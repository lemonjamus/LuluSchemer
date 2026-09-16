import Anthropic from '@anthropic-ai/sdk'
import { stripThinking } from '../lib'
import { useSettings } from '../stores/ui'
import { accessToken } from './supabase'

export interface AIImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  data: string // base64
}

export interface AIRequestMessage {
  role: 'user' | 'assistant'
  text: string
  images: AIImage[]
}

export interface AIRequest {
  system: string
  messages: AIRequestMessage[]
  model: string
  /** Local models only: allow reasoning before the answer (slow when the model is split across CPU/GPU). */
  think?: boolean
}

/** Every AI backend implements this. Add OpenAI / Ollama providers alongside these two. */
export interface AIProvider {
  id: string
  label: string
  supportsImages: boolean
  stream(req: AIRequest, onText: (delta: string) => void, signal: AbortSignal): Promise<void>
}

// Browser talks to /api/anthropic: the Vite proxy in dev, netlify/edge-functions/anthropic.ts when hosted.
// Both inject ANTHROPIC_API_KEY server-side; the apiKey below is a placeholder. The hosted proxy also
// requires the Supabase session token, so only signed-in users can spend the key.
export const claudeProvider: AIProvider = {
  id: 'claude',
  label: 'Claude',
  supportsImages: true,
  async stream(req, onText, signal) {
    const token = await accessToken()
    const client = new Anthropic({
      baseURL: `${location.origin}/api/anthropic`,
      apiKey: 'injected-by-proxy',
      dangerouslyAllowBrowser: true,
      ...(token ? { defaultHeaders: { 'x-supabase-token': token } } : {}),
    })
    const stream = client.beta.messages.stream(
      {
        model: req.model,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        // Server-side fallback: if the primary model declines, the API reroutes by refusal category.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: req.system,
        messages: req.messages.map((m) => ({
          role: m.role,
          content: [
            ...m.images.map((img) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.mediaType, data: img.data },
            })),
            { type: 'text' as const, text: m.text || '(image)' },
          ],
        })),
      },
      { signal },
    )
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') onText(ev.delta.text)
    }
    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') throw new Error('Claude declined this request.')
    if (final.stop_reason === 'max_tokens') onText('\n\n[response truncated at max_tokens]')
  },
}

/**
 * Development provider for when no API key is configured. It does not pretend to be a model:
 * it reports exactly what context it received, and turns bullet/sentence input into a checklist
 * so the "Add to Tasks / Add to Canvas" pipeline can be exercised offline.
 */
export const mockProvider: AIProvider = {
  id: 'mock',
  label: 'Mock (offline)',
  supportsImages: true,
  async stream(req, onText, signal) {
    const last = req.messages[req.messages.length - 1]
    const quoted = last.text.match(/"""\n([\s\S]*?)\n"""/)?.[1] ?? ''
    const wantsTasks = /\btasks?\b/i.test(last.text.split('\n')[0])
    const lines = [
      '[mock provider — no model connected]',
      `context: ${req.system.length} chars of project context, ${last.images.length} image(s) attached`,
      '',
    ]
    if (wantsTasks && quoted) {
      lines.push('Checklist derived from your text (split on sentences, not reasoned):')
      for (const s of quoted.split(/[.\n]+/).map((x) => x.trim()).filter(Boolean)) lines.push(`- [ ] ${s}`)
    } else {
      lines.push(`you said: ${last.text.slice(0, 400)}`)
    }
    lines.push('', 'For real answers pick Local (Ollama) in Settings, or add ANTHROPIC_API_KEY to .env and restart `npm run dev`.')
    for (const chunk of lines.join('\n').match(/[\s\S]{1,12}/g) ?? []) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      await new Promise((r) => setTimeout(r, 12))
      onText(chunk)
    }
  },
}

let claudeAvailable: Promise<boolean> | null = null
export function hasClaudeKey(): Promise<boolean> {
  claudeAvailable ??= fetch('/api/ai-status')
    .then((r) => r.json())
    .then((j) => !!j.claude)
    .catch(() => false)
  return claudeAvailable
}

/** The Electron bridge, when running as the desktop app. */
const desktop = () => (typeof window === 'undefined' ? undefined : window.lulu)

/** Desktop: the main process calls the server. Browser dev: the Vite proxy. */
const localBase = () => (import.meta.env.DEV && !desktop() ? '/api/local' : useSettings.getState().localUrl.replace(/\/+$/, ''))

export async function listLocalModels(): Promise<string[]> {
  const app = desktop()
  if (app) return app.ollama.models(localBase())
  const r = await fetch(`${localBase()}/v1/models`)
  if (!r.ok) throw new Error(`local server returned ${r.status}`)
  return ((await r.json()).data ?? []).map((m: { id: string }) => m.id)
}

/** Ollama / LM Studio / llama.cpp via their OpenAI-compatible endpoint, proxied at /api/local. */
export const localProvider: AIProvider = {
  id: 'local',
  label: 'Local',
  supportsImages: true, // only vision models use them; others return an error the panel shows
  async stream(req, onText, signal) {
    const model = req.model || (await listLocalModels())[0]
    if (!model) throw new Error('No models found on the local server. Pull one first, e.g. `ollama pull qwen3`.')
    const body = {
      model,
      stream: true,
      ...(req.think ? {} : { reasoning_effort: 'none' }), // Ollama: skip the thinking phase
      messages: [
        { role: 'system', content: req.system },
        ...req.messages.map((m) => ({
          role: m.role,
          content: m.images.length
            ? [...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mediaType};base64,${i.data}` } })), { type: 'text', text: m.text }]
            : m.text,
        })),
      ],
    }

    // Parse the SSE text; hide <think> reasoning (Qwen3 etc.) as it streams.
    let buf = '', full = '', shown = 0
    const flush = (final: boolean) => {
      const visible = stripThinking(full, final)
      if (visible.length > shown) {
        onText(visible.slice(shown))
        shown = visible.length
      }
    }
    const consume = (chunk: string) => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop()!
      for (const line of lines) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : ''
        if (!data || data === '[DONE]') continue
        full += JSON.parse(data).choices?.[0]?.delta?.content ?? ''
      }
      flush(false)
    }

    const app = desktop()
    if (app) {
      // Desktop: the request is made by the app's own process, so no browser origin is involved.
      const id = crypto.randomUUID()
      const abort = () => app.ollama.abort(id)
      signal.addEventListener('abort', abort, { once: true })
      try {
        await app.ollama.chat(id, localBase(), body, consume)
      } finally {
        signal.removeEventListener('abort', abort)
      }
      flush(true)
      return
    }

    const res = await fetch(`${localBase()}/v1/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      throw new Error(`Local model (${model}) returned ${res.status}. ${detail || 'Is Ollama running?'}`)
    }
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      consume(value)
    }
    flush(true)
  },
}

export async function resolveProvider(choice: 'auto' | 'claude' | 'mock' | 'local'): Promise<AIProvider> {
  if (choice === 'claude') return claudeProvider
  if (choice === 'mock') return mockProvider
  if (choice === 'local') return localProvider
  if (desktop()) return localProvider // no Claude proxy in the desktop app
  return (await hasClaudeKey()) ? claudeProvider : mockProvider
}
