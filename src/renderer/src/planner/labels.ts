import type { Floor, HouseState, Room, RoomType } from '../core/model/types'
import { area, centroid } from '../core/geometry/polygon'
import { spec } from '../core/constraints/rooms'
import { sortedFloors } from '../core/model/house'
import { catalogItem } from '../core/furniture/catalog'
import { pointInPolygon } from '../core/geometry/polygon'

/**
 * Smart room labeling (§60): numbers bedrooms/baths in reading order across floors and names
 * attached rooms after their parent. Only rooms with autoName=true are renamed.
 */
export function applySmartLabels(h: Pick<HouseState, 'floors'>) {
  const floors = sortedFloors(h.floors).filter((f) => f.kind !== 'roof')
  let bed = 1
  let bath = 1
  const counters = new Map<RoomType, number>()
  const byId = new Map(h.floors.flatMap((f) => f.rooms.map((r) => [r.id, r] as const)))
  // masters first so "Bedroom 2" starts after them
  const ordered = floors.flatMap((f) => orderRooms(f))
  const masters = ordered.filter((r) => r.type === 'master_bedroom')
  masters.forEach((r, i) => {
    if (r.autoName) r.name = masters.length > 1 ? `Master Bedroom ${i + 1}` : 'Master Bedroom'
  })
  bed = masters.length + 1
  // parents first so attached rooms can use their final names
  const parentsFirst = [...ordered.filter((r) => !r.parentId), ...ordered.filter((r) => r.parentId)]
  const commonBaths = ordered.filter((r) => r.type === 'bathroom' && r.autoName && !(r.parentId && isBedroom(byId.get(r.parentId))))
  for (const r of parentsFirst) {
    if (!r.autoName) {
      if (r.type === 'bedroom') bed++
      continue
    }
    const parent = r.parentId ? byId.get(r.parentId) : undefined
    switch (r.type) {
      case 'master_bedroom':
        break
      case 'bedroom':
        r.name = `Bedroom ${bed++}`
        break
      case 'bathroom':
        if (parent && isBedroom(parent)) r.name = `${shortName(parent)} Bath`
        else r.name = commonBaths.length > 1 ? `Common Bath ${bath++}` : 'Common Bath'
        break
      case 'powder':
        r.name = 'Powder Room'
        break
      case 'dressing':
      case 'walk_in_closet':
        r.name = parent && isBedroom(parent) ? `${shortName(parent)} ${spec(r.type).label}` : spec(r.type).label
        break
      default: {
        const same = ordered.filter((x) => x.type === r.type && x.autoName && !x.parentId)
        const n = (counters.get(r.type) ?? 0) + 1
        counters.set(r.type, n)
        const base = r.type === 'terrace' && floors.length && r.name.startsWith('Roof') ? 'Roof Terrace' : spec(r.type).label
        r.name = same.length > 1 && !['corridor', 'terrace', 'void', 'balcony', 'stair'].includes(r.type) ? `${base} ${n}` : r.name && r.type === 'family' ? r.name : base
      }
    }
  }
}

const isBedroom = (r?: Room) => !!r && ['master_bedroom', 'bedroom', 'guest_bedroom', 'kids_room', 'servant'].includes(r.type)

function shortName(r: Room) {
  if (r.type === 'master_bedroom') return r.name.replace(' Bedroom', '')
  if (r.type === 'guest_bedroom') return 'Guest'
  if (r.type === 'kids_room') return 'Kids'
  return r.name
}

function orderRooms(f: Floor): Room[] {
  return [...f.rooms].sort((a, b) => {
    const ca = centroid(a.polygon)
    const cb = centroid(b.polygon)
    return Math.round(ca.y) - Math.round(cb.y) || ca.x - cb.x
  })
}

/**
 * Guess the type of an unlabeled room from its size, contents and neighbours (used by the
 * sketch/image recognizers). Returns the type and a confidence 0..1.
 */
export function guessRoomType(floor: Floor, room: Room): { type: RoomType; confidence: number; reason: string } {
  const a = area(room.polygon)
  const inside = floor.furniture.filter((fu) => pointInPolygon(fu.position, room.polygon)).map((fu) => catalogItem(fu.type)?.category)
  if (inside.includes('toilets')) return { type: 'bathroom', confidence: 0.95, reason: 'contains a toilet' }
  if (inside.includes('kitchen')) return { type: 'kitchen', confidence: 0.95, reason: 'contains kitchen units' }
  if (inside.includes('beds')) return { type: 'bedroom', confidence: 0.9, reason: 'contains a bed' }
  if (inside.includes('vehicles')) return { type: 'garage', confidence: 0.95, reason: 'contains a car' }
  const areas = floor.rooms.map((r) => area(r.polygon)).sort((x, y) => y - x)
  if (a < 2.5) return { type: 'store', confidence: 0.45, reason: 'very small space' }
  if (a < 5.5) return { type: 'bathroom', confidence: 0.55, reason: 'bathroom-sized' }
  if (a >= areas[0] - 1e-6 && a > 16) return { type: 'tv_lounge', confidence: 0.6, reason: 'largest room on the floor' }
  if (a < 9) return { type: 'kitchen', confidence: 0.35, reason: 'kitchen-sized' }
  return { type: 'bedroom', confidence: 0.5, reason: 'bedroom-sized' }
}
