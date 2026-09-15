import type { NoteCategory, Priority } from './models'

// Single source for accent colours: pushed into CSS variables at startup, read directly by the canvas.
export const accents = {
  purple: '#A855F7',
  'purple-bright': '#C084FC',
  'purple-electric': '#D946EF',
  cyan: '#22D3EE',
  green: '#4ADE80',
  yellow: '#FACC15',
  pink: '#F472B6',
  orange: '#FB923C',
}

export const surfaces = {
  bg: '#0B0A0F',
  surface: '#121018',
  surface2: '#181520',
  elevated: '#211C2A',
  border: '#30283A',
  text: '#FFFFFF',
  text2: '#B8B2C2',
  muted: '#716A7C',
}

export function applyTheme() {
  const root = document.documentElement.style
  for (const [k, v] of Object.entries(accents)) root.setProperty(`--${k}`, v)
}

export const PROJECT_COLORS = [accents.purple, accents['purple-electric'], accents.cyan, accents.green, accents.yellow, accents.pink, accents.orange]

export const BRUSH_COLORS = ['#FFFFFF', accents.purple, accents['purple-bright'], accents.cyan, accents.green, accents.yellow, accents.pink, accents.orange, surfaces.muted]

export const CATEGORY: Record<NoteCategory, { label: string; color: string }> = {
  idea: { label: 'IDEA', color: accents.pink },
  reminder: { label: 'REMINDER', color: accents.yellow },
  research: { label: 'RESEARCH', color: accents.cyan },
  question: { label: 'QUESTION', color: accents['purple-bright'] },
  reference: { label: 'REFERENCE', color: accents.cyan },
  warning: { label: 'WARNING', color: accents.orange },
  task: { label: 'TASK', color: accents.green },
}

export const PRIORITY: Record<Priority, { label: string; color: string }> = {
  low: { label: 'low', color: surfaces.muted },
  normal: { label: 'normal', color: surfaces.text2 },
  high: { label: 'high', color: accents.yellow },
  urgent: { label: 'urgent', color: accents.orange },
}

export const FONT = '"Fantasque Sans Mono", ui-monospace, "Cascadia Mono", Consolas, monospace'
