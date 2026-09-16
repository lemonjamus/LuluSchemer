import { useEffect, useState } from 'react'
import type { LuluUpdateInfo } from '../electron'
import { hasClaudeKey, listLocalModels } from '../services/ai'
import { cloud, localDataCounts } from '../services/storage'
import { runLocalImport, useAuth } from '../stores/auth'
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

const isDesktop = typeof window !== 'undefined' && !!window.lulu

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
        {cloud && <AccountSection />}
        <h3 className="section-label">AI</h3>
        <label className="field">
          <span>Provider</span>
          <select className="input" value={settings.provider} onChange={(e) => settings.set({ provider: e.target.value as ProviderChoice })}>
            <option value="auto">{isDesktop ? 'Auto (local model)' : 'Auto (Claude if key present, else mock)'}</option>
            <option value="local">Local (Ollama / LM Studio)</option>
            {!isDesktop && <option value="claude">Claude</option>}
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
            {(isDesktop || !import.meta.env.DEV) && (
              <label className="field">
                <span>Server URL</span>
                <input
                  className="input"
                  defaultValue={settings.localUrl}
                  onBlur={(e) => {
                    settings.set({ localUrl: e.target.value.trim() })
                    setLocalModels(undefined)
                    listLocalModels().then(setLocalModels, () => setLocalModels(null))
                  }}
                />
              </label>
            )}
            <p className="small muted">
              Local server:{' '}
              {localModels === undefined ? '…' : localModels ? <span className="ok">{localModels.length} model(s) found</span> : <span className="warn">{import.meta.env.DEV && !isDesktop ? 'not reachable. Start Ollama, or set LOCAL_AI_URL in .env and restart.' : 'not reachable. Is Ollama running?'}</span>}
            </p>
            <label className="field-inline">
              <input type="checkbox" className="check" checked={settings.localThinking} onChange={(e) => settings.set({ localThinking: e.target.checked })} />
              <span>Let the model think before answering (smarter, but ~30× slower on this model)</span>
            </label>
          </>
        ) : isDesktop ? null : (
          <>
            <p className="small muted">
              Claude key on dev server:{' '}
              {keyFound === null ? '…' : keyFound ? <span className="ok">found</span> : <span className="warn">{import.meta.env.DEV ? 'not found. Add ANTHROPIC_API_KEY to .env and restart.' : 'not set. Add ANTHROPIC_API_KEY in Netlify environment variables.'}</span>}
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
        {isDesktop && <AboutSection />}
        <p className="small muted">{cloud ? 'Data is stored in your Supabase project and syncs across devices.' : 'Data is stored locally in this browser (IndexedDB).'}</p>
      </div>
    </Modal>
  )
}

function AboutSection() {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [found, setFound] = useState<LuluUpdateInfo | null>(null)

  useEffect(() => {
    window.lulu?.version().then(setVersion)
  }, [])

  const check = async () => {
    setStatus('checking…')
    try {
      const info = await window.lulu!.update.check()
      setFound(info)
      setStatus(
        !info ? 'up to date'
          : info.state === 'downloading' ? `version ${info.version} downloading…`
            : info.state === 'ready' ? `version ${info.version} ready` : `version ${info.version} available`,
      )
    } catch (e) {
      setFound(null)
      setStatus(`check failed: ${(e as Error).message.slice(0, 80)}`)
    }
  }

  return (
    <>
      <h3 className="section-label">APP</h3>
      <div className="field-inline account-row">
        <span className="grow">
          LuluSchemer {version} {status && <span className="muted">· {status}</span>}
        </span>
        {found ? (
          <button className="btn btn-sm btn-primary" disabled={found.state === 'downloading'} onClick={() => window.lulu!.update.apply()}>
            {found.state === 'ready' ? 'Relaunch' : found.state === 'downloading' ? 'Downloading…' : 'Download'}
          </button>
        ) : (
          <button className="btn btn-sm" onClick={check}>Check for updates</button>
        )}
      </div>
    </>
  )
}

function AccountSection() {
  const email = useAuth((s) => s.session?.user.email)
  const importStatus = useAuth((s) => s.importStatus)
  const [local, setLocal] = useState<{ projects: number; tasks: number } | null>(null)

  useEffect(() => {
    localDataCounts().then(setLocal, () => setLocal(null))
  }, [])

  return (
    <>
      <h3 className="section-label">ACCOUNT</h3>
      <div className="field-inline account-row">
        <span className="grow">Signed in as <strong>{email}</strong></span>
        <button className="btn btn-sm" onClick={() => useAuth.getState().signOut()}>Sign out</button>
      </div>
      {local && (local.projects > 0 || local.tasks > 0) && (
        <div className="field-inline account-row">
          <span className="grow">This browser has {local.projects} project(s) and {local.tasks} task(s) saved from before sign-in.</span>
          <button className="btn btn-sm btn-primary" disabled={!!importStatus} onClick={() => runLocalImport()}>
            {importStatus ?? 'Import to account'}
          </button>
        </div>
      )}
    </>
  )
}
