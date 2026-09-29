import type { Floor, FurnitureItem, Room, Vec2 } from '../core/model/types'
import type { IdFactory } from '../core/model/ids'
import { bbox, isAxisRect, largestInscribedRect, rectsOverlap, type Rect } from '../core/geometry/polygon'
import { catalogItem } from '../core/furniture/catalog'
import { wallsOfRoom, effectiveKind } from './walls'
import { segLength } from '../core/geometry/segment'

/**
 * Furniture placeholders (§5) and the room designer's furnishing (§17/§18).
 * Items go against walls away from door swings, beds face into the room, TVs face seating,
 * kitchens get L/U counter runs, garages get cars — all as real, editable model objects.
 */

type EdgeName = 'top' | 'bottom' | 'left' | 'right'
const EDGE_ROT: Record<EdgeName, number> = { top: 0, bottom: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 }

interface Ctx {
  R: Rect
  placed: Rect[]
  blocked: Rect[]
  /** Zones where only low items (under window sills) may go. */
  lowOnly: { rect: Rect; maxH: number }[]
  doorEdges: Set<EdgeName>
  windowEdges: Map<EdgeName, number>
  items: FurnitureItem[]
  ids: IdFactory
}

function edgeLen(R: Rect, e: EdgeName) {
  return e === 'top' || e === 'bottom' ? R.w : R.h
}

function rectOnEdge(R: Rect, e: EdgeName, t: number, w: number, d: number, inset = 0): Rect {
  switch (e) {
    case 'top':
      return { x: R.x + t - w / 2, y: R.y + inset, w, h: d }
    case 'bottom':
      return { x: R.x + t - w / 2, y: R.y + R.h - d - inset, w, h: d }
    case 'left':
      return { x: R.x + inset, y: R.y + t - w / 2, w: d, h: w }
    default:
      return { x: R.x + R.w - d - inset, y: R.y + t - w / 2, w: d, h: w }
  }
}

function inside(R: Rect, r: Rect) {
  return r.x >= R.x - 1e-6 && r.y >= R.y - 1e-6 && r.x + r.w <= R.x + R.w + 1e-6 && r.y + r.h <= R.y + R.h + 1e-6
}

function free(ctx: Ctx, r: Rect, h: number) {
  if (!inside(ctx.R, r)) return false
  if (ctx.placed.some((p) => rectsOverlap(p, r, -0.005))) return false
  if (ctx.blocked.some((p) => rectsOverlap(p, r, -0.005))) return false
  if (ctx.lowOnly.some((z) => h > z.maxH && rectsOverlap(z.rect, r, -0.005))) return false
  return true
}

function add(ctx: Ctx, key: string, r: Rect, rot: number, over: Partial<FurnitureItem> = {}): FurnitureItem {
  const c = catalogItem(key)!
  const swap = Math.abs(Math.sin(rot)) > 0.5
  const item: FurnitureItem = {
    id: ctx.ids('fur'),
    type: key,
    position: { x: r.x + r.w / 2, y: r.y + r.h / 2 },
    rotation: rot,
    width: swap ? r.h : r.w,
    depth: swap ? r.w : r.h,
    height: c.h,
    elevation: c.elevation,
    ...over
  }
  ctx.items.push(item)
  if (key !== 'rug' && key !== 'prayer-mat') ctx.placed.push(r)
  return item
}

