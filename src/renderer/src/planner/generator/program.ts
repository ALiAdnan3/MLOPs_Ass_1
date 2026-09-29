import type { DesignStrategy, Plot, Requirements, RoomType, StairType, Zone } from '../../core/model/types'
import { spec } from '../../core/constraints/rooms'
import { sizeClassForArea, type SizeClass } from '../../core/units/plots'
import { ft } from '../../core/units/units'

/**
 * STRUCTURED REQUIREMENTS → PROGRAM (§55 step 2–4).
 * Turns wizard counts into a list of spaces with target sizes, zones, suites (attached rooms)
 * and assigns every space to a floor within the capacity of the buildable envelope.
 */

export interface ChildSpec {
  type: RoomType
  w: number
  d: number
}

export interface ProgramItem {
  key: string
  type: RoomType
  name: string
  /** Target area of the main room (m²), children excluded. */
  area: number
  minWidth: number
  children: ChildSpec[]
  zone: Zone
  hub: boolean
  priority: number
  level: number
  pinned?: 'stair' | 'lift'
  doubleHeight?: boolean
}

export interface Program {
  levels: number[]
  items: ProgramItem[]
  scale: number
  sizeClass: SizeClass
  cars: number
  stairType: StairType
  lift: boolean
  warnings: string[]
  notes: string[]
}

export function levelsFor(req: Requirements): number[] {
  let lv: number[]
  switch (req.floors) {
    case 'single':
      lv = [0]
      break
    case 'double':
      lv = [0, 1]
      break
    case 'triple':
      lv = [0, 1, 2]
      break
    case 'basement+ground':
      lv = [-1, 0]
      break
    case 'basement+ground+first':
      lv = [-1, 0, 1]
      break
    case 'basement+ground+first+second':
      lv = [-1, 0, 1, 2]
      break
    default: {
      const above = Math.max(1, Math.min(5, req.customFloors.above))
      lv = Array.from({ length: above }, (_, i) => i)
      if (req.customFloors.basement) lv.unshift(-1)
    }
  }
  if (req.special.basement && !lv.includes(-1)) lv.unshift(-1)
  return lv
}

const CLASS_SCALE: Record<SizeClass, number> = { compact: 0.86, standard: 1, large: 1.12, estate: 1.28 }

export function strategyScale(s: DesignStrategy) {
  return s === 'room-space' ? 1.1 : s === 'garden' ? 0.9 : s === 'luxury-open' ? 1.08 : 1
}

