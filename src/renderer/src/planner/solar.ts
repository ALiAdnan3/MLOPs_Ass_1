import type { CostRates, Floor, FurnitureItem, HouseState, Vec2 } from '../core/model/types'
import { bbox, pointInPolygon, rectsOverlap, unionPolys, type Rect } from '../core/geometry/polygon'
import { planBearing } from '../engine/lighting/sun'
import { plotLocation } from '../core/location'
import type { IdFactory } from '../core/model/ids'

/**
 * ROOFTOP SOLAR (amendment A2). Lays real-size panels on the open roof, facing the equator, with
 * rows spaced so they do not shade each other at winter-solstice noon, and estimates system size,
 * yearly units, saving and payback from editable rates. An estimate for planning, not a design
 * by a solar installer.
 */

export const PANEL = { watt: 580, long: 2.28, short: 1.13 }

/** Region defaults: installed cost per kWp and what one grid unit (kWh) costs. */
export const SOLAR_RATES: Record<CostRates['region'], { perKw: number; tariff: number }> = {
  pakistan: { perKw: 130000, tariff: 60 },
  uae: { perKw: 3200, tariff: 0.38 },
  uk: { perKw: 1500, tariff: 0.25 },
  usa: { perKw: 2800, tariff: 0.17 },
  custom: { perKw: 1000, tariff: 0.2 }
}

export function solarRates(r: CostRates) {
  const d = SOLAR_RATES[r.region] ?? SOLAR_RATES.custom
  return { perKw: r.solarPerKw ?? d.perKw, tariff: r.tariffPerKwh ?? d.tariff }
}

/** Yearly kWh per installed kWp, by latitude (sunny subtropics yield more than high latitudes). */
export function specificYield(lat: number) {
  const a = Math.abs(lat)
  return a < 28 ? 1600 : a < 36 ? 1450 : a < 45 ? 1300 : 1000
}

export function tiltFor(lat: number) {
  return Math.max(10, Math.min(35, Math.abs(lat) - 10))
}

export interface SolarLayout {
  floorId: string | null
  panels: { position: Vec2; rotation: number }[]
  kwp: number
  yearlyKwh: number
  tilt: number
  rowPitch: number
}

const roofFloor = (h: HouseState) => h.floors.find((f) => f.kind === 'roof') ?? null

/** Roof items that can make way for panels (planters, outdoor seating); tanks and the stair cover cannot. */
const SOFT = new Set(['planter', 'outdoor-set', 'plant'])

const footprint = (x: FurnitureItem, pad: number): Rect => {
  const swap = Math.abs(Math.sin(x.rotation)) > 0.5
  const w = swap ? x.depth : x.width
  const d = swap ? x.width : x.depth
  return { x: x.position.x - w / 2 - pad, y: x.position.y - d / 2 - pad, w: w + 2 * pad, h: d + 2 * pad }
}

/**
 * Where panels can go: the open roof (adjoining terraces merged into one area), kept 0.45 m off
 * its outer edge and clear of everything fixed on the roof. With `moveSoft`, planters and outdoor
 * seating do not block panels (the caller removes the ones that end up underneath).
 */
