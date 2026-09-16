// Claude proxy for the hosted site (the Vite dev server does this job locally).
// Only signed-in LuluSchemer users get through; the Anthropic key never reaches the browser.
// Netlify env vars (scope must include Functions): ANTHROPIC_API_KEY, VITE_SUPABASE_URL,
// VITE_SUPABASE_PUBLISHABLE_KEY, optional ALLOWED_EMAILS (comma-separated).

declare const Netlify: { env: { get(key: string): string | undefined } }

const env = (key: string) => Netlify.env.get(key)

const fail = (status: number, message: string) =>
  Response.json({ type: 'error', error: { type: 'proxy_error', message } }, { status })

/** Asks Supabase Auth whether the token is a live session; returns the user or null. */
async function verifyUser(token: string | null): Promise<{ email?: string } | null> {
  const base = env('VITE_SUPABASE_URL')
  const key = env('VITE_SUPABASE_PUBLISHABLE_KEY')
  if (!token || !base || !key) return null
  const res = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } })
  return res.ok ? res.json() : null
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const apiKey = env('ANTHROPIC_API_KEY')
  if (url.pathname === '/api/ai-status') return Response.json({ claude: !!apiKey })

  const path = url.pathname.replace(/^\/api\/anthropic/, '')
  if (req.method !== 'POST' || !path.startsWith('/v1/messages')) return new Response('Not found', { status: 404 })
  if (!apiKey) return fail(500, 'ANTHROPIC_API_KEY is not set in the Netlify environment variables.')

  const user = await verifyUser(req.headers.get('x-supabase-token'))
  if (!user) return fail(401, 'Sign in to use Claude.')
  const allowed = env('ALLOWED_EMAILS')?.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (allowed?.length && !allowed.includes(user.email?.toLowerCase() ?? '')) return fail(403, 'This account is not allowed to use Claude.')

  const headers = new Headers({ 'x-api-key': apiKey })
  for (const [k, v] of req.headers) if (k.startsWith('anthropic-') || k === 'content-type' || k === 'accept') headers.set(k, v)

  const upstream = await fetch(`https://api.anthropic.com${path}${url.search}`, { method: 'POST', headers, body: await req.arrayBuffer() })
  const out = new Headers(upstream.headers)
  out.delete('content-encoding') // fetch already decoded the body
  out.delete('content-length')
  return new Response(upstream.body, { status: upstream.status, headers: out }) // streams SSE through
}
