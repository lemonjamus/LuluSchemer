import { Archive, ArchiveRestore, FolderOpen, MoreHorizontal, Pencil, Plus, Search, Settings, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import logo from '../assets/lulu-head.png'
import { relTime } from '../lib'
import type { Project } from '../models'
import { cloud } from '../services/storage'
import { useProjects } from '../stores/projects'
import { useTasks } from '../stores/tasks'
import { useUI } from '../stores/ui'
import { PROJECT_COLORS } from '../theme'
import { AIPanel } from './AIPanel'
import { TaskList } from './TaskList'
import { IconButton, Menu, type MenuItem } from './ui'

type Sort = 'updated' | 'name' | 'created'
const COLOR_NAMES = ['Purple', 'Electric', 'Cyan', 'Green', 'Yellow', 'Pink', 'Orange']

export function Dashboard() {
  const aiOpen = useUI((s) => s.aiOpen)
  const ui = useUI.getState()
  const today = new Date().toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div className="app-shell dotgrid">
      <header className="topbar">
        <span className="brand">
          <img src={logo} alt="" className="brand-logo" />
          <span className="brand-name">LuluSchemer</span>
          {!cloud && (
            <span className="chip local-chip" data-tip="No account: this build has no Supabase keys, so everything stays in this browser." data-tip-side="bottom">
              LOCAL
            </span>
          )}
        </span>
        <div className="topbar-actions">
          <button className="search-trigger" onClick={() => ui.set({ paletteOpen: true })} aria-label="Search or command">
            <Search size={14} /> <span>Search or command…</span> <kbd>Ctrl K</kbd>
          </button>
          <IconButton icon={Sparkles} label="AI assistant" active={aiOpen} onClick={() => ui.set({ aiOpen: !aiOpen })} />
          <IconButton icon={Settings} label="Settings" onClick={() => ui.set({ settingsOpen: true })} />
        </div>
      </header>
      <div className="shell-body">
        <main className="dashboard">
          <section className="dash-col">
            <h2 className="section-label">
              TODO <span className="muted">{today}</span>
            </h2>
            <TaskList />
          </section>
          <section className="dash-col">
            <ProjectBrowser />
          </section>
        </main>
        {aiOpen && <AIPanel projectId={null} />}
      </div>
    </div>
  )
}

function ProjectBrowser() {
  const projects = useProjects((s) => s.projects)
  const tasks = useTasks((s) => s.tasks)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('updated')
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)

  const openCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tasks) if (t.projectId && !t.completed) m.set(t.projectId, (m.get(t.projectId) ?? 0) + 1)
    return m
  }, [tasks])

  const visible = useMemo(() => {
    const q = query.toLowerCase()
    return projects
      .filter((p) => p.archived === showArchived && (p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)))
      .sort((a, b) =>
        sort === 'name' ? a.name.localeCompare(b.name) : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt),
      )
  }, [projects, query, sort, showArchived])

  const archivedCount = projects.filter((p) => p.archived).length

  return (
    <>
      <h2 className="section-label">
        PROJECTS
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          <Plus size={13} /> NEW PROJECT
        </button>
      </h2>
      {projects.length > 0 && (
        <div className="browser-tools">
          <input className="input" placeholder="filter…" aria-label="Filter projects" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="input" aria-label="Sort projects" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="updated">recent</option>
            <option value="name">name</option>
            <option value="created">created</option>
          </select>
          {archivedCount > 0 && (
            <button className={`btn btn-ghost btn-sm ${showArchived ? 'is-active' : ''}`} onClick={() => setShowArchived(!showArchived)}>
              archived ({archivedCount})
            </button>
          )}
        </div>
      )}
      {creating && <NewProjectRow onDone={() => setCreating(false)} />}
      {projects.length === 0 && !creating && (
        <div className="empty-state">
          <h3>NO PROJECTS YET</h3>
          <p>Create your first project and start scheming.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> CREATE PROJECT
          </button>
        </div>
      )}
      <ul className="projects">
        {visible.map((p) => <ProjectRow key={p.id} project={p} openTasks={openCounts.get(p.id) ?? 0} />)}
      </ul>
    </>
  )
}

function NewProjectRow({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const submit = () => {
    if (name.trim()) {
      const p = useProjects.getState().create(name.trim())
      useUI.getState().set({ route: { name: 'project', projectId: p.id } })
    }
    onDone()
  }
  return (
    <input
      autoFocus
      className="input new-project"
      placeholder="Project name, Enter to create"
      aria-label="New project name"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => (e.key === 'Enter' ? submit() : e.key === 'Escape' && onDone())}
      onBlur={() => !name.trim() && onDone()}
    />
  )
}

function ProjectRow({ project: p, openTasks }: { project: Project; openTasks: number }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const store = useProjects.getState()
  const open = () => useUI.getState().set({ route: { name: 'project', projectId: p.id } })

  const items: MenuItem[] = [
    { label: 'Open', icon: FolderOpen, onSelect: open },
    { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(true) },
    'sep',
    ...PROJECT_COLORS.map((c, i): MenuItem => ({
      label: `${COLOR_NAMES[i]}${c === p.color ? '  ✓' : ''}`, swatch: c, onSelect: () => store.update(p.id, { color: c }),
    })),
    'sep',
    p.archived
      ? { label: 'Unarchive', icon: ArchiveRestore, onSelect: () => store.update(p.id, { archived: false }) }
      : { label: 'Archive', icon: Archive, onSelect: () => store.update(p.id, { archived: true }) },
    {
      label: 'Delete…', icon: Trash2, danger: true,
      onSelect: () => confirm(`Delete "${p.name}" with its canvas, tasks and AI chat? This cannot be undone.`) && store.remove(p.id),
    },
  ]

  return (
    <li
      className="project"
      style={{ '--accent': p.color } as React.CSSProperties}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
    >
      {renaming ? (
        <input
          autoFocus
          className="input"
          defaultValue={p.name}
          aria-label="Project name"
          onBlur={(e) => { if (e.target.value.trim()) store.update(p.id, { name: e.target.value.trim() }); setRenaming(false) }}
          onKeyDown={(e) => (e.key === 'Enter' ? (e.target as HTMLInputElement).blur() : e.key === 'Escape' && setRenaming(false))}
        />
      ) : (
        <button className="project-open" onClick={open}>
          <span className="project-glyph" aria-hidden>◈</span>
          <span className="project-name">{p.name}</span>
          <span className="project-meta">
            {openTasks} task{openTasks === 1 ? '' : 's'} · updated {relTime(p.updatedAt)}
          </span>
        </button>
      )}
      <IconButton icon={MoreHorizontal} label="Project actions" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })} />
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </li>
  )
}
