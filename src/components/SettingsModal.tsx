import { useEffect, useState } from 'react'
import { hasClaudeKey, listLocalModels } from '../services/ai'
import { useSettings, useUI, type ProviderChoice } from '../stores/ui'
import { Modal } from './ui'

const SHORTCUTS: [string, string][] = [
  ['Ctrl/Cmd K', 'Command palette'],
  ['Ctrl/Cmd Z · Shift Z', 'Undo · redo'],
  ['Delete', 'Delete selection'],
  ['Escape', 'Cancel / deselect'],
  ['Space + drag', 'Pan canvas'],
  ['Ctrl + wheel / pinch', 'Zoom'],
  ['V H B E T N K', 'Select, pan, brush, eraser, text, note, task card'],
  ['Enter', 'Edit selected text / note'],
  ['G', 'Toggle snap to grid'],
  ['Drag empty canvas', 'Box select (Shift adds)'],
  ['Ctrl/Cmd C X V D', 'Copy, cut, paste, duplicate'],
  ['Ctrl/Cmd 0', 'Reset zoom'],
]

const STYLE_EXAMPLES = 'e.g. Talk like a blunt senior engineer. No fluff, no apologies. Use British spelling. Swearing is fine. Always end with one question that pushes the idea further.'

export function SettingsModal() {
  const open = useUI((s) => s.settingsOpen)
  const settings = useSettings()
  const [keyFound, setKeyFound] = useState<boolean | null>(null)
  const [localModels, setLocalModels] = useState<string[] | null | undefined>()

  useEffect(() => {
    if (!open) return
    hasClaudeKey().then(setKeyFound)
    listLocalModels().then(setLocalModels, () => setLocalModels(null))
  }, [open])

  return (
    <Modal title="SETTINGS" open={open} onClose={() => useUI.getState().set({ settingsOpen: false })}>
      <div className="settings">
        <h3 className="section-label">AI</h3>
        <label className="field">
          <span>Provider</span>
          <select className="input" value={settings.provider} onChange={(e) => settings.set({ provider: e.target.value as ProviderChoice })}>
            <option value="auto">Auto (Claude if key present, else mock)</option>
            <option value="local">Local (Ollama / LM Studio)</option>
            <option value="claude">Claude</option>
            <option value="mock">Mock (offline development)</option>
          </select>
        </label>

        {settings.provider === 'local' ? (
          <>
            <label className="field">
              <span>Local model</span>
              <select className="input" value={settings.localModel} onChange={(e) => settings.set({ localModel: e.target.value })}>
                <option value="">First available</option>
                {(localModels ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
                {settings.localModel && !localModels?.includes(settings.localModel) && <option value={settings.localModel}>{settings.localModel}</option>}
              </select>
            </label>
            <p className="small muted">
              Local server:{' '}
              {localModels === undefined ? '…' : localModels ? <span className="ok">{localModels.length} model(s) found</span> : <span className="warn">not reachable. Start Ollama, or set LOCAL_AI_URL in .env and restart.</span>}
            </p>
            <label className="field-inline">
              <input type="checkbox" className="check" checked={settings.localThinking} onChange={(e) => settings.set({ localThinking: e.target.checked })} />
              <span>Let the model think before answering (smarter, but ~30× slower on this model)</span>
            </label>
          </>
        ) : (
          <>
            <p className="small muted">
              Claude key on dev server:{' '}
              {keyFound === null ? '…' : keyFound ? <span className="ok">found</span> : <span className="warn">not found. Add ANTHROPIC_API_KEY to .env and restart.</span>}
            </p>
            <label className="field">
              <span>Claude model</span>
              <input className="input" list="models" value={settings.model} onChange={(e) => settings.set({ model: e.target.value })} />
              <datalist id="models">
                <option value="claude-opus-5" />
                <option value="claude-sonnet-5" />
                <option value="claude-haiku-4-5" />
              </datalist>
            </label>
          </>
        )}

        <label className="field-stack">
          <span>Custom instructions (tone, style, persona)</span>
          <textarea
            className="input"
            rows={4}
            placeholder={STYLE_EXAMPLES}
            defaultValue={settings.customInstructions}
            onBlur={(e) => settings.set({ customInstructions: e.target.value })}
          />
          <span className="small muted">Added to every AI request, for any provider. Saved when you click away.</span>
        </label>

        <label className="field-inline">
          <input type="checkbox" className="check" checked={settings.sendContext} onChange={(e) => settings.set({ sendContext: e.target.checked })} />
          <span>Send project context (name, description, tasks, canvas text) with each request</span>
        </label>

        <h3 className="section-label">KEYBOARD</h3>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt><kbd>{k}</kbd></dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="small muted">Data is stored locally in this browser (IndexedDB).</p>
      </div>
    </Modal>
  )
}
