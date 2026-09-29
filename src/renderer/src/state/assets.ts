import { create } from 'zustand'

/**
 * Binary assets (uploaded material images, generated PBR maps, concept images, thumbnails).
 * Kept out of the undoable model — assets are immutable and content-addressed; the model only
 * references their ids. Saved inside the .homeforge file.
 */

export interface Asset {
  id: string
  name: string
  mime: string
  blob: Blob
  url: string
}

interface AssetStore {
  assets: Record<string, Asset>
  put: (blob: Blob, name: string, id?: string) => Promise<Asset>
  get: (id?: string) => Asset | undefined
  clear: () => void
  replaceAll: (list: { id: string; name: string; mime: string; data: ArrayBuffer }[]) => void
}

async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  try {
    const d = await crypto.subtle.digest('SHA-256', buf)
    return 'ast_' + [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    let h = 2166136261
    const u = new Uint8Array(buf)
    for (let i = 0; i < u.length; i += Math.max(1, Math.floor(u.length / 4096))) h = Math.imul(h ^ u[i], 16777619)
    return 'ast_' + (h >>> 0).toString(16) + u.length.toString(16)
  }
}

export const useAssets = create<AssetStore>((set, get) => ({
  assets: {},
  async put(blob, name, id) {
    const key = id ?? (await hashBlob(blob))
    const existing = get().assets[key]
    if (existing) return existing
    const a: Asset = { id: key, name, mime: blob.type || 'application/octet-stream', blob, url: URL.createObjectURL(blob) }
    set({ assets: { ...get().assets, [key]: a } })
    return a
  },
  get(id) {
    return id ? get().assets[id] : undefined
  },
  clear() {
    for (const a of Object.values(get().assets)) URL.revokeObjectURL(a.url)
    set({ assets: {} })
  },
  replaceAll(list) {
    for (const a of Object.values(get().assets)) URL.revokeObjectURL(a.url)
    const next: Record<string, Asset> = {}
    for (const x of list) {
      const blob = new Blob([x.data], { type: x.mime })
      next[x.id] = { id: x.id, name: x.name, mime: x.mime, blob, url: URL.createObjectURL(blob) }
    }
    set({ assets: next })
  }
}))

export const assetUrl = (id?: string) => (id ? useAssets.getState().assets[id]?.url : undefined)
