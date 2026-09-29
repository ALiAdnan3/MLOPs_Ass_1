import type { Preferences, RoomType, StairType } from '../../core/model/types'
import type { Rect } from '../../core/geometry/polygon'
import { spec } from '../../core/constraints/rooms'
import { itemArea, stairDims, type ProgramItem } from './program'
import type { Rng } from './random'

/**
 * SPACE ALLOCATION + ROOM GRAPH + FLOOR PLAN (§55).
 *
 * A floor is a set of vertical columns; each column is a stack of room slots from its front edge
 * (road side, max y) to the back. Columns may have different front edges, so the house can wrap
 * around a car porch (L-shaped plans on compact plots). Pinned slots (stair, lift, voids over
 * double-height rooms) keep the same position on every floor. Simulated annealing searches column
 * assignment, order and column widths, scoring:
 *   size fit · minimum dimensions · access from a circulation hub · connected circulation ·
 *   entrance at the front · privacy zoning · daylight (party walls excluded) · adjacencies.
 */

export interface PinnedSlot {
  id: string
  type: RoomType
  name: string
  col: number
  y0: number
  y1: number
  hub: boolean
  walkable: boolean
  /** Void pins: gallery strips (corridors) kept along the sides so rooms beside the void stay reachable. */
  galleries?: 'left' | 'right' | 'both' | 'none'
  openToSky?: boolean
  sourceKey?: string
}

export interface ColumnState {
  x: number
  w: number
  /** Front edge (max y) of this column. */
  front: number
  /** Segments between pins, front to back; each segment is an ordered list of items (front first). */
  segments: ProgramItem[][]
  pins: PinnedSlot[]
}

export interface PartyLines {
  /** Plot boundary lines with no setback: walls on them are shared with neighbours (no windows). */
  left?: number
  right?: number
  back?: number
}

export interface FloorLayoutInput {
  footprint: Rect
  items: ProgramItem[]
  pins: PinnedSlot[]
  columnXs: number[] | null
  columnFronts?: number[]
  level: number
  prefs: Preferences
  weights: StrategyWeights
  /** Car porch rectangle (ground floor) — blocks light and receives the entrance. */
  garage?: Rect
  stairType: StairType
  party: PartyLines
  /** Basement: only the back edge (light wells) gets daylight. */
  basement?: boolean
}

export interface StrategyWeights {
  privacy: number
  light: number
  size: number
  open: number
}

export interface PlacedSlot {
  key: string
  item?: ProgramItem
  pin?: PinnedSlot
  type: RoomType
  rect: Rect
  col: number
  hub: boolean
  walkable: boolean
  atFront: boolean
  /** Sub rectangles for pins with galleries. */
  parts?: { type: RoomType; rect: Rect; hub: boolean; walkable: boolean; name: string; openToSky?: boolean }[]
}

export interface FloorLayoutResult {
  columns: ColumnState[]
  slots: PlacedSlot[]
  cost: number
  breakdown: Record<string, number>
}

const HUB_MIN_CONTACT = 1.05

export function fixedDepth(item: ProgramItem, colW: number, stairType: StairType): number | undefined {
  if (item.pinned === 'stair' || item.type === 'stair') {
    const d = stairDims(stairType)
    if (stairType === 'spiral') return d.d
    // wide column: run the stair across the column, which keeps the hall shallow
    if (colW >= d.d + 0.2) return d.w + 0.1
    return d.d + 0.2
  }
  if (item.pinned === 'lift' || item.type === 'lift') return 2.0
  return undefined
}

