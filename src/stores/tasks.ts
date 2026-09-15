import { create } from 'zustand'
import { now, uid, type Task } from '../models'
import { repos } from '../services/storage'
import { persistOrWarn } from './ui'

type NewTask = Pick<Task, 'title'> & Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>>

interface TasksState {
  tasks: Task[]
  load: () => Promise<void>
  add: (t: NewTask) => Task
  update: (id: string, patch: Partial<Task>) => void
  remove: (id: string) => void
  removeForProject: (projectId: string) => void
}

// Task changes save immediately (no debounce).
export const useTasks = create<TasksState>((set, get) => ({
  tasks: [],
  load: async () => set({ tasks: await repos.tasks.list() }),
  add: (t) => {
    const task: Task = {
      id: uid(), projectId: null, objectId: null, completed: false, priority: 'normal', dueDate: null,
      createdAt: now(), updatedAt: now(), ...t,
    }
    set((s) => ({ tasks: [...s.tasks, task] }))
    persistOrWarn(repos.tasks.put(task), 'task')
    return task
  },
  update: (id, patch) => {
    const task = get().tasks.find((t) => t.id === id)
    if (!task) return
    const next = { ...task, ...patch, updatedAt: now() }
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? next : t)) }))
    persistOrWarn(repos.tasks.put(next), 'task')
  },
  remove: (id) => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
    persistOrWarn(repos.tasks.remove(id), 'task deletion')
  },
  removeForProject: (projectId) => {
    for (const t of get().tasks.filter((t) => t.projectId === projectId)) get().remove(t.id)
  },
}))
