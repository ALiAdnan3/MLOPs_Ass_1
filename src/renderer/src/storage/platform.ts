import type { AiRequest, AiResponse, AppSettings, AutosaveEntry, ExportFile, FileResult, HomeForgeAPI, RecentProject } from '../../../shared/api'

/**
 * Platform layer: the Electron preload API when running as the desktop app, or a browser
 * fallback (downloads, file inputs, IndexedDB) so the same UI also runs in a plain browser
 * for automated tests.
 */

const DB = 'homeforge'
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => {
      r.result.createObjectStore('autosave')
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
async function idbOp<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('autosave', mode)
    const req = fn(tx.objectStore('autosave'))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function pickFiles(accept: string, multi = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multi
    input.onchange = () => resolve([...(input.files ?? [])])
    input.click()
  })
}

function download(name: string, data: ArrayBuffer | string) {
  const blob = new Blob([data])
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

const ls = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k)
      return v ? (JSON.parse(v) as T) : d
    } catch {
      return d
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch {
      /* storage may be blocked */
    }
  }
}

const browser: HomeForgeAPI = {
  isElectron: true as const,
  platform: 'web',
  version: '1.0.0',
  async openProjectDialog() {
    const [f] = await pickFiles('.homeforge')
    return f ? { path: f.name, name: f.name, data: await f.arrayBuffer() } : null
  },
  async openFileDialog(filters, multi) {
    const accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',')
    const files = await pickFiles(accept, multi)
    return Promise.all(files.map(async (f): Promise<FileResult> => ({ path: f.name, name: f.name, data: await f.arrayBuffer() })))
  },
  async relaunch() {
    location.reload()
  },
  async saveDialog(name, _filters, data) {
    download(name, data)
    return name
  },
  async writeFile(path, data) {
    download(path.split(/[\\/]/).pop() ?? path, data)
  },
  async readFile(path) {
    throw new Error(`Cannot read ${path} in the browser`)
  },
  async chooseFolder() {
    return 'Downloads'
  },
  async writeFiles(_folder, files: ExportFile[]) {
    for (const f of files) download(f.name, f.data)
    return files.map((f) => f.name)
  },
  async showInFolder() {},
  recent: {
    async list() {
      return ls.get<RecentProject[]>('hf.recent', [])
    },
    async add(e) {
      ls.set('hf.recent', [e, ...ls.get<RecentProject[]>('hf.recent', []).filter((r) => r.path !== e.path)].slice(0, 12))
    },
    async remove(p) {
      ls.set('hf.recent', ls.get<RecentProject[]>('hf.recent', []).filter((r) => r.path !== p))
    }
  },
  autosave: {
    async write(id, name, data) {
      await idbOp('readwrite', (s) => s.put({ id, name, savedAt: Date.now(), data }, id))
    },
    async list() {
      const all = (await idbOp('readonly', (s) => s.getAll())) as { id: string; name: string; savedAt: number; data: ArrayBuffer }[]
      return all.map((a): AutosaveEntry => ({ id: a.id, name: a.name, savedAt: a.savedAt, size: a.data.byteLength })).sort((a, b) => b.savedAt - a.savedAt)
    },
    async read(id) {
      const r = (await idbOp('readonly', (s) => s.get(id))) as { data: ArrayBuffer } | undefined
      return r?.data ?? null
    },
    async remove(id) {
      await idbOp('readwrite', (s) => s.delete(id))
    }
  },
  settings: {
    async get() {
      return { theme: 'dark', quality: 'high', uiMode: 'beginner', aiProvider: 'offline', hasApiKey: false, autosaveSeconds: 20, firstRunDone: false, ...ls.get<Partial<AppSettings>>('hf.settings', {}) }
    },
    async set(patch) {
      const next = { ...(await browser.settings.get()), ...patch }
      ls.set('hf.settings', next)
      return next
    },
    async setApiKey() {
      return browser.settings.get()
    }
  },
  async ai(_req: AiRequest): Promise<AiResponse> {
    return { ok: false, error: 'Claude is available in the desktop app. The built-in assistant is handling this.' }
  },
  setTitleBarTheme() {},
  log(level, message) {
    if (level === 'error') console.error(message)
  },
  onOpenFile() {
    return () => {}
  },
  onBeforeClose() {}
}

const bridge = typeof window !== 'undefined' ? window.hf : undefined
export const platform: HomeForgeAPI = bridge ?? browser
export const isDesktop = !!bridge
