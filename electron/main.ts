import { app, BrowserWindow, desktopCapturer, session, shell } from 'electron'
import { join } from 'node:path'

import { registerOllamaBridge } from './ollama.js'
import { initUpdater } from './updater.js'

/** Works both from source and from inside the packaged asar. */
const fromRoot = (...parts: string[]) => join(app.getAppPath(), ...parts)

// One window only; a second launch focuses the existing one.
if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null

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
  enableScreenCapture()
  registerOllamaBridge()
  initUpdater(() => win)
  createWindow()

  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
