import { useEffect } from 'react'
import logo from './assets/lulu-logo.png'
import { AuthScreen } from './components/AuthScreen'
import { CommandPalette } from './components/CommandPalette'
import { Dashboard } from './components/Dashboard'
import { SettingsModal } from './components/SettingsModal'
import { SnipOverlay } from './components/SnipOverlay'
import { Toasts } from './components/ui'
import { Workspace } from './components/Workspace'
import type { LuluUpdateInfo } from './electron'
import { cloud, localDataCounts } from './services/storage'
import { completeDeepLinkAuth, runLocalImport, useAuth } from './stores/auth'
import { useProjects } from './stores/projects'
import { useTasks } from './stores/tasks'
import { useUI } from './stores/ui'

const loadData = () =>
  Promise.all([useProjects.getState().load(), useTasks.getState().load()]).catch((e) => {
    useProjects.setState({ loaded: true }) // show the app anyway; the toast explains
    useUI.getState().toast(`Could not load your data: ${e?.message ?? e}`, 'error', { label: 'Retry', run: () => location.reload() })
  })

/** First sign-in on a browser that already has local data: offer to copy it into the account. */
async function offerImport() {
  if (useProjects.getState().projects.length) return
  const local = await localDataCounts().catch(() => ({ projects: 0, tasks: 0 }))
  if (!local.projects && !local.tasks) return
  useUI.getState().toast(`This browser has ${local.projects} project(s) and ${local.tasks} task(s) from before sign-in.`, 'info', {
    label: 'Import',
    run: () => runLocalImport(),
  })
}

export default function App() {
  const route = useUI((s) => s.route)
  const loaded = useProjects((s) => s.loaded)
  const ready = useAuth((s) => s.ready)
  const userId = useAuth((s) => s.session?.user.id ?? null)

  useEffect(() => {
    const stopAuth = useAuth.getState().init()
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useUI.setState((s) => ({ paletteOpen: !s.paletteOpen }))
      }
    }
    window.addEventListener('keydown', onKey)

    // Desktop only: offer the new version when one has been found.
    const app = window.lulu
    const show = (info: LuluUpdateInfo) =>
      useUI.getState().toast(
        info.canInstall ? `Update ${info.version} is ready` : `Update ${info.version} is available`,
        'info',
        { label: info.canInstall ? 'Relaunch' : 'Download', run: () => void app?.update.apply() },
        true, // stays until dismissed
      )
    // Email confirmation links come back as luluschemer:// and sign the user in here.
    const stopDeepLinks = app?.onDeepLink(async (url) => {
      const problem = await completeDeepLinkAuth(url)
      useUI.getState().toast(problem ?? 'Email confirmed — you are signed in.', problem ? 'error' : 'info')
    })
    const stopUpdates = app?.update.onAvailable(show)
    app?.update.check().then((info) => info && show(info), () => {}) // a failed check is reported in Settings

    return () => {
      stopAuth()
      stopDeepLinks?.()
      stopUpdates?.()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (cloud && !userId) return
    loadData().then(() => {
      if (cloud) offerImport()
    })
    if (!cloud) return
    // Pick up changes made on another device when you come back to this tab.
    const onVisible = () => document.visibilityState === 'visible' && loadData()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [userId])

  const boot = (
    <div className="boot">
      <img src={logo} alt="" />
      LuluSchemer
    </div>
  )
  if (!ready) return boot
  if (cloud && !userId) {
    return (
      <>
        <AuthScreen />
        <Toasts />
      </>
    )
  }
  if (!loaded) return boot

  return (
    <>
      {route.name === 'project' ? <Workspace key={route.projectId} projectId={route.projectId} /> : <Dashboard />}
      <CommandPalette />
      <SettingsModal />
      <SnipOverlay />
      <Toasts />
    </>
  )
}
