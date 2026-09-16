import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// VS Code's terminal sets this, which makes electron.exe run as plain Node and the app crash.
delete process.env.ELECTRON_RUN_AS_NODE

// The renderer is this repo's existing Vite app (index.html + src at the project root).
// base './' matters: the packaged app loads index.html from disk, not from a server.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: { entry: 'electron/main.ts' },
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: { entry: 'electron/preload.ts' },
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    root: '.',
    base: './',
    envPrefix: ['VITE_'],
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      minify: 'esbuild', // electron-vite leaves the renderer unminified otherwise
      rollupOptions: { input: 'index.html' },
    },
  },
})
