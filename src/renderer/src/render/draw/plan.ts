import type { Floor, FurnitureItem, HouseState, LayerKey, MaterialDef, Opening, Room, UnitSystem, Vec2 } from '../../core/model/types'
import type { DrawContext, Stroke } from './types'
import { hatch } from './types'
import type { PlanTheme } from './theme'
import { bbox, centroid, largestInscribedRect, isAxisRect, unionPolys, area } from '../../core/geometry/polygon'
import { add, norm, perp, rotate, scale, sub } from '../../core/geometry/vec'
import { spec } from '../../core/constraints/rooms'
import { catalogItem } from '../../core/furniture/catalog'
import { effectiveKind } from '../../planner/walls'
import { planWallPieces, wallFrames, wallRect } from '../../planner/wallGeometry'
import { stairGeometry } from '../../planner/stairs'
import { formatLength, formatAreaFor } from '../../core/units/units'
import { resolveMaterial, materialSwatch } from '../../core/materials/library'
import { deriveServices } from '../../planner/services'
import { segLength } from '../../core/geometry/segment'

export type PlanMode = 'plan' | 'dimension' | 'furniture' | 'electrical' | 'lighting' | 'site' | 'roof'

export interface PlanOptions {
  theme: PlanTheme
  layers: Record<LayerKey, boolean>
  units: UnitSystem
  mode?: PlanMode
  showSite?: boolean
  showLabels?: boolean
  showRoomDims?: boolean
  ghost?: Floor
  materials?: MaterialDef[]
  /** Hide things during interactive drags. */
  lite?: boolean
}

const S = (color: string, width: number, extra: Partial<Stroke> = {}): Stroke => ({ color, width, ...extra })

