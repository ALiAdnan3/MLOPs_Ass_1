import type { Floor, Project, Room, RoomType, SiteAreaKind, Vec2 } from '../core/model/types'
import { bbox, centroid, pointInPolygon, area } from '../core/geometry/polygon'
import { floorElevations, sortedFloors } from '../core/model/house'
import { spec } from '../core/constraints/rooms'
import { resolveMaterial } from '../core/materials/library'
import { STYLE_TITLE } from '../core/model/defaults'

/**
 * HOME SHOWCASE (amendment A9): every area of the house worth looking at (kitchen, TV lounge,
 * each bedroom and bathroom, the car porch, terraces, the garden and the outside of the house),
 * each with a camera chosen to show it well, plus the house's key features in plain words.
 */

export type AreaGroup = 'exterior' | 'living' | 'kitchen' | 'bedrooms' | 'bathrooms' | 'parking' | 'outdoor' | 'basement' | 'other'

export const AREA_GROUPS: { key: AreaGroup; label: string }[] = [
  { key: 'exterior', label: 'Exterior' },
  { key: 'living', label: 'Living & dining' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'bedrooms', label: 'Bedrooms' },
  { key: 'bathrooms', label: 'Bathrooms' },
  { key: 'parking', label: 'Garage & parking' },
  { key: 'outdoor', label: 'Terraces & garden' },
  { key: 'basement', label: 'Basement' },
  { key: 'other', label: 'More rooms' }
]

export interface Pose {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

export interface AreaView {
  key: string
  title: string
  /** Floor name and size, e.g. "Ground floor, 18′ × 16′". */
  subtitle: string
  group: AreaGroup
  kind: 'interior' | 'exterior' | 'outdoor'
  floorId?: string
  roomId?: string
  pose: Pose
  /** Plain-words finishes for the AI photo prompt. */
  finishes: string[]
  /** What the area is called in the AI photo prompt. */
  promptArea: string
}

const GROUP_OF: Partial<Record<RoomType, AreaGroup>> = {
  tv_lounge: 'living',
  drawing: 'living',
  living: 'living',
  family: 'living',
  dining: 'living',
  foyer: 'living',
  kitchen: 'kitchen',
  dirty_kitchen: 'kitchen',
  master_bedroom: 'bedrooms',
  bedroom: 'bedrooms',
  guest_bedroom: 'bedrooms',
  kids_room: 'bedrooms',
  bathroom: 'bathrooms',
  powder: 'bathrooms',
  garage: 'parking',
  terrace: 'outdoor',
  balcony: 'outdoor',
  courtyard: 'outdoor',
  basement_lounge: 'basement',
  home_theater: 'other',
  gym: 'other',
  game_room: 'other',
  library: 'other',
  study: 'other',
  office: 'other',
  prayer: 'other',
  stair: 'other'
}

/** Gardens and outdoor rooms on the site worth a picture of their own. */
const SITE_VIEWS: Partial<Record<SiteAreaKind, string>> = {
  lawn: 'Lawn & garden',
  patio: 'Patio',
  pool: 'Swimming pool',
  outdoor_sitting: 'Outdoor sitting',
  bbq_area: 'BBQ area',
  deck: 'Deck',
  outdoor_kitchen: 'Outdoor kitchen',
  play_area: 'Play area'
}

const FT = 0.3048
const len = (m: number) => {
  const inches = Math.round(m / FT * 12)
  return `${Math.floor(inches / 12)}′${inches % 12 ? ` ${inches % 12}″` : ''}`
}
const v3 = (x: number, y: number, z: number): [number, number, number] => [x, y, z]
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

function houseFootprint(p: Project) {
  const pts = p.floors.filter((f) => f.level >= 0).flatMap((f) => f.rooms.filter((r) => r.type !== 'void' && !spec(r.type).outdoor).flatMap((r) => r.polygon))
  return bbox(pts.length ? pts : p.plot.polygon)
}

function finishesOf(p: Project, r: Room): string[] {
  const s = spec(r.type)
  const name = (id: string | undefined) => (id ? resolveMaterial(id, p.materials)?.name?.toLowerCase() : undefined)
  const out: string[] = []
  const fl = name(r.floorMaterial ?? s.floorFinish)
  if (fl) out.push(`${fl} floor`)
  const wl = name(r.wallMaterial ?? s.wallFinish)
  if (wl) out.push(`${wl} walls`)
  if (r.ceilingType === 'false-ceiling') out.push('a dropped false ceiling with recessed lights')
  if (r.ceilingType === 'cove') out.push('a cove-lit ceiling')
  return out
}

function edgeDistance(p: Vec2, poly: Vec2[]) {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)))
  }
  return best
}

