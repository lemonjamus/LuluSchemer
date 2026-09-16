import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const REPO = 'lemonjamus/LuluSchemer'
const HOUR = 60 * 60 * 1000
/** Windows can install silently. macOS cannot without an Apple Developer certificate. */
const canSelfInstall = process.platform === 'win32'

export interface UpdateInfo {
  version: string
  /** true: restart applies it. false: we can only open the download. */
  canInstall: boolean
  url?: string
}

let latest: UpdateInfo | null = null

/** "1.2.10" > "1.2.9" — numeric compare, not string compare. */
function isNewer(candidate: string, current: string) {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const [a, b] = [parse(candidate), parse(current)]
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

export function initUpdater(getWindow: () => BrowserWindow | null) {
  // electron-updater is CommonJS, and reading `autoUpdater` builds it — so do it after the app exists.
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = canSelfInstall
  autoUpdater.autoInstallOnAppQuit = canSelfInstall

  const notify = (info: UpdateInfo) => {
    latest = info
    getWindow()?.webContents.send('update:available', info)
  }

  autoUpdater.on('update-downloaded', (info) => notify({ version: info.version, canInstall: true }))
  autoUpdater.on('error', (e) => console.error('[updater]', e.message))

  /** Ask GitHub directly; used where we cannot install, and as the fallback everywhere. */
  async function checkGithub() {
    // A private repo answers 404 to anonymous callers, so a token is required to see releases.
    const token = process.env.GH_TOKEN
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    })
    if (res.status === 404) {
      // Without a token this is indistinguishable from "private repo, no access" — say so rather
      // than claiming the app is up to date.
      if (!token) throw new Error('No access to releases (is the repository private?)')
      return null // authorised, so it really has no releases yet
    }
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
    const release = (await res.json()) as { tag_name?: string; html_url?: string; assets?: { name: string; browser_download_url: string }[] }
    const version = String(release.tag_name ?? '').replace(/^v/, '')
    if (!version || !isNewer(version, app.getVersion())) return null
    const wanted = process.platform === 'darwin' ? '.dmg' : process.platform === 'win32' ? '.exe' : '.AppImage'
    const asset = release.assets?.find((a) => a.name.endsWith(wanted))
    return { version, canInstall: false, url: asset?.browser_download_url ?? release.html_url }
  }

  /** Resolves with the newest version (or null when current); rejects if the check itself failed. */
  async function check(): Promise<UpdateInfo | null> {
    if (!app.isPackaged) return null // a dev run is never "out of date"
    if (canSelfInstall) {
      try {
        // electron-updater downloads in the background and fires update-downloaded.
        await autoUpdater.checkForUpdates()
        return latest
      } catch (e) {
        // Missing app-update.yml, no network, etc. Fall through: GitHub can still offer a download.
        console.error('[updater] electron-updater:', (e as Error).message)
      }
    }
    const found = await checkGithub()
    if (found) notify(found)
    return latest
  }

  setTimeout(check, 10_000)
  setInterval(check, HOUR)

  ipcMain.handle('update:check', check)
  ipcMain.handle('update:apply', () => {
    if (latest?.canInstall) {
      autoUpdater.quitAndInstall()
      return true
    }
    if (latest?.url) shell.openExternal(latest.url)
    return false
  })
  ipcMain.handle('app:version', () => app.getVersion())
}
