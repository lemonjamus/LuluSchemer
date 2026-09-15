import Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Layer, Stage, Transformer } from 'react-konva'
import type { CanvasObject, Viewport } from '../../models'
import { snap, TASK_DRAG_TYPE, TASK_SIZE, useCanvas, type Tool } from '../../stores/canvas'
import { useTasks } from '../../stores/tasks'
import { useSettings, useUI } from '../../stores/ui'
import { accents, surfaces } from '../../theme'
import { ObjectNode, type NodeHandlers } from './nodes'
import { findNode, stageHandle } from './snapshot'
import { TextEditor } from './TextEditor'

export interface CanvasMenuRequest {
  x: number
  y: number
  world: { x: number; y: number }
  ids: string[]
  selectionText?: string
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'draw'; line: Konva.Line; points: number[]; erase: boolean }
  | { kind: 'marquee'; sx: number; sy: number; rect: Konva.Rect; base: string[] }

const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', b: 'brush', e: 'eraser', t: 'text', n: 'note', k: 'task' }
const FONT_VARIANTS = ['', 'bold ', 'italic ', 'italic bold '].map((s) => `${s}16px "Fantasque Sans Mono"`)
const ALL_ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
const overlayOpen = () => !!document.querySelector('dialog[open]') || !!useUI.getState().snipFrame

