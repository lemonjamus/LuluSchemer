// Plain serialisable records: ids + ISO timestamps, so they map 1:1 onto Postgres rows later.

export interface Project {
  id: string
  name: string
  description: string
  color: string
  archived: boolean
  createdAt: string
  updatedAt: string
}

export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export interface Task {
  id: string
  projectId: string | null
  objectId: string | null // canvas object this task is linked to
  title: string
  completed: boolean
  priority: Priority
  dueDate: string | null // yyyy-mm-dd
  createdAt: string
  updatedAt: string
}

export type NoteCategory = 'idea' | 'reminder' | 'research' | 'question' | 'reference' | 'warning' | 'task'

export interface Layer {
  id: string
  name: string
  visible: boolean
  locked: boolean
}

interface BaseObject {
  id: string
  layerId: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  createdAt: string
  updatedAt: string
}

export interface StrokeObject extends BaseObject {
  type: 'stroke'
  points: number[]
  color: string
  size: number
  erase: boolean
}

export interface TextObject extends BaseObject {
  type: 'text'
  text: string
  color: string
  fontSize: number
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
}

export interface NoteObject extends BaseObject {
  type: 'note'
  text: string
  category: NoteCategory
  fontSize?: number
}

export interface TaskObject extends BaseObject {
  type: 'task'
  taskId: string
  fontSize?: number
}

export interface ImageObject extends BaseObject {
  type: 'image'
  fileId: string
}

export type CanvasObject = StrokeObject | TextObject | NoteObject | TaskObject | ImageObject
export type CanvasObjectType = CanvasObject['type']

export interface Viewport {
  x: number
  y: number
  scale: number
}

// Notes live as canvas objects (type 'note') rather than a separate table: one source of truth.
export interface Canvas {
  id: string // === projectId
  projectId: string
  viewport: Viewport
  layers: Layer[]
  objects: CanvasObject[]
  updatedAt: string
}

export interface AIAttachment {
  fileId: string
  name: string
  mediaType: string
}

export interface AIMessage {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  attachments: AIAttachment[]
  createdAt: string
}

export interface AIConversation {
  id: string // projectId, or 'global' for the dashboard
  projectId: string | null
  messages: AIMessage[]
  createdAt: string
  updatedAt: string
}

export const uid = () => crypto.randomUUID()
export const now = () => new Date().toISOString()
