import type { DoorStyle, Floor, Opening, Room, Wall, WindowStyle } from '../../core/model/types'
import type { IdFactory } from '../../core/model/ids'
import type { Rect } from '../../core/geometry/polygon'
import { bbox, centroid } from '../../core/geometry/polygon'
import { spec, isBathType, isBedroomType } from '../../core/constraints/rooms'
import { effectiveKind, wallsOfRoom } from '../walls'
import { projectT, segLength } from '../../core/geometry/segment'
import { ft } from '../../core/units/units'

/**
 * Doors follow the access graph (room → circulation hub, attached room → parent, entrance,
 * service doors); windows go on open exterior walls — never on party walls with a zero side
 * setback — sized by room type, natural-light preference, privacy and style.
 */

export interface OpeningContext {
  /** Plot boundary lines shared with neighbours — no windows there. */
  party: { left?: number; right?: number; back?: number }
  largeWindows: boolean
  lightPref: number
  privacyPref: number
  openPlan: boolean
  windowScale: number
  modern: boolean
  isGround: boolean
  isBasement: boolean
  /** Light well rectangles (basement windows face these). */
  lightWells: Rect[]
  mainEntranceRoomId?: string
  patioBehind?: { x0: number; x1: number }
  ids: IdFactory
}

interface Shared {
  wall: Wall
  t0: number
  t1: number
  sideA: 'left' | 'right'
}

export function sharedWalls(floor: Floor, a: Room, b: Room): Shared[] {
  const wa = wallsOfRoom(floor, a)
  const wb = wallsOfRoom(floor, b)
  const out: Shared[] = []
  for (const x of wa) {
    for (const y of wb) {
      if (x.wall.id !== y.wall.id || x.side === y.side) continue
      const t0 = Math.max(x.t0, y.t0)
      const t1 = Math.min(x.t1, y.t1)
      if (t1 - t0 > 0.3) out.push({ wall: x.wall, t0, t1, sideA: x.side })
    }
  }
  return out.sort((p, q) => q.t1 - q.t0 - (p.t1 - p.t0))
}

function overlapsExisting(openings: Opening[], wallId: string, offset: number, width: number, gap = 0.25) {
  return openings.some((o) => o.wallId === wallId && Math.abs(o.offset - offset) < (o.width + width) / 2 + gap)
}

function placeOnInterval(openings: Opening[], s: { wall: Wall; t0: number; t1: number }, width: number, prefer: 'start' | 'end' | 'center'): number | null {
  const L = s.t1 - s.t0
  const margin = Math.min(0.25, Math.max(0.08, (L - width) / 4))
  if (L < width + 2 * 0.08) return null
  const lo = s.t0 + margin + width / 2
  const hi = s.t1 - margin - width / 2
  if (hi < lo) return null
  const candidates = prefer === 'center' ? [(lo + hi) / 2, lo, hi] : prefer === 'start' ? [lo, (lo + hi) / 2, hi] : [hi, (lo + hi) / 2, lo]
  for (let k = 0; k <= 8; k++) {
    for (const c of candidates) {
      const off = Math.min(hi, Math.max(lo, c + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35))
      if (!overlapsExisting(openings, s.wall.id, off, width)) return off
    }
  }
  return null
}

export function addDoor(
  floor: Floor,
  openings: Opening[],
  a: Room,
  b: Room | null,
  style: DoorStyle,
  width: number,
  ids: IdFactory,
  opts: { swingInto?: Room; prefer?: 'start' | 'end' | 'center'; towards?: { x: number; y: number } } = {}
): Opening | null {
  let cands: Shared[]
  if (b) cands = sharedWalls(floor, a, b)
  else cands = wallsOfRoom(floor, a).filter((w) => effectiveKind(w.wall) === 'exterior').map((w) => ({ wall: w.wall, t0: w.t0, t1: w.t1, sideA: w.side }))
  for (const s of cands) {
    if (effectiveKind(s.wall) === 'virtual') return null // already open
    if (effectiveKind(s.wall) === 'railing') continue
    let prefer = opts.prefer ?? 'center'
    if (opts.towards) {
      const L = segLength(s.wall.a, s.wall.b)
      const tt = projectT(opts.towards, s.wall.a, s.wall.b) * L
      prefer = Math.abs(tt - s.t0) < Math.abs(tt - s.t1) ? 'start' : 'end'
    }
    const off = placeOnInterval(openings, s, width, prefer)
    if (off === null) continue
    const into = opts.swingInto ?? a
    const intoSide = into === a ? s.sideA : s.sideA === 'left' ? 'right' : 'left'
    const op: Opening = {
      id: ids('opn'),
      kind: 'door',
      wallId: s.wall.id,
      offset: off,
      width,
      height: style === 'garage' ? 2.4 : style === 'main' ? 2.4 : 2.13,
      sill: 0,
      style,
      hinge: off - s.t0 < s.t1 - off ? 'start' : 'end',
      swing: intoSide
    }
    openings.push(op)
    return op
  }
  return null
}

function addWindow(openings: Opening[], s: { wall: Wall; t0: number; t1: number }, width: number, height: number, sill: number, style: WindowStyle, ids: IdFactory, prefer: 'center' | 'start' | 'end' = 'center') {
  const w = Math.min(width, s.t1 - s.t0 - 0.3)
  if (w < 0.45) return null
  const off = placeOnInterval(openings, s, w, prefer)
  if (off === null) return null
  const op: Opening = { id: ids('opn'), kind: 'window', wallId: s.wall.id, offset: off, width: w, height, sill, style }
  openings.push(op)
  return op
}

