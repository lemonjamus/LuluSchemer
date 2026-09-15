import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, Plus, Trash2, Unlock, X } from 'lucide-react'
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { relTime } from '../lib'
import type { Project } from '../models'
import { useCanvas } from '../stores/canvas'
import { useProjects } from '../stores/projects'
import { useTasks } from '../stores/tasks'
import { useUI } from '../stores/ui'
import { PROJECT_COLORS } from '../theme'
import { TaskList } from './TaskList'
import { IconButton } from './ui'

const close = () => useUI.getState().set({ panel: null })

export function TasksPanel({ projectId }: { projectId: string }) {
  return (
    <>
      <header className="panel-head">
        <span>PROJECT TASKS</span>
        <IconButton icon={X} label="Close" size={14} onClick={close} />
      </header>
      <div className="panel-body">
        <TaskList projectId={projectId} onFocusObject={(id) => useCanvas.getState().focus(id)} canvasDrag />
      </div>
      <p className="panel-foot small muted">Drag a task by its handle onto the canvas to place a card.</p>
    </>
  )
}

export function LayersPanel() {
  const layers = useCanvas((s) => s.layers)
  const activeLayerId = useCanvas((s) => s.activeLayerId)
  const objects = useCanvas((s) => s.objects)
  const [renaming, setRenaming] = useState<string | null>(null)
  const s = useCanvas.getState()

  return (
    <>
      <header className="panel-head">
        <span>LAYERS</span>
        <div className="row">
          <IconButton icon={Plus} label="New layer" size={14} onClick={() => s.addLayer()} />
          <IconButton icon={X} label="Close" size={14} onClick={close} />
        </div>
      </header>
      <ul className="panel-body layers" role="listbox" aria-label="Layers (top first)">
        {[...layers].reverse().map((l, i) => {
          const count = objects.filter((o) => o.layerId === l.id).length
          const active = l.id === activeLayerId
          return (
            <li key={l.id} role="option" aria-selected={active} className={`layer-row ${active ? 'is-active' : ''} ${l.visible ? '' : 'is-hidden'}`} onClick={() => s.set({ activeLayerId: l.id })}>
              <IconButton icon={l.visible ? Eye : EyeOff} label={l.visible ? 'Hide layer' : 'Show layer'} size={13} onClick={(e) => { e.stopPropagation(); s.updateLayer(l.id, { visible: !l.visible }) }} />
              {renaming === l.id ? (
                <input autoFocus className="input input-sm grow" defaultValue={l.name} aria-label="Layer name" onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => { if (e.target.value.trim()) s.updateLayer(l.id, { name: e.target.value.trim() }); setRenaming(null) }}
                  onKeyDown={(e) => (e.key === 'Enter' ? (e.target as HTMLInputElement).blur() : e.key === 'Escape' && setRenaming(null))} />
              ) : (
                <span className="grow layer-name" onDoubleClick={() => setRenaming(l.id)} title="Double-click to rename">
                  {l.name} <span className="muted small">{count}</span>
                </span>
              )}
              <IconButton icon={l.locked ? Lock : Unlock} label={l.locked ? 'Unlock layer' : 'Lock layer'} size={13} active={l.locked} onClick={(e) => { e.stopPropagation(); s.updateLayer(l.id, { locked: !l.locked }) }} />
              <IconButton icon={ChevronUp} label="Move up" size={13} disabled={i === 0} onClick={(e) => { e.stopPropagation(); s.moveLayer(l.id, 1) }} />
              <IconButton icon={ChevronDown} label="Move down" size={13} disabled={i === layers.length - 1} onClick={(e) => { e.stopPropagation(); s.moveLayer(l.id, -1) }} />
              <IconButton icon={Trash2} label="Delete layer" size={13} disabled={layers.length <= 1}
                onClick={(e) => { e.stopPropagation(); if (!count || confirm(`Delete "${l.name}" and its ${count} object(s)? Undo can restore it.`)) s.removeLayer(l.id) }} />
            </li>
          )
        })}
      </ul>
      <p className="panel-foot small muted">New strokes and objects go on the highlighted layer. The eraser only affects that layer.</p>
    </>
  )
}

export function InfoPanel({ project }: { project: Project }) {
  const tasks = useTasks(useShallow((s) => s.tasks.filter((t) => t.projectId === project.id)))
  const objects = useCanvas((s) => s.objects)
  const update = useProjects((s) => s.update)
  const remaining = tasks.filter((t) => !t.completed).length
  const notes = objects.filter((o) => o.type === 'note').length

  return (
    <>
      <header className="panel-head">
        <span>PROJECT</span>
        <IconButton icon={X} label="Close" size={14} onClick={close} />
      </header>
      <div className="panel-body info">
        <input className="input info-name" defaultValue={project.name} key={`n-${project.id}`} aria-label="Project name"
          onBlur={(e) => e.target.value.trim() && e.target.value !== project.name && update(project.id, { name: e.target.value.trim() })} />
        <textarea className="input" rows={4} placeholder="Description: what is this project about?" defaultValue={project.description} key={`d-${project.id}`} aria-label="Project description"
          onBlur={(e) => e.target.value !== project.description && update(project.id, { description: e.target.value })} />
        <div className="swatches is-row" role="radiogroup" aria-label="Project colour">
          {PROJECT_COLORS.map((c) => (
            <button key={c} role="radio" aria-checked={project.color === c} aria-label={c} className={`swatch ${project.color === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => update(project.id, { color: c })} />
          ))}
        </div>
        <dl className="stats">
          <div><dt>TASKS</dt><dd>{remaining} remaining · {tasks.length - remaining} done</dd></div>
          <div><dt>NOTES</dt><dd>{notes}</dd></div>
          <div><dt>CANVAS</dt><dd>{objects.length} objects · edited {relTime(project.updatedAt)}</dd></div>
          <div><dt>CREATED</dt><dd>{new Date(project.createdAt).toLocaleDateString()}</dd></div>
        </dl>
      </div>
    </>
  )
}
