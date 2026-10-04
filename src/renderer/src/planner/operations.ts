import type { Floor, Opening, Project, ProjectSettings, Room, RoomType, Vec2, Wall } from '../core/model/types'
import { deepClone } from '../core/clone'
import { uid, type IdFactory } from '../core/model/ids'
import { bbox, isAxisRect, rectPoly, removeCollinear, unionPolys, intersectPolys, differencePolys, area, pointInPolygon, type Rect } from '../core/geometry/polygon'
import { rebuildWalls, lineOverlap, effectiveKind } from './walls'
import { spec } from '../core/constraints/rooms'
import { segLength, projectT } from '../core/geometry/segment'
import { add, norm, scale, sub, dot, perp } from '../core/geometry/vec'
import { furnishRoom } from './furnish'
import { applySmartLabels } from './labels'
import { risersFor } from './stairs'

/**
 * PARAMETRIC OPERATIONS (§8, §23). Every edit goes through the structured model: rooms move or
 * resize, walls are re-derived, doors/windows/furniture follow, labels update.
 * All functions mutate a draft (used inside immer producers).
 */

export type Side = 'left' | 'right' | 'top' | 'bottom'

/** World center of an opening on its current wall. */
export function openingCenterOf(floor: Floor, o: Opening): Vec2 | null {
  const w = floor.walls.find((x) => x.id === o.wallId)
  if (!w) return null
  return add(w.a, scale(norm(sub(w.b, w.a)), o.offset))
}

/**
 * Re-derive walls on a floor. With `move`, openings sitting on the moved edge line travel with
 * it; `centers` can pin explicit new centers for specific openings.
 */
export function refreshFloor(floor: Floor, settings: Pick<ProjectSettings, 'wallThickness'>, move?: { line: { a: Vec2; b: Vec2 }; delta: Vec2 }, ids: IdFactory = uid, centers?: Map<string, Vec2>) {
  const override = new Map(centers ?? [])
  if (move) {
    for (const o of floor.openings) {
      if (override.has(o.id)) continue
      const w = floor.walls.find((x) => x.id === o.wallId)
      if (!w || lineOverlap(w, move.line) < 0.01) continue
      const c = openingCenterOf(floor, o)!
      const t = projectT(c, move.line.a, move.line.b)
      if (t >= -0.01 && t <= 1.01) override.set(o.id, add(c, move.delta))
    }
  }
  const res = rebuildWalls(floor, settings, ids, override)
  floor.walls = res.walls
  floor.openings = res.openings
  return res.droppedOpenings
}

/** Axis-aligned edge of a rect room. */
function rectEdge(r: Rect, side: Side): { a: Vec2; b: Vec2 } {
  switch (side) {
    case 'left':
      return { a: { x: r.x, y: r.y }, b: { x: r.x, y: r.y + r.h } }
    case 'right':
      return { a: { x: r.x + r.w, y: r.y }, b: { x: r.x + r.w, y: r.y + r.h } }
    case 'top':
      return { a: { x: r.x, y: r.y }, b: { x: r.x + r.w, y: r.y } }
    default:
      return { a: { x: r.x, y: r.y + r.h }, b: { x: r.x + r.w, y: r.y + r.h } }
  }
}

/**
 * Move one edge of a room perpendicular to itself. With `pushNeighbors`, rooms sharing that
 * edge line move their coincident edge too, so the plan stays watertight (true parametric resize).
 */
