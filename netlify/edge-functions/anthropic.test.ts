import { afterEach, expect, test, vi } from 'vitest'
import handler from './anthropic'

const ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: 'sk-real',
  VITE_SUPABASE_URL: 'https://proj.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  ALLOWED_EMAILS: 'me@example.com',
}
vi.stubGlobal('Netlify', { env: { get: (k: string) => ENV[k] } })
afterEach(() => vi.unstubAllGlobals())

const call = (headers: Record<string, string> = {}) =>
  handler(new Request('https://site.netlify.app/api/anthropic/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' }))

function mockFetch(email: string | null) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/auth/v1/user')) {
      const auth = new Headers(init?.headers).get('authorization')
      return email && auth === 'Bearer good' ? Response.json({ email }) : new Response('bad jwt', { status: 401 })
    }
    return new Response('data: ok\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
  })
  vi.stubGlobal('Netlify', { env: { get: (k: string) => ENV[k] } })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

test('rejects requests without a valid Supabase session', async () => {
  const fetchMock = mockFetch('me@example.com')
  expect((await call()).status).toBe(401)
  expect((await call({ 'x-supabase-token': 'bad' })).status).toBe(401)
  expect(fetchMock.mock.calls.some(([u]) => String(u).includes('api.anthropic.com'))).toBe(false)
})

test('rejects signed-in users not on ALLOWED_EMAILS', async () => {
  mockFetch('stranger@example.com')
  expect((await call({ 'x-supabase-token': 'good' })).status).toBe(403)
})

test('forwards allowed users to Anthropic with the server key, never the client token', async () => {
  const fetchMock = mockFetch('me@example.com')
  const res = await call({ 'x-supabase-token': 'good', 'x-api-key': 'placeholder', 'anthropic-version': '2023-06-01' })
  expect(res.status).toBe(200)
  expect(await res.text()).toBe('data: ok\n\n')
  const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('api.anthropic.com'))!
  const sent = new Headers(init?.headers)
  expect(String(url)).toBe('https://api.anthropic.com/v1/messages')
  expect(sent.get('x-api-key')).toBe('sk-real')
  expect(sent.get('anthropic-version')).toBe('2023-06-01')
  expect(sent.get('x-supabase-token')).toBeNull()
})
