import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
    // tolerate a byte-order mark (files edited by hand on Windows often carry one)
    return JSON.parse((await fs.readFile(join(dir(), file), 'utf8')).replace(/^\uFEFF/, '')) as T
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
interface Stored extends Omit<AppSettings, 'hasApiKey' | 'hasOpenAiKey'> {
  /** A backend being tried: set at start-up, cleared once the window is seen drawing with it. */
  graphicsTrial?: 'opengl' | 'vulkan'
  /** The backend last seen working on this computer. */
  graphicsVerified?: 'opengl' | 'vulkan'
  apiKeyEnc?: string
  /** OpenAI key for AI photos (amendment A9), encrypted like the Claude key. */
  openAiKeyEnc?: string
}
const DEFAULTS: Stored = { theme: 'dark', quality: 'high', uiMode: 'beginner', aiProvider: 'offline', autosaveSeconds: 20, firstRunDone: false }

async function stored(): Promise<Stored> {
  return { ...DEFAULTS, ...(await readJson<Partial<Stored>>('settings.json', {})) }
}
const pub = (s: Stored): AppSettings => {
  const { apiKeyEnc, openAiKeyEnc, graphicsTrial: _t, graphicsVerified: _v, ...rest } = s
  return { ...rest, hasApiKey: !!apiKeyEnc || !!process.env.ANTHROPIC_API_KEY, hasOpenAiKey: !!openAiKeyEnc || !!process.env.OPENAI_API_KEY }
}
function readStoredSync(): Partial<Stored> {
  try {
    return JSON.parse(readFileSync(join(dir(), 'settings.json'), 'utf8').replace(/^\uFEFF/, '')) as Partial<Stored>
  } catch {
    return {}
  }
}
function writeStoredSync(s: Partial<Stored>) {
  try {
    writeFileSync(join(dir(), 'settings.json'), JSON.stringify(s, null, 2), 'utf8')
  } catch {
    /* settings stay as they were */
  }
}

/**
 * The graphics backend to start with (read before the app is ready: command-line switches must be
 * set first). OpenGL or Vulkan can leave the window black or flickering with some drivers, and a
 * black window gives no way back to Settings, so a backend is on trial until the window has been
 * seen drawing with it: if the app is closed or crashes before that, this start goes back to
 * Automatic and says why. `--safe-graphics` always starts with Automatic.
 */
export function graphicsBackendForStartup(safe: boolean): { backend: NonNullable<AppSettings['graphicsBackend']>; trial: boolean } {
  const s = readStoredSync()
  const gb = s.graphicsBackend ?? 'auto'
  if (gb === 'auto') return { backend: 'auto', trial: false }
  if (safe || s.graphicsTrial === gb) {
    // the previous start with this backend never got as far as drawing
    s.graphicsBackend = 'auto'
    delete s.graphicsTrial
    if (!safe) s.graphicsFailed = gb
    writeStoredSync(s)
    return { backend: 'auto', trial: false }
  }
  if (s.graphicsVerified === gb) return { backend: gb, trial: false }
  s.graphicsTrial = gb
  writeStoredSync(s)
  return { backend: gb, trial: true }
}

/** The window was seen drawing with the backend on trial: keep it. */
export async function graphicsConfirm() {
  const s = await stored()
  if (s.graphicsTrial && s.graphicsTrial === s.graphicsBackend) s.graphicsVerified = s.graphicsTrial
  delete s.graphicsTrial
  await writeJson('settings.json', s)
}

/** The backend in use failed: go back to Automatic (applies at the next start). */
export async function graphicsRevert() {
  const s = await stored()
  const gb = s.graphicsBackend
  if (gb && gb !== 'auto') s.graphicsFailed = gb
  if (s.graphicsVerified === gb) delete s.graphicsVerified
  s.graphicsBackend = 'auto'
  delete s.graphicsTrial
  await writeJson('settings.json', s)
}

export async function settingsGet() {
  return pub(await stored())
}
export async function settingsSet(patch: Partial<AppSettings>) {
  const s = await stored()
  const { hasApiKey: _ignored, hasOpenAiKey: _ignored2, ...clean } = patch
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
  return decrypt((await stored()).apiKeyEnc)
}

const encrypt = (key: string) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key).toString('base64') : `plain:${Buffer.from(key).toString('base64')}`)
function decrypt(enc?: string): string | null {
  if (!enc) return null
  try {
    if (enc.startsWith('plain:')) return Buffer.from(enc.slice(6), 'base64').toString('utf8')
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export async function setOpenAiKey(key: string | null) {
  const s = await stored()
  if (!key) delete s.openAiKeyEnc
  else s.openAiKeyEnc = encrypt(key)
  await writeJson('settings.json', s)
  return pub(s)
}
export async function getOpenAiKey(): Promise<string | null> {
  return decrypt((await stored()).openAiKeyEnc)
}

export async function appendLog(level: string, message: string) {
  try {
    await fs.appendFile(join(dir(), 'homeforge.log'), `${new Date().toISOString()} [${level}] ${message}\n`, 'utf8')
  } catch {
    /* logging must never throw */
  }
}