/** Draw one floor (plus site on the ground floor) into any DrawContext. */
export function drawPlan(dc: DrawContext, house: HouseState, floor: Floor, o: PlanOptions) {
  const t = o.theme
  const L = o.layers
  const mode = o.mode ?? 'plan'
  const showSite = (o.showSite ?? true) && (floor.level === 0 || mode === 'site')

  if (showSite) drawSite(dc, house, o)

  if (o.ghost) {
    dc.layer('ghost')
    for (const r of o.ghost.rooms) dc.polygon(r.polygon, null, S(t.virtual, 0.6, { dash: [4, 3], opacity: 0.6 }))
  }

  // rooms
  dc.layer('rooms')
  for (const r of floor.rooms) {
    const sp = spec(r.type)
    let fill = t.room[sp.zone] ?? t.room.semi
    if (L.materials && r.floorMaterial !== undefined) fill = materialSwatch(resolveMaterial(r.floorMaterial ?? sp.floorFinish, o.materials ?? []))
    else if (L.materials) fill = materialSwatch(resolveMaterial(sp.floorFinish, o.materials ?? []))
    if (r.type === 'void') {
      dc.polygon(r.polygon, { color: t.paper }, null)
      const b = bbox(r.polygon)
      dc.line({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, S(t.virtual, 0.6, { dash: [6, 4] }))
      dc.line({ x: b.x + b.w, y: b.y }, { x: b.x, y: b.y + b.h }, S(t.virtual, 0.6, { dash: [6, 4] }))
      continue
    }
    dc.polygon(r.polygon, { color: fill, opacity: L.materials ? 0.85 : 1 }, null)
    if (sp.outdoor && !L.materials && t.name !== 'dark') hatch(dc, r.polygon, 0.6, Math.PI / 4, S(t.roomStroke, 0.4))
    if (r.type === 'garage' && !L.materials) hatch(dc, r.polygon, 0.35, -Math.PI / 4, S(t.roomStroke, 0.35, { opacity: 0.6 }))
  }

  // furniture
  if (L.furniture && mode !== 'electrical' && mode !== 'lighting') {
    dc.layer('furniture')
    for (const f of floor.furniture) drawFurniture(dc, f, t)
  }

  // stairs
  if (L.architecture) {
    dc.layer('stairs')
    for (const s of floor.stairs) {
      const g = stairGeometry(s, floor.height)
      for (const tr of g.treads) dc.polygon(tr.poly, { color: t.paper, opacity: t.name === 'dark' ? 0.5 : 0.9 }, S(t.stair, 0.5))
      // cut line at mid-flight and arrow
      if (g.arrow.length >= 2) {
        dc.polyline(g.arrow, S(t.stair, 0.8))
        const a = g.arrow[g.arrow.length - 2]
        const b = g.arrow[g.arrow.length - 1]
        const d = norm(sub(b, a))
        const n = perp(d)
        const head = [add(b, add(scale(d, -0.22), scale(n, 0.1))), b, add(b, add(scale(d, -0.22), scale(n, -0.1)))]
        dc.polyline(head, S(t.stair, 0.8))
        dc.text(add(g.arrow[0], scale(d, -0.001)), 'UP', { size: 0.16, color: t.textMuted, align: 'center', baseline: 'middle', condensed: true, minPx: 8 })
      }
    }
    // stair arriving from below: draw as dashed outline
    const below = house.floors.find((f) => f.level === floor.level - 1)
    if (below) for (const s of below.stairs) dc.polyline(stairGeometry(s, below.height).outline, S(t.stair, 0.5, { dash: [5, 4] }), true)
  }

  // walls
  if (L.architecture) {
    dc.layer('walls')
    const frames = wallFrames(floor)
    const solid: Vec2[][] = []
    const partitions: Vec2[][] = []
    for (const f of frames) {
      if (f.kind === 'railing') continue
      for (const p of planWallPieces(f, floor.openings)) {
        const rect = wallRect(f, p.t0, p.t1)
        if (f.kind === 'parapet') partitions.push(rect)
        else solid.push(rect)
      }
    }
    const merged = o.lite ? solid.map((outer) => ({ outer, holes: [] as Vec2[][] })) : unionPolys(solid)
    for (const m of merged) dc.polygon(m.outer, { color: t.wallFill }, S(t.wallStroke, 0.6), m.holes)
    for (const p of partitions) {
      dc.polygon(p, { color: t.paper }, S(t.wallFill, 0.8))
      hatch(dc, p, 0.12, Math.PI / 4, S(t.partitionFill, 0.4))
    }
    for (const f of frames) {
      if (f.kind !== 'railing') continue
      const h = Math.max(0.03, f.wall.thickness / 2)
      const a = add(f.wall.a, scale(f.n, h))
      const b = add(f.wall.b, scale(f.n, h))
      const c = add(f.wall.a, scale(f.n, -h))
      const d = add(f.wall.b, scale(f.n, -h))
      dc.line(a, b, S(t.railing, 0.8))
      dc.line(c, d, S(t.railing, 0.8))
    }
    for (const w of floor.walls) if (effectiveKind(w) === 'virtual') dc.line(w.a, w.b, S(t.virtual, 0.6, { dash: [6, 4] }))

    // openings
    dc.layer('openings')
    for (const op of floor.openings) drawOpening(dc, floor, op, t)
  }

  // structure
  if (L.structure) {
    dc.layer('structure')
    for (const b of floor.beams) dc.line(b.a, b.b, S(t.beam, 0.5, { dash: [8, 3, 2, 3] }))
    for (const c of floor.columns) {
      if (c.shape === 'round') dc.circle(c.position, c.width / 2, { color: t.column }, S(t.wallStroke, 0.5))
      else {
        const hw = c.width / 2
        const hd = c.depth / 2
        const pts = [
          { x: -hw, y: -hd },
          { x: hw, y: -hd },
          { x: hw, y: hd },
          { x: -hw, y: hd }
        ].map((p) => add(rotate(p, c.rotation), c.position))
        dc.polygon(pts, { color: t.column }, S(t.wallStroke, 0.5))
      }
    }
  }

  // services
  if (L.electrical || L.lighting || L.plumbing || mode === 'electrical' || mode === 'lighting') {
    const sv = deriveServices(floor)
    if (L.plumbing) {
      dc.layer('plumbing')
      for (const l of sv.lines) dc.polyline(l.pts, S(l.kind === 'supply' ? t.plumbing : t.plumbingDrain, 0.6, { dash: l.kind === 'drain' ? [4, 3] : undefined }))
      for (const p of sv.plumbing) if (p.kind === 'shaft') dc.polygon(sq(p.p, 0.14), { color: t.plumbing, opacity: 0.25 }, S(t.plumbing, 0.8))
    }
    if (L.electrical || mode === 'electrical') {
      dc.layer('electrical')
      for (const p of sv.electrical) drawElectrical(dc, p, t)
    }
    if (L.lighting || mode === 'lighting') {
      dc.layer('lighting')
      for (const p of sv.lighting) drawLight(dc, p, t, mode === 'lighting')
    }
  }

  // labels
  if (o.showLabels !== false && L.annotations) {
    dc.layer('labels')
    for (const r of floor.rooms) drawRoomLabel(dc, r, t, o)
  }
  if (L.annotations) {
    dc.layer('annotations')
    for (const a of floor.annotations) {
      if (a.kind === 'text') dc.text(a.position, a.text, { size: a.size, color: t.text, align: 'left', baseline: 'middle', minPx: 9 })
      else drawDimension(dc, a.a, a.b, a.offset, t, o.units)
    }
  }
  if (mode === 'dimension') drawDimensionChains(dc, floor, t, o.units)
}

export function sq(c: Vec2, s: number): Vec2[] {
  return [
    { x: c.x - s, y: c.y - s },
    { x: c.x + s, y: c.y - s },
    { x: c.x + s, y: c.y + s },
    { x: c.x - s, y: c.y + s }
  ]
}

function drawSite(dc: DrawContext, house: HouseState, o: PlanOptions) {
  const t = o.theme
  const plot = house.plot
  dc.layer('site')
  const pb = bbox(plot.polygon)
  // road
  const road = { x: pb.x - 3, y: pb.y + pb.h, w: pb.w + 6, h: plot.roadWidth }
  dc.polygon([{ x: road.x, y: road.y }, { x: road.x + road.w, y: road.y }, { x: road.x + road.w, y: road.y + road.h }, { x: road.x, y: road.y + road.h }], { color: t.road }, null)
  dc.line({ x: road.x, y: road.y + road.h / 2 }, { x: road.x + road.w, y: road.y + road.h / 2 }, S(t.textMuted, 0.5, { dash: [10, 8] }))
  dc.text({ x: pb.x + pb.w / 2, y: road.y + road.h * 0.75 }, `ROAD ${formatLength(plot.roadWidth, o.units, { compact: true })} WIDE`, { size: 0.35, color: t.textMuted, align: 'center', baseline: 'middle', condensed: true, minPx: 9 })
  if (o.layers.landscape) {
    for (const a of house.site.areas) {
      const col = a.kind === 'lawn' ? t.lawn : a.kind === 'pool' ? t.water : a.kind === 'garden_bed' || a.kind === 'play_area' ? t.lawn : t.paving
      const fill = o.layers.materials && a.material ? materialSwatch(resolveMaterial(a.material, o.materials ?? [])) : col
      dc.polygon(a.polygon, { color: fill }, S(a.kind === 'pool' ? t.glass : t.roomStroke, a.kind === 'pool' ? 1 : 0.4))
      if (a.kind === 'lawn' && dc.pxPerMeter > 6 && !o.lite) lawnMarks(dc, a.polygon, t)
      if (a.kind === 'pool') {
        const b = bbox(a.polygon)
        dc.polygon([{ x: b.x + 0.25, y: b.y + 0.25 }, { x: b.x + b.w - 0.25, y: b.y + 0.25 }, { x: b.x + b.w - 0.25, y: b.y + b.h - 0.25 }, { x: b.x + 0.25, y: b.y + b.h - 0.25 }], null, S(t.glass, 0.5))
        dc.text({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, 'POOL', { size: 0.3, color: t.glass, align: 'center', baseline: 'middle', condensed: true, minPx: 8 })
      }
      if (a.kind === 'driveway' || a.kind === 'patio' || a.kind === 'deck' || a.kind === 'walkway') hatch(dc, a.polygon, a.kind === 'deck' ? 0.14 : 0.45, a.kind === 'deck' ? 0 : Math.PI / 2, S(t.roomStroke, 0.3, { opacity: 0.8 }))
      if (a.kind === 'light_well') hatch(dc, a.polygon, 0.15, Math.PI / 4, S(t.textMuted, 0.4))
    }
    for (const ob of house.site.objects) drawSiteObject(dc, ob, t)
  }
  // plot boundary + setbacks
  dc.polyline(plot.polygon, S(t.plotLine, 1.2, { dash: [14, 4, 2, 4] }), true)
  if (plot.boundaryWall.enabled) {
    const th = plot.boundaryWall.thickness
    const pts = plot.polygon
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const isFront = Math.abs(a.y - pb.y - pb.h) < 0.01 && Math.abs(b.y - pb.y - pb.h) < 0.01
      const segs = isFront ? frontSegmentsMinusGates(a, b, house) : [[a, b]]
      for (const [p, q] of segs) {
        const d = norm(sub(q, p))
        const n = perp(d)
        const inward = house.plot.shape === 'rect' ? inwardNormal(p, q, pb) : n
        const r = [p, q, add(q, scale(inward, th)), add(p, scale(inward, th))]
        dc.polygon(r, { color: t.partitionFill }, null)
      }
    }
    for (const g of plot.gates.filter((g) => g.side === 'front')) {
      const x0 = pb.x + g.offset - g.width / 2
      const y = pb.y + pb.h
      if (g.type === 'sliding') dc.line({ x: x0, y: y - 0.05 }, { x: x0 + g.width, y: y - 0.05 }, S(t.opening, 1.2, { dash: [3, 2] }))
      else dc.arc({ x: x0, y }, g.width, -Math.PI / 2, 0, S(t.opening, 0.6))
    }
  }
}

function inwardNormal(a: Vec2, b: Vec2, pb: { x: number; y: number; w: number; h: number }) {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const c = { x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 }
  const n = perp(norm(sub(b, a)))
  return (m.x + n.x - c.x) ** 2 + (m.y + n.y - c.y) ** 2 < (m.x - c.x) ** 2 + (m.y - c.y) ** 2 ? n : scale(n, -1)
}

function frontSegmentsMinusGates(a: Vec2, b: Vec2, house: HouseState): [Vec2, Vec2][] {
  const pb = bbox(house.plot.polygon)
  const xs = [Math.min(a.x, b.x), Math.max(a.x, b.x)]
  const gaps = house.plot.gates.filter((g) => g.side === 'front').map((g) => [pb.x + g.offset - g.width / 2, pb.x + g.offset + g.width / 2]).sort((p, q) => p[0] - q[0])
  const out: [Vec2, Vec2][] = []
  let x = xs[0]
  for (const [g0, g1] of gaps) {
    if (g0 > x) out.push([{ x, y: a.y }, { x: g0, y: a.y }])
    x = Math.max(x, g1)
  }
  if (x < xs[1]) out.push([{ x, y: a.y }, { x: xs[1], y: a.y }])
  return out
}

function lawnMarks(dc: DrawContext, poly: Vec2[], t: PlanTheme) {
  const b = bbox(poly)
  const step = 0.9
  let k = 0
  for (let y = b.y + step / 2; y < b.y + b.h; y += step) {
    for (let x = b.x + ((k++ % 2) * step) / 2 + step / 2; x < b.x + b.w; x += step) {
      dc.line({ x: x - 0.06, y: y + 0.05 }, { x, y: y - 0.06 }, S(t.lawnMark, 0.5))
      dc.line({ x, y: y - 0.06 }, { x: x + 0.06, y: y + 0.05 }, S(t.lawnMark, 0.5))
    }
  }
}

function drawSiteObject(dc: DrawContext, ob: HouseState['site']['objects'][number], t: PlanTheme) {
  const p = ob.position
  const s = ob.scale
  switch (ob.kind) {
    case 'tree':
    case 'palm': {
      const r = (ob.kind === 'palm' ? 1.6 : 2.0) * s
      dc.circle(p, r, { color: t.tree, opacity: 0.85 }, S(t.treeStroke, 0.7))
      if (ob.kind === 'palm') for (let i = 0; i < 7; i++) dc.line(p, add(p, scale({ x: Math.cos((i * Math.PI * 2) / 7 + ob.rotation), y: Math.sin((i * Math.PI * 2) / 7 + ob.rotation) }, r * 0.95)), S(t.treeStroke, 0.6))
      else for (let i = 0; i < 9; i++) {
        const a = (i * Math.PI * 2) / 9 + ob.rotation
        dc.arc(add(p, scale({ x: Math.cos(a), y: Math.sin(a) }, r * 0.72)), r * 0.32, a - 1.2, a + 1.2, S(t.treeStroke, 0.5))
      }
      dc.circle(p, 0.12 * s, { color: t.treeStroke }, null)
      break
    }
    case 'shrub':
    case 'flowers':
    case 'planter':
      dc.circle(p, (ob.kind === 'flowers' ? 0.5 : 0.6) * s, { color: t.tree }, S(t.treeStroke, 0.5, { dash: ob.kind === 'flowers' ? [1, 2] : undefined }))
      break
    case 'hedge': {
      const w = ob.width ?? 2
      const d = ob.depth ?? 0.5
      dc.polygon([{ x: p.x - w / 2, y: p.y - d / 2 }, { x: p.x + w / 2, y: p.y - d / 2 }, { x: p.x + w / 2, y: p.y + d / 2 }, { x: p.x - w / 2, y: p.y + d / 2 }], { color: t.tree }, S(t.treeStroke, 0.5))
      break
    }
    case 'pergola': {
      const w = ob.width ?? 3
      const d = ob.depth ?? 3
      const r = { x: p.x - w / 2, y: p.y - d / 2 }
      dc.polyline([r, { x: r.x + w, y: r.y }, { x: r.x + w, y: r.y + d }, { x: r.x, y: r.y + d }], S(t.furniture, 0.6, { dash: [4, 3] }), true)
      for (let x = r.x + 0.4; x < r.x + w; x += 0.45) dc.line({ x, y: r.y }, { x, y: r.y + d }, S(t.furniture, 0.3, { opacity: 0.7 }))
      break
    }
    case 'fountain':
      dc.circle(p, 1.1, { color: t.water }, S(t.glass, 0.8))
      dc.circle(p, 0.35, null, S(t.glass, 0.6))
      break
    case 'garden_light':
    case 'lamp_post':
      dc.circle(p, 0.09, { color: t.lighting }, null)
      break
    default: {
      const w = (ob.width ?? 1) * s
      const d = (ob.depth ?? 1) * s
      const pts = [
        { x: -w / 2, y: -d / 2 },
        { x: w / 2, y: -d / 2 },
        { x: w / 2, y: d / 2 },
        { x: -w / 2, y: d / 2 }
      ].map((q) => add(rotate(q, ob.rotation), p))
      dc.polygon(pts, { color: t.furnitureFill }, S(t.furniture, 0.5))
    }
  }
}

function drawOpening(dc: DrawContext, floor: Floor, op: Opening, t: PlanTheme) {
  const w = floor.walls.find((x) => x.id === op.wallId)
  if (!w) return
  const d = norm(sub(w.b, w.a))
  const n = perp(d)
  const c = add(w.a, scale(d, op.offset))
  const half = op.width / 2
  const th = Math.max(w.thickness, 0.1)
  const a = add(c, scale(d, -half))
  const b = add(c, scale(d, half))
  const jamb = (p: Vec2) => dc.line(add(p, scale(n, th / 2)), add(p, scale(n, -th / 2)), S(t.wallStroke, 0.8))
  if (op.kind === 'window') {
    jamb(a)
    jamb(b)
    dc.line(add(a, scale(n, th / 2)), add(b, scale(n, th / 2)), S(t.opening, 0.5))
    dc.line(add(a, scale(n, -th / 2)), add(b, scale(n, -th / 2)), S(t.opening, 0.5))
    dc.line(a, b, S(t.glass, op.style === 'full-height' ? 1.4 : 1))
    if (op.style === 'sliding') {
      dc.line(add(a, scale(n, th / 6)), add(c, scale(n, th / 6)), S(t.glass, 0.7))
      dc.line(add(c, scale(n, -th / 6)), add(b, scale(n, -th / 6)), S(t.glass, 0.7))
    }
    return
  }
  jamb(a)
  jamb(b)
  const side = op.swing === 'right' ? -1 : 1
  const into = scale(n, side)
  const leaf = S(t.opening, 0.9)
  const swing = S(t.opening, 0.5, { dash: [3, 2] })
  const angN = Math.atan2(into.y, into.x)
  if (op.style === 'opening') {
    dc.line(add(a, scale(n, th / 2)), add(b, scale(n, th / 2)), S(t.virtual, 0.4, { dash: [2, 2] }))
    dc.line(add(a, scale(n, -th / 2)), add(b, scale(n, -th / 2)), S(t.virtual, 0.4, { dash: [2, 2] }))
    return
  }
  if (op.style === 'sliding' || op.style === 'pocket') {
    dc.line(add(a, scale(n, 0.03)), add(c, scale(n, 0.03)), S(t.opening, 1.1))
    dc.line(add(c, scale(n, -0.03)), add(b, scale(n, -0.03)), S(t.opening, 1.1))
    return
  }
  if (op.style === 'garage') {
    dc.line(a, b, S(t.opening, 0.9, { dash: [6, 3] }))
    dc.line(add(a, scale(into, 0.4)), add(b, scale(into, 0.4)), S(t.opening, 0.4, { dash: [2, 3] }))
    return
  }
  const double = op.style === 'double' || op.style === 'french' || op.style === 'main'
  if (double) {
    const r = half
    for (const [h, dirSign] of [
      [a, 1],
      [b, -1]
    ] as [Vec2, number][]) {
      const tip = add(h, scale(into, r))
      dc.line(h, tip, leaf)
      const angD = Math.atan2(d.y * dirSign, d.x * dirSign)
      arcBetween(dc, h, r, angD, angN, swing)
    }
    return
  }
  const hinge = op.hinge === 'end' ? b : a
  const toward = op.hinge === 'end' ? scale(d, -1) : d
  const r = op.width
  dc.line(hinge, add(hinge, scale(into, r)), leaf)
  arcBetween(dc, hinge, r, Math.atan2(toward.y, toward.x), angN, swing)
}

function arcBetween(dc: DrawContext, c: Vec2, r: number, a0: number, a1: number, st: Stroke) {
  let d = a1 - a0
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  if (d >= 0) dc.arc(c, r, a0, a0 + d, st)
  else dc.arc(c, r, a0 + d, a0, st)
}

function local(f: FurnitureItem, pts: [number, number][]): Vec2[] {
  return pts.map(([x, y]) => add(rotate({ x, y }, f.rotation), f.position))
}

function rectL(f: FurnitureItem, x0: number, y0: number, x1: number, y1: number) {
  return local(f, [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1]
  ])
}

