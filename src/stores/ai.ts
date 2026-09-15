import { create } from 'zustand'
import { blobToBase64 } from '../lib'
import { now, uid, type AIAttachment, type AIConversation, type AIMessage } from '../models'
import { resolveProvider, type AIImage, type AIRequestMessage } from '../services/ai'
import { buildSystemPrompt } from '../services/aiContext'
import { files, repos } from '../services/storage'
import { persistOrWarn, useSettings } from './ui'

interface AIState {
  conversation: AIConversation | null
  streaming: boolean
  providerLabel: string
  attachments: AIAttachment[]
  /** Composer text; canvas actions can prefill it. */
  draft: string
  open:(projectId: string | null) => Promise<void>
  attach: (a: AIAttachment) => void
  detach: (fileId: string) => void
  send: (text: string) => Promise<void>
  retry: () => Promise<void>
  stop: () => void
  clear: () => void
}

let controller: AbortController | null = null

const saveConv = (c: AIConversation) => persistOrWarn(repos.conversations.put(c), 'AI conversation')

export const useAI = create<AIState>((set, get) => {
  const patchConv = (fn: (c: AIConversation) => AIConversation) => {
    const c = get().conversation
    if (c) set({ conversation: fn(c) })
  }

  async function toRequestMessages(messages: AIMessage[]): Promise<AIRequestMessage[]> {
    return Promise.all(
      messages.filter((m) => m.role !== 'error').map(async (m) => {
        const images: AIImage[] = []
        for (const a of m.attachments) {
          const blob = await files.getBlob(a.fileId)
          if (blob) images.push({ mediaType: a.mediaType as AIImage['mediaType'], data: await blobToBase64(blob) })
        }
        return { role: m.role as 'user' | 'assistant', text: m.content, images }
      }),
    )
  }

  async function generate() {
    const conv = get().conversation
    if (!conv) return
    const settings = useSettings.getState()
    const provider = await resolveProvider(settings.provider)
    const reply: AIMessage = { id: uid(), role: 'assistant', content: '', attachments: [], createdAt: now() }
    controller = new AbortController()
    const model = provider.id === 'local' ? settings.localModel : settings.model
    set({ streaming: true, providerLabel: provider.id === 'local' ? `Local · ${model || 'auto'}` : provider.label })
    try {
      const messages = await toRequestMessages(conv.messages)
      patchConv((c) => ({ ...c, messages: [...c.messages, reply] }))
      await provider.stream(
        { system: buildSystemPrompt(conv.projectId, settings.sendContext), messages, model, think: settings.localThinking },
        (delta) => {
          reply.content += delta
          patchConv((c) => ({ ...c, messages: c.messages.map((m) => (m.id === reply.id ? { ...reply } : m)) }))
        },
        controller.signal,
      )
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError' || controller?.signal.aborted
      if (!aborted) {
        const err: AIMessage = {
          id: uid(), role: 'error', attachments: [], createdAt: now(),
          content: `AI request failed: ${(e as Error)?.message ?? e}\nYour canvas has not been affected.`,
        }
        patchConv((c) => ({ ...c, messages: [...c.messages.filter((m) => m.id !== reply.id || m.content), err] }))
      }
    } finally {
      controller = null
      set({ streaming: false })
      const c = get().conversation
      if (c) saveConv({ ...c, updatedAt: now() })
    }
  }

  return {
    conversation: null,
    streaming: false,
    providerLabel: '',
    attachments: [],
    draft: '',

    open:async (projectId) => {
      const id = projectId ?? 'global'
      if (get().conversation?.id === id) return
      get().stop()
      const existing = await repos.conversations.get(id)
      set({ conversation: existing ?? { id, projectId, messages: [], createdAt: now(), updatedAt: now() } })
    },

    attach: (a) => set((s) => ({ attachments: [...s.attachments, a] })),
    detach: (fileId) => set((s) => ({ attachments: s.attachments.filter((a) => a.fileId !== fileId) })),

    send: async (text) => {
      const { conversation, attachments, streaming } = get()
      if (!conversation || streaming || (!text.trim() && !attachments.length)) return
      const msg: AIMessage = { id: uid(), role: 'user', content: text.trim(), attachments, createdAt: now() }
      set({ attachments: [] })
      patchConv((c) => ({ ...c, messages: [...c.messages, msg] }))
      await generate()
    },

    retry: async () => {
      if (get().streaming) return
      patchConv((c) => {
        const messages = [...c.messages]
        while (messages.length && messages[messages.length - 1].role !== 'user') messages.pop()
        return { ...c, messages }
      })
      await generate()
    },

    stop: () => controller?.abort(),

    clear: () => {
      get().stop()
      patchConv((c) => ({ ...c, messages: [] }))
      const c = get().conversation
      if (c) saveConv(c)
    },
  }
})