/** Compute slot rectangles for a column configuration. */
export function placeColumns(columns: ColumnState[], fp: Rect, stairType: StairType): PlacedSlot[] {
  const out: PlacedSlot[] = []
  columns.forEach((col, ci) => {
    const pins = [...col.pins].sort((a, b) => b.y1 - a.y1)
    const bounds: [number, number][] = []
    let top = col.front
    for (const p of pins) {
      bounds.push([p.y1, top])
      top = p.y0
    }
    bounds.push([fp.y, top])
    col.segments.forEach((seg, si) => {
      const [lo, hi] = bounds[si] ?? [fp.y, fp.y]
      const L = Math.max(0, hi - lo)
      if (!seg.length && L > 0.05) {
        // an empty stretch between pins: becomes flexible space (penalised during search)
        out.push({ key: `gap-${ci}-${si}`, type: L * col.w < 5 ? 'store' : 'study', rect: { x: col.x, y: lo, w: col.w, h: L }, col: ci, hub: false, walkable: true, atFront: Math.abs(hi - col.front) < 1e-6 })
        return
      }
      let fixed = 0
      let flexArea = 0
      for (const it of seg) {
        const fd = fixedDepth(it, col.w, stairType)
        if (fd !== undefined) fixed += fd
        else flexArea += itemArea(it)
      }
      const flexL = Math.max(0, L - fixed)
      let y = hi
      seg.forEach((it, k) => {
        const fd = fixedDepth(it, col.w, stairType)
        let d = fd ?? (flexArea > 0 ? (flexL * itemArea(it)) / flexArea : 0)
        if (k === seg.length - 1) d = y - lo
        const rect = { x: col.x, y: y - d, w: col.w, h: d }
        out.push({ key: it.key, item: it, type: it.type, rect, col: ci, hub: it.hub, walkable: spec(it.type).walkable, atFront: Math.abs(y - col.front) < 1e-6 })
        y -= d
      })
    })
    for (const p of pins) {
      const rect = { x: col.x, y: p.y0, w: col.w, h: p.y1 - p.y0 }
      const slot: PlacedSlot = { key: p.id, pin: p, type: p.type, rect, col: ci, hub: p.hub, walkable: p.walkable, atFront: Math.abs(p.y1 - col.front) < 1e-6 }
      if (p.type === 'void' && p.galleries && p.galleries !== 'none') {
        const g = Math.min(1.25, col.w * 0.3)
        const parts: NonNullable<PlacedSlot['parts']> = []
        let vx = rect.x
        let vw = rect.w
        if (p.galleries === 'left' || p.galleries === 'both') {
          parts.push({ type: 'corridor', name: 'Gallery', rect: { x: rect.x, y: rect.y, w: g, h: rect.h }, hub: true, walkable: true })
          vx += g
          vw -= g
        }
        if (p.galleries === 'right' || p.galleries === 'both') {
          parts.push({ type: 'corridor', name: 'Gallery', rect: { x: rect.x + rect.w - g, y: rect.y, w: g, h: rect.h }, hub: true, walkable: true })
          vw -= g
        }
        parts.push({ type: 'void', name: p.name, rect: { x: vx, y: rect.y, w: vw, h: rect.h }, hub: false, walkable: false, openToSky: p.openToSky })
        slot.parts = parts
      }
      out.push(slot)
    }
  })
  return out
}

/** Shared edge length between two axis-aligned rects (0 if they don't touch). */
export function contact(a: Rect, b: Rect, tol = 1e-3): number {
  if (Math.abs(a.x + a.w - b.x) < tol || Math.abs(b.x + b.w - a.x) < tol) {
    return Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  }
  if (Math.abs(a.y + a.h - b.y) < tol || Math.abs(b.y + b.h - a.y) < tol) {
    return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  }
  return 0
}

export type EdgeName = 'left' | 'right' | 'front' | 'back'

interface Seg {
  horiz: boolean
  c: number
  lo: number
  hi: number
}

function edgeSeg(r: Rect, e: EdgeName): Seg {
  switch (e) {
    case 'left':
      return { horiz: false, c: r.x, lo: r.y, hi: r.y + r.h }
    case 'right':
      return { horiz: false, c: r.x + r.w, lo: r.y, hi: r.y + r.h }
    case 'back':
      return { horiz: true, c: r.y, lo: r.x, hi: r.x + r.w }
    default:
      return { horiz: true, c: r.y + r.h, lo: r.x, hi: r.x + r.w }
  }
}

