import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowLeft, ArrowUpToLine, Bell, Bold, Brush, ClipboardPaste, Copy, Eraser,
  Hand, ImagePlus, Info, Italic, Layers, ListTodo, Magnet, Maximize, Minus, MousePointer2, Pencil, Plus, Redo2, Scissors, Search,
  Settings, Sparkles, SquareCheck, StickyNote, Trash2, Type, Undo2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import logo from '../assets/lulu-head.png'
import type { CanvasObject, NoteCategory, NoteObject, TaskObject, TextObject } from '../models'
import { actionPrompt, AI_ACTIONS, type AIAction } from '../services/aiContext'
import { startSnip } from '../services/screenshot'
import { files } from '../services/storage'
import { useAI } from '../stores/ai'
import { DEFAULT_CARD_FONT, noteHeight, taskHeight, useCanvas, type Tool } from '../stores/canvas'
import { useProjects } from '../stores/projects'
import { useTasks } from '../stores/tasks'
import { useSettings, useUI } from '../stores/ui'
import { BRUSH_COLORS, CATEGORY } from '../theme'
import { AIPanel } from './AIPanel'
import { CanvasStage, type CanvasMenuRequest } from './canvas/CanvasStage'
import { snapshotObjects } from './canvas/snapshot'
import { IconButton, Menu, type MenuItem } from './ui'
import { InfoPanel, LayersPanel, TasksPanel } from './WorkspacePanels'

const TOOLS: { id: Tool; label: string; key: string; icon: typeof Brush }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'hand', label: 'Pan', key: 'H / Space', icon: Hand },
  { id: 'brush', label: 'Brush', key: 'B', icon: Brush },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: Eraser },
  { id: 'text', label: 'Text', key: 'T', icon: Type },
  { id: 'note', label: 'Note', key: 'N', icon: StickyNote },
  { id: 'task', label: 'Task card', key: 'K', icon: SquareCheck },
]

export function Workspace({ projectId }: { projectId: string }) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId))
  const loaded = useCanvas((s) => s.projectId === projectId)
  const aiOpen = useUI((s) => s.aiOpen)
  const panel = useUI((s) => s.panel)
  const openTasks = useTasks((s) => s.tasks.filter((t) => t.projectId === projectId && !t.completed).length)
  const [menu, setMenu] = useState<CanvasMenuRequest | null>(null)
  const ui = useUI.getState()

  useEffect(() => {
    useCanvas.getState().load(projectId).catch((e) => ui.toast(`Could not load canvas: ${e?.message ?? e}`, 'error'))
    return () => useCanvas.getState().unload()
  }, [projectId, ui])

  useEffect(() => {
    if (!project) ui.set({ route: { name: 'home' } })
  }, [project, ui])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]') || (e.target as HTMLElement).closest('input, textarea')) return
      if (useUI.getState().panel) ui.set({ panel: null })
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [ui])

  if (!project) return null
  const togglePanel = (p: typeof panel) => ui.set({ panel: panel === p ? null : p })

  return (
    <div className="app-shell workspace">
      <header className="topbar">
        <div className="row">
          <button className="ws-back" onClick={() => ui.set({ route: { name: 'home' } })} aria-label="Back to dashboard">
            <ArrowLeft size={14} />
            <span className="brand">
              <img src={logo} alt="" className="brand-logo" />
              <span className="brand-name">LuluSchemer</span>
            </span>
          </button>
        </div>
        <button className="ws-title" onClick={() => togglePanel('info')} style={{ '--accent': project.color } as React.CSSProperties}>
          <span className="project-glyph" aria-hidden>◈</span> {project.name}
        </button>
        <div className="topbar-actions">
          <button className={`icon-btn with-count ${panel === 'tasks' ? 'is-active' : ''}`} data-tip="Project tasks" aria-label="Project tasks" aria-pressed={panel === 'tasks'} onClick={() => togglePanel('tasks')}>
            <ListTodo size={16} strokeWidth={1.75} />
            {openTasks > 0 && <span className="count">{openTasks}</span>}
          </button>
          <IconButton icon={Layers} label="Layers" active={panel === 'layers'} onClick={() => togglePanel('layers')} />
          <IconButton icon={Info} label="Project info" active={panel === 'info'} onClick={() => togglePanel('info')} />
          <IconButton icon={Search} label="Search / command" shortcut="Ctrl K" onClick={() => ui.set({ paletteOpen: true })} />
          <IconButton icon={Sparkles} label="AI assistant" active={aiOpen} onClick={() => ui.set({ aiOpen: !aiOpen })} />
          <IconButton icon={Settings} label="Settings" onClick={() => ui.set({ settingsOpen: true })} />
        </div>
      </header>

      <div className="shell-body">
        <div className="ws-canvas">
          {loaded && (
            <>
              <CanvasStage onMenu={setMenu} />
              <ToolDock />
              <BrushDock />
              <SelectionBar />
              <ZoomControl />
              <EmptyCanvas projectId={projectId} />
            </>
          )}
          {panel && (
            <aside className="side-panel" aria-label={panel}>
              {panel === 'tasks' && <TasksPanel projectId={projectId} />}
              {panel === 'layers' && <LayersPanel />}
              {panel === 'info' && <InfoPanel project={project} />}
            </aside>
          )}
        </div>
        {aiOpen && <AIPanel projectId={projectId} />}
      </div>

      {menu && <Menu x={menu.x} y={menu.y} items={buildMenu(menu, projectId)} onClose={() => setMenu(null)} />}
    </div>
  )
}

