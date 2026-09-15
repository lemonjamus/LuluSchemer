// Small pure helpers. Covered by lib.test.ts.

/** Pull checklist / bullet / numbered lines out of an AI response. */
export function parseTaskLines(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(?:\[[ xX]?\]\s*)?(.+?)\s*$/)
    if (m) out.push(m[1].replace(/\*\*/g, ''))
  }
  return out
}

/**
 * Remove <think>…</think> reasoning from a (possibly still streaming) reply.
 * Mid-stream, an unclosed block and a half-arrived "<thi" tag are held back; `final` releases the latter.
 */
export function stripThinking(s: string, final = false): string {
  let out = s.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '')
  if (!final) out = out.replace(/<(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/, '')
  return out.replace(/^\s+/, '')
}

export function relTime(iso: string, from = Date.now()): string {
  const s = Math.round((new Date(iso).getTime() - from) / 1000)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Infinity],
  ]
  let v = s
  for (const [unit, size] of steps) {
    if (Math.abs(v) < size) return unit === 'second' ? 'just now' : rtf.format(Math.round(v), unit)
    v /= size
  }
  return ''
}

export type DueState = 'overdue' | 'today' | 'upcoming' | null

export function dueState(dueDate: string | null, today = new Date()): DueState {
  if (!dueDate) return null
  const t = today.toLocaleDateString('en-CA') // yyyy-mm-dd in local time
  return dueDate < t ? 'overdue' : dueDate === t ? 'today' : 'upcoming'
}

/** Snapshot undo stack. Snapshots are immutable arrays, so storing them is cheap (structural sharing). */
export interface History<T> {
  past: T[]
  future: T[]
}

export const HISTORY_LIMIT = 100

export function record<T>(h: History<T>, before: T): History<T> {
  return { past: [...h.past, before].slice(-HISTORY_LIMIT), future: [] }
}

export function undo<T>(h: History<T>, current: T): [History<T>, T] | null {
  if (!h.past.length) return null
  const prev = h.past[h.past.length - 1]
  return [{ past: h.past.slice(0, -1), future: [current, ...h.future] }, prev]
}

export function redo<T>(h: History<T>, current: T): [History<T>, T] | null {
  if (!h.future.length) return null
  const [next, ...rest] = h.future
  return [{ past: [...h.past, current], future: rest }, next]
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined
  let pending: A | undefined
  const run = (...args: A) => {
    pending = args
    clearTimeout(t)
    t = setTimeout(flush, ms)
  }
  function flush() {
    clearTimeout(t)
    if (pending) fn(...pending)
    pending = undefined
  }
  return Object.assign(run, { flush })
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}
