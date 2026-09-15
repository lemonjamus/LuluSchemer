import { ClipboardCopy, Eraser, ImagePlus, ListPlus, PanelRightClose, Pin, RotateCcw, Scissors, SendHorizontal, Square, StickyNote, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { parseTaskLines } from '../lib'
import type { AIAttachment, AIMessage } from '../models'
import { actionPrompt } from '../services/aiContext'
import { startSnip } from '../services/screenshot'
import { files } from '../services/storage'
import { useAI } from '../stores/ai'
import { useCanvas } from '../stores/canvas'
import { useTasks } from '../stores/tasks'
import { useUI } from '../stores/ui'
import { IconButton } from './ui'

const QUICK = [
  'What am I missing?',
  'Summarize this project.',
  'Suggest the next three steps.',
  actionPrompt('tasks') + ' Base them on the project context.',
]

function loadPref<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback
  } catch {
    return fallback
  }
}
function savePref(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch { /* preference only */ }
}

export function AIPanel({ projectId }: { projectId: string | null }) {
  const conversation = useAI((s) => s.conversation)
  const streaming = useAI((s) => s.streaming)
  const attachments = useAI((s) => s.attachments)
  const providerLabel = useAI((s) => s.providerLabel)
  const input = useAI((s) => s.draft)
  const setInput = (draft: string) => useAI.setState({ draft })
  const [width, setWidth] = useState(() => loadPref('lulu-ai-width', 380))
  const [floating, setFloating] = useState(() => loadPref('lulu-ai-floating', false))
  const [pos, setPos] = useState(() => loadPref('lulu-ai-pos', { x: 80, y: 80 }))
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    useAI.getState().open(projectId)
  }, [projectId])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const last = conversation?.messages[conversation.messages.length - 1]
  useEffect(() => {
    const el = logRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight
  }, [last?.content, conversation?.messages.length])

  const send = (text = input) => {
    useAI.getState().send(text)
    setInput('')
  }

  const addImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return
    const fileId = await files.upload(file)
    useAI.getState().attach({ fileId, name: file.name, mediaType: file.type })
  }

  // Drag the left edge to resize; drag the header to move when floating.
  const drag = (e: React.PointerEvent, kind: 'resize' | 'move') => {
    if ((e.target as HTMLElement).closest('button')) return
    const sx = e.clientX, sy = e.clientY, w0 = width, p0 = pos
    const move = (ev: PointerEvent) => {
      if (kind === 'resize') setWidth(Math.min(760, Math.max(300, w0 + (sx - ev.clientX) * (floating ? -1 : 1))))
      else setPos({ x: Math.max(0, p0.x + ev.clientX - sx), y: Math.max(0, p0.y + ev.clientY - sy) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  useEffect(() => savePref('lulu-ai-width', width), [width])
  useEffect(() => savePref('lulu-ai-pos', pos), [pos])
  useEffect(() => savePref('lulu-ai-floating', floating), [floating])

  const messages = conversation?.messages ?? []

  return (
    <aside
      className={`ai-panel ${floating ? 'is-floating' : ''}`}
      style={floating ? { width, left: pos.x, top: pos.y } : { width }}
      aria-label="AI assistant"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        for (const f of e.dataTransfer.files) addImageFile(f)
      }}
    >
      <div className={`ai-resize ${floating ? 'is-right' : ''}`} onPointerDown={(e) => drag(e, 'resize')} aria-hidden />
      <header className="panel-head" onPointerDown={(e) => floating && drag(e, 'move')} style={{ cursor: floating ? 'move' : undefined }}>
        <span>
          AI ASSISTANT {providerLabel && <span className="muted">· {providerLabel}</span>}
        </span>
        <div className="row">
          <IconButton icon={Eraser} label="Clear conversation" size={14} disabled={!messages.length} onClick={() => confirm('Clear this conversation?') && useAI.getState().clear()} />
          <IconButton icon={floating ? PanelRightClose : Pin} label={floating ? 'Dock panel' : 'Float panel'} size={14} onClick={() => setFloating(!floating)} />
          <IconButton icon={X} label="Close AI panel" size={14} onClick={() => useUI.getState().set({ aiOpen: false })} />
        </div>
      </header>

      <div className="ai-log" ref={logRef}>
        {!messages.length && (
          <div className="ai-empty">
            <p className="muted">{projectId ? 'Ask about this project. Lulu sees its tasks, notes and canvas text.' : 'Ask about your projects and tasks.'}</p>
            {QUICK.map((q) => (
              <button key={q} className="ai-quick" onClick={() => send(q)}>
                › {q.split('\n')[0]}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <Message key={m.id} message={m} projectId={projectId} live={streaming && i === messages.length - 1} />
        ))}
        {streaming && last?.role === 'user' && <div className="ai-msg is-assistant"><span className="cursor" /></div>}
      </div>

      <div className="ai-composer">
        {attachments.length > 0 && (
          <div className="ai-attachments">
            {attachments.map((a) => (
              <Thumb key={a.fileId} attachment={a} onRemove={() => useAI.getState().detach(a.fileId)} />
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          className="ai-input"
          placeholder="Ask Lulu…"
          aria-label="Message"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            for (const item of e.clipboardData.files) addImageFile(item)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="ai-composer-bar">
          <IconButton icon={Scissors} label="Snip screen" tipSide="top" size={14} onClick={() => startSnip()} />
          <IconButton icon={ImagePlus} label="Attach image" tipSide="top" size={14} onClick={() => fileRef.current?.click()} />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files?.[0]) addImageFile(e.target.files[0]); e.target.value = '' }} />
          <span className="muted small grow">Enter to send · Shift+Enter newline</span>
          {streaming ? (
            <IconButton icon={Square} label="Stop" tipSide="top" size={14} onClick={() => useAI.getState().stop()} />
          ) : (
            <IconButton icon={SendHorizontal} label="Send" tipSide="top" size={14} className="is-primary" disabled={!input.trim() && !attachments.length} onClick={() => send()} />
          )}
        </div>
      </div>
    </aside>
  )
}

function Message({ message: m, projectId, live }: { message: AIMessage; projectId: string | null; live: boolean }) {
  const tasks = m.role === 'assistant' && !live ? parseTaskLines(m.content) : []
  const inCanvas = !!projectId && useCanvas.getState().projectId === projectId

  if (m.role === 'error') {
    return (
      <div className="ai-msg is-error" role="alert">
        <pre>{m.content}</pre>
        <button className="btn btn-sm" onClick={() => useAI.getState().retry()}>
          <RotateCcw size={12} /> Retry
        </button>
      </div>
    )
  }

  return (
    <div className={`ai-msg is-${m.role}`}>
      <div className="ai-role">{m.role === 'user' ? '> you' : '◈ lulu'}</div>
      {m.attachments.map((a) => <Thumb key={a.fileId} attachment={a} />)}
      <pre>
        {m.content}
        {live && <span className="cursor" />}
      </pre>
      {m.role === 'assistant' && !live && m.content && (
        <div className="ai-msg-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(m.content).then(() => useUI.getState().toast('Copied'))}>
            <ClipboardCopy size={12} /> Copy
          </button>
          {inCanvas && (
            <button className="btn btn-ghost btn-sm" onClick={() => useCanvas.getState().addNote(m.content, 'idea')}>
              <StickyNote size={12} /> Add to canvas
            </button>
          )}
          {tasks.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                for (const title of tasks) useTasks.getState().add({ title, projectId })
                useUI.getState().toast(`Added ${tasks.length} task${tasks.length === 1 ? '' : 's'}`)
              }}
            >
              <ListPlus size={12} /> Add {tasks.length} task{tasks.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Thumb({ attachment, onRemove }: { attachment: AIAttachment; onRemove?: () => void }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    files.getUrl(attachment.fileId).then(setUrl)
  }, [attachment.fileId])
  return (
    <figure className="thumb">
      {url ? <img src={url} alt={attachment.name} /> : <div className="thumb-missing">{attachment.name}</div>}
      {onRemove && <IconButton icon={X} label="Remove attachment" size={12} onClick={onRemove} />}
    </figure>
  )
}
