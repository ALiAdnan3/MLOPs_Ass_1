import type { EntityRef, Floor, HouseState, Opening, Room, Wall } from '../core/model/types'
import { area, bbox, overlapArea, pointInPolygon } from '../core/geometry/polygon'
import { segLength, segmentIntersection } from '../core/geometry/segment'
import { add, norm, perp, scale, sub } from '../core/geometry/vec'
import { spec, isIndoor } from '../core/constraints/rooms'
import { effectiveKind, roomsBesideWall } from './walls'
import { stairGeometry } from './stairs'
import { sortedFloors, clearHeight } from '../core/model/house'
import { catalogItem } from '../core/furniture/catalog'

/** DESIGN VALIDATION (§56). Warnings are shown, never silently accepted. */

export type Severity = 'error' | 'warning' | 'info'

export interface Issue {
  id: string
  severity: Severity
  code:
    | 'overlap'
    | 'invalid-wall'
    | 'disconnected'
    | 'no-access'
    | 'door-blocked'
    | 'opening-invalid'
    | 'stair'
    | 'dimension'
    | 'furniture-outside'
    | 'window'
    | 'garage'
    | 'basement'
    | 'daylight'
    | 'plot'
  message: string
  why: string
  fix: string
  floorId?: string
  ref?: EntityRef
}

let n = 0
const issue = (i: Omit<Issue, 'id'>): Issue => ({ id: `iss_${n++}`, ...i })

export function openingCenter(w: Wall, o: Pick<Opening, 'offset'>) {
  const d = norm(sub(w.b, w.a))
  return add(w.a, scale(d, o.offset))
}

/** Rooms connected by an opening (door/opening) on a wall. */
export function openingRooms(floor: Floor, o: Opening): { left?: Room; right?: Room } {
  const w = floor.walls.find((x) => x.id === o.wallId)
  if (!w) return {}
  const L = segLength(w.a, w.b)
  return roomsBesideWall(floor, w, Math.min(0.999, Math.max(0.001, o.offset / L)))
}

/** Room adjacency via doors, openings and open (virtual) separators, across floors via stairs. */
export function accessGraph(h: Pick<HouseState, 'floors'>) {
  const adj = new Map<string, Set<string>>()
  const link = (a?: Room, b?: Room) => {
    if (!a || !b || a.id === b.id) return
    if (!adj.has(a.id)) adj.set(a.id, new Set())
    if (!adj.has(b.id)) adj.set(b.id, new Set())
    adj.get(a.id)!.add(b.id)
    adj.get(b.id)!.add(a.id)
  }
  const entries = new Set<string>()
  const floors = sortedFloors(h.floors)
  for (const f of floors) {
    for (const o of f.openings) {
      if (o.kind !== 'door') continue
      const { left, right } = openingRooms(f, o)
      if (left && right) link(left, right)
      else if (f.level === 0) {
        const r = left ?? right
        if (r) entries.add(r.id)
      }
    }
    for (const w of f.walls) {
      if (effectiveKind(w) !== 'virtual') continue
      for (const t of [0.2, 0.5, 0.8]) {
        const { left, right } = roomsBesideWall(f, w, t)
        if (left && right) link(left, right)
      }
    }
    if (f.level === 0) for (const r of f.rooms) if (r.type === 'garage') entries.add(r.id)
  }
  // stairs connect halls vertically
  for (let i = 0; i < floors.length - 1; i++) {
    const f = floors[i]
    const up = floors[i + 1]
    for (const s of f.stairs) {
      const g = stairGeometry(s, f.height)
      const start = g.path[0].p
      const end = g.path[g.path.length - 1].p
      const bottom = f.rooms.find((r) => pointInPolygon(start, r.polygon)) ?? f.rooms.find((r) => pointInPolygon(g.path[1].p, r.polygon))
      const topRoom = up.rooms.find((r) => pointInPolygon(end, r.polygon) && spec(r.type).walkable)
      link(bottom, topRoom)
    }
  }
  return { adj, entries }
}