// --- AI + menu actions ----------------------------------------------------------------------

async function askAI(projectId: string, action: AIAction, text: string, image?: Blob | null) {
  const ai = useAI.getState()
  useUI.getState().set({ aiOpen: true })
  await ai.open(projectId)
  if (image) {
    const fileId = await files.upload(image)
    ai.attach({ fileId, name: 'canvas-selection.png', mediaType: 'image/png' })
  }
  const prompt = actionPrompt(action, text)
  if (action === 'ask') return useAI.setState({ draft: `${prompt}\n` })
  if (useAI.getState().streaming) return useUI.getState().toast('AI is still responding. Your prompt is in the composer.', 'info'), useAI.setState({ draft: prompt })
  ai.send(prompt)
}

function textOf(o: CanvasObject) {
  if (o.type === 'text' || o.type === 'note') return o.text
  if (o.type === 'task') return useTasks.getState().tasks.find((t) => t.id === o.taskId)?.title ?? ''
  return ''
}

function createTask(projectId: string, text: string, objectId: string | null, reminder = false) {
  const title = text.trim().split('\n')[0].slice(0, 140)
  if (!title) return
  useTasks.getState().add({
    title, projectId, objectId,
    ...(reminder ? { priority: 'high' as const, dueDate: new Date().toLocaleDateString('en-CA') } : {}),
  })
  useUI.getState().toast(reminder ? 'Reminder set for today' : 'Task created', 'info', { label: 'Show', run: () => useUI.getState().set({ panel: 'tasks' }) })
}

