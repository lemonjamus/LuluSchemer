# LuluSchemer

Private visual workspace: projects, tasks, an infinite canvas (draw / text / notes / task cards / images), and an AI collaborator that sees your project and your screenshots.

## Run

```sh
npm install
cp .env.example .env   # optional: add ANTHROPIC_API_KEY for real AI answers
npm run dev            # http://localhost:5173
```

Without a key the AI panel uses the **mock provider**, which says so in every reply and only echoes what it received. With a key, the Vite dev server proxies `/api/anthropic` and injects the key server-side, so it never reaches the browser bundle. Model and provider are in Settings.

**Local models (Ollama, LM Studio, llama.cpp):** start the server, then pick **Settings → Provider → Local** and choose a model. Requests go through `/api/local`, which points at `LOCAL_AI_URL` (default Ollama, `http://127.0.0.1:11434`), so no CORS setup is needed. "Let the model think" is off by default. Qwen3-style models reply about 30× faster without it.

**Tone:** Settings → Custom instructions is added to the system prompt for every provider.

`npm test` runs the unit tests, `npm run lint` runs oxlint, and `npm run build` typechecks and builds.

## Layout

| Path | What |
| --- | --- |
| `src/models.ts` | Entity types (Project, Task, Canvas, CanvasObject, AIConversation) |
| `src/services/storage.ts` | `Repo<T>` + `FileStorage` interfaces with IndexedDB and Supabase implementations, plus local → account import |
| `src/services/supabase.ts`, `src/stores/auth.ts` | Supabase client, session, sign-in / sign-out |
| `supabase/schema.sql` | Tables, row-level security, private `files` bucket |
| `netlify/edge-functions/anthropic.ts` | Hosted Claude proxy (checks the Supabase session) |
| `src/services/ai.ts` | `AIProvider` interface, Claude provider (via proxy), mock provider |
| `src/services/aiContext.ts` | System prompt from project context, AI action prompts |
| `src/services/screenshot.ts` | Screen Capture API frame grab + crop |
| `src/stores/*` | Zustand stores: projects, tasks, canvas (undo history, autosave), ai, ui/settings |
| `src/components/canvas/*` | Konva stage, object nodes, inline text editor, selection snapshot |
| `src/components/*` | Dashboard, Workspace, AI panel, command palette, snip overlay, settings |
| `src/theme.ts` + `src/styles.css` | Colour tokens and all styling |

## Accounts and sync (Supabase)

1. Create a project at [supabase.com](https://supabase.com). In **SQL Editor**, run `supabase/schema.sql`. It creates the tables, row-level security and a private `files` bucket, and is safe to re-run.
2. In **Project Settings → API Keys**, copy the Project URL and the publishable key into `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Restart `npm run dev` and create your account.
3. In **Authentication → Sign In / Providers**, turn off new sign-ups once your account exists. Otherwise anyone could create an account and use your Claude key through the hosted proxy. `ALLOWED_EMAILS` is a second lock.
4. Settings → Account → **Import to account** copies anything this browser saved before you signed in. It is also offered on first sign-in.

Without the two `VITE_SUPABASE_*` variables the app stays local-only (IndexedDB). Data reloads when you return to the tab. Two devices editing the same canvas at the same moment: the last save wins.

## Deploy to Netlify

1. Push the repo to GitHub and import it in Netlify. Build settings come from `netlify.toml`.
2. In **Site configuration → Environment variables**, add these with scope **All** (Builds and Functions): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `ANTHROPIC_API_KEY`, and optionally `ALLOWED_EMAILS=you@example.com`. Redeploy after changing them.
3. In **Supabase → Authentication → URL Configuration**, set the Site URL to your Netlify URL, so confirmation emails link back to the site.

On the hosted site `netlify/edge-functions/anthropic.ts` takes over from the dev proxy. It only forwards requests from signed-in (and allowed) users.

**Local models on the hosted site:** the browser calls Ollama directly, so Ollama must allow the site. Set the Windows environment variable `OLLAMA_ORIGINS=https://your-site.netlify.app`, restart Ollama, and allow local network access if Chrome asks. This only works on the PC running Ollama; phones can't reach it.

## Known limits

- Screen snips need the browser's share picker each time; that is a browser security rule. Chromium offers the current tab first.
- The eraser is pixel-based (destination-out) and only affects the active layer.
- No touch pinch-zoom or stylus pressure yet. Trackpad pinch and Ctrl+wheel zoom work.
- Deleted images stay in IndexedDB so undo can restore them. They are removed when their project is deleted.