export function validateHouse(h: HouseState): Issue[] {
  const out: Issue[] = []
  const floors = sortedFloors(h.floors)
  const { adj, entries } = accessGraph(h)

  // reachability from entrances
  const reach = new Set<string>()
  const q = [...entries]
  q.forEach((e) => reach.add(e))
  while (q.length) {
    const c = q.shift()!
    for (const nb of adj.get(c) ?? []) if (!reach.has(nb)) {
      reach.add(nb)
      q.push(nb)
    }
  }

  if (!entries.size && floors.some((f) => f.level === 0 && f.rooms.length)) {
    const g = floors.find((f) => f.level === 0)!
    out.push(issue({ severity: 'error', code: 'no-access', message: 'The house has no entrance door', why: 'No door on the ground floor leads outside, so nobody can get in.', fix: 'Use the Door tool on an exterior wall of the entrance or lounge.', floorId: g.id }))
  }

  for (const f of floors) {
    const rooms = f.rooms
    // overlaps
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const ov = overlapArea(rooms[i].polygon, rooms[j].polygon)
        if (ov > 0.05) out.push(issue({ severity: 'error', code: 'overlap', message: `${rooms[i].name} overlaps ${rooms[j].name} (${ov.toFixed(1)} m²)`, why: 'Two rooms cannot occupy the same floor space; walls between them become ambiguous.', fix: 'Move or resize one of the rooms so their edges meet instead of overlapping.', floorId: f.id, ref: { kind: 'room', id: rooms[i].id, floorId: f.id } }))
      }
    }
    // rooms: size, access, daylight, plot
    for (const r of rooms) {
      const sp = spec(r.type)
      const a = area(r.polygon)
      const b = bbox(r.polygon)
      const ref: EntityRef = { kind: 'room', id: r.id, floorId: f.id }
      if (a < 0.5) {
        out.push(issue({ severity: 'error', code: 'dimension', message: `${r.name} is degenerate (${a.toFixed(2)} m²)`, why: 'A room needs a real floor area.', fix: 'Delete it or drag its edges apart.', floorId: f.id, ref }))
        continue
      }
      const short = Math.min(b.w, b.h)
      if (sp.walkable && short < sp.minWidth * 0.85) out.push(issue({ severity: 'warning', code: 'dimension', message: `${r.name} is narrow (${short.toFixed(2)} m wide)`, why: `A ${sp.label.toLowerCase()} is normally at least ${sp.minWidth.toFixed(2)} m wide.`, fix: 'Widen the room by dragging an edge or type a new width in Properties.', floorId: f.id, ref }))
      if (sp.walkable && a < sp.minArea * 0.8) out.push(issue({ severity: 'warning', code: 'dimension', message: `${r.name} is small (${a.toFixed(1)} m²)`, why: `Recommended minimum for a ${sp.label.toLowerCase()} is ${sp.minArea.toFixed(1)} m².`, fix: 'Enlarge the room or merge it with a neighbour.', floorId: f.id, ref }))
      if (sp.walkable && !sp.outdoor && r.type !== 'garage') {
        const hasNeighbour = adj.has(r.id)
        if (!hasNeighbour) out.push(issue({ severity: 'error', code: 'disconnected', message: `${r.name} has no door`, why: 'The room is not connected to any other space.', fix: 'Add a door to a neighbouring hall or lounge with the Door tool.', floorId: f.id, ref }))
        else if (entries.size && !reach.has(r.id)) out.push(issue({ severity: 'error', code: 'no-access', message: `${r.name} cannot be reached from the entrance`, why: 'Its doors only lead to rooms that are themselves cut off.', fix: 'Add a door towards the lounge, a corridor or the stair hall.', floorId: f.id, ref }))
      }
      if (sp.habitable && sp.walkable && !sp.outdoor && f.kind !== 'basement' && r.type !== 'home_theater') {
        const lit = f.walls.some((w) => f.openings.some((o) => o.kind === 'window' && o.wallId === w.id && sideHas(f, w, o, r)))
        const doorLit = f.walls.some((w) => f.openings.some((o) => o.kind === 'door' && (o.style === 'sliding' || o.style === 'french') && o.wallId === w.id && sideHas(f, w, o, r)))
        if (!lit && !doorLit) out.push(issue({ severity: 'warning', code: 'daylight', message: `${r.name} has no window`, why: 'Habitable rooms need daylight and ventilation.', fix: 'Add a window on an exterior wall, a skylight, or move the room to an outside wall.', floorId: f.id, ref }))
      }
      if (h.plot.polygon.length >= 3 && r.polygon.some((p) => !pointInPolygon(p, expand(h.plot.polygon, 0.05))) && !(r.type === 'balcony')) {
        out.push(issue({ severity: 'error', code: 'plot', message: `${r.name} extends outside the plot`, why: 'Construction must stay within the property boundary.', fix: 'Move the room inside the plot or reduce its size.', floorId: f.id, ref }))
      }
    }
    // walls
    for (const w of f.walls) {
      const L = segLength(w.a, w.b)
      const bad = !Number.isFinite(L) || [w.a.x, w.a.y, w.b.x, w.b.y].some((v) => !Number.isFinite(v))
      if (bad || L < 0.05 || (effectiveKind(w) !== 'virtual' && (w.thickness <= 0 || w.thickness > 1))) {
        out.push(issue({ severity: 'error', code: 'invalid-wall', message: `Invalid wall (${bad ? 'bad coordinates' : L < 0.05 ? 'zero length' : 'thickness ' + w.thickness.toFixed(2) + ' m'})`, why: 'This wall cannot be built or rendered.', fix: 'Delete it, or set a length above 5 cm and thickness between 5 and 60 cm.', floorId: f.id, ref: { kind: 'wall', id: w.id, floorId: f.id } }))
      }
    }
    // openings
    const byWall = new Map<string, Opening[]>()
    for (const o of f.openings) {
      const w = f.walls.find((x) => x.id === o.wallId)
      const ref: EntityRef = { kind: 'opening', id: o.id, floorId: f.id }
      if (!w) {
        out.push(issue({ severity: 'error', code: 'opening-invalid', message: `A ${o.kind} is not attached to a wall`, why: 'Its host wall was removed.', fix: 'Delete it and place a new one.', floorId: f.id, ref }))
        continue
      }
      if (!byWall.has(w.id)) byWall.set(w.id, [])
      byWall.get(w.id)!.push(o)
      const L = segLength(w.a, w.b)
      if (o.offset - o.width / 2 < -0.01 || o.offset + o.width / 2 > L + 0.01) out.push(issue({ severity: 'error', code: 'opening-invalid', message: `${cap(o.kind)} runs past the end of its wall`, why: `It is ${o.width.toFixed(2)} m wide on a ${L.toFixed(2)} m wall.`, fix: 'Make it narrower or slide it along the wall.', floorId: f.id, ref }))
      else if (o.kind === 'door' && (o.offset - o.width / 2 < 0.05 || o.offset + o.width / 2 > L - 0.05) && L > o.width + 0.3) out.push(issue({ severity: 'warning', code: 'door-blocked', message: 'Door sits tight against a wall corner', why: 'There is no room for the frame; the door will clash with the adjoining wall.', fix: 'Slide the door at least 10 cm from the corner.', floorId: f.id, ref }))
      if (o.kind === 'window') {
        const k = effectiveKind(w)
        const { left, right } = openingRooms(f, o)
        if (k === 'virtual') out.push(issue({ severity: 'error', code: 'window', message: 'Window placed on an open separator', why: 'There is no wall there to hold a window.', fix: 'Delete it or change the wall back to a solid wall.', floorId: f.id, ref }))
        else if (left && right && isIndoor(left.type) && isIndoor(right.type) && left.type !== 'void' && right.type !== 'void') out.push(issue({ severity: 'warning', code: 'window', message: `Window between ${left.name} and ${right.name}`, why: 'Windows on interior walls give no daylight or fresh air.', fix: 'Move it to an exterior wall.', floorId: f.id, ref }))
        const ch = f.height - f.slabThickness
        if (o.sill + o.height > ch + 0.01) out.push(issue({ severity: 'error', code: 'window', message: 'Window is taller than the wall', why: `Sill ${o.sill.toFixed(2)} m + height ${o.height.toFixed(2)} m exceeds the ${ch.toFixed(2)} m ceiling.`, fix: 'Lower the sill or reduce the window height.', floorId: f.id, ref }))
      }
      if (o.kind === 'door' && o.style !== 'sliding' && o.style !== 'pocket' && o.style !== 'opening' && o.style !== 'garage') {
        const blocked = doorSwingBlocked(f, w, o)
        if (blocked) out.push(issue({ severity: 'warning', code: 'door-blocked', message: 'Door swing hits a wall', why: 'The door leaf cannot open fully.', fix: 'Flip the swing side, move the door, or use a sliding door.', floorId: f.id, ref }))
      }
    }
    for (const list of byWall.values()) {
      list.sort((a, b) => a.offset - b.offset)
      for (let i = 0; i < list.length - 1; i++) {
        if (list[i].offset + list[i].width / 2 > list[i + 1].offset - list[i + 1].width / 2 + 0.01) out.push(issue({ severity: 'error', code: 'opening-invalid', message: 'Two openings overlap on the same wall', why: 'A door and window (or two of them) cannot share wall length.', fix: 'Slide one of them along the wall.', floorId: f.id, ref: { kind: 'opening', id: list[i + 1].id, floorId: f.id } }))
      }
    }
    // stairs
    const up = floors.find((x) => x.level === f.level + 1)
    for (const s of f.stairs) {
      const ref: EntityRef = { kind: 'stair', id: s.id, floorId: f.id }
      const riser = f.height / s.risers
      if (riser > 0.2 || riser < 0.13) out.push(issue({ severity: 'error', code: 'stair', message: `Stair riser is ${(riser * 1000).toFixed(0)} mm`, why: 'Comfortable, safe risers are 150–190 mm.', fix: `Use ${Math.round(f.height / 0.175)} steps for this floor height.`, floorId: f.id, ref }))
      if (s.tread < 0.24) out.push(issue({ severity: 'warning', code: 'stair', message: 'Stair treads are shallow', why: 'Treads under 240 mm are hard to walk.', fix: 'Increase the tread depth to 270 mm.', floorId: f.id, ref }))
      if (!up) out.push(issue({ severity: 'error', code: 'stair', message: 'Stair leads nowhere', why: `There is no floor above the ${f.name.toLowerCase()} floor.`, fix: 'Add a floor above or delete this stair.', floorId: f.id, ref }))
      else {
        const g = stairGeometry(s, f.height)
        const end = g.path[g.path.length - 1].p
        const arrival = up.rooms.find((r) => pointInPolygon(end, r.polygon))
        if (!arrival || !spec(arrival.type).walkable) out.push(issue({ severity: 'error', code: 'stair', message: 'Impossible stair: nothing to land on upstairs', why: `The top of the stair arrives ${arrival ? 'in ' + arrival.name : 'outside any room'} on the ${up.name.toLowerCase()} floor.`, fix: 'Keep a stair hall at the same position on the floor above.', floorId: f.id, ref }))
        const host = f.rooms.find((r) => g.outline.every((p) => pointInPolygon(p, expand(r.polygon, 0.12))))
        if (!host) out.push(issue({ severity: 'warning', code: 'stair', message: 'Stair crosses a wall', why: 'The stair outline is not inside a single room.', fix: 'Move the stair fully inside the stair hall or enlarge the hall.', floorId: f.id, ref }))
      }
    }
    // furniture
    for (const fu of f.furniture) {
      const room = rooms.find((r) => pointInPolygon(fu.position, r.polygon))
      const ref: EntityRef = { kind: 'furniture', id: fu.id, floorId: f.id }
      const name = catalogItem(fu.type)?.name ?? fu.type
      if (!room) {
        out.push(issue({ severity: 'warning', code: 'furniture-outside', message: `${name} is outside every room`, why: 'Furniture should sit inside a room.', fix: 'Drag it into a room.', floorId: f.id, ref }))
        continue
      }
      const c = Math.cos(fu.rotation)
      const sn = Math.sin(fu.rotation)
      const hw = fu.width / 2 - 0.05
      const hd = fu.depth / 2 - 0.05
      const corners = [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd]
      ].map(([x, y]) => ({ x: fu.position.x + x * c - y * sn, y: fu.position.y + x * sn + y * c }))
      if (corners.some((p) => !pointInPolygon(p, expand(room.polygon, 0.02)))) out.push(issue({ severity: 'warning', code: 'furniture-outside', message: `${name} pokes through the walls of ${room.name}`, why: 'Part of it is outside the room.', fix: 'Move or rotate it, or make it smaller.', floorId: f.id, ref }))
    }
    // garage
    for (const g of rooms.filter((r) => r.type === 'garage')) {
      const b = bbox(g.polygon)
      const ref: EntityRef = { kind: 'room', id: g.id, floorId: f.id }
      if (f.level !== 0) out.push(issue({ severity: 'warning', code: 'garage', message: 'Garage is not on the ground floor', why: 'Cars cannot reach it.', fix: 'Move the garage to the ground floor.', floorId: f.id, ref }))
      const toRoad = h.plot.depth - (b.y + b.h)
      const drive = h.site.areas.some((a) => a.kind === 'driveway' && bbox(a.polygon).y <= b.y + b.h + 0.1 && bbox(a.polygon).x < b.x + b.w && bbox(a.polygon).x + bbox(a.polygon).w > b.x)
      if (toRoad > 0.2 && !drive) out.push(issue({ severity: 'warning', code: 'garage', message: 'Garage has no driveway to the road', why: `It is ${toRoad.toFixed(1)} m from the gate with no driveway.`, fix: 'Add a driveway site area between the garage and the gate.', floorId: f.id, ref }))
      if (g.enclosed && !f.openings.some((o) => o.style === 'garage' && openingRooms(f, o).left?.id === g.id || (o.style === 'garage' && openingRooms(f, o).right?.id === g.id))) out.push(issue({ severity: 'warning', code: 'garage', message: 'Enclosed garage has no garage door', why: 'Cars cannot get in.', fix: 'Add a garage door on its street side, or open the car porch.', floorId: f.id, ref }))
    }
  }
  // basement
  const base = floors.find((f) => f.kind === 'basement')
  if (base && base.rooms.length) {
    if (!base.stairs.length) out.push(issue({ severity: 'error', code: 'basement', message: 'Basement is disconnected', why: 'No stair connects the basement to the ground floor.', fix: 'Place a stair in the basement stair hall (Stair tool).', floorId: base.id }))
  }
  return out
}

