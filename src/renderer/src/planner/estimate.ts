import type { CostRates, HouseState, MaterialDef } from '../core/model/types'
import { area, bbox } from '../core/geometry/polygon'
import { spec, isBathType } from '../core/constraints/rooms'
import { resolveMaterial } from '../core/materials/library'
import { effectiveKind, wallsOfRoom } from './walls'
import { segLength } from '../core/geometry/segment'
import { floorBuiltArea } from './metrics'
import { wallHeight } from './wallGeometry'

/**
 * Material quantities (§47) measured from the model, and an approximate cost estimate (§46)
 * from editable unit rates. Everything here is an estimate for budgeting, not a BOQ.
 */

export interface Quantities {
  builtArea: number
  flooring: { marble: number; tile: number; wood: number; other: number }
  wallArea: number
  paintArea: number
  wallTileArea: number
  claddingArea: number
  facadeArea: number
  roofArea: number
  doors: number
  windows: number
  windowArea: number
  kitchens: number
  bathrooms: number
  landscapeArea: number
  brickwork: number
}

export function measure(h: HouseState, custom: MaterialDef[]): Quantities {
  const q: Quantities = { builtArea: 0, flooring: { marble: 0, tile: 0, wood: 0, other: 0 }, wallArea: 0, paintArea: 0, wallTileArea: 0, claddingArea: 0, facadeArea: 0, roofArea: 0, doors: 0, windows: 0, windowArea: 0, kitchens: 0, bathrooms: 0, landscapeArea: 0, brickwork: 0 }
  const top = [...h.floors].filter((f) => f.kind !== 'roof').sort((a, b) => b.level - a.level)[0]
  for (const f of h.floors) {
    if (f.kind !== 'roof') q.builtArea += floorBuiltArea(f)
    for (const r of f.rooms) {
      const sp = spec(r.type)
      if (r.type === 'void') continue
      const a = area(r.polygon)
      const fm = resolveMaterial(r.floorMaterial ?? sp.floorFinish, custom)
      const cat = fm?.category
      if (cat === 'marble' || cat === 'granite') q.flooring.marble += a
      else if (cat === 'ceramic' || cat === 'porcelain' || cat === 'stone') q.flooring.tile += a
      else if (cat === 'wood') q.flooring.wood += a
      else q.flooring.other += a
      if (r.type === 'kitchen' || r.type === 'dirty_kitchen') q.kitchens++
      if (isBathType(r.type)) q.bathrooms++
      if (sp.outdoor) continue
      // wall faces inside this room
      const H = r.ceilingHeight ?? f.height - f.slabThickness
      let faces = 0
      for (const x of wallsOfRoom(f, r)) {
        const k = effectiveKind(x.wall)
        if (k === 'virtual' || k === 'railing') continue
        const L = x.t1 - x.t0
        const holes = f.openings.filter((o) => o.wallId === x.wall.id && o.offset >= x.t0 && o.offset <= x.t1).reduce((s, o) => s + (o.width * o.height) / 2, 0)
        faces += Math.max(0, L * H - holes)
      }
      q.wallArea += faces
      const wm = resolveMaterial(r.wallMaterial ?? sp.wallFinish, custom)
      if (wm?.category === 'ceramic' || wm?.category === 'porcelain') {
        q.wallTileArea += faces
      } else if (wm?.category === 'stone' || wm?.category === 'brick' || wm?.category === 'marble') q.claddingArea += faces
      else q.paintArea += faces
      // ceiling paint
      q.paintArea += a
    }
    for (const w of f.walls) {
      const k = effectiveKind(w)
      if (k === 'virtual' || k === 'railing') continue
      const L = segLength(w.a, w.b)
      const H = wallHeight(w, f.height, k)
      if (k === 'exterior' || k === 'parapet') q.facadeArea += L * H
      q.brickwork += L * H * w.thickness
    }
    for (const o of f.openings) {
      if (o.kind === 'door' && o.style !== 'opening') q.doors++
      if (o.kind === 'window') {
        q.windows++
        q.windowArea += o.width * o.height
      }
    }
  }
  if (top) {
    const b = bbox(top.rooms.flatMap((r) => r.polygon))
    q.roofArea = h.exterior.roofType === 'flat' ? floorBuiltArea(top) : b.w * b.h * 1.25
  }
  q.landscapeArea = h.site.areas.filter((a) => a.kind !== 'light_well').reduce((s, a) => s + area(a.polygon), 0)
  return q
}

