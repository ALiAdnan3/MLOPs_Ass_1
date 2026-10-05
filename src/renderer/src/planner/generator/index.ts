import type {
  Column,
  Beam,
  DesignOption,
  DesignScores,
  DesignStrategy,
  Floor,
  HouseState,
  Plot,
  ProjectSettings,
  Requirements,
  Room,
  RoomType,
  Stair,
  StairType
} from '../../core/model/types'
import { seededIds, type IdFactory } from '../../core/model/ids'
import { exteriorForStyle, makeFloor } from '../../core/model/defaults'
import { rectPoly, type Rect, bbox, rectsOverlap, area, pointInPolygon, differencePolys } from '../../core/geometry/polygon'
import { spec, isBedroomType, isBathType } from '../../core/constraints/rooms'
import { ft } from '../../core/units/units'
import { rng, type Rng } from './random'
import { buildProgram, itemArea, levelName, levelsFor, ROOF_LEVEL, stairDims, type ProgramItem } from './program'
import { chooseFootprint, planEnvelope } from './siteplan'
import { edgeExposure, optimizeFloor, type FloorLayoutInput, type FloorLayoutResult, type PartyLines, type PinnedSlot, type PlacedSlot, type StrategyWeights } from './layout'
import { splitSuite, type Edge } from './suites'
import { rebuildWalls, effectiveKind, wallsOfRoom } from '../walls'
import { addDoor, placeWindows, sharedWalls, DOOR_W, roomRect } from './openings'
import { fitStair, risersFor, stairShape } from '../stairs'
import { furnishFloor } from '../furnish'
import { qiblaVector } from '../../core/location'
import { placeSolarPanels } from '../solar'
import { AUTHORITIES, bandFor, checkBylaws } from '../../core/bylaws'
import { FT } from '../../core/units/units'
import { designLandscape, rectMinus } from './landscape'
import { applySmartLabels } from '../labels'
import { designStats } from '../metrics'
import { validateHouse } from '../validation'
import { repairAccess } from '../access'

export interface StrategyInfo {
  key: DesignStrategy
  label: string
  name: string
  blurb: string
  weights: StrategyWeights
}

export const STRATEGIES: StrategyInfo[] = [
  { key: 'family', label: 'A', name: 'Modern Family Layout', blurb: 'Balanced rooms around a central family lounge', weights: { privacy: 1, light: 1, size: 1, open: 0.5 } },
  { key: 'luxury-open', label: 'B', name: 'Luxury Open Layout', blurb: 'Open lounge, dining and kitchen with generous rooms', weights: { privacy: 0.7, light: 1.2, size: 1.1, open: 1 } },
  { key: 'privacy', label: 'C', name: 'Privacy Focused Layout', blurb: 'Guests stay at the front; family rooms at the back and upstairs', weights: { privacy: 2.2, light: 0.8, size: 1, open: 0.2 } },
  { key: 'garden', label: 'D', name: 'Maximum Garden Layout', blurb: 'Compact footprint that leaves the most open green space', weights: { privacy: 1, light: 1, size: 0.8, open: 0.5 } },
  { key: 'room-space', label: 'E', name: 'Maximum Room Space Layout', blurb: 'Uses the whole buildable area for larger rooms', weights: { privacy: 1, light: 0.9, size: 1.3, open: 0.4 } }
]

export interface GenerateOptions {
  settings: Pick<ProjectSettings, 'wallThickness' | 'floorHeight' | 'plinthHeight'>
  seed?: number
  iterations?: number
  /** Progress through the §55 pipeline. */
  onStage?: (stage: PipelineStage) => void
  /** Internal: tightens the first-floor step-back when a layout came out over the limit. */
  firstShareScale?: number
}

export const PIPELINE = ['Requirements', 'Constraints', 'Space allocation', 'Room graph', 'Floor plans', 'Structure', 'Openings', 'Validation', 'Explanation'] as const
export type PipelineStage = (typeof PIPELINE)[number]

export interface GenerationError {
  what: string
  why: string
  fix: string
}

export class DesignGenerationError extends Error {
  constructor(public info: GenerationError) {
    super(info.what)
  }
}

const HUB_TYPES = new Set<RoomType>(['foyer', 'tv_lounge', 'living', 'family', 'corridor', 'basement_lounge', 'dining', 'stair'])

/**
 * Bathrooms a person cannot actually use (amendment A7): no room for a WC, or narrower / smaller
 * than the tightest workable layout (WC and basin, 3'9" wide). Powder rooms may be smaller.
 */
export function unusableBaths(h: HouseState): string[] {
  const out: string[] = []
  for (const f of h.floors)
    for (const r of f.rooms) {
      if (!isBathType(r.type)) continue
      const b = bbox(r.polygon)
      const powder = r.type === 'powder'
      const wc = f.furniture.some((x) => x.type === 'wc' && pointInPolygon(x.position, r.polygon))
      if (Math.min(b.w, b.h) < (powder ? 0.9 : 1.15) || area(r.polygon) < (powder ? 1.2 : 1.9) || !wc) out.push(r.name)
    }
  return out
}

const bathCount = (h: HouseState) => h.floors.reduce((s, f) => s + f.rooms.filter((r) => isBathType(r.type)).length, 0)

/**
 * Generate one design. If a bathroom comes out unusable, other layouts are tried (another seed,
 * then one bathroom fewer so bedrooms share) and the one with the most usable bathrooms wins;
 * the design then says what changed instead of delivering cupboard-sized bathrooms.
 */
export function generateDesign(req: Requirements, plot: Plot, strategy: DesignStrategy, opts: GenerateOptions): DesignOption {
  const first = generateCompliant(req, plot, strategy, opts)
  const rate = (d: DesignOption) => {
    const bad = unusableBaths(d.house).length
    const all = bathCount(d.house)
    return { bad, all, usable: all - bad }
  }
  let best = first
  let br = rate(first)
  if (!br.bad) return first
  const seed0 = first.seed
  for (let drop = 0; drop <= 2 && br.bad; drop++) {
    const n = req.rooms.bathrooms - drop
    if (n < Math.max(1, Math.ceil(req.rooms.bedrooms / 2))) break
    const r = structuredClone(req)
    r.rooms.bathrooms = n
    for (const k of drop === 0 ? [1, 2] : [0, 1]) {
      const d = generateCompliant(r, plot, strategy, { ...opts, seed: seed0 + k * 7919 })
      const dr = rate(d)
      if (dr.usable > br.usable || (dr.usable === br.usable && dr.bad < br.bad)) {
        best = d
        br = dr
      }
      if (!dr.bad) break
    }
  }
  if (best !== first && br.all < rate(first).all) best.warnings.unshift(`${br.all} ${br.all === 1 ? 'bathroom' : 'bathrooms'} instead of ${rate(first).all}, so each one is big enough to use on this plot; bedrooms without their own bathroom share one`)
  const bad = unusableBaths(best.house)
  if (bad.length) best.warnings.unshift(`${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} too small to use comfortably; enlarge ${bad.length === 1 ? 'it' : 'them'} in the plan, choose fewer rooms or add a floor`)
  return best
}

/**
 * Under an authority's ground-coverage limit (amendment A4), a design that covers too much is
 * regenerated with a deeper rear open space (more garden) until it complies; the plot keeps the
 * authority's own setbacks.
 */