function covered(s: Seg, r: Rect): number {
  if (s.horiz) {
    if (Math.abs(r.y - s.c) > 1e-3 && Math.abs(r.y + r.h - s.c) > 1e-3) return 0
    return Math.max(0, Math.min(s.hi, r.x + r.w) - Math.max(s.lo, r.x))
  }
  if (Math.abs(r.x - s.c) > 1e-3 && Math.abs(r.x + r.w - s.c) > 1e-3) return 0
  return Math.max(0, Math.min(s.hi, r.y + r.h) - Math.max(s.lo, r.y))
}

/**
 * Daylight exposure of each edge of a rect: its length on the building perimeter, excluding party
 * walls, the part behind the car porch (ground floor) and — in basements — anything but the back.
 */
export function edgeExposure(r: Rect, others: { rect: Rect; open?: boolean }[], party: PartyLines, garage?: Rect, basement = false): Record<EdgeName, number> {
  const res = { left: 0, right: 0, front: 0, back: 0 } as Record<EdgeName, number>
  for (const e of ['left', 'right', 'front', 'back'] as EdgeName[]) {
    if (basement && e !== 'back') continue
    const s = edgeSeg(r, e)
    if (!s.horiz && ((party.left !== undefined && Math.abs(s.c - party.left) < 0.5) || (party.right !== undefined && Math.abs(s.c - party.right) < 0.5))) continue
    if (s.horiz && e === 'back' && party.back !== undefined && Math.abs(s.c - party.back) < 0.5) continue
    let L = s.hi - s.lo
    for (const o of others) if (!o.open && o.rect !== r) L -= covered(s, o.rect)
    if (garage) L -= covered(s, garage)
    res[e] = Math.max(0, L)
  }
  return res
}

interface Unit {
  key: string
  type: RoomType
  rect: Rect
  hub: boolean
  walkable: boolean
  atFront: boolean
  open: boolean
  item?: ProgramItem
}

function units(slots: PlacedSlot[]): Unit[] {
  const out: Unit[] = []
  for (const s of slots) {
    if (s.parts)
      s.parts.forEach((p, i) =>
        out.push({ key: `${s.key}#${i}`, type: p.type, rect: p.rect, hub: p.hub, walkable: p.walkable, atFront: s.atFront, open: !!p.openToSky })
      )
    else out.push({ key: s.key, type: s.type, rect: s.rect, hub: s.hub, walkable: s.walkable, atFront: s.atFront, open: s.type === 'courtyard' || !!s.pin?.openToSky, item: s.item })
  }
  return out
}

