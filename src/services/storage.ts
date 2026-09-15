import { createStore, del, get, set, values } from 'idb-keyval'
import type { AIConversation, Canvas, Project, Task } from '../models'
import { uid } from '../models'

// The only persistence contract the app knows about. A SupabaseRepo<T> implementing this
// (select/upsert/delete on a table) can replace createLocalRepo without touching UI or stores.
export interface Repo<T extends { id: string }> {
  list(where?: Partial<T>): Promise<T[]>
  get(id: string): Promise<T | undefined>
  put(item: T): Promise<void>
  remove(id: string): Promise<void>
}

export function createLocalRepo<T extends { id: string }>(name: string): Repo<T> {
  const store = createStore(`luluschemer-${name}`, name)
  return {
    async list(where) {
      const all = await values<T>(store)
      if (!where) return all
      return all.filter((item) => Object.entries(where).every(([k, v]) => item[k as keyof T] === v))
    },
    get: (id) => get<T>(id, store),
    put: (item) => set(item.id, item, store),
    remove: (id) => del(id, store),
  }
}

// Screenshots / images. Swap for Supabase Storage (upload → path, getUrl → signed URL).
export interface FileStorage {
  upload(blob: Blob): Promise<string>
  getBlob(id: string): Promise<Blob | undefined>
  getUrl(id: string): Promise<string | undefined>
  remove(id: string): Promise<void>
}

function createLocalFileStorage(): FileStorage {
  const store = createStore('luluschemer-files', 'files')
  const urls = new Map<string, string>()
  return {
    async upload(blob) {
      const id = uid()
      await set(id, blob, store)
      return id
    },
    getBlob: (id) => get<Blob>(id, store),
    async getUrl(id) {
      if (!urls.has(id)) {
        const blob = await get<Blob>(id, store)
        if (!blob) return undefined
        urls.set(id, URL.createObjectURL(blob))
      }
      return urls.get(id)
    },
    async remove(id) {
      const url = urls.get(id)
      if (url) URL.revokeObjectURL(url)
      urls.delete(id)
      await del(id, store)
    },
  }
}

export const repos = {
  projects: createLocalRepo<Project>('projects'),
  tasks: createLocalRepo<Task>('tasks'),
  canvases: createLocalRepo<Canvas>('canvases'),
  conversations: createLocalRepo<AIConversation>('conversations'),
}

export const files = createLocalFileStorage()