function generateCompliant(req: Requirements, plot: Plot, strategy: DesignStrategy, opts: GenerateOptions): DesignOption {
  let d = generateOnce(req, plot, strategy, opts)
  const a = plot.authority
  if (!a) return d
  const band = bandFor(a, plot)
  // first-floor share: correct the step-back from the measured result, then try other layouts
  // (a stair pinned at the front can block it)
  const firstOver = (x: DesignOption) => checkBylaws(x.house, a, { plinth: 0.457, parapet: x.house.exterior.parapetHeight }).find((c) => c.key === 'first' && !c.ok)
  let scale = 0.985
  if (band.firstOfGround !== undefined) {
    for (let k = 0; k < 4 && firstOver(d); k++) {
      const g = d.house.floors.find((f) => f.level === 0)!
      const f1 = d.house.floors.find((f) => f.level === 1)!
      const cov = (f: typeof g) => f.rooms.filter((r) => r.type !== 'void' && !spec(r.type).outdoor).reduce((s, r) => s + area(r.polygon), 0)
      const ratio = cov(f1) / Math.max(1, cov(g))
      scale *= (band.firstOfGround / ratio) * 0.99
      d = generateOnce(req, plot, strategy, { ...opts, seed: k < 2 ? d.seed : d.seed + k * 104729, firstShareScale: scale })
    }
  }
  const limit = band.coverage
  if (limit === undefined) return d
  let rear = plot.setbacks.rear
  for (let k = 0; k < 4; k++) {
    const over = checkBylaws(d.house, a, { plinth: 0.457, parapet: d.house.exterior.parapetHeight }).find((c) => c.key === 'coverage' && !c.ok)
    if (!over) break
    const g = d.house.floors.find((f) => f.level === 0)!
    const covered = g.rooms.filter((r) => r.type !== 'void' && !spec(r.type).outdoor).reduce((s, r) => s + area(r.polygon), 0)
    const gb = bbox(g.rooms.filter((r) => r.type !== 'void' && !spec(r.type).outdoor).flatMap((r) => r.polygon))
    // start from the back yard the design actually has (garden wishes may already exceed the minimum)
    rear = Math.max(rear, gb.y - bbox(plot.polygon).y) + ((covered - limit * area(plot.polygon)) / Math.max(1, gb.w)) * 1.25 + 0.15
    const next = generateOnce(req, { ...plot, setbacks: { ...plot.setbacks, rear } }, strategy, { ...opts, seed: d.seed, firstShareScale: scale })
    next.house.plot = { ...next.house.plot, setbacks: { ...plot.setbacks } }
    next.warnings.unshift(`The house is kept to ${Math.round(limit * 100)}% ground coverage for ${AUTHORITIES[a].name}, so the back yard is deeper`)
    d = next
  }
  return d
}