export function drawFurniture(dc: DrawContext, f: FurnitureItem, t: PlanTheme) {
  const c = catalogItem(f.type)
  const plan = c?.plan ?? 'box'
  const w = f.width / 2
  const d = f.depth / 2
  const st = S(t.furniture, 0.6)
  const thin = S(t.furniture, 0.4)
  const fill = { color: t.furnitureFill }
  const body = rectL(f, -w, -d, w, d)
  switch (plan) {
    case 'bed':
    case 'bed-single': {
      dc.polygon(body, fill, st)
      dc.polygon(rectL(f, -w, -d, w, -d + 0.08), { color: t.furniture, opacity: 0.4 }, thin)
      const pw = plan === 'bed' ? (2 * w - 0.25) / 2 : 2 * w - 0.2
      for (let i = 0; i < (plan === 'bed' ? 2 : 1); i++) {
        const x0 = -w + 0.1 + i * (pw + 0.05)
        dc.polygon(rectL(f, x0, -d + 0.15, x0 + pw, -d + 0.5), null, thin)
      }
      dc.polyline(local(f, [[-w, -d + 0.8], [w, -d + 0.65]]), thin)
      break
    }
    case 'sofa':
      dc.polygon(body, fill, st)
      dc.polygon(rectL(f, -w, -d, w, -d + 0.22), null, thin)
      dc.polygon(rectL(f, -w, -d + 0.22, -w + 0.2, d), null, thin)
      dc.polygon(rectL(f, w - 0.2, -d + 0.22, w, d), null, thin)
      break
    case 'sofa-l': {
      const pts = local(f, [[-w, -d], [w, -d], [w, d], [w - 0.9, d], [w - 0.9, -d + 0.9], [-w, -d + 0.9]])
      dc.polygon(pts, fill, st)
      dc.polyline(local(f, [[-w, -d + 0.22], [w - 0.22, -d + 0.22], [w - 0.22, d]]), thin)
      break
    }
    case 'armchair':
      dc.polygon(body, fill, st)
      dc.polygon(rectL(f, -w + 0.15, -d + 0.2, w - 0.15, d - 0.05), null, thin)
      break
    case 'dining': {
      const tw = w - 0.45
      const td = d - 0.45
      dc.polygon(rectL(f, -tw, -td, tw, td), fill, st)
      const nx = Math.max(1, Math.round((2 * tw) / 0.6))
      for (let i = 0; i < nx; i++) {
        const x = -tw + ((i + 0.5) * 2 * tw) / nx
        dc.polygon(rectL(f, x - 0.2, -d + 0.02, x + 0.2, -td - 0.05), null, thin)
        dc.polygon(rectL(f, x - 0.2, td + 0.05, x + 0.2, d - 0.02), null, thin)
      }
      if (2 * td > 1.0) {
        dc.polygon(rectL(f, -w + 0.02, -0.2, -tw - 0.05, 0.2), null, thin)
        dc.polygon(rectL(f, tw + 0.05, -0.2, w - 0.02, 0.2), null, thin)
      }
      break
    }
    case 'wardrobe':
      dc.polygon(body, fill, st)
      dc.line(local(f, [[-w, d - 0.05]])[0], local(f, [[w, d - 0.05]])[0], thin)
      dc.line(local(f, [[-w, -d]])[0], local(f, [[w, d]])[0], S(t.furniture, 0.3, { dash: [3, 3] }))
      break
    case 'counter':
    case 'counter-sink':
    case 'counter-hob':
    case 'island':
      dc.polygon(body, fill, st)
      dc.line(local(f, [[-w, d - 0.05]])[0], local(f, [[w, d - 0.05]])[0], thin)
      if (plan === 'counter-sink') dc.polygon(rectL(f, -0.35, -d + 0.1, 0.35, d - 0.12), null, st)
      if (plan === 'counter-hob') for (const [x, y] of [[-0.18, -0.1], [0.18, -0.1], [-0.18, 0.15], [0.18, 0.15]]) dc.circle(local(f, [[x, y]])[0], 0.08, null, thin)
      break
    case 'fridge':
      dc.polygon(body, fill, st)
      dc.text(f.position, 'REF', { size: 0.12, color: t.furniture, align: 'center', baseline: 'middle', rotation: f.rotation, condensed: true, minPx: 6 })
      break
    case 'wc': {
      dc.polygon(rectL(f, -w, -d, w, -d + 0.2), fill, st)
      const oval = Array.from({ length: 18 }, (_, i) => {
        const a = (i / 18) * Math.PI * 2
        return [Math.cos(a) * (w - 0.02), -d + 0.45 + Math.sin(a) * (d - 0.25)] as [number, number]
      })
      dc.polygon(local(f, oval), fill, st)
      break
    }
    case 'basin':
      dc.polygon(body, fill, st)
      dc.circle(local(f, [[0, 0.02]])[0], Math.min(w, d) * 0.6, null, thin)
      break
    case 'shower':
      dc.polygon(body, fill, st)
      dc.line(body[0], body[2], thin)
      dc.line(body[1], body[3], thin)
      dc.circle(f.position, 0.05, null, thin)
      break
    case 'bathtub':
      dc.polygon(body, fill, st)
      dc.polygon(rectL(f, -w + 0.08, -d + 0.08, w - 0.08, d - 0.08), null, thin)
      break
    case 'tv':
      dc.polygon(body, fill, st)
      dc.line(local(f, [[-w * 0.9, d]])[0], local(f, [[w * 0.9, d]])[0], S(t.furniture, 1))
      break
    case 'car': {
      const pts = local(f, [[-w + 0.15, -d], [w - 0.15, -d], [w, -d + 0.4], [w, d - 0.3], [w - 0.15, d], [-w + 0.15, d], [-w, d - 0.3], [-w, -d + 0.4]])
      dc.polygon(pts, fill, st)
      dc.polygon(rectL(f, -w + 0.2, d - 1.6, w - 0.2, d - 0.95), null, thin)
      dc.polygon(rectL(f, -w + 0.25, -d + 0.8, w - 0.25, -d + 1.2), null, thin)
      break
    }
    case 'plant':
      dc.circle(f.position, Math.max(w, d), { color: t.tree }, S(t.treeStroke, 0.5))
      break
    case 'rug':
      dc.polygon(body, null, S(t.furniture, 0.4, { dash: [2, 2] }))
      break
    case 'washer':
      dc.polygon(body, fill, st)
      dc.circle(f.position, Math.min(w, d) * 0.65, null, thin)
      break
    case 'circle':
      dc.circle(f.position, Math.max(w, d), fill, st)
      break
    case 'solar':
      dc.polygon(body, { color: t.glass, opacity: 0.3 }, st)
      for (let i = 1; i < 3; i++) dc.line(local(f, [[-w + (2 * w * i) / 3, -d]])[0], local(f, [[-w + (2 * w * i) / 3, d]])[0], thin)
      break
    case 'lamp':
      dc.circle(f.position, Math.max(w, d) * 0.9, null, st)
      break
    case 'shelf':
      dc.polygon(body, fill, st)
      dc.line(local(f, [[-w, 0]])[0], local(f, [[w, 0]])[0], thin)
      break
    case 'desk':
    case 'table':
      dc.polygon(body, fill, st)
      break
    case 'lounger':
      dc.polygon(body, fill, st)
      dc.line(local(f, [[-w, -d + 0.6]])[0], local(f, [[w, -d + 0.6]])[0], thin)
      break
    default:
      dc.polygon(body, fill, st)
  }
}

