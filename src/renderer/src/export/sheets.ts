import type { Floor, HouseState, Project, Vec2 } from '../core/model/types'
import type { DrawContext, Stroke } from '../render/draw/types'
import { drawPlan, drawDimension, drawNorthArrow, drawElectrical, drawLight, type PlanMode } from '../render/draw/plan'
import { PRINT_PLAN } from '../render/draw/theme'
import { drawElevation, drawSection, sectionLines, roofFaces, type ElevationSide, type SectionAxis, type DrawnExtent } from './elevation'
import { TransformContext } from './contexts'
import { bbox, unionPolys } from '../core/geometry/polygon'
import { sortedFloors } from '../core/model/house'
import { spec } from '../core/constraints/rooms'
import { DISCLAIMER } from '../core/model/defaults'
import { formatAreaFor, formatLength, formatPlotSize } from '../core/units/units'
import { areaSummary } from '../planner/metrics'
import { northAngle } from '../engine/lighting/sun'

/**
 * PROFESSIONAL DRAWING OUTPUT (§32): every drawing kind, composed on A3 sheets with a title block,
 * scale bar and the conceptual-design disclaimer. Drawn once against DrawContext, so the PDF,
 * SVG, PNG and DXF exports are the same drawing.
 */

export type DrawingKind = 'floor-plan' | 'dimension-plan' | 'furniture-plan' | 'electrical-plan' | 'lighting-plan' | 'site-plan' | 'roof-plan' | 'elevation' | 'section'

export interface DrawingSpec {
  id: string
  kind: DrawingKind
  title: string
  number: string
  floorId?: string
  side?: ElevationSide
  axis?: SectionAxis
}

export const DRAWING_KINDS: { kind: DrawingKind; label: string; perFloor: boolean }[] = [
  { kind: 'floor-plan', label: 'Floor plans', perFloor: true },
  { kind: 'dimension-plan', label: 'Dimension plans', perFloor: true },
  { kind: 'furniture-plan', label: 'Furniture plans', perFloor: true },
  { kind: 'electrical-plan', label: 'Electrical concept plans', perFloor: true },
  { kind: 'lighting-plan', label: 'Lighting concept plans', perFloor: true },
  { kind: 'site-plan', label: 'Site plan', perFloor: false },
  { kind: 'roof-plan', label: 'Roof plan', perFloor: false },
  { kind: 'elevation', label: 'Elevations (front, rear, left, right)', perFloor: false },
  { kind: 'section', label: 'Sections (A-A, B-B)', perFloor: false }
]

const PREFIX: Record<DrawingKind, string> = {
  'site-plan': 'A-0',
  'floor-plan': 'A-1',
  'dimension-plan': 'A-2',
  'furniture-plan': 'I-1',
  'electrical-plan': 'E-1',
  'lighting-plan': 'E-2',
  'roof-plan': 'A-3',
  elevation: 'A-4',
  section: 'A-5'
}

const KIND_TITLE: Record<DrawingKind, string> = {
  'floor-plan': 'plan',
  'dimension-plan': 'dimension plan',
  'furniture-plan': 'furniture plan',
  'electrical-plan': 'electrical concept plan',
  'lighting-plan': 'lighting concept plan',
  'site-plan': 'Site plan',
  'roof-plan': 'Roof plan',
  elevation: 'elevation',
  section: 'section'
}