function generateOnce(req: Requirements, plot: Plot, strategy: DesignStrategy, opts: GenerateOptions): DesignOption {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9)
  const rnd = rng(seed)
  const ids = seededIds(seed)
  const info = STRATEGIES.find((s) => s.key === strategy) ?? STRATEGIES[0]
  const warnings: string[] = []
  const notes: string[] = []

  if (plot.width < 4.5 || plot.depth < 7) {
    throw new DesignGenerationError({
      what: 'The plot is too small to generate a house',
      why: `A ${plot.width.toFixed(1)} × ${plot.depth.toFixed(1)} m plot leaves no room for a stair, kitchen and bedroom after setbacks.`,
      fix: 'Enter a plot at least 15 × 25 ft, or check that width and length are in the right unit.'
    })
  }

  const stage = (x: PipelineStage) => opts.onStage?.(x)
  stage('Requirements')
  // ── constraint engine: envelope ──────────────────────────────────────────
  stage('Constraints')
  const env = planEnvelope(plot, req, strategy)
  warnings.push(...env.warnings)
  const levels = levelsFor(req)
  const usable = env.maxRect.w * env.maxRect.h * 0.9
  // compact plots can wrap around the car porch (ground) and build over it (upper floors)
  const wrapDepth = Math.max(0, env.frontYard - plot.setbacks.front)
  const compactPlot = plot.width * plot.depth < 1300 * 0.0929
  const capacity = (lv: number) => {
    if (!compactPlot && strategy !== 'room-space') return usable
    if (lv === 0) return usable + Math.max(0, env.maxRect.w - env.garageW) * wrapDepth * 0.9
    if (lv > 0) return usable + env.maxRect.w * wrapDepth * 0.9
    return usable
  }
  const program = buildProgram(req, plot, strategy, capacity)
  warnings.push(...program.warnings)
  notes.push(...program.notes)

  const loadOf = (lv: number) => program.items.filter((i) => i.level === lv).reduce((s, i) => s + itemArea(i), 0)
  const maxLoad = Math.max(...levels.map(loadOf))
  const fp = chooseFootprint(env, maxLoad / 0.9, strategy)

  // car porch (garage) in the front yard, against the house
  const garageSide: 'left' | 'right' = env.ventSide ? (env.ventSide === 'left' ? 'right' : 'left') : strategy === 'privacy' ? (seed % 2 ? 'right' : 'left') : rnd.chance(0.5) ? 'left' : 'right'
  if (env.ventSide) notes.push(`A ${env.ventSide} side ventilation strip lets side rooms have windows on a plot with shared boundary walls`)
  let garageRect: Rect | undefined
  const plotR = env.plotRect
  const plotFront = plotR.y + plotR.h
  const sbFront = plot.setbacks.front
  if (env.cars > 0) {
    const gw = Math.min(env.garageW, fp.w)
    garageRect = { x: garageSide === 'left' ? fp.x : fp.x + fp.w - gw, y: fp.y + fp.h, w: gw, h: plotFront - (fp.y + fp.h) }
  }
  // party walls: plot boundaries without a setback
  const party: PartyLines = {}
  if (fp.x - plotR.x < 0.5 && !(plot.corner && plot.cornerSide === 'left')) party.left = plotR.x
  if (plotR.x + plotR.w - (fp.x + fp.w) < 0.5 && !(plot.corner && plot.cornerSide === 'right')) party.right = plotR.x + plotR.w
  if (fp.y - plotR.y < 0.5) party.back = plotR.y

  const floorHeight = req.preferences.luxury >= 75 ? ft(12) : opts.settings.floorHeight
  const lux = req.preferences.luxury
  const iterations = opts.iterations ?? 3200

  // compact plots (and "maximum room space") wrap the house around the car porch on the ground
  // floor and build over the porch upstairs — the way real 5–8 marla houses are built
  const frontLine = Math.max(fp.y + fp.h, plotFront - sbFront)
  const groundTight = loadOf(0) > fp.w * fp.h * 0.9
  const upperTight = levels.filter((l) => l > 0).some((l) => loadOf(l) > fp.w * fp.h * 0.9)
  const wrap = !!garageRect && frontLine > fp.y + fp.h + 0.8 && (program.sizeClass === 'compact' || strategy === 'room-space' || groundTight || upperTight) && fp.w - garageRect.w >= 3
  let forcedXs: number[] | null = null
  let groundFronts: number[] | undefined
  let upperFronts: number[] | undefined
  if (wrap && garageRect) {
    const inner = garageSide === 'left' ? garageRect.x + garageRect.w : garageRect.x
    const rest = garageSide === 'left' ? fp.x + fp.w - inner : inner - fp.x
    if (garageSide === 'left') forcedXs = rest >= 9 ? [fp.x, inner, inner + rest / 2, fp.x + fp.w] : [fp.x, inner, fp.x + fp.w]
    else forcedXs = rest >= 9 ? [fp.x, fp.x + rest / 2, inner, fp.x + fp.w] : [fp.x, inner, fp.x + fp.w]
    const cols = forcedXs.length - 1
    groundFronts = Array.from({ length: cols }, (_, i) => {
      const x0 = forcedXs![i]
      const x1 = forcedXs![i + 1]
      const underGarage = Math.min(x1, garageRect!.x + garageRect!.w) - Math.max(x0, garageRect!.x) > 0.5
      return underGarage ? fp.y + fp.h : frontLine
    })
    upperFronts = Array.from({ length: cols }, () => (upperTight || program.sizeClass === 'compact' ? frontLine : fp.y + fp.h))
    garageRect = { ...garageRect, h: plotFront - garageRect.y }
    notes.push(upperFronts[0] > fp.y + fp.h ? 'Rooms extend beside the car porch and the upper floor is built over it' : 'Ground floor extends beside the car porch')
  }

  // ── space allocation: whole-house search over column templates ───────────
  stage('Space allocation')
  // Column widths are shared by every floor (walls stack structurally), so each template is laid
  // out on all floors and scored by the total cost; the best template is refined further.
  // authorities that cap the first floor at a share of the ground floor (amendment A4): the first
  // floor steps back from the front and the strip becomes an open terrace over the rooms below
  const firstShare = plot.authority ? bandFor(plot.authority, plot).firstOfGround : undefined
  const firstPull = (xs: number[]) => {
    if (firstShare === undefined || firstShare >= 1 || !levels.includes(1)) return 0
    const cols = xs.length - 1
    const w = (i: number) => xs[i + 1] - xs[i]
    const gF = groundFronts && groundFronts.length === cols ? groundFronts : Array<number>(cols).fill(fp.y + fp.h)
    const uF = upperFronts && upperFronts.length === cols ? upperFronts : Array<number>(cols).fill(fp.y + fp.h)
    let ground = 0
    let upper = 0
    let W = 0
    for (let i = 0; i < cols; i++) {
      ground += w(i) * (gF[i] - fp.y)
      upper += w(i) * (uF[i] - fp.y)
      W += w(i)
    }
    if (garageRect) ground += garageRect.w * garageRect.h
    const target = firstShare * ground * (opts.firstShareScale ?? 0.985)
    return upper > target ? (upper - target) / W : 0
  }
  const frontsFor = (lv: number, xs: number[]) => {
    const base = lv === 0 ? groundFronts : lv > 0 ? upperFronts : undefined
    const d = lv === 1 ? firstPull(xs) : 0
    if (!d) return base
    const cols = xs.length - 1
    const uF = base && base.length === cols ? base : Array<number>(cols).fill(fp.y + fp.h)
    return uF.map((f) => f - d)
  }
  const orderLv = [0, ...levels.filter((l) => l > 0), ...levels.filter((l) => l < 0)]
  const templates: number[][] = []
  if (forcedXs) templates.push(forcedXs)
  else if (fp.w < 11.2) {
    for (const s of [0.42, 0.5, 0.58]) {
      const side = fp.w * s
      templates.push(rnd.chance(0.5) ? [fp.x, fp.x + side, fp.x + fp.w] : [fp.x, fp.x + fp.w - side, fp.x + fp.w])
    }
  } else {
    for (const s of [0.28, 0.34, 0.4]) {
      const spine = Math.min(Math.max(fp.w * s, 3.6), 8.5)
      const side = (fp.w - spine) / 2
      templates.push([fp.x, fp.x + side, fp.x + side + spine, fp.x + fp.w])
    }
    if (fp.w >= 19) templates.push([fp.x, fp.x + fp.w * 0.24, fp.x + fp.w * 0.5, fp.x + fp.w * 0.76, fp.x + fp.w])
  }

  const layoutHouse = (xs: number[], iterScale: number, triesScale: number) => {
    const layouts = new Map<number, FloorLayoutResult>()
    const pinsFor = new Map<number, PinnedSlot[]>()
    const localNotes: string[] = []
    let total = 0
    for (const lv of orderLv) {
      const items = program.items.filter((i) => i.level === lv)
      const pins = pinsFor.get(lv) ?? []
      const pinnedTypes = new Set(pins.map((p) => p.sourceKey))
      const free = items.filter((i) => !pinnedTypes.has(i.key) && !(lv !== 0 && i.pinned))
      const inp: FloorLayoutInput = {
        footprint: fp,
        items: free,
        pins,
        columnXs: xs,
        columnFronts: frontsFor(lv, xs),
        level: lv,
        prefs: req.preferences,
        weights: info.weights,
        garage: lv === 0 ? garageRect : undefined,
        stairType: program.stairType,
        party,
        basement: lv < 0
      }
      let best: FloorLayoutResult | null = null
      const tries = Math.max(1, Math.round((lv === 0 ? 3 : 2) * triesScale))
      for (let t = 0; t < tries; t++) {
        const r = optimizeFloor(inp, rng(seed * 31 + lv * 7 + t * 101 + xs.length * 13), Math.round(iterations * iterScale * (lv === 0 ? 1 : 0.8)))
        if (!best || r.cost < best.cost) best = r
      }
      layouts.set(lv, best!)
      total += best!.cost
      if (lv === 0) {
        for (const s of best!.slots) {
          if (s.type === 'stair' || s.type === 'lift') {
            for (const other of levels.filter((l) => l !== 0)) {
              const arr = pinsFor.get(other) ?? []
              const src = program.items.find((i) => i.level === other && i.type === s.type)
              arr.push({ id: `pin-${s.type}-${other}`, type: s.type, name: spec(s.type).label, col: s.col, y0: s.rect.y, y1: s.rect.y + s.rect.h, hub: s.type === 'stair', walkable: s.type === 'stair', sourceKey: src?.key })
              pinsFor.set(other, arr)
            }
          }
          const colW = best!.columns[s.col].w
          if (s.item?.doubleHeight && levels.includes(1)) {
            const arr = pinsFor.get(1) ?? []
            // cap the void so the floor above keeps a bridge across it
            const maxD = Math.min(6.5, fp.h * 0.55)
            const y1 = s.rect.y + s.rect.h
            const y0 = Math.max(s.rect.y, y1 - maxD)
            arr.push({ id: `pin-void-${s.key}`, type: 'void', name: s.type === 'foyer' ? 'Double-height Entrance' : 'Double-height Lounge', col: s.col, y0, y1, hub: false, walkable: false, galleries: colW >= 5.2 ? 'both' : s.col === 0 ? 'right' : 'left' })
            pinsFor.set(1, arr)
            localNotes.push(`${s.item.name} rises through two floors with a gallery above`)
          }
          if (s.type === 'courtyard') {
            for (const up of levels.filter((l) => l > 0)) {
              const arr = pinsFor.get(up) ?? []
              arr.push({ id: `pin-court-${up}`, type: 'void', name: 'Courtyard (open to sky)', col: s.col, y0: s.rect.y, y1: s.rect.y + s.rect.h, hub: false, walkable: false, openToSky: true, galleries: colW >= 5.2 ? 'both' : s.col === 0 ? 'right' : 'left' })
              pinsFor.set(up, arr)
            }
          }
        }
      }
    }
    return { layouts, total, notes: localNotes }
  }
  let bestXs = templates[0]
  if (templates.length > 1) {
    let bestTotal = Infinity
    for (const xs of templates) {
      const r = layoutHouse(xs, 0.35, 0.5)
      if (r.total < bestTotal) {
        bestTotal = r.total
        bestXs = xs
      }
    }
  }
  stage('Room graph')
  const final = layoutHouse(bestXs, 1, 1)
  stage('Floor plans')
  const layouts = final.layouts
  const columnXs = bestXs
  notes.push(...final.notes)

  // ── materialize floors ───────────────────────────────────────────────────
  const floors: Floor[] = []
  const stairKeep: { side?: ReturnType<typeof sideTouchingHub> } = {}
  for (const lv of [0, ...levels.filter((l) => l !== 0)]) {
    const kind = lv < 0 ? 'basement' : lv === 0 ? 'ground' : 'upper'
    const f = makeFloor(kind, lv, floorHeight, ids)
    const lay = layouts.get(lv)!
    f.rooms = materializeRooms(lay.slots, party, lv === 0 ? garageRect : undefined, lv, ids, program.stairType, stairKeep, warnings)
    floors.push(f)
  }
  floors.sort((a, b) => a.level - b.level)
  const upperCoversPorch = !!upperFronts && !!garageRect && upperFronts.some((fr) => fr > garageRect!.y + 0.5)
  const ground = floors.find((f) => f.level === 0)!
  if (garageRect) {
    const enclosed = ['european', 'colonial', 'farmhouse', 'industrial'].includes(req.style)
    ground.rooms.push({ id: ids('rm'), name: 'Garage', autoName: true, type: 'garage', polygon: rectPoly(garageRect), enclosed, garage: { cars: env.cars, storage: env.cars >= 3, workshop: false, evCharger: lux >= 70 } })
    notes.push(`${env.cars}-car ${enclosed ? 'garage' : 'car porch'} at the front, next to the entrance`)
  }
  const first = floors.find((f) => f.level === 1)
  const pull = firstPull(columnXs)
  if (first && pull > 0.05) {
    const cols = columnXs.length - 1
    const uF = upperFronts && upperFronts.length === cols ? upperFronts : Array<number>(cols).fill(fp.y + fp.h)
    for (let i = 0; i < cols; i++) {
      const rect = { x: columnXs[i], y: uF[i] - pull, w: columnXs[i + 1] - columnXs[i], h: pull }
      if (rect.h < 0.3 || rect.w < 1) continue
      // a stair or void pinned from below keeps its place; the terrace takes the rest of the strip
      const open = differencePolys(rectPoly(rect), ...first.rooms.map((r) => r.polygon))
      for (const o of open) {
        const ob = bbox(o.outer)
        if (o.holes.length || ob.w < 1 || ob.h < 0.3) continue
        first.rooms.push({ id: ids('rm'), name: 'Front Terrace', autoName: true, type: 'terrace', polygon: o.outer })
      }
    }
    notes.push(`The first floor steps back ${(pull / FT).toFixed(1)} ft for a front terrace, keeping it within ${Math.round((firstShare ?? 1) * 100)}% of the ground floor as ${AUTHORITIES[plot.authority!].name} requires`)
  }
  if (first && garageRect && req.outdoor.terrace && !upperCoversPorch) {
    first.rooms.push({ id: ids('rm'), name: 'Terrace', autoName: true, type: 'terrace', polygon: rectPoly(garageRect) })
  }
  if (req.outdoor.balcony) {
    for (const f of floors.filter((x) => x.level > 0)) {
      let made = 0
      const fronts = layouts.get(f.level)!.columns.map((c) => c.front)
      for (const r of [...f.rooms].sort((a, b) => bbox(b.polygon).w - bbox(a.polygon).w)) {
        if (made >= 2) break
        if (!(isBedroomType(r.type) || r.type === 'family')) continue
        const b = bbox(r.polygon)
        const front = b.y + b.h
        if (!fronts.some((fr) => Math.abs(fr - front) < 1e-3) || b.w < 2.6) continue
        if (plotFront - front < 1.3) continue
        const bal = { x: b.x + 0.3, y: front, w: b.w - 0.6, h: Math.min(lux >= 70 ? 1.5 : 1.2, plotFront - front - 0.15) }
        if (f.rooms.some((o) => o.type === 'terrace' && rectsOverlap(bbox(o.polygon), bal, -0.01))) continue
        f.rooms.push({ id: ids('rm'), name: 'Balcony', autoName: true, type: 'balcony', polygon: rectPoly(bal) })
        made++
      }
    }
  }
  // basement light wells behind habitable basement rooms
  const lightWells: Rect[] = []
  const basement = floors.find((f) => f.level < 0)
  if (basement && fp.y - plotR.y >= 1.6) {
    for (const r of basement.rooms) {
      const b = bbox(r.polygon)
      if (!spec(r.type).walkable || r.type === 'stair' || r.type === 'home_theater' || r.type === 'mechanical' || r.type === 'store') continue
      if (Math.abs(b.y - fp.y) > 1e-3 || b.w < 1.8) continue
      lightWells.push({ x: b.x + 0.3, y: fp.y - 1.2, w: b.w - 0.6, h: 1.2 })
    }
    if (lightWells.length) notes.push('Light wells give basement rooms daylight and fresh air')
  }

  // roof level for flat roofs
  const exterior = exteriorForStyle(req.style)
  if (req.special.largeWindows) exterior.windowScale = Math.max(exterior.windowScale, 1.2)
  if (req.special.pillars) exterior.entrancePillars = true
  const top = floors.filter((f) => f.level >= 0).sort((a, b) => b.level - a.level)[0]
  const topCols: Rect[] = layouts.get(top.level)!.columns.map((c) => ({ x: c.x, y: fp.y, w: c.w, h: c.front - fp.y }))
  if (exterior.roofType === 'flat') {
    const roof = makeFloor('roof', top.level + 1, floorHeight, ids)
    roof.height = 3.0
    const holes: Rect[] = []
    const stairRoom = top.rooms.find((r) => r.type === 'stair')
    if (stairRoom && levels.length > 1) {
      const sr = bbox(stairRoom.polygon)
      holes.push(sr)
      roof.rooms.push({ id: ids('rm'), name: 'Stair Cover', autoName: true, type: 'mumty', polygon: rectPoly(sr) })
    }
    for (const r of top.rooms) if (r.type === 'void' && r.openToSky) holes.push(bbox(r.polygon))
    for (const r of top.rooms) if (r.type === 'courtyard') holes.push(bbox(r.polygon))
    // service rooms that did not fit below sit beside the stair cover
    const m = holes[0]
    for (const it of program.items.filter((i) => i.level === ROOF_LEVEL)) {
      if (!m) break
      const w = Math.max(1.6, Math.min(2.6, itemArea(it) / m.h))
      const cands: Rect[] = [
        { x: m.x + m.w, y: m.y, w, h: m.h },
        { x: m.x - w, y: m.y, w, h: m.h },
        { x: m.x, y: m.y + m.h, w: m.w, h: Math.max(1.6, itemArea(it) / m.w) },
        { x: m.x, y: m.y - Math.max(1.6, itemArea(it) / m.w), w: m.w, h: Math.max(1.6, itemArea(it) / m.w) }
      ]
      const inTop = (r: Rect) => topCols.some((tc) => r.x >= tc.x - 1e-3 && r.y >= tc.y - 1e-3 && r.x + r.w <= tc.x + tc.w + 1e-3 && r.y + r.h <= tc.y + tc.h + 1e-3)
      const c = cands.find((r) => inTop(r) && !holes.some((h) => rectsOverlap(h, r, -0.01)))
      if (c) {
        holes.push(c)
        roof.rooms.push({ id: ids('rm'), name: it.name, autoName: true, type: it.type, polygon: rectPoly(c) })
      } else warnings.push(`${it.name} could not be placed — add a floor or reduce the room count`)
    }
    const pieces = topCols.flatMap((tc) => rectMinus(tc, holes, 0.4))
    const big = [...pieces].sort((a, b) => b.w * b.h - a.w * a.h)[0]
    for (const p of pieces) {
      const garden = req.special.rooftopGarden && p === big
      roof.rooms.push({ id: ids('rm'), name: garden ? 'Rooftop Garden' : 'Roof Terrace', autoName: !garden, type: garden ? 'rooftop_garden' : 'terrace', polygon: rectPoly(p) })
    }
    if (req.special.rooftopGarden) notes.push('Rooftop garden on the main roof, reached from the stair cover')
    floors.push(roof)
  }

  // ── walls ────────────────────────────────────────────────────────────────
  stage('Structure')
  const openPlan = strategy === 'luxury-open' || req.preferences.openSpace >= 75
  for (const f of floors) {
    const res = rebuildWalls(f, opts.settings, ids)
    f.walls = res.walls
    // open-plan connections become virtual separators
    if (openPlan || strategy === 'family') {
      for (const [ta, tb] of [
        ['tv_lounge', 'dining'],
        ['foyer', 'tv_lounge'],
        ['family', 'corridor'],
        ['basement_lounge', 'corridor']
      ] as [RoomType, RoomType][]) {
        if (strategy === 'family' && ta === 'foyer') continue
        for (const a of f.rooms.filter((r) => r.type === ta))
          for (const b of f.rooms.filter((r) => r.type === tb)) for (const s of sharedWalls(f, a, b)) if (s.t0 <= 0.01 && s.t1 >= segLen(s.wall) - 0.01) s.wall.kindOverride = 'virtual'
      }
    }
    if (strategy === 'luxury-open' && req.preferences.openSpace >= 50) {
      for (const k of f.rooms.filter((r) => r.type === 'kitchen'))
        for (const d of f.rooms.filter((r) => r.type === 'dining')) for (const s of sharedWalls(f, k, d)) if (s.t0 <= 0.01 && s.t1 >= segLen(s.wall) - 0.01) s.wall.kindOverride = 'virtual'
    }
  }

  // ── doors & windows ──────────────────────────────────────────────────────
  stage('Openings')
  let mainDoorPos: { x: number; y: number } | undefined
  let patioAnchor: { x0: number; x1: number } | undefined
  for (const f of floors) {
    const ops = f.openings
    const hubs = f.rooms.filter((r) => HUB_TYPES.has(r.type) || spec(r.type).circulation)
    const byId = new Map(f.rooms.map((r) => [r.id, r]))
    for (const r of f.rooms) {
      const sp = spec(r.type)
      if (!sp.walkable || HUB_TYPES.has(r.type) || r.type === 'garage' || r.type === 'balcony' || r.type === 'terrace' || r.type === 'rooftop_garden') continue
      if (r.parentId) {
        const p = byId.get(r.parentId)
        if (p) addDoor(f, ops, r, p, r.type === 'bathroom' ? 'single' : 'opening', r.type === 'bathroom' ? DOOR_W.bath : ft(3), ids, { swingInto: r })
        continue
      }
      // best hub neighbour
      const cands = hubs
        .map((h) => ({ h, s: sharedWalls(f, r, h)[0] }))
        .filter((x) => x.s && x.s.t1 - x.s.t0 >= 1.0)
        .sort((a, b) => (a.h.type === 'stair' ? 1 : 0) - (b.h.type === 'stair' ? 1 : 0) || b.s!.t1 - b.s!.t0 - (a.s!.t1 - a.s!.t0))
      const target = cands[0]?.h
      if (r.type === 'kitchen') {
        const dining = f.rooms.find((d) => d.type === 'dining' && sharedWalls(f, r, d).some((s) => s.t1 - s.t0 > 1.2))
        if (dining) {
          const s = sharedWalls(f, r, dining)[0]
          if (effectiveKind(s.wall) !== 'virtual') addDoor(f, ops, r, dining, openPlan || req.preferences.openSpace >= 55 ? 'opening' : 'single', openPlan ? Math.min(2.4, s.t1 - s.t0 - 0.4) : DOOR_W.room, ids, { swingInto: r })
          if (target && target.id !== dining.id && !openPlan) continue
          if (!target || target.id === dining.id) continue
        }
      }
      if (r.type === 'dirty_kitchen' || r.type === 'pantry') {
        const k = f.rooms.find((x) => x.type === 'kitchen' && sharedWalls(f, r, x).length)
        if (k) {
          addDoor(f, ops, r, k, 'single', DOOR_W.room, ids, { swingInto: r })
          continue
        }
      }
      if (target) addDoor(f, ops, r, target, isBathLike(r.type) ? 'single' : r.type === 'courtyard' ? 'sliding' : 'single', isBathLike(r.type) ? DOOR_W.bath : r.type === 'courtyard' ? 1.8 : DOOR_W.room, ids, { swingInto: r, towards: centerOf(target) })
      else {
        // no hub contact: connect to any walkable neighbour (validation will flag it)
        const nb = f.rooms.find((o) => o.id !== r.id && spec(o.type).walkable && sharedWalls(f, r, o).some((s) => s.t1 - s.t0 > 1))
        if (nb) addDoor(f, ops, r, nb, 'single', DOOR_W.room, ids, { swingInto: r })
      }
    }
    // hub ↔ hub connections that still have a wall
    for (let i = 0; i < hubs.length; i++) {
      for (let j = i + 1; j < hubs.length; j++) {
        const a = hubs[i]
        const b = hubs[j]
        const s = sharedWalls(f, a, b)[0]
        if (!s || s.t1 - s.t0 < 1.1) continue
        if (effectiveKind(s.wall) === 'virtual' || effectiveKind(s.wall) === 'railing') continue
        if (a.type === 'stair' || b.type === 'stair') addDoor(f, ops, a, b, 'opening', Math.min(1.2, s.t1 - s.t0 - 0.2), ids)
        else addDoor(f, ops, a, b, 'opening', Math.min(a.type === 'foyer' || b.type === 'foyer' ? 1.5 : 1.8, s.t1 - s.t0 - 0.3), ids)
      }
    }
    // stair halls without any open side get a door to a hub
    for (const st of f.rooms.filter((r) => r.type === 'stair' || r.type === 'mumty')) {
      const ws = wallsOfRoom(f, st)
      if (ws.some((w) => effectiveKind(w.wall) === 'virtual')) continue
      if (ops.some((o) => ws.some((w) => w.wall.id === o.wallId && o.offset >= w.t0 && o.offset <= w.t1))) continue
      const nb = f.rooms.find((o) => o.id !== st.id && (HUB_TYPES.has(o.type) || spec(o.type).outdoor) && sharedWalls(f, st, o).some((s) => s.t1 - s.t0 > 1))
      if (nb) addDoor(f, ops, st, nb, 'single', DOOR_W.room, ids)
    }

    if (f.level === 0) {
      // main entrance: a hub on a column's front edge (foyer first)
      const fronts = layouts.get(0)!.columns.map((c) => c.front)
      const atFront = (r: Room) => fronts.some((fr) => Math.abs(bbox(r.polygon).y + bbox(r.polygon).h - fr) < 1e-3)
      const entry = f.rooms.find((r) => r.type === 'foyer' && atFront(r)) ?? f.rooms.find((r) => HUB_TYPES.has(r.type) && r.type !== 'stair' && atFront(r))
      const garage = f.rooms.find((r) => r.type === 'garage')
      if (entry) {
        let d = addDoor(f, ops, entry, null, 'main', DOOR_W.main, ids, { prefer: 'center' })
        if (!d && garage) d = addDoor(f, ops, entry, garage, 'main', DOOR_W.main, ids, { prefer: 'center' })
        if (d) mainDoorPos = openingPoint(f, d)
      }
      if (garage) {
        const inner = f.rooms.find((r) => r.id !== entry?.id && ['kitchen', 'store', 'corridor', 'dining', 'tv_lounge', 'foyer'].includes(r.type) && sharedWalls(f, garage, r).some((s) => s.t1 - s.t0 > 1.2))
        if (inner && !(entry && sharedWalls(f, garage, entry).length && ops.some((o) => o.style === 'main' && sharedWalls(f, garage, entry).some((s) => s.wall.id === o.wallId)))) addDoor(f, ops, inner, garage, 'single', DOOR_W.room, ids, { swingInto: inner })
        if (garage.enclosed) addDoor(f, ops, garage, null, 'garage', Math.min(env.cars * 2.6, bbox(garage.polygon).w - 0.6), ids, { prefer: 'center' })
      }
      // guest drawing room door straight from outside
      const drawing = f.rooms.find((r) => r.type === 'drawing')
      if (drawing && req.preferences.privacy >= 55 && strategy !== 'luxury-open' && atFront(drawing)) {
        const dy = bbox(drawing.polygon).y + bbox(drawing.polygon).h
        const w = wallsOfRoom(f, drawing).find((x) => effectiveKind(x.wall) === 'exterior' && Math.abs(x.wall.a.y - dy) < 1e-3 && Math.abs(x.wall.b.y - dy) < 1e-3 && !garage?.polygon.some((p) => Math.abs(p.y - dy) < 1e-3 && p.x > Math.min(x.wall.a.x, x.wall.b.x) + 0.1 && p.x < Math.max(x.wall.a.x, x.wall.b.x) - 0.1))
        if (w) {
          addDoor(f, ops, drawing, null, 'double', 1.2, ids, { prefer: 'center' })
          notes.push('Drawing room has its own guest entrance so visitors stay out of family areas')
        }
      }
      // service door from the kitchen side to the back yard
      for (const k of f.rooms.filter((r) => r.type === 'dirty_kitchen' || r.type === 'kitchen' || r.type === 'servant')) {
        const onBack = wallsOfRoom(f, k).some((x) => effectiveKind(x.wall) === 'exterior' && Math.abs(x.wall.a.y - fp.y) < 1e-3 && Math.abs(x.wall.b.y - fp.y) < 1e-3)
        if (onBack && party.back === undefined) {
          addDoor(f, ops, k, null, 'single', DOOR_W.room, ids, { prefer: 'end' })
          break
        }
      }
      // patio door from the lounge / dining
      if (req.outdoor.patio) {
        const cand = f.rooms.find((r) => ['tv_lounge', 'dining', 'living', 'family'].includes(r.type) && Math.abs(bbox(r.polygon).y - fp.y) < 1e-3)
        if (cand && party.back === undefined) {
          const d = addDoor(f, ops, cand, null, 'sliding', Math.min(2.4, bbox(cand.polygon).w - 0.8), ids, { prefer: 'center' })
          if (d) {
            const b = bbox(cand.polygon)
            patioAnchor = { x0: b.x, x1: b.x + b.w }
            notes.push(`Patio opens from the ${cand.name.toLowerCase()} through sliding doors`)
          }
        }
      }
    }
    // outdoor rooms (terrace, balcony, rooftop) get doors from the room behind them
    for (const o of f.rooms.filter((r) => r.type === 'terrace' || r.type === 'balcony' || r.type === 'rooftop_garden')) {
      const nbs = f.rooms.filter((x) => x.id !== o.id && spec(x.type).walkable && !spec(x.type).outdoor && sharedWalls(f, o, x).some((s) => s.t1 - s.t0 > 1.0))
      nbs.sort((a, b) => (HUB_TYPES.has(b.type) ? 1 : 0) - (HUB_TYPES.has(a.type) ? 1 : 0))
      const nb = nbs.find((x) => x.type === 'mumty') ?? nbs[0]
      if (nb) addDoor(f, ops, nb, o, nb.type === 'mumty' ? 'single' : 'sliding', nb.type === 'mumty' ? DOOR_W.room : Math.min(1.8, sharedWalls(f, o, nb)[0].t1 - sharedWalls(f, o, nb)[0].t0 - 0.4), ids, { swingInto: nb })
    }
  }

  // ── stairs ───────────────────────────────────────────────────────────────
  const sorted = [...floors].sort((a, b) => a.level - b.level)
  for (let i = 0; i < sorted.length - 1; i++) {
    const f = sorted[i]
    const up = sorted[i + 1]
    const hall = f.rooms.find((r) => r.type === 'stair')
    if (!hall) continue
    const r = roomRect(hall)
    const inner: Rect = { x: r.x + 0.08, y: r.y + 0.08, w: r.w - 0.16, h: r.h - 0.16 }
    const entry = stairEntrySide(f, hall, up)
    const risers = risersFor(f.height)
    let type: StairType = program.stairType
    let fit = fitStair(type, inner, entry, risers)
    for (const alt of ['U', 'L', 'straight', 'spiral'] as StairType[]) {
      if (fit) break
      fit = fitStair(alt, inner, entry, risers)
      if (fit) {
        warnings.push(`A ${program.stairType} stair does not fit the ${levelName(f.level)} stair hall; using ${alt}`)
        type = alt
      }
    }
    if (!fit) {
      warnings.push(`The stair hall on the ${levelName(f.level)} floor is too small for a stair — enlarge it in the plan`)
      continue
    }
    const st: Stair = { id: ids('str'), type, position: fit.position, rotation: fit.rotation, width: fit.width, risers, tread: 0.27, turn: rnd.chance(0.5) ? 'left' : 'right', railing: lux >= 60 ? 'glass' : 'metal', material: lux >= 60 ? 'lib:marble-botticino' : 'lib:marble-sunny-grey' }
    f.stairs.push(st)
    void stairShape
  }

  // ── validation-driven repair: every room reachable, then daylight ────────
  const repaired = repairAccess({ floors }, ids)
  if (repaired.length) notes.push('Circulation checked: every room is reachable from the entrance')
  for (const f of floors) {
    placeWindows(f, f.openings, {
      party,
      largeWindows: req.special.largeWindows,
      lightPref: req.preferences.naturalLight,
      privacyPref: req.preferences.privacy * (strategy === 'privacy' ? 1.3 : 1),
      openPlan,
      windowScale: exterior.windowScale,
      modern: ['modern', 'contemporary', 'minimalist', 'luxury', 'pakistani_modern'].includes(req.style),
      isGround: f.level === 0,
      isBasement: f.level < 0,
      lightWells,
      ids
    })
  }

  // ── structure: columns & beams on a regular grid ────────────────────────
  const colXs = columnXs ?? [fp.x, fp.x + fp.w]
  const colPts = structuralGrid(ground, fp, colXs)
  for (const f of floors) {
    if (f.kind === 'roof') {
      const m = f.rooms.find((r) => r.type === 'mumty')
      if (m) {
        const b = bbox(m.polygon)
        f.columns = [
          [b.x, b.y],
          [b.x + b.w, b.y],
          [b.x, b.y + b.h],
          [b.x + b.w, b.y + b.h]
        ].map(([x, y]) => ({ id: ids('col'), position: { x, y }, width: 0.23, depth: 0.23, rotation: 0, shape: 'rect' as const }))
      }
      continue
    }
    const size = program.sizeClass === 'estate' ? [0.3, 0.45] : [0.23, 0.3]
    f.columns = colPts.map((p) => ({ id: ids('col'), position: { ...p.p }, width: p.vertical ? size[0] : size[1], depth: p.vertical ? size[1] : size[0], rotation: 0, shape: 'rect' as const }))
    f.beams = gridBeams(colPts, ids)
  }
  if (garageRect && !ground.rooms.find((r) => r.type === 'garage')?.enclosed) {
    const round = exterior.columnStyle !== 'square'
    for (const x of [garageRect.x + 0.15, garageRect.x + garageRect.w - 0.15]) ground.columns.push({ id: ids('col'), position: { x, y: garageRect.y + garageRect.h - 0.15 }, width: 0.3, depth: 0.3, rotation: 0, shape: round ? 'round' : 'rect', exposed: true })
  }

  // ── furniture ────────────────────────────────────────────────────────────
  for (const f of floors) {
    f.furniture = furnishFloor(f, ids, { luxury: lux, qibla: qiblaVector(plot) })
    if (f.kind === 'roof') {
      const terr = f.rooms.filter((r) => r.type === 'terrace').sort((a, b) => bbox(b.polygon).w * bbox(b.polygon).h - bbox(a.polygon).w * bbox(a.polygon).h)[0]
      if (terr) {
        const b = bbox(terr.polygon)
        f.furniture.push({ id: ids('fur'), type: 'water-tank', position: { x: b.x + 1.0, y: b.y + 1.0 }, rotation: 0, width: 1.3, depth: 1.3, height: 1.4 })
      }
    }
  }

  // ── site ─────────────────────────────────────────────────────────────────
  const land = designLandscape({ plot, plotRect: plotR, footprint: fp, garage: garageRect, mainDoor: mainDoorPos, patioAnchor, lightWells, req, luxury: lux, ids, rnd })
  warnings.push(...land.warnings)
  notes.push(...land.notes)
  for (const lw of lightWells) land.site.areas.push({ id: ids('sit'), kind: 'light_well', name: 'Light well', polygon: rectPoly(lw), depth: floorHeight + 0.4, material: 'lib:stone-slate' })
  const newPlot: Plot = { ...plot, gates: land.gates }

  const house: HouseState = { plot: newPlot, floors, site: land.site, exterior }
  applySmartLabels(house)
  // a typical home system (12 panels, about 7 kWp), facing the equator; the Cost tab resizes it
  placeSolarPanels(house, ids, 12)

  // ── validation, scores, explanation ─────────────────────────────────────
  stage('Validation')
  const issues = validateHouse(house)
  for (const i of issues.filter((x) => x.severity === 'error')) warnings.push(i.message)
  const stats = designStats(house)
  const scores = scoreDesign(house, req, layouts, fp, env.plotRect)
  stage('Explanation')
  const explanation = explain(house, req, strategy, fp, notes, { back: party.back === undefined, left: party.left === undefined, right: party.right === undefined })
  return {
    id: ids('dsn'),
    label: info.label,
    name: info.name,
    strategy,
    seed,
    house,
    explanation,
    stats,
    scores,
    warnings: [...new Set(warnings)],
    createdAt: Date.now()
  }
}

