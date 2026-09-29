import type { Floor, Room, Vec2 } from '../core/model/types'
import { bbox, pointInPolygon } from '../core/geometry/polygon'
import { add, norm, perp, scale, sub } from '../core/geometry/vec'
import { spec, isBedroomType } from '../core/constraints/rooms'
import { effectiveKind, wallsOfRoom } from './walls'
import { segLength } from '../core/geometry/segment'

/**
 * Electrical / lighting / plumbing concept (§32, §58) derived from rooms, doors and fixtures.
 * These are concept layouts for discussion with an MEP engineer, not construction documents.
 */

export type ServiceKind =
  | 'switch'
  | 'socket'
  | 'light'
  | 'fan'
  | 'ac'
  | 'db'
  | 'downlight'
  | 'chandelier'
  | 'pendant'
  | 'cove'
  | 'wall-light'
  | 'fixture'
  | 'shaft'

export interface ServicePoint {
  kind: ServiceKind
  p: Vec2
  rot: number
  roomId?: string
  label?: string
}

export interface ServiceLine {
  kind: 'supply' | 'drain'
  pts: Vec2[]
}

export interface Services {
  electrical: ServicePoint[]
  lighting: ServicePoint[]
  plumbing: ServicePoint[]
  lines: ServiceLine[]
}

const FAN_ROOMS = new Set(['master_bedroom', 'bedroom', 'guest_bedroom', 'kids_room', 'tv_lounge', 'drawing', 'living', 'family', 'dining', 'study', 'office', 'servant', 'basement_lounge', 'prayer', 'library'])
const AC_ROOMS = new Set(['master_bedroom', 'bedroom', 'guest_bedroom', 'kids_room', 'tv_lounge', 'drawing', 'living', 'family', 'study', 'office', 'home_theater', 'gym', 'library', 'basement_lounge'])
const WET_FIXTURES = new Set(['wc', 'vanity', 'basin', 'shower', 'bathtub', 'kitchen-sink', 'washer', 'dryer', 'water-heater'])