/** Place against a wall. `prefer`: 'center' | 'corner' | 'start' | 'end'. */
function onWall(ctx: Ctx, key: string, edges: EdgeName[], prefer: 'center' | 'corner' | 'start' = 'center', size?: { w?: number; d?: number }, over: Partial<FurnitureItem> = {}): FurnitureItem | null {
  const c = catalogItem(key)
  if (!c) return null
  const w = size?.w ?? c.w
  const d = size?.d ?? c.d
  for (const e of edges) {
    const L = edgeLen(ctx.R, e)
    if (L < w) continue
    const ts: number[] = []
    for (let t = w / 2; t <= L - w / 2 + 1e-6; t += 0.05) ts.push(t)
    if (prefer === 'center') ts.sort((a, b) => Math.abs(a - L / 2) - Math.abs(b - L / 2))
    else if (prefer === 'corner') ts.sort((a, b) => Math.min(a, L - a) - Math.min(b, L - b))
    for (const t of ts) {
      const r = rectOnEdge(ctx.R, e, t, w, d)
      if (free(ctx, r, c.h + (c.elevation ?? 0))) return add(ctx, key, r, EDGE_ROT[e], over)
    }
  }
  return null
}

function atCenter(ctx: Ctx, key: string, rotated = false, offset: Vec2 = { x: 0, y: 0 }, size?: { w?: number; d?: number }): FurnitureItem | null {
  const c = catalogItem(key)
  if (!c) return null
  const w0 = size?.w ?? c.w
  const d0 = size?.d ?? c.d
  const [w, d] = rotated ? [d0, w0] : [w0, d0]
  const cx = ctx.R.x + ctx.R.w / 2 + offset.x
  const cy = ctx.R.y + ctx.R.h / 2 + offset.y
  for (const s of [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6]) {
    for (const axis of ['x', 'y'] as const) {
      const r = { x: cx - w / 2 + (axis === 'x' ? s : 0), y: cy - d / 2 + (axis === 'y' ? s : 0), w, h: d }
      if (key === 'rug' ? inside(ctx.R, r) : free(ctx, r, c.h)) return add(ctx, key, r, rotated ? -Math.PI / 2 : 0)
    }
  }
  return null
}

/** Edges ordered by "quietness": no doors first, then fewer windows, then longer. */
function quietEdges(ctx: Ctx): EdgeName[] {
  return (['top', 'bottom', 'left', 'right'] as EdgeName[]).sort((a, b) => {
    const da = ctx.doorEdges.has(a) ? 1 : 0
    const db = ctx.doorEdges.has(b) ? 1 : 0
    if (da !== db) return da - db
    const wa = ctx.windowEdges.get(a) ?? 0
    const wb = ctx.windowEdges.get(b) ?? 0
    if (wa !== wb) return wa - wb
    return edgeLen(ctx.R, b) - edgeLen(ctx.R, a)
  })
}

const opposite: Record<EdgeName, EdgeName> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

export interface FurnishOptions {
  cars?: number
  luxury?: number
}