/** Expand chosen drawing kinds into the list of sheets for this project. */
export function listDrawings(p: Project, kinds: DrawingKind[]): DrawingSpec[] {
  const floors = sortedFloors(p.floors).filter((f) => f.kind !== 'roof' && f.rooms.length)
  const out: DrawingSpec[] = []
  for (const k of DRAWING_KINDS.map((d) => d.kind).filter((x) => kinds.includes(x))) {
    if (k === 'site-plan' || k === 'roof-plan') out.push({ id: k, kind: k, title: KIND_TITLE[k], number: `${PREFIX[k]}01` })
    else if (k === 'elevation')
      (['front', 'rear', 'left', 'right'] as ElevationSide[]).forEach((s, i) => out.push({ id: `elev-${s}`, kind: k, side: s, title: `${s[0].toUpperCase() + s.slice(1)} elevation`, number: `${PREFIX[k]}0${i + 1}` }))
    else if (k === 'section') (['A', 'B'] as SectionAxis[]).forEach((a, i) => out.push({ id: `sect-${a}`, kind: k, axis: a, title: `Section ${a}-${a}`, number: `${PREFIX[k]}0${i + 1}` }))
    else
      floors.forEach((f, i) => {
        const name = /floor$/i.test(f.name) ? f.name : `${f.name} floor`
        out.push({ id: `${k}-${f.id}`, kind: k, floorId: f.id, title: `${name} ${KIND_TITLE[k]}`.replace(/^./, (c) => c.toUpperCase()), number: `${PREFIX[k]}0${i + 1}` })
      })
  }
  return out
}

const INK = '#1b1f24'
const S = (w: number, color = INK, extra: Partial<Stroke> = {}): Stroke => ({ color, width: w, ...extra })

function planHouse(p: Project): HouseState {
  return { plot: p.plot, floors: p.floors, site: p.site, exterior: p.exterior }
}

/** Draw one drawing in world units; returns the extent (world meters) it occupies. */
export function drawDrawing(dc: DrawContext, p: Project, d: DrawingSpec, o: { color?: boolean } = {}): DrawnExtent {
  const house = planHouse(p)
  const units = p.settings.units
  if (d.kind === 'elevation') return drawElevation(dc, house, d.side!, { units, materials: p.materials, plinth: p.settings.plinthHeight, color: o.color })
  if (d.kind === 'section') return drawSection(dc, house, d.axis!, { units, materials: p.materials, plinth: p.settings.plinthHeight, color: o.color })
  if (d.kind === 'roof-plan') return drawRoofPlan(dc, p)
  const floor = d.kind === 'site-plan' ? sortedFloors(p.floors).find((f) => f.level === 0)! : p.floors.find((f) => f.id === d.floorId)!
  const mode: PlanMode = d.kind === 'site-plan' ? 'site' : d.kind === 'dimension-plan' ? 'dimension' : d.kind === 'furniture-plan' ? 'furniture' : d.kind === 'electrical-plan' ? 'electrical' : d.kind === 'lighting-plan' ? 'lighting' : 'plan'
  const layers = {
    ...p.settings.layers,
    furniture: d.kind === 'furniture-plan' || (d.kind === 'floor-plan' && p.settings.layers.furniture),
    electrical: d.kind === 'electrical-plan',
    lighting: d.kind === 'lighting-plan',
    plumbing: d.kind === 'electrical-plan' ? false : false,
    materials: false,
    landscape: d.kind === 'site-plan' || floor.level === 0,
    annotations: true
  }
  const site = d.kind === 'site-plan'
  drawPlan(dc, house, floor, { theme: PRINT_PLAN, layers, units, mode, showSite: site, showLabels: true, showRoomDims: d.kind !== 'site-plan', materials: p.materials })
  if (d.kind === 'floor-plan' && floor.level === 0) drawSectionMarks(dc, house)
  if (site) return drawSiteExtras(dc, p)
  const pts = floor.rooms.flatMap((r) => r.polygon)
  const b = bbox(pts.length ? pts : p.plot.polygon)
  const m = d.kind === 'dimension-plan' ? 2.6 : 1.2
  return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }
}

function drawSectionMarks(dc: DrawContext, house: HouseState) {
  dc.layer('section-marks')
  for (const s of sectionLines(house)) {
    dc.line(s.a, s.b, S(0.5, INK, { dash: [12, 3, 2, 3] }))
    for (const end of [s.a, s.b]) {
      dc.circle(end, 0.45, { color: '#ffffff' }, S(0.6))
      dc.text(end, s.axis, { size: 0.32, color: INK, weight: 700, align: 'center', baseline: 'middle' })
    }
  }
}

