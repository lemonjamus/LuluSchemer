import { create } from 'zustand'
import { debounce, record, redo, undo, type History } from '../lib'
import { now, uid, type Canvas, type CanvasObject, type Layer, type NoteCategory, type Viewport } from '../models'
import { files, repos } from '../services/storage'
import { useProjects } from './projects'
import { useTasks } from './tasks'
import { persistOrWarn, useSettings, useUI } from './ui'

export type Tool = 'select' | 'hand' | 'brush' | 'eraser' | 'text' | 'note' | 'task'

type Snapshot = { objects: CanvasObject[]; layers: Layer[] }
type AutoFields = 'id' | 'layerId' | 'createdAt' | 'updatedAt' | 'rotation' | 'opacity'
export type DraftObject = CanvasObject extends infer T
  ? T extends CanvasObject ? Omit<T, AutoFields> & Partial<Pick<T, AutoFields>> : never
  : never
type Point = { x: number; y: number }

export const GRID = 24 // matches the dot grid
export const NOTE_WIDTH = 264
export const TEXT_WIDTH = 312
export const TASK_SIZE = { width: 288, height: 40 }
export const DEFAULT_CARD_FONT = 14
export const TASK_DRAG_TYPE = 'application/x-luluschemer-task'
const MIN_SCALE = 0.1
const MAX_SCALE = 8

export const snap = (v: number) => (useSettings.getState().snapToGrid ? Math.round(v / GRID) * GRID : v)
export const snapPoint = (p: Point) => ({ x: snap(p.x), y: snap(p.y) })

/** Rough note height for monospace text wrapped at the note width. */
export function noteHeight(text: string, width = NOTE_WIDTH, fontSize = DEFAULT_CARD_FONT) {
  const cols = Math.max(4, Math.floor((width - 24) / (fontSize * 0.6)))
  const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cols)), 0)
  return Math.max(96, Math.ceil(44 + lines * fontSize * 1.3))
}

export const taskHeight = (fontSize = DEFAULT_CARD_FONT) => Math.max(TASK_SIZE.height, Math.round(fontSize * 1.3 + 22))

function activeLayerWritable() {
  const s = useCanvas.getState()
  const layer = s.layers.find((l) => l.id === s.activeLayerId)
  if (layer?.visible && !layer.locked) return true
  useUI.getState().toast(`Layer "${layer?.name}" is ${layer?.locked ? 'locked' : 'hidden'}.`)
  return false
}

interface CanvasState {
  projectId: string | null
  objects: CanvasObject[]
  layers: Layer[]
  activeLayerId: string
  viewport: Viewport
  stageSize: { width: number; height: number }
  tool: Tool
  brush: { color: string; size: number; opacity: number }
  eraserSize: number
  selectedIds: string[]
  /** Inline text editing session. isNew objects are not in `objects` until committed. */
  editing: { obj: CanvasObject; isNew: boolean } | null
  history: History<Snapshot>
  clipboard: CanvasObject[]

  set: (patch: Partial<Pick<CanvasState, 'tool' | 'brush' | 'eraserSize' | 'selectedIds' | 'activeLayerId' | 'viewport' | 'stageSize'>>) => void
  load: (projectId: string) => Promise<boolean>
  unload: () => void
  commit: (next: Partial<Snapshot>) => void
  add: (draft: DraftObject) => CanvasObject
  update: (id: string, patch: Partial<CanvasObject>) => void
  updateMany: (patches: { id: string; patch: Partial<CanvasObject> }[]) => void
  remove: (ids: string[]) => void
  duplicate: (ids: string[]) => void
  copy: (ids: string[]) => void
  paste: (at?: Point) => void
  undo: () => void
  redo: () => void

  addNote: (text: string, category?: NoteCategory, at?: Point) => CanvasObject
  addText: (text: string, at?: Point) => CanvasObject
  addImage: (blob: Blob, at?: Point) => Promise<void>
  /** Place a card for an existing task (dragged from the task list). */
  addTaskCard: (taskId: string, at: Point) => void
  startNew: (type: 'text' | 'note' | 'task', at: Point) => void
  startEdit: (id: string) => void
  commitEdit: (text: string) => void

  addLayer: () => void
  updateLayer: (id: string, patch: Partial<Layer>) => void
  moveLayer: (id: string, dir: -1 | 1) => void
  removeLayer: (id: string) => void

