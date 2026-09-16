# LuluSchemer

Private visual workspace: projects, tasks, an infinite canvas (draw / text / notes / task cards / images), and an AI collaborator that sees your project and your screenshots. Runs as a Windows desktop app; your account and data live in Supabase, so any machine you sign in on shows the same workspace.

## Run

```sh
npm install
cp .env.example .env   # add your Supabase URL + publishable key
npm run dev:app        # the desktop app (Electron)
npm run dev            # browser-only, for quick UI work
```

`npm test` runs the unit tests, `npm run lint` runs oxlint, `npm run build` type-checks and builds the web renderer, `npm run build:app` builds the whole desktop app into `out/`.

If you ever start Electron by hand rather than through these scripts, clear `ELECTRON_RUN_AS_NODE` first — VS Code's terminal sets it, and it makes `electron.exe` run as plain Node, so the app dies with "Cannot read properties of undefined (reading 'requestSingleInstanceLock')". The npm scripts already handle this.

## AI

The desktop app talks to a **local model** (Ollama, LM Studio, llama.cpp) through its own process, so there is no CORS setup, no `OLLAMA_ORIGINS`, and no local-network prompt — it just works while Ollama is running.

- Settings → Provider → **Local**, then pick a model. Server URL defaults to `http://127.0.0.1:11434`.
- "Let the model think" is off by default; Qwen3-style models answer roughly 30× faster without it.
- Settings → **Custom instructions** is added to every request, so you can set tone and persona.
- Claude still works in `npm run dev` (browser) if `ANTHROPIC_API_KEY` is in `.env`; it is hidden in the desktop app, which has no server to keep the key.

## Accounts and sync (Supabase)

1. Create a project at [supabase.com](https://supabase.com) and run `supabase/schema.sql` in its SQL Editor (tables, row-level security, private `files` bucket; safe to re-run).
2. Copy the Project URL and publishable key into `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Create your account in the app, confirm the email, then turn **off** new sign-ups in Supabase → Authentication → Sign In / Providers.
4. Settings → Account → **Import to account** copies anything a browser saved before sign-in.

Without those two variables the app runs local-only (IndexedDB) and shows a yellow LOCAL badge. Data reloads when the window regains focus; if two devices edit the same canvas at once, the last save wins. Session tokens are stored unencrypted in the app's profile folder — fine for personal use.

## Releases and updates

Versions are published as GitHub Releases and the app checks for them 10 seconds after launch, hourly, and from Settings → APP → Check for updates.

- **Windows:** the new installer downloads in the background; a "Update x.y.z is ready · Relaunch" toast appears; clicking it restarts into the new version. No code-signing certificate needed — Windows SmartScreen only warns on the first manual install ("More info → Run anyway").
- **macOS:** Apple refuses to apply updates to apps without a Developer ID certificate, so the toast offers **Download** and you drag the new app over the old one. A $99/year Apple membership would enable the silent flow.

To publish a release:

```sh
npm version patch          # or minor / major
git push --follow-tags     # the tag triggers .github/workflows/release.yml
```

The workflow builds the Windows installer on a Windows runner and the macOS `.dmg`s (Apple Silicon and Intel) on a macOS runner, and uploads them to the same GitHub Release along with the `latest.yml` / `latest-mac.yml` manifests the updater reads. A `.dmg` cannot be built on Windows, which is why this runs in CI.

**One-time setup:** under Settings → Secrets and variables → Actions, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. They are compiled into the app at build time; without them the released apps run local-only with no sign-in. Nothing else is needed — the workflow's `GITHUB_TOKEN` is provided automatically.

To build locally instead: `GH_TOKEN=<token with repo scope> npm run release:win` (or `release:mac` on a Mac).

## Layout

| Path | What |
| --- | --- |
| `electron/main.ts` | Window, screen-capture permission, single instance |
| `electron/ollama.ts` | Local-model calls and streaming, made from the app process |
| `electron/updater.ts` | Version check (GitHub Releases) and install / download |
| `electron/preload.ts`, `src/electron.d.ts` | The only bridge the page can use, and its types |
| `electron.vite.config.ts`, `electron-builder.yml` | Build and packaging config |
| `src/models.ts` | Entity types (Project, Task, Canvas, CanvasObject, AIMessage) |
| `src/services/storage.ts` | `Repo<T>` + `FileStorage` with IndexedDB and Supabase implementations, plus local → account import |
| `src/services/supabase.ts`, `src/stores/auth.ts` | Supabase client, session, sign-in / sign-out |
| `src/services/ai.ts` | Provider interface, local (Ollama) provider, Claude provider, mock provider |
| `src/services/aiContext.ts` | System prompt from project context, AI action prompts |
| `src/services/screenshot.ts` | Screen capture and cropping for the snip tool |
| `src/stores/*` | Zustand stores: projects, tasks, canvas (undo history, autosave), ai, ui/settings |
| `src/components/canvas/*` | Konva stage, object nodes, inline text editor, selection snapshot |
| `supabase/schema.sql` | Tables, row-level security, private `files` bucket |

## Known limits

- Screen snips capture a whole screen; crop in the overlay that follows.
- The eraser is pixel-based and only affects the active layer.
- No touch pinch-zoom or stylus pressure; trackpad pinch and Ctrl+wheel zoom work.
- Deleted images stay in storage so undo can restore them; they are removed with their project.