export function layoutSolar(h: HouseState, opts: { moveSoft?: boolean } = {}): SolarLayout {
  const loc = plotLocation(h.plot)
  const tilt = tiltFor(loc.lat)
  const f = roofFloor(h)
  const empty: SolarLayout = { floorId: f?.id ?? null, panels: [], kwp: 0, yearlyKwh: 0, tilt, rowPitch: 0 }
  if (!f) return empty
  // face the equator; rows run along whichever plan axis is closest to east-west
  const toEquator = planBearing(h.plot, loc.lat >= 0 ? 180 : 0)
  const rowsAlongX = Math.abs(toEquator.y) >= Math.abs(toEquator.x)
  const face: Vec2 = rowsAlongX ? { x: 0, y: Math.sign(toEquator.y) || 1 } : { x: Math.sign(toEquator.x) || 1, y: 0 }
  const rotation = Math.atan2(-face.x, face.y)
  const t = (tilt * Math.PI) / 180
  // winter-solstice noon sun; never plan for a sun lower than 18°
  const alt = Math.max(18, 90 - Math.abs(loc.lat) - 23.44) * (Math.PI / 180)
  const depth = PANEL.long * Math.cos(t)
  const rowPitch = depth + (PANEL.long * Math.sin(t)) / Math.tan(alt)
  const obstacles: Rect[] = [
    ...f.rooms.filter((r) => r.type !== 'terrace').map((r) => bbox(r.polygon)),
    ...f.furniture.filter((x) => x.type !== 'solar-panel' && !(opts.moveSoft && SOFT.has(x.type))).map((x) => footprint(x, 0.3))
  ]
  const pw = rowsAlongX ? PANEL.short : depth
  const ph = rowsAlongX ? depth : PANEL.short
  const stepA = PANEL.short + 0.02
  const edge = 0.45
  const panels: SolarLayout['panels'] = []
  for (const region of unionPolys(f.rooms.filter((r) => r.type === 'terrace').map((r) => r.polygon))) {
    const b = bbox(region.outer)
    const inside = (p: Vec2) => pointInPolygon(p, region.outer) && !region.holes.some((hl) => pointInPolygon(p, hl))
    const along0 = rowsAlongX ? b.x : b.y
    const across0 = rowsAlongX ? b.y : b.x
    const along = rowsAlongX ? b.w : b.h
    const across = rowsAlongX ? b.h : b.w
    // rows start from the edge facing the equator so the first row is never shaded
    const fromHigh = rowsAlongX ? face.y > 0 : face.x > 0
    for (let c = edge; c + depth + edge <= across + 1e-6; c += rowPitch)
      for (let a = edge; a + PANEL.short + edge <= along + 1e-6; a += stepA) {
        const cc = fromHigh ? across - c - depth : c
        const rect: Rect = rowsAlongX ? { x: along0 + a, y: across0 + cc, w: pw, h: ph } : { x: across0 + cc, y: along0 + a, w: pw, h: ph }
        const e = { x: rect.x - edge, y: rect.y - edge, w: rect.w + 2 * edge, h: rect.h + 2 * edge }
        const probes = [0, 0.5, 1].flatMap((u) => [0, 0.5, 1].map((v) => ({ x: e.x + e.w * u, y: e.y + e.h * v })))
        if (!probes.every(inside)) continue
        if (obstacles.some((o) => rectsOverlap(o, rect, -0.01))) continue
        panels.push({ position: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, rotation })
      }
  }
  const kwp = (panels.length * PANEL.watt) / 1000
  return { floorId: f.id, panels, kwp, yearlyKwh: kwp * specificYield(loc.lat), tilt, rowPitch }
}

export function solarEconomics(l: SolarLayout, r: CostRates) {
  const { perKw, tariff } = solarRates(r)
  const cost = l.kwp * perKw
  const saving = l.yearlyKwh * tariff
  return { cost, saving, payback: saving > 0 ? cost / saving : Infinity, monthlyKwh: l.yearlyKwh / 12, perKw, tariff }
}

/** Replace the roof's panels with a fresh layout (inside a commit). */
export function placeSolarPanels(h: HouseState, ids: IdFactory, maxPanels = Infinity): number {
  const want = Math.max(0, Math.floor(maxPanels))
  let l = layoutSolar(h)
  // not enough room around the planters and seating: let them make way
  if (l.panels.length < want) {
    const roomier = layoutSolar(h, { moveSoft: true })
    if (roomier.panels.length > l.panels.length) l = roomier
  }
  l.panels = l.panels.slice(0, want)
  const f = h.floors.find((x) => x.id === l.floorId) as Floor | undefined
  if (!f) return 0
  const placed = l.panels.map((p) => {
    const swap = Math.abs(Math.sin(p.rotation)) > 0.5
    const d = PANEL.long * Math.cos((l.tilt * Math.PI) / 180)
    return { x: p.position.x - (swap ? d : PANEL.short) / 2, y: p.position.y - (swap ? PANEL.short : d) / 2, w: swap ? d : PANEL.short, h: swap ? PANEL.short : d }
  })
  f.furniture = f.furniture.filter((x) => x.type !== 'solar-panel' && !(SOFT.has(x.type) && placed.some((r) => rectsOverlap(footprint(x, 0.15), r, -0.01))))
  const rise = PANEL.long * Math.sin((l.tilt * Math.PI) / 180)
  for (const p of l.panels)
    f.furniture.push({ id: ids('fur'), type: 'solar-panel', position: p.position, rotation: p.rotation, width: PANEL.short, depth: PANEL.long * Math.cos((l.tilt * Math.PI) / 180), height: 0.3 + rise } as FurnitureItem)
  return l.panels.length
}

export function removeSolarPanels(h: HouseState) {
  for (const f of h.floors) f.furniture = f.furniture.filter((x) => x.type !== 'solar-panel')
}

export function countSolarPanels(h: HouseState) {
  return h.floors.reduce((s, f) => s + f.furniture.filter((x) => x.type === 'solar-panel').length, 0)
}
