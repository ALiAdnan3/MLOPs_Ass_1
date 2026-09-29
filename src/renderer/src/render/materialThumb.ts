import { useEffect, useState } from 'react'
import type { MaterialDef } from '../core/model/types'
import { texturePool } from '../engine/materials/textures'
import { assetUrl } from '../state/assets'
import { materialSwatch } from '../core/materials/library'

/**
 * Material swatches for the library grid: the real procedural texture (same generator as the
 * 3D view) rendered at 128 px with a soft top-light, so what you pick is what you get.
 */

const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

function keyOf(m: MaterialDef) {
  return `${m.id}|${m.brightness}|${m.contrast}|${m.procedural?.colors.join(',')}|${m.assetId ?? ''}`
}

export function materialThumb(m: MaterialDef, size = 128): Promise<string> {
  if (m.assetId) return Promise.resolve(assetUrl(m.assetId) ?? '')
  const key = keyOf(m)
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const running = inflight.get(key)
  if (running) return running
  if (!m.procedural) return Promise.resolve('')
  // show ~0.6 m of the surface (tiles/planks read at a glance); paint shows its flat colour
  const scale = m.scale
  const p = texturePool
    .generate({ kind: m.procedural.kind, colors: m.procedural.colors, params: m.procedural.params, seed: m.procedural.seed, size, scale }, m.roughness, m.normalStrength, m.brightness, m.contrast)
    .then((maps) => {
      const c = document.createElement('canvas')
      c.width = c.height = size
      const g = c.getContext('2d')!
      const img = new ImageData(new Uint8ClampedArray(maps.color), maps.size, maps.size)
      // shade with the normal map (light from top-left) for a sense of relief
      const n = maps.normal
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        const nx = n[i] / 127.5 - 1
        const ny = n[i + 1] / 127.5 - 1
        const nz = n[i + 2] / 127.5 - 1
        const lit = Math.max(0.55, Math.min(1.25, 0.9 + (-nx * 0.45 + ny * 0.45 + nz * 0.2) * 0.35))
        d[i] = Math.min(255, d[i] * lit)
        d[i + 1] = Math.min(255, d[i + 1] * lit)
        d[i + 2] = Math.min(255, d[i + 2] * lit)
      }
      g.putImageData(img, 0, 0)
      // polished materials: faint diagonal sheen
      if (m.reflection > 0.35) {
        const grad = g.createLinearGradient(0, 0, size, size)
        grad.addColorStop(0, 'rgba(255,255,255,0)')
        grad.addColorStop(0.45, `rgba(255,255,255,${0.12 * m.reflection})`)
        grad.addColorStop(0.6, 'rgba(255,255,255,0)')
        g.fillStyle = grad
        g.fillRect(0, 0, size, size)
      }
      const url = c.toDataURL('image/jpeg', 0.85)
      cache.set(key, url)
      inflight.delete(key)
      return url
    })
    .catch(() => {
      inflight.delete(key)
      return ''
    })
  inflight.set(key, p)
  return p
}

export function useMaterialThumb(m: MaterialDef | undefined): string {
  const [url, setUrl] = useState(() => (m && !m.assetId ? (cache.get(keyOf(m)) ?? '') : m?.assetId ? (assetUrl(m.assetId) ?? '') : ''))
  useEffect(() => {
    if (!m) return
    let live = true
    materialThumb(m).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [m])
  return url
}

/** CSS background for a swatch: the thumbnail once ready, the flat colour until then. */
export function thumbStyle(m: MaterialDef | undefined, url: string): React.CSSProperties {
  return { backgroundColor: materialSwatch(m), backgroundImage: url ? `url("${url}")` : undefined }
}
