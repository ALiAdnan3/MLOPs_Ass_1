import type { Gate, Plot, Requirements, Site, SiteArea, SiteObject, Vec2 } from '../../core/model/types'
import type { IdFactory } from '../../core/model/ids'
import { rectPoly, rectsOverlap, type Rect } from '../../core/geometry/polygon'
import type { Rng } from './random'

/** Outdoor design (§29): driveway, walkway, gates, lawns, patio, pool, trees, lights … */

export interface LandscapeInput {
  plot: Plot
  plotRect: Rect
  footprint: Rect
  garage?: Rect
  mainDoor?: Vec2
  patioAnchor?: { x0: number; x1: number }
  lightWells: Rect[]
  req: Requirements
  luxury: number
  ids: IdFactory
  rnd: Rng
}

export interface LandscapeResult {
  site: Site
  gates: Gate[]
  patio?: Rect
  pool?: Rect
  warnings: string[]
  notes: string[]
}

/** Split `area` minus `holes` into a few rectangles (grid decomposition + greedy merge). */
export function rectMinus(area: Rect, holes: Rect[], minSide = 0.6): Rect[] {
  const hs = holes.filter((h) => rectsOverlap(h, area))
  const xs = [...new Set([area.x, area.x + area.w, ...hs.flatMap((h) => [h.x, h.x + h.w])].map((v) => Math.round(Math.min(area.x + area.w, Math.max(area.x, v)) * 1000) / 1000))].sort((a, b) => a - b)
  const ys = [...new Set([area.y, area.y + area.h, ...hs.flatMap((h) => [h.y, h.y + h.h])].map((v) => Math.round(Math.min(area.y + area.h, Math.max(area.y, v)) * 1000) / 1000))].sort((a, b) => a - b)
  const nx = xs.length - 1
  const ny = ys.length - 1
  const freeCell: boolean[][] = []
  for (let j = 0; j < ny; j++) {
    freeCell.push([])
    for (let i = 0; i < nx; i++) {
      const c = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 }
      freeCell[j].push(!hs.some((h) => c.x > h.x && c.x < h.x + h.w && c.y > h.y && c.y < h.y + h.h))
    }
  }
  const used = freeCell.map((r) => r.map(() => false))
  const out: Rect[] = []
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!freeCell[j][i] || used[j][i]) continue
      let i2 = i
      while (i2 + 1 < nx && freeCell[j][i2 + 1] && !used[j][i2 + 1]) i2++
      let j2 = j
      outer: while (j2 + 1 < ny) {
        for (let k = i; k <= i2; k++) if (!freeCell[j2 + 1][k] || used[j2 + 1][k]) break outer
        j2++
      }
      for (let jj = j; jj <= j2; jj++) for (let ii = i; ii <= i2; ii++) used[jj][ii] = true
      const r = { x: xs[i], y: ys[j], w: xs[i2 + 1] - xs[i], h: ys[j2 + 1] - ys[j] }
      if (r.w >= minSide && r.h >= minSide) out.push(r)
    }
  }
  return out
}