function drawSiteExtras(dc: DrawContext, p: Project): DrawnExtent {
  const plot = p.plot
  const pb = bbox(plot.polygon)
  const units = p.settings.units
  dc.layer('setbacks')
  const sb = plot.setbacks
  const inner = [
    { x: pb.x + sb.left, y: pb.y + sb.rear },
    { x: pb.x + pb.w - sb.right, y: pb.y + sb.rear },
    { x: pb.x + pb.w - sb.right, y: pb.y + pb.h - sb.front },
    { x: pb.x + sb.left, y: pb.y + pb.h - sb.front }
  ]
  dc.polyline(inner, S(0.4, '#b07f00', { dash: [4, 3] }), true)
  dc.layer('dimensions')
  drawDimension(dc, { x: pb.x, y: pb.y }, { x: pb.x + pb.w, y: pb.y }, -1.6, PRINT_PLAN, units)
  drawDimension(dc, { x: pb.x + pb.w, y: pb.y }, { x: pb.x + pb.w, y: pb.y + pb.h }, -1.6, PRINT_PLAN, units)
  if (sb.front > 0.1) drawDimension(dc, { x: pb.x + pb.w * 0.2, y: pb.y + pb.h - sb.front }, { x: pb.x + pb.w * 0.2, y: pb.y + pb.h }, 0.3, PRINT_PLAN, units)
  if (sb.rear > 0.1) drawDimension(dc, { x: pb.x + pb.w * 0.2, y: pb.y }, { x: pb.x + pb.w * 0.2, y: pb.y + sb.rear }, 0.3, PRINT_PLAN, units)
  const a = areaSummary(planHouse(p))
  dc.layer('notes')
  const lines = [`Plot ${formatPlotSize(plot.width, plot.depth, units)}  (${formatAreaFor(a.plotArea, units)})`, `Covered area ${formatAreaFor(a.coveredArea, units)}`, `Open area ${formatAreaFor(a.openArea, units)}`]
  lines.forEach((l, i) => dc.text({ x: pb.x, y: pb.y + pb.h + plot.roadWidth + 1.2 + i * 0.6 }, l, { size: 0.28, color: INK, align: 'left', baseline: 'top' }))
  return { x: pb.x - 3.2, y: pb.y - 2.4, w: pb.w + 6.4, h: pb.h + plot.roadWidth + 4.6 }
}

