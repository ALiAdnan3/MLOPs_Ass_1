import type { EntityRef, Floor, HouseState, Vec2 } from '../core/model/types'
import { pointInPolygon, bbox } from '../core/geometry/polygon'
import { distToSegment, projectT, segLength } from '../core/geometry/segment'
import { add, norm, rotate, scale, sub } from '../core/geometry/vec'
import { effectiveKind } from '../planner/walls'
import { stairGeometry } from '../planner/stairs'
import { spec } from '../core/constraints/rooms'

/** Picking in the 2D plan, in priority order (openings, furniture, structure, walls, rooms, site). */
export function hitTest(p: Vec2, floor: Floor, house: HouseState, pxPerM: number, layers: { furniture: boolean; structure: boolean; landscape: boolean; annotations: boolean }, includeSite: boolean): EntityRef | null {
  const tol = 6 / pxPerM
  const fid = floor.id
  // openings
  for (const o of floor.openings) {
    const w = floor.walls.find((x) => x.id === o.wallId)
    if (!w) continue
    const L = segLength(w.a, w.b)
    const t = projectT(p, w.a, w.b) * L
    const d = distToSegment(p, w.a, w.b)
    if (d < w.thickness / 2 + tol && Math.abs(t - o.offset) < o.width / 2) return { kind: 'opening', id: o.id, floorId: fid }
  }
  // annotations
  if (layers.annotations) {
    for (const a of floor.annotations) {
      if (a.kind === 'text') {
        if (Math.abs(p.x - a.position.x) < a.size * a.text.length * 0.35 + tol && Math.abs(p.y - a.position.y) < a.size + tol) return { kind: 'annotation', id: a.id, floorId: fid }
      } else {
        const n = { x: -(a.b.y - a.a.y), y: a.b.x - a.a.x }
        const l = Math.hypot(n.x, n.y) || 1
        const off = { x: (n.x / l) * a.offset, y: (n.y / l) * a.offset }
        if (distToSegment(p, add(a.a, off), add(a.b, off)) < tol * 1.5) return { kind: 'annotation', id: a.id, floorId: fid }
      }
    }
  }
  // furniture (topmost first)
  if (layers.furniture) {
    for (let i = floor.furniture.length - 1; i >= 0; i--) {
      const f = floor.furniture[i]
      if (f.type === 'rug' || f.type === 'prayer-mat') continue
      const local = rotate(sub(p, f.position), -f.rotation)
      if (Math.abs(local.x) <= f.width / 2 + tol * 0.5 && Math.abs(local.y) <= f.depth / 2 + tol * 0.5) return { kind: 'furniture', id: f.id, floorId: fid }
    }
  }
  if (layers.structure) {
    for (const c of floor.columns) {
      const local = rotate(sub(p, c.position), -c.rotation)
      if (Math.abs(local.x) <= c.width / 2 + tol && Math.abs(local.y) <= c.depth / 2 + tol) return { kind: 'column', id: c.id, floorId: fid }
    }
  }
  for (const s of floor.stairs) {
    const g = stairGeometry(s, floor.height)
    if (pointInPolygon(p, g.outline)) return { kind: 'stair', id: s.id, floorId: fid }
  }
  // walls
  let best: { id: string; d: number } | null = null
  for (const w of floor.walls) {
    const d = distToSegment(p, w.a, w.b)
    const reach = Math.max(w.thickness / 2, 0.04) + tol
    if (d < reach && (!best || d < best.d)) best = { id: w.id, d }
  }
  if (best) return { kind: 'wall', id: best.id, floorId: fid }
  // rugs after walls
  if (layers.furniture) {
    for (const f of floor.furniture) {
      if (f.type !== 'rug' && f.type !== 'prayer-mat') continue
      const local = rotate(sub(p, f.position), -f.rotation)
      if (Math.abs(local.x) <= f.width / 2 && Math.abs(local.y) <= f.depth / 2) return { kind: 'furniture', id: f.id, floorId: fid }
    }
  }
  // rooms (smallest containing first — attached rooms inside parents)
  const rooms = floor.rooms.filter((r) => pointInPolygon(p, r.polygon)).sort((a, b) => bbox(a.polygon).w * bbox(a.polygon).h - bbox(b.polygon).w * bbox(b.polygon).h)
  if (rooms[0]) return { kind: 'room', id: rooms[0].id, floorId: fid }
  if (includeSite && layers.landscape) {
    for (const o of house.site.objects) {
      const r = o.kind === 'tree' ? 0.6 * o.scale : o.kind === 'palm' ? 0.5 : 0.4
      if (Math.hypot(p.x - o.position.x, p.y - o.position.y) < r + tol) return { kind: 'siteObject', id: o.id }
    }
    const areas = house.site.areas.filter((a) => pointInPolygon(p, a.polygon)).sort((a, b) => bbox(a.polygon).w * bbox(a.polygon).h - bbox(b.polygon).w * bbox(b.polygon).h)
    if (areas[0]) return { kind: 'siteArea', id: areas[0].id }
    for (const g of house.plot.gates) {
      const pb = bbox(house.plot.polygon)
      if (g.side === 'front' && Math.abs(p.y - (pb.y + pb.h)) < 0.5 && Math.abs(p.x - (pb.x + g.offset)) < g.width / 2) return { kind: 'gate', id: g.id }
    }
  }
  return null
}

/** Nearest wall to a point (for door/window placement) with the projected offset. */
export function nearestWall(p: Vec2, floor: Floor, pxPerM: number, maxPx = 24) {
  let best: { wallId: string; offset: number; d: number; side: 'left' | 'right' } | null = null
  for (const w of floor.walls) {
    const k = effectiveKind(w)
    if (k === 'virtual') continue
    const L = segLength(w.a, w.b)
    const t = projectT(p, w.a, w.b)
    if (t < 0 || t > 1) continue
    const d = distToSegment(p, w.a, w.b)
    if (d > maxPx / pxPerM + w.thickness / 2) continue
    const dir = norm(sub(w.b, w.a))
    const n = { x: -dir.y, y: dir.x }
    const side = (p.x - w.a.x) * n.x + (p.y - w.a.y) * n.y >= 0 ? 'left' : 'right'
    if (!best || d < best.d) best = { wallId: w.id, offset: t * L, d, side }
  }
  return best
}

export function roomAt(p: Vec2, floor: Floor) {
  return floor.rooms.filter((r) => pointInPolygon(p, r.polygon) && spec(r.type)).sort((a, b) => bbox(a.polygon).w * bbox(a.polygon).h - bbox(b.polygon).w * bbox(b.polygon).h)[0]
}

export function wallPoint(w: { a: Vec2; b: Vec2 }, t: number): Vec2 {
  return add(w.a, scale(norm(sub(w.b, w.a)), t))
}