export function moveRoomEdge(floor: Floor, roomId: string, side: Side, delta: number, settings: Pick<ProjectSettings, 'wallThickness'>, pushNeighbors = true): { ok: boolean; reason?: string; moved: string[] } {
  const room = floor.rooms.find((r) => r.id === roomId)
  if (!room) return { ok: false, reason: 'Room not found', moved: [] }
  const vertical = side === 'left' || side === 'right'
  const b0 = bbox(room.polygon)
  const edge = rectEdge(b0, side)
  const coord = vertical ? edge.a.x : edge.a.y
  const moved: string[] = []
  const shift = (r: Room, lo: number, hi: number) => {
    let touched = false
    r.polygon = r.polygon.map((p) => {
      const c = vertical ? p.x : p.y
      const along = vertical ? p.y : p.x
      if (Math.abs(c - coord) < 1e-3 && along >= lo - 1e-3 && along <= hi + 1e-3) {
        touched = true
        return vertical ? { x: p.x + delta, y: p.y } : { x: p.x, y: p.y + delta }
      }
      return p
    })
    if (touched) moved.push(r.id)
  }
  const lo = vertical ? b0.y : b0.x
  const hi = vertical ? b0.y + b0.h : b0.x + b0.w
  if (!isAxisRect(room.polygon)) {
    shift(room, lo, hi)
  } else {
    const nb = bbox(room.polygon)
    const nr: Rect = { ...nb }
    if (side === 'left') {
      nr.x += delta
      nr.w -= delta
    } else if (side === 'right') nr.w += delta
    else if (side === 'top') {
      nr.y += delta
      nr.h -= delta
    } else nr.h += delta
    if (nr.w < 0.6 || nr.h < 0.6) return { ok: false, reason: 'The room would become too small', moved: [] }
    room.polygon = rectPoly(nr)
    moved.push(room.id)
  }
  if (pushNeighbors) {
    for (const r of floor.rooms) {
      if (r.id === room.id) continue
      const rb = bbox(r.polygon)
      const rlo = vertical ? rb.y : rb.x
      const rhi = vertical ? rb.y + rb.h : rb.x + rb.w
      if (rhi <= lo + 1e-3 || rlo >= hi - 1e-3) continue
      const hasEdge = r.polygon.some((p) => Math.abs((vertical ? p.x : p.y) - coord) < 1e-3)
      if (!hasEdge) continue
      // only neighbours that sit on the other side of the moved edge (or share the same side in a stack)
      const onLowSide = Math.abs((vertical ? rb.x + rb.w : rb.y + rb.h) - coord) < 1e-3
      const onHighSide = Math.abs((vertical ? rb.x : rb.y) - coord) < 1e-3
      const partial = rlo < lo - 0.01 || rhi > hi + 0.01
      if (partial && (onLowSide || onHighSide)) {
        // the neighbour only partly shares this edge: take (or give) just the shared stretch, so
        // its other walls — and the doors and adjacencies on them — stay exactly where they were
        const s0 = Math.max(lo, rlo)
        const s1 = Math.min(hi, rhi)
        const c0 = Math.min(coord, coord + delta)
        const c1 = Math.max(coord, coord + delta)
        const strip = rectPoly(vertical ? { x: c0, y: s0, w: c1 - c0, h: s1 - s0 } : { x: s0, y: c0, w: s1 - s0, h: c1 - c0 })
        const invaded = (onLowSide && delta < 0) || (onHighSide && delta > 0)
        const pieces = invaded ? differencePolys(r.polygon, strip) : unionPolys([r.polygon, strip])
        const solid = pieces.filter((x) => area(x.outer) > 0.05)
        const best = solid.filter((x) => !x.holes.length).sort((a, b) => area(b.outer) - area(a.outer))[0]
        if (!best || solid.length > 1) return { ok: false, reason: `${r.name} would be split in two`, moved: [] }
        const nb2 = bbox(best.outer)
        if (Math.min(nb2.w, nb2.h) < 0.6) return { ok: false, reason: `${r.name} would become too small`, moved: [] }
        r.polygon = removeCollinear(best.outer.map((q) => ({ x: Math.round(q.x * 1e4) / 1e4, y: Math.round(q.y * 1e4) / 1e4 })), 1e-4)
        moved.push(r.id)
        continue
      }
      if (isAxisRect(r.polygon)) {
        const nr = { ...rb }
        const onLow = onLowSide
        const onHigh = onHighSide
        if (onLow) {
          if (vertical) nr.w += delta
          else nr.h += delta
        } else if (onHigh) {
          if (vertical) {
            nr.x += delta
            nr.w -= delta
          } else {
            nr.y += delta
            nr.h -= delta
          }
        }
        if (nr.w < 0.6 || nr.h < 0.6) return { ok: false, reason: `${r.name} would become too small`, moved: [] }
        r.polygon = rectPoly(nr)
        moved.push(r.id)
      } else shift(r, rlo, rhi)
    }
  }
  const line = vertical ? { a: { x: coord, y: lo }, b: { x: coord, y: hi } } : { a: { x: lo, y: coord }, b: { x: hi, y: coord } }
  const dv = vertical ? { x: delta, y: 0 } : { x: 0, y: delta }
  // furniture near the moved edge follows it
  for (const fu of floor.furniture) {
    const c = vertical ? fu.position.x : fu.position.y
    const along = vertical ? fu.position.y : fu.position.x
    if (Math.abs(c - coord) < 1.2 && along >= lo && along <= hi && moved.some((id) => pointInPolygon(fu.position, floor.rooms.find((r) => r.id === id)!.polygon))) {
      const inRoom = floor.rooms.find((r) => pointInPolygon(fu.position, r.polygon))
      if (!inRoom) fu.position = add(fu.position, dv)
    }
  }
  // stairs inside moved rooms stay; columns on the line follow
  for (const c of floor.columns) if (Math.abs((vertical ? c.position.x : c.position.y) - coord) < 0.05) c.position = add(c.position, dv)
  refreshFloor(floor, settings, { line, delta: dv })
  return { ok: true, moved }
}