export function evaluate(slots: PlacedSlot[], inp: FloorLayoutInput): { cost: number; breakdown: Record<string, number> } {
  const fp = inp.footprint
  const b: Record<string, number> = { size: 0, dims: 0, access: 0, circulation: 0, entrance: 0, zoning: 0, light: 0, adjacency: 0, stair: 0 }
  const us = units(slots)
  const n = us.length
  const C: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) C[i][j] = C[j][i] = contact(us[i].rect, us[j].rect)
  const byType = (t: RoomType) => us.map((u, i) => (u.type === t ? i : -1)).filter((i) => i >= 0)
  const touchesAny = (i: number, js: number[], min = 1.0) => js.some((j) => C[i][j] >= min)

  // unplanned gaps
  for (const u of us) if (u.key.startsWith('gap-')) b.dims += 25 + u.rect.w * u.rect.h * 6

  // size & dimensions
  for (const u of us) {
    const it = u.item
    if (!it) continue
    const a = u.rect.w * u.rect.h
    const target = itemArea(it)
    if (target > 0 && !it.pinned) b.size += ((a - target) / target) ** 2 * 12 * inp.weights.size
    const short = Math.min(u.rect.w, u.rect.h)
    const long = Math.max(u.rect.w, u.rect.h)
    const sp = spec(it.type)
    const childStrip = it.children.length ? Math.max(...it.children.map((c) => Math.min(c.w, c.d))) : 0
    // suites: the attached strip comes off the long side, the room keeps the short side
    const needShort = sp.minWidth
    const needLong = sp.minWidth + childStrip
    if (short < needShort) b.dims += (needShort - short) * 45
    if (long < needLong) b.dims += (needLong - long) * 45
    if (it.children.length && long - childStrip < short * 0.7) b.dims += (short * 0.7 - (long - childStrip)) * 20
    const maxAsp = sp.maxAspect + (it.children.length ? 0.9 : 0.25)
    if (short > 0.01 && long / short > maxAsp) b.dims += (long / short - maxAsp) * 18
    if (u.type === 'stair' || u.type === 'lift') {
      const d = u.type === 'stair' ? stairDims(inp.stairType) : { w: 1.8, d: 1.8 }
      const ok = (u.rect.w >= d.w - 0.05 && u.rect.h >= d.d - 0.05) || (u.rect.w >= d.d - 0.05 && u.rect.h >= d.w - 0.05)
      if (!ok) b.stair += 60
      // a stair hall should not swallow floor space other rooms need
      const excess = a / (d.w * d.d) - 1.7
      if (excess > 0) b.stair += excess * excess * 25 + excess * 10
    }
    if (u.rect.h < 0.3) b.dims += 80
  }

  // access: each walkable non-hub unit must touch a hub
  const hubs = us.map((u, i) => (u.hub && u.walkable ? i : -1)).filter((i) => i >= 0)
  const stairIdx = byType('stair')
  const realHubs = hubs.filter((h) => us[h].type !== 'stair')
  for (let i = 0; i < n; i++) {
    const u = us[i]
    if (u.hub || !u.walkable) continue
    if (touchesAny(i, realHubs, HUB_MIN_CONTACT)) continue
    b.access += touchesAny(i, stairIdx, HUB_MIN_CONTACT) ? 18 : 70
  }
  // circulation connected + entrance
  if (hubs.length) {
    let start = hubs[0]
    if (inp.level === 0) {
      const g = inp.garage
      const frontHub = realHubs.find((h) => us[h].atFront && us[h].rect.w >= 1.2)
      if (frontHub === undefined) b.entrance += 120
      else {
        start = frontHub
        if (us[frontHub].type === 'foyer') b.entrance -= 4
      }
      void g
    } else if (stairIdx.length) start = stairIdx[0]
    const seen = new Set([start])
    const q = [start]
    while (q.length) {
      const c = q.shift()!
      for (const h of hubs)
        if (!seen.has(h) && C[c][h] >= HUB_MIN_CONTACT) {
          seen.add(h)
          q.push(h)
        }
    }
    for (const h of hubs) if (!seen.has(h)) b.circulation += 70
  }

  // zoning (front = 1, back = 0)
  const privacy = inp.weights.privacy
  const depth = Math.max(1, Math.max(...us.map((u) => u.rect.y + u.rect.h)) - fp.y)
  for (const u of us) {
    if (!u.item) continue
    const f = (u.rect.y + u.rect.h / 2 - fp.y) / depth
    let desired: number | null = null
    let w = 0
    const z = spec(u.type).zone
    if (inp.level === 0) {
      if (u.type === 'drawing' || u.type === 'guest_bedroom' || u.type === 'foyer' || u.type === 'office') [desired, w] = [1, 2.2]
      else if (z === 'private') [desired, w] = [0, 1.8]
      else if (z === 'service' || u.type === 'dirty_kitchen') [desired, w] = [0.05, 1.2]
      else if (u.type === 'kitchen') [desired, w] = [0.25, 0.8]
      else if (u.type === 'tv_lounge' || u.type === 'dining') [desired, w] = [0.45, 0.5]
    } else if (u.type === 'master_bedroom') [desired, w] = [0.1, 0.3]
    if (desired !== null) b.zoning += (f - desired) ** 2 * 10 * w * privacy
  }

  // daylight
  const others = us.map((u) => ({ rect: u.rect, open: u.open }))
  for (const u of us) {
    const sp = spec(u.type)
    if (!u.walkable || sp.outdoor) continue
    const ex = edgeExposure(u.rect, others, inp.party, inp.level === 0 ? inp.garage : undefined, inp.basement)
    let ext = ex.left + ex.right + ex.front + ex.back
    // windows onto a courtyard / open void count
    for (const o of us) if (o.open && o !== u) ext += contact(u.rect, o.rect)
    const weight = u.type === 'master_bedroom' || u.type === 'bedroom' || u.type === 'kids_room' || u.type === 'guest_bedroom' ? 16 : u.type === 'kitchen' ? 12 : 7
    if (sp.habitable && ext < 1.4) b.light += weight * inp.weights.light
    else if (sp.wet && ext < 0.9) b.light += 2
  }

  // adjacency preferences
  const pref = (t1: RoomType, t2: RoomType[], pen: number, min = 1.0) => {
    for (const i of byType(t1)) if (!touchesAny(i, t2.flatMap(byType), min)) b.adjacency += pen
  }
  pref('kitchen', ['dining'], 22 + 10 * inp.weights.open)
  pref('dining', ['tv_lounge', 'living', 'foyer', 'family'], 10)
  pref('dirty_kitchen', ['kitchen'], 35)
  pref('laundry', ['dirty_kitchen', 'kitchen', 'corridor', 'store'], 3)
  pref('servant', ['dirty_kitchen', 'kitchen', 'garage'], 4)
  pref('drawing', ['foyer'], 6)
  pref('stair', ['foyer', 'tv_lounge', 'family', 'basement_lounge', 'corridor', 'living'], 14)
  if (inp.level === 0 && inp.garage) {
    const g = inp.garage
    const behind = us.filter((u) => covered(edgeSeg(u.rect, 'front'), g) > 1.2)
    if (!behind.some((u) => u.hub || u.type === 'kitchen' || u.type === 'drawing' || u.type === 'store' || u.type === 'foyer')) b.adjacency += 6
  }
  const cost = Object.values(b).reduce((s, x) => s + x, 0)
  return { cost, breakdown: b }
}