function buildMenu(req: CanvasMenuRequest, projectId: string): MenuItem[] {
  const s = useCanvas.getState()
  const sel = s.objects.filter((o) => req.ids.includes(o.id))
  const aiItems = (text: string, image?: () => Promise<Blob | null>): MenuItem[] =>
    AI_ACTIONS.map((a, i) => ({
      label: a.label, icon: i === 0 ? Sparkles : undefined, accent: true,
      onSelect: async () => askAI(projectId, a.id, text, image ? await image() : null),
    }))

  if (req.selectionText) {
    return [
      ...aiItems(req.selectionText),
      'sep',
      { label: 'Turn into task', icon: SquareCheck, onSelect: () => createTask(projectId, req.selectionText!, null) },
      { label: 'Copy', icon: Copy, onSelect: () => navigator.clipboard.writeText(req.selectionText!) },
    ]
  }

  if (!sel.length) {
    return [
      { label: 'Add text', icon: Type, shortcut: 'T', onSelect: () => s.startNew('text', req.world) },
      { label: 'Add note', icon: StickyNote, shortcut: 'N', onSelect: () => s.startNew('note', req.world) },
      { label: 'Add task', icon: SquareCheck, shortcut: 'K', onSelect: () => s.startNew('task', req.world) },
      { label: 'Paste', icon: ClipboardPaste, shortcut: 'Ctrl V', disabled: !s.clipboard.length, onSelect: () => s.paste(req.world) },
      'sep',
      { label: 'Take screenshot', icon: Scissors, onSelect: () => startSnip() },
      { label: 'Ask AI', icon: Sparkles, accent: true, onSelect: () => useUI.getState().set({ aiOpen: true }) },
      { label: 'Fit to content', icon: Maximize, onSelect: () => s.fit() },
    ]
  }

  const ids = sel.map((o) => o.id)
  const text = sel.map(textOf).filter(Boolean).join('\n\n')
  const visual = sel.some((o) => o.type === 'stroke' || o.type === 'image')
  const items: MenuItem[] = []
  if (sel.length === 1 && ['text', 'note', 'task'].includes(sel[0].type)) items.push({ label: 'Edit', icon: Pencil, shortcut: 'Enter', onSelect: () => s.startEdit(ids[0]) })
  items.push(
    { label: 'Copy', icon: Copy, shortcut: 'Ctrl C', onSelect: () => s.copy(ids) },
    { label: 'Cut', icon: Scissors, shortcut: 'Ctrl X', onSelect: () => { s.copy(ids); s.remove(ids) } },
    { label: 'Duplicate', icon: Copy, shortcut: 'Ctrl D', onSelect: () => s.duplicate(ids) },
    { label: 'Bring to front', icon: ArrowUpToLine, onSelect: () => s.commit({ objects: [...s.objects.filter((o) => !ids.includes(o.id)), ...sel] }) },
    { label: 'Send to back', icon: ArrowDownToLine, onSelect: () => s.commit({ objects: [...sel, ...s.objects.filter((o) => !ids.includes(o.id))] }) },
  )
  if (sel.some((o) => o.layerId !== s.activeLayerId)) {
    const layer = s.layers.find((l) => l.id === s.activeLayerId)
    items.push({ label: `Move to layer "${layer?.name}"`, icon: Layers, onSelect: () => s.updateMany(ids.map((id) => ({ id, patch: { layerId: s.activeLayerId } }))) })
  }
  items.push({ label: 'Delete', icon: Trash2, shortcut: 'Del', danger: true, onSelect: () => s.remove(ids) })

  if (text && !visual) {
    items.push('sep', ...aiItems(text), 'sep')
    if (!sel.every((o) => o.type === 'task')) {
      items.push(
        { label: 'Turn into task', icon: SquareCheck, onSelect: () => createTask(projectId, text, ids[0]) },
        { label: 'Create reminder (today)', icon: Bell, onSelect: () => createTask(projectId, text, ids[0], true) },
      )
    }
  } else if (visual) {
    const shot = () => snapshotObjects(ids)
    items.push(
      'sep',
      { label: 'Ask AI about drawing', icon: Sparkles, accent: true, onSelect: async () => askAI(projectId, 'ask', text, await shot()) },
      { label: 'Analyze', accent: true, onSelect: async () => askAI(projectId, 'describe', text, await shot()) },
      { label: 'Generate tasks from this', accent: true, onSelect: async () => askAI(projectId, 'tasks', text, await shot()) },
    )
  }

  if (sel.length === 1 && sel[0].type === 'note') {
    const note = sel[0]
    items.push('sep', ...(Object.keys(CATEGORY) as NoteCategory[]).map((c): MenuItem => ({
      label: `${CATEGORY[c].label.toLowerCase()}${note.category === c ? '  ✓' : ''}`, swatch: CATEGORY[c].color,
      onSelect: () => s.update(note.id, { category: c }),
    })))
  }
  return items
}

// --- floating chrome ----------------------------------------------------------------------------

function ToolDock() {
  const tool = useCanvas((s) => s.tool)
  const canUndo = useCanvas((s) => s.history.past.length > 0)
  const canRedo = useCanvas((s) => s.history.future.length > 0)
  const fileRef = useRef<HTMLInputElement>(null)
  const s = useCanvas.getState()
  return (
    <nav className="tool-dock" aria-label="Tools">
      {TOOLS.map((t) => (
        <IconButton key={t.id} icon={t.icon} label={t.label} shortcut={t.key} tipSide="right" active={tool === t.id} onClick={() => s.set({ tool: t.id })} />
      ))}
      <IconButton icon={ImagePlus} label="Insert image" tipSide="right" onClick={() => fileRef.current?.click()} />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files?.[0]) s.addImage(e.target.files[0]); e.target.value = '' }} />
      <IconButton icon={Scissors} label="Snip screen → AI" tipSide="right" onClick={() => startSnip()} />
      <div className="tool-sep" />
      <IconButton icon={Undo2} label="Undo" shortcut="Ctrl Z" tipSide="right" disabled={!canUndo} onClick={() => s.undo()} />
      <IconButton icon={Redo2} label="Redo" shortcut="Ctrl Shift Z" tipSide="right" disabled={!canRedo} onClick={() => s.redo()} />
    </nav>
  )
}