function drawElectrical(dc: DrawContext, p: { kind: string; p: Vec2; rot: number; label?: string }, t: PlanTheme) {
  const s = S(t.electrical, 0.7)
  switch (p.kind) {
    case 'switch':
      dc.circle(p.p, 0.07, { color: t.electrical }, null)
      dc.line(p.p, add(p.p, scale({ x: Math.cos(p.rot - 0.7), y: Math.sin(p.rot - 0.7) }, 0.22)), s)
      break
    case 'socket': {
      const d = { x: Math.cos(p.rot), y: Math.sin(p.rot) }
      dc.arc(p.p, 0.1, p.rot - Math.PI / 2, p.rot + Math.PI / 2, s)
      dc.line(add(p.p, scale(perp(d), 0.1)), add(p.p, scale(perp(d), -0.1)), s)
      break
    }
    case 'fan':
      dc.circle(p.p, 0.1, null, s)
      for (let i = 0; i < 3; i++) {
        const a = (i * 2 * Math.PI) / 3
        dc.line(add(p.p, scale({ x: Math.cos(a), y: Math.sin(a) }, 0.1)), add(p.p, scale({ x: Math.cos(a + 0.4), y: Math.sin(a + 0.4) }, 0.45)), s)
      }
      break
    case 'ac': {
      const d = { x: Math.cos(p.rot), y: Math.sin(p.rot) }
      const n = perp(d)
      const pts = [add(p.p, scale(n, 0.45)), add(p.p, scale(n, -0.45)), add(add(p.p, scale(n, -0.45)), scale(d, 0.2)), add(add(p.p, scale(n, 0.45)), scale(d, 0.2))]
      dc.polygon(pts, { color: t.electrical, opacity: 0.15 }, s)
      dc.text(add(p.p, scale(d, 0.1)), 'AC', { size: 0.12, color: t.electrical, align: 'center', baseline: 'middle', condensed: true, minPx: 6 })
      break
    }
    case 'db':
      dc.polygon(sq(p.p, 0.16), { color: t.electrical }, null)
      dc.text(add(p.p, { x: 0, y: 0.35 }), 'DB', { size: 0.14, color: t.electrical, align: 'center', baseline: 'middle', condensed: true, minPx: 7 })
      break
  }
}

