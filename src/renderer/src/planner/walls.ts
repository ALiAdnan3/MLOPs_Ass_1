import type { Floor, Opening, ProjectSettings, Room, RoomType, Vec2, Wall, WallKind } from '../core/model/types'
import { uid, type IdFactory } from '../core/model/ids'
import { pointInPolygon, removeCollinear } from '../core/geometry/polygon'
import { add, dist, dot, norm, perp, scale, sub } from '../core/geometry/vec'
import { projectT, segLength } from '../core/geometry/segment'
import { spec } from '../core/constraints/rooms'

/**
 * Walls are derived from room boundaries (rooms are the primary spatial entity):
 *  - every room edge becomes a wall piece; shared edges between rooms become one interior wall;
 *  - wall kind (exterior / interior / railing / parapet / virtual) follows from the rooms on each side;
 *  - wall IDs, per-side finishes and user overrides survive rebuilds by matching on line + overlap;
 *  - doors and windows are re-hosted by world position, so they follow parametric edits.
 */

const ANG_TOL = 1e-3
const OFF_TOL = 2e-3
const T_TOL = 1e-3

interface EdgeRec {
  a: Vec2
  b: Vec2
  room: Room
  /** Room interior is on the perp() side of a→b. */
  roomOnLeft: boolean
}

interface LineGroup {
  dir: Vec2
  origin: Vec2
  edges: { t0: number; t1: number; room: Room; left: boolean }[]
}

function canonicalDir(a: Vec2, b: Vec2): Vec2 {
  let d = norm(sub(b, a))
  if (d.x < -1e-9 || (Math.abs(d.x) <= 1e-9 && d.y < 0)) d = { x: -d.x, y: -d.y }
  return d
}

export function roomEdges(room: Room): EdgeRec[] {
  const poly = removeCollinear(room.polygon)
  const out: EdgeRec[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (dist(a, b) < 1e-3) continue
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const n = perp(norm(sub(b, a)))
    const probe = add(m, scale(n, 0.02))
    out.push({ a, b, room, roomOnLeft: pointInPolygon(probe, poly) })
  }
  return out
}

const CIRCULATION_OPEN_TO_STAIR: RoomType[] = ['tv_lounge', 'family', 'foyer', 'corridor', 'basement_lounge', 'living', 'dining']

export function computeWallKind(left?: Room, right?: Room): WallKind {
  const l = left?.type
  const r = right?.type
  if (!l && !r) return 'virtual'
  if (!l || !r) {
    const room = (left ?? right)!
    const t = room.type
    if (t === 'balcony') return 'railing'
    if (t === 'terrace' || t === 'rooftop_garden') return 'parapet'
    if (t === 'garage' && room.enclosed === false) return 'virtual'
    return 'exterior'
  }
  const ls = spec(l)
  const rs = spec(r)
  if (l === 'garage' || r === 'garage') return l === r ? 'virtual' : 'exterior'
  if (l === 'void' || r === 'void') {
    const voidRoom = l === 'void' ? left! : right!
    const other = l === 'void' ? r : l
    if (other === 'void') return 'virtual'
    if (spec(other).circulation || spec(other).outdoor) return 'railing'
    return voidRoom.openToSky ? 'exterior' : 'interior'
  }
  if (ls.outdoor && rs.outdoor) return 'virtual'
  if (ls.outdoor !== rs.outdoor) return 'exterior'
  if ((l === 'stair' && CIRCULATION_OPEN_TO_STAIR.includes(r)) || (r === 'stair' && CIRCULATION_OPEN_TO_STAIR.includes(l))) return 'virtual'
  return 'interior'
}

export function defaultThickness(kind: WallKind, settings: Pick<ProjectSettings, 'wallThickness'>): number {
  switch (kind) {
    case 'exterior':
      return settings.wallThickness.exterior
    case 'interior':
      return settings.wallThickness.interior
    case 'parapet':
      return settings.wallThickness.interior
    case 'railing':
      return 0.06
    default:
      return 0
  }
}

export const effectiveKind = (w: Wall): WallKind => w.kindOverride ?? w.kind

export interface RebuildResult {
  walls: Wall[]
  openings: Opening[]
  droppedOpenings: Opening[]
}

/**
 * Rebuild room-derived walls for one floor. Manual walls are kept as-is.
 * `centerOverride` lets callers move specific openings (e.g. with a dragged edge).
 */
