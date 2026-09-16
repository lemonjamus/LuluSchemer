import type { SupabaseClient } from '@supabase/supabase-js'
import { createStore, del, get, set, values } from 'idb-keyval'
import type { AIConversation, Canvas, Project, Task } from '../models'
import { uid } from '../models'
import { supabase } from './supabase'

// The only persistence contract the app knows about. Two implementations below:
// IndexedDB (local-only) and Supabase (signed-in, synced across devices).
export interface Repo<T extends { id: string }> {
  list(where?: Partial<T>): Promise<T[]>
  get(id: string): Promise<T | undefined>
  put(item: T): Promise<void>
  remove(id: string): Promise<void>
}

// Screenshots / canvas images.
export interface FileStorage {
  /** `id` is only passed when copying an existing file (import); normally a new id is generated. */
  upload(blob: Blob, id?: string): Promise<string>
  getBlob(id: string): Promise<Blob | undefined>
  getUrl(id: string): Promise<string | undefined>
  remove(id: string): Promise<void>
}

// --- IndexedDB ------------------------------------------------------------------------------------

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

/** Object URLs are cached per file so images don't re-download or leak URLs. */
function withUrlCache(getBlob: (id: string) => Promise<Blob | undefined>) {
  const urls = new Map<string, string>()
  return {
    async getUrl(id: string) {
      if (!urls.has(id)) {
        const blob = await getBlob(id)
        if (!blob) return undefined
        urls.set(id, URL.createObjectURL(blob))
      }
      return urls.get(id)
    },
    forget(id: string) {
      const url = urls.get(id)
      if (url) URL.revokeObjectURL(url)
      urls.delete(id)
    },
  }
}

function createLocalFileStorage(): FileStorage {
  const store = createStore('luluschemer-files', 'files')
  const getBlob = (id: string) => get<Blob>(id, store)
  const cache = withUrlCache(getBlob)
  return {
    async upload(blob, id = uid()) {
      await set(id, blob, store)
      return id
    },
    getBlob,
    getUrl: cache.getUrl,
    async remove(id) {
      cache.forget(id)
      await del(id, store)
    },
  }
}

// --- Supabase -------------------------------------------------------------------------------------

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

async function currentUserId(sb: SupabaseClient) {
  const id = (await sb.auth.getSession()).data.session?.user.id
  if (!id) throw new Error('Not signed in')
  return id
}

function fromRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'user_id') continue
    // Postgres returns "+00:00" timestamps; normalise to the "Z" form the app sorts on.
    out[toCamel(k)] = k.endsWith('_at') && typeof v === 'string' ? new Date(v).toISOString() : v
  }
  return out as T
}

function createSupabaseRepo<T extends { id: string }>(sb: SupabaseClient, table: string): Repo<T> {
  const fail = (error: { message: string } | null) => {
    if (error) throw new Error(error.message)
  }
  return {
    async list(where) {
      let query = sb.from(table).select('*')
      for (const [k, v] of Object.entries(where ?? {})) query = query.eq(toSnake(k), v as string)
      const { data, error } = await query
      fail(error)
      return (data ?? []).map((row) => fromRow<T>(row))
    },
    async get(id) {
      const { data, error } = await sb.from(table).select('*').eq('id', id).maybeSingle()
      fail(error)
      return data ? fromRow<T>(data) : undefined
    },
    async put(item) {
      const row: Record<string, unknown> = { user_id: await currentUserId(sb) }
      for (const [k, v] of Object.entries(item)) row[toSnake(k)] = v
      const { error } = await sb.from(table).upsert(row, { onConflict: 'user_id,id' })
      fail(error)
    },
    async remove(id) {
      const { error } = await sb.from(table).delete().eq('id', id)
      fail(error)
    },
  }
}

function createSupabaseFileStorage(sb: SupabaseClient): FileStorage {
  const bucket = () => sb.storage.from('files')
  const path = async (id: string) => `${await currentUserId(sb)}/${id}`
  const getBlob = async (id: string) => {
    const { data, error } = await bucket().download(await path(id))
    return error ? undefined : data
  }
  const cache = withUrlCache(getBlob)
  return {
    async upload(blob, id = uid()) {
      const { error } = await bucket().upload(await path(id), blob, { contentType: blob.type || 'image/png', upsert: true })
      if (error) throw new Error(error.message)
      return id
    },
    getBlob,
    getUrl: cache.getUrl,
    async remove(id) {
      cache.forget(id)
      await bucket().remove([await path(id)])
    },
  }
}

// --- selection ------------------------------------------------------------------------------------

type Repos = {
  projects: Repo<Project>
  tasks: Repo<Task>
  canvases: Repo<Canvas>
  conversations: Repo<AIConversation>
}

const localRepos: Repos = {
  projects: createLocalRepo<Project>('projects'),
  tasks: createLocalRepo<Task>('tasks'),
  canvases: createLocalRepo<Canvas>('canvases'),
  conversations: createLocalRepo<AIConversation>('conversations'),
}
const localFiles = createLocalFileStorage()

/** True when data lives in Supabase (requires sign-in). */
export const cloud = !!supabase

export const repos: Repos = supabase
  ? {
      projects: createSupabaseRepo<Project>(supabase, 'projects'),
      tasks: createSupabaseRepo<Task>(supabase, 'tasks'),
      canvases: createSupabaseRepo<Canvas>(supabase, 'canvases'),
      conversations: createSupabaseRepo<AIConversation>(supabase, 'conversations'),
    }
  : localRepos

export const files: FileStorage = supabase ? createSupabaseFileStorage(supabase) : localFiles

export async function localDataCounts() {
  const [projects, tasks] = await Promise.all([localRepos.projects.list(), localRepos.tasks.list()])
  return { projects: projects.length, tasks: tasks.length }
}

/**
 * Copy everything this browser stored locally (before sign-in existed) into the signed-in account.
 * Ids are kept, so running it twice overwrites rather than duplicates. Local data is left untouched.
 */
export async function importLocalData(onProgress: (message: string) => void) {
  if (!cloud) throw new Error('Supabase is not configured')
  const [projects, tasks, canvases, conversations] = await Promise.all([
    localRepos.projects.list(), localRepos.tasks.list(), localRepos.canvases.list(), localRepos.conversations.list(),
  ])
  const fileIds = new Set([
    ...canvases.flatMap((c) => c.objects.flatMap((o) => (o.type === 'image' ? [o.fileId] : []))),
    ...conversations.flatMap((c) => c.messages.flatMap((m) => m.attachments.map((a) => a.fileId))),
  ])
  let done = 0
  for (const id of fileIds) {
    const blob = await localFiles.getBlob(id)
    if (blob) await files.upload(blob, id)
    onProgress(`Uploading images ${++done}/${fileIds.size}`)
  }
  onProgress('Uploading projects, tasks and canvases…')
  await Promise.all(projects.map((p) => repos.projects.put(p)))
  await Promise.all([
    ...tasks.map((t) => repos.tasks.put(t)),
    ...canvases.map((c) => repos.canvases.put(c)),
    ...conversations.map((c) => repos.conversations.put(c)),
  ])
  return { projects: projects.length, tasks: tasks.length, canvases: canvases.length, images: fileIds.size }
}