function drawLight(dc: DrawContext, p: { kind: string; p: Vec2 }, t: PlanTheme, lux: boolean) {
  const s = S(t.lighting, 0.7)
  if (lux) dc.circle(p.p, p.kind === 'chandelier' ? 2.2 : 1.1, { color: t.lighting, opacity: 0.07 }, null)
  switch (p.kind) {
    case 'chandelier':
      dc.circle(p.p, 0.3, null, s)
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3
        dc.circle(add(p.p, scale({ x: Math.cos(a), y: Math.sin(a) }, 0.3)), 0.06, { color: t.lighting }, null)
      }
      break
    case 'light':
    case 'pendant':
      dc.circle(p.p, 0.14, null, s)
      dc.line(add(p.p, { x: -0.1, y: -0.1 }), add(p.p, { x: 0.1, y: 0.1 }), s)
      dc.line(add(p.p, { x: 0.1, y: -0.1 }), add(p.p, { x: -0.1, y: 0.1 }), s)
      break
    case 'cove':
      dc.circle(p.p, 0.2, null, S(t.lighting, 0.6, { dash: [2, 2] }))
      break
    default:
      dc.circle(p.p, 0.07, { color: t.lighting }, null)
  }
}

function drawRoomLabel(dc: DrawContext, r: Room, t: PlanTheme, o: PlanOptions) {
  if (r.type === 'void' && !r.name) return
  const a = area(r.polygon)
  if (a < 0.8) return
  const b = bbox(r.polygon)
  const inner = isAxisRect(r.polygon) ? b : largestInscribedRect(r.polygon, 0.2)
  const c = isAxisRect(r.polygon) ? centroid(r.polygon) : { x: inner.x + inner.w / 2, y: inner.y + inner.h / 2 }
  const short = Math.min(inner.w, inner.h)
  let size = Math.max(0.13, Math.min(0.26, short / 9))
  const showDims = o.showRoomDims !== false && short > 1.3
  const name = r.name.toUpperCase()
  // fit the name to the room width (condensed caps ≈ 0.58 × cap height per glyph)
  const avail = inner.w * 0.9
  let lines = [name]
  const GLYPH = 0.8
  if (name.length * size * GLYPH > avail) {
    const words = name.split(' ')
    if (words.length > 1 && name.length * 0.12 * GLYPH > avail) {
      const mid = Math.ceil(words.length / 2)
      lines = [words.slice(0, mid).join(' '), words.slice(mid).join(' ')]
    }
    const longest = Math.max(...lines.map((l) => l.length))
    size = Math.max(0.08, Math.min(size, avail / (longest * GLYPH)))
  }
  const y0 = (showDims ? c.y - size * 0.8 : c.y) - ((lines.length - 1) * size * 1.25) / 2
  lines.forEach((ln, i) => dc.text({ x: c.x, y: y0 + i * size * 1.25 }, ln, { size, color: t.text, weight: 600, align: 'center', baseline: 'middle', condensed: true, minPx: 7, maxPx: 15 }))
  if (showDims && dc.pxPerMeter * size > 5) {
    const dims = `${formatLength(b.w, o.units, { compact: true })} × ${formatLength(b.h, o.units, { compact: true })}`
    const yl = y0 + (lines.length - 1) * size * 1.25
    const ds = Math.min(size * 0.78, (inner.w * 0.95) / (dims.length * 0.55))
    dc.text({ x: c.x, y: yl + size * 1.55 }, dims, { size: ds, color: t.textMuted, align: 'center', baseline: 'middle', minPx: 7, maxPx: 12 })
    if (short > 2.2) dc.text({ x: c.x, y: yl + size * 2.85 }, formatAreaFor(a, o.units), { size: size * 0.7, color: t.textMuted, align: 'center', baseline: 'middle', minPx: 7, maxPx: 11, opacity: 0.8 })
  }
}