/** Set a room's width (x) or depth (y) to an exact value by moving the best edge. */
export function setRoomSize(floor: Floor, roomId: string, axis: 'x' | 'y', value: number, settings: Pick<ProjectSettings, 'wallThickness'>, anchor?: Side) {
  const room = floor.rooms.find((r) => r.id === roomId)
  if (!room) return { ok: false, reason: 'Room not found', moved: [] as string[] }
  const b = bbox(room.polygon)
  const cur = axis === 'x' ? b.w : b.h
  const delta = value - cur
  if (Math.abs(delta) < 1e-4) return { ok: true, moved: [] as string[] }
  const side = anchor ?? chooseResizeSide(floor, room, axis, delta)
  return moveRoomEdge(floor, roomId, side, side === 'left' || side === 'top' ? -delta : delta, settings)
}

/** Pick the edge that can give/take space most gracefully (exterior first, then the roomiest neighbour). */
export function chooseResizeSide(floor: Floor, room: Room, axis: 'x' | 'y', delta: number): Side {
  const b = bbox(room.polygon)
  const sides: Side[] = axis === 'x' ? ['right', 'left'] : ['bottom', 'top']
  let best: Side = sides[0]
  let bestScore = -Infinity
  for (const s of sides) {
    const e = rectEdge(b, s)
    const vertical = s === 'left' || s === 'right'
    const coord = vertical ? e.a.x : e.a.y
    const nbs = floor.rooms.filter((r) => r.id !== room.id && r.polygon.some((p) => Math.abs((vertical ? p.x : p.y) - coord) < 1e-3) && overlapAlong(bbox(r.polygon), b, vertical) > 0.3)
    let score = 0
    if (!nbs.length) score += 5 // exterior edge: grow the house
    for (const n of nbs) {
      const nb = bbox(n.polygon)
      const room = vertical ? nb.w : nb.h
      const min = spec(n.type).minWidth
      score += delta > 0 ? (room - delta - min) : 1
      if (spec(n.type).circulation) score += 1.5
      if (n.type === 'stair' || n.type === 'lift') score -= 50
    }
    if (score > bestScore) {
      bestScore = score
      best = s
    }
  }
  return best
}

