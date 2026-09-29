import type { DesignStats, Floor, HouseState, Room } from '../core/model/types'
import { area, bbox, unionPolys, polyWithHolesArea } from '../core/geometry/polygon'
import { isBathType, isBedroomType, spec } from '../core/constraints/rooms'
import { segLength } from '../core/geometry/segment'
import { effectiveKind } from './walls'

/** Area calculations (§31) and design statistics (§61). */

export const roomArea = (r: Room) => area(r.polygon)

export function roomDims(r: Room) {
  const b = bbox(r.polygon)
  return { width: Math.min(b.w, b.h), length: Math.max(b.w, b.h), w: b.w, h: b.h }
}

export function floorIndoorArea(f: Floor) {
  return f.rooms.filter((r) => !spec(r.type).outdoor && r.type !== 'void' && r.type !== 'garage').reduce((s, r) => s + roomArea(r), 0)
}

/** Built (slab) area of a floor: union of all indoor rooms + garage. */
export function floorBuiltArea(f: Floor) {
  const polys = f.rooms.filter((r) => !spec(r.type).outdoor && r.type !== 'void').map((r) => r.polygon)
  return unionPolys(polys).reduce((s, p) => s + polyWithHolesArea(p), 0)
}

export interface AreaSummary {
  plotArea: number
  coveredArea: number
  openArea: number
  floorAreas: { floorId: string; name: string; area: number }[]
  totalFloorArea: number
  garageArea: number
  gardenArea: number
  pavedArea: number
  roomAreas: { floorId: string; roomId: string; name: string; area: number }[]
}

export function areaSummary(h: HouseState): AreaSummary {
  const plotArea = area(h.plot.polygon)
  const ground = h.floors.find((f) => f.level === 0)
  const coveredArea = ground ? floorBuiltArea(ground) : 0
  const floorAreas = h.floors.filter((f) => f.kind !== 'roof').map((f) => ({ floorId: f.id, name: f.name, area: floorIndoorArea(f) }))
  const garageArea = h.floors.flatMap((f) => f.rooms).filter((r) => r.type === 'garage').reduce((s, r) => s + roomArea(r), 0)
  const gardenArea = h.site.areas.filter((a) => a.kind === 'lawn' || a.kind === 'garden_bed' || a.kind === 'play_area').reduce((s, a) => s + area(a.polygon), 0)
  const pavedArea = h.site.areas.filter((a) => ['driveway', 'walkway', 'patio', 'deck', 'bbq_area', 'outdoor_kitchen', 'outdoor_sitting'].includes(a.kind)).reduce((s, a) => s + area(a.polygon), 0)
  const roomAreas = h.floors.flatMap((f) => f.rooms.map((r) => ({ floorId: f.id, roomId: r.id, name: r.name, area: roomArea(r) })))
  return {
    plotArea,
    coveredArea,
    openArea: Math.max(0, plotArea - coveredArea),
    floorAreas,
    totalFloorArea: floorAreas.reduce((s, f) => s + f.area, 0),
    garageArea,
    gardenArea,
    pavedArea,
    roomAreas
  }
}

export function designStats(h: HouseState): DesignStats {
  const a = areaSummary(h)
  const rooms = h.floors.flatMap((f) => f.rooms)
  const cars = rooms.filter((r) => r.type === 'garage').reduce((s, r) => s + (r.garage?.cars ?? 0), 0)
  return {
    plotArea: a.plotArea,
    coveredArea: a.coveredArea,
    openArea: a.openArea,
    totalFloorArea: a.totalFloorArea,
    gardenArea: a.gardenArea,
    bedrooms: rooms.filter((r) => isBedroomType(r.type) && r.type !== 'servant').length,
    bathrooms: rooms.filter((r) => r.type === 'bathroom').length,
    parking: cars,
    floors: h.floors.filter((f) => f.kind !== 'roof').length,
    rooms: rooms.filter((r) => spec(r.type).walkable && !spec(r.type).outdoor).length
  }
}

/** Wall surface area (both faces of interior walls, inner face of exterior), minus openings. */
export function wallAreas(f: Floor) {
  let interior = 0
  let exteriorFace = 0
  for (const w of f.walls) {
    const k = effectiveKind(w)
    if (k === 'virtual' || k === 'railing') continue
    const L = segLength(w.a, w.b)
    const H = w.height ?? (k === 'parapet' ? 1.0 : f.height - f.slabThickness)
    const holes = f.openings.filter((o) => o.wallId === w.id).reduce((s, o) => s + o.width * o.height, 0)
    const net = Math.max(0, L * H - holes)
    if (k === 'exterior') {
      interior += net
      exteriorFace += Math.max(0, L * f.height - holes)
    } else if (k === 'parapet') exteriorFace += net * 2
    else interior += 2 * net
  }
  return { interior, exteriorFace }
}

export function countBaths(h: HouseState) {
  return h.floors.flatMap((f) => f.rooms).filter((r) => isBathType(r.type)).length
}