export function buildProgram(req: Requirements, plot: Plot, strategy: DesignStrategy, capacity: (level: number) => number): Program {
  const plotArea = plot.width * plot.depth
  const sizeClass = sizeClassForArea(plotArea)
  const lux = req.preferences.luxury / 100
  const scale = CLASS_SCALE[sizeClass] * (0.94 + 0.12 * lux) * strategyScale(strategy)
  const levels = levelsFor(req)
  const hasBasement = levels.includes(-1)
  const uppers = levels.filter((l) => l > 0)
  const warnings: string[] = []
  const notes: string[] = []
  const r = req.rooms
  let n = 0
  const key = (t: string) => `${t}-${n++}`

  const sized = (type: RoomType, mul = 1) => {
    const [w, d] = spec(type).target
    return w * d * scale * scale * mul
  }
  const child = (type: RoomType, w: number, d: number): ChildSpec => ({ type, w: w * scale, d: d * scale })
  const item = (type: RoomType, level: number, over: Partial<ProgramItem> = {}): ProgramItem => ({
    key: key(type),
    type,
    name: spec(type).label,
    area: sized(type),
    minWidth: spec(type).minWidth,
    children: [],
    zone: spec(type).zone,
    hub: spec(type).circulation,
    priority: 5,
    level,
    ...over
  })

  const items: ProgramItem[] = []

  // ── bedrooms & bath allocation ────────────────────────────────────────────
  const masters = Math.max(0, Math.min(r.masterBedrooms, r.bedrooms || r.masterBedrooms))
  const kids = r.kidsRooms
  const plainBeds = Math.max(0, r.bedrooms - masters - kids)
  const guests = r.guestBedrooms
  let bathsLeft = r.bathrooms
  const closets = { walk: r.walkInClosets, dress: r.dressingRooms }

  const bedItems: ProgramItem[] = []
  const suite = (it: ProgramItem, master: boolean) => {
    if (bathsLeft > 0) {
      it.children.push(master ? child('bathroom', ft(7.5), ft(10)) : child('bathroom', ft(6.5), ft(8.5)))
      bathsLeft--
    }
    if (master && closets.dress > 0) {
      it.children.push(child('dressing', ft(6.5), ft(8)))
      closets.dress--
    } else if (master && closets.walk > 0) {
      it.children.push(child('walk_in_closet', ft(7), ft(8)))
      closets.walk--
    }
    return it
  }
  for (let i = 0; i < masters; i++) bedItems.push(suite(item('master_bedroom', 1, { priority: 10 }), true))
  for (let i = 0; i < guests; i++) bedItems.push(suite(item('guest_bedroom', 0, { priority: 7 }), false))
  for (let i = 0; i < plainBeds; i++) bedItems.push(suite(item('bedroom', 1, { priority: 9 }), false))
  for (let i = 0; i < kids; i++) bedItems.push(suite(item('kids_room', 1, { priority: 8 }), false))
  // leftover closets go to other bedrooms
  for (const b of bedItems) {
    if (closets.walk > 0 && b.type !== 'guest_bedroom' && !b.children.some((c) => c.type === 'walk_in_closet' || c.type === 'dressing')) {
      b.children.push(child('walk_in_closet', ft(6), ft(7)))
      closets.walk--
    }
    if (closets.dress > 0 && b.type !== 'guest_bedroom' && !b.children.some((c) => c.type === 'walk_in_closet' || c.type === 'dressing')) {
      b.children.push(child('dressing', ft(6), ft(7)))
      closets.dress--
    }
  }
  items.push(...bedItems)
  const bedsWithoutBath = bedItems.filter((b) => !b.children.some((c) => c.type === 'bathroom')).length
  if (bedsWithoutBath > 0 && bathsLeft === 0) notes.push(`${bedsWithoutBath} bedroom(s) share a common bathroom`)

  // ── public / semi-private (ground) ────────────────────────────────────────
  const openPlan = strategy === 'luxury-open' || req.preferences.openSpace >= 75
  const hasFoyer = sizeClass !== 'compact' || req.special.doubleHeightEntrance
  if (hasFoyer) items.push(item('foyer', 0, { priority: 6, doubleHeight: req.special.doubleHeightEntrance && uppers.length > 0 }))
  for (let i = 0; i < r.drawingRooms; i++) items.push(item('drawing', 0, { priority: 8 }))
  for (let i = 0; i < r.tvLounges; i++)
    items.push(item('tv_lounge', 0, { priority: 10, area: sized('tv_lounge', openPlan ? 1.15 : 1), doubleHeight: i === 0 && (req.special.doubleHeightLounge || req.special.atrium) && uppers.length > 0 }))
  for (let i = 0; i < r.livingRooms; i++) items.push(item('living', 0, { priority: 6 }))
  for (let i = 0; i < r.diningRooms; i++) items.push(item('dining', 0, { priority: 8 }))
  for (let i = 0; i < r.kitchens; i++) {
    const k = item('kitchen', 0, { priority: 9, name: i === 0 ? 'Kitchen' : `Kitchen ${i + 1}` })
    if (i === 0 && r.pantries > 0) k.children.push(child('pantry', ft(5), ft(6)))
    items.push(k)
  }
  for (let i = 0; i < r.dirtyKitchens; i++) items.push(item('dirty_kitchen', 0, { priority: 6 }))
  for (let i = 1; i < r.pantries; i++) items.push(item('pantry', 0, { priority: 3 }))
  for (let i = 0; i < r.powderRooms; i++) items.push(item('powder', 0, { priority: 6 }))
  for (let i = 0; i < r.prayerRooms; i++) items.push(item('prayer', 0, { priority: 5 }))
  for (let i = 0; i < r.servantRooms; i++) {
    const s = item('servant', hasBasement ? -1 : 0, { priority: 5 })
    if (i < r.servantBathrooms) s.children.push(child('servant_bath', ft(5), ft(6)))
    items.push(s)
  }
  for (let i = r.servantRooms; i < r.servantBathrooms; i++) items.push(item('servant_bath', 0, { priority: 3 }))
  for (let i = 0; i < r.laundries; i++) items.push(item('laundry', hasBasement ? -1 : uppers.length ? 1 : 0, { priority: 4 }))
  for (let i = 0; i < r.stores; i++) items.push(item('store', hasBasement ? -1 : 0, { priority: 3 }))

  // ── family / work ─────────────────────────────────────────────────────────
  for (let i = 0; i < r.familyRooms; i++) items.push(item('family', uppers.length ? uppers[Math.min(i, uppers.length - 1)] : 0, { priority: 7 }))
  for (let i = 0; i < r.studyRooms; i++) items.push(item('study', uppers.length ? 1 : 0, { priority: 5 }))
  const offices = Math.max(r.offices, req.special.office ? 1 : 0)
  for (let i = 0; i < offices; i++) items.push(item('office', 0, { priority: 5 }))

  // common bathrooms left over
  for (let i = 0; i < bathsLeft; i++) {
    const lvl = bedsWithoutBath > 0 ? 1 : 0
    items.push(item('bathroom', lvl, { name: 'Common Bath', priority: 6 }))
  }

  if (req.special.centralCourtyard || req.outdoor.courtyard) {
    items.push(item('courtyard', 0, { priority: 6, area: sized('courtyard', sizeClass === 'compact' ? 0.6 : 1) }))
    notes.push('A courtyard open to the sky brings light and cross-ventilation into the middle of the house')
  }

  // ── special rooms ─────────────────────────────────────────────────────────
  const specialLevel = hasBasement ? -1 : uppers.length ? uppers[uppers.length - 1] : 0
  if (req.special.homeTheater) items.push(item('home_theater', specialLevel, { priority: 4 }))
  if (req.special.gym) items.push(item('gym', specialLevel, { priority: 4 }))
  if (req.special.gameRoom) items.push(item('game_room', specialLevel, { priority: 4 }))
  if (req.special.library) items.push(item('library', uppers.length ? uppers[uppers.length - 1] : 0, { priority: 4 }))

  // ── basement essentials ───────────────────────────────────────────────────
  if (hasBasement) {
    items.push(item('basement_lounge', -1, { priority: 8 }))
    items.push(item('mechanical', -1, { priority: 3 }))
    if (!items.some((i) => i.level === -1 && i.type === 'store')) items.push(item('store', -1, { priority: 3 }))
    notes.push('Basement reached from the main stair; light wells bring daylight to its rooms')
  }

  // ── hub on every upper floor ──────────────────────────────────────────────
  for (const lv of uppers) {
    if (!items.some((i) => i.level === lv && i.hub)) items.push(item('family', lv, { name: lv === 1 ? 'Family Lounge' : 'Upper Lounge', priority: 7, area: sized('family', 0.75) }))
  }
  if (!items.some((i) => i.level === 0 && i.hub)) items.push(item('tv_lounge', 0, { priority: 10 }))

  // ── vertical circulation (pinned on every floor) ──────────────────────────
  const stairType: StairType = req.special.stairType === 'auto' ? (sizeClass === 'estate' ? 'U' : 'U') : req.special.stairType
  if (levels.length > 1) {
    for (const lv of levels) items.push(item('stair', lv, { pinned: 'stair', priority: 100, hub: true, area: stairArea(stairType) }))
  }
  const lift = req.special.elevator && levels.length > 1
  if (lift) for (const lv of levels) items.push(item('lift', lv, { pinned: 'lift', priority: 90, area: ft(6) * ft(6), hub: false }))

  // ── allocate to floors within capacity ────────────────────────────────────
  const load = (lv: number) => items.filter((i) => i.level === lv).reduce((s, i) => s + itemArea(i), 0)
  const fix = (it: ProgramItem) => it.pinned || it.hub
  // clamp levels that do not exist
  for (const it of items) {
    if (!levels.includes(it.level)) {
      if (it.level === -1) it.level = 0
      else if (it.level > 0) it.level = uppers.length ? uppers[Math.min(uppers.length - 1, it.level - 1)] : 0
    }
  }
  // single story: everything on ground
  // spread bedrooms across upper floors when there are several
  if (uppers.length > 1) {
    const beds = items.filter((i) => ['master_bedroom', 'bedroom', 'kids_room'].includes(i.type))
    beds.forEach((b, idx) => (b.level = uppers[Math.min(uppers.length - 1, Math.floor((idx * uppers.length) / Math.max(1, beds.length)))]))
  }
  // overflow: move lowest-priority movable items to the next level with room
  const order = [0, ...uppers, ...(hasBasement ? [-1] : [])]
  for (let pass = 0; pass < 3; pass++) {
    for (const lv of levels) {
      let guard = 0
      while (load(lv) > capacity(lv) && guard++ < 40) {
        const movable = items.filter((i) => i.level === lv && !fix(i)).sort((a, b) => a.priority - b.priority)
        const target = movable.find((m) => order.some((o) => o !== lv && load(o) + itemArea(m) <= capacity(o) && allowedOn(m, o, hasBasement)))
        if (!target) break
        const dest = order.find((o) => o !== lv && load(o) + itemArea(target) <= capacity(o) && allowedOn(target, o, hasBasement))!
        notes.push(`${target.name} moved to ${levelName(dest)} to fit the plot`)
        target.level = dest
      }
    }
  }
  // still over capacity → shrink rooms on that level (never below minimum sizes)
  for (const lv of levels) {
    const cap = capacity(lv)
    const l = load(lv)
    if (l > cap) {
      const f = Math.max(0.72, cap / l)
      for (const it of items.filter((i) => i.level === lv && !i.pinned)) {
        it.area = Math.max(it.area * f, spec(it.type).minArea)
        it.children = it.children.map((c) => ({ ...c, w: c.w * Math.sqrt(Math.max(f, 0.8)), d: c.d * Math.sqrt(Math.max(f, 0.8)) }))
      }
      if (load(lv) > cap * 1.04) {
        // drop the lowest priority items that still do not fit
        const drop = items.filter((i) => i.level === lv && !fix(i)).sort((a, b) => a.priority - b.priority)
        while (load(lv) > cap * 1.04 && drop.length) {
          const d = drop.shift()!
          if (d.priority >= 9) break
          if (levels.length > 1 && ['laundry', 'store', 'servant', 'servant_bath'].includes(d.type) && !items.some((i) => i.level === ROOF_LEVEL && i.type === d.type)) {
            d.level = ROOF_LEVEL
            notes.push(`${d.name} placed on the roof beside the stair cover`)
            continue
          }
          items.splice(items.indexOf(d), 1)
          warnings.push(`${d.name} could not fit on the ${levelName(lv)} floor of this plot and was left out — add a floor or reduce room count`)
        }
      } else notes.push(`Rooms on the ${levelName(lv)} floor sized down ${Math.round((1 - f) * 100)}% to fit the plot`)
    }
  }

  // floors much emptier than the fullest one (which sets the footprint) get useful extra rooms
  const maxL = Math.max(...levels.map(load))
  const fillers: Record<string, RoomType[]> = { ground: ['living', 'family', 'office', 'prayer', 'store'], upper: ['family', 'study', 'library', 'store'], basement: ['game_room', 'gym', 'wine_storage', 'store'] }
  for (const lv of levels) {
    const list = lv === 0 ? fillers.ground : lv > 0 ? fillers.upper : fillers.basement
    for (const t of list) {
      if (load(lv) >= maxL * 0.8) break
      if (items.some((x) => x.level === lv && x.type === t && t !== 'store')) continue
      const extra = item(t, lv, { priority: 2, name: t === 'family' && lv === 0 ? 'Family Room' : t === 'living' ? 'Formal Living' : spec(t).label })
      items.push(extra)
      notes.push(`Added a ${extra.name.toLowerCase()} on the ${levelName(lv)} floor to use the space the upper floors need`)
    }
  }

  // small service rooms become attached rooms of a host on the same floor, so they get sensible
  // proportions (corner rooms) instead of thin full-width strips
  const attach = (type: RoomType, hosts: RoomType[], w: number, d: number) => {
    for (const it of items.filter((i) => i.type === type && !i.pinned && i.level !== ROOF_LEVEL)) {
      const host = hosts.map((h) => items.find((x) => x.level === it.level && x.type === h && x !== it && x.children.length < 2)).find(Boolean)
      if (!host) continue
      host.children.push(child(type, w, d))
      items.splice(items.indexOf(it), 1)
    }
  }
  attach('powder', ['foyer', 'tv_lounge', 'drawing', 'living'], ft(5), ft(6.5))
  attach('store', ['kitchen', 'dirty_kitchen', 'basement_lounge', 'family', 'tv_lounge'], ft(6), ft(7))
  attach('laundry', ['dirty_kitchen', 'kitchen', 'family', 'basement_lounge'], ft(6.5), ft(7.5))
  attach('bathroom', ['family', 'tv_lounge', 'basement_lounge', 'living'], ft(6.5), ft(8.5))

  return { levels, items, scale, sizeClass, cars: req.outdoor.garage ? Math.max(1, Math.min(4, req.outdoor.cars)) : 0, stairType, lift, warnings, notes }
}