function BrushDock() {
  const tool = useCanvas((s) => s.tool)
  const brush = useCanvas((s) => s.brush)
  const eraserSize = useCanvas((s) => s.eraserSize)
  const set = useCanvas((s) => s.set)
  if (tool !== 'brush' && tool !== 'eraser') return null
  const erase = tool === 'eraser'
  const size = erase ? eraserSize : brush.size
  return (
    <div className="brush-dock" aria-label={erase ? 'Eraser settings' : 'Brush settings'}>
      <label className="slider">
        <span className="small muted">SIZE</span>
        <input type="range" min={1} max={erase ? 160 : 64} value={size} aria-label="Size"
          onChange={(e) => (erase ? set({ eraserSize: +e.target.value }) : set({ brush: { ...brush, size: +e.target.value } }))} />
        <span className="small">{size}</span>
      </label>
      {!erase && (
        <>
          <label className="slider">
            <span className="small muted">OPAC</span>
            <input type="range" min={5} max={100} value={Math.round(brush.opacity * 100)} aria-label="Opacity"
              onChange={(e) => set({ brush: { ...brush, opacity: +e.target.value / 100 } })} />
            <span className="small">{Math.round(brush.opacity * 100)}</span>
          </label>
          <div className="swatches" role="radiogroup" aria-label="Brush colour">
            {BRUSH_COLORS.map((c) => (
              <button key={c} role="radio" aria-checked={brush.color === c} aria-label={c} className={`swatch ${brush.color === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => set({ brush: { ...brush, color: c } })} />
            ))}
            <input type="color" className="swatch swatch-custom" value={brush.color} aria-label="Custom colour" onChange={(e) => set({ brush: { ...brush, color: e.target.value } })} />
          </div>
        </>
      )}
    </div>
  )
}

function SelectionBar() {
  const selected = useCanvas(useShallow((s) => (s.tool === 'select' && !s.editing ? s.objects.filter((o) => s.selectedIds.includes(o.id)) : [])))
  const s = useCanvas.getState()
  if (!selected.length) return null
  const one = selected.length === 1 ? selected[0] : undefined
  const patchAll = (patch: Partial<CanvasObject>) => s.updateMany(selected.map((o) => ({ id: o.id, patch })))
  const opacity = Math.round((selected[0].opacity ?? 1) * 100)
  const fontObjs = selected.filter((o): o is TextObject | NoteObject | TaskObject => o.type === 'text' || o.type === 'note' || o.type === 'task')
  const fontOf = (o: TextObject | NoteObject | TaskObject) => o.fontSize ?? DEFAULT_CARD_FONT
  const bumpFont = (d: number) =>
    s.updateMany(fontObjs.map((o) => {
      const fontSize = Math.min(200, Math.max(8, fontOf(o) + d))
      const patch: Partial<CanvasObject> =
        o.type === 'note' ? { fontSize, height: Math.max(o.height, noteHeight(o.text, o.width, fontSize)) }
          : o.type === 'task' ? { fontSize, height: taskHeight(fontSize) }
            : { fontSize }
      return { id: o.id, patch }
    }))

  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection properties">
      {fontObjs.length > 0 && (
        <>
          <IconButton icon={Minus} label="Smaller text" size={14} onClick={() => bumpFont(-2)} />
          <span className="small font-size" aria-label="Font size">{fontOf(fontObjs[0])}</span>
          <IconButton icon={Plus} label="Larger text" size={14} onClick={() => bumpFont(2)} />
          <div className="tool-sep is-v" />
        </>
      )}
      {one?.type === 'text' && (
        <>
          <IconButton icon={Bold} label="Bold" size={14} active={one.bold} onClick={() => s.update(one.id, { bold: !one.bold })} />
          <IconButton icon={Italic} label="Italic" size={14} active={one.italic} onClick={() => s.update(one.id, { italic: !one.italic })} />
          <IconButton icon={AlignLeft} label="Align left" size={14} active={one.align === 'left'} onClick={() => s.update(one.id, { align: 'left' })} />
          <IconButton icon={AlignCenter} label="Align centre" size={14} active={one.align === 'center'} onClick={() => s.update(one.id, { align: 'center' })} />
          <IconButton icon={AlignRight} label="Align right" size={14} active={one.align === 'right'} onClick={() => s.update(one.id, { align: 'right' })} />
          <div className="tool-sep is-v" />
          <div className="swatches is-row">
            {BRUSH_COLORS.map((c) => (
              <button key={c} aria-label={`Text colour ${c}`} className={`swatch ${one.color === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => s.update(one.id, { color: c })} />
            ))}
          </div>
          <div className="tool-sep is-v" />
        </>
      )}
      {one?.type === 'stroke' && !one.erase && (
        <>
          <div className="swatches is-row">
            {BRUSH_COLORS.map((c) => (
              <button key={c} aria-label={`Stroke colour ${c}`} className={`swatch ${one.color === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => s.update(one.id, { color: c })} />
            ))}
          </div>
          <div className="tool-sep is-v" />
        </>
      )}
      {one?.type === 'note' && (
        <>
          <select className="input input-sm" aria-label="Note category" value={one.category} onChange={(e) => s.update(one.id, { category: e.target.value as NoteCategory })}>
            {(Object.keys(CATEGORY) as NoteCategory[]).map((c) => <option key={c} value={c}>{CATEGORY[c].label.toLowerCase()}</option>)}
          </select>
          <div className="tool-sep is-v" />
        </>
      )}
      <label className="row small" data-tip="Opacity">
        <span className="muted">α</span>
        <input type="range" min={10} max={100} defaultValue={opacity} key={`${selected.map((o) => o.id).join()}-${opacity}`} aria-label="Opacity"
          onPointerUp={(e) => patchAll({ opacity: +(e.target as HTMLInputElement).value / 100 })}
          onKeyUp={(e) => patchAll({ opacity: +(e.target as HTMLInputElement).value / 100 })} />
      </label>
      <span className="small muted">{selected.length > 1 ? `${selected.length} selected` : ''}</span>
      <IconButton icon={Trash2} label="Delete" size={14} onClick={() => s.remove(selected.map((o) => o.id))} />
    </div>
  )
}

function ZoomControl() {
  const pct = useCanvas((s) => Math.round(s.viewport.scale * 100))
  const snapOn = useSettings((st) => st.snapToGrid)
  const s = useCanvas.getState()
  return (
    <div className="zoom" role="group" aria-label="Zoom">
      <IconButton icon={Minus} label="Zoom out" tipSide="top" size={14} onClick={() => s.zoomAt(1 / 1.25)} />
      <button className="zoom-pct" data-tip="Reset zoom  Ctrl 0" data-tip-side="top" onClick={() => s.resetZoom()}>{pct}%</button>
      <IconButton icon={Plus} label="Zoom in" tipSide="top" size={14} onClick={() => s.zoomAt(1.25)} />
      <IconButton icon={Maximize} label="Fit content" tipSide="top" size={14} onClick={() => s.fit()} />
      <div className="tool-sep is-v" />
      <IconButton icon={Magnet} label="Snap to grid" shortcut="G" tipSide="top" size={14} active={snapOn} onClick={() => useSettings.getState().set({ snapToGrid: !snapOn })} />
    </div>
  )
}

function EmptyCanvas({ projectId }: { projectId: string }) {
  const empty = useCanvas((s) => !s.objects.length && !s.editing)
  const tool = useCanvas((s) => s.tool)
  if (!empty || tool === 'brush' || tool === 'eraser') return null
  const s = useCanvas.getState()
  return (
    <div className="empty-canvas">
      <h3>START SCHEMING</h3>
      <p>Draw something. Write an idea. Create a task. Ask AI.</p>
      <div className="row">
        <button className="btn" onClick={() => s.startNew('text', s.center())}><Type size={13} /> TEXT</button>
        <button className="btn" onClick={() => { const c = s.center(); s.startNew('note', { x: c.x - 130, y: c.y - 48 }) }}><StickyNote size={13} /> NOTE</button>
        <button className="btn" onClick={() => s.set({ tool: 'brush' })}><Brush size={13} /> DRAW</button>
        <button className="btn btn-primary" onClick={() => { useUI.getState().set({ aiOpen: true }); useAI.getState().open(projectId) }}><Sparkles size={13} /> ASK AI</button>
      </div>
    </div>
  )
}
