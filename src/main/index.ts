import { app, BrowserWindow, dialog, ipcMain, shell, nativeTheme, screen } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { ExportFile, FileResult } from '../shared/api'
import { runAi } from './ai'
import { runAiImage } from './aiImage'
import * as store from './storage'

/**
 * HomeForge AI — Electron main process: window chrome, file system, autosave, settings and the
 * optional Claude proxy. All house logic runs in the renderer.
 */

let win: BrowserWindow | null = null
let pendingOpen: string | null = null
let allowClose = false

const DARK = { color: '#08101D', symbolColor: '#C9D4E5' }
const LIGHT = { color: '#E9EEF5', symbolColor: '#24344A' }

function fileArg(argv: string[]) {
  return argv.find((a) => a.toLowerCase().endsWith('.homeforge'))
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  win = new BrowserWindow({
    width: Math.min(1600, Math.round(width * 0.92)),
    height: Math.min(1000, Math.round(height * 0.92)),
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#1A1C1F',
    title: 'HomeForge AI',
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...DARK, height: 56 },
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('close', (e) => {
    if (allowClose || !win) return
    e.preventDefault()
    win.webContents.send('hf:before-close')
    // renderer answers with hf:close-ok (after autosave) — fall back after 4 s
    setTimeout(() => {
      allowClose = true
      win?.close()
    }, 4000)
  })
  win.webContents.on('render-process-gone', async (_e, details) => {
    await store.appendLog('error', `renderer gone: ${details.reason}`)
    if (details.reason !== 'clean-exit' && win) {
      const r = await dialog.showMessageBox(win, {
        type: 'error',
        title: 'HomeForge AI stopped responding',
        message: 'The design view crashed.',
        detail: 'Your work is autosaved every few seconds. Reload to continue from the last autosave.',
        buttons: ['Reload', 'Quit']
      })
      if (r.response === 0) win.reload()
      else app.quit()
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  if (process.env.HF_SMOKE) {
    // automated smoke test: capture a screenshot once the app has rendered, then quit
    win.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        const img = await win!.webContents.capturePage()
        await fs.writeFile(process.env.HF_SMOKE!, img.toPNG())
        allowClose = true
        app.quit()
      }, Number(process.env.HF_SMOKE_DELAY ?? 6000))
    )
  }
}

const toArrayBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
async function readResult(path: string): Promise<FileResult> {
  const b = await fs.readFile(path)
  return { path, name: basename(path), data: toArrayBuffer(b) }
}
const toBuffer = (d: ArrayBuffer | string) => (typeof d === 'string' ? Buffer.from(d, 'utf8') : Buffer.from(new Uint8Array(d)))

function registerIpc() {
  ipcMain.handle('hf:open-project', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Open project', filters: [{ name: 'HomeForge project', extensions: ['homeforge'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    return readResult(r.filePaths[0])
  })
  ipcMain.handle('hf:open-files', async (_e, filters: { name: string; extensions: string[] }[], multi?: boolean) => {
    const r = await dialog.showOpenDialog(win!, { filters, properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] })
    if (r.canceled) return []
    return Promise.all(r.filePaths.map(readResult))
  })
  ipcMain.handle('hf:save-dialog', async (_e, defaultName: string, filters: { name: string; extensions: string[] }[], data: ArrayBuffer | string) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters })
    if (r.canceled || !r.filePath) return null
    await fs.writeFile(r.filePath, toBuffer(data))
    return r.filePath
  })
  ipcMain.handle('hf:write-file', async (_e, path: string, data: ArrayBuffer | string) => {
    const tmp = `${path}.saving`
    await fs.writeFile(tmp, toBuffer(data))
    await fs.rename(tmp, path)
  })
  ipcMain.handle('hf:read-file', (_e, path: string) => readResult(path))
  ipcMain.handle('hf:choose-folder', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose export folder', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('hf:write-files', async (_e, folder: string, files: ExportFile[]) => {
    const out: string[] = []
    for (const f of files) {
      const p = join(folder, f.name.replace(/[<>:"|?*]/g, '_'))
      await fs.writeFile(p, toBuffer(f.data))
      out.push(p)
    }
    return out
  })
  ipcMain.handle('hf:show-in-folder', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('hf:recent-list', () => store.recentList())
  ipcMain.handle('hf:recent-add', (_e, entry) => store.recentAdd(entry))
  ipcMain.handle('hf:recent-remove', (_e, p: string) => store.recentRemove(p))
  ipcMain.handle('hf:autosave-write', (_e, id: string, name: string, data: ArrayBuffer) => store.autosaveWrite(id, name, data))
  ipcMain.handle('hf:autosave-list', () => store.autosaveList())
  ipcMain.handle('hf:autosave-read', (_e, id: string) => store.autosaveRead(id))
  ipcMain.handle('hf:autosave-remove', (_e, id: string) => store.autosaveRemove(id))
  ipcMain.handle('hf:settings-get', () => store.settingsGet())
  ipcMain.handle('hf:relaunch', () => {
    // the normal close path autosaves first; the new instance starts once this one has gone
    app.relaunch()
    win?.close()
  })
  ipcMain.handle('hf:settings-set', (_e, patch) => store.settingsSet(patch))
  ipcMain.handle('hf:set-api-key', (_e, key: string | null) => store.setApiKey(key))
  ipcMain.handle('hf:ai', async (_e, req) => runAi(await store.getApiKey(), req))
  ipcMain.handle('hf:set-openai-key', (_e, key: string | null) => store.setOpenAiKey(key))
  ipcMain.handle('hf:ai-image', async (_e, req) => {
    const s = await store.settingsGet()
    return runAiImage(await store.getOpenAiKey(), s.imageModel ?? 'gpt-image-2', s.imageQuality ?? 'high', req)
  })
  ipcMain.on('hf:title-theme', (_e, theme: 'dark' | 'light') => {
    try {
      win?.setTitleBarOverlay({ ...(theme === 'dark' ? DARK : LIGHT), height: 56 })
      win?.setBackgroundColor(theme === 'dark' ? DARK.color : LIGHT.color)
    } catch {
      /* not supported on this platform */
    }
  })
  ipcMain.on('hf:log', (_e, level: string, message: string) => store.appendLog(level, message))
  ipcMain.on('hf:close-ok', () => {
    allowClose = true
    win?.close()
  })
  ipcMain.handle('hf:pending-open', () => {
    const p = pendingOpen
    pendingOpen = null
    return p
  })
}

// graphics backend (amendment A6): Direct3D by default; OpenGL or Vulkan when the user chose it,
// which the photoreal path tracer needs on Windows
{
  const gb = store.graphicsBackendSync()
  if (gb === 'opengl') app.commandLine.appendSwitch('use-angle', 'gl')
  else if (gb === 'vulkan') app.commandLine.appendSwitch('use-angle', 'vulkan')
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  app.on('second-instance', (_e, argv) => {
    const f = fileArg(argv)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      if (f) win.webContents.send('hf:open-file', f)
    }
  })
  pendingOpen = fileArg(process.argv) ?? null
  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark'
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  process.on('uncaughtException', (err) => store.appendLog('error', `main: ${err.stack ?? err}`))
}