/**
 * Inside a room, the way a photographer would: stand near the edge of the room, clear of the walls,
 * furniture and columns, and look across it towards the furniture, so the picture shows the room
 * in use. Spots with something big right in front of the lens are avoided.
 */
export function interiorPose(f: Floor, r: Room, elevation: number): Pose {
  const b = bbox(r.polygon)
  const c = centroid(r.polygon)
  const items = f.furniture.filter((it) => pointInPolygon(it.position, r.polygon))
  const fc = items.length ? { x: items.reduce((a, it) => a + it.position.x, 0) / items.length, y: items.reduce((a, it) => a + it.position.y, 0) / items.length } : c
  const obstacles = [
    ...items.map((it) => ({ x: it.position.x, y: it.position.y, rad: Math.hypot(it.width, it.depth) / 2, tall: it.height > 1.1 })),
    ...f.columns.map((col) => ({ x: col.position.x, y: col.position.y, rad: Math.max(col.width, col.depth) * 0.71, tall: true })),
    ...f.openings.flatMap((o) => {
      const w = o.kind === 'door' ? f.walls.find((x) => x.id === o.wallId) : undefined
      if (!w) return []
      const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1
      const at = { x: w.a.x + ((w.b.x - w.a.x) * o.offset) / L, y: w.a.y + ((w.b.y - w.a.y) * o.offset) / L }
      return dist(at, c) < Math.hypot(b.w, b.h) ? [{ x: at.x, y: at.y, rad: o.width * 0.95, tall: true }] : []
    })
  ]
  const ceiling = r.ceilingHeight ?? f.height - f.slabThickness
  const lookAt = (p: Vec2) => lerp(fc, { x: 2 * c.x - p.x, y: 2 * c.y - p.y }, 0.35)
  const N = 9
  const pick = (wall: number, clear: number): Vec2 | null => {
    let best: Vec2 | null = null
    let bestScore = -Infinity
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const p = { x: b.x + (b.w * (i + 0.5)) / N, y: b.y + (b.h * (j + 0.5)) / N }
        if (!pointInPolygon(p, r.polygon)) continue
        const edge = edgeDistance(p, r.polygon)
        if (edge < wall) continue
        if (obstacles.some((o) => Math.hypot(p.x - o.x, p.y - o.y) < o.rad + clear)) continue
        const look = lookAt(p)
        const vx = look.x - p.x
        const vy = look.y - p.y
        const vl = Math.hypot(vx, vy) || 1
        // anything big within a metre or so in front of the lens fills the picture
        let blocked = 0
        for (const o of obstacles) {
          const ox = o.x - p.x
          const oy = o.y - p.y
          const d = Math.hypot(ox, oy) - o.rad
          if (d > 1.4) continue
          const cos = (ox * vx + oy * vy) / ((Math.hypot(ox, oy) || 1) * vl)
          if (cos > 0.45) blocked += (1.4 - d) * (o.tall ? 3 : 1.2)
        }
        // near the edge of the room (sees all of it), far from the furniture it looks at
        const score = dist(p, fc) * 1.2 + dist(p, c) * 0.8 - edge * 0.6 - blocked * 2
        if (score > bestScore) {
          bestScore = score
          best = p
        }
      }
    return best
  }
  // a tightly furnished room: allow spots ever closer to the walls and furniture before giving up
  const cam = pick(0.55, 0.3) ?? pick(0.4, 0.1) ?? pick(0.3, -0.25) ?? pick(0.22, -0.6) ?? c
  const look = lookAt(cam)
  const eye = elevation + Math.min(1.5, ceiling * 0.5)
  const diag = Math.hypot(b.w, b.h)
  const fov = diag < 3.6 ? 84 : diag < 5.5 ? 76 : 68
  return { position: v3(cam.x, eye, cam.y), target: v3(look.x, elevation + Math.min(1.05, ceiling * 0.36), look.y), fov }
}

/** A car porch or garage: from the driveway, looking in. */
function garagePose(p: Project, r: Room, elevation: number): Pose {
  const b = bbox(r.polygon)
  const c = centroid(r.polygon)
  const front = Math.min(p.plot.depth + p.plot.roadWidth * 0.3, b.y + b.h + Math.max(3.5, b.w * 0.8))
  return { position: v3(c.x - b.w * 0.25, elevation + 1.7, front), target: v3(c.x + b.w * 0.05, elevation + 1.0, c.y), fov: 64 }
}