export function rebuildWalls(floor: Floor, settings: Pick<ProjectSettings, 'wallThickness'>, ids: IdFactory = uid, centerOverride?: Map<string, Vec2>): RebuildResult {
  // 1. group room edges by supporting line
  const groups: LineGroup[] = []
  for (const room of floor.rooms) {
    for (const e of roomEdges(room)) {
      const d = canonicalDir(e.a, e.b)
      const n = perp(d)
      const off = dot(e.a, n)
      let g = groups.find((gr) => Math.abs(gr.dir.x - d.x) < ANG_TOL && Math.abs(gr.dir.y - d.y) < ANG_TOL && Math.abs(dot(gr.origin, perp(gr.dir)) - off) < OFF_TOL)
      if (!g) {
        g = { dir: d, origin: scale(n, off), edges: [] }
        groups.push(g)
      }
      const ta = dot(sub(e.a, g.origin), g.dir)
      const tb = dot(sub(e.b, g.origin), g.dir)
      const same = dot(sub(e.b, e.a), g.dir) > 0
      g.edges.push({ t0: Math.min(ta, tb), t1: Math.max(ta, tb), room: e.room, left: same ? e.roomOnLeft : !e.roomOnLeft })
    }
  }

  // 2. elementary intervals → pieces with (left room, right room)
  interface Piece {
    t0: number
    t1: number
    left?: Room
    right?: Room
    kind: WallKind
  }
  const newWalls: Wall[] = []
  // deterministic order
  groups.sort((g1, g2) => g1.origin.x + g1.origin.y - (g2.origin.x + g2.origin.y) || g1.dir.x - g2.dir.x)
  for (const g of groups) {
    const ts = uniqSorted(g.edges.flatMap((e) => [e.t0, e.t1]))
    const pieces: Piece[] = []
    for (let i = 0; i < ts.length - 1; i++) {
      const t0 = ts[i]
      const t1 = ts[i + 1]
      if (t1 - t0 < T_TOL) continue
      const tm = (t0 + t1) / 2
      let left: Room | undefined
      let right: Room | undefined
      for (const e of g.edges) {
        if (e.t0 <= tm && e.t1 >= tm) {
          if (e.left) left = left ?? e.room
          else right = right ?? e.room
        }
      }
      if (!left && !right) continue
      pieces.push({ t0, t1, left, right, kind: computeKind(left, right) })
    }
    // 3. merge contiguous pieces of the same kind
    let cur: Piece | null = null
    const flush = () => {
      if (!cur) return
      const a = add(g.origin, scale(g.dir, cur.t0))
      const b = add(g.origin, scale(g.dir, cur.t1))
      newWalls.push({
        id: '',
        a: roundV(a),
        b: roundV(b),
        thickness: defaultThickness(cur.kind, settings),
        kind: cur.kind,
        source: 'rooms'
      })
    }
    for (const p of pieces) {
      const c = cur as Piece | null
      if (c && Math.abs(c.t1 - p.t0) < T_TOL && c.kind === p.kind) cur = { ...c, t1: p.t1 }
      else {
        flush()
        cur = { ...p }
      }
    }
    flush()
  }

  // 4. match with previous walls to keep IDs and overrides
  const oldRoomWalls = floor.walls.filter((w) => w.source === 'rooms')
  const manual = floor.walls.filter((w) => w.source === 'manual')
  const usedOld = new Set<string>()
  const candidates: { ni: number; oi: number; overlap: number }[] = []
  newWalls.forEach((nw, ni) => {
    oldRoomWalls.forEach((ow, oi) => {
      const ov = lineOverlap(nw, ow)
      if (ov > 0.05) candidates.push({ ni, oi, overlap: ov })
    })
  })
  candidates.sort((x, y) => y.overlap - x.overlap)
  const assigned = new Map<number, Wall>()
  for (const c of candidates) {
    if (assigned.has(c.ni)) continue
    const ow = oldRoomWalls[c.oi]
    if (usedOld.has(ow.id)) continue
    usedOld.add(ow.id)
    assigned.set(c.ni, ow)
  }
  newWalls.forEach((nw, ni) => {
    const old = assigned.get(ni) ?? bestOverlap(nw, oldRoomWalls)
    const keepId = assigned.get(ni)
    nw.id = keepId ? keepId.id : ids('wal')
    if (old) {
      const reversed = dot(sub(nw.b, nw.a), sub(old.b, old.a)) < 0
      if (old.kindOverride) nw.kindOverride = old.kindOverride
      if (old.height !== undefined) nw.height = old.height
      if (old.thicknessLocked) {
        nw.thickness = old.thickness
        nw.thicknessLocked = true
      }
      if (old.sideMaterials) {
        nw.sideMaterials = reversed ? { left: old.sideMaterials.right, right: old.sideMaterials.left } : { ...old.sideMaterials }
      }
    }
  })

  const walls = [...newWalls, ...manual]

  // 5. re-host openings by world position
  const oldById = new Map(floor.walls.map((w) => [w.id, w]))
  const openings: Opening[] = []
  const dropped: Opening[] = []
  for (const op of floor.openings) {
    const ow = oldById.get(op.wallId)
    if (!ow) {
      dropped.push(op)
      continue
    }
    const L = segLength(ow.a, ow.b)
    const center = centerOverride?.get(op.id) ?? add(ow.a, scale(norm(sub(ow.b, ow.a)), Math.min(Math.max(op.offset, 0), L)))
    const host = findHost(center, ow, walls)
    if (!host) {
      dropped.push(op)
      continue
    }
    const HL = segLength(host.a, host.b)
    let offset = projectT(center, host.a, host.b) * HL
    const half = op.width / 2
    if (HL < op.width + 0.1) {
      dropped.push(op)
      continue
    }
    offset = Math.min(Math.max(offset, half + 0.05), HL - half - 0.05)
    const reversed = dot(sub(host.b, host.a), sub(ow.b, ow.a)) < 0
    openings.push({
      ...op,
      wallId: host.id,
      offset,
      hinge: reversed && op.hinge ? (op.hinge === 'start' ? 'end' : 'start') : op.hinge,
      swing: reversed && op.swing ? (op.swing === 'left' ? 'right' : 'left') : op.swing
    })
  }
  return { walls, openings, droppedOpenings: dropped }
}