function cloneCols(cols: ColumnState[]): ColumnState[] {
  return cols.map((c) => ({ x: c.x, w: c.w, front: c.front, pins: c.pins, segments: c.segments.map((s) => s.slice()) }))
}

/** Build the initial column configuration. */
export function initialColumns(inp: FloorLayoutInput, rnd: Rng): ColumnState[] {
  const fp = inp.footprint
  let xs: number[]
  if (inp.columnXs) xs = inp.columnXs
  else {
    const W = fp.w
    const k = W < 11.2 ? 2 : 3
    if (k === 2) {
      const spineRight = rnd.chance(0.5)
      const side = W * rnd.range(0.44, 0.54)
      xs = spineRight ? [fp.x, fp.x + side, fp.x + W] : [fp.x, fp.x + W - side, fp.x + W]
    } else {
      const spine = Math.min(Math.max(W * rnd.range(0.3, 0.38), 4.2), 8.5)
      const left = (W - spine) * rnd.range(0.44, 0.56)
      xs = [fp.x, fp.x + left, fp.x + left + spine, fp.x + W]
    }
  }
  const cols: ColumnState[] = []
  for (let i = 0; i < xs.length - 1; i++) {
    const pins = inp.pins.filter((p) => p.col === i)
    cols.push({ x: xs[i], w: xs[i + 1] - xs[i], front: inp.columnFronts?.[i] ?? fp.y + fp.h, pins, segments: Array.from({ length: pins.length + 1 }, () => []) })
  }
  const spineIdx = cols.length === 3 ? 1 : cols[0].w > cols[1].w ? 0 : 1
  const free = inp.items.filter((it) => !inp.pins.some((p) => p.sourceKey === it.key))
  const hubs = free.filter((i) => i.hub || i.type === 'dining' || i.type === 'courtyard')
  const others = free.filter((i) => !hubs.includes(i))
  const zoneRank = (it: ProgramItem) => {
    const z = spec(it.type).zone
    return z === 'public' ? 0 : z === 'semi' ? 1 : z === 'service' ? 3 : 2
  }
  others.sort((a, b) => zoneRank(a) - zoneRank(b) || b.area - a.area)
  hubs.sort((a, b) => (a.type === 'foyer' ? -1 : b.type === 'foyer' ? 1 : 0) || zoneRank(a) - zoneRank(b))
  const pushTo = (ci: number, it: ProgramItem) => {
    const c = cols[ci]
    const pins = [...c.pins].sort((a, b) => b.y1 - a.y1)
    let top = c.front
    const lens: number[] = []
    for (const p of pins) {
      lens.push(top - p.y1)
      top = p.y0
    }
    lens.push(top - fp.y)
    let best = 0
    let bestLen = -Infinity
    lens.forEach((L, si) => {
      const used = c.segments[si].reduce((s, x) => s + itemArea(x) / c.w, 0)
      if (L - used > bestLen) {
        bestLen = L - used
        best = si
      }
    })
    c.segments[best].push(it)
  }
  for (const h of hubs) pushTo(spineIdx, h)
  const sideCols = cols.map((_, i) => i).filter((i) => i !== spineIdx)
  others.forEach((it, i) => {
    const loads = sideCols.map((ci) => cols[ci].segments.flat().reduce((s, x) => s + itemArea(x), 0) / (cols[ci].w * (cols[ci].front - fp.y)))
    let pick = sideCols[loads.indexOf(Math.min(...loads))]
    if (it.type === 'stair' && cols[spineIdx].w >= 4.6 && rnd.chance(0.35)) pick = spineIdx
    if (i === 0 && rnd.chance(0.25)) pick = sideCols[rnd.int(0, sideCols.length - 1)]
    pushTo(pick, it)
  })
  return cols
}