/** A terrace or balcony: stand by the house wall and look out over the rail. */
function outwardPose(p: Project, r: Room, elevation: number): Pose {
  const hb = houseFootprint(p)
  const hc = { x: hb.x + hb.w / 2, y: hb.y + hb.h / 2 }
  const c = centroid(r.polygon)
  const d = dist(c, hc) || 1
  const dir = { x: (c.x - hc.x) / d, y: (c.y - hc.y) / d }
  const b = bbox(r.polygon)
  const depth = Math.abs(dir.x) > Math.abs(dir.y) ? b.w : b.h
  const back = Math.min(depth * 0.3, 1.6)
  let cam = { x: c.x - dir.x * back, y: c.y - dir.y * back }
  for (let i = 0; i < 6 && !pointInPolygon(cam, r.polygon); i++) cam = lerp(cam, c, 0.5)
  return { position: v3(cam.x, elevation + 1.6, cam.y), target: v3(c.x + dir.x * 12, elevation + 0.2, c.y + dir.y * 12), fov: 70 }
}

/** A garden area: from its far side, raised a little, looking back at it with the house behind. */
function sitePose(p: Project, poly: Vec2[]): Pose {
  const hb = houseFootprint(p)
  const hc = { x: hb.x + hb.w / 2, y: hb.y + hb.h / 2 }
  const c = centroid(poly)
  const b = bbox(poly)
  const d = dist(c, hc) || 1
  const dir = { x: (c.x - hc.x) / d, y: (c.y - hc.y) / d }
  const reach = Math.max(3, Math.max(b.w, b.h) * 0.6)
  const pb = bbox(p.plot.polygon)
  const trees = p.site.objects.filter((o) => ['tree', 'palm', 'shrub', 'hedge'].some((k) => o.kind.includes(k)))
  const look = lerp(c, hc, 0.3)
  let best = { x: c.x + dir.x * reach, y: c.y + dir.y * reach }
  let bestScore = -Infinity
  for (let k = 0; k < 16; k++) {
    const a = Math.atan2(dir.y, dir.x) + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 8
    const q = { x: Math.min(pb.x + pb.w - 0.4, Math.max(pb.x + 0.4, c.x + Math.cos(a) * reach)), y: Math.min(pb.y + pb.h - 0.4, Math.max(pb.y + 0.4, c.y + Math.sin(a) * reach)) }
    // a trunk right in front of the lens ruins the picture
    let blocked = 0
    for (const t of trees) {
      const d = Math.hypot(t.position.x - q.x, t.position.y - q.y)
      const tx = t.position.x - q.x
      const ty = t.position.y - q.y
      const cos = (tx * (look.x - q.x) + ty * (look.y - q.y)) / ((d || 1) * (dist(q, look) || 1))
      if (d < 1.5) blocked += 5
      else if (d < 5 && cos > 0.8) blocked += (5 - d) * 1.5
    }
    const score = -blocked - Math.abs(Math.ceil(k / 2)) * 0.35 + dist(q, hc) * 0.05
    if (score > bestScore) {
      bestScore = score
      best = q
    }
  }
  // from above the tree tops, looking down over the garden towards the house
  return { position: v3(best.x, 6.8, best.y), target: v3(lerp(c, look, 0.5).x, 0.6, lerp(c, look, 0.5).y), fov: 62 }
}

/** The outside: a three-quarter view of the front, the back from the garden, and a bird's-eye view. */
function exteriorViews(p: Project): AreaView[] {
  const hb = houseFootprint(p)
  const H = p.floors.filter((f) => f.level >= 0 && f.kind !== 'roof').reduce((a, f) => a + f.height, 0) + p.settings.plinthHeight
  const c = { x: hb.x + hb.w / 2, y: hb.y + hb.h / 2 }
  const s = Math.max(hb.w, hb.h, 10)
  const front = p.plot.depth
  const style = STYLE_TITLE[p.exterior.style] ?? 'modern'
  return [
    { key: 'ext-front', title: 'Front elevation', subtitle: `${style}, from the street`, group: 'exterior', kind: 'exterior', pose: { position: v3(hb.x - hb.w * 0.25, 2.2, front + Math.max(7, p.plot.roadWidth * 0.8)), target: v3(c.x + hb.w * 0.08, H * 0.5, hb.y + hb.h * 0.75), fov: 54 }, finishes: [], promptArea: 'front of the house, seen from the street' },
    { key: 'ext-aerial', title: 'Aerial view', subtitle: 'House, garden and plot from above', group: 'exterior', kind: 'exterior', pose: { position: v3(c.x + s * 0.9, H + s * 0.75, front + s * 0.7), target: v3(c.x, H * 0.3, c.y), fov: 46 }, finishes: [], promptArea: 'whole house and garden, seen by a drone from above' },
    { key: 'ext-rear', title: 'Rear view', subtitle: 'The back of the house and garden', group: 'exterior', kind: 'exterior', pose: { position: v3(c.x + hb.w * 0.45, H * 0.95 + 2, hb.y - Math.max(7, s * 0.6)), target: v3(c.x, H * 0.4, c.y), fov: 48 }, finishes: [], promptArea: 'back of the house, seen from the rear garden' }
  ]
}

