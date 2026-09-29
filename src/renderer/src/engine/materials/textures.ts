import type { TexJob } from './texture.worker'
import type { TexRequest } from './procedural'
import { adjustColor, generateTexture, heightToNormal, roughnessMap } from './procedural'

/** Background texture generation (§50: background processing for expensive operations). */

export interface TexMaps {
  size: number
  color: Uint8ClampedArray
  normal: Uint8ClampedArray
  rough: Uint8ClampedArray
}

type Pending = { resolve: (m: TexMaps) => void; reject: (e: unknown) => void }

class TexturePool {
  private workers: Worker[] = []
  private next = 0
  private jobId = 1
  private pending = new Map<number, Pending>()
  private failed = false

  private ensure() {
    if (this.workers.length || this.failed) return
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1))
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./texture.worker.ts', import.meta.url), { type: 'module' })
        w.onmessage = (e) => {
          const d = e.data
          const p = this.pending.get(d.id)
          if (!p) return
          this.pending.delete(d.id)
          if (d.error) p.reject(new Error(d.error))
          else p.resolve({ size: d.size, color: new Uint8ClampedArray(d.color), normal: new Uint8ClampedArray(d.normal), rough: new Uint8ClampedArray(d.rough) })
        }
        w.onerror = () => {
          this.failed = true
        }
        this.workers.push(w)
      }
    } catch {
      this.failed = true
    }
  }

  generate(req: TexRequest, roughness: number, normalStrength: number, brightness: number, contrast: number): Promise<TexMaps> {
    this.ensure()
    if (this.failed || !this.workers.length) {
      // synchronous fallback (tests / very old engines)
      const r = generateTexture(req)
      adjustColor(r.color, brightness, contrast)
      return Promise.resolve({ size: r.size, color: r.color, normal: heightToNormal(r.height, r.size, 1.5 + normalStrength * 2.5), rough: roughnessMap(roughness, r.rough, r.size) })
    }
    const id = this.jobId++
    const job: TexJob = { id, req, roughness, normalStrength, brightness, contrast }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const w = this.workers[this.next++ % this.workers.length]
      w.postMessage(job)
    })
  }
}

export const texturePool = new TexturePool()
