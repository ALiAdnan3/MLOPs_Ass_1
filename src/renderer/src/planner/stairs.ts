import type { Stair, StairType, Vec2 } from '../core/model/types'
import { rotate } from '../core/geometry/vec'
import type { Rect } from '../core/geometry/polygon'

/**
 * Stair geometry shared by the 2D plan, the 3D model, validation and the walkthrough.
 * Local frame: x across the stair, y along the first flight's walking direction; origin at the
 * bottom-left corner of the bounding box. World = position + rotate(local, rotation).
 */

export type StairShape = 'straight' | 'L' | 'U' | 'spiral'

export function stairShape(t: StairType): StairShape {
  if (t === 'straight' || t === 'floating') return 'straight'
  if (t === 'L') return 'L'
  if (t === 'spiral') return 'spiral'
  return 'U'
}

export const IDEAL_RISER = 0.175

/** Riser count keeping each riser within 150–190 mm (comfortable residential range). */
export function risersFor(height: number) {
  let r = Math.max(4, Math.round(height / IDEAL_RISER))
  while (height / r > 0.19) r++
  while (r > 4 && height / r < 0.15) r--
  return r
}

export interface Tread {
  /** Polygon in world coords. */
  poly: Vec2[]
  /** Top surface height above the stair's floor. */
  z: number
  kind: 'tread' | 'landing'
}

export interface StairGeometry {
  shape: StairShape
  riser: number
  local: { w: number; run: number }
  treads: Tread[]
  /** Walking path (world) with heights, bottom → top. */
  path: { p: Vec2; z: number }[]
  /** Outline polygon (world). */
  outline: Vec2[]
  /** Railing polylines (world) with heights at ends. */
  rails: { a: Vec2; b: Vec2; za: number; zb: number }[]
  /** Up arrow polyline for the plan (world). */
  arrow: Vec2[]
}

export function localSize(s: Pick<Stair, 'type' | 'width' | 'risers' | 'tread'>): { w: number; run: number } {
  const shape = stairShape(s.type)
  const fw = s.width
  if (shape === 'straight') return { w: fw, run: (s.risers - 1) * s.tread }
  if (shape === 'spiral') {
    const d = 2 * (fw + 0.15)
    return { w: d, run: d }
  }
  if (shape === 'L') {
    const t1 = Math.ceil((s.risers - 1) / 2)
    const t2 = s.risers - 1 - t1 - 1
    return { w: fw + Math.max(0, t2) * s.tread, run: t1 * s.tread + fw }
  }
  const r1 = Math.ceil(s.risers / 2)
  const t1 = r1 - 1
  const t2 = s.risers - r1 - 1
  return { w: 2 * fw + 0.1, run: Math.max(t1, t2) * s.tread + fw }
}

