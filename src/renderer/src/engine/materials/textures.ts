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

/**
 * Texture generation in workers. One shared queue feeds whichever worker is free, textures for the
 * 3D view first and swatch thumbnails after (they used to be dealt round-robin, so a small swatch
 * could wait behind a large texture on a busy worker). Identical requests in flight share a job.
 */
const RANK = { view: 0, thumb: 1, upgrade: 2 } as const

class TexturePool {
  private workers: Worker[] = []
  private idle: Worker[] = []
  /** 0: a first, small texture for the 3D view; 1: a swatch thumbnail; 2: a full-size upgrade. */
  private queue: { job: TexJob; rank: number }[] = []
  private jobId = 1
  private pending = new Map<number, Pending>()
  private same = new Map<string, Promise<TexMaps>>()
  private running = new Map<Worker, number>()
  /** Full-size upgrades running now: capped, so urgent textures and design generation get cores. */
  private upgrades = 0
  /** Something is waiting for full-size textures (a large picture, an export): no cap meanwhile. */
  private rushers = 0
  rush(on: boolean) {
    this.rushers = Math.max(0, this.rushers + (on ? 1 : -1))
    this.pump()
  }
  private failed = false

  private ensure() {
    if (this.workers.length || this.failed) return
    // leave a core for the app and one for the GPU process
    const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 2))
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./texture.worker.ts', import.meta.url), { type: 'module' })
        w.onmessage = (e) => {
          const d = e.data
          const p = this.pending.get(d.id)
          if (this.running.get(w) === RANK.upgrade) this.upgrades--
          this.running.delete(w)
          this.idle.push(w)
          this.pump()
          if (!p) return
          this.pending.delete(d.id)
          if (d.error) p.reject(new Error(d.error))
          else p.resolve({ size: d.size, color: new Uint8ClampedArray(d.color), normal: new Uint8ClampedArray(d.normal), rough: new Uint8ClampedArray(d.rough) })
        }
        w.onerror = () => {
          this.failed = true
        }
        this.workers.push(w)
        this.idle.push(w)
      }
    } catch {
      this.failed = true
    }
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      // most urgent first (the 3D view, then thumbnails, then full-size upgrades), in order of request
      let i = -1
      const cap = this.rushers ? this.workers.length : Math.max(1, Math.floor(this.workers.length / 3))
      for (let k = 0; k < this.queue.length; k++) {
        const r = this.queue[k].rank
        if (r === RANK.upgrade && this.upgrades >= cap) continue
        if (i < 0 || r < this.queue[i].rank) i = k
      }
      if (i < 0) return
      const { job, rank } = this.queue.splice(i, 1)[0]
      const w = this.idle.pop()!
      this.running.set(w, rank)
      if (rank === RANK.upgrade) this.upgrades++
      w.postMessage(job)
    }
  }

  generate(req: TexRequest, roughness: number, normalStrength: number, brightness: number, contrast: number, priority: 'view' | 'thumb' | 'upgrade' = 'view'): Promise<TexMaps> {
    this.ensure()
    if (this.failed || !this.workers.length) {
      // synchronous fallback (tests / very old engines)
      const r = generateTexture(req)
      adjustColor(r.color, brightness, contrast)
      return Promise.resolve({ size: r.size, color: r.color, normal: heightToNormal(r.height, r.size, 1.5 + normalStrength * 2.5), rough: roughnessMap(roughness, r.rough, r.size) })
    }
    const key = JSON.stringify([req, roughness, normalStrength, brightness, contrast])
    const running = this.same.get(key)
    if (running) {
      // a more urgent request lifts the same request still waiting in the queue
      const rank = RANK[priority]
      for (const q of this.queue) if (q.rank > rank && JSON.stringify([q.job.req, q.job.roughness, q.job.normalStrength, q.job.brightness, q.job.contrast]) === key) q.rank = rank
      return running
    }
    const id = this.jobId++
    const job: TexJob = { id, req, roughness, normalStrength, brightness, contrast }
    const promise = new Promise<TexMaps>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.queue.push({ job, rank: RANK[priority] })
      this.pump()
    })
    this.same.set(key, promise)
    const clear = () => this.same.get(key) === promise && this.same.delete(key)
    promise.then(clear, clear)
    return promise
  }
}

export const texturePool = new TexturePool()
