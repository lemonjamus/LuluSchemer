import { Crosshair, GripVertical, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { dueState } from '../lib'
import type { Priority, Task } from '../models'
import { TASK_DRAG_TYPE, TASK_SIZE, useCanvas } from '../stores/canvas'
import { useProjects } from '../stores/projects'
import { useTasks } from '../stores/tasks'
import { useUI } from '../stores/ui'
import { PRIORITY } from '../theme'
import { IconButton } from './ui'

const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent']
const RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
const DUE_RANK = { overdue: 0, today: 1, upcoming: 2, none: 3 }

function sortOpen(a: Task, b: Task) {
  return (
    DUE_RANK[dueState(a.dueDate) ?? 'none'] - DUE_RANK[dueState(b.dueDate) ?? 'none'] ||
    RANK[a.priority] - RANK[b.priority] ||
    (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9') ||
    a.createdAt.localeCompare(b.createdAt)
  )
}

/** projectId undefined = every task (dashboard); a string = that project's tasks. */
export function TaskList({ projectId, onFocusObject, canvasDrag }: { projectId?: string; onFocusObject?: (objectId: string) => void; canvasDrag?: boolean }) {
  const allTasks = useTasks((s) => s.tasks)
  const [draft, setDraft] = useState('')
  const [showDone, setShowDone] = useState(false)

  const tasks = useMemo(() => allTasks.filter((t) => projectId === undefined || t.projectId === projectId), [allTasks, projectId])
  const open = useMemo(() => tasks.filter((t) => !t.completed).sort(sortOpen), [tasks])
  const done = useMemo(() => tasks.filter((t) => t.completed).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [tasks])

  const submit = () => {
    if (!draft.trim()) return
    useTasks.getState().add({ title: draft.trim(), projectId: projectId ?? null })
    setDraft('')
  }

  return (
    <div className="tasklist">
      <input
        className="input tasklist-add"
        placeholder="+ add task, press Enter"
        aria-label="New task"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {!tasks.length && <p className="empty-line">Nothing on the list. Enjoy it while it lasts.</p>}
      <ul>
        {open.map((t) => <TaskRow key={t.id} task={t} showProject={projectId === undefined} onFocusObject={onFocusObject} canvasDrag={canvasDrag} />)}
      </ul>
      {done.length > 0 && (
        <>
          <button className="tasklist-done-toggle" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            {showDone ? '▾' : '▸'} done ({done.length})
          </button>
          {showDone && <ul>{done.map((t) => <TaskRow key={t.id} task={t} showProject={projectId === undefined} onFocusObject={onFocusObject} canvasDrag={canvasDrag} />)}</ul>}
        </>
      )}
    </div>
  )
}

function TaskRow({ task, showProject, onFocusObject, canvasDrag }: { task: Task; showProject: boolean; onFocusObject?: (id: string) => void; canvasDrag?: boolean }) {
  const project = useProjects((s) => (task.projectId ? s.projects.find((p) => p.id === task.projectId) : undefined))
  const { update, remove } = useTasks.getState()
  const [title, setTitle] = useState(task.title)
  const due = dueState(task.dueDate)

  const commitTitle = () => {
    if (title.trim() && title !== task.title) update(task.id, { title: title.trim() })
    else setTitle(task.title)
  }

  const del = () => {
    const c = useCanvas.getState()
    const linked = c.objects.filter((o) => o.type === 'task' && o.taskId === task.id).map((o) => o.id)
    if (linked.length) c.remove(linked)
    remove(task.id)
  }

  return (
    <li className={`task ${task.completed ? 'is-done' : ''}`}>
      {canvasDrag && (
        <button
          className="task-grip"
          draggable
          aria-label={`Place "${task.title}" on canvas`}
          title="Drag onto the canvas (or click to place in the centre)"
          onDragStart={(e) => {
            e.dataTransfer.setData(TASK_DRAG_TYPE, task.id)
            e.dataTransfer.effectAllowed = 'copy'
            e.dataTransfer.setDragImage(e.currentTarget.closest('li')!, 12, 17)
          }}
          onClick={() => {
            const c = useCanvas.getState()
            const p = c.center()
            c.addTaskCard(task.id, { x: p.x - TASK_SIZE.width / 2, y: p.y - TASK_SIZE.height / 2 })
          }}
        >
          <GripVertical size={13} />
        </button>
      )}
      <input
        type="checkbox"
        className="check"
        checked={task.completed}
        aria-label={`Complete ${task.title}`}
        onChange={(e) => update(task.id, { completed: e.target.checked })}
      />
      <input
        className="task-title"
        value={title}
        aria-label="Task title"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="task-meta">
        {due && due !== 'upcoming' && !task.completed && <span className={`badge is-${due}`}>{due}</span>}
        <button
          className={`prio is-${task.priority}`}
          style={{ color: PRIORITY[task.priority].color }}
          data-tip="Priority (click to cycle)"
          aria-label={`Priority ${task.priority}`}
          onClick={() => update(task.id, { priority: PRIORITIES[(PRIORITIES.indexOf(task.priority) + 1) % 4] })}
        >
          {task.priority === 'normal' ? '·' : PRIORITY[task.priority].label}
        </button>
        <input
          type="date"
          className={`date ${task.dueDate ? 'has-value' : ''}`}
          value={task.dueDate ?? ''}
          aria-label="Due date"
          onChange={(e) => update(task.id, { dueDate: e.target.value || null })}
        />
        {showProject && project && (
          <button
            className="chip"
            style={{ '--chip': project.color } as React.CSSProperties}
            onClick={() => useUI.getState().set({ route: { name: 'project', projectId: project.id } })}
          >
            ◈ {project.name}
          </button>
        )}
        {task.objectId && onFocusObject && (
          <IconButton icon={Crosshair} label="Show on canvas" size={13} onClick={() => onFocusObject(task.objectId!)} />
        )}
        <IconButton icon={Trash2} label="Delete task" size={13} className="task-del" onClick={del} />
      </div>
    </li>
  )
}
