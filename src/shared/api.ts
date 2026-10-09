import type { AiImageRequest, AiImageResponse, ImageModelId, ImageQuality } from './aiImage'
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
  /** An OpenAI key is saved for AI photos (amendment A9). */
  hasOpenAiKey?: boolean
  /** GPT Image model and quality for AI photos. */
  imageModel?: ImageModelId
  imageQuality?: ImageQuality
  /** ANGLE backend on Windows (amendment A6): 'auto' keeps Direct3D; the path tracer needs OpenGL or Vulkan. Applied at start-up. */
  graphicsBackend?: 'auto' | 'opengl' | 'vulkan'
  autosaveSeconds: number
  firstRunDone: boolean
}

export type AiTask = 'requirements' | 'edit' | 'exterior' | 'chat' | 'readPlan'

export interface AiRequest {
  task: AiTask
  text: string
  /** JSON summary of the current house (for edits / chat). */
  context?: string
  /** A sketch or plan photo to read (readPlan), base64 without the data: prefix. */
  image?: { mediaType: 'image/jpeg' | 'image/png'; data: string }
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
  /** Restart the app (after autosave), e.g. to apply a new graphics backend. */
  relaunch(): Promise<void>
  writeFile(path: string, data: ArrayBuffer | string): Promise<void>
  readFile(path: string): Promise<FileResult>
  chooseFolder(): Promise<string | null>
  writeFiles(folder: string, files: ExportFile[]): Promise<string[]>
  showInFolder(path: string): Promise<void>
  recent: { list(): Promise<RecentProject[]>; add(entry: RecentProject): Promise<void>; remove(path: string): Promise<void> }
  autosave: { write(id: string, name: string, data: ArrayBuffer): Promise<void>; list(): Promise<AutosaveEntry[]>; read(id: string): Promise<ArrayBuffer | null>; remove(id: string): Promise<void> }
  settings: { get(): Promise<AppSettings>; set(patch: Partial<AppSettings>): Promise<AppSettings>; setApiKey(key: string | null): Promise<AppSettings>; setOpenAiKey(key: string | null): Promise<AppSettings> }
  ai(req: AiRequest): Promise<AiResponse>
  /** AI photo of a render (amendment A9), with the user's OpenAI key. */
  aiImage(req: AiImageRequest): Promise<AiImageResponse>
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