export function generateDesigns(req: Requirements, plot: Plot, opts: GenerateOptions & { strategies?: DesignStrategy[]; baseSeed?: number }): { designs: DesignOption[]; errors: GenerationError[] } {
  const designs: DesignOption[] = []
  const errors: GenerationError[] = []
  const base = opts.baseSeed ?? Math.floor(Math.random() * 1e6)
  const list = opts.strategies ?? STRATEGIES.map((s) => s.key)
  list.forEach((s, i) => {
    try {
      designs.push(generateDesign(req, plot, s, { ...opts, seed: base + i * 977 }))
    } catch (e) {
      if (e instanceof DesignGenerationError) errors.push(e.info)
      else errors.push({ what: `Design ${s} failed`, why: String((e as Error)?.message ?? e), fix: 'Try again, or relax one requirement (fewer rooms, more floors).' })
    }
  })
  return { designs, errors }
}

// ── helpers ─────────────────────────────────────────────────────────────────

const segLen = (w: { a: { x: number; y: number }; b: { x: number; y: number } }) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
const isBathLike = (t: RoomType) => t === 'bathroom' || t === 'powder' || t === 'servant_bath'
const centerOf = (r: Room) => {
  const b = bbox(r.polygon)
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

function openingPoint(f: Floor, o: { wallId: string; offset: number }) {
  const w = f.walls.find((x) => x.id === o.wallId)!
  const L = segLen(w)
  return { x: w.a.x + ((w.b.x - w.a.x) * o.offset) / L, y: w.a.y + ((w.b.y - w.a.y) * o.offset) / L }
}

function materializeRooms(
  slots: PlacedSlot[],
  party: PartyLines,
  garage: Rect | undefined,
  level: number,
  ids: IdFactory,
  stairType: StairType,
  stairKeep: { side?: ReturnType<typeof sideTouchingHub> },
  warnings: string[]
): Room[] {
  const rooms: Room[] = []
  const hubRects = slots.flatMap((s) => (s.parts ? s.parts.filter((p) => p.hub).map((p) => p.rect) : s.hub ? [s.rect] : []))
  const all = slots.flatMap((s) => (s.parts ? s.parts.map((p) => ({ rect: p.rect, open: !!p.openToSky })) : [{ rect: s.rect, open: s.type === 'courtyard' || !!s.pin?.openToSky }]))
  for (const s of slots) {
    if (s.rect.w < 0.3 || s.rect.h < 0.3) continue
    if (s.parts) {
      for (const p of s.parts) rooms.push({ id: ids('rm'), name: p.name, autoName: p.type !== 'void', type: p.type, polygon: rectPoly(p.rect), openToSky: p.openToSky })
      continue
    }
    if (!s.item && !s.pin) {
      rooms.push({ id: ids('rm'), name: s.type === 'store' ? 'Store' : 'Flex Room', autoName: s.type === 'store', type: s.type, polygon: rectPoly(s.rect) })
      continue
    }
    if (s.type === 'stair') {
      // a stair hall much wider than the stair gives its spare strip to a store / bath
      const need = stairDims(stairType)
      const r = s.rect
      const across = Math.min(r.w, r.h)
      const alongX = r.w >= r.h
      const spare = alongX ? r.h - Math.min(need.w, need.d) - 0.15 : r.w - Math.min(need.w, need.d) - 0.15
      const longOk = (alongX ? r.w : r.h) >= Math.max(need.w, need.d) - 0.05
      if (spare >= 1.3 && longOk && across > 0) {
        const hubSide = stairKeep.side ?? (stairKeep.side = sideTouchingHub(r, hubRects))
        let stairR: Rect
        let extra: Rect
        if (!alongX) {
          // split along x; keep the stair part next to a hub side
          const keepLeft = hubSide === 'left' || (hubSide !== 'right' && true)
          stairR = keepLeft ? { x: r.x, y: r.y, w: r.w - spare, h: r.h } : { x: r.x + spare, y: r.y, w: r.w - spare, h: r.h }
          extra = keepLeft ? { x: r.x + r.w - spare, y: r.y, w: spare, h: r.h } : { x: r.x, y: r.y, w: spare, h: r.h }
        } else {
          const keepBack = hubSide === 'back' || hubSide !== 'front'
          stairR = keepBack ? { x: r.x, y: r.y, w: r.w, h: r.h - spare } : { x: r.x, y: r.y + spare, w: r.w, h: r.h - spare }
          extra = keepBack ? { x: r.x, y: r.y + r.h - spare, w: r.w, h: spare } : { x: r.x, y: r.y, w: r.w, h: spare }
        }
        const hall: Room = { id: ids('rm'), name: 'Stairs', autoName: true, type: 'stair', polygon: rectPoly(stairR), programKey: s.item?.key }
        rooms.push(hall)
        const t: RoomType = level > 0 && extra.w * extra.h >= 3.2 ? 'bathroom' : 'store'
        rooms.push({ id: ids('rm'), name: t === 'bathroom' ? 'Common Bath' : 'Store', autoName: true, type: t, polygon: rectPoly(extra), parentId: hall.id })
        continue
      }
    }
    if (s.pin) {
      rooms.push({ id: ids('rm'), name: s.pin.name, autoName: true, type: s.pin.type, polygon: rectPoly(s.rect), openToSky: s.pin.openToSky })
      continue
    }
    const it = s.item as ProgramItem
    if (!it.children.length) {
      rooms.push({ id: ids('rm'), name: it.name, autoName: true, type: it.type, polygon: rectPoly(s.rect), programKey: it.key, doubleHeight: it.doubleHeight })
      continue
    }
    const r = s.rect
    const edgeAccess = (e: Edge) => {
      const probe: Rect = e === 'left' ? { x: r.x, y: r.y, w: 0, h: r.h } : e === 'right' ? { x: r.x + r.w, y: r.y, w: 0, h: r.h } : e === 'back' ? { x: r.x, y: r.y, w: r.w, h: 0 } : { x: r.x, y: r.y + r.h, w: r.w, h: 0 }
      return hubRects.reduce((sum, h) => sum + contactEdge(probe, h), 0)
    }
    const ex = edgeExposure(r, all, party, garage, level < 0)
    const ctx = {
      access: { left: edgeAccess('left'), right: edgeAccess('right'), front: edgeAccess('front'), back: edgeAccess('back') },
      exterior: { left: ex.left > 1, right: ex.right > 1, back: ex.back > 1, front: ex.front > 1 }
    }
    const parts = splitSuite(r, it.type, it.children, ctx)
    if (parts.length === 1) warnings.push(`${it.name} is too small for its attached ${it.children.map((c) => spec(c.type).label.toLowerCase()).join(' and ')} — enlarge it or add a floor`)
    const parent ={ id: ids('rm'), name: it.name, autoName: true, type: it.type, polygon: parts[0].poly ?? rectPoly(parts[0].rect), programKey: it.key, doubleHeight: it.doubleHeight } as Room
    rooms.push(parent)
    for (const p of parts.slice(1)) rooms.push({ id: ids('rm'), name: spec(p.type).label, autoName: true, type: p.type, polygon: rectPoly(p.rect), parentId: parent.id, programKey: it.key })
  }
  // fill uncovered gaps (empty column segments) with flex space
  return rooms
}

function sideTouchingHub(r: Rect, hubs: Rect[]): 'left' | 'right' | 'front' | 'back' | null {
  const probes: [ReturnType<typeof sideTouchingHub>, Rect][] = [
    ['left', { x: r.x, y: r.y, w: 0, h: r.h }],
    ['right', { x: r.x + r.w, y: r.y, w: 0, h: r.h }],
    ['back', { x: r.x, y: r.y, w: r.w, h: 0 }],
    ['front', { x: r.x, y: r.y + r.h, w: r.w, h: 0 }]
  ]
  let best: ReturnType<typeof sideTouchingHub> = null
  let bl = 0.5
  for (const [side, p] of probes) {
    const L = hubs.filter((h) => h !== r).reduce((s, h) => s + contactEdge(p, h), 0)
    if (L > bl) {
      bl = L
      best = side
    }
  }
  return best
}

function contactEdge(probe: Rect, h: Rect) {
  if (probe.w === 0) {
    if (Math.abs(h.x - probe.x) > 1e-3 && Math.abs(h.x + h.w - probe.x) > 1e-3) return 0
    return Math.max(0, Math.min(probe.y + probe.h, h.y + h.h) - Math.max(probe.y, h.y))
  }
  if (Math.abs(h.y - probe.y) > 1e-3 && Math.abs(h.y + h.h - probe.y) > 1e-3) return 0
  return Math.max(0, Math.min(probe.x + probe.w, h.x + h.w) - Math.max(probe.x, h.x))
}

/** Which side of the stair hall people arrive from (the side open to circulation). */
function stairEntrySide(f: Floor, hall: Room, up: Floor): 'front' | 'back' | 'left' | 'right' {
  const r = bbox(hall.polygon)
  const score = { front: 0, back: 0, left: 0, right: 0 }
  for (const fl of [f, up]) {
    const hallHere = fl.rooms.find((x) => (x.type === 'stair' || x.type === 'mumty') && rectsOverlap(bbox(x.polygon), r, -0.1)) ?? hall
    for (const x of wallsOfRoom(fl, hallHere)) {
      const k = effectiveKind(x.wall)
      const w = k === 'virtual' ? 3 : fl.openings.some((o) => o.wallId === x.wall.id && o.kind === 'door' && o.offset >= x.t0 && o.offset <= x.t1) ? 2 : 0
      if (!w) continue
      const horiz = Math.abs(x.wall.a.y - x.wall.b.y) < 1e-3
      if (horiz) {
        if (Math.abs(x.wall.a.y - r.y) < 0.05) score.back += w * (x.t1 - x.t0)
        else score.front += w * (x.t1 - x.t0)
      } else if (Math.abs(x.wall.a.x - r.x) < 0.05) score.left += w * (x.t1 - x.t0)
      else score.right += w * (x.t1 - x.t0)
    }
  }
  const best = (Object.keys(score) as (keyof typeof score)[]).sort((a, b) => score[b] - score[a])[0]
  if (score[best] === 0) return r.w > r.h ? 'left' : 'front'
  return best
}

function structuralGrid(ground: Floor, fp: Rect, xs: number[]): { p: { x: number; y: number }; vertical: boolean }[] {
  const pts: { p: { x: number; y: number }; vertical: boolean }[] = []
  const lines = [...new Set(xs.map((x) => Math.round(x * 1000) / 1000))]
  for (const x of lines) {
    // y positions where walls meet this line
    const ys = new Set<number>([fp.y, fp.y + fp.h])
    for (const w of ground.walls) {
      if (effectiveKind(w) === 'virtual') continue
      for (const e of [w.a, w.b]) if (Math.abs(e.x - x) < 0.02 && e.y >= fp.y - 0.01 && e.y <= fp.y + fp.h + 0.01) ys.add(Math.round(e.y * 1000) / 1000)
    }
    const sortedY = [...ys].sort((a, b) => a - b)
    const kept: number[] = []
    for (const y of sortedY) if (!kept.length || y - kept[kept.length - 1] >= 2.4 || y === fp.y + fp.h) kept.push(y)
    if (kept.length >= 2 && kept[kept.length - 1] - kept[kept.length - 2] < 1.5) kept.splice(kept.length - 2, 1)
    // fill spans longer than 5 m
    const filled: number[] = []
    for (let i = 0; i < kept.length; i++) {
      filled.push(kept[i])
      if (i < kept.length - 1) {
        const gap = kept[i + 1] - kept[i]
        const n = Math.floor(gap / 4.8)
        for (let k = 1; k <= n; k++) filled.push(kept[i] + (gap * k) / (n + 1))
      }
    }
    for (const y of filled) pts.push({ p: { x, y }, vertical: true })
  }
  return pts
}

function gridBeams(cols: { p: { x: number; y: number } }[], ids: IdFactory): Beam[] {
  const beams: Beam[] = []
  const byX = new Map<number, { x: number; y: number }[]>()
  for (const c of cols) {
    const k = Math.round(c.p.x * 100)
    if (!byX.has(k)) byX.set(k, [])
    byX.get(k)!.push(c.p)
  }
  for (const list of byX.values()) {
    list.sort((a, b) => a.y - b.y)
    for (let i = 0; i < list.length - 1; i++) beams.push({ id: ids('bm'), a: list[i], b: list[i + 1], width: 0.23, depth: 0.45 })
  }
  // cross beams along front and back
  const xs = [...byX.keys()].sort((a, b) => a - b).map((k) => byX.get(k)!)
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i]
    const b = xs[i + 1]
    for (const y of [Math.min(...a.map((p) => p.y)), Math.max(...a.map((p) => p.y))]) {
      const pa = a.find((p) => Math.abs(p.y - y) < 0.01)
      const pb = b.find((p) => Math.abs(p.y - y) < 0.01)
      if (pa && pb) beams.push({ id: ids('bm'), a: pa, b: pb, width: 0.23, depth: 0.45 })
    }
  }
  return beams
}