/** Every area of the house worth a picture, in showcase order. */
export function areaViews(p: Project): AreaView[] {
  const out: AreaView[] = exteriorViews(p)
  const el = floorElevations(p.floors, p.settings.plinthHeight)
  const floors = sortedFloors(p.floors)
  const seenType = new Map<RoomType, number>()
  const rooms: { f: Floor; r: Room; g: AreaGroup }[] = []
  for (const f of floors) {
    for (const r of f.rooms) {
      let g = GROUP_OF[r.type]
      if (!g) continue
      if (f.level < 0 && g !== 'bathrooms') g = 'basement'
      // a staircase is worth one picture, not one per floor
      if (r.type === 'stair' && seenType.has('stair')) continue
      seenType.set(r.type, (seenType.get(r.type) ?? 0) + 1)
      rooms.push({ f, r, g })
    }
  }
  const order = AREA_GROUPS.map((x) => x.key)
  rooms.sort((a, b) => order.indexOf(a.g) - order.indexOf(b.g) || a.f.level - b.f.level)
  for (const { f, r, g } of rooms) {
    const e = el.get(f.id) ?? 0
    const b = bbox(r.polygon)
    const pose = r.type === 'garage' ? garagePose(p, r, e) : r.type === 'terrace' || r.type === 'balcony' ? outwardPose(p, r, e) : interiorPose(f, r, e)
    const title = r.type === 'balcony' || r.type === 'terrace' ? `${r.name} view` : r.type === 'stair' ? 'Staircase' : r.name
    out.push({
      key: `room-${r.id}`,
      title,
      subtitle: `${f.name} floor, ${len(Math.max(b.w, b.h))} × ${len(Math.min(b.w, b.h))}`,
      group: g,
      kind: r.type === 'garage' || spec(r.type).outdoor ? 'outdoor' : 'interior',
      floorId: f.id,
      roomId: r.id,
      pose,
      finishes: finishesOf(p, r),
      promptArea: r.type === 'garage' ? (r.enclosed ? 'garage' : 'car porch') : spec(r.type).label.toLowerCase()
    })
  }
  // the garden: the biggest area of each kind
  const byKind = new Map<SiteAreaKind, Vec2[]>()
  for (const a of p.site.areas) if (SITE_VIEWS[a.kind] && (!byKind.has(a.kind) || area(a.polygon) > area(byKind.get(a.kind)!))) byKind.set(a.kind, a.polygon)
  for (const [kind, poly] of byKind) {
    const b = bbox(poly)
    if (b.w * b.h < 4) continue
    out.push({ key: `site-${kind}`, title: SITE_VIEWS[kind]!, subtitle: `${len(b.w)} × ${len(b.h)}`, group: 'outdoor', kind: 'outdoor', pose: sitePose(p, poly), finishes: [], promptArea: SITE_VIEWS[kind]!.toLowerCase() })
  }
  return out
}

/* ── key features ───────────────────────────────────────────────────────── */

export interface KeyFeature {
  icon: 'bed' | 'guest' | 'kitchen' | 'sofa' | 'dining' | 'basement' | 'patio' | 'balcony' | 'car' | 'garden' | 'pool' | 'prayer' | 'study' | 'gym' | 'theater' | 'stairs' | 'solar' | 'servant' | 'laundry' | 'lift' | 'height'
  title: string
  detail?: string
}

