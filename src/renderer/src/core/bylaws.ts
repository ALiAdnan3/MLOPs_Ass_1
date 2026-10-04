import type { Floor, HouseState, Plot } from './model/types'
import { area, bbox } from './geometry/polygon'
import { spec } from './constraints/rooms'
import { FT } from './units/units'

/**
 * BUILDING RULES (amendment A4). Residential limits from published regulations, so a design can be
 * checked before a plan goes to the authority. Choosing an authority also sets the plot's setbacks,
 * which the generator then respects. Rules change; every result says which document it reads and
 * asks the user to confirm with the authority.
 *
 * Sources (read 2026-10):
 *  - LDA Building and Zoning Regulations 2019, amended to 28-01-2020, approved schemes:
 *    §2.2.1 mandatory open spaces, §2.2.3 ground coverage, storeys, height, FAR.
 *  - DHA Lahore Construction & Development Regulations 2026 (20 Apr 2026): clause 22 clear spaces,
 *    clause 23 height (39 ft with mumty and parapet, 32 ft without; no second floor),
 *    clause 27 first-floor covered area as a share of the ground floor.
 */

export type Authority = 'lda' | 'dha-lahore'

interface Band {
  /** Applies to plots smaller than this many marla (225 ft² each). */
  below: number
  front: number
  rear: number
  side: number
  /** Side spaces required: 0, 1 (either side) or 2 (both). */
  sides: 0 | 1 | 2
  /** Ground coverage, share of the plot. */
  coverage?: number
  /** First-floor covered area, share of the ground floor. */
  firstOfGround?: number
  /** Storeys above ground, basement excluded. */
  storeys: number
  /** Height to the top of the parapet (ft). */
  height?: number
  /** Height without stair cover and parapet (ft), and with them. */
  bodyHeight?: number
  totalHeight?: number
  far?: number
}

export const AUTHORITIES: Record<Authority, { name: string; source: string; bands: Band[] }> = {
  lda: {
    name: 'LDA (Lahore), approved schemes',
    source: 'LDA Building and Zoning Regulations 2019, amended to Jan 2020, §2.2.1 and §2.2.3',
    bands: [
      { below: 5, front: 5, rear: 5, side: 0, sides: 0, coverage: 0.8, storeys: 3, height: 38, far: 2.4 },
      { below: 10, front: 5, rear: 5, side: 0, sides: 0, coverage: 0.75, storeys: 3, height: 38, far: 2.3 },
      { below: 20, front: 10, rear: 7, side: 5, sides: 1, coverage: 0.7, storeys: 4, height: 45, far: 2.8 },
      { below: 30.5, front: 10, rear: 7, side: 5, sides: 1, coverage: 0.65, storeys: 4, height: 45, far: 2.6 },
      { below: 40, front: 10, rear: 7, side: 5, sides: 2, coverage: 0.6, storeys: 4, height: 45, far: 2.4 },
      { below: Infinity, front: 20, rear: 10, side: 10, sides: 2, coverage: 0.55, storeys: 4, height: 45, far: 2.2 }
    ]
  },
  'dha-lahore': {
    name: 'DHA Lahore',
    source: 'DHA Lahore Construction & Development Regulations 2026, clauses 22, 23 and 27',
    bands: [
      { below: 6, front: 5, rear: 3, side: 3, sides: 1, firstOfGround: 1, storeys: 2, bodyHeight: 32, totalHeight: 39 },
      { below: 7.5, front: 7, rear: 3, side: 3, sides: 1, firstOfGround: 0.82, storeys: 2, bodyHeight: 32, totalHeight: 39 },
      { below: 8.5, front: 8, rear: 4, side: 4, sides: 1, firstOfGround: 0.82, storeys: 2, bodyHeight: 32, totalHeight: 39 },
      { below: 9.5, front: 9, rear: 5.375, side: 4.75, sides: 1, firstOfGround: 0.82, storeys: 2, bodyHeight: 32, totalHeight: 39 },
      { below: 15, front: 10.75, rear: 5.375, side: 5.375, sides: 1, firstOfGround: 0.82, storeys: 2, bodyHeight: 32, totalHeight: 39 },
      { below: 30, front: 15.75, rear: 5.375, side: 5.375, sides: 2, firstOfGround: 0.8, storeys: 2, bodyHeight: 32, totalHeight: 39 },
      { below: Infinity, front: 20.75, rear: 8.375, side: 5.375, sides: 2, firstOfGround: 0.78, storeys: 2, bodyHeight: 32, totalHeight: 39 }
    ]
  }
}

export const marlaOf = (plot: Pick<Plot, 'polygon'>) => area(plot.polygon) / (225 * FT * FT)

export function bandFor(a: Authority, plot: Pick<Plot, 'polygon'>): Band {
  const m = marlaOf(plot)
  return AUTHORITIES[a].bands.find((b) => m < b.below) ?? AUTHORITIES[a].bands[AUTHORITIES[a].bands.length - 1]
}

/** Plot setbacks (m) that satisfy the authority. One required side space goes on the side away from a corner road. */
export function setbacksFor(a: Authority, plot: Pick<Plot, 'polygon' | 'corner' | 'cornerSide'>): Plot['setbacks'] {
  const b = bandFor(a, plot)
  const s = b.side * FT
  const oneSide = plot.corner && plot.cornerSide === 'left' ? 'right' : 'left'
  return {
    front: b.front * FT,
    rear: b.rear * FT,
    left: b.sides === 2 || (b.sides === 1 && oneSide === 'left') ? s : 0,
    right: b.sides === 2 || (b.sides === 1 && oneSide === 'right') ? s : 0
  }
}

