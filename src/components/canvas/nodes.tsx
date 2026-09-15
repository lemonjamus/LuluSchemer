import type { KonvaEventObject } from 'konva/lib/Node'
import { memo, useEffect, useState } from 'react'
import { Group, Image as KImage, Line, Rect, Text } from 'react-konva'
import type { CanvasObject, ImageObject, NoteObject, StrokeObject, TaskObject, TextObject } from '../../models'
import { files } from '../../services/storage'
import { DEFAULT_CARD_FONT } from '../../stores/canvas'
import { useTasks } from '../../stores/tasks'
import { accents, CATEGORY, FONT, surfaces } from '../../theme'

type Handler = (e: KonvaEventObject<DragEvent | Event>) => void
export interface NodeHandlers {
  onDragStart: Handler
  onDragMove: Handler
  onDragEnd: Handler
  onTransformEnd: Handler
}

interface Props<T extends CanvasObject> {
  obj: T
  draggable: boolean
  hidden: boolean
  handlers: NodeHandlers
}

// Every root node carries name="obj" and the object id, so hit-testing can walk up to it.
const common = (o: CanvasObject, draggable: boolean, h: NodeHandlers) => ({
  id: o.id,
  name: 'obj',
  x: o.x,
  y: o.y,
  rotation: o.rotation,
  opacity: o.opacity,
  draggable,
  ...h,
})

function StrokeNode({ obj: o, draggable, handlers }: Props<StrokeObject>) {
  return (
    <Line
      {...common(o, draggable, handlers)}
      points={o.points}
      stroke={o.color}
      strokeWidth={o.size}
      lineCap="round"
      lineJoin="round"
      tension={0.35}
      globalCompositeOperation={o.erase ? 'destination-out' : 'source-over'}
      listening={!o.erase}
      hitStrokeWidth={Math.max(o.size, 14)}
      perfectDrawEnabled={false}
    />
  )
}

function TextNode({ obj: o, draggable, hidden, handlers }: Props<TextObject>) {
  return (
    <Text
      {...common(o, draggable, handlers)}
      visible={!hidden}
      width={o.width}
      text={o.text}
      fontFamily={FONT}
      fontSize={o.fontSize}
      fontStyle={`${o.italic ? 'italic ' : ''}${o.bold ? 'bold' : 'normal'}`}
      align={o.align}
      fill={o.color}
      lineHeight={1.25}
    />
  )
}

function NoteNode({ obj: o, draggable, hidden, handlers }: Props<NoteObject>) {
  const cat = CATEGORY[o.category]
  return (
    <Group {...common(o, draggable, handlers)}>
      <Rect width={o.width} height={o.height} fill={surfaces.surface2} stroke={surfaces.border} strokeWidth={1} cornerRadius={6} shadowColor="#000" shadowBlur={16} shadowOpacity={0.35} shadowOffsetY={4} />
      <Rect width={3} height={o.height - 16} y={8} fill={cat.color} cornerRadius={2} />
      <Text x={12} y={11} text={cat.label} fontFamily={FONT} fontSize={11} fontStyle="bold" letterSpacing={1.5} fill={cat.color} />
      <Text x={12} y={30} width={o.width - 24} height={o.height - 40} text={hidden ? '' : o.text} fontFamily={FONT} fontSize={o.fontSize ?? DEFAULT_CARD_FONT} lineHeight={1.3} fill={surfaces.text} ellipsis />
    </Group>
  )
}

function TaskNode({ obj: o, draggable, hidden, handlers }: Props<TaskObject>) {
  const task = useTasks((s) => s.tasks.find((t) => t.id === o.taskId))
  const done = !!task?.completed
  const fs = o.fontSize ?? DEFAULT_CARD_FONT
  return (
    <Group {...common(o, draggable, handlers)}>
      <Rect width={o.width} height={o.height} fill={surfaces.surface2} stroke={done ? accents.green : surfaces.border} strokeWidth={1} cornerRadius={6} />
      <Rect name="task-check" x={12} y={o.height / 2 - 8} width={16} height={16} cornerRadius={3} stroke={done ? accents.green : accents.purple} strokeWidth={1.5} fill={done ? accents.green : 'transparent'} hitStrokeWidth={10} />
      {done && <Text x={14} y={o.height / 2 - 7} text="✓" fontFamily={FONT} fontSize={14} fontStyle="bold" fill={surfaces.bg} listening={false} />}
      <Text
        x={36}
        y={o.height / 2 - fs / 2}
        width={o.width - 48}
        text={hidden ? '' : task?.title ?? '(deleted task)'}
        fontFamily={FONT}
        fontSize={fs}
        fill={done || !task ? surfaces.muted : surfaces.text}
        textDecoration={done ? 'line-through' : ''}
        wrap="none"
        ellipsis
      />
    </Group>
  )
}

function useFileImage(fileId: string) {
  const [state, setState] = useState<HTMLImageElement | 'missing'>()
  useEffect(() => {
    let alive = true
    files.getUrl(fileId).then((url) => {
      if (!url) return alive && setState('missing')
      const img = new window.Image()
      img.onload = () => alive && setState(img)
      img.onerror = () => alive && setState('missing')
      img.src = url
    })
    return () => {
      alive = false
    }
  }, [fileId])
  return state
}

function ImageNode({ obj: o, draggable, handlers }: Props<ImageObject>) {
  const img = useFileImage(o.fileId)
  if (img instanceof HTMLImageElement) return <KImage {...common(o, draggable, handlers)} image={img} width={o.width} height={o.height} />
  return (
    <Group {...common(o, draggable, handlers)}>
      <Rect width={o.width} height={o.height} stroke={surfaces.border} dash={[6, 4]} fill={surfaces.surface} />
      <Text width={o.width} y={o.height / 2 - 7} align="center" text={img === 'missing' ? 'image missing' : 'loading…'} fontFamily={FONT} fontSize={12} fill={surfaces.muted} />
    </Group>
  )
}

export const ObjectNode = memo(function ObjectNode(props: Props<CanvasObject>) {
  const { obj } = props
  switch (obj.type) {
    case 'stroke': return <StrokeNode {...props} obj={obj} />
    case 'text': return <TextNode {...props} obj={obj} />
    case 'note': return <NoteNode {...props} obj={obj} />
    case 'task': return <TaskNode {...props} obj={obj} />
    case 'image': return <ImageNode {...props} obj={obj} />
  }
})