/** Roof plan: roof-level floor (parapets, mumty, tanks) or pitched roof planes with ridges and fall arrows. */
export function drawRoofPlan(dc: DrawContext, p: Project): DrawnExtent {
  const house = planHouse(p)
  const floors = sortedFloors(p.floors)
  const roof = floors.find((f) => f.kind === 'roof')
  const tops = floors.filter((f) => f.kind !== 'roof' && f.level >= 0)
  const top = tops[tops.length - 1]
  const layers = { ...p.settings.layers, furniture: false, electrical: false, lighting: false, plumbing: false, materials: false }
  const foot = unionPolys((top?.rooms ?? []).filter((r) => r.type !== 'void' && !spec(r.type).outdoor).map((r) => r.polygon))
  dc.layer('roof-outline')
  for (const u of foot) dc.polygon(u.outer, { color: '#f4f4f2' }, S(0.9), u.holes)
  const faces = roofFaces(house, p.settings.plinthHeight)
  if (faces.length) {
    dc.layer('roof')
    for (const f of faces.filter((x) => x.kind === 'roof')) {
      const pts = f.pts.map((q) => ({ x: q.x, y: q.y }))
      dc.polygon(pts, { color: '#ffffff' }, S(0.6))
      // fall arrow: from the highest edge towards the lowest
      const hi = f.pts.reduce((m, q) => (q.z > m.z ? q : m), f.pts[0])
      const lo = f.pts.reduce((m, q) => (q.z < m.z ? q : m), f.pts[0])
      const c = { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length }
      const dir = { x: lo.x - hi.x, y: lo.y - hi.y }
      const L = Math.hypot(dir.x, dir.y) || 1
      const a = { x: c.x - (dir.x / L) * 0.8, y: c.y - (dir.y / L) * 0.8 }
      const b = { x: c.x + (dir.x / L) * 0.8, y: c.y + (dir.y / L) * 0.8 }
      dc.line(a, b, S(0.5))
      const ang = Math.atan2(dir.y, dir.x)
      dc.polygon([b, { x: b.x - Math.cos(ang - 0.4) * 0.3, y: b.y - Math.sin(ang - 0.4) * 0.3 }, { x: b.x - Math.cos(ang + 0.4) * 0.3, y: b.y - Math.sin(ang + 0.4) * 0.3 }], { color: INK }, null)
    }
    dc.text(centerOf(foot.flatMap((u) => u.outer)), `${p.exterior.roofType} roof, ${roofLabel(p)}`, { size: 0.3, color: INK, align: 'center', baseline: 'top' })
  } else if (roof) {
    drawPlan(dc, house, roof, { theme: PRINT_PLAN, layers, units: p.settings.units, showSite: false, showLabels: true, materials: p.materials })
    dc.layer('notes')
    const c = centerOf(foot.flatMap((u) => u.outer))
    dc.text({ x: c.x, y: c.y + 1.2 }, 'Flat roof: waterproofing with 1:100 fall to rainwater outlets', { size: 0.24, color: INK, align: 'center', baseline: 'top' })
  } else {
    dc.layer('notes')
    const c = centerOf(foot.flatMap((u) => u.outer))
    dc.text(c, 'Flat roof', { size: 0.3, color: INK, align: 'center', baseline: 'middle' })
  }
  const b = bbox(foot.flatMap((u) => u.outer).concat(roof?.rooms.flatMap((r) => r.polygon) ?? []).concat(p.plot.polygon.slice(0, 0)))
  const m = 2
  return b.w ? { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m } : { x: 0, y: 0, w: p.plot.width, h: p.plot.depth }
}

function roofLabel(p: Project) {
  return p.exterior.roofType === 'shed' ? 'single slope' : p.exterior.roofType === 'hip' ? 'hipped on all sides' : p.exterior.roofType === 'gable' ? 'gable ends' : 'mansard'
}

