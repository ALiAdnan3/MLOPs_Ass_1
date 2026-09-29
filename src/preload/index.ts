import { contextBridge, ipcRenderer } from 'electron'
import type { HomeForgeAPI } from '../shared/api'

const api: HomeForgeAPI = {
  isElectron: true,
  platform: process.platform,
  version: process.env.npm_package_version ?? '1.0.0',
  openProjectDialog: () => ipcRenderer.invoke('hf:open-project'),
  openFileDialog: (filters, multi) => ipcRenderer.invoke('hf:open-files', filters, multi),
  saveDialog: (name, filters, data) => ipcRenderer.invoke('hf:save-dialog', name, filters, data),
  writeFile: (path, data) => ipcRenderer.invoke('hf:write-file', path, data),
  readFile: (path) => ipcRenderer.invoke('hf:read-file', path),
  chooseFolder: () => ipcRenderer.invoke('hf:choose-folder'),
  writeFiles: (folder, files) => ipcRenderer.invoke('hf:write-files', folder, files),
  showInFolder: (path) => ipcRenderer.invoke('hf:show-in-folder', path),
  recent: {
    list: () => ipcRenderer.invoke('hf:recent-list'),
    add: (e) => ipcRenderer.invoke('hf:recent-add', e),
    remove: (p) => ipcRenderer.invoke('hf:recent-remove', p)
  },
  autosave: {
    write: (id, name, data) => ipcRenderer.invoke('hf:autosave-write', id, name, data),
    list: () => ipcRenderer.invoke('hf:autosave-list'),
    read: (id) => ipcRenderer.invoke('hf:autosave-read', id),
    remove: (id) => ipcRenderer.invoke('hf:autosave-remove', id)
  },
  settings: {
    get: () => ipcRenderer.invoke('hf:settings-get'),
    set: (p) => ipcRenderer.invoke('hf:settings-set', p),
    setApiKey: (k) => ipcRenderer.invoke('hf:set-api-key', k)
  },
  ai: (req) => ipcRenderer.invoke('hf:ai', req),
  setTitleBarTheme: (t) => ipcRenderer.send('hf:title-theme', t),
  log: (level, message) => ipcRenderer.send('hf:log', level, message),
  onOpenFile: (cb) => {
    const h = (_e: unknown, p: string) => cb(p)
    ipcRenderer.on('hf:open-file', h)
    ipcRenderer.invoke('hf:pending-open').then((p: string | null) => p && cb(p))
    return () => ipcRenderer.removeListener('hf:open-file', h)
  },
  onBeforeClose: (cb) => {
    ipcRenderer.removeAllListeners('hf:before-close')
    ipcRenderer.on('hf:before-close', async () => {
      try {
        await cb()
      } finally {
        ipcRenderer.send('hf:close-ok')
      }
    })
  }
}

contextBridge.exposeInMainWorld('hf', api)
