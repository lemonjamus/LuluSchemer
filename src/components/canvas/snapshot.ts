import type Konva from 'konva'
import { surfaces } from '../../theme'

/** Set by CanvasStage while mounted so non-canvas code (menus, AI) can rasterise objects. */
export const stageHandle: { current: Konva.Stage | null } = { current: null }

export function findNode(id: string) {
  return stageHandle.current?.findOne((n: Konva.Node) => n.id() === id)
}

/** PNG of the given objects' bounding box on the dark canvas background. */
export async function snapshotObjects(ids: string[]): Promise<Blob | null> {
  const stage = stageHandle.current
  const nodes = ids.map(findNode).filter((n): n is Konva.Node => !!n)
  if (!stage || !nodes.length) return null
  const rects = nodes.map((n) => n.getClientRect())
  const pad = 16
  const x = Math.min(...rects.map((r) => r.x)) - pad
  const y = Math.min(...rects.map((r) => r.y)) - pad
  const width = Math.max(...rects.map((r) => r.x + r.width)) + pad - x
  const height = Math.max(...rects.map((r) => r.y + r.height)) + pad - y

  const transformers = stage.find('Transformer')
  transformers.forEach((t) => t.visible(false))
  const pixelRatio = Math.min(4, Math.max(1, 1024 / Math.max(width, height)))
  const src = stage.toCanvas({ x, y, width, height, pixelRatio })
  transformers.forEach((t) => t.visible(true))

  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d')!
  ctx.fillStyle = surfaces.bg
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(src, 0, 0)
  return new Promise((resolve) => out.toBlob(resolve, 'image/png'))
}