function computeKind(left?: Room, right?: Room): WallKind {
  return computeWallKind(left, right)
}

function uniqSorted(values: number[]): number[] {
  const s = [...values].sort((a, b) => a - b)
  const out: number[] = []
  for (const v of s) if (!out.length || v - out[out.length - 1] > T_TOL) out.push(v)
  return out
}

const roundV = (p: Vec2): Vec2 => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 })

/** Overlap length of two walls if they lie on the same line (else 0). */
export function lineOverlap(w1: Pick<Wall, 'a' | 'b'>, w2: Pick<Wall, 'a' | 'b'>): number {
  const d = norm(sub(w1.b, w1.a))
  const n = perp(d)
  if (Math.abs(dot(sub(w2.a, w1.a), n)) > 0.02 || Math.abs(dot(sub(w2.b, w1.a), n)) > 0.02) return 0
  const L = segLength(w1.a, w1.b)
  const t1 = dot(sub(w2.a, w1.a), d)
  const t2 = dot(sub(w2.b, w1.a), d)
  const lo = Math.max(0, Math.min(t1, t2))
  const hi = Math.min(L, Math.max(t1, t2))
  return Math.max(0, hi - lo)
}

function bestOverlap(nw: Wall, olds: Wall[]): Wall | undefined {
  let best: Wall | undefined
  let bo = 0.05
  for (const o of olds) {
    const ov = lineOverlap(nw, o)
    if (ov > bo) {
      bo = ov
      best = o
    }
  }
  return best
}

function findHost(center: Vec2, oldWall: Wall, walls: Wall[]): Wall | undefined {
  const d = norm(sub(oldWall.b, oldWall.a))
  let best: Wall | undefined
  let bestScore = Infinity
  for (const w of walls) {
    const wd = norm(sub(w.b, w.a))
    const parallel = Math.abs(Math.abs(dot(wd, d)) - 1) < 0.01
    if (!parallel) continue
    const L = segLength(w.a, w.b)
    const t = projectT(center, w.a, w.b)
    if (t < -0.001 || t > 1.001) continue
    const p = add(w.a, scale(wd, t * L))
    const off = dist(p, center)
    if (off > Math.max(0.35, w.thickness)) continue
    if (off < bestScore) {
      bestScore = off
      best = w
    }
  }
  return best
}

/** Rooms on the left / right of a wall (sampled at a point along it). */
export function roomsBesideWall(floor: Floor, w: Pick<Wall, 'a' | 'b'>, t = 0.5): { left?: Room; right?: Room } {
  const p = add(w.a, scale(sub(w.b, w.a), t))
  const n = perp(norm(sub(w.b, w.a)))
  const pl = add(p, scale(n, 0.05))
  const pr = add(p, scale(n, -0.05))
  const left = floor.rooms.find((r) => pointInPolygon(pl, r.polygon))
  const right = floor.rooms.find((r) => pointInPolygon(pr, r.polygon))
  return { left, right }
}

/** Walls (and the sub-interval along them) bounding a room edge-wise. */
export function wallsOfRoom(floor: Floor, room: Room): { wall: Wall; side: 'left' | 'right'; t0: number; t1: number }[] {
  const out: { wall: Wall; side: 'left' | 'right'; t0: number; t1: number }[] = []
  for (const e of roomEdges(room)) {
    for (const w of floor.walls) {
      const ov = lineOverlap(w, e)
      if (ov < 0.02) continue
      const L = segLength(w.a, w.b)
      const ta = projectT(e.a, w.a, w.b) * L
      const tb = projectT(e.b, w.a, w.b) * L
      const t0 = Math.max(0, Math.min(ta, tb))
      const t1 = Math.min(L, Math.max(ta, tb))
      if (t1 - t0 < 0.02) continue
      const sameDir = dot(sub(e.b, e.a), sub(w.b, w.a)) > 0
      const onLeft = sameDir ? e.roomOnLeft : !e.roomOnLeft
      out.push({ wall: w, side: onLeft ? 'left' : 'right', t0, t1 })
    }
  }
  return out
}
