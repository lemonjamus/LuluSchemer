import type { LucideIcon } from 'lucide-react'
import { CheckSquare, FileText, FolderOpen, Home, Layers, ListTodo, Plus, Scissors, Settings, Sparkles, StickyNote, Type } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Canvas } from '../models'
import { startSnip } from '../services/screenshot'
import { repos } from '../services/storage'
import { useCanvas } from '../stores/canvas'
import { useProjects } from '../stores/projects'
import { useTasks } from '../stores/tasks'
import { useUI } from '../stores/ui'

interface Entry {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  run: () => void
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen)
  const route = useUI((s) => s.route)
  const projects = useProjects((s) => s.projects)
  const tasks = useTasks((s) => s.tasks)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [canvases, setCanvases] = useState<Canvas[]>([])
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current!
    if (open && !d.open) {
      d.showModal()
      setQuery('')
      setIndex(0)
      repos.canvases.list().then(setCanvases).catch(() => setCanvases([]))
    }
    if (!open && d.open) d.close()
  }, [open])

  const entries = useMemo<Entry[]>(() => {
    const ui = useUI.getState()
    const go = (projectId: string, focusObjectId: string | null = null) => ui.set({ route: { name: 'project', projectId }, focusObjectId })
    const inProject = route.name === 'project' ? route.projectId : null
    const q = query.trim().toLowerCase()
    const match = (s: string) => s.toLowerCase().includes(q)

    const commands: Entry[] = [
      { id: 'c-project', label: q ? `Create project "${query.trim()}"` : 'Create project', icon: Plus, run: () => { if (q) go(useProjects.getState().create(query.trim()).id); else ui.set({ route: { name: 'home' } }) } },
      { id: 'c-task', label: q ? `Create task "${query.trim()}"` : 'Create task…', hint: inProject ? 'in this project' : undefined, icon: ListTodo, run: () => { if (q) { useTasks.getState().add({ title: query.trim(), projectId: inProject }); ui.toast('Task added') } else if (inProject) ui.set({ panel: 'tasks' }) } },
      { id: 'c-ai', label: 'Open AI assistant', icon: Sparkles, run: () => ui.set({ aiOpen: true }) },
      { id: 'c-snip', label: 'Take screenshot', icon: Scissors, run: () => startSnip() },
      ...(inProject
        ? [
            { id: 'c-text', label: 'Add text', hint: 'T', icon: Type, run: () => useCanvas.getState().set({ tool: 'text' }) },
            { id: 'c-note', label: 'Add note', hint: 'N', icon: StickyNote, run: () => useCanvas.getState().set({ tool: 'note' }) },
            { id: 'c-layers', label: 'Show layers', icon: Layers, run: () => ui.set({ panel: 'layers' }) },
            { id: 'c-home', label: 'Go home', icon: Home, run: () => ui.set({ route: { name: 'home' } }) },
          ]
        : []),
      { id: 'c-settings', label: 'Open settings', icon: Settings, run: () => ui.set({ settingsOpen: true }) },
    ].filter((c) => !q || c.id === 'c-project' || c.id === 'c-task' || match(c.label))

    if (!q) return commands

    const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name
    const results: Entry[] = [
      ...projects.filter((p) => match(p.name) || match(p.description)).map((p) => ({
        id: `p-${p.id}`, label: p.name, hint: p.archived ? 'archived project' : 'project', icon: FolderOpen, run: () => go(p.id),
      })),
      ...tasks.filter((t) => match(t.title)).map((t) => ({
        id: `t-${t.id}`, label: t.title, hint: projectName(t.projectId) ?? 'task', icon: CheckSquare,
        run: () => (t.projectId ? go(t.projectId, t.objectId) : ui.set({ route: { name: 'home' } })),
      })),
      ...canvases.flatMap((c) =>
        c.objects.flatMap((o) =>
          (o.type === 'text' || o.type === 'note') && match(o.text)
            ? [{ id: `o-${o.id}`, label: o.text.split('\n')[0].slice(0, 80), hint: projectName(c.projectId), icon: FileText, run: () => go(c.projectId, o.id) }]
            : [],
        ),
      ),
    ]
    return [...results.slice(0, 30), ...commands]
  }, [query, route, projects, tasks, canvases])

  const close = () => useUI.getState().set({ paletteOpen: false })
  const runAt = (i: number) => {
    const e = entries[i]
    if (!e) return
    close()
    e.run()
  }

  return (
    <dialog ref={ref} className="palette" onClose={close} onClick={(e) => e.target === ref.current && close()} aria-label="Command palette">
      {open && (
        <>
          <input
            autoFocus
            className="palette-input"
            placeholder="Search or command…"
            value={query}
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={entries[index]?.id}
            onChange={(e) => { setQuery(e.target.value); setIndex(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, entries.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)) }
              if (e.key === 'Enter') runAt(index)
            }}
          />
          <ul id="palette-list" role="listbox" className="palette-list">
            {entries.map((e, i) => (
              <li
                key={e.id}
                id={e.id}
                role="option"
                aria-selected={i === index}
                className={i === index ? 'is-active' : ''}
                onMouseMove={() => setIndex(i)}
                onClick={() => runAt(i)}
              >
                <e.icon size={14} strokeWidth={1.75} />
                <span className="grow">{e.label}</span>
                {e.hint && <span className="muted small">{e.hint}</span>}
              </li>
            ))}
            {!entries.length && <li className="muted">No matches</li>}
          </ul>
        </>
      )}
    </dialog>
  )
}