/** Is the wall on a plot boundary shared with a neighbour? */
export function onPartyLine(w: Wall, party: OpeningContext['party']): boolean {
  const tol = 0.5
  const vertical = Math.abs(w.a.x - w.b.x) < 1e-3
  const horizontal = Math.abs(w.a.y - w.b.y) < 1e-3
  if (vertical && party.left !== undefined && Math.abs(w.a.x - party.left) < tol) return true
  if (vertical && party.right !== undefined && Math.abs(w.a.x - party.right) < tol) return true
  if (horizontal && party.back !== undefined && Math.abs(w.a.y - party.back) < tol) return true
  return false
}

export function placeWindows(floor: Floor, openings: Opening[], ctx: OpeningContext) {
  const ids = ctx.ids
  const k = ctx.windowScale * (0.85 + 0.3 * (ctx.lightPref / 100)) * (ctx.largeWindows ? 1.25 : 1)
  for (const room of floor.rooms) {
    const sp = spec(room.type)
    if (!sp.walkable || room.type === 'garage' || sp.outdoor) continue
    const ws = wallsOfRoom(floor, room).filter((x) => effectiveKind(x.wall) === 'exterior')
    let placed = 0
    for (const x of ws) {
      const other = otherRoom(floor, x.wall, x.side, room)
      if (other?.type === 'garage') continue
      const facesOutdoorRoom = other && spec(other.type).outdoor
      if (onPartyLine(x.wall, ctx.party) && !facesOutdoorRoom) continue // shared boundary wall
      const horiz = Math.abs(x.wall.a.y - x.wall.b.y) < 1e-3
      const edge = horiz && centroid(room.polygon).y < x.wall.a.y ? 'front' : null
      if (ctx.isBasement) {
        // only towards light wells
        const hits = ctx.lightWells.some((lw) => intervalNearRect(x, lw))
        if (!hits) continue
      }
      const L = x.t1 - x.t0
      if (L < 0.9) continue
      if (isBathType(room.type) || room.type === 'laundry' || room.type === 'store' || room.type === 'pantry' || room.type === 'mechanical') {
        if (placed === 0) addWindow(openings, x, 0.6, 0.6, 1.8, 'ventilator', ids) && placed++
        continue
      }
      if (room.type === 'stair' || room.type === 'mumty') {
        const clear = floor.height - floor.slabThickness
        addWindow(openings, x, Math.min(1.0, L * 0.4), Math.min(2.1, clear - 1.1), 0.9, 'fixed', ids) && placed++
        continue
      }
      if (room.type === 'walk_in_closet' || room.type === 'dressing') {
        if (placed === 0) addWindow(openings, x, 0.9, 0.9, 1.4, 'casement', ids) && placed++
        continue
      }
      if (room.type === 'home_theater') continue
      let width = 1.5 * k
      let height = 1.4
      let sill = 0.9
      let style: WindowStyle = 'casement'
      if (room.type === 'kitchen' || room.type === 'dirty_kitchen') {
        width = 1.2 * k
        height = 1.1
        sill = 1.05
        style = 'sliding'
      } else if (['tv_lounge', 'drawing', 'living', 'family', 'dining', 'basement_lounge', 'foyer'].includes(room.type)) {
        if (ctx.largeWindows || ctx.modern) {
          width = Math.min(3.0 * k, L * 0.7)
          height = 2.3
          sill = 0.1
          style = 'full-height'
        } else width = 1.8 * k
      } else if (isBedroomType(room.type)) {
        width = (ctx.largeWindows ? 1.9 : 1.5) * k
        height = ctx.largeWindows ? 1.8 : 1.4
        sill = ctx.largeWindows ? 0.5 : 0.9
        if (ctx.isGround && edge === 'front' && ctx.privacyPref >= 70) {
          sill = 1.3
          height = 0.9
        }
      }
      if (ctx.isBasement) {
        height = Math.min(height, 1.0)
        sill = 1.6
        style = 'sliding'
      }
      height = Math.min(height, floor.height - floor.slabThickness - 0.2 - sill)
      const count = L > 6.5 ? 2 : 1
      if (count === 2) {
        const half = (L - 0.2) / 2
        addWindow(openings, { wall: x.wall, t0: x.t0, t1: x.t0 + half }, Math.min(width, half * 0.75), height, sill, style, ids)
        addWindow(openings, { wall: x.wall, t0: x.t1 - half, t1: x.t1 }, Math.min(width, half * 0.75), height, sill, style, ids)
        placed += 2
      } else if (addWindow(openings, x, Math.min(width, L * 0.72), height, sill, style, ids)) placed++
    }
  }
}

function intervalNearRect(x: { wall: Wall; t0: number; t1: number }, r: Rect) {
  const L = segLength(x.wall.a, x.wall.b)
  const pa = { x: x.wall.a.x + ((x.wall.b.x - x.wall.a.x) * x.t0) / L, y: x.wall.a.y + ((x.wall.b.y - x.wall.a.y) * x.t0) / L }
  const pb = { x: x.wall.a.x + ((x.wall.b.x - x.wall.a.x) * x.t1) / L, y: x.wall.a.y + ((x.wall.b.y - x.wall.a.y) * x.t1) / L }
  const pad = 0.4
  const inside = (p: { x: number; y: number }) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad
  const m = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
  return inside(m)
}

export function otherRoom(floor: Floor, wall: Wall, side: 'left' | 'right', self: Room): Room | undefined {
  const mid = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 }
  void mid
  for (const r of floor.rooms) {
    if (r.id === self.id) continue
    for (const x of wallsOfRoom(floor, r)) if (x.wall.id === wall.id && x.side !== side) return r
  }
  return undefined
}

export const DOOR_W = { main: 1.35, room: ft(3), bath: ft(2.5), wide: ft(6), garage: 2.6 }

export function roomCenter(r: Room) {
  return centroid(r.polygon)
}

export function roomRect(r: Room): Rect {
  return bbox(r.polygon)
}