export function deriveServices(floor: Floor): Services {
  const electrical: ServicePoint[] = []
  const lighting: ServicePoint[] = []
  const plumbing: ServicePoint[] = []
  const lines: ServiceLine[] = []
  const rooms = floor.rooms.filter((r) => spec(r.type).walkable)

  // switches beside every door, inside the room the door swings into
  for (const o of floor.openings) {
    if (o.kind !== 'door') continue
    const w = floor.walls.find((x) => x.id === o.wallId)
    if (!w) continue
    const d = norm(sub(w.b, w.a))
    const n = perp(d)
    const side = o.swing === 'right' ? -1 : 1
    const latchT = o.hinge === 'end' ? o.offset - o.width / 2 - 0.18 : o.offset + o.width / 2 + 0.18
    const p = add(add(w.a, scale(d, latchT)), scale(n, side * (w.thickness / 2 + 0.06)))
    const room = rooms.find((r) => pointInPolygon(p, r.polygon))
    if (room && !spec(room.type).outdoor) electrical.push({ kind: 'switch', p, rot: Math.atan2(n.y * side, n.x * side), roomId: room.id })
  }

  for (const r of rooms) {
    const sp = spec(r.type)
    if (sp.outdoor && r.type !== 'terrace') continue
    const b = bbox(r.polygon)
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    // sockets every ~3 m along solid walls
    if (!sp.outdoor && r.type !== 'stair' && r.type !== 'corridor' && r.type !== 'void') {
      for (const x of wallsOfRoom(floor, r)) {
        if (effectiveKind(x.wall) === 'virtual' || effectiveKind(x.wall) === 'railing') continue
        const L = x.t1 - x.t0
        if (L < 1.2) continue
        const n = Math.max(1, Math.floor(L / 3))
        const d = norm(sub(x.wall.b, x.wall.a))
        const nrm = perp(d)
        const s = x.side === 'left' ? 1 : -1
        for (let i = 0; i < n; i++) {
          const t = x.t0 + ((i + 0.5) * L) / n
          const blocked = floor.openings.some((o) => o.wallId === x.wall.id && Math.abs(o.offset - t) < o.width / 2 + 0.25)
          if (blocked) continue
          electrical.push({ kind: 'socket', p: add(add(x.wall.a, scale(d, t)), scale(nrm, s * (x.wall.thickness / 2 + 0.07))), rot: Math.atan2(nrm.y * s, nrm.x * s), roomId: r.id })
        }
      }
    }
    if (FAN_ROOMS.has(r.type)) electrical.push({ kind: 'fan', p: c, rot: 0, roomId: r.id })
    if (AC_ROOMS.has(r.type)) {
      const ext = wallsOfRoom(floor, r).find((x) => effectiveKind(x.wall) === 'exterior' && x.t1 - x.t0 > 1.5)
      if (ext) {
        const d = norm(sub(ext.wall.b, ext.wall.a))
        const nrm = perp(d)
        const s = ext.side === 'left' ? 1 : -1
        const t = (ext.t0 + ext.t1) / 2
        const blocked = floor.openings.some((o) => o.wallId === ext.wall.id && Math.abs(o.offset - t) < o.width / 2 + 0.6)
        const tt = blocked ? Math.min(ext.t1 - 0.6, t + 1.2) : t
        electrical.push({ kind: 'ac', p: add(add(ext.wall.a, scale(d, tt)), scale(nrm, s * (ext.wall.thickness / 2 + 0.12))), rot: Math.atan2(nrm.y * s, nrm.x * s), roomId: r.id })
      }
    }
    // lighting concept
    lighting.push(...lightsForRoom(r))
  }

  // distribution board beside the main entrance
  if (floor.level === 0) {
    const main = floor.openings.find((o) => o.style === 'main')
    const w = main && floor.walls.find((x) => x.id === main.wallId)
    if (main && w) {
      const d = norm(sub(w.b, w.a))
      const n = perp(d)
      for (const s of [1, -1]) {
        const p = add(add(w.a, scale(d, main.offset + main.width / 2 + 0.45)), scale(n, s * (w.thickness / 2 + 0.08)))
        if (rooms.some((r) => pointInPolygon(p, r.polygon) && !spec(r.type).outdoor && r.type !== 'garage')) {
          electrical.push({ kind: 'db', p, rot: Math.atan2(n.y * s, n.x * s), label: 'DB' })
          break
        }
      }
    }
  }

  // plumbing: fixtures from furniture, one shaft per wet room on its exterior wall
  const wetRooms = rooms.filter((r) => spec(r.type).wet)
  for (const r of wetRooms) {
    const fixtures = floor.furniture.filter((f) => WET_FIXTURES.has(f.type) && pointInPolygon(f.position, r.polygon))
    if (!fixtures.length) continue
    const ext = wallsOfRoom(floor, r).find((x) => effectiveKind(x.wall) === 'exterior')
    const b = bbox(r.polygon)
    let shaft: Vec2 = { x: b.x + 0.2, y: b.y + 0.2 }
    if (ext) {
      const d = norm(sub(ext.wall.b, ext.wall.a))
      const n = perp(d)
      const s = ext.side === 'left' ? 1 : -1
      const t = ext.t0 + 0.3
      shaft = add(add(ext.wall.a, scale(d, t)), scale(n, s * (ext.wall.thickness / 2 + 0.15)))
    }
    plumbing.push({ kind: 'shaft', p: shaft, rot: 0, roomId: r.id, label: 'S' })
    for (const fx of fixtures) {
      plumbing.push({ kind: 'fixture', p: fx.position, rot: fx.rotation, roomId: r.id, label: fx.type })
      const corner = { x: fx.position.x, y: shaft.y }
      lines.push({ kind: 'supply', pts: [shaft, corner, fx.position] })
      lines.push({ kind: 'drain', pts: [fx.position, { x: shaft.x, y: fx.position.y }, shaft] })
    }
  }
  void segLength
  return { electrical, lighting, plumbing, lines }
}

export function lightsForRoom(r: Room): ServicePoint[] {
  const sp = spec(r.type)
  const b = bbox(r.polygon)
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const out: ServicePoint[] = []
  const fixture = r.lighting?.fixture
  if (r.type === 'void' || r.type === 'lift') return out
  if (sp.outdoor) {
    out.push({ kind: 'wall-light', p: c, rot: 0, roomId: r.id })
    return out
  }
  const grid = (spacing: number, inset: number) => {
    const nx = Math.max(1, Math.round((b.w - 2 * inset) / spacing) + 1)
    const ny = Math.max(1, Math.round((b.h - 2 * inset) / spacing) + 1)
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const p = { x: nx === 1 ? c.x : b.x + inset + ((b.w - 2 * inset) * i) / (nx - 1), y: ny === 1 ? c.y : b.y + inset + ((b.h - 2 * inset) * j) / (ny - 1) }
        if (pointInPolygon(p, r.polygon)) out.push({ kind: 'downlight', p, rot: 0, roomId: r.id })
      }
  }
  if (fixture === 'chandelier' || (!fixture && ['drawing', 'dining', 'foyer'].includes(r.type))) {
    out.push({ kind: 'chandelier', p: c, rot: 0, roomId: r.id })
    grid(1.8, 0.7)
  } else if (fixture === 'pendant' || (!fixture && r.type === 'kitchen')) {
    grid(1.5, 0.6)
    out.push({ kind: 'pendant', p: c, rot: 0, roomId: r.id })
  } else if (fixture === 'cove') {
    out.push({ kind: 'cove', p: c, rot: 0, roomId: r.id })
    grid(2.0, 0.8)
  } else if (isBedroomType(r.type) || fixture === 'panel' || fixture === 'fan-light') {
    out.push({ kind: 'light', p: c, rot: 0, roomId: r.id })
    if (b.w > 3 && b.h > 3) grid(2.2, 0.7)
  } else grid(1.6, 0.55)
  return out
}
