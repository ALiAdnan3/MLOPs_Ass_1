import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, AutosaveEntry, RecentProject } from '../shared/api'

/** Local, offline-first storage in the user's app-data folder (§2, §37). */

const dir = () => {
  const d = app.getPath('userData')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}
const autosaveDir = () => {
  const d = join(dir(), 'autosave')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(join(dir(), file), 'utf8')) as T
  } catch {
    return fallback
  }
}
async function writeJson(file: string, data: unknown) {
  const p = join(dir(), file)
  const tmp = `${p}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, p)
}

// ── recent projects ─────────────────────────────────────────────────────────
export async function recentList(): Promise<RecentProject[]> {
  const list = await readJson<RecentProject[]>('recent.json', [])
  return list.filter((r) => existsSync(r.path)).slice(0, 12)
}
export async function recentAdd(entry: RecentProject) {
  const list = (await readJson<RecentProject[]>('recent.json', [])).filter((r) => r.path !== entry.path)
  list.unshift(entry)
  await writeJson('recent.json', list.slice(0, 20))
}
export async function recentRemove(path: string) {
  const list = (await readJson<RecentProject[]>('recent.json', [])).filter((r) => r.path !== path)
  await writeJson('recent.json', list)
}

// ── autosave ────────────────────────────────────────────────────────────────
const safeId = (id: string) => id.replace(/[^a-z0-9_-]/gi, '_')
export async function autosaveWrite(id: string, name: string, data: ArrayBuffer) {
  const base = join(autosaveDir(), safeId(id))
  await fs.writeFile(`${base}.homeforge.tmp`, Buffer.from(data))
  await fs.rename(`${base}.homeforge.tmp`, `${base}.homeforge`)
  await fs.writeFile(`${base}.json`, JSON.stringify({ id, name, savedAt: Date.now() }), 'utf8')
}
export async function autosaveList(): Promise<AutosaveEntry[]> {
  const files = await fs.readdir(autosaveDir())
  const out: AutosaveEntry[] = []
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    try {
      const meta = JSON.parse(await fs.readFile(join(autosaveDir(), f), 'utf8'))
      const st = await fs.stat(join(autosaveDir(), f.replace(/\.json$/, '.homeforge')))
      out.push({ id: meta.id, name: meta.name, savedAt: meta.savedAt, size: st.size })
    } catch {
      /* skip broken entries */
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}
export async function autosaveRead(id: string): Promise<ArrayBuffer | null> {
  try {
    const b = await fs.readFile(join(autosaveDir(), `${safeId(id)}.homeforge`))
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  } catch {
    return null
  }
}
export async function autosaveRemove(id: string) {
  for (const ext of ['.homeforge', '.json']) await fs.rm(join(autosaveDir(), `${safeId(id)}${ext}`), { force: true })
}

// ── settings & API key ──────────────────────────────────────────────────────
interface Stored extends Omit<AppSettings, 'hasApiKey'> {
  apiKeyEnc?: string
}
const DEFAULTS: Stored = { theme: 'dark', quality: 'high', uiMode: 'beginner', aiProvider: 'offline', autosaveSeconds: 20, firstRunDone: false }

async function stored(): Promise<Stored> {
  return { ...DEFAULTS, ...(await readJson<Partial<Stored>>('settings.json', {})) }
}
const pub = (s: Stored): AppSettings => {
  const { apiKeyEnc, ...rest } = s
  return { ...rest, hasApiKey: !!apiKeyEnc || !!process.env.ANTHROPIC_API_KEY }
}
/** Read before the app is ready: command-line switches must be set before start-up. */
export function graphicsBackendSync(): AppSettings['graphicsBackend'] {
  try {
    return (JSON.parse(readFileSync(join(dir(), 'settings.json'), 'utf8')) as Partial<Stored>).graphicsBackend ?? 'auto'
  } catch {
    return 'auto'
  }
}

export async function settingsGet() {
  return pub(await stored())
}
export async function settingsSet(patch: Partial<AppSettings>) {
  const s = await stored()
  const { hasApiKey: _ignored, ...clean } = patch
  const next = { ...s, ...clean }
  await writeJson('settings.json', next)
  return pub(next)
}
export async function setApiKey(key: string | null) {
  const s = await stored()
  if (!key) delete s.apiKeyEnc
  else s.apiKeyEnc = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key).toString('base64') : `plain:${Buffer.from(key).toString('base64')}`
  if (key) s.aiProvider = 'claude'
  await writeJson('settings.json', s)
  return pub(s)
}
export async function getApiKey(): Promise<string | null> {
  const s = await stored()
  if (!s.apiKeyEnc) return null
  try {
    if (s.apiKeyEnc.startsWith('plain:')) return Buffer.from(s.apiKeyEnc.slice(6), 'base64').toString('utf8')
    return safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64'))
  } catch {
    return null
  }
}

export async function appendLog(level: string, message: string) {
  try {
    await fs.appendFile(join(dir(), 'homeforge.log'), `${new Date().toISOString()} [${level}] ${message}\n`, 'utf8')
  } catch {
    /* logging must never throw */
  }
}