export function drawDimension(dc: DrawContext, a: Vec2, b: Vec2, offset: number, t: PlanTheme, units: UnitSystem, color = t.dim) {
  const d = norm(sub(b, a))
  const n = perp(d)
  const A = add(a, scale(n, offset))
  const B = add(b, scale(n, offset))
  const st = S(color, 0.5)
  const ext = Math.sign(offset) || 1
  dc.line(add(a, scale(n, ext * 0.1)), add(A, scale(n, ext * 0.15)), st)
  dc.line(add(b, scale(n, ext * 0.1)), add(B, scale(n, ext * 0.15)), st)
  dc.line(A, B, st)
  for (const p of [A, B]) dc.line(add(p, add(scale(d, -0.08), scale(n, -0.08))), add(p, add(scale(d, 0.08), scale(n, 0.08))), S(color, 1))
  const L = segLength(a, b)
  let ang = Math.atan2(d.y, d.x)
  if (ang > Math.PI / 2 + 1e-3) ang -= Math.PI
  if (ang < -Math.PI / 2 + 1e-3) ang += Math.PI
  const mid = add(scale(add(A, B), 0.5), scale(n, ext * 0.12))
  dc.text(mid, formatLength(L, units), { size: 0.17, color, align: 'center', baseline: ext > 0 ? 'top' : 'bottom', rotation: ang, minPx: 8, maxPx: 13 })
}