export interface RuleCheck {
  key: string
  label: string
  limit: string
  actual: string
  ok: boolean
}

const ftTxt = (m: number) => {
  const inches = Math.round((m / FT) * 12)
  const f = Math.floor(inches / 12)
  const i = inches % 12
  return i ? `${f}′ ${i}″` : `${f}′`
}
const pct = (v: number) => `${Math.round(v * 100)}%`

const builtRect = (f: Floor) => {
  // the enclosed building on this floor; car porches may stand in open spaces, balconies may project
  const pts = f.rooms.filter((r) => r.type !== 'void' && r.type !== 'garage' && !spec(r.type).outdoor).flatMap((r) => r.polygon)
  return pts.length ? bbox(pts) : null
}
const coveredArea = (f: Floor) => f.rooms.filter((r) => r.type !== 'void' && !spec(r.type).outdoor).reduce((s, r) => s + area(r.polygon), 0)

export function checkBylaws(h: HouseState, a: Authority, opts: { plinth: number; parapet: number }): RuleCheck[] {
  const plot = h.plot
  const b = bandFor(a, plot)
  const pb = bbox(plot.polygon)
  const out: RuleCheck[] = []
  const above = h.floors.filter((f) => f.level >= 0 && f.kind !== 'roof')
  // open spaces: every floor's enclosed building must keep clear of them (y = depth is the road side)
  let front = Infinity
  let rear = Infinity
  let left = Infinity
  let right = Infinity
  for (const f of above) {
    const r = builtRect(f)
    if (!r) continue
    front = Math.min(front, pb.y + pb.h - (r.y + r.h))
    rear = Math.min(rear, r.y - pb.y)
    left = Math.min(left, r.x - pb.x)
    right = Math.min(right, pb.x + pb.w - (r.x + r.w))
  }
  const tol = 0.03
  if (front < Infinity) {
    out.push({ key: 'front', label: 'Front open space (building line)', limit: `at least ${ftTxt(b.front * FT)}`, actual: ftTxt(front), ok: front + tol >= b.front * FT })
    out.push({ key: 'rear', label: 'Rear open space', limit: `at least ${ftTxt(b.rear * FT)}`, actual: ftTxt(rear), ok: rear + tol >= b.rear * FT })
    if (b.sides) {
      const need = b.side * FT
      const sidesOk = b.sides === 2 ? Math.min(left, right) + tol >= need : Math.max(left, right) + tol >= need
      out.push({ key: 'side', label: b.sides === 2 ? 'Side open spaces (both sides)' : 'Side open space (one side)', limit: `at least ${ftTxt(need)}`, actual: `${ftTxt(left)} and ${ftTxt(right)}`, ok: sidesOk })
    }
  }
  const plotArea = area(plot.polygon)
  const ground = h.floors.find((f) => f.level === 0)
  const gArea = ground ? coveredArea(ground) : 0
  if (b.coverage !== undefined) out.push({ key: 'coverage', label: 'Ground coverage', limit: `at most ${pct(b.coverage)} of the plot`, actual: pct(gArea / plotArea), ok: gArea / plotArea <= b.coverage + 0.005 })
  const first = h.floors.find((f) => f.level === 1)
  if (b.firstOfGround !== undefined && first && gArea > 0) {
    const r = coveredArea(first) / gArea
    out.push({ key: 'first', label: 'First floor covered area', limit: `at most ${pct(b.firstOfGround)} of the ground floor`, actual: pct(r), ok: r <= b.firstOfGround + 0.005 })
  }
  out.push({ key: 'storeys', label: 'Storeys above ground', limit: `at most ${b.storeys}${b.storeys === 2 ? ' (no second floor)' : ''}`, actual: `${above.length}`, ok: above.length <= b.storeys })
  const body = opts.plinth + above.reduce((s, f) => s + f.height, 0)
  const roof = h.floors.find((f) => f.kind === 'roof')
  const mumty = roof?.rooms.some((r) => r.type === 'mumty') ? roof.height : 0
  if (b.height !== undefined) out.push({ key: 'height', label: 'Height to top of parapet', limit: `at most ${b.height}′`, actual: ftTxt(body + opts.parapet), ok: body + opts.parapet <= b.height * FT + tol })
  if (b.bodyHeight !== undefined) out.push({ key: 'body', label: 'Height without stair cover and parapet', limit: `at most ${b.bodyHeight}′`, actual: ftTxt(body), ok: body <= b.bodyHeight * FT + tol })
  if (b.totalHeight !== undefined) out.push({ key: 'total', label: 'Height with stair cover and parapet', limit: `at most ${b.totalHeight}′`, actual: ftTxt(body + Math.max(opts.parapet, mumty)), ok: body + Math.max(opts.parapet, mumty) <= b.totalHeight * FT + tol })
  if (b.far !== undefined) {
    const total = h.floors.filter((f) => f.kind !== 'roof').reduce((s, f) => s + coveredArea(f), 0)
    out.push({ key: 'far', label: 'Floor area ratio (incl. basement)', limit: `at most 1:${b.far}`, actual: `1:${(total / plotArea).toFixed(2)}`, ok: total / plotArea <= b.far + 0.01 })
  }
  return out
}
