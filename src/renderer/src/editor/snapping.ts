import type { Floor, HouseState, ProjectSettings, Vec2, Wall } from '../core/model/types'
import { closestOnSegment, projectT } from '../core/geometry/segment'
import { dist } from '../core/geometry/vec'
import { snapTo } from '../core/units/units'
import { effectiveKind } from '../planner/walls'

/**
 * Snapping (§7): grid, endpoints/corners, walls (on-wall projection), object alignment guides
 * and dimension snapping. Tolerances are in screen pixels so snapping feels the same at any zoom.
 */

export interface Guide {
  a: Vec2
  b: Vec2
}

export interface SnapResult {
  p: Vec2
  kind: 'none' | 'grid' | 'endpoint' | 'midpoint' | 'wall' | 'guide'
  guides: Guide[]
  wall?: Wall
}

export interface SnapContext {
  floor: Floor | undefined
  house: HouseState
  settings: Pick<ProjectSettings, 'grid' | 'snap'>
  pxPerM: number
  /** Points to ignore (e.g. the vertex being dragged). */
  exclude?: (p: Vec2) => boolean
  disabled?: boolean
}

export function collectPoints(ctx: SnapContext): { pts: Vec2[]; mids: Vec2[] } {
  const pts: Vec2[] = []
  const mids: Vec2[] = []
  const f = ctx.floor
  if (f) {
    for (const r of f.rooms) for (const p of r.polygon) pts.push(p)
    for (const w of f.walls) {
      pts.push(w.a, w.b)
      mids.push({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 })
    }
    for (const c of f.columns) pts.push(c.position)
  }
  for (const p of ctx.house.plot.polygon) pts.push(p)
  return { pts: ctx.exclude ? pts.filter((p) => !ctx.exclude!(p)) : pts, mids }
}

export function snapPoint(raw: Vec2, ctx: SnapContext): SnapResult {
  if (ctx.disabled) return { p: raw, kind: 'none', guides: [] }
  const S = ctx.settings.snap
  const tol = 10 / ctx.pxPerM
  const { pts, mids } = collectPoints(ctx)
  // 1. endpoints / corners
  if (S.objects || S.walls) {
    let best: Vec2 | null = null
    let bd = tol
    for (const p of pts) {
      const d = dist(p, raw)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    if (best) return { p: { ...best }, kind: 'endpoint', guides: [] }
    for (const p of mids) {
      const d = dist(p, raw)
      if (d < tol * 0.8) return { p: { ...p }, kind: 'midpoint', guides: [] }
    }
  }
  let p = { ...raw }
  const guides: Guide[] = []
  let kind: SnapResult['kind'] = 'none'
  let wall: Wall | undefined
  // 2. alignment guides with existing corners
  if (S.guides) {
    const gtol = 6 / ctx.pxPerM
    let gx: Vec2 | null = null
    let gy: Vec2 | null = null
    for (const q of pts) {
      if (!gx && Math.abs(q.x - raw.x) < gtol) gx = q
      if (!gy && Math.abs(q.y - raw.y) < gtol) gy = q
      if (gx && gy) break
    }
    if (gx) {
      p.x = gx.x
      guides.push({ a: { x: gx.x, y: gx.y }, b: { x: gx.x, y: raw.y } })
      kind = 'guide'
    }
    if (gy) {
      p.y = gy.y
      guides.push({ a: { x: gy.x, y: gy.y }, b: { x: raw.x, y: gy.y } })
      kind = 'guide'
    }
  }
  // 3. on a wall
  if (S.walls && ctx.floor) {
    let bd = 8 / ctx.pxPerM
    for (const w of ctx.floor.walls) {
      if (effectiveKind(w) === 'virtual') continue
      const c = closestOnSegment(p, w.a, w.b)
      const d = dist(c, p)
      if (d < bd) {
        bd = d
        wall = w
        if (kind !== 'guide') p = c
        else {
          // keep guide axis, slide onto wall line
          const t = projectT(p, w.a, w.b)
          if (t >= 0 && t <= 1) p = closestOnSegment(p, w.a, w.b)
        }
      }
    }
    if (wall && kind === 'none') kind = 'wall'
  }
  // 4. grid
  if (kind === 'none' && S.grid && ctx.settings.grid > 0) {
    p = { x: snapTo(raw.x, ctx.settings.grid), y: snapTo(raw.y, ctx.settings.grid) }
    kind = 'grid'
  } else if (kind === 'guide' && S.grid) {
    // snap the free axis to grid
    if (!guides.some((g) => g.a.x === g.b.x)) p.x = snapTo(p.x, ctx.settings.grid)
    if (!guides.some((g) => g.a.y === g.b.y)) p.y = snapTo(p.y, ctx.settings.grid)
  }
  return { p, kind, guides, wall }
}

/** Dimension snapping: snap a length to the grid step. */
export function snapLength(len: number, settings: Pick<ProjectSettings, 'grid' | 'snap'>) {
  if (!settings.snap.dimensions || settings.grid <= 0) return len
  return Math.max(settings.grid, snapTo(len, settings.grid))
}

/** Constrain a segment direction to 0/45/90° increments (Shift while drawing walls). */
export function constrainAngle(a: Vec2, b: Vec2, step = Math.PI / 4): Vec2 {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const L = Math.hypot(dx, dy)
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: a.x + Math.cos(ang) * L, y: a.y + Math.sin(ang) * L }
}
