import { useLayoutEffect, useRef } from 'react'
import { DEFAULT_CARD_FONT, useCanvas } from '../../stores/canvas'
import { useTasks } from '../../stores/tasks'
import { FONT } from '../../theme'

/** HTML textarea laid exactly over the Konva object being edited. Blur / Escape commits. */
export function TextEditor({ onSelectionMenu }: { onSelectionMenu: (x: number, y: number, text: string) => void }) {
  const editing = useCanvas((s) => s.editing)
  const v = useCanvas((s) => s.viewport)
  const taskTitle = useTasks((s) => {
    const o = editing?.obj
    return o?.type === 'task' ? s.tasks.find((t) => t.id === o.taskId)?.title : undefined
  })
  const ref = useRef<HTMLTextAreaElement>(null)

  const autosize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    autosize()
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing?.obj.id])

  if (!editing) return null
  const o = editing.obj
  const s = v.scale
  const box = { left: o.x * s + v.x, top: o.y * s + v.y, width: o.width * s }
  let style: React.CSSProperties
  let initial = ''

  if (o.type === 'text') {
    initial = o.text
    style = { fontSize: o.fontSize * s, color: o.color, fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal', textAlign: o.align, lineHeight: 1.25 }
  } else if (o.type === 'note') {
    initial = o.text
    Object.assign(box, { left: box.left + 12 * s, top: box.top + 30 * s, width: (o.width - 24) * s })
    style = { fontSize: (o.fontSize ?? DEFAULT_CARD_FONT) * s, lineHeight: 1.3 }
  } else if (o.type === 'task') {
    initial = taskTitle ?? ''
    const fs = o.fontSize ?? DEFAULT_CARD_FONT
    Object.assign(box, { left: box.left + 36 * s, top: box.top + (o.height / 2 - fs / 2) * s, width: (o.width - 48) * s })
    style = { fontSize: fs * s, lineHeight: 1 }
  } else {
    return null
  }

  return (
    <textarea
      key={o.id}
      ref={ref}
      className="canvas-editor"
      aria-label={`Edit ${o.type}`}
      placeholder={o.type === 'task' ? 'Task title' : o.type === 'note' ? 'Write a note…' : 'Type…'}
      defaultValue={initial}
      spellCheck={false}
      style={{ ...style, ...box, fontFamily: FONT, transform: `rotate(${o.rotation}deg)` }}
      onInput={autosize}
      onBlur={(e) => useCanvas.getState().commitEdit(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        const done = e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (o.type === 'task' && !e.shiftKey)))
        if (done) {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      onContextMenu={(e) => {
        const el = e.currentTarget
        const sel = el.value.slice(el.selectionStart, el.selectionEnd)
        if (!sel.trim()) return
        e.preventDefault()
        onSelectionMenu(e.clientX, e.clientY, sel)
      }}
    />
  )
}
