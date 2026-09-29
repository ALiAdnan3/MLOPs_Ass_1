/** Contract between the Electron main process (via preload) and the renderer. */

export interface FileResult {
  path: string
  name: string
  data: ArrayBuffer
}

export interface RecentProject {
  path: string
  name: string
  openedAt: number
  thumbnail?: string
  plot?: string
}

export interface AutosaveEntry {
  id: string
  name: string
  savedAt: number
  size: number
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system'
  quality: 'low' | 'medium' | 'high' | 'ultra'
  uiMode: 'beginner' | 'advanced'
  aiProvider: 'offline' | 'claude'
  hasApiKey: boolean
  autosaveSeconds: number
  firstRunDone: boolean
}

export type AiTask = 'requirements' | 'edit' | 'exterior' | 'chat'

export interface AiRequest {
  task: AiTask
  text: string
  /** JSON summary of the current house (for edits / chat). */
  context?: string
}

export interface AiResponse {
  ok: boolean
  /** Structured output (task-specific JSON). */
  data?: unknown
  error?: string
  refused?: boolean
  model?: string
}

export interface ExportFile {
  name: string
  data: ArrayBuffer | string
}

export interface HomeForgeAPI {
  isElectron: true
  platform: string
  version: string
  openProjectDialog(): Promise<FileResult | null>
  openFileDialog(filters: { name: string; extensions: string[] }[], multi?: boolean): Promise<FileResult[]>
  saveDialog(defaultName: string, filters: { name: string; extensions: string[] }[], data: ArrayBuffer | string): Promise<string | null>
  writeFile(path: string, data: ArrayBuffer | string): Promise<void>
  readFile(path: string): Promise<FileResult>
  chooseFolder(): Promise<string | null>
  writeFiles(folder: string, files: ExportFile[]): Promise<string[]>
  showInFolder(path: string): Promise<void>
  recent: { list(): Promise<RecentProject[]>; add(entry: RecentProject): Promise<void>; remove(path: string): Promise<void> }
  autosave: { write(id: string, name: string, data: ArrayBuffer): Promise<void>; list(): Promise<AutosaveEntry[]>; read(id: string): Promise<ArrayBuffer | null>; remove(id: string): Promise<void> }
  settings: { get(): Promise<AppSettings>; set(patch: Partial<AppSettings>): Promise<AppSettings>; setApiKey(key: string | null): Promise<AppSettings> }
  ai(req: AiRequest): Promise<AiResponse>
  setTitleBarTheme(theme: 'dark' | 'light'): void
  log(level: 'info' | 'warn' | 'error', message: string): void
  onOpenFile(cb: (path: string) => void): () => void
  onBeforeClose(cb: () => Promise<unknown> | unknown): void
}

declare global {
  interface Window {
    hf?: HomeForgeAPI
  }
}