export function furnishRoom(floor: Floor, room: Room, ids: IdFactory, opt: FurnishOptions = {}): FurnitureItem[] {
  const R0 = isAxisRect(room.polygon) ? bbox(room.polygon) : largestInscribedRect(room.polygon, 0.1)
  const inset = 0.1
  const R: Rect = { x: R0.x + inset, y: R0.y + inset, w: R0.w - 2 * inset, h: R0.h - 2 * inset }
  if (R.w < 0.6 || R.h < 0.6) return []
  const ctx: Ctx = { R, placed: [], blocked: [], lowOnly: [], doorEdges: new Set(), windowEdges: new Map(), items: [], ids }

  // door swings, passages and windows → obstacles
  for (const x of wallsOfRoom(floor, room)) {
    const w = x.wall
    const L = segLength(w.a, w.b)
    const dir = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L }
    const edge = edgeOf(R0, w.a, w.b)
    if (effectiveKind(w) === 'virtual') {
      // keep a walking strip along open edges
      const a = { x: w.a.x + dir.x * x.t0, y: w.a.y + dir.y * x.t0 }
      const b = { x: w.a.x + dir.x * x.t1, y: w.a.y + dir.y * x.t1 }
      ctx.blocked.push(stripInside(R, a, b, 0.9))
      if (edge) ctx.doorEdges.add(edge)
      continue
    }
    for (const o of floor.openings) {
      if (o.wallId !== w.id || o.offset < x.t0 - 0.01 || o.offset > x.t1 + 0.01) continue
      const a = { x: w.a.x + dir.x * (o.offset - o.width / 2), y: w.a.y + dir.y * (o.offset - o.width / 2) }
      const b = { x: w.a.x + dir.x * (o.offset + o.width / 2), y: w.a.y + dir.y * (o.offset + o.width / 2) }
      if (o.kind === 'door') {
        ctx.blocked.push(stripInside(R, a, b, Math.min(o.width + 0.25, 1.4), 0.15))
        if (edge) ctx.doorEdges.add(edge)
      } else {
        ctx.lowOnly.push({ rect: stripInside(R, a, b, 0.5, 0.05), maxH: Math.max(0.1, o.sill - 0.02) })
        if (edge) ctx.windowEdges.set(edge, (ctx.windowEdges.get(edge) ?? 0) + o.width)
      }
    }
  }

  const f = room.furnish ?? {}
  const want = (k: keyof NonNullable<Room['furnish']>) => f[k] !== false
  const q = quietEdges(ctx)
  const minSide = Math.min(R.w, R.h)
  const t = room.type

  switch (t) {
    case 'master_bedroom':
    case 'bedroom':
    case 'guest_bedroom':
    case 'kids_room':
    case 'servant': {
      let bedEdge: EdgeName | null = null
      if (want('bed')) {
        const beds = t === 'servant' ? ['bed-single'] : t === 'kids_room' ? ['bed-single', 'bed-bunk'] : t === 'master_bedroom' ? ['bed-king', 'bed-queen', 'bed-double'] : ['bed-queen', 'bed-double', 'bed-single']
        for (const key of beds) {
          const c = catalogItem(key)!
          if (c.w + 1.1 > edgeLen(R, q[0]) && c.w + 1.1 > edgeLen(R, q[1]) && key !== 'bed-single') continue
          const bed = onWall(ctx, key, q, 'center')
          if (bed) {
            bedEdge = edgeFromRot(bed.rotation)
            if (t !== 'servant' && key !== 'bed-single') {
              // nightstands both sides
              for (const s of [-1, 1]) {
                const L = edgeLen(R, bedEdge)
                const tc = tAlong(R, bedEdge, bed.position) + s * (bed.width / 2 + 0.27)
                if (tc > 0.25 && tc < L - 0.25) {
                  const r = rectOnEdge(R, bedEdge, tc, 0.5, 0.42)
                  if (free(ctx, r, 0.55)) add(ctx, 'nightstand', r, EDGE_ROT[bedEdge])
                }
              }
            } else if (t === 'kids_room' && minSide > 3.1) onWall(ctx, 'bed-single', [bedEdge], 'corner')
            if (want('decor') && t !== 'servant') {
              const back = bedEdge
              const off = back === 'top' ? { x: 0, y: 0.5 } : back === 'bottom' ? { x: 0, y: -0.5 } : back === 'left' ? { x: 0.5, y: 0 } : { x: -0.5, y: 0 }
              const rugC = { x: bed.position.x + off.x - (R.x + R.w / 2), y: bed.position.y + off.y - (R.y + R.h / 2) }
              atCenter(ctx, 'rug', back === 'left' || back === 'right', rugC, { w: Math.min(2.4, bed.width + 0.9), d: 1.7 })
            }
            break
          }
        }
      }
      if (want('wardrobe')) onWall(ctx, t === 'master_bedroom' ? 'wardrobe-large' : 'wardrobe', q.filter((e) => e !== bedEdge).concat(bedEdge ? [bedEdge] : []), 'corner') ?? onWall(ctx, 'wardrobe', q, 'corner', { w: 1.2 })
      if (t === 'kids_room' || f.desk) onWall(ctx, 'study-desk', q, 'corner')
      else if (t !== 'servant') onWall(ctx, 'dresser', q, 'corner')
      if (want('tv') && bedEdge && t !== 'servant' && t !== 'kids_room') onWall(ctx, 'tv-wall', [opposite[bedEdge]], 'center', { w: Math.min(1.6, edgeLen(R, opposite[bedEdge]) - 0.6) })
      if (t === 'master_bedroom' && want('seating')) onWall(ctx, 'armchair', q, 'corner')
      if (want('decor') && t !== 'servant') onWall(ctx, 'plant', q, 'corner')
      if (t === 'servant') onWall(ctx, 'cabinet', q, 'corner')
      break
    }
    case 'bathroom':
    case 'servant_bath':
    case 'powder': {
      const far = q
      onWall(ctx, 'wc', far, 'corner')
      onWall(ctx, t === 'powder' || minSide < 1.5 ? 'basin' : 'vanity', [...q].reverse(), 'center') ?? onWall(ctx, 'basin', q, 'corner')
      if (t !== 'powder') {
        const big = R.w * R.h > 6.5 && minSide >= 1.8
        if (big && (opt.luxury ?? 0) > 40) onWall(ctx, 'bathtub', q, 'corner') ?? onWall(ctx, 'shower', q, 'corner')
        else onWall(ctx, 'shower', q, 'corner', minSide < 1.6 ? { w: 0.85, d: 0.85 } : undefined)
      }
      break
    }
    case 'kitchen':
    case 'dirty_kitchen': {
      kitchenRuns(ctx, q, t === 'kitchen')
      if (t === 'kitchen' && R.w >= 3.8 && R.h >= 4.0) atCenter(ctx, 'island', R.w < R.h)
      break
    }
    case 'pantry':
    case 'store':
    case 'wine_storage': {
      onWall(ctx, 'shelving', q, 'corner', { w: Math.min(1.8, edgeLen(R, q[0]) - 0.2) })
      onWall(ctx, 'shelving', q.slice(1), 'corner', { w: Math.min(1.2, edgeLen(R, q[1]) - 0.2) })
      break
    }
    case 'dining': {
      if (want('seating') || true) {
        const long = Math.max(R.w, R.h)
        const set = long >= 4.6 && minSide >= 3.2 ? 'dining-8' : long >= 3.9 && minSide >= 3.0 ? 'dining-6' : 'dining-4'
        atCenter(ctx, set, R.h > R.w) ?? atCenter(ctx, 'dining-4', R.h > R.w)
      }
      onWall(ctx, 'sideboard', q, 'center')
      if (want('decor')) onWall(ctx, 'plant', q, 'corner')
      break
    }
    case 'tv_lounge':
    case 'living':
    case 'family':
    case 'basement_lounge':
    case 'drawing': {
      const tvEdge = q[0]
      if (t !== 'drawing' && want('tv')) onWall(ctx, 'tv-unit', [tvEdge], 'center', { w: Math.min(2.2, edgeLen(R, tvEdge) - 0.4) })
      const sofaEdge = opposite[tvEdge]
      const depthAvail = tvEdge === 'top' || tvEdge === 'bottom' ? R.h : R.w
      let sofa: FurnitureItem | null = null
      if (want('seating')) {
        if (depthAvail >= 3.2) {
          const big = R.w * R.h > 24 && t !== 'drawing'
          sofa = big ? onWall(ctx, 'sofa-l', [sofaEdge], 'center') : null
          sofa = sofa ?? onWall(ctx, 'sofa-3', [sofaEdge, ...q.slice(1)], 'center')
        } else sofa = onWall(ctx, 'sofa-3', q, 'center')
        if (sofa) {
          const se = edgeFromRot(sofa.rotation)
          const toward = se === 'top' ? { x: 0, y: 1 } : se === 'bottom' ? { x: 0, y: -1 } : se === 'left' ? { x: 1, y: 0 } : { x: -1, y: 0 }
          const ct = { x: sofa.position.x + toward.x * (sofa.depth / 2 + 0.75), y: sofa.position.y + toward.y * (sofa.depth / 2 + 0.75) }
          const rot = se === 'left' || se === 'right'
          const r = rot ? { x: ct.x - 0.3, y: ct.y - 0.6, w: 0.6, h: 1.2 } : { x: ct.x - 0.6, y: ct.y - 0.3, w: 1.2, h: 0.6 }
          if (want('decor')) {
            const rr = rot ? { x: ct.x - 1.1, y: ct.y - 1.5, w: 2.2, h: 3.0 } : { x: ct.x - 1.5, y: ct.y - 1.1, w: 3.0, h: 2.2 }
            if (inside(R, rr)) add(ctx, 'rug', rr, rot ? -Math.PI / 2 : 0)
          }
          if (free(ctx, r, 0.42)) add(ctx, 'coffee-table', r, rot ? -Math.PI / 2 : 0)
          // armchairs flanking the coffee table
          const side = rot ? { x: 0, y: 1 } : { x: 1, y: 0 }
          for (const s of [-1, 1]) {
            const c = { x: ct.x + side.x * s * 1.35, y: ct.y + side.y * s * 1.35 }
            const ar = { x: c.x - 0.42, y: c.y - 0.42, w: 0.85, h: 0.85 }
            if (free(ctx, ar, 0.85)) add(ctx, t === 'drawing' ? 'armchair' : 'armchair', ar, s < 0 ? (rot ? 0 : -Math.PI / 2) : rot ? Math.PI : Math.PI / 2)
          }
        }
      }
      if (t === 'drawing') onWall(ctx, 'console', q, 'center')
      if (want('decor')) {
        onWall(ctx, 'plant', q, 'corner')
        onWall(ctx, 'floor-lamp', q.slice(1), 'corner')
      }
      break
    }
    case 'foyer':
      onWall(ctx, 'console', q, 'center')
      onWall(ctx, 'shoe-cabinet', q.slice(1), 'corner')
      if (want('decor')) onWall(ctx, 'plant', q, 'corner')
      break
    case 'study':
    case 'office':
      onWall(ctx, 'desk', [...q].sort((a, b) => (ctx.windowEdges.get(b) ?? 0) - (ctx.windowEdges.get(a) ?? 0)), 'center') ?? onWall(ctx, 'study-desk', q, 'center')
      onWall(ctx, 'bookshelf', q, 'corner')
      if (t === 'office') onWall(ctx, 'bookshelf', q.slice(1), 'corner')
      onWall(ctx, 'armchair', q, 'corner')
      break
    case 'library':
      onWall(ctx, 'bookshelf', q, 'start', { w: Math.min(3, edgeLen(R, q[0]) - 0.3) })
      onWall(ctx, 'bookshelf', q.slice(1), 'start', { w: Math.min(3, edgeLen(R, q[1]) - 0.3) })
      atCenter(ctx, 'table')
      onWall(ctx, 'armchair', q, 'corner')
      break
    case 'prayer':
      for (let i = 0; i < 3; i++) onWall(ctx, 'prayer-mat', q, 'start')
      onWall(ctx, 'cabinet', q.slice(1), 'corner')
      break
    case 'laundry':
      onWall(ctx, 'washer', q, 'corner')
      onWall(ctx, 'dryer', q, 'corner')
      onWall(ctx, 'shelving', q.slice(1), 'corner', { w: 1.0 })
      break
    case 'walk_in_closet':
    case 'dressing':
      onWall(ctx, 'wardrobe', q, 'start', { w: Math.min(2.4, edgeLen(R, q[0]) - 0.1) })
      onWall(ctx, 'wardrobe', q.slice(1), 'start', { w: Math.min(1.8, edgeLen(R, q[1]) - 0.1) })
      if (R.w * R.h > 5) atCenter(ctx, 'ottoman')
      break
    case 'garage': {
      const cars = Math.max(1, opt.cars ?? room.garage?.cars ?? Math.floor(R.w / 2.9))
      const alongX = R.w >= R.h * 0.9 || R.h < 4.8
      const n = alongX ? Math.min(cars, Math.floor(R.w / 2.5)) : Math.min(cars, Math.floor(R.h / 2.5))
      for (let i = 0; i < n; i++) {
        if (alongX) {
          const cx = R.x + (R.w * (i + 0.5)) / n
          const r = { x: cx - 0.91, y: R.y + R.h / 2 - 2.3, w: 1.82, h: 4.6 }
          if (inside(R, r)) add(ctx, i % 2 ? 'suv' : 'car', i % 2 ? { x: cx - 0.975, y: R.y + R.h / 2 - 2.425, w: 1.95, h: 4.85 } : r, 0)
        } else {
          const cy = R.y + (R.h * (i + 0.5)) / n
          const r = { x: R.x + R.w / 2 - 2.3, y: cy - 0.91, w: 4.6, h: 1.82 }
          if (inside(R, r)) add(ctx, 'car', r, -Math.PI / 2)
        }
      }
      if (room.garage?.workshop) onWall(ctx, 'workbench', q, 'corner')
      if (room.garage?.storage) onWall(ctx, 'shelving', q, 'corner')
      if (room.garage?.evCharger) onWall(ctx, 'ev-charger', q, 'corner')
      break
    }
    case 'gym':
      onWall(ctx, 'treadmill', q, 'corner')
      onWall(ctx, 'exercise-bike', q, 'corner')
      atCenter(ctx, 'bench-press', R.w > R.h)
      break
    case 'home_theater': {
      const scr = onWall(ctx, 'screen', [q[0]], 'center', { w: Math.min(3.6, edgeLen(R, q[0]) - 0.6) })
      if (scr) {
        const e = opposite[edgeFromRot(scr.rotation)]
        for (let i = 0; i < 2; i++) onWall(ctx, 'theater-row', [e], 'center', { w: Math.min(3.6, edgeLen(R, e) - 0.8) })
      }
      break
    }
    case 'game_room':
      atCenter(ctx, 'pool-table', R.h > R.w)
      onWall(ctx, 'sofa-3', q, 'center')
      break
    case 'terrace':
    case 'balcony':
    case 'rooftop_garden':
      if (minSide >= 1.6) atCenter(ctx, 'outdoor-set')
      else onWall(ctx, 'outdoor-sofa', q, 'center', { d: Math.min(0.8, minSide - 0.3) })
      onWall(ctx, 'planter', q, 'corner')
      onWall(ctx, 'planter', q.slice(1), 'corner')
      break
    case 'mechanical':
      onWall(ctx, 'water-heater', q, 'corner')
      onWall(ctx, 'cabinet', q, 'corner')
      break
    default:
      break
  }
  return ctx.items
}