function scoreDesign(h: HouseState, req: Requirements, layouts: Map<number, FloorLayoutResult>, fp: Rect, plotR: Rect): DesignScores {
  const stats = designStats(h)
  const rooms = h.floors.flatMap((f) => f.rooms.map((r) => ({ f, r })))
  const hab = rooms.filter(({ r }) => spec(r.type).habitable && spec(r.type).walkable && !spec(r.type).outdoor)
  const lit = hab.filter(({ f, r }) => wallsOfRoom(f, r).some((x) => f.openings.some((o) => o.kind === 'window' && o.wallId === x.wall.id && o.offset >= x.t0 && o.offset <= x.t1)))
  const light = hab.length ? (lit.length / hab.length) * 100 : 50
  // privacy: bedrooms away from the street and off the ground floor
  const beds = rooms.filter(({ r }) => isBedroomType(r.type) && r.type !== 'guest_bedroom' && r.type !== 'servant')
  const privacy = beds.length
    ? (beds.reduce((s, { f, r }) => {
        const b = bbox(r.polygon)
        const depthFrac = 1 - (b.y + b.h / 2 - fp.y) / fp.h
        return s + (f.level > 0 ? 1 : 0.35 + 0.65 * depthFrac)
      }, 0) /
        beds.length) *
      100
    : 70
  const garden = Math.min(100, (stats.gardenArea / Math.max(1, plotR.w * plotR.h)) * 250)
  const avgCost = [...layouts.values()].reduce((s, l) => s + l.breakdown.size + l.breakdown.dims, 0) / Math.max(1, layouts.size)
  const space = Math.max(0, Math.min(100, 100 - avgCost * 4 + (stats.totalFloorArea / Math.max(1, stats.floors) / (fp.w * fp.h)) * 5))
  const circ = h.floors.flatMap((f) => f.rooms).filter((r) => r.type === 'corridor' || r.type === 'stair').reduce((s, r) => s + bbox(r.polygon).w * bbox(r.polygon).h, 0)
  const efficiency = Math.max(0, Math.min(100, 100 - (circ / Math.max(1, stats.totalFloorArea)) * 250))
  const p = req.preferences
  const wsum = p.privacy + p.naturalLight + p.greenSpace + p.luxury + 50
  const overall = (privacy * p.privacy + light * p.naturalLight + garden * p.greenSpace + space * p.luxury + efficiency * 50) / wsum
  const r = (n: number) => Math.round(Math.max(0, Math.min(100, n)))
  return { privacy: r(privacy), light: r(light), garden: r(garden), space: r(space), efficiency: r(efficiency), overall: r(overall) }
}