const count = (rooms: Room[], ...types: RoomType[]) => rooms.filter((r) => types.includes(r.type)).length
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The house's selling points, worked out from the actual design. */
export function keyFeatures(p: Project): KeyFeature[] {
  const all = p.floors.flatMap((f) => f.rooms)
  const out: KeyFeature[] = []
  const beds = all.filter((r) => ['master_bedroom', 'bedroom', 'kids_room'].includes(r.type))
  const attached = beds.filter((b) => all.some((x) => x.parentId === b.id && (x.type === 'bathroom' || x.type === 'powder'))).length
  if (beds.length) out.push({ icon: 'bed', title: plural(beds.length, 'Bedroom'), detail: attached === beds.length ? 'Attached bathrooms' : attached ? `${attached} with attached bathrooms` : undefined })
  const guest = count(all, 'guest_bedroom')
  if (guest) {
    const g = all.find((r) => r.type === 'guest_bedroom')!
    out.push({ icon: 'guest', title: plural(guest, 'Guest Room'), detail: all.some((x) => x.parentId === g.id && x.type === 'bathroom') ? 'Attached bathroom' : undefined })
  }
  const k = count(all, 'kitchen')
  const dk = count(all, 'dirty_kitchen')
  if (k + dk) out.push({ icon: 'kitchen', title: plural(k + dk, 'Kitchen'), detail: dk ? `${k} main + ${dk} dirty` : undefined })
  const living = all.filter((r) => ['tv_lounge', 'drawing', 'living', 'family'].includes(r.type))
  if (living.length) out.push({ icon: 'sofa', title: plural(living.length, 'Living Area'), detail: [...new Set(living.map((r) => spec(r.type).label))].join(' + ') })
  if (count(all, 'dining')) out.push({ icon: 'dining', title: 'Dining Room' })
  const basement = p.floors.filter((f) => f.level < 0)
  if (basement.length) {
    const uses = [...new Set(basement.flatMap((f) => f.rooms).filter((r) => !['stair', 'corridor', 'store', 'mechanical', 'void', 'lift'].includes(r.type)).map((r) => spec(r.type).label.replace('Basement ', '')))]
    out.push({ icon: 'basement', title: 'Basement', detail: uses.slice(0, 3).join(' + ') || undefined })
  }
  const patio = p.site.areas.some((a) => a.kind === 'patio' || a.kind === 'outdoor_sitting') || count(all, 'courtyard')
  if (patio) out.push({ icon: 'patio', title: count(all, 'courtyard') ? 'Courtyard' : 'Patio' })
  const bal = count(all, 'balcony')
  const ter = count(all, 'terrace')
  if (bal) out.push({ icon: 'balcony', title: plural(bal, 'Balcony', 'Balconies') })
  if (ter) out.push({ icon: 'balcony', title: plural(ter, 'Terrace') })
  const cars = p.requirements?.outdoor?.cars ?? 0
  if (count(all, 'garage') || cars) out.push({ icon: 'car', title: 'Parking Space', detail: cars ? plural(cars, 'car') : undefined })
  const lawn = p.site.areas.filter((a) => a.kind === 'lawn' || a.kind === 'garden_bed').reduce((s, a) => s + area(a.polygon), 0)
  if (lawn > 4) out.push({ icon: 'garden', title: 'Lawn & Garden', detail: `${Math.round(lawn / (FT * FT))} ft²` })
  if (p.site.areas.some((a) => a.kind === 'pool')) out.push({ icon: 'pool', title: 'Swimming Pool' })
  if (count(all, 'prayer')) out.push({ icon: 'prayer', title: 'Prayer Room' })
  if (count(all, 'study', 'office', 'library')) out.push({ icon: 'study', title: 'Study' })
  if (count(all, 'gym')) out.push({ icon: 'gym', title: 'Gym' })
  if (count(all, 'home_theater', 'game_room')) out.push({ icon: 'theater', title: count(all, 'home_theater') ? 'Home Theatre' : 'Game Room' })
  if (all.some((r) => r.doubleHeight)) out.push({ icon: 'height', title: 'Double-height Lounge' })
  if (count(all, 'servant')) out.push({ icon: 'servant', title: 'Servant Quarter', detail: count(all, 'servant_bath') ? 'With bathroom' : undefined })
  if (count(all, 'laundry')) out.push({ icon: 'laundry', title: 'Laundry' })
  if (count(all, 'lift')) out.push({ icon: 'lift', title: 'Lift' })
  const panels = p.site.objects.filter((o) => o.kind === 'solar_panel').length
  if (panels) out.push({ icon: 'solar', title: 'Rooftop Solar', detail: plural(panels, 'panel') })
  return out
}

/** "1 Kanal (500 sq yds)". */
export function plotSizeLabel(p: Project, presetLabel?: string) {
  const sqft = area(p.plot.polygon) / (FT * FT)
  const yds = Math.round(sqft / 9)
  return presetLabel ? `${presetLabel} (${yds} sq yds)` : `${Math.round(sqft)} ft² (${yds} sq yds)`
}
