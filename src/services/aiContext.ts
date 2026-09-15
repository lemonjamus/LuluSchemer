import { useCanvas } from '../stores/canvas'
import { useProjects } from '../stores/projects'
import { useTasks } from '../stores/tasks'
import { useSettings } from '../stores/ui'

export type AIAction = 'ask' | 'explain' | 'expand' | 'summarize' | 'tasks' | 'challenge' | 'missing' | 'rewrite' | 'describe'

export const AI_ACTIONS: { id: AIAction; label: string }[] = [
  { id: 'ask', label: 'Ask AI' },
  { id: 'explain', label: 'Explain' },
  { id: 'expand', label: 'Expand idea' },
  { id: 'summarize', label: 'Summarize' },
  { id: 'rewrite', label: 'Rewrite' },
  { id: 'challenge', label: 'Challenge idea' },
  { id: 'missing', label: 'Find missing pieces' },
  { id: 'tasks', label: 'Generate tasks' },
]

const INSTRUCTIONS: Record<AIAction, string> = {
  ask: 'What do you think about this?',
  explain: 'Explain this clearly and concisely.',
  expand: 'Expand this idea into a more developed concept. Keep it structured and tight.',
  summarize: 'Summarize this in a few lines.',
  rewrite: 'Rewrite this to be clearer and sharper. Return only the rewritten text.',
  challenge: 'Challenge this idea: what are the weakest assumptions and risks?',
  missing: 'What is missing from this? List the gaps.',
  tasks: 'Turn this into actionable tasks. Reply with a short checklist, one "- [ ] task" per line, nothing else.',
  describe: 'Describe and analyze this drawing / image.',
}

/** Builds the visible user message for an action. Selection is quoted inline so nothing is hidden. */
export function actionPrompt(action: AIAction, selection?: string): string {
  const head = INSTRUCTIONS[action]
  return selection?.trim() ? `${head}\n\n"""\n${selection.trim()}\n"""` : head
}

const MAX_CONTEXT = 60_000

export function buildSystemPrompt(projectId: string | null, includeContext: boolean): string {
  const base = [
    'You are Lulu, a creative technical collaborator inside LuluSchemer, a visual notebook + project manager.',
    'Be concise by default; expand only when asked. Challenge weak ideas, ask sharp questions, turn vague ideas into structured plans.',
    'When proposing tasks, format them as "- [ ] task" lines so the user can add them in one click.',
    'Plain text output: short headings and "-" bullets are fine; avoid tables.',
  ]
  const style = useSettings.getState().customInstructions.trim()
  if (style) base.push('', "The user's own instructions for how you reply. Where they conflict with the defaults above, follow these:", style)
  if (!includeContext) return base.join('\n')

  const tasks = useTasks.getState().tasks
  if (!projectId) {
    const projects = useProjects.getState().projects.filter((p) => !p.archived)
    base.push('', 'The user is on their dashboard.', `Projects: ${projects.map((p) => p.name).join(', ') || '(none)'}`)
    base.push('Open tasks:', ...tasks.filter((t) => !t.completed).map((t) => `- ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ''}`))
    return clip(base.join('\n'))
  }

  const project = useProjects.getState().projects.find((p) => p.id === projectId)
  const canvas = useCanvas.getState()
  const projectTasks = tasks.filter((t) => t.projectId === projectId)
  const texts = canvas.projectId === projectId
    ? canvas.objects.flatMap((o) => (o.type === 'text' ? [`- text: ${o.text}`] : o.type === 'note' ? [`- ${o.category} note: ${o.text}`] : []))
    : []
  const strokes = canvas.objects.filter((o) => o.type === 'stroke' && !o.erase).length

  base.push(
    '',
    'This conversation belongs to the current project. Use this context when answering.',
    `<project name="${project?.name ?? ''}">`,
    project?.description ? `Description: ${project.description}` : 'Description: (none)',
    'Tasks:',
    ...(projectTasks.length
      ? projectTasks.map((t) => `- [${t.completed ? 'x' : ' '}] ${t.title} (${t.priority}${t.dueDate ? `, due ${t.dueDate}` : ''})`)
      : ['(none)']),
    'Canvas text and notes:',
    ...(texts.length ? texts : ['(none)']),
    `Canvas also has ${strokes} freehand stroke(s) (not visible to you unless a screenshot is attached).`,
    '</project>',
  )
  return clip(base.join('\n'))
}

function clip(s: string) {
  return s.length > MAX_CONTEXT ? `${s.slice(0, MAX_CONTEXT)}\n[project context truncated]` : s
}