export function CanvasStage({ onMenu }: { onMenu: (r: CanvasMenuRequest) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const cursorRef = useRef<Konva.Circle>(null)
  const uiLayerRef = useRef<Konva.Layer>(null)
  const layerRefs = useRef(new Map<string, Konva.Layer>())
  const gesture = useRef<Gesture | null>(null)
  const dragStart = useRef(new Map<string, { x: number; y: number }>())
  const pendingTransforms = useRef<{ id: string; patch: Partial<CanvasObject> }[]>([])
  const copiedText = useRef<string | null>(null)

  const [size, setSize] = useState({ width: 0, height: 0 })
  const [fontsReady, setFontsReady] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)

  const objects = useCanvas((s) => s.objects)
  const layers = useCanvas((s) => s.layers)
  const tool = useCanvas((s) => s.tool)
  const selectedIds = useCanvas((s) => s.selectedIds)
  const editingId = useCanvas((s) => (s.editing && !s.editing.isNew ? s.editing.obj.id : null))
  const focusObjectId = useUI((s) => s.focusObjectId)
  const snapOn = useSettings((s) => s.snapToGrid)
  const ready = fontsReady && size.width > 0

  const byLayer = useMemo(() => {
    const m = new Map<string, CanvasObject[]>()
    for (const o of objects) m.set(o.layerId, [...(m.get(o.layerId) ?? []), o])
    return m
  }, [objects])

  // --- setup: size, fonts, viewport ---------------------------------------------------------
  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
      useCanvas.getState().set({ stageSize: { width, height } })
    })
    ro.observe(containerRef.current!)
    // Konva measures text once; make sure the webfont is ready before the first draw.
    Promise.all(FONT_VARIANTS.map((f) => document.fonts.load(f))).finally(() => setFontsReady(true))
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!ready) return
    stageHandle.current = stageRef.current
    // Viewport changes bypass React: move the stage and the dot grid directly.
    const apply = (v: Viewport) => {
      const stage = stageRef.current
      stage?.position({ x: v.x, y: v.y })
      stage?.scale({ x: v.scale, y: v.scale })
      stage?.batchDraw()
      const el = containerRef.current
      if (el) {
        let g = 24 * v.scale
        while (g < 12) g *= 2
        el.style.backgroundSize = `${g}px ${g}px`
        el.style.backgroundPosition = `${v.x}px ${v.y}px`
      }
    }
    apply(useCanvas.getState().viewport)
    const unsub = useCanvas.subscribe((s, p) => {
      if (s.viewport !== p.viewport) apply(s.viewport)
    })
    return () => {
      unsub()
      stageHandle.current = null
    }
  }, [ready])

  useEffect(() => {
    if (!ready || !focusObjectId) return
    useCanvas.getState().focus(focusObjectId)
    useUI.getState().set({ focusObjectId: null })
  }, [ready, focusObjectId])

  // --- transformer follows selection --------------------------------------------------------
  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const blocked = new Set(layers.filter((l) => l.locked || !l.visible).map((l) => l.id))
    const nodes = tool !== 'select' ? [] : selectedIds.flatMap((id) => {
      const o = objects.find((x) => x.id === id)
      const n = o && !blocked.has(o.layerId) && id !== editingId ? findNode(id) : undefined
      return n ? [n] : []
    })
    tr.nodes(nodes)
    const only = nodes.length === 1 ? objects.find((o) => o.id === nodes[0].id()) : undefined
    tr.keepRatio(only?.type === 'image')
    tr.enabledAnchors(only?.type === 'task' ? ['middle-left', 'middle-right'] : ALL_ANCHORS)
    tr.getLayer()?.batchDraw()
  }, [selectedIds, objects, layers, tool, editingId, ready])

  // --- node drag / transform (stable handlers keep ObjectNode memoised) ---------------------
  const handlers = useMemo<NodeHandlers>(() => ({
    onDragStart: (e) => {
      const s = useCanvas.getState()
      const id = e.target.id()
      let sel = s.selectedIds
      if (!sel.includes(id)) s.set({ selectedIds: (sel = [id]) })
      dragStart.current = new Map(sel.flatMap((i) => {
        const n = findNode(i)
        return n ? [[i, n.position()] as const] : []
      }))
    },
    onDragMove: (e) => {
      const id = e.target.id()
      const start = dragStart.current.get(id)
      if (!start) return
      if (useSettings.getState().snapToGrid) e.target.position({ x: snap(e.target.x()), y: snap(e.target.y()) })
      const dx = e.target.x() - start.x
      const dy = e.target.y() - start.y
      dragStart.current.forEach((p, i) => i !== id && findNode(i)?.position({ x: p.x + dx, y: p.y + dy }))
    },
    onDragEnd: () => {
      const patches = [...dragStart.current.keys()].flatMap((i) => {
        const n = findNode(i)
        return n ? [{ id: i, patch: { x: n.x(), y: n.y() } }] : []
      })
      dragStart.current.clear()
      useCanvas.getState().updateMany(patches)
    },
    onTransformEnd: (e) => {
      const n = e.target
      const o = useCanvas.getState().objects.find((x) => x.id === n.id())
      if (!o) return
      const sx = n.scaleX(), sy = n.scaleY()
      n.scale({ x: 1, y: 1 })
      const base = { x: snap(n.x()), y: snap(n.y()), rotation: n.rotation() }
      n.position(base)
      let patch: Partial<CanvasObject>
      if (o.type === 'stroke') patch = { ...base, points: o.points.map((p, i) => (i % 2 ? p * sy : p * sx)), width: o.width * sx, height: o.height * sy }
      else if (o.type === 'text') patch = { ...base, width: Math.max(48, snap(o.width * sx)), fontSize: Math.max(6, Math.round(o.fontSize * sy * 10) / 10) }
      else if (o.type === 'task') patch = { ...base, width: Math.max(168, snap(o.width * sx)) }
      else if (o.type === 'image') patch = { ...base, width: Math.max(24, o.width * sx), height: Math.max(24, o.height * sy) } // keep aspect ratio
      else patch = { ...base, width: Math.max(96, snap(o.width * sx)), height: Math.max(72, snap(o.height * sy)) }
      // Multi-selection fires one transformend per node: batch them into a single undo step.
      pendingTransforms.current.push({ id: o.id, patch })
      if (pendingTransforms.current.length === 1) {
        queueMicrotask(() => {
          useCanvas.getState().updateMany(pendingTransforms.current)
          pendingTransforms.current = []
        })
      }
    },
  }), [])

  // --- keyboard + clipboard -------------------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || overlayOpen()) return
      const s = useCanvas.getState()
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (e.code === 'Space') {
        e.preventDefault()
        setSpaceHeld(true)
        return
      }
      if (mod) {
        if (k === 'z') s[e.shiftKey ? 'redo' : 'undo']()
        else if (k === 'y') s.redo()
        else if (k === 'c' || k === 'x') {
          if (!s.selectedIds.length) return
          s.copy(s.selectedIds)
          copiedText.current = s.objects.filter((o) => s.selectedIds.includes(o.id)).map((o) => ('text' in o ? o.text : '')).join('\n')
          navigator.clipboard?.writeText(copiedText.current).catch(() => {})
          if (k === 'x') s.remove(s.selectedIds)
        } else if (k === 'd') s.duplicate(s.selectedIds)
        else if (k === 'a') {
          const open = new Set(s.layers.filter((l) => l.visible && !l.locked).map((l) => l.id))
          s.set({ tool: 'select', selectedIds: s.objects.filter((o) => open.has(o.layerId) && !(o.type === 'stroke' && o.erase)).map((o) => o.id) })
        } else if (k === '0') s.resetZoom()
        else if (k === '=' || k === '+') s.zoomAt(1.2)
        else if (k === '-') s.zoomAt(1 / 1.2)
        else return
        e.preventDefault()
        return
      }
      if (e.altKey) return
      if (k === 'delete' || k === 'backspace') s.remove(s.selectedIds)
      else if (k === 'escape') s.set({ selectedIds: [] })
      else if (k === 'enter' && s.selectedIds.length === 1) {
        e.preventDefault()
        s.startEdit(s.selectedIds[0])
      } else if (k === 'g') {
        const on = !useSettings.getState().snapToGrid
        useSettings.getState().set({ snapToGrid: on })
        useUI.getState().toast(`Snap to grid ${on ? 'on' : 'off'}`)
      } else if (TOOL_KEYS[k]) s.set({ tool: TOOL_KEYS[k] })
    }
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceHeld(false)
    const blur = () => setSpaceHeld(false)
    const paste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || overlayOpen()) return
      const s = useCanvas.getState()
      const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      e.preventDefault()
      if (image) return void s.addImage(image)
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (s.clipboard.length && (text === copiedText.current || !text.trim())) s.paste()
      else if (text.trim()) s.addText(text)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      window.removeEventListener('paste', paste)
    }
  }, [])

  // --- pointer ---------------------------------------------------------------------------------
  const worldFromClient = (cx: number, cy: number) => {
    const r = containerRef.current!.getBoundingClientRect()
    const v = useCanvas.getState().viewport
    return { x: (cx - r.left - v.x) / v.scale, y: (cy - r.top - v.y) / v.scale }
  }

  const objectAt = (target: Konva.Node) => {
    if (target === stageRef.current) return undefined
    const node = target.findAncestor('.obj', true)
    return node ? useCanvas.getState().objects.find((o) => o.id === node.id()) : undefined
  }

  const onPointerDown = (e: KonvaEventObject<PointerEvent>) => {
    const s = useCanvas.getState()
    const ev = e.evt
    if (s.editing) {
      ;(document.activeElement as HTMLElement | null)?.blur() // commits the edit
      return
    }
    if (ev.button === 2) return
    if (ev.button === 1 || spaceHeld || s.tool === 'hand') {
      ev.preventDefault()
      gesture.current = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, vx: s.viewport.x, vy: s.viewport.y }
      setPanning(true)
      window.addEventListener('pointerup', endGesture, { once: true })
      return
    }
    const p = worldFromClient(ev.clientX, ev.clientY)
    const obj = objectAt(e.target)

    if (e.target.name() === 'task-check' && obj?.type === 'task') {
      const t = useTasks.getState().tasks.find((x) => x.id === obj.taskId)
      if (t) useTasks.getState().update(t.id, { completed: !t.completed })
      return
    }

    switch (s.tool) {
      case 'brush':
      case 'eraser': {
        const layer = s.layers.find((l) => l.id === s.activeLayerId)
        const k = layer && layerRefs.current.get(layer.id)
        if (!layer?.visible || layer.locked || !k) {
          useUI.getState().toast(`Layer "${layer?.name}" is ${layer?.locked ? 'locked' : 'hidden'}.`)
          return
        }
        const erase = s.tool === 'eraser'
        const points = [p.x, p.y, p.x + 0.01, p.y]
        const line = new Konva.Line({
          points, stroke: s.brush.color, strokeWidth: erase ? s.eraserSize : s.brush.size, opacity: erase ? 1 : s.brush.opacity,
          lineCap: 'round', lineJoin: 'round', tension: 0.35, listening: false,
          globalCompositeOperation: erase ? 'destination-out' : 'source-over',
        })
        k.add(line)
        k.batchDraw()
        gesture.current = { kind: 'draw', line, points, erase }
        window.addEventListener('pointerup', endGesture, { once: true }) // finish even if released off-canvas
        return
      }
      case 'text':
      case 'note':
      case 'task':
        ev.preventDefault() // stop the follow-up mousedown from stealing focus from the new editor
        if (obj?.type === s.tool) s.startEdit(obj.id)
        else s.startNew(s.tool, s.tool === 'text' ? { x: p.x, y: p.y - 12 } : p)
        return
      case 'select':
        if (!obj) {
          // Empty canvas: start a box selection (Shift adds to the current selection).
          if (!ev.shiftKey) s.set({ selectedIds: [] })
          const rect = new Konva.Rect({
            x: p.x, y: p.y, width: 0, height: 0, listening: false,
            fill: 'rgba(168, 85, 247, 0.08)', stroke: accents.purple, strokeWidth: 1, strokeScaleEnabled: false, dash: [4, 3],
          })
          uiLayerRef.current?.add(rect)
          gesture.current = { kind: 'marquee', sx: p.x, sy: p.y, rect, base: ev.shiftKey ? s.selectedIds : [] }
          window.addEventListener('pointerup', endGesture, { once: true })
        } else if (ev.shiftKey) {
          s.set({ selectedIds: s.selectedIds.includes(obj.id) ? s.selectedIds.filter((i) => i !== obj.id) : [...s.selectedIds, obj.id] })
        } else if (!s.selectedIds.includes(obj.id)) {
          s.set({ selectedIds: [obj.id] })
        }
    }
  }

  const onPointerMove = (e: KonvaEventObject<PointerEvent>) => {
    const s = useCanvas.getState()
    const ev = e.evt
    const cursor = cursorRef.current
    if (cursor && (s.tool === 'brush' || s.tool === 'eraser') && !spaceHeld) {
      const p = worldFromClient(ev.clientX, ev.clientY)
      cursor.setAttrs({ x: p.x, y: p.y, radius: Math.max(2, (s.tool === 'eraser' ? s.eraserSize : s.brush.size) / 2), visible: true })
      cursor.getLayer()?.batchDraw()
    } else if (cursor?.visible()) {
      cursor.visible(false)
      cursor.getLayer()?.batchDraw()
    }
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pan') {
      s.set({ viewport: { ...s.viewport, x: g.vx + ev.clientX - g.sx, y: g.vy + ev.clientY - g.sy } })
    } else if (g.kind === 'marquee') {
      const p = worldFromClient(ev.clientX, ev.clientY)
      g.rect.setAttrs({ x: Math.min(g.sx, p.x), y: Math.min(g.sy, p.y), width: Math.abs(p.x - g.sx), height: Math.abs(p.y - g.sy) })
      g.rect.getLayer()?.batchDraw()
    } else {
      // Coalesced events give stylus/trackpad input its full sample rate.
      for (const ce of ev.getCoalescedEvents?.() ?? [ev]) {
        const p = worldFromClient(ce.clientX, ce.clientY)
        g.points.push(p.x, p.y)
      }
      g.line.points(g.points)
      g.line.getLayer()?.batchDraw()
    }
  }

  const endGesture = () => {
    const g = gesture.current
    gesture.current = null
    setPanning(false)
    if (g?.kind === 'marquee') {
      const box = g.rect.getClientRect()
      g.rect.destroy()
      uiLayerRef.current?.batchDraw()
      if (box.width < 4 && box.height < 4) return
      const s = useCanvas.getState()
      const nodes = new Map<string, Konva.Node>()
      layerRefs.current.forEach((l) => l.getChildren().forEach((n) => nodes.set(n.id(), n)))
      const open = new Set(s.layers.filter((l) => l.visible && !l.locked).map((l) => l.id))
      const hits = s.objects.flatMap((o) => {
        const n = nodes.get(o.id)
        return n && open.has(o.layerId) && !(o.type === 'stroke' && o.erase) && Konva.Util.haveIntersection(box, n.getClientRect()) ? [o.id] : []
      })
      s.set({ selectedIds: [...new Set([...g.base, ...hits])] })
      return
    }
    if (g?.kind !== 'draw') return
    g.line.destroy()
    const s = useCanvas.getState()
    const xs = g.points.filter((_, i) => i % 2 === 0)
    const ys = g.points.filter((_, i) => i % 2 === 1)
    const minX = Math.min(...xs), minY = Math.min(...ys)
    s.add({
      type: 'stroke', erase: g.erase,
      points: g.points.map((v, i) => (i % 2 ? v - minY : v - minX)),
      x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY,
      color: s.brush.color, size: g.erase ? s.eraserSize : s.brush.size, opacity: g.erase ? 1 : s.brush.opacity,
    })
  }

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    const ev = e.evt
    ev.preventDefault()
    const s = useCanvas.getState()
    const unit = ev.deltaMode === 1 ? 16 : 1
    if (ev.ctrlKey || ev.metaKey) {
      const r = containerRef.current!.getBoundingClientRect()
      s.zoomAt(Math.exp(-ev.deltaY * unit * 0.01), { x: ev.clientX - r.left, y: ev.clientY - r.top })
    } else {
      s.set({ viewport: { ...s.viewport, x: s.viewport.x - ev.deltaX * unit, y: s.viewport.y - ev.deltaY * unit } })
    }
  }

  const onContextMenu = (e: KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault()
    const s = useCanvas.getState()
    if (s.editing) return
    const obj = objectAt(e.target)
    let ids = obj ? s.selectedIds : []
    if (obj && !ids.includes(obj.id)) ids = [obj.id]
    s.set({ selectedIds: ids, tool: s.tool === 'hand' ? 'hand' : 'select' })
    onMenu({ x: e.evt.clientX, y: e.evt.clientY, world: worldFromClient(e.evt.clientX, e.evt.clientY), ids })
  }

  const onDblClick = (e: KonvaEventObject<Event>) => {
    const obj = objectAt(e.target)
    if (obj) useCanvas.getState().startEdit(obj.id)
  }

  const cursorClass = panning ? 'grabbing' : spaceHeld || tool === 'hand' ? 'grab' : tool === 'brush' || tool === 'eraser' ? 'none' : tool === 'text' ? 'text' : tool === 'select' ? 'default' : 'crosshair'
  const canDrag = tool === 'select' && !spaceHeld

  return (
    <div
      ref={containerRef}
      className={`canvas-host dotgrid cursor-${cursorClass}`}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TASK_DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        const taskId = e.dataTransfer.getData(TASK_DRAG_TYPE)
        if (!taskId) return
        e.preventDefault()
        const p = worldFromClient(e.clientX, e.clientY)
        useCanvas.getState().addTaskCard(taskId, { x: p.x - 24, y: p.y - TASK_SIZE.height / 2 })
      }}
    >
      {ready && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onPointerLeave={() => {
            cursorRef.current?.visible(false)
            cursorRef.current?.getLayer()?.batchDraw()
            if (gesture.current?.kind === 'pan') endGesture()
          }}
          onWheel={onWheel}
          onContextMenu={onContextMenu}
          onDblClick={onDblClick}
          onDblTap={onDblClick}
        >
          {layers.map((layer) => (
            <Layer
              key={layer.id}
              ref={(n) => {
                if (n) layerRefs.current.set(layer.id, n)
                else layerRefs.current.delete(layer.id)
              }}
              visible={layer.visible}
              listening={!layer.locked}
            >
              {(byLayer.get(layer.id) ?? []).map((o) => (
                <ObjectNode key={o.id} obj={o} draggable={canDrag} hidden={o.id === editingId} handlers={handlers} />
              ))}
            </Layer>
          ))}
          <Layer ref={uiLayerRef}>
            <Transformer
              ref={trRef}
              rotationSnaps={snapOn ? [0, 45, 90, 135, 180, 225, 270, 315] : []}
              rotationSnapTolerance={8}
              borderStroke={accents.purple}
              borderStrokeWidth={1}
              anchorStroke={accents.purple}
              anchorFill={surfaces.bg}
              anchorSize={8}
              anchorCornerRadius={2}
              rotateAnchorOffset={24}
              padding={4}
              ignoreStroke
              boundBoxFunc={(oldBox, box) => (Math.abs(box.width) < 12 || Math.abs(box.height) < 12 ? oldBox : box)}
            />
            <Circle ref={cursorRef} listening={false} visible={false} stroke="rgba(255,255,255,0.75)" strokeWidth={1} strokeScaleEnabled={false} />
          </Layer>
        </Stage>
      )}
      <TextEditor onSelectionMenu={(x, y, text) => onMenu({ x, y, world: { x: 0, y: 0 }, ids: [], selectionText: text })} />
    </div>
  )
}