export function stairGeometry(s: Stair, floorHeight: number): StairGeometry {
  const shape = stairShape(s.type)
  const riser = floorHeight / s.risers
  const fw = s.width
  const { w, run } = localSize(s)
  const toW = (p: Vec2): Vec2 => {
    const q = rotate(p, s.rotation)
    return { x: q.x + s.position.x, y: q.y + s.position.y }
  }
  const mirror = s.turn === 'left'
  const mx = (x: number) => (mirror ? w - x : x)
  const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [toW({ x: mx(x0), y: y0 }), toW({ x: mx(x1), y: y0 }), toW({ x: mx(x1), y: y1 }), toW({ x: mx(x0), y: y1 })]
  const treads: Tread[] = []
  const path: { p: Vec2; z: number }[] = []
  const rails: StairGeometry['rails'] = []
  let arrow: Vec2[] = []
  const T = s.tread

  if (shape === 'straight') {
    for (let i = 0; i < s.risers - 1; i++) treads.push({ poly: rect(0, i * T, fw, (i + 1) * T), z: (i + 1) * riser, kind: 'tread' })
    path.push({ p: toW({ x: mx(fw / 2), y: -0.4 }), z: 0 }, { p: toW({ x: mx(fw / 2), y: 0 }), z: 0 }, { p: toW({ x: mx(fw / 2), y: run }), z: floorHeight }, { p: toW({ x: mx(fw / 2), y: run + 0.5 }), z: floorHeight })
    rails.push({ a: toW({ x: mx(0.04), y: 0 }), b: toW({ x: mx(0.04), y: run }), za: riser, zb: floorHeight }, { a: toW({ x: mx(fw - 0.04), y: 0 }), b: toW({ x: mx(fw - 0.04), y: run }), za: riser, zb: floorHeight })
    arrow = [toW({ x: mx(fw / 2), y: 0.2 }), toW({ x: mx(fw / 2), y: run - 0.1 })]
  } else if (shape === 'U') {
    const r1 = Math.ceil(s.risers / 2)
    const t1 = r1 - 1
    const t2 = s.risers - r1 - 1
    const landY = run - fw
    for (let i = 0; i < t1; i++) treads.push({ poly: rect(0, landY - t1 * T + i * T, fw, landY - t1 * T + (i + 1) * T), z: (i + 1) * riser, kind: 'tread' })
    treads.push({ poly: rect(0, landY, w, run), z: r1 * riser, kind: 'landing' })
    for (let i = 0; i < t2; i++) {
      const y1 = landY - i * T
      treads.push({ poly: rect(w - fw, y1 - T, w, y1), z: (r1 + 1 + i) * riser, kind: 'tread' })
    }
    const y0 = landY - t1 * T
    path.push(
      { p: toW({ x: mx(fw / 2), y: y0 - 0.4 }), z: 0 },
      { p: toW({ x: mx(fw / 2), y: y0 }), z: 0 },
      { p: toW({ x: mx(fw / 2), y: landY + fw / 2 }), z: r1 * riser },
      { p: toW({ x: mx(w - fw / 2), y: landY + fw / 2 }), z: r1 * riser },
      { p: toW({ x: mx(w - fw / 2), y: landY - t2 * T }), z: floorHeight },
      { p: toW({ x: mx(w - fw / 2), y: landY - t2 * T - 0.5 }), z: floorHeight }
    )
    const inner = fw + 0.05
    rails.push(
      { a: toW({ x: mx(inner - 0.02), y: y0 }), b: toW({ x: mx(inner - 0.02), y: landY }), za: riser, zb: r1 * riser },
      { a: toW({ x: mx(inner + 0.02), y: landY }), b: toW({ x: mx(inner + 0.02), y: landY - t2 * T }), za: r1 * riser, zb: floorHeight },
      { a: toW({ x: mx(0.03), y: y0 }), b: toW({ x: mx(0.03), y: run - 0.03 }), za: riser, zb: r1 * riser },
      { a: toW({ x: mx(0.03), y: run - 0.03 }), b: toW({ x: mx(w - 0.03), y: run - 0.03 }), za: r1 * riser, zb: r1 * riser },
      { a: toW({ x: mx(w - 0.03), y: run - 0.03 }), b: toW({ x: mx(w - 0.03), y: landY - t2 * T }), za: r1 * riser, zb: floorHeight }
    )
    arrow = [toW({ x: mx(fw / 2), y: y0 + 0.2 }), toW({ x: mx(fw / 2), y: landY + fw / 2 }), toW({ x: mx(w - fw / 2), y: landY + fw / 2 }), toW({ x: mx(w - fw / 2), y: landY - t2 * T + 0.2 })]
  } else if (shape === 'L') {
    const t1 = Math.ceil((s.risers - 1) / 2)
    const t2 = Math.max(0, s.risers - 1 - t1 - 1)
    for (let i = 0; i < t1; i++) treads.push({ poly: rect(0, i * T, fw, (i + 1) * T), z: (i + 1) * riser, kind: 'tread' })
    treads.push({ poly: rect(0, t1 * T, fw, t1 * T + fw), z: (t1 + 1) * riser, kind: 'landing' })
    for (let i = 0; i < t2; i++) treads.push({ poly: rect(fw + i * T, t1 * T, fw + (i + 1) * T, t1 * T + fw), z: (t1 + 2 + i) * riser, kind: 'tread' })
    const ly = t1 * T + fw / 2
    path.push(
      { p: toW({ x: mx(fw / 2), y: -0.4 }), z: 0 },
      { p: toW({ x: mx(fw / 2), y: 0 }), z: 0 },
      { p: toW({ x: mx(fw / 2), y: ly }), z: (t1 + 1) * riser },
      { p: toW({ x: mx(w), y: ly }), z: floorHeight },
      { p: toW({ x: mx(w + 0.5), y: ly }), z: floorHeight }
    )
    rails.push(
      { a: toW({ x: mx(fw - 0.03), y: 0 }), b: toW({ x: mx(fw - 0.03), y: t1 * T }), za: riser, zb: (t1 + 1) * riser },
      { a: toW({ x: mx(0.03), y: 0 }), b: toW({ x: mx(0.03), y: t1 * T + fw - 0.03 }), za: riser, zb: (t1 + 1) * riser },
      { a: toW({ x: mx(0.03), y: t1 * T + fw - 0.03 }), b: toW({ x: mx(w), y: t1 * T + fw - 0.03 }), za: (t1 + 1) * riser, zb: floorHeight }
    )
    arrow = [toW({ x: mx(fw / 2), y: 0.2 }), toW({ x: mx(fw / 2), y: ly }), toW({ x: mx(w - 0.2), y: ly })]
  } else {
    // spiral: 300° of rotation
    const cx = w / 2
    const cy = run / 2
    const R = w / 2
    const n = s.risers - 1
    const total = (300 * Math.PI) / 180
    const step = total / n
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + i * step
      const a1 = a0 + step
      const pts: Vec2[] = [toW({ x: mx(cx + Math.cos(a0) * 0.12), y: cy + Math.sin(a0) * 0.12 })]
      for (let k = 0; k <= 4; k++) {
        const a = a0 + ((a1 - a0) * k) / 4
        pts.push(toW({ x: mx(cx + Math.cos(a) * R), y: cy + Math.sin(a) * R }))
      }
      pts.push(toW({ x: mx(cx + Math.cos(a1) * 0.12), y: cy + Math.sin(a1) * 0.12 }))
      treads.push({ poly: pts, z: (i + 1) * riser, kind: 'tread' })
    }
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i - 0.5) * step
      path.push({ p: toW({ x: mx(cx + Math.cos(a) * R * 0.6), y: cy + Math.sin(a) * R * 0.6 }), z: Math.min(floorHeight, i * riser) })
    }
    for (let i = 0; i < 24; i++) {
      const a0 = -Math.PI / 2 + (total * i) / 24
      const a1 = -Math.PI / 2 + (total * (i + 1)) / 24
      rails.push({
        a: toW({ x: mx(cx + Math.cos(a0) * (R - 0.03)), y: cy + Math.sin(a0) * (R - 0.03) }),
        b: toW({ x: mx(cx + Math.cos(a1) * (R - 0.03)), y: cy + Math.sin(a1) * (R - 0.03) }),
        za: (floorHeight * i) / 24,
        zb: (floorHeight * (i + 1)) / 24
      })
    }
    arrow = Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (total * i) / 9
      return toW({ x: mx(cx + Math.cos(a) * R * 0.6), y: cy + Math.sin(a) * R * 0.6 })
    })
  }
  const outline = [toW({ x: 0, y: 0 }), toW({ x: w, y: 0 }), toW({ x: w, y: run }), toW({ x: 0, y: run })]
  if (shape === 'U') {
    const y0 = run - fw - (Math.ceil(s.risers / 2) - 1) * T
    outline.splice(0, 4, toW({ x: 0, y: Math.min(0, y0) }), toW({ x: w, y: Math.min(0, y0) }), toW({ x: w, y: run }), toW({ x: 0, y: run }))
  }
  return { shape, riser, local: { w, run }, treads, path, outline, rails, arrow }
}

