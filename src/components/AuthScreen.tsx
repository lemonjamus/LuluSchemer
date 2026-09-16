import { useState } from 'react'
import logo from '../assets/lulu-logo.png'
import { useAuth } from '../stores/auth'

export function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const auth = useAuth.getState()
    setMessage(await (mode === 'signin' ? auth.signIn(email, password) : auth.signUp(email, password)))
    setBusy(false)
  }

  return (
    <div className="auth dotgrid">
      <form className="auth-card" onSubmit={submit}>
        <img src={logo} alt="" className="auth-logo" />
        <h1 className="auth-title brand-name">LuluSchemer</h1>
        <label className="field-stack">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field-stack">
          <span>Password</span>
          <input
            className="input"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {message && <p className="auth-message" role="alert">{message}</p>}
        <button className="btn btn-primary auth-submit" disabled={busy}>
          {busy ? '…' : mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setMessage(null)
          }}
        >
          {mode === 'signin' ? 'No account yet? Create one' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
