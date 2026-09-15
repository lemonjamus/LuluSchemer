import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useUI } from '../stores/ui'

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
  active?: boolean
  shortcut?: string
  tipSide?: 'bottom' | 'right' | 'left' | 'top'
  size?: number
}

export function IconButton({ icon: Icon, label, active, shortcut, tipSide = 'bottom', size = 16, className = '', ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      data-tip={shortcut ? `${label}  ${shortcut}` : label}
      data-tip-side={tipSide}
      className={`icon-btn ${active ? 'is-active' : ''} ${className}`}
      {...rest}
    >
      <Icon size={size} strokeWidth={1.75} />
    </button>
  )
}

export type MenuItem =
  | { label: string; onSelect: () => void; icon?: LucideIcon; swatch?: string; shortcut?: string; danger?: boolean; accent?: boolean; disabled?: boolean }
  | 'sep'

export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect()
    setPos({ x: Math.min(x, innerWidth - r.width - 8), y: Math.min(y, innerHeight - r.height - 8) })
    ref.current!.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y])

  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const btns = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const i = btns.indexOf(document.activeElement as HTMLButtonElement)
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === 'sep' ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            className={`menu-item ${item.danger ? 'is-danger' : ''} ${item.accent ? 'is-accent' : ''}`}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.icon ? (
              <item.icon size={14} strokeWidth={1.75} />
            ) : (
              <span className="menu-icon-gap" style={item.swatch ? { background: item.swatch, borderRadius: 3 } : undefined} />
            )}
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  )
}

export function Modal({ title, open, onClose, children, className = '' }: { title: string; open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current!
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className={`modal ${className}`} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      {open && (
        <>
          <header className="panel-head">
            <span>{title}</span>
            <IconButton icon={X} label="Close" onClick={onClose} />
          </header>
          {children}
        </>
      )}
    </dialog>
  )
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismiss)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast is-${t.kind}`}>
          <span>{t.message}</span>
          {t.action && (
            <button className="btn btn-ghost" onClick={() => { t.action!.run(); dismiss(t.id) }}>
              {t.action.label}
            </button>
          )}
          <IconButton icon={X} label="Dismiss" onClick={() => dismiss(t.id)} size={14} />
        </div>
      ))}
    </div>
  )
}