function allowedOn(it: ProgramItem, lv: number, hasBasement: boolean) {
  if (it.type === 'drawing' || it.type === 'foyer' || it.type === 'garage') return lv === 0
  if (it.type === 'kitchen' || it.type === 'dirty_kitchen' || it.type === 'dining') return lv === 0 || (lv > 0 && it.type !== 'dirty_kitchen')
  if (lv === -1) return hasBasement && ['home_theater', 'gym', 'game_room', 'store', 'laundry', 'mechanical', 'wine_storage', 'servant', 'office', 'study', 'guest_bedroom', 'bedroom', 'bathroom', 'prayer', 'library'].includes(it.type)
  return true
}

/** Pseudo level for small service rooms placed on the roof next to the stair cover. */
export const ROOF_LEVEL = 99

export function itemArea(i: ProgramItem) {
  return i.area + i.children.reduce((s, c) => s + c.w * c.d, 0)
}

export function levelName(lv: number) {
  return lv === -1 ? 'basement' : lv === 0 ? 'ground' : lv === 1 ? 'first' : lv === 2 ? 'second' : `level ${lv}`
}

/** Plan footprint of a stair hall for a ~3.35 m floor-to-floor height. */
export function stairArea(t: StairType) {
  switch (t) {
    case 'straight':
    case 'floating':
    case 'modern':
      return 2.2 * 6.2
    case 'spiral':
      return 2.6 * 2.9
    case 'L':
      return 3.4 * 3.9
    default:
      return 2.6 * 4.6
  }
}

/** Minimum stair-hall dimensions (w along column width, d along depth). */
export function stairDims(t: StairType): { w: number; d: number } {
  switch (t) {
    case 'straight':
    case 'floating':
    case 'modern':
      return { w: 2.1, d: 6.0 }
    case 'spiral':
      return { w: 2.5, d: 2.8 }
    case 'L':
      return { w: 3.3, d: 3.8 }
    default:
      return { w: 2.5, d: 4.4 }
  }
}
