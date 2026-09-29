/// <reference types="vitest/config" />
// Browser build of the renderer (no Electron). Used for Playwright UI tests and unit tests.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  plugins: [react()],
  worker: { format: 'es' },
  server: { port: 5199, strictPort: true },
  build: { outDir: resolve(__dirname, 'out/web'), emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  test: {
    root: __dirname,
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
