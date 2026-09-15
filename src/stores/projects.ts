import { create } from 'zustand'
import { now, uid, type Project } from '../models'
import { files, repos } from '../services/storage'
import { PROJECT_COLORS } from '../theme'
import { useTasks } from './tasks'
import { persistOrWarn } from './ui'

interface ProjectsState {
  projects: Project[]
  loaded: boolean
  load: () => Promise<void>
  create: (name: string) => Project
  update: (id: string, patch: Partial<Project>) => void
  touch: (id: string) => void
  remove: (id: string) => Promise<void>
}

export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  loaded: false,
  load: async () => set({ projects: await repos.projects.list(), loaded: true }),
  create: (name) => {
    const p: Project = {
      id: uid(), name, description: '', archived: false,
      color: PROJECT_COLORS[get().projects.length % PROJECT_COLORS.length],
      createdAt: now(), updatedAt: now(),
    }
    set((s) => ({ projects: [...s.projects, p] }))
    persistOrWarn(repos.projects.put(p), 'project')
    return p
  },
  update: (id, patch) => {
    const p = get().projects.find((x) => x.id === id)
    if (!p) return
    const next = { ...p, ...patch, updatedAt: now() }
    set((s) => ({ projects: s.projects.map((x) => (x.id === id ? next : x)) }))
    persistOrWarn(repos.projects.put(next), 'project')
  },
  touch: (id) => get().update(id, {}),
  remove: async (id) => {
    set((s) => ({ projects: s.projects.filter((x) => x.id !== id) }))
    useTasks.getState().removeForProject(id)
    const canvas = await repos.canvases.get(id)
    for (const o of canvas?.objects ?? []) if (o.type === 'image') await files.remove(o.fileId)
    persistOrWarn(
      Promise.all([repos.projects.remove(id), repos.canvases.remove(id), repos.conversations.remove(id)]),
      'project deletion',
    )
  },
}))