const centerOf = (pts: Vec2[]) => {
  const b = bbox(pts.length ? pts : [{ x: 0, y: 0 }])
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

/* ── sheet composition ───────────────────────────────────────────────────── */

export const A3 = { w: 420, h: 297 }
const MARGIN = 10
const TB_W = 74
const SCALES = [50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000]

export interface SheetInfo {
  scale: number
}

/** Compose a full A3 sheet in paper millimetres onto `dc` (whose units are mm). */
export function drawSheet(dc: DrawContext, p: Project, d: DrawingSpec, index: number, total: number, o: { color?: boolean; strokeScale?: number } = {}): SheetInfo {
  const W = A3.w
  const H = A3.h
  dc.layer('sheet')
  dc.polygon([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], { color: '#ffffff' }, null)
  dc.polyline([{ x: MARGIN, y: MARGIN }, { x: W - MARGIN, y: MARGIN }, { x: W - MARGIN, y: H - MARGIN }, { x: MARGIN, y: H - MARGIN }], S(1.0), true)
  // drawing area
  const area = { x: MARGIN + 6, y: MARGIN + 6, w: W - 2 * MARGIN - TB_W - 12, h: H - 2 * MARGIN - 24 }
  // measure the drawing's extent with a throwaway pass
  const probe = new ExtentProbe()
  const ext = drawDrawing(probe, p, d, o)
  const scale = SCALES.find((n) => ext.w * (1000 / n) <= area.w && ext.h * (1000 / n) <= area.h) ?? SCALES[SCALES.length - 1]
  const s = 1000 / scale
  const ox = area.x + (area.w - ext.w * s) / 2 - ext.x * s
  const oy = area.y + (area.h - ext.h * s) / 2 - ext.y * s
  const t = new TransformContext(dc, s, ox, oy, o.strokeScale ?? 1)
  drawDrawing(t, p, d, o)
  // drawing title + scale bar
  const ty = H - MARGIN - 12
  dc.layer('title')
  dc.circle({ x: area.x + 5, y: ty }, 4.2, null, S(0.8))
  dc.line({ x: area.x + 0.8, y: ty }, { x: area.x + 9.2, y: ty }, S(0.5))
  dc.text({ x: area.x + 5, y: ty - 1.8 }, String(index + 1), { size: 2.0, color: INK, weight: 700, align: 'center', baseline: 'middle' })
  dc.text({ x: area.x + 5, y: ty + 2 }, d.number, { size: 1.3, color: INK, align: 'center', baseline: 'middle' })
  dc.text({ x: area.x + 12, y: ty - 1.2 }, d.title, { size: 3.4, color: INK, weight: 700, align: 'left', baseline: 'bottom' })
  dc.line({ x: area.x + 12, y: ty }, { x: area.x + 120, y: ty }, S(0.9))
  dc.text({ x: area.x + 12, y: ty + 1.5 }, `Scale 1:${scale} at A3`, { size: 2.0, color: INK, align: 'left', baseline: 'top' })
  scaleBar(dc, { x: area.x + 130, y: ty }, s, scale)
  titleBlock(dc, p, d, scale, index, total)
  return { scale }
}

function scaleBar(dc: DrawContext, at: Vec2, s: number, scale: number) {
  const step = scale <= 100 ? 1 : scale <= 250 ? 2 : 5
  const n = 5
  for (let i = 0; i < n; i++) dc.polygon([{ x: at.x + i * step * s, y: at.y - 1 }, { x: at.x + (i + 1) * step * s, y: at.y - 1 }, { x: at.x + (i + 1) * step * s, y: at.y + 0.6 }, { x: at.x + i * step * s, y: at.y + 0.6 }], { color: i % 2 ? '#ffffff' : INK }, S(0.3))
  for (let i = 0; i <= n; i++) dc.text({ x: at.x + i * step * s, y: at.y + 1.6 }, `${i * step}`, { size: 1.5, color: INK, align: 'center', baseline: 'top' })
  dc.text({ x: at.x + n * step * s + 3, y: at.y - 0.2 }, 'm', { size: 1.6, color: INK, align: 'left', baseline: 'middle' })
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) lines.push(cur)
      cur = w
    } else cur = (cur + ' ' + w).trim()
  }
  if (cur) lines.push(cur)
  return lines
}