export interface CostLine {
  key: string
  label: string
  qty: string
  amount: number
}

export function estimate(q: Quantities, r: CostRates): { lines: CostLine[]; total: number } {
  const m2 = (v: number) => `${Math.round(v * 10.764).toLocaleString('en-US')} ft²`
  const lines: CostLine[] = [
    { key: 'structure', label: 'Grey structure', qty: m2(q.builtArea), amount: q.builtArea * r.structure },
    { key: 'flooring', label: 'Flooring (tiles, wood)', qty: m2(q.flooring.tile + q.flooring.wood + q.flooring.other), amount: (q.flooring.tile + q.flooring.wood + q.flooring.other) * r.flooring },
    { key: 'marble', label: 'Marble & granite', qty: m2(q.flooring.marble), amount: q.flooring.marble * r.marble },
    { key: 'doors', label: 'Doors', qty: `${q.doors}`, amount: q.doors * r.door },
    { key: 'windows', label: 'Windows', qty: `${q.windows}`, amount: q.windows * r.window },
    { key: 'kitchen', label: 'Kitchens', qty: `${q.kitchens}`, amount: q.kitchens * r.kitchen },
    { key: 'bathrooms', label: 'Bathrooms', qty: `${q.bathrooms}`, amount: q.bathrooms * r.bathroom },
    { key: 'electrical', label: 'Electrical', qty: m2(q.builtArea), amount: q.builtArea * r.electrical },
    { key: 'plumbing', label: 'Plumbing', qty: m2(q.builtArea), amount: q.builtArea * r.plumbing },
    { key: 'paint', label: 'Paint & wall finish', qty: m2(q.paintArea + q.wallTileArea + q.claddingArea), amount: q.paintArea * r.paint + (q.wallTileArea + q.claddingArea) * r.wallFinish },
    { key: 'exterior', label: 'Exterior finish', qty: m2(q.facadeArea), amount: q.facadeArea * r.exterior },
    { key: 'roofing', label: 'Roofing', qty: m2(q.roofArea), amount: q.roofArea * r.roofing },
    { key: 'landscaping', label: 'Landscaping', qty: m2(q.landscapeArea), amount: q.landscapeArea * r.landscaping }
  ]
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) }
}

/** Purchase quantities with typical wastage. */
export function materialQuantities(q: Quantities) {
  const ft2 = (v: number) => v * 10.764
  return [
    { item: 'Floor tiles (60×60 cm)', amount: Math.ceil((q.flooring.tile * 1.1) / 0.36), unit: 'tiles' },
    { item: 'Marble / granite', amount: Math.ceil(ft2(q.flooring.marble) * 1.1), unit: 'ft² incl. 10% wastage' },
    { item: 'Wood flooring', amount: Math.ceil(ft2(q.flooring.wood) * 1.08), unit: 'ft² incl. 8% wastage' },
    { item: 'Wall tiles', amount: Math.ceil(ft2(q.wallTileArea) * 1.1), unit: 'ft² incl. 10% wastage' },
    { item: 'Paint (2 coats + primer)', amount: Math.ceil((q.paintArea * 2) / 10 + q.paintArea / 12), unit: 'litres' },
    { item: 'Exterior paint / render', amount: Math.ceil((q.facadeArea * 2) / 8), unit: 'litres' },
    { item: 'Bricks', amount: Math.round(q.brickwork * 500), unit: 'bricks (≈500 per m³)' },
    { item: 'Roof waterproofing', amount: Math.ceil(ft2(q.roofArea) * 1.05), unit: 'ft²' },
    { item: 'Glass (windows)', amount: Math.ceil(ft2(q.windowArea)), unit: 'ft²' }
  ]
}

export function formatMoney(v: number, currency: string) {
  if (currency === 'PKR') {
    if (v >= 1e7) return `PKR ${(v / 1e7).toFixed(2)} crore`
    if (v >= 1e5) return `PKR ${(v / 1e5).toFixed(1)} lakh`
  }
  if (v >= 1e6) return `${currency} ${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${currency} ${(v / 1e3).toFixed(0)}K`
  return `${currency} ${Math.round(v)}`
}
