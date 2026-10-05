import * as THREE from 'three'
import type { Project } from '../core/model/types'
import { getEngine, facadePose } from '../engine/Engine'
import { sortedFloors } from '../core/model/house'
import { bbox } from '../core/geometry/polygon'

/**
 * Offscreen 3D renders of any house (design cards, comparison, presentation, before/after).
 * Uses the shared engine and restores whatever it was showing.
 */
let queue: Promise<unknown> = Promise.resolve()

export interface HouseImageOptions {
  width: number
  height: number
  view?: 'aerial' | 'street' | 'top' | 'rear'
  type?: 'image/png' | 'image/jpeg'
  /** Explicit camera (world metres), e.g. an interior view or a saved bookmark. */
  pose?: { position: [number, number, number]; target: [number, number, number]; fov?: number }
  /** Floor to treat as active (interior renders hide nothing but set the working floor). */
  floorId?: string
  /** 'dollhouse' cuts the active floor open (3D floor plan). */
  viewMode?: 'realistic' | 'dollhouse' | 'architectural'
}

export function renderHouseImage(p: Project, opts: HouseImageOptions = { width: 480, height: 300 }): Promise<string> {
  const job = queue.then(async () => {
    const e = getEngine()
    const prev = e.project
    const prevOpts = e.options
    e.holds++
    try {
      const ground = sortedFloors(p.floors).find((f) => f.level === 0) ?? p.floors[0]
      e.update(p, { floorId: opts.floorId ?? ground?.id ?? '', showAll: true, viewMode: opts.viewMode ?? 'realistic', explodeGap: 0, doorsOpen: true, showFurniture: true, showStructure: true })
      const c = e.houseCenter()
      const b = bbox(p.plot.polygon)
      const size = Math.max(b.w, b.h)
      let pos: THREE.Vector3
      let target = c.clone()
      if (opts.view === 'street') {
        const f = facadePose(p, c, opts.width / opts.height, 45)
        pos = f.position
        target = f.target
      } else if (opts.view === 'rear') {
        pos = new THREE.Vector3(c.x - size * 0.7, size * 0.45 + c.y, c.z - size * 0.95)
      } else if (opts.view === 'top') {
        pos = new THREE.Vector3(c.x, size * 1.6, c.z + 0.01)
        target = new THREE.Vector3(c.x, 0, c.z)
      } else pos = new THREE.Vector3(c.x + size * 0.75, size * 0.55 + c.y, c.z + size * 0.95)
      // let textures stream in (procedural maps are generated in workers)
      await new Promise((r) => setTimeout(r, 60))
      await e.mats.waitIdle(opts.width >= 1200 ? 6000 : 2500)
      let fov = 45
      if (opts.pose) {
        pos = new THREE.Vector3(...opts.pose.position)
        target = new THREE.Vector3(...opts.pose.target)
        fov = opts.pose.fov ?? 60
      }
      const shot = e.snapshot({ width: opts.width, height: opts.height, type: opts.type ?? 'image/jpeg', quality: 0.9, pose: { position: pos, target, fov } })
      // put back what was on show before anything else can draw
      if (prev) e.update(prev, prevOpts)
      // the capture resized (and so cleared) the shared canvas: redraw the view now, or it stays
      // blank while the next queued render waits for its textures
      if (prev && e.container) e.renderFrame()
      return URL.createObjectURL(await shot)
    } finally {
      e.holds--
      if (e.container && !e.holds) e.renderFrame()
    }
  })
  queue = job.catch(() => undefined)
  return job
}
