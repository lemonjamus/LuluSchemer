import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The Anthropic key lives only in .env (no VITE_ prefix, so it never reaches the bundle).
// The dev/preview server proxies /api/anthropic and injects the key server-side.
// ponytail: dev-server proxy is the "backend"; move to a Supabase Edge Function when deploying.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const key = env.ANTHROPIC_API_KEY ?? ''
  const proxy = {
    // Any OpenAI-compatible local server (Ollama, LM Studio, llama.cpp). Proxied so no CORS setup is needed.
    '/api/local': {
      // Node resolves "localhost" to IPv6 ::1, but Ollama listens on IPv4 only.
      target: (env.LOCAL_AI_URL || 'http://127.0.0.1:11434').replace('//localhost', '//127.0.0.1'),
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/api\/local/, ''),
    },
    '/api/anthropic': {
      target: 'https://api.anthropic.com',
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/api\/anthropic/, ''),
      headers: { 'x-api-key': key },
    },
  }
  return {
    plugins: [
      react(),
      {
        name: 'ai-status',
        configureServer(server) {
          server.middlewares.use('/api/ai-status', (_req, res) => res.end(JSON.stringify({ claude: !!key })))
        },
        configurePreviewServer(server) {
          server.middlewares.use('/api/ai-status', (_req, res) => res.end(JSON.stringify({ claude: !!key })))
        },
      },
    ],
    server: { proxy },
    preview: { proxy },
  }
})
