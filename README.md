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
| `src/services/storage.ts` | `Repo<T>` + `FileStorage` interfaces and their IndexedDB implementations. **Supabase swap point.** |
| `src/services/ai.ts` | `AIProvider` interface, Claude provider (via proxy), mock provider |
| `src/services/aiContext.ts` | System prompt from project context, AI action prompts |
| `src/services/screenshot.ts` | Screen Capture API frame grab + crop |
| `src/stores/*` | Zustand stores: projects, tasks, canvas (undo history, autosave), ai, ui/settings |
| `src/components/canvas/*` | Konva stage, object nodes, inline text editor, selection snapshot |
| `src/components/*` | Dashboard, Workspace, AI panel, command palette, snip overlay, settings |
| `src/theme.ts` + `src/styles.css` | Colour tokens and all styling |

## Adding Supabase later

Implement `Repo<T>` (select / upsert / delete on a table) and `FileStorage` (Storage bucket), then swap the objects exported at the bottom of `storage.ts`. The records are already flat and serialisable, with UUIDs and ISO timestamps. Move the `/api/anthropic` proxy into an Edge Function at the same time.

## Known limits

- Screen snips need the browser's share picker each time; that is a browser security rule. Chromium offers the current tab first.
- The eraser is pixel-based (destination-out) and only affects the active layer.
- No touch pinch-zoom or stylus pressure yet. Trackpad pinch and Ctrl+wheel zoom work.
- Deleted images stay in IndexedDB so undo can restore them. They are removed when their project is deleted.
