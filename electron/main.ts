import { app, BrowserWindow, desktopCapturer, session, shell } from 'electron'
import { join, resolve } from 'node:path'

import { registerOllamaBridge } from './ollama.js'
import { initUpdater } from './updater.js'

/** Works both from source and from inside the packaged asar. */
const fromRoot = (...parts: string[]) => join(app.getAppPath(), ...parts)

// One window only; a second launch focuses the existing one. Required for deep links:
// on Windows the link starts a second instance and arrives in its command line.
if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null

export const DEEP_LINK_SCHEME = 'luluschemer'
/** A link that arrived before the window existed, replayed once it is ready. */
let pendingDeepLink: string | null = null

function registerProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    // Running via the electron binary (npm run dev:app) — Windows needs the entry path.
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
  }
}

function handleDeepLink(url: string | undefined) {
  if (!url?.startsWith(`${DEEP_LINK_SCHEME}://`)) return
  if (win) win.webContents.send('deep-link', url)
  else pendingDeepLink = url
  if (win?.isMinimized()) win.restore()
  win?.focus()
}

// macOS delivers links here, and the listener must exist before the app is ready.
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0B0A0F',
    autoHideMenuBar: true,
    title: 'LuluSchemer',
    webPreferences: { preload: fromRoot('out/preload/index.cjs') },
  })

  win.on('ready-to-show', () => win?.show())
  win.webContents.on('did-finish-load', () => {
    if (!pendingDeepLink) return
    win?.webContents.send('deep-link', pendingDeepLink)
    pendingDeepLink = null
  })
  win.on('closed', () => (win = null))
  // Links (Supabase confirmation pages, release downloads) open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(fromRoot('out/renderer/index.html'))
}

/** The snip tool calls getDisplayMedia; Electron needs the app to grant a source. */
function enableScreenCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
        const screen = sources.find((s) => s.display_id) ?? sources[0]
        callback(screen ? { video: screen } : {})
      } catch {
        callback({}) // user sees "Screenshot failed" in the app
      }
    },
    { useSystemPicker: true }, // Windows 11 / macOS picker when available
  )
}

app.whenReady().then(() => {
  registerProtocol()
  handleDeepLink(process.argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`))) // cold start
  enableScreenCapture()
  registerOllamaBridge()
  initUpdater(() => win)
  createWindow()

  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

// Windows/Linux: a deep link launches a second instance with the URL in its command line.
app.on('second-instance', (_event, argv) => {
  handleDeepLink(argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`)))
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