function overlapAlong(a: Rect, b: Rect, vertical: boolean) {
  return vertical ? Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) : Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
}

export function translateRoom(floor: Floor, roomId: string, dx: number, dy: number, settings: Pick<ProjectSettings, 'wallThickness'>) {
  const room = floor.rooms.find((r) => r.id === roomId)
  if (!room) return
  const before = room.polygon.map((p) => ({ ...p }))
  room.polygon = room.polygon.map((p) => ({ x: p.x + dx, y: p.y + dy }))
  for (const fu of floor.furniture) if (pointInPolygon(fu.position, before)) fu.position = { x: fu.position.x + dx, y: fu.position.y + dy }
  for (const s of floor.stairs) if (pointInPolygon(s.position, expandPoly(before, 0.2))) s.position = { x: s.position.x + dx, y: s.position.y + dy }
  // openings belonging to this room travel with it
  const centers = new Map<string, Vec2>()
  for (const o of floor.openings) {
    const w = floor.walls.find((x) => x.id === o.wallId)
    if (!w) continue
    const c = add(w.a, scale(norm(sub(w.b, w.a)), o.offset))
    const n = perp(norm(sub(w.b, w.a)))
    if (pointInPolygon(add(c, scale(n, 0.1)), before) || pointInPolygon(add(c, scale(n, -0.1)), before)) centers.set(o.id, { x: c.x + dx, y: c.y + dy })
  }
  refreshFloor(floor, settings, undefined, uid, centers)
}

export function addRectRoom(floor: Floor, rect: Rect, type: RoomType, settings: Pick<ProjectSettings, 'wallThickness'>, name?: string): Room {
  const room: Room = { id: uid('rm'), name: name ?? spec(type).label, autoName: !name, type, polygon: rectPoly(rect), floorMaterial: undefined }
  floor.rooms.push(room)
  refreshFloor(floor, settings)
  return room
}

export function addPolygonRoom(floor: Floor, polygon: Vec2[], type: RoomType, settings: Pick<ProjectSettings, 'wallThickness'>, name?: string): Room {
  const room: Room = { id: uid('rm'), name: name ?? spec(type).label, autoName: !name, type, polygon: removeCollinear(polygon) }
  floor.rooms.push(room)
  refreshFloor(floor, settings)
  return room
}

export function deleteRoom(floor: Floor, roomId: string, settings: Pick<ProjectSettings, 'wallThickness'>) {
  const room = floor.rooms.find((r) => r.id === roomId)
  if (!room) return
  floor.furniture = floor.furniture.filter((f) => !pointInPolygon(f.position, room.polygon))
  floor.rooms = floor.rooms.filter((r) => r.id !== roomId)
  for (const r of floor.rooms) if (r.parentId === roomId) delete r.parentId
  refreshFloor(floor, settings)
}