/**
 * Fit a stair of the given type into a rectangle, with its entry end facing `entry` side.
 * Returns position/rotation/width, or null when it cannot fit.
 */
type Dir = 'front' | 'back' | 'left' | 'right'
const OPP: Record<Dir, Dir> = { front: 'back', back: 'front', left: 'right', right: 'left' }

export function fitStair(type: StairType, room: Rect, entry: Dir, risers: number, tread = 0.27): Pick<Stair, 'position' | 'rotation' | 'width'> | null {
  const margin = 0.05
  // walking direction of the first flight; best = away from the side people arrive from
  const away = OPP[entry]
  const perps: Dir[] = entry === 'front' || entry === 'back' ? ['left', 'right'] : ['front', 'back']
  const order: Dir[] = [away, ...perps, entry]
  for (const dir of order) {
    for (let fw = 1.25; fw >= 0.85 - 1e-9; fw -= 0.05) {
      const sz = localSize({ type, width: fw, risers, tread })
      const alongY = dir === 'front' || dir === 'back'
      const bw = alongY ? sz.w : sz.run
      const bh = alongY ? sz.run : sz.w
      if (bw > room.w - 2 * margin + 1e-6 || bh > room.h - 2 * margin + 1e-6) continue
      // push the stair against the far wall so the landing space stays by the open side
      let x0 = room.x + (room.w - bw) / 2
      let y0 = room.y + (room.h - bh) / 2
      if (dir === 'front') y0 = room.y + room.h - bh - margin
      if (dir === 'back') y0 = room.y + margin
      if (dir === 'right') x0 = room.x + room.w - bw - margin
      if (dir === 'left') x0 = room.x + margin
      if (dir === away || dir === entry) {
        // hug the side wall away from the open edge centre for a cleaner hall
        if (alongY) x0 = entry === 'left' ? room.x + room.w - bw - margin : entry === 'right' ? room.x + margin : x0
      } else if (!alongY) {
        // perpendicular run: keep it against the wall opposite the open side
        y0 = entry === 'back' ? room.y + room.h - bh - margin : entry === 'front' ? room.y + margin : y0
      } else {
        x0 = entry === 'left' ? room.x + room.w - bw - margin : entry === 'right' ? room.x + margin : x0
      }
      let rotation = 0
      let pos: Vec2
      if (dir === 'front') pos = { x: x0, y: y0 }
      else if (dir === 'back') {
        rotation = Math.PI
        pos = { x: x0 + bw, y: y0 + bh }
      } else if (dir === 'right') {
        rotation = -Math.PI / 2
        pos = { x: x0, y: y0 + bh }
      } else {
        rotation = Math.PI / 2
        pos = { x: x0 + bw, y: y0 }
      }
      return { position: pos, rotation, width: Math.round(fw * 100) / 100 }
    }
  }
  return null
}

/** World-space bounding rect of a stair. */
export function stairBounds(s: Stair): Rect {
  const g = stairGeometry(s, 3.3)
  const xs = g.outline.map((p) => p.x)
  const ys = g.outline.map((p) => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}
