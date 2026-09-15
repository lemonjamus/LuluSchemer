// Real screen capture via the Screen Capture API. Browsers require the user to pick a screen,
// window or tab in the native dialog each time; there is no silent capture. We grab one frame,
// stop the stream immediately, and let the user crop it in SnipOverlay.
import { useUI } from '../stores/ui'

/** Call directly from a click/keypress handler: getDisplayMedia needs a user gesture. */
export async function startSnip() {
  try {
    useUI.getState().set({ paletteOpen: false, snipFrame: await captureFrame() })
  } catch (e) {
    if ((e as Error)?.name !== 'NotAllowedError') useUI.getState().toast(`Screenshot failed: ${(e as Error)?.message ?? e}`, 'error')
  }
}

export async function captureFrame(): Promise<HTMLCanvasElement> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen capture is not supported in this browser.')
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
    preferCurrentTab: true, // Chromium hint: offer this tab first
    selfBrowserSurface: 'include',
  } as DisplayMediaStreamOptions)
  try {
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    await video.play()
    // Wait for the share-picker dialog to vanish from the captured surface.
    await new Promise((r) => setTimeout(r, 300))
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    return canvas
  } finally {
    stream.getTracks().forEach((t) => t.stop())
  }
}

export function cropToBlob(src: HTMLCanvasElement, r: { x: number; y: number; w: number; h: number }): Promise<Blob> {
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(r.w))
  out.height = Math.max(1, Math.round(r.h))
  out.getContext('2d')!.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height)
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Crop failed'))), 'image/png'))
}