/** Split a room with an axis-aligned line (§7 "Split rooms"). */
export function splitRoom(floor: Floor, roomId: string, axis: 'x' | 'y', at: number, settings: Pick<ProjectSettings, 'wallThickness'>): Room | null {
  const room = floor.rooms.find((r) => r.id === roomId)
  if (!room) return null
  const b = bbox(room.polygon)
  if (axis === 'x' && (at <= b.x + 0.5 || at >= b.x + b.w - 0.5)) return null
  if (axis === 'y' && (at <= b.y + 0.5 || at >= b.y + b.h - 0.5)) return null
  if (!isAxisRect(room.polygon)) {
    // general polygons: clip with half-planes via booleans
    const big = 1e4
    const halfA: Vec2[] = axis === 'x' ? rectPoly({ x: -big, y: -big, w: at + big, h: 2 * big }) : rectPoly({ x: -big, y: -big, w: 2 * big, h: at + big })
    const halfB: Vec2[] = axis === 'x' ? rectPoly({ x: at, y: -big, w: big, h: 2 * big }) : rectPoly({ x: -big, y: at, w: 2 * big, h: big })
    const pa = largestPiece(room.polygon, halfA)
    const pb = largestPiece(room.polygon, halfB)
    if (!pa || !pb) return null
    room.polygon = pa
    const nr: Room = { ...deepClone(room), id: uid('rm'), polygon: pb, name: `${room.name} (2)`, autoName: room.autoName }
    floor.rooms.push(nr)
    refreshFloor(floor, settings)
    return nr
  }
  const r1: Rect = axis === 'x' ? { x: b.x, y: b.y, w: at - b.x, h: b.h } : { x: b.x, y: b.y, w: b.w, h: at - b.y }
  const r2: Rect = axis === 'x' ? { x: at, y: b.y, w: b.x + b.w - at, h: b.h } : { x: b.x, y: at, w: b.w, h: b.y + b.h - at }
  room.polygon = rectPoly(r1)
  const nr: Room = { ...deepClone(room), id: uid('rm'), polygon: rectPoly(r2), name: room.autoName ? room.name : `${room.name} (2)` }
  delete nr.parentId
  floor.rooms.push(nr)
  refreshFloor(floor, settings)
  // new internal wall needs a door so both halves stay reachable
  const wall = floor.walls.find((w) => lineOverlap(w, axis === 'x' ? { a: { x: at, y: b.y }, b: { x: at, y: b.y + b.h } } : { a: { x: b.x, y: at }, b: { x: b.x + b.w, y: at } }) > 0.5)
  if (wall && effectiveKind(wall) !== 'virtual') {
    const L = segLength(wall.a, wall.b)
    floor.openings.push({ id: uid('opn'), kind: 'door', wallId: wall.id, offset: Math.min(L - 0.6, 0.65), width: 0.9, height: 2.13, sill: 0, style: 'single', hinge: 'start', swing: 'left' })
  }
  return nr
}

function largestPiece(a: Vec2[], b: Vec2[]): Vec2[] | null {
  const r = intersectPolys(a, b)
  if (!r.length) return null
  return removeCollinear(r.sort((x, y) => area(y.outer) - area(x.outer))[0].outer)
}

/** Merge rooms into one (§7 "Merge rooms"). The first room keeps its identity. */
export function mergeRooms(floor: Floor, ids: string[], settings: Pick<ProjectSettings, 'wallThickness'>): Room | null {
  const rooms = ids.map((id) => floor.rooms.find((r) => r.id === id)).filter(Boolean) as Room[]
  if (rooms.length < 2) return null
  const u = unionPolys(rooms.map((r) => r.polygon))
  if (u.length !== 1) return null
  const keep = rooms[0]
  keep.polygon = removeCollinear(u[0].outer)
  floor.rooms = floor.rooms.filter((r) => r.id === keep.id || !ids.includes(r.id))
  for (const r of floor.rooms) if (r.parentId && ids.includes(r.parentId)) r.parentId = keep.id
  // drop openings that were between the merged rooms
  refreshFloor(floor, settings)
  floor.openings = floor.openings.filter((o) => floor.walls.some((w) => w.id === o.wallId))
  return keep
}