function sideHas(f: Floor, w: Wall, o: Opening, r: Room) {
  const c = openingCenter(w, o)
  const n = perp(norm(sub(w.b, w.a)))
  return pointInPolygon(add(c, scale(n, 0.1)), r.polygon) || pointInPolygon(add(c, scale(n, -0.1)), r.polygon)
}

function doorSwingBlocked(f: Floor, w: Wall, o: Opening): boolean {
  const d = norm(sub(w.b, w.a))
  const n = perp(d)
  const sgn = o.swing === 'right' ? -1 : 1
  const r = o.style === 'double' || o.style === 'french' || o.style === 'main' ? o.width / 2 : o.width
  const hingeT = o.hinge === 'end' ? o.offset + o.width / 2 : o.offset - o.width / 2
  const hinge = add(w.a, scale(d, hingeT))
  // leaf fully open sweeps to the normal direction: test the square in front of the opening
  const along = o.hinge === 'end' ? -1 : 1
  const p1 = add(hinge, scale(n, sgn * (w.thickness / 2 + 0.02)))
  const tip = add(p1, scale(n, sgn * (r - 0.05)))
  const tip2 = add(add(p1, scale(d, along * (r - 0.05))), scale(n, sgn * (r - 0.05) * 0.7))
  for (const x of f.walls) {
    if (x.id === w.id || effectiveKind(x) === 'virtual') continue
    if (segmentIntersection(p1, tip, x.a, x.b) || segmentIntersection(p1, tip2, x.a, x.b)) return true
  }
  void clearHeight
  return false
}

function expand(poly: { x: number; y: number }[], d: number) {
  const b = bbox(poly)
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  return poly.map((p) => ({ x: p.x + Math.sign(p.x - cx) * d, y: p.y + Math.sign(p.y - cy) * d }))
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