function kitchenRuns(ctx: Ctx, q: EdgeName[], main: boolean) {
  const R = ctx.R
  const edges = q.filter((e) => edgeLen(R, e) >= 1.8)
  if (!edges.length) return
  const first = edges[0]
  const L1 = edgeLen(R, first) - 0.05
  // fridge at the start, hob in the middle, plain counter to fill
  const seq: { key: string; w: number }[] = []
  let rest = L1
  if (main && rest >= 2.6) {
    seq.push({ key: 'fridge', w: 0.8 })
    rest -= 0.8
  }
  const hob = Math.min(1.8, rest)
  seq.push({ key: 'kitchen-hob', w: hob })
  rest -= hob
  if (rest >= 0.6) seq.push({ key: 'kitchen-run', w: rest })
  let t = 0.025
  for (const s of seq) {
    const r = rectOnEdge(R, first, t + s.w / 2, s.w, s.key === 'fridge' ? 0.72 : 0.62)
    if (free(ctx, r, s.key === 'fridge' ? 1.85 : 0.9)) add(ctx, s.key, r, EDGE_ROT[first], { width: s.w })
    else if (s.key !== 'fridge') {
      // try a shorter piece if a window or door interferes
      const w2 = s.w * 0.6
      const r2 = rectOnEdge(R, first, t + w2 / 2, w2, 0.62)
      if (w2 > 0.6 && free(ctx, r2, 0.9)) add(ctx, s.key, r2, EDGE_ROT[first], { width: w2 })
    }
    t += s.w
  }
  // second run (sink) on an adjacent wall → L shape
  const adj = (first === 'top' || first === 'bottom' ? ['left', 'right'] : ['top', 'bottom']) as EdgeName[]
  adj.sort((a, b) => (ctx.windowEdges.get(b) ?? 0) - (ctx.windowEdges.get(a) ?? 0))
  for (const e of adj) {
    const L = edgeLen(R, e) - 0.7
    if (L < 1.2) continue
    const w = Math.min(2.4, L)
    for (const tt of [0.66 + w / 2, edgeLen(R, e) - 0.66 - w / 2]) {
      const r = rectOnEdge(R, e, tt, w, 0.62)
      if (free(ctx, r, 0.9)) {
        add(ctx, 'kitchen-sink', r, EDGE_ROT[e], { width: w })
        return
      }
    }
  }
  onWall(ctx, 'kitchen-sink', edges.slice(1), 'center', { w: 1.2 })
}

