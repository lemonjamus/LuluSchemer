import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { uid } from '../models'

export type Route = { name: 'home' } | { name: 'project'; projectId: string }
export type SidePanel = 'tasks' | 'layers' | 'info' | null

export interface Toast {
  id: string
  message: string
  kind: 'error' | 'info'
  action?: { label: string; run: () => void }
}

interface UIState {
  route: Route
  paletteOpen: boolean
  settingsOpen: boolean
  aiOpen: boolean
  /** Frozen screen frame while the user is cropping a snip. */
  snipFrame: HTMLCanvasElement | null
  /** Canvas object to pan to once the workspace has loaded (from search / task links). */
  focusObjectId: string | null
  panel: SidePanel
  toasts: Toast[]
  set: (patch: Partial<Omit<UIState, 'set' | 'toast' | 'dismiss'>>) => void
  toast: (message: string, kind?: Toast['kind'], action?: Toast['action']) => void
  dismiss: (id: string) => void
}

export const useUI = create<UIState>((set) => ({
  route: { name: 'home' },
  paletteOpen: false,
  settingsOpen: false,
  aiOpen: false,
  snipFrame: null,
  focusObjectId: null,
  panel: null,
  toasts: [],
  set: (patch) => set(patch),
  toast: (message, kind = 'info', action) => {
    const id = uid()
    set((s) => ({ toasts: [...s.toasts, { id, message, kind, action }] }))
    if (kind === 'info') setTimeout(() => useUI.getState().dismiss(id), 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Wrap a storage write so a failure is always surfaced instead of silently dropping work. */
export function persistOrWarn(p: Promise<unknown>, what: string) {
  p.catch((e) => useUI.getState().toast(`Could not save ${what}: ${e?.message ?? e}. Your changes are still on screen.`, 'error'))
}

export type ProviderChoice = 'auto' | 'claude' | 'mock' | 'local'

interface SettingsState {
  provider: ProviderChoice
  model: string
  sendContext: boolean
  snapToGrid: boolean
  /** Empty = first model the local server lists. */
  localModel: string
  /** Let local reasoning models think before answering. Off = much faster replies. */
  localThinking: boolean
  /** Free-form tone / style instructions added to every AI system prompt. */
  customInstructions: string
  set:(patch: Partial<Omit<SettingsState, 'set'>>) => void
}

// Per-browser preferences only; project data never goes through localStorage.
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      provider: 'auto',
      model: 'claude-opus-5',
      sendContext: true,
      snapToGrid: true,
      localModel: '',
      localThinking: false,
      customInstructions: '',
      set:(patch) => set(patch),
    }),
    { name: 'luluschemer-settings' },
  ),
)