function explain(h: HouseState, req: Requirements, strategy: DesignStrategy, fp: Rect, notes: string[], open: { back: boolean; left: boolean; right: boolean }): string[] {
  const out: string[] = []
  const floors = h.floors
  const all = floors.flatMap((f) => f.rooms.map((r) => ({ f, r })))
  const beds = all.filter(({ r }) => ['master_bedroom', 'bedroom', 'kids_room'].includes(r.type))
  if (beds.length) {
    const upper = beds.filter(({ f }) => f.level > 0).length
    out.push(upper === beds.length ? 'Bedrooms placed in the private zone on the upper floor' : upper > 0 ? `${upper} of ${beds.length} bedrooms upstairs; the rest at the back of the ground floor, away from the street` : 'Bedrooms grouped at the back of the house, away from the street')
  }
  for (const f of floors) {
    const k = f.rooms.find((r) => r.type === 'kitchen')
    const d = f.rooms.find((r) => r.type === 'dining')
    if (k && d && sharedWalls(f, k, d).length) {
      out.push(effectiveKind(sharedWalls(f, k, d)[0].wall) === 'virtual' ? 'Kitchen opens straight into the dining area' : 'Kitchen connected to dining')
      break
    }
  }
  if (all.some(({ r }) => r.type === 'garage')) out.push('Garage near the entrance, with a direct driveway from the gate')
  const guest = all.find(({ r }) => r.type === 'guest_bedroom')
  if (guest) out.push('Guest bedroom kept near the entrance, separate from family bedrooms')
  const drawing = all.find(({ r }) => r.type === 'drawing')
  if (drawing) out.push('Drawing room at the front (public zone) so guests do not pass family spaces')
  if (req.outdoor.patio) out.push('Patio connected to the lounge for indoor–outdoor living')
  const sides = ['front', open.back ? 'back' : '', open.left ? 'left side' : '', open.right ? 'right side' : ''].filter(Boolean)
  out.push(`${req.special.largeWindows ? 'Large windows' : 'Windows'} on the ${sides.join(', ')} for natural light; side walls on shared boundaries stay solid`)
  if (floors.some((f) => f.level < 0)) out.push('Basement access located at the main staircase')
  if (floors.length > 1) out.push('Staircase sits on the circulation spine at the same position on every floor')
  if (all.some(({ r }) => r.type === 'dirty_kitchen' || r.type === 'servant' || r.type === 'laundry')) out.push('Service spaces (dirty kitchen, laundry, staff) grouped towards the back')
  if (strategy === 'garden') out.push(`Compact ${Math.round(fp.w * fp.h * 10.764)} ft² footprint leaves more garden`)
  if (strategy === 'room-space') out.push('Footprint expanded to the full buildable area for larger rooms')
  if (strategy === 'privacy') out.push('Public and private zones are separated; street-facing ground floor windows are raised')
  if (strategy === 'luxury-open') out.push('Open-plan lounge and dining with generous room sizes')
  out.push(...notes)
  return [...new Set(out)]
}
