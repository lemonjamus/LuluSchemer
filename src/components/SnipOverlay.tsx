import { useEffect, useMemo, useState } from 'react'
import { cropToBlob } from '../services/screenshot'
import { files } from '../services/storage'
import { useAI } from '../stores/ai'
import { useCanvas } from '../stores/canvas'
import { useUI } from '../stores/ui'

type Rect = { x: number; y: number; w: number; h: number }

export function SnipOverlay() {
  const frame = useUI((s) => s.snipFrame)
  const route = useUI((s) => s.route)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [done, setDone] = useState(false)

  const src = useMemo(() => frame?.toDataURL('image/png'), [frame])

  const close = () => {
    setStart(null)
    setRect(null)
    setDone(false)
    useUI.getState().set({ snipFrame: null })
  }

  useEffect(() => {
    if (!frame) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'Enter') finish('ai', { x: 0, y: 0, w: innerWidth, h: innerHeight })
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  if (!frame || !src) return null

  // The frame is shown with object-fit: contain; map screen px → frame px.
  const scale = Math.min(innerWidth / frame.width, innerHeight / frame.height)
  const offX = (innerWidth - frame.width * scale) / 2
  const offY = (innerHeight - frame.height * scale) / 2

  async function finish(target: 'ai' | 'canvas', r = rect) {
    if (!frame || !r || r.w < 4 || r.h < 4) return
    try {
      const blob = await cropToBlob(frame, { x: (r.x - offX) / scale, y: (r.y - offY) / scale, w: r.w / scale, h: r.h / scale })
      const fileId = await files.upload(blob)
      const name = `snip-${new Date().toLocaleTimeString('en-GB').replaceAll(':', '')}.png`
      if (target === 'ai') {
        useAI.getState().attach({ fileId, name, mediaType: 'image/png' })
        useUI.getState().set({ aiOpen: true })
      } else {
        const c = useCanvas.getState().center()
        const w = r.w / scale, h = r.h / scale, fit = Math.min(1, 480 / w)
        useCanvas.getState().add({ type: 'image', fileId, x: c.x - (w * fit) / 2, y: c.y - (h * fit) / 2, width: w * fit, height: h * fit })
      }
    } catch (e) {
      useUI.getState().toast(`Snip failed: ${(e as Error).message}`, 'error')
    }
    close()
  }

  return (
    <div
      className="snip"
      role="dialog"
      aria-label="Snip: drag to select a region, Enter for full frame, Escape to cancel"
      onPointerDown={(e) => {
        if (done) return
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        setStart({ x: e.clientX, y: e.clientY })
        setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
      }}
      onPointerMove={(e) => {
        if (!start || done) return
        setRect({ x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) })
      }}
      onPointerUp={() => {
        if (!start) return
        setStart(null)
        if (rect && rect.w > 4 && rect.h > 4) setDone(true)
        else setRect(null)
      }}
    >
      <img src={src} alt="" draggable={false} />
      {rect ? (
        <div className="snip-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
          <span className="snip-size">{Math.round(rect.w / scale)} × {Math.round(rect.h / scale)}</span>
        </div>
      ) : (
        <div className="snip-hint">Drag to snip · Enter = full frame · Esc = cancel</div>
      )}
      {done && rect && (
        <div className="snip-actions" style={{ left: rect.x, top: Math.min(rect.y + rect.h + 8, innerHeight - 44) }} onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn btn-primary btn-sm" autoFocus onClick={() => finish('ai')}>Ask AI</button>
          {route.name === 'project' && <button className="btn btn-sm" onClick={() => finish('canvas')}>Add to canvas</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => { setDone(false); setRect(null) }}>Redo</button>
          <button className="btn btn-ghost btn-sm" onClick={close}>Cancel</button>
        </div>
      )}
    </div>
  )
}
