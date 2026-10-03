import { create } from 'zustand'
import type { MaterialAnalysis, MaterialDef } from '../core/model/types'
import { useAssets } from '../state/assets'
import { commit, getProject } from '../state/store'
import { useUI } from '../state/ui'
import { uid } from '../core/model/ids'
import { analyzeImage, generateMaps } from '../ai/materialAnalysis'

/**
 * MATERIAL UPLOAD (§13, §14). A photo becomes a real PBR material:
 * validate → store → analyze (worker) → seamless base colour + normal/roughness/height maps →
 * MaterialDef in "My materials" → optional apply to the selected surface.
 */

export interface UploadJob {
  id: string
  name: string
  stage: 'reading' | 'analyzing' | 'maps' | 'done' | 'error'
  preview?: string
  materialId?: string
  error?: string
}

interface UploadState {
  jobs: UploadJob[]
  seamless: boolean
  /** Material waiting for the "apply to selected surface?" confirmation. */
  confirmId: string | null
  set: (patch: Partial<UploadState>) => void
  patchJob: (id: string, patch: Partial<UploadJob>) => void
}

export const useUpload = create<UploadState>((set, get) => ({
  jobs: [],
  seamless: true,
  confirmId: null,
  set: (patch) => set(patch),
  patchJob: (id, patch) => set({ jobs: get().jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })
}))

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp']
const MAX_BYTES = 40 * 1024 * 1024

let worker: Worker | null = null
let workerFailed = false
let reqId = 1
const waiting = new Map<number, (r: WorkerResult) => void>()
interface WorkerResult {
  analysis?: MaterialAnalysis
  base?: Blob
  normal?: Blob
  rough?: Blob
  height?: Blob
  error?: string
}

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker
  try {
    worker = new Worker(new URL('../ai/materialAnalysis.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const cb = waiting.get(e.data.id)
      waiting.delete(e.data.id)
      cb?.(e.data)
    }
    worker.onerror = () => {
      workerFailed = true
      worker = null
      for (const cb of waiting.values()) cb({ error: 'The analysis worker stopped.' })
      waiting.clear()
    }
  } catch {
    workerFailed = true
  }
  return worker
}

/** Main-thread fallback when OffscreenCanvas / module workers are unavailable. */
async function analyzeOnMain(bitmap: ImageBitmap, seamless: boolean): Promise<WorkerResult> {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.drawImage(bitmap, 0, 0, 256, 256)
  const analysis = analyzeImage({ data: g.getImageData(0, 0, 256, 256).data, w: 256, h: 256 })
  const n = Math.min(1024, Math.max(256, 2 ** Math.round(Math.log2(Math.min(bitmap.width, bitmap.height)))))
  c.width = c.height = n
  const side = Math.min(bitmap.width, bitmap.height)
  g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, n, n)
  const maps = generateMaps(g.getImageData(0, 0, n, n).data, n, analysis, seamless)
  const blob = (px: Uint8ClampedArray, type = 'image/png') =>
    new Promise<Blob>((res) => {
      g.putImageData(new ImageData(new Uint8ClampedArray(px), n, n), 0, 0)
      c.toBlob((b) => res(b!), type, 0.92)
    })
  return { analysis, base: await blob(maps.base, 'image/jpeg'), normal: await blob(maps.normal), rough: await blob(maps.rough), height: await blob(maps.height) }
}

async function analyze(bitmap: ImageBitmap, seamless: boolean): Promise<WorkerResult> {
  const w = getWorker()
  if (!w || typeof OffscreenCanvas === 'undefined') return analyzeOnMain(bitmap, seamless)
  const id = reqId++
  return new Promise((resolve) => {
    waiting.set(id, (r) => (r.error && !r.analysis ? analyzeOnMain(bitmap, seamless).then(resolve, () => resolve(r)) : resolve(r)))
    w.postMessage({ id, bitmap, seamless })
  })
}

const TITLE: Record<string, string> = {
  marble: 'Marble',
  granite: 'Granite',
  ceramic: 'Ceramic tile',
  porcelain: 'Porcelain tile',
  wood: 'Wood',
  concrete: 'Concrete',
  brick: 'Brick',
  stone: 'Stone',
  paint: 'Paint',
  metal: 'Metal',
  glass: 'Glass',
  roof: 'Roofing',
  wallpaper: 'Wallpaper',
  ground: 'Outdoor surface',
  fabric: 'Fabric'
}

function nameFromFile(file: string, a: MaterialAnalysis) {
  const base = file.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim()
  const generic = /^(img|image|photo|dsc|pxl|screenshot|whatsapp)/i.test(base) || /^\d+$/.test(base) || base.length < 3
  return generic ? `My ${TITLE[a.textureType]?.toLowerCase() ?? 'material'}` : base[0].toUpperCase() + base.slice(1)
}