/** Exterior dimension chains for the "Dimension plan" output. */
export function drawDimensionChains(dc: DrawContext, floor: Floor, t: PlanTheme, units: UnitSystem) {
  const rooms = floor.rooms.filter((r) => !spec(r.type).outdoor && r.type !== 'garage')
  if (!rooms.length) return
  const all = rooms.flatMap((r) => r.polygon)
  const b = bbox(all)
  const xs = [...new Set(all.map((p) => Math.round(p.x * 1000) / 1000))].sort((p, q) => p - q)
  const ys = [...new Set(all.map((p) => Math.round(p.y * 1000) / 1000))].sort((p, q) => p - q)
  dc.layer('dimensions')
  for (let i = 0; i < xs.length - 1; i++) if (xs[i + 1] - xs[i] > 0.3) drawDimension(dc, { x: xs[i], y: b.y }, { x: xs[i + 1], y: b.y }, -0.9, t, units)
  drawDimension(dc, { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, -1.6, t, units)
  for (let i = 0; i < ys.length - 1; i++) if (ys[i + 1] - ys[i] > 0.3) drawDimension(dc, { x: b.x, y: ys[i] }, { x: b.x, y: ys[i + 1] }, 0.9, t, units)
  drawDimension(dc, { x: b.x, y: b.y }, { x: b.x, y: b.y + b.h }, 1.6, t, units)
}

export function drawNorthArrow(dc: DrawContext, p: Vec2, size: number, angle: number, t: PlanTheme) {
  const tip = add(p, rotate({ x: 0, y: -size }, angle))
  const l = add(p, rotate({ x: -size * 0.35, y: size * 0.4 }, angle))
  const r = add(p, rotate({ x: size * 0.35, y: size * 0.4 }, angle))
  dc.polygon([tip, r, p], { color: t.text }, S(t.text, 0.6))
  dc.polygon([tip, p, l], { color: t.paper }, S(t.text, 0.6))
  dc.circle(p, size * 1.05, null, S(t.text, 0.4))
  dc.text(add(p, rotate({ x: 0, y: -size * 1.45 }, angle)), 'N', { size: size * 0.45, color: t.text, align: 'center', baseline: 'middle', weight: 700, minPx: 9 })
}
