import type { Session } from '@supabase/supabase-js'
import { create } from 'zustand'
import { importLocalData } from '../services/storage'
import { supabase } from '../services/supabase'
import { useAI } from './ai'
import { useCanvas } from './canvas'
import { useProjects } from './projects'
import { useTasks } from './tasks'
import { useUI } from './ui'

interface AuthState {
  session: Session | null
  /** False until the stored session has been checked (always true in local-only mode). */
  ready: boolean
  /** Progress text while importing this browser's local data. */
  importStatus: string | null
  init: () => () => void
  /** Each returns an error / notice message, or null on success. */
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

/** Only the desktop app can receive these; the browser build keeps the default redirect. */
const DEEP_LINK_CALLBACK = typeof window !== 'undefined' && window.lulu ? 'luluschemer://auth-callback' : ''

/**
 * Finish a sign-in that came back through a luluschemer:// link. Supabase sends either
 * tokens in the URL fragment or a PKCE code to exchange, so handle both.
 */
export async function completeDeepLinkAuth(url: string): Promise<string | null> {
  if (!supabase) return null
  const parsed = new URL(url)
  const params = new URLSearchParams(`${parsed.search.slice(1)}&${parsed.hash.slice(1)}`)
  const error = params.get('error_description') ?? params.get('error')
  if (error) return friendly(error)

  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (accessToken && refreshToken) {
    const { error: e } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
    return e ? friendly(e.message) : null
  }
  const code = params.get('code')
  if (code) {
    const { error: e } = await supabase.auth.exchangeCodeForSession(code)
    return e ? friendly(e.message) : null
  }
  return null // a link with nothing to act on (e.g. already confirmed)
}

const friendly = (message: string) =>
  /failed to fetch|networkerror|load failed/i.test(message) ? "Can't reach Supabase. Check your connection (or VITE_SUPABASE_URL)." : message

export const useAuth = create<AuthState>((set) => ({
  session: null,
  ready: !supabase,
  importStatus: null,

  init: () => {
    if (!supabase) return () => {}
    supabase.auth.getSession().then(({ data }) => set({ session: data.session, ready: true }))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => set({ session, ready: true }))
    return () => data.subscription.unsubscribe()
  },

  signIn: async (email, password) => {
    const { error } = await supabase!.auth.signInWithPassword({ email, password })
    return error ? friendly(error.message) : null
  },

  signUp: async (email, password) => {
    const { data, error } = await supabase!.auth.signUp({
      email,
      password,
      // Send the confirmation link back into the app instead of a web page it doesn't serve.
      ...(DEEP_LINK_CALLBACK ? { options: { emailRedirectTo: DEEP_LINK_CALLBACK } } : {}),
    })
    if (error) return friendly(error.message)
    // The confirmation link verifies the account and then redirects to the project's Site URL,
    // which is a web address this desktop app doesn't serve — the browser error is harmless.
    return data.session ? null : 'Check your inbox and open the link, then sign in here. The link may end on a "can’t connect" page; your account is confirmed anyway.'
  },

  signOut: async () => {
    useCanvas.getState().unload() // flushes a pending canvas save first
    await supabase?.auth.signOut()
    useProjects.setState({ projects: [], loaded: false })
    useTasks.setState({ tasks: [] })
    useAI.setState({ conversation: null, attachments: [], draft: '' })
    useUI.setState({ route: { name: 'home' }, aiOpen: false, settingsOpen: false, panel: null })
  },
}))

export async function runLocalImport() {
  const ui = useUI.getState()
  if (useAuth.getState().importStatus) return
  useAuth.setState({ importStatus: 'Starting…' })
  try {
    const r = await importLocalData((message) => useAuth.setState({ importStatus: message }))
    await Promise.all([useProjects.getState().load(), useTasks.getState().load()])
    ui.toast(`Imported ${r.projects} projects, ${r.tasks} tasks, ${r.canvases} canvases and ${r.images} images.`)
  } catch (e) {
    ui.toast(`Import failed: ${(e as Error).message}. Nothing in this browser was deleted, so you can retry.`, 'error')
  } finally {
    useAuth.setState({ importStatus: null })
  }
}
