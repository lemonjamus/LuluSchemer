import { useEffect } from 'react'
import logo from './assets/lulu-logo.png'
import { CommandPalette } from './components/CommandPalette'
import { Dashboard } from './components/Dashboard'
import { SettingsModal } from './components/SettingsModal'
import { SnipOverlay } from './components/SnipOverlay'
import { Toasts } from './components/ui'
import { Workspace } from './components/Workspace'
import { useProjects } from './stores/projects'
import { useTasks } from './stores/tasks'
import { useUI } from './stores/ui'

export default function App() {
  const route = useUI((s) => s.route)
  const loaded = useProjects((s) => s.loaded)

  useEffect(() => {
    Promise.all([useProjects.getState().load(), useTasks.getState().load()]).catch((e) =>
      useUI.getState().toast(`Could not open local storage: ${e?.message ?? e}`, 'error'),
    )
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useUI.setState((s) => ({ paletteOpen: !s.paletteOpen }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!loaded) {
    return (
      <div className="boot">
        <img src={logo} alt="" />
        LuluSchemer
      </div>
    )
  }

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