  /** World coordinates of the visible centre. */
  center: () => Point
  zoomAt: (factor: number, screen?: Point) => void
  resetZoom: () => void
  fit: () => void
  focus: (id: string) => void
}

const defaultLayers = (): Layer[] => [
  { id: uid(), name: 'Sketch', visible: true, locked: false },
  { id: uid(), name: 'Notes', visible: true, locked: false },
]

const save = debounce((c: Canvas) => persistOrWarn(repos.canvases.put(c), 'canvas'), 600)

export const useCanvas = create<CanvasState>((set, get) => ({
  projectId: null,
  objects: [],
  layers: [],
  activeLayerId: '',
  viewport: { x: 0, y: 0, scale: 1 },
  stageSize: { width: 1, height: 1 },
  tool: 'select',
  brush: { color: '#FFFFFF', size: 4, opacity: 1 },
  eraserSize: 24,
  selectedIds: [],
  editing: null,
  history: { past: [], future: [] },
  clipboard: [],

  set: (patch) => set(patch),

  load: async (projectId) => {
    const c = await repos.canvases.get(projectId)
    const layers = c?.layers?.length ? c.layers : defaultLayers()
    set({
      projectId,
      objects: c?.objects ?? [],
      layers,
      activeLayerId: layers[layers.length - 1].id,
      viewport: c?.viewport ?? { x: 0, y: 0, scale: 1 },
      selectedIds: [], editing: null, tool: 'select',
      history: { past: [], future: [] },
    })
    return true
  },

  unload: () => {
    save.flush()
    set({ projectId: null, objects: [], layers: [], selectedIds: [], editing: null, history: { past: [], future: [] } })
  },

  commit: (next) => {
    const s = get()
    set({ history: record(s.history, { objects: s.objects, layers: s.layers }), ...next })
  },

  add: (draft) => {
    const s = get()
    const obj = { id: uid(), layerId: s.activeLayerId, rotation: 0, opacity: 1, createdAt: now(), updatedAt: now(), ...draft } as CanvasObject
    s.commit({ objects: [...s.objects, obj] })
    return obj
  },

  update: (id, patch) => get().updateMany([{ id, patch }]),

  updateMany: (patches) => {
    if (!patches.length) return
    const byId = new Map(patches.map((p) => [p.id, p.patch]))
    const s = get()
    s.commit({ objects: s.objects.map((o) => (byId.has(o.id) ? ({ ...o, ...byId.get(o.id), updatedAt: now() } as CanvasObject) : o)) })
  },

  remove: (ids) => {
    const s = get()
    if (!ids.length) return
    s.commit({ objects: s.objects.filter((o) => !ids.includes(o.id)) })
    set({ selectedIds: s.selectedIds.filter((id) => !ids.includes(id)) })
  },

  duplicate: (ids) => {
    get().copy(ids)
    get().paste()
  },

  copy: (ids) => set({ clipboard: get().objects.filter((o) => ids.includes(o.id)) }),

  paste: (at) => {
    const s = get()
    if (!s.clipboard.length) return
    const ox = at ? snap(at.x) - s.clipboard[0].x : GRID
    const oy = at ? snap(at.y) - s.clipboard[0].y : GRID
    const layerIds = new Set(s.layers.map((l) => l.id))
    const tasks = useTasks.getState()
    const copies = s.clipboard.map((o) => {
      const copy = {
        ...o, id: uid(), x: o.x + ox, y: o.y + oy, createdAt: now(), updatedAt: now(),
        layerId: layerIds.has(o.layerId) ? o.layerId : s.activeLayerId,
      } as CanvasObject
      // A copied task card gets its own task, so renaming the copy leaves the original alone.
      // A cut card (no other card shows that task any more) keeps its task.
      if (copy.type === 'task' && s.objects.some((x) => x.type === 'task' && x.taskId === copy.taskId)) {
        const src = tasks.tasks.find((t) => t.id === copy.taskId)
        if (src) {
          const { title, projectId, priority, dueDate, completed } = src
          copy.taskId = tasks.add({ title, projectId, priority, dueDate, completed, objectId: copy.id }).id
        }
      }
      return copy
    })
    s.commit({ objects: [...s.objects, ...copies] })
    // Next paste lands offset again rather than on top.
    set({ selectedIds: copies.map((o) => o.id), clipboard: copies })
  },

  undo: () => {
    const s = get()
    const r = undo(s.history, { objects: s.objects, layers: s.layers })
    if (r) set({ history: r[0], ...r[1], selectedIds: [], editing: null })
  },

  redo: () => {
    const s = get()
    const r = redo(s.history, { objects: s.objects, layers: s.layers })
    if (r) set({ history: r[0], ...r[1], selectedIds: [], editing: null })
  },

  addNote: (text, category = 'idea', at) => {
    const c = at ?? get().center()
    const height = noteHeight(text)
    const obj = get().add({
      type: 'note', text, category, fontSize: DEFAULT_CARD_FONT,
      x: snap(c.x - NOTE_WIDTH / 2), y: snap(c.y - height / 2), width: NOTE_WIDTH, height,
    })
    set({ selectedIds: [obj.id], tool: 'select' })
    return obj
  },

  addText: (text, at) => {
    const c = at ?? get().center()
    const obj = get().add({
      type: 'text', text, color: '#FFFFFF', fontSize: 20, bold: false, italic: false, align: 'left',
      x: snap(c.x - TEXT_WIDTH / 2), y: snap(c.y), width: TEXT_WIDTH, height: 28,
    })
    set({ selectedIds: [obj.id], tool: 'select' })
    return obj
  },

  addTaskCard: (taskId, at) => {
    const task = useTasks.getState().tasks.find((t) => t.id === taskId)
    if (!task || !activeLayerWritable()) return
    const p = snapPoint(at)
    const obj = get().add({ type: 'task', taskId, x: p.x, y: p.y, ...TASK_SIZE, fontSize: DEFAULT_CARD_FONT })
    if (!get().objects.some((o) => o.id === task.objectId)) useTasks.getState().update(taskId, { objectId: obj.id })
    set({ selectedIds: [obj.id], tool: 'select' })
  },

  addImage: async (blob, at) => {
    try {
      const bmp = await createImageBitmap(blob)
      const fit = Math.min(1, 480 / Math.max(bmp.width, bmp.height))
      const width = bmp.width * fit, height = bmp.height * fit
      bmp.close()
      const fileId = await files.upload(blob)
      const c = at ?? get().center()
      const obj = get().add({ type: 'image', fileId, x: c.x - width / 2, y: c.y - height / 2, width, height })
      set({ selectedIds: [obj.id], tool: 'select' })
    } catch (e) {
      useUI.getState().toast(`Could not add image: ${(e as Error).message}`, 'error')
    }
  },

  startNew: (type, at) => {
    const s = get()
    if (!activeLayerWritable()) return
    const base = { id: uid(), layerId: s.activeLayerId, rotation: 0, opacity: 1, createdAt: now(), updatedAt: now(), ...snapPoint(at) }
    const obj: CanvasObject =
      type === 'text'
        ? { ...base, type, text: '', color: '#FFFFFF', fontSize: 20, bold: false, italic: false, align: 'left', width: TEXT_WIDTH, height: 28 }
        : type === 'note'
          ? { ...base, type, text: '', category: 'idea', fontSize: DEFAULT_CARD_FONT, width: NOTE_WIDTH, height: 96 }
          : { ...base, type, taskId: '', fontSize: DEFAULT_CARD_FONT, ...TASK_SIZE }
    set({ editing: { obj, isNew: true }, selectedIds: [] })
  },

  startEdit: (id) => {
    const obj = get().objects.find((o) => o.id === id)
    if (obj && (obj.type === 'text' || obj.type === 'note' || obj.type === 'task')) set({ editing: { obj, isNew: false }, selectedIds: [id], tool: 'select' })
  },

  commitEdit: (text) => {
    const s = get()
    const e = s.editing
    if (!e) return
    set({ editing: null })
    const { obj, isNew } = e
    const value = obj.type === 'task' ? text.trim() : text.replace(/\s+$/, '')

    if (obj.type === 'task') {
      if (isNew && value) {
        const task = useTasks.getState().add({ title: value, projectId: s.projectId, objectId: obj.id })
        s.add({ ...obj, taskId: task.id })
        set({ selectedIds: [obj.id], tool: 'select' })
      } else if (!isNew && value) {
        useTasks.getState().update(obj.taskId, { title: value })
      }
      return
    }
    if (obj.type !== 'text' && obj.type !== 'note') return
    const height = obj.type === 'note' ? Math.max(isNew ? 0 : obj.height, noteHeight(value, obj.width, obj.fontSize)) : obj.height
    if (isNew) {
      if (value.trim()) {
        s.add({ ...obj, text: value, height })
        set({ selectedIds: [obj.id], tool: 'select' })
      }
    } else if (!value.trim() && obj.type === 'text') {
      s.remove([obj.id])
    } else if (value !== obj.text) {
      s.update(obj.id, { text: value, height })
    }
  },

  addLayer: () => {
    const s = get()
    const layer = { id: uid(), name: `Layer ${s.layers.length + 1}`, visible: true, locked: false }
    s.commit({ layers: [...s.layers, layer] })
    set({ activeLayerId: layer.id })
  },

  updateLayer: (id, patch) => {
    const s = get()
    s.commit({ layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  },

  moveLayer: (id, dir) => {
    const s = get()
    const i = s.layers.findIndex((l) => l.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= s.layers.length) return
    const layers = [...s.layers]
    ;[layers[i], layers[j]] = [layers[j], layers[i]]
    s.commit({ layers })
  },

  removeLayer: (id) => {
    const s = get()
    if (s.layers.length <= 1) return
    const layers = s.layers.filter((l) => l.id !== id)
    s.commit({ layers, objects: s.objects.filter((o) => o.layerId !== id) })
    if (s.activeLayerId === id) set({ activeLayerId: layers[layers.length - 1].id })
  },

  center: () => {
    const { viewport: v, stageSize } = get()
    return { x: (stageSize.width / 2 - v.x) / v.scale, y: (stageSize.height / 2 - v.y) / v.scale }
  },

  zoomAt: (factor, screen) => {
    const { viewport: v, stageSize } = get()
    const p = screen ?? { x: stageSize.width / 2, y: stageSize.height / 2 }
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
    const wx = (p.x - v.x) / v.scale
    const wy = (p.y - v.y) / v.scale
    set({ viewport: { scale, x: p.x - wx * scale, y: p.y - wy * scale } })
  },

  resetZoom: () => get().zoomAt(1 / get().viewport.scale),

  fit: () => {
    const { objects, stageSize } = get()
    if (!objects.length) return set({ viewport: { x: stageSize.width / 2, y: stageSize.height / 2, scale: 1 } })
    const minX = Math.min(...objects.map((o) => o.x))
    const minY = Math.min(...objects.map((o) => o.y))
    const maxX = Math.max(...objects.map((o) => o.x + o.width))
    const maxY = Math.max(...objects.map((o) => o.y + o.height))
    const pad = 80
    const scale = Math.min(2, Math.max(MIN_SCALE, Math.min(stageSize.width / (maxX - minX + pad * 2), stageSize.height / (maxY - minY + pad * 2))))
    set({ viewport: { scale, x: stageSize.width / 2 - ((minX + maxX) / 2) * scale, y: stageSize.height / 2 - ((minY + maxY) / 2) * scale } })
  },

  focus: (id) => {
    const { objects, stageSize, viewport } = get()
    const o = objects.find((x) => x.id === id)
    if (!o) return
    const scale = Math.max(viewport.scale, 0.8)
    set({
      selectedIds: [id], tool: 'select',
      viewport: { scale, x: stageSize.width / 2 - (o.x + o.width / 2) * scale, y: stageSize.height / 2 - (o.y + o.height / 2) * scale },
    })
  },
}))

// Autosave: debounced for canvas edits and viewport moves.
useCanvas.subscribe((s, prev) => {
  if (!s.projectId || s.projectId !== prev.projectId) return // load / unload, not an edit
  const contentChanged = s.objects !== prev.objects || s.layers !== prev.layers
  if (!contentChanged && s.viewport === prev.viewport) return
  save({ id: s.projectId, projectId: s.projectId, objects: s.objects, layers: s.layers, viewport: s.viewport, updatedAt: now() })
  if (contentChanged) touchProject(s.projectId)
})

const touchProject = debounce((id: string) => useProjects.getState().touch(id), 2000)