/** Stretch the whole house in x or y (§8 "house width changes → design adjusts"). */
export function scaleHouse(p: Project, axis: 'x' | 'y', factor: number, origin: number) {
  const f = (v: number) => origin + (v - origin) * factor
  for (const fl of p.floors) {
    for (const r of fl.rooms) r.polygon = r.polygon.map((pt) => (axis === 'x' ? { x: f(pt.x), y: pt.y } : { x: pt.x, y: f(pt.y) }))
    for (const fu of fl.furniture) fu.position = axis === 'x' ? { x: f(fu.position.x), y: fu.position.y } : { x: fu.position.x, y: f(fu.position.y) }
    for (const c of fl.columns) c.position = axis === 'x' ? { x: f(c.position.x), y: c.position.y } : { x: c.position.x, y: f(c.position.y) }
    for (const s of fl.stairs) s.position = axis === 'x' ? { x: f(s.position.x), y: s.position.y } : { x: s.position.x, y: f(s.position.y) }
    for (const w of fl.walls) {
      const L0 = segLength(w.a, w.b)
      w.a = axis === 'x' ? { x: f(w.a.x), y: w.a.y } : { x: w.a.x, y: f(w.a.y) }
      w.b = axis === 'x' ? { x: f(w.b.x), y: w.b.y } : { x: w.b.x, y: f(w.b.y) }
      const L1 = segLength(w.a, w.b)
      for (const o of fl.openings) if (o.wallId === w.id && L0 > 0) o.offset *= L1 / L0
    }
    for (const b of fl.beams) {
      b.a = axis === 'x' ? { x: f(b.a.x), y: b.a.y } : { x: b.a.x, y: f(b.a.y) }
      b.b = axis === 'x' ? { x: f(b.b.x), y: b.b.y } : { x: b.b.x, y: f(b.b.y) }
    }
    refreshFloor(fl, p.settings)
  }
  for (const a of p.site.areas) a.polygon = a.polygon.map((pt) => (axis === 'x' ? { x: f(pt.x), y: pt.y } : { x: pt.x, y: f(pt.y) }))
  for (const o of p.site.objects) o.position = axis === 'x' ? { x: f(o.position.x), y: o.position.y } : { x: o.position.x, y: f(o.position.y) }
}

export function setFloorHeight(p: Project, floorId: string, height: number) {
  const f = p.floors.find((x) => x.id === floorId)
  if (!f) return
  f.height = Math.max(2.4, Math.min(6, height))
  for (const s of f.stairs) s.risers = risersFor(f.height)
  for (const o of f.openings) if (o.kind === 'window' && o.sill + o.height > f.height - f.slabThickness - 0.05) o.height = Math.max(0.4, f.height - f.slabThickness - 0.15 - o.sill)
}

export function refurnishRoom(floor: Floor, roomId: string, luxury = 50, qibla?: Vec2) {
  const room = floor.rooms.find((r) => r.id === roomId)
  if (!room) return
  floor.furniture = floor.furniture.filter((f) => !pointInPolygon(f.position, room.polygon))
  floor.furniture.push(...furnishRoom(floor, room, uid, { luxury, qibla }))
}

export function relabel(p: Project) {
  applySmartLabels(p)
}

/** Swap the positions of two rooms (used by "move the kitchen closer to the dining room"). */
export function swapRooms(floor: Floor, aId: string, bId: string, settings: Pick<ProjectSettings, 'wallThickness'>) {
  const a = floor.rooms.find((r) => r.id === aId)
  const b = floor.rooms.find((r) => r.id === bId)
  if (!a || !b) return false
  const pa = a.polygon
  const pb = b.polygon
  const fa = floor.furniture.filter((f) => pointInPolygon(f.position, pa))
  const fb = floor.furniture.filter((f) => pointInPolygon(f.position, pb))
  a.polygon = pb
  b.polygon = pa
  floor.furniture = floor.furniture.filter((f) => !fa.includes(f) && !fb.includes(f))
  refreshFloor(floor, settings)
  floor.furniture.push(...furnishRoom(floor, a, uid), ...furnishRoom(floor, b, uid))
  return true
}

export function expandPoly(poly: Vec2[], d: number) {
  const b = bbox(poly)
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  return poly.map((p) => ({ x: p.x + Math.sign(p.x - cx) * d, y: p.y + Math.sign(p.y - cy) * d }))
}

export function wallLength(w: Wall) {
  return segLength(w.a, w.b)
}

export function openingWorld(floor: Floor, o: Opening) {
  const w = floor.walls.find((x) => x.id === o.wallId)
  if (!w) return null
  const d = norm(sub(w.b, w.a))
  return { center: add(w.a, scale(d, o.offset)), dir: d, normal: perp(d), wall: w }
}

void dot