function edgeOf(R: Rect, a: Vec2, b: Vec2): EdgeName | null {
  const tol = 0.3
  if (Math.abs(a.y - b.y) < 1e-3) {
    if (Math.abs(a.y - R.y) < tol) return 'top'
    if (Math.abs(a.y - (R.y + R.h)) < tol) return 'bottom'
  }
  if (Math.abs(a.x - b.x) < 1e-3) {
    if (Math.abs(a.x - R.x) < tol) return 'left'
    if (Math.abs(a.x - (R.x + R.w)) < tol) return 'right'
  }
  return null
}

/** Rectangle inside R adjacent to the wall segment a–b, reaching `depth` into the room. */
function stripInside(R: Rect, a: Vec2, b: Vec2, depth: number, pad = 0): Rect {
  const x0 = Math.min(a.x, b.x) - pad
  const x1 = Math.max(a.x, b.x) + pad
  const y0 = Math.min(a.y, b.y) - pad
  const y1 = Math.max(a.y, b.y) + pad
  if (Math.abs(a.y - b.y) < 1e-3) {
    // horizontal wall: into the room vertically
    const top = Math.abs(a.y - R.y) < Math.abs(a.y - (R.y + R.h))
    return top ? { x: x0, y: R.y - 0.2, w: x1 - x0, h: depth + 0.2 } : { x: x0, y: R.y + R.h - depth, w: x1 - x0, h: depth + 0.2 }
  }
  const left = Math.abs(a.x - R.x) < Math.abs(a.x - (R.x + R.w))
  return left ? { x: R.x - 0.2, y: y0, w: depth + 0.2, h: y1 - y0 } : { x: R.x + R.w - depth, y: y0, w: depth + 0.2, h: y1 - y0 }
}

function edgeFromRot(rot: number): EdgeName {
  const r = ((rot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  if (Math.abs(r) < 0.1 || Math.abs(r - 2 * Math.PI) < 0.1) return 'top'
  if (Math.abs(r - Math.PI) < 0.1) return 'bottom'
  if (Math.abs(r - (3 * Math.PI) / 2) < 0.1) return 'left'
  return 'right'
}

function tAlong(R: Rect, e: EdgeName, p: Vec2) {
  return e === 'top' || e === 'bottom' ? p.x - R.x : p.y - R.y
}

/** Re-furnish every room on a floor (keeps nothing). */
export function furnishFloor(floor: Floor, ids: IdFactory, opt: FurnishOptions = {}): FurnitureItem[] {
  const out: FurnitureItem[] = []
  for (const r of floor.rooms) out.push(...furnishRoom(floor, r, ids, opt))
  return out
}
