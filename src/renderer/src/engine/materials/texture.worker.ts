/// <reference lib="webworker" />
import { adjustColor, generateTexture, heightToNormal, roughnessMap, type TexRequest } from './procedural'

export interface TexJob {
  id: number
  req: TexRequest
  roughness: number
  normalStrength: number
  brightness: number
  contrast: number
}

self.onmessage = (e: MessageEvent<TexJob>) => {
  const { id, req, roughness, normalStrength, brightness, contrast } = e.data
  try {
    const r = generateTexture(req)
    adjustColor(r.color, brightness, contrast)
    const normal = heightToNormal(r.height, r.size, 1.5 + normalStrength * 2.5)
    const rough = roughnessMap(roughness, r.rough, r.size)
    ;(self as unknown as Worker).postMessage({ id, size: r.size, color: r.color.buffer, normal: normal.buffer, rough: rough.buffer }, [r.color.buffer, normal.buffer, rough.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