/** Build the material definition the analysis implies. */
export function materialFromAnalysis(a: MaterialAnalysis, name: string, assets: { base: string; normal?: string; rough?: string; height?: string }): MaterialDef {
  const metal = a.textureType === 'metal'
  return {
    id: `upl:${uid('mat')}`,
    name,
    category: a.textureType,
    source: 'upload',
    color: '#ffffff',
    assetId: assets.base,
    maps: { normal: assets.normal, roughness: assets.rough, height: assets.height },
    scale: a.scale,
    rotation: 0,
    offset: { x: 0, y: 0 },
    roughness: a.roughness,
    metalness: metal ? 0.85 : 0,
    reflection: a.reflectivity,
    brightness: 0,
    contrast: 0,
    normalStrength: a.textureType === 'paint' || a.textureType === 'marble' ? 0.35 : a.textureType === 'brick' || a.textureType === 'stone' ? 1.2 : 0.8,
    analysis: a
  }
}

/** Adds each photo as a material. `quiet` leaves applying to the caller (no prompt, no mode switch). */
export async function uploadMaterialFiles(files: File[], opts: { quiet?: boolean } = {}): Promise<string[]> {
  const ui = useUI.getState()
  const st = useUpload.getState()
  const created: string[] = []
  for (const file of files) {
    const id = uid('job')
    st.set({ jobs: [{ id, name: file.name, stage: 'reading' as const }, ...useUpload.getState().jobs].slice(0, 12) })
    const fail = (what: string, why: string, fix: string) => {
      st.patchJob(id, { stage: 'error', error: `${what} ${why}` })
      ui.showError({ what, why, fix })
    }
    if (!ACCEPT.includes(file.type)) {
      fail(`"${file.name}" was not added.`, 'Only JPG, PNG, WebP and BMP photos can become materials.', 'Save the photo as JPG or PNG and upload it again.')
      continue
    }
    if (file.size > MAX_BYTES) {
      fail(`"${file.name}" was not added.`, `The file is ${(file.size / 1048576).toFixed(0)} MB; the limit is 40 MB.`, 'Resize the photo to about 2000 pixels wide and try again.')
      continue
    }
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      fail(`"${file.name}" could not be opened.`, 'The image data is damaged or in an unsupported colour format.', 'Open it in any photo editor, export as JPG, then upload that copy.')
      continue
    }
    if (bitmap.width < 64 || bitmap.height < 64) {
      fail(`"${file.name}" is too small.`, `It is ${bitmap.width}×${bitmap.height} pixels; textures need at least 64×64.`, 'Use a larger, close-up photo of the surface.')
      continue
    }
    const preview = URL.createObjectURL(file)
    st.patchJob(id, { stage: 'analyzing', preview })
    const original = await useAssets.getState().put(file, file.name)
    st.patchJob(id, { stage: 'maps' })
    const r = await analyze(bitmap, useUpload.getState().seamless)
    if (!r.analysis || !r.base) {
      fail(`"${file.name}" could not be analysed.`, r.error ?? 'The texture analysis stopped unexpectedly.', 'Try again; if it keeps failing, try a smaller JPG.')
      continue
    }
    const put = (b: Blob | undefined, n: string) => (b ? useAssets.getState().put(b, n).then((a) => a.id) : Promise.resolve(undefined))
    const [base, normal, rough, height] = await Promise.all([put(r.base, `${file.name} (base)`), put(r.normal, `${file.name} (normal)`), put(r.rough, `${file.name} (roughness)`), put(r.height, `${file.name} (height)`)])
    const def = materialFromAnalysis(r.analysis, nameFromFile(file.name, r.analysis), { base: base ?? original.id, normal, rough, height })
    def.originalAssetId = original.id
    commit(`Add material "${def.name}"`, (d) => void d.materials.push(def))
    st.patchJob(id, { stage: 'done', materialId: def.id })
    created.push(def.id)
  }
  if (!created.length || opts.quiet) return created
  const last = created[created.length - 1]
  const surface = useUI.getState().surface
  if (surface) useUpload.getState().set({ confirmId: last })
  else
    ui.toast({
      kind: 'success',
      title: created.length === 1 ? 'Material added to My materials' : `${created.length} materials added to My materials`,
      body: 'Click a floor, wall or other surface in the 3D view, then choose Apply.'
    })
  if (ui.mode !== 'materials') ui.set({ mode: 'materials' })
  window.dispatchEvent(new CustomEvent('hf:material-focus', { detail: last }))
  return created
}

/** Re-generate maps for an uploaded material (e.g. after toggling seamless). */
export async function regenerateMaps(materialId: string, seamless: boolean) {
  const def = getProject().materials.find((m) => m.id === materialId)
  const src = useAssets.getState().get(def?.originalAssetId ?? def?.assetId)
  if (!def || !src) return
  const bitmap = await createImageBitmap(src.blob)
  const r = await analyze(bitmap, seamless)
  if (!r.base) return
  const put = (b: Blob | undefined, n: string) => (b ? useAssets.getState().put(b, n).then((a) => a.id) : Promise.resolve(undefined))
  const [base, normal, rough, height] = await Promise.all([put(r.base, 'base'), put(r.normal, 'normal'), put(r.rough, 'roughness'), put(r.height, 'height')])
  commit('Regenerate material maps', (d) => {
    const m = d.materials.find((x) => x.id === materialId)
    if (!m) return
    m.assetId = base
    m.maps = { normal, roughness: rough, height }
  })
}