export function designLandscape(inp: LandscapeInput): LandscapeResult {
  const { plotRect: P, footprint: F, req, ids, rnd } = inp
  const areas: SiteArea[] = []
  const objects: SiteObject[] = []
  const warnings: string[] = []
  const notes: string[] = []
  const gates: Gate[] = []
  const area = (kind: SiteArea['kind'], r: Rect, material?: string, extra: Partial<SiteArea> = {}) => {
    const a: SiteArea = { id: ids('sit'), kind, polygon: rectPoly(r), material, ...extra }
    areas.push(a)
    return a
  }
  const obj = (kind: SiteObject['kind'], p: Vec2, scale = 1, rotation = 0, extra: Partial<SiteObject> = {}) => objects.push({ id: ids('obj'), kind, position: p, rotation, scale, ...extra })

  const frontY0 = F.y + F.h
  const front: Rect = { x: P.x, y: frontY0, w: P.w, h: P.y + P.h - frontY0 }
  const back: Rect = { x: P.x, y: P.y, w: P.w, h: F.y - P.y }
  const holesFront: Rect[] = []
  const holesBack: Rect[] = [...inp.lightWells]

  // ── driveway + gates ──
  if (inp.garage) {
    const g = inp.garage
    const drive = { x: g.x, y: g.y + g.h, w: g.w, h: P.y + P.h - (g.y + g.h) }
    if (drive.h > 0.05) area('driveway', drive, 'lib:pavers-grey')
    holesFront.push(g, drive)
    gates.push({ id: ids('gat'), offset: g.x + g.w / 2 - P.x, width: Math.min(g.w, 5.4), type: 'sliding', side: 'front' })
  }
  // walkway to the main door
  if (inp.mainDoor) {
    const md = inp.mainDoor
    const inPorch = inp.garage && md.x > inp.garage.x - 0.1 && md.x < inp.garage.x + inp.garage.w + 0.1 && md.y >= inp.garage.y - 0.3
    if (!inPorch) {
      const ww = 1.4
      const x = Math.min(P.x + P.w - ww - 0.2, Math.max(P.x + 0.2, md.x - ww / 2))
      const walk = { x, y: frontY0, w: ww, h: P.y + P.h - frontY0 }
      area('walkway', walk, 'lib:stone-travertine')
      holesFront.push(walk)
      gates.push({ id: ids('gat'), offset: x + ww / 2 - P.x, width: 1.1, type: 'pedestrian', side: 'front' })
      for (let y = frontY0 + 1.5; y < P.y + P.h - 0.8; y += 3) {
        obj('garden_light', { x: x - 0.35, y })
        obj('garden_light', { x: x + ww + 0.35, y })
      }
    } else if (!gates.some((g) => g.type === 'pedestrian')) {
      // a pedestrian gate beside the main gate
      const g = inp.garage!
      const off = g.x + g.w + 0.9 < P.x + P.w ? g.x + g.w + 0.7 : g.x - 0.7
      gates.push({ id: ids('gat'), offset: off - P.x, width: 1.0, type: 'pedestrian', side: 'front' })
    }
  }
  if (!gates.length) gates.push({ id: ids('gat'), offset: P.w / 2, width: 1.2, type: 'swing', side: 'front' })
  if (inp.plot.corner) {
    const side = inp.plot.cornerSide
    gates.push({ id: ids('gat'), offset: (P.h * 2) / 3, width: 1.0, type: 'pedestrian', side })
  }

  // ── front lawn / hardscape ──
  const frontFree = rectMinus(front, holesFront, 0.5)
  for (const r of frontFree) {
    if (req.outdoor.frontLawn && r.w >= 1.0 && r.h >= 1.0) {
      area('lawn', r, 'lib:grass-lawn', { name: 'Front lawn' })
      // trees along the boundary
      if (r.w > 3 && r.h > 3) {
        const n = Math.max(1, Math.floor(r.w / 4.5))
        for (let i = 0; i < n; i++) obj(rnd.chance(inp.luxury > 60 ? 0.5 : 0.2) ? 'palm' : 'tree', { x: r.x + ((i + 0.5) * r.w) / n, y: r.y + r.h - 1.0 }, rnd.range(0.85, 1.15), rnd.range(0, 6.28))
      }
      if (r.w > 1.6) obj('hedge', { x: r.x + r.w / 2, y: r.y + 0.45 }, 1, 0, { width: r.w - 0.4, depth: 0.5 })
      if (req.outdoor.garden && r.w > 2.5 && r.h > 2.5) obj('flowers', { x: r.x + 0.9, y: r.y + r.h / 2 }, 1)
      if ((req.style === 'islamic' || inp.luxury >= 75) && r.w > 5 && r.h > 4) {
        obj('fountain', { x: r.x + r.w / 2, y: r.y + r.h / 2 })
        notes.push('A fountain anchors the front lawn')
      }
    } else if (r.w >= 0.5 && r.h >= 0.5) area('garden_bed', r, 'lib:gravel', { name: 'Planter' })
  }

  // ── back yard ──
  let patio: Rect | undefined
  let pool: Rect | undefined
  if (back.h >= 1.0) {
    if (req.outdoor.patio && back.h >= 2.2) {
      const anchor = inp.patioAnchor ?? { x0: F.x + F.w * 0.3, x1: F.x + F.w * 0.7 }
      const w = Math.min(Math.max(anchor.x1 - anchor.x0 + 1.0, 3.5), F.w)
      const x = Math.min(F.x + F.w - w, Math.max(F.x, (anchor.x0 + anchor.x1) / 2 - w / 2))
      const d = Math.min(3.2, back.h - 0.4)
      patio = { x, y: F.y - d, w, h: d }
      if (!holesBack.some((h) => rectsOverlap(h, patio!))) {
        area('patio', patio, 'lib:porcelain-outdoor', { name: 'Patio' })
        holesBack.push(patio)
        if (inp.luxury >= 60 || req.style === 'mediterranean') obj('pergola', { x: x + w / 2, y: F.y - d / 2 }, 1, 0, { width: w - 0.2, depth: d - 0.2 })
        obj('outdoor_table', { x: x + w * 0.35, y: F.y - d / 2 })
        if (req.outdoor.outdoorSitting) obj('bench', { x: x + w * 0.75, y: F.y - d / 2 }, 1, Math.PI / 2)
      } else patio = undefined
    }
    if (req.outdoor.pool) {
      const L = Math.min(9, Math.max(6, P.w * 0.45))
      const W = 3.8
      const y = P.y + 1.2
      const room = (patio ? patio.y : F.y) - y - 0.8
      if (room >= W) {
        const x = P.x + (P.w - L) / 2
        pool = { x, y: y + (room - W) / 2, w: L, h: W }
        const deck = { x: pool.x - 1.0, y: pool.y - 1.0, w: pool.w + 2, h: pool.h + 2 }
        area('deck', deck, 'lib:wood-deck', { name: 'Pool deck' })
        area('pool', pool, 'lib:water-pool', { name: 'Swimming pool', depth: 1.5 })
        holesBack.push(deck)
        obj('lounger', { x: deck.x + 0.6, y: deck.y + deck.h / 2 }, 1, Math.PI / 2)
        obj('lounger', { x: deck.x + deck.w - 0.6, y: deck.y + deck.h / 2 }, 1, -Math.PI / 2)
        obj('umbrella', { x: deck.x + 0.6, y: deck.y + 0.6 })
        notes.push('Pool placed in the back garden, away from the street')
      } else warnings.push(`A pool needs about 5 m of clear back yard; this layout leaves ${Math.max(0, room).toFixed(1)} m. Choose "Maximum garden" or a larger plot.`)
    }
    if (req.outdoor.bbq || req.outdoor.outdoorKitchen) {
      const r = { x: P.x + 0.3, y: P.y + 0.3, w: 2.4, h: 1.2 }
      if (back.h > 2 && !holesBack.some((h) => rectsOverlap(h, r))) {
        area(req.outdoor.outdoorKitchen ? 'outdoor_kitchen' : 'bbq_area', r, 'lib:pavers-red', { name: req.outdoor.outdoorKitchen ? 'Outdoor kitchen' : 'BBQ' })
        obj('bbq_grill', { x: r.x + 0.8, y: r.y + 0.6 })
        holesBack.push(r)
      }
    }
    if (req.outdoor.playArea) {
      const r = { x: P.x + P.w - 3.3, y: P.y + 0.3, w: 3.0, h: 3.0 }
      if (back.h > 3.6 && !holesBack.some((h) => rectsOverlap(h, r))) {
        area('play_area', r, 'lib:rubber-black', { name: 'Play area' })
        obj('swing', { x: r.x + 1.0, y: r.y + 1.5 })
        obj('slide', { x: r.x + 2.3, y: r.y + 1.5 })
        holesBack.push(r)
      }
    }
    const backFree = rectMinus(back, holesBack, 0.6)
    for (const r of backFree) {
      if ((req.outdoor.backLawn || req.outdoor.garden || req.preferences.greenSpace > 55) && r.w >= 1.2 && r.h >= 1.2) {
        area('lawn', r, 'lib:grass-lawn', { name: 'Back lawn' })
        if (r.h > 2.4 && r.w > 3) {
          const n = Math.max(1, Math.floor(r.w / 5))
          for (let i = 0; i < n; i++) obj('tree', { x: r.x + ((i + 0.5) * r.w) / n, y: r.y + 0.9 }, rnd.range(0.8, 1.2), rnd.range(0, 6.28))
        }
        if (req.outdoor.garden) obj('shrub', { x: r.x + 0.6, y: r.y + r.h - 0.6 })
      } else if (r.w >= 0.6 && r.h >= 0.6) area('walkway', r, 'lib:concrete-smooth', { name: 'Service yard' })
    }
  }

  // side yards
  const left: Rect = { x: P.x, y: F.y, w: F.x - P.x, h: F.h }
  const right: Rect = { x: F.x + F.w, y: F.y, w: P.x + P.w - (F.x + F.w), h: F.h }
  for (const s of [left, right]) {
    if (s.w < 0.6) continue
    if (s.w >= 1.5) {
      area('lawn', s, 'lib:grass-lawn', { name: 'Side garden' })
      const n = Math.floor(s.h / 5)
      for (let i = 0; i < n; i++) obj(i % 2 ? 'shrub' : 'tree', { x: s.x + s.w / 2, y: s.y + 2.5 + i * 5 }, rnd.range(0.8, 1.1))
    } else area('walkway', s, 'lib:gravel', { name: 'Side passage' })
  }

  // street lights / boundary lights by the gate
  for (const g of gates.filter((g) => g.side === 'front')) {
    obj('lamp_post', { x: P.x + g.offset - g.width / 2 - 0.4, y: P.y + P.h - 0.35 }, 0.7)
  }
  return { site: { areas, objects }, gates, patio, pool, warnings, notes }
}