export function optimizeFloor(inp: FloorLayoutInput, rnd: Rng, iterations = 3500): FloorLayoutResult {
  const fp = inp.footprint
  let cur = initialColumns(inp, rnd)
  const score = (cols: ColumnState[]) => evaluate(placeColumns(cols, fp, inp.stairType), inp)
  let curScore = score(cur).cost
  let best = cloneCols(cur)
  let bestScore = curScore
  const T0 = 60
  const allowWidth = !inp.columnXs
  for (let it = 0; it < iterations; it++) {
    const T = T0 * Math.pow(0.002, it / iterations)
    const next = cloneCols(cur)
    const r = rnd.next()
    const allSegs: { c: number; s: number }[] = []
    next.forEach((c, ci) => c.segments.forEach((_, si) => allSegs.push({ c: ci, s: si })))
    const nonEmpty = allSegs.filter((x) => next[x.c].segments[x.s].length > 0)
    if (!nonEmpty.length) break
    if (r < 0.35) {
      const a = rnd.pick(nonEmpty)
      const bSeg = rnd.pick(nonEmpty)
      const sa = next[a.c].segments[a.s]
      const sb = next[bSeg.c].segments[bSeg.s]
      const i = rnd.int(0, sa.length - 1)
      const j = rnd.int(0, sb.length - 1)
      ;[sa[i], sb[j]] = [sb[j], sa[i]]
    } else if (r < 0.72) {
      const a = rnd.pick(nonEmpty)
      const sa = next[a.c].segments[a.s]
      const i = rnd.int(0, sa.length - 1)
      const [moved] = sa.splice(i, 1)
      const dst = rnd.pick(allSegs)
      const sd = next[dst.c].segments[dst.s]
      sd.splice(rnd.int(0, sd.length), 0, moved)
    } else if (r < 0.88 || !allowWidth || next.length < 2) {
      const a = rnd.pick(nonEmpty)
      const sa = next[a.c].segments[a.s]
      if (sa.length > 1) {
        const i = rnd.int(0, sa.length - 1)
        const [m] = sa.splice(i, 1)
        sa.splice(rnd.int(0, sa.length), 0, m)
      }
    } else {
      const k = rnd.int(1, next.length - 1)
      const delta = rnd.range(-0.6, 0.6)
      const left = next[k - 1]
      const right = next[k]
      if (left.w + delta > 2.6 && right.w - delta > 2.6) {
        left.w += delta
        right.x += delta
        right.w -= delta
      }
    }
    const s = score(next).cost
    if (s < curScore || rnd.next() < Math.exp((curScore - s) / Math.max(T, 1e-6))) {
      cur = next
      curScore = s
      if (s < bestScore) {
        bestScore = s
        best = cloneCols(next)
      }
    }
  }
  const slots = placeColumns(best, fp, inp.stairType)
  const ev = evaluate(slots, inp)
  return { columns: best, slots, cost: ev.cost, breakdown: ev.breakdown }
}