function titleBlock(dc: DrawContext, p: Project, d: DrawingSpec, scale: number, index: number, total: number) {
  const x0 = A3.w - MARGIN - TB_W
  const y0 = MARGIN
  const x1 = A3.w - MARGIN
  const y1 = A3.h - MARGIN
  dc.layer('title-block')
  dc.line({ x: x0, y: y0 }, { x: x0, y: y1 }, S(1.0))
  const pad = 4
  let y = y0 + 8
  // brand
  dc.text({ x: x0 + pad, y }, 'HomeForge AI', { size: 3.6, color: INK, weight: 700, align: 'left', baseline: 'middle' })
  y += 5
  dc.text({ x: x0 + pad, y }, 'Conceptual house design', { size: 1.9, color: '#5f6872', align: 'left', baseline: 'middle' })
  y += 6
  dc.line({ x: x0, y }, { x: x1, y }, S(0.5))
  const row = (k: string, v: string) => {
    y += 5
    dc.text({ x: x0 + pad, y }, k, { size: 1.7, color: '#5f6872', align: 'left', baseline: 'middle' })
    y += 4.2
    for (const line of wrap(v, 34)) {
      dc.text({ x: x0 + pad, y }, line, { size: 2.4, color: INK, align: 'left', baseline: 'middle' })
      y += 3.6
    }
    y -= 1
  }
  const a = areaSummary(planHouse(p))
  row('Project', p.name)
  row('Plot', `${formatPlotSize(p.plot.width, p.plot.depth, p.settings.units)}, ${formatAreaFor(a.plotArea, p.settings.units)}`)
  row('Floor area', `${formatAreaFor(a.totalFloorArea, p.settings.units)} total, ${formatAreaFor(a.coveredArea, p.settings.units)} covered`)
  row('Drawing', d.title)
  row('Scale', `1:${scale} at A3`)
  row('Units', p.settings.units === 'm' || p.settings.units === 'cm' ? 'Metres' : 'Feet and inches')
  row('Date', new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))
  y += 3
  dc.line({ x: x0, y }, { x: x1, y }, S(0.5))
  // north arrow for plans
  if (d.kind !== 'elevation' && d.kind !== 'section') {
    const na = { x: x0 + TB_W / 2, y: y + 16 }
    drawNorthArrow(dc, na, 6, northAngle(p.plot), PRINT_PLAN)
    y += 30
    dc.line({ x: x0, y }, { x: x1, y }, S(0.5))
  }
  // legend for services drawings
  if (d.kind === 'electrical-plan' || d.kind === 'lighting-plan') {
    y += 5
    dc.text({ x: x0 + pad, y }, 'Legend', { size: 2.2, color: INK, weight: 700, align: 'left', baseline: 'middle' })
    const items: { kind: string; label: string }[] =
      d.kind === 'electrical-plan'
        ? [
            { kind: 'switch', label: 'Switch board' },
            { kind: 'socket', label: 'Socket outlet' },
            { kind: 'fan', label: 'Ceiling fan point' },
            { kind: 'ac', label: 'Air-conditioner point' },
            { kind: 'db', label: 'Distribution board' }
          ]
        : [
            { kind: 'downlight', label: 'Recessed downlight' },
            { kind: 'light', label: 'Ceiling light or pendant' },
            { kind: 'chandelier', label: 'Chandelier' },
            { kind: 'cove', label: 'Cove lighting' }
          ]
    for (const it of items) {
      y += 5.2
      const sym = new TransformContext(dc, 6.5, x0 + pad + 4, y)
      if (d.kind === 'electrical-plan') drawElectrical(sym, { kind: it.kind, p: { x: 0, y: 0 }, rot: -Math.PI / 2 }, PRINT_PLAN)
      else drawLight(sym, { kind: it.kind, p: { x: 0, y: 0 } }, PRINT_PLAN, false)
      dc.text({ x: x0 + pad + 11, y }, it.label, { size: 1.8, color: INK, align: 'left', baseline: 'middle' })
    }
    y += 4
    dc.line({ x: x0, y }, { x: x1, y }, S(0.5))
  }
  // disclaimer (bottom), sheet number
  const disc = wrap(DISCLAIMER, 44)
  let dy = y1 - 22 - disc.length * 2.8
  dc.line({ x: x0, y: dy - 4 }, { x: x1, y: dy - 4 }, S(0.5))
  for (const l of disc) {
    dc.text({ x: x0 + pad, y: dy }, l, { size: 1.55, color: '#5f6872', align: 'left', baseline: 'middle' })
    dy += 2.8
  }
  dc.line({ x: x0, y: y1 - 16 }, { x: x1, y: y1 - 16 }, S(0.5))
  dc.text({ x: x0 + pad, y: y1 - 11 }, 'Sheet', { size: 1.7, color: '#5f6872', align: 'left', baseline: 'middle' })
  dc.text({ x: x0 + pad, y: y1 - 5 }, d.number, { size: 4.2, color: INK, weight: 700, align: 'left', baseline: 'middle' })
  dc.text({ x: x1 - pad, y: y1 - 5 }, `${index + 1} of ${total}`, { size: 2.2, color: INK, align: 'right', baseline: 'middle' })
}

/** A DrawContext that only measures (used to find a drawing's extent before choosing its scale). */
export class ExtentProbe implements DrawContext {
  kind = 'svg' as const
  pxPerMeter = 100
  layer() {}
  polygon() {}
  polyline() {}
  line() {}
  circle() {}
  arc() {}
  text() {}
}

export function floorsForDrawings(p: Project): Floor[] {
  return sortedFloors(p.floors).filter((f) => f.kind !== 'roof' && f.rooms.length)
}

void formatLength
