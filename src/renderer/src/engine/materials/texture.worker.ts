/// <reference lib="webworker" />
import { adjustColor, generateTexture, heightToNormal, roughnessMap, type TexRequest } from './procedural'

export interface TexJob {
  id: number
  req: TexRequest
  roughness: number
  normalStrength: number
  brightness: number
  contrast: number
  /** Make a finished swatch image (shaded, encoded) instead of texture maps. */
  thumb?: { reflection: number }
}

/** Swatch thumbnail: the colour map shaded by its normals (light from the top left), as a JPEG. */
async function thumbnail(color: Uint8ClampedArray, normal: Uint8ClampedArray, size: number, reflection: number): Promise<Blob> {
  for (let i = 0; i < color.length; i += 4) {
    const nx = normal[i] / 127.5 - 1
    const ny = normal[i + 1] / 127.5 - 1
    const nz = normal[i + 2] / 127.5 - 1
    const lit = Math.max(0.55, Math.min(1.25, 0.9 + (-nx * 0.45 + ny * 0.45 + nz * 0.2) * 0.35))
    color[i] = Math.min(255, color[i] * lit)
    color[i + 1] = Math.min(255, color[i + 1] * lit)
    color[i + 2] = Math.min(255, color[i + 2] * lit)
  }
  const c = new OffscreenCanvas(size, size)
  const g = c.getContext('2d')!
  g.putImageData(new ImageData(color as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0)
  // polished materials: faint diagonal sheen
  if (reflection > 0.35) {
    const grad = g.createLinearGradient(0, 0, size, size)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.45, `rgba(255,255,255,${0.12 * reflection})`)
    grad.addColorStop(0.6, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
  }
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
}

self.onmessage = async (e: MessageEvent<TexJob>) => {
  const { id, req, roughness, normalStrength, brightness, contrast, thumb } = e.data
  try {
    const r = generateTexture(req)
    adjustColor(r.color, brightness, contrast)
    const normal = heightToNormal(r.height, r.size, 1.5 + normalStrength * 2.5)
    if (thumb) {
      ;(self as unknown as Worker).postMessage({ id, thumb: await thumbnail(r.color, normal, r.size, thumb.reflection) })
      return
    }
    const rough = roughnessMap(roughness, r.rough, r.size)
    ;(self as unknown as Worker).postMessage({ id, size: r.size, color: r.color.buffer, normal: normal.buffer, rough: rough.buffer }, [r.color.buffer, normal.buffer, rough.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
