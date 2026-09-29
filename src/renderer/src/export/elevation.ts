import type { Floor, HouseState, MaterialDef, UnitSystem, Vec2 } from '../core/model/types'
import type { DrawContext, Stroke } from '../render/draw/types'
import { hatch } from '../render/draw/types'
import { floorElevations, sortedFloors } from '../core/model/house'
import { wallFrames } from '../planner/wallGeometry'
import { spec } from '../core/constraints/rooms'
import { bbox, unionPolys } from '../core/geometry/polygon'
import { resolveMaterial, materialSwatch } from '../core/materials/library'
import { formatLength } from '../core/units/units'
import { stairGeometry } from '../planner/stairs'

/**
 * ELEVATIONS and SECTIONS (§32, §33), computed from the model — never a picture of the 3D view.
 * Drawing space: u = horizontal (m) as seen by the viewer, drawn y = −z so up is up.
 * Painter's algorithm: every face is projected with its distance from the viewer and drawn
 * far → near, so nearer walls, slabs and roofs hide what is behind them.
 */

export type ElevationSide = 'front' | 'rear' | 'left' | 'right'
export type SectionAxis = 'A' | 'B'

export interface ElevationOptions {
  units: UnitSystem
  materials: MaterialDef[]
  plinth: number
  /** Colour fills (presentation) vs. pure line drawing (construction). */
  color?: boolean
  labels?: boolean
}

interface Face {
  pts: Vec2[] // (u, −z)
  depth: number
  fill: string
  stroke: Stroke | null
  layer: string
  hatch?: boolean
  opacity?: number
}

const INK = '#1b1f24'
const S = (w: number, color = INK, extra: Partial<Stroke> = {}): Stroke => ({ color, width: w, ...extra })

function view(house: HouseState, side: ElevationSide) {
  const W = house.plot.width
  const D = house.plot.depth
  switch (side) {
    case 'front':
      return { u: (p: Vec2) => p.x, d: (p: Vec2) => D - p.y, span: W }
    case 'rear':
      return { u: (p: Vec2) => W - p.x, d: (p: Vec2) => p.y, span: W }
    case 'left':
      return { u: (p: Vec2) => p.y, d: (p: Vec2) => p.x, span: D }
    case 'right':
      return { u: (p: Vec2) => D - p.y, d: (p: Vec2) => W - p.x, span: D }
  }
}

const lighten = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function swatch(id: string | undefined, mats: MaterialDef[], fallback: string) {
  const m = resolveMaterial(id, mats)
  return m ? materialSwatch(m) : fallback
}

/** Faces of the pitched roof in 3D (x, y plan; z up), mirroring engine/builders/roof.ts. */
export function roofFaces(house: HouseState, plinth: number): { pts: { x: number; y: number; z: number }[]; kind: 'roof' | 'gable' }[] {
  const ext = house.exterior
  if (ext.roofType === 'flat') return []
  const floors = sortedFloors(house.floors).filter((f) => f.kind !== 'roof')
  const top = floors[floors.length - 1]
  if (!top) return []
  const base = (floorElevations(house.floors, plinth).get(top.id) ?? 0) + top.height
  const out: { pts: { x: number; y: number; z: number }[]; kind: 'roof' | 'gable' }[] = []
  const P = (x: number, y: number, z: number) => ({ x, y, z })
  for (const u of unionPolys(top.rooms.filter((r) => !spec(r.type).outdoor && r.type !== 'void').map((r) => r.polygon))) {
    const b = bbox(u.outer)
    const ov = 0.55
    const x0 = b.x - ov
    const x1 = b.x + b.w + ov
    const y0 = b.y - ov
    const y1 = b.y + b.h + ov
    const alongX = b.w >= b.h
    const span = alongX ? y1 - y0 : x1 - x0
    const rise = (span / 2) * (ext.roofType === 'shed' ? 0.25 : 0.55)
    const z = base
    if (ext.roofType === 'shed') {
      out.push({ pts: [P(x0, y0, z + rise * 2), P(x1, y0, z + rise * 2), P(x1, y1, z), P(x0, y1, z)], kind: 'roof' })
      out.push({ pts: [P(x0 + ov, y1 - ov, z), P(x0 + ov, y0 + ov, z + rise * 2), P(x0 + ov, y0 + ov, z)], kind: 'gable' })
      out.push({ pts: [P(x1 - ov, y0 + ov, z), P(x1 - ov, y0 + ov, z + rise * 2), P(x1 - ov, y1 - ov, z)], kind: 'gable' })
      continue
    }
    if (ext.roofType === 'hip') {
      const inset = Math.min(x1 - x0, y1 - y0) / 2
      if (alongX) {
        const ym = (y0 + y1) / 2
        out.push({ pts: [P(x0, y0, z), P(x1, y0, z), P(x1 - inset, ym, z + rise), P(x0 + inset, ym, z + rise)], kind: 'roof' })
        out.push({ pts: [P(x1, y1, z), P(x0, y1, z), P(x0 + inset, ym, z + rise), P(x1 - inset, ym, z + rise)], kind: 'roof' })
        out.push({ pts: [P(x0, y1, z), P(x0, y0, z), P(x0 + inset, ym, z + rise)], kind: 'roof' })
        out.push({ pts: [P(x1, y0, z), P(x1, y1, z), P(x1 - inset, ym, z + rise)], kind: 'roof' })
      } else {
        const xm = (x0 + x1) / 2
        out.push({ pts: [P(x0, y1, z), P(x0, y0, z), P(xm, y0 + inset, z + rise), P(xm, y1 - inset, z + rise)], kind: 'roof' })
        out.push({ pts: [P(x1, y0, z), P(x1, y1, z), P(xm, y1 - inset, z + rise), P(xm, y0 + inset, z + rise)], kind: 'roof' })
        out.push({ pts: [P(x0, y0, z), P(x1, y0, z), P(xm, y0 + inset, z + rise)], kind: 'roof' })
        out.push({ pts: [P(x1, y1, z), P(x0, y1, z), P(xm, y1 - inset, z + rise)], kind: 'roof' })
      }
      continue
    }
    // gable / mansard (mansard drawn with its lower steep band)
    const k = ext.roofType === 'mansard' ? 1.3 : 1
    if (alongX) {
      const ym = (y0 + y1) / 2
      out.push({ pts: [P(x0, y0, z), P(x1, y0, z), P(x1, ym, z + rise * k), P(x0, ym, z + rise * k)], kind: 'roof' })
      out.push({ pts: [P(x1, y1, z), P(x0, y1, z), P(x0, ym, z + rise * k), P(x1, ym, z + rise * k)], kind: 'roof' })
      out.push({ pts: [P(x0 + ov, y1 - ov, z), P(x0 + ov, ym, z + rise * k), P(x0 + ov, y0 + ov, z)], kind: 'gable' })
      out.push({ pts: [P(x1 - ov, y0 + ov, z), P(x1 - ov, ym, z + rise * k), P(x1 - ov, y1 - ov, z)], kind: 'gable' })
    } else {
      const xm = (x0 + x1) / 2
      out.push({ pts: [P(x0, y1, z), P(x0, y0, z), P(xm, y0, z + rise * k), P(xm, y1, z + rise * k)], kind: 'roof' })
      out.push({ pts: [P(x1, y0, z), P(x1, y1, z), P(xm, y1, z + rise * k), P(xm, y0, z + rise * k)], kind: 'roof' })
      out.push({ pts: [P(x0 + ov, y0 + ov, z), P(xm, y0 + ov, z + rise * k), P(x1 - ov, y0 + ov, z)], kind: 'gable' })
      out.push({ pts: [P(x1 - ov, y1 - ov, z), P(xm, y1 - ov, z + rise * k), P(x0 + ov, y1 - ov, z)], kind: 'gable' })
    }
  }
  return out
}

interface Built {
  faces: Face[]
  width: number
  height: number
  levels: { name: string; z: number }[]
  uMin: number
  uMax: number
}

/** Collect every visible face for an elevation (or, with `cut`, a section beyond the cut line). */
function collect(house: HouseState, side: ElevationSide, o: ElevationOptions, cut?: { at: number }): Built {
  const V = view(house, side)
  const el = floorElevations(house.floors, o.plinth)
  const floors = sortedFloors(house.floors).filter((f) => f.level >= 0)
  const ext = house.exterior
  const color = o.color !== false
  const facade = color ? lighten(swatch(ext.facadeMaterial, o.materials, '#e9e5dc'), 0.15) : '#ffffff'
  const accent = color ? lighten(swatch(ext.accentMaterial, o.materials, '#9c8f7f'), 0.05) : '#ffffff'
  const plinthC = color ? swatch(ext.plinthMaterial, o.materials, '#6b6b6b') : '#ffffff'
  const roofC = color ? swatch(ext.roofMaterial, o.materials, '#6b6b6b') : '#ffffff'
  const glass = color ? '#a9c6d6' : '#ffffff'
  const frame = color ? swatch(ext.windowFrameMaterial, o.materials, '#2b2b2b') : INK
  const faces: Face[] = []
  const inView = (d: number) => !cut || d >= cut.at - 0.02
  let uMin = Infinity
  let uMax = -Infinity
  let zTop = 0
  const levels: { name: string; z: number }[] = []
  const push = (f: Face) => {
    faces.push(f)
    for (const p of f.pts) {
      uMin = Math.min(uMin, p.x)
      uMax = Math.max(uMax, p.x)
      zTop = Math.max(zTop, -p.y)
    }
  }
  const rect = (u0: number, u1: number, z0: number, z1: number): Vec2[] => [
    { x: Math.min(u0, u1), y: -z0 },
    { x: Math.max(u0, u1), y: -z0 },
    { x: Math.max(u0, u1), y: -z1 },
    { x: Math.min(u0, u1), y: -z1 }
  ]

  for (const f of floors) {
    const z = el.get(f.id) ?? 0
    if (f.kind !== 'roof') levels.push({ name: `${f.name} floor`, z })
    const exteriorish = (k: string) => k === 'exterior' || k === 'parapet' || k === 'railing'
    for (const fr of wallFrames(f)) {
      if (!cut && !exteriorish(fr.kind)) continue
      const w = fr.wall
      const a = { x: w.a.x - fr.dir.x * fr.extA, y: w.a.y - fr.dir.y * fr.extA }
      const b = { x: w.b.x + fr.dir.x * fr.extB, y: w.b.y + fr.dir.y * fr.extB }
      const ua = V.u(a)
      const ub = V.u(b)
      if (Math.abs(ub - ua) < 0.03) continue
      const d = Math.min(V.d(a), V.d(b))
      if (!inView(d)) continue
      const railing = fr.kind === 'railing'
      const isAccent = ext.accent !== 'none' && fr.kind === 'exterior' && f.kind !== 'roof' && accentWall(house, f, w.id)
      push({
        pts: rect(ua, ub, z, z + fr.height),
        depth: (V.d(a) + V.d(b)) / 2,
        fill: railing ? glass : isAccent ? accent : facade,
        opacity: railing ? 0.45 : 1,
        stroke: S(railing ? 0.35 : 0.5),
        layer: railing ? 'railings' : 'walls',
        hatch: isAccent && color
      })
      // openings on this wall, drawn just in front of it
      for (const op of f.openings.filter((x) => x.wallId === w.id)) {
        const t0 = op.offset - op.width / 2
        const t1 = op.offset + op.width / 2
        const p0 = { x: w.a.x + fr.dir.x * t0, y: w.a.y + fr.dir.y * t0 }
        const p1 = { x: w.a.x + fr.dir.x * t1, y: w.a.y + fr.dir.y * t1 }
        const u0 = V.u(p0)
        const u1 = V.u(p1)
        const dd = (V.d(p0) + V.d(p1)) / 2 - 0.001
        const zb = z + op.sill
        const zt = zb + op.height
        const door = op.kind === 'door'
        const garage = op.style === 'garage'
        push({ pts: rect(u0, u1, zb, zt), depth: dd, fill: door ? (garage ? (color ? '#b9bcbf' : '#ffffff') : color ? '#7b5a3e' : '#ffffff') : glass, stroke: S(0.6, frame), layer: door ? 'doors' : 'windows' })
        // mullions / garage slats / door panel line
        const n = door ? (garage ? 6 : op.style === 'double' || op.style === 'french' || op.style === 'main' ? 2 : 1) : Math.max(1, Math.round(op.width / 0.75))
        if (garage) for (let i = 1; i < n; i++) push({ pts: [{ x: Math.min(u0, u1), y: -(zb + (op.height * i) / n) }, { x: Math.max(u0, u1), y: -(zb + (op.height * i) / n) }], depth: dd - 0.0005, fill: 'none', stroke: S(0.3, frame), layer: 'doors' })
        else
          for (let i = 1; i < n; i++) {
            const u = u0 + ((u1 - u0) * i) / n
            push({ pts: [{ x: u, y: -zb }, { x: u, y: -zt }], depth: dd - 0.0005, fill: 'none', stroke: S(door ? 0.4 : 0.45, frame), layer: door ? 'doors' : 'windows' })
          }
        if (!door && op.style !== 'full-height' && op.sill > 0.2)
          push({ pts: rect(u0 - 0.04, u1 + 0.04, zb - 0.05, zb), depth: dd - 0.0006, fill: color ? '#d7d2c8' : '#ffffff', stroke: S(0.35), layer: 'windows' })
      }
    }
    // floor slab bands and the plinth
    const solid = f.rooms.filter((r) => r.type !== 'void' && !r.openToSky && !(f.level === 0 && spec(r.type).outdoor && r.type !== 'garage'))
    for (const u of unionPolys(solid.map((r) => r.polygon))) {
      const us = u.outer.map(V.u)
      const ds = u.outer.map(V.d)
      const d = Math.min(...ds)
      if (!inView(d)) continue
      if (f.level === 0) push({ pts: rect(Math.min(...us), Math.max(...us), 0, z), depth: d - 0.002, fill: plinthC, stroke: S(0.5), layer: 'plinth' })
      else push({ pts: rect(Math.min(...us), Math.max(...us), z - f.slabThickness, z), depth: d - 0.002, fill: color ? lighten(facade, 0.2) : '#ffffff', stroke: S(0.5), layer: 'slabs' })
    }
    // exposed columns (porches, car porch)
    for (const c of f.columns.filter((x) => x.exposed)) {
      const u = V.u(c.position)
      const d = V.d(c.position)
      if (!inView(d)) continue
      push({ pts: rect(u - c.width / 2, u + c.width / 2, z, z + f.height - f.slabThickness), depth: d - 0.003, fill: color ? lighten(swatch(c.material ?? ext.accentMaterial, o.materials, '#b8b2a6'), 0.1) : '#ffffff', stroke: S(0.5), layer: 'columns' })
    }
    // stairs (sections only)
    if (cut)
      for (const s of f.stairs) {
        const g = stairGeometry(s, f.height)
        const riser = f.height / s.risers
        for (const t of g.treads) {
          const us = t.poly.map(V.u)
          const d = Math.min(...t.poly.map(V.d))
          if (!inView(d)) continue
          push({ pts: rect(Math.min(...us), Math.max(...us), z + t.z - riser, z + t.z), depth: d, fill: color ? '#d9d4ca' : '#ffffff', stroke: S(0.4), layer: 'stairs' })
        }
      }
    zTop = Math.max(zTop, z + f.height)
  }
  // top slab of the highest floor (roof slab) when there is no roof floor above
  const tops = floors.filter((f) => f.kind !== 'roof')
  const top = tops[tops.length - 1]
  if (top && !floors.some((f) => f.kind === 'roof') && ext.roofType === 'flat') {
    const z = (el.get(top.id) ?? 0) + top.height
    for (const u of unionPolys(top.rooms.filter((r) => r.type !== 'void' && !spec(r.type).outdoor).map((r) => r.polygon))) {
      const us = u.outer.map(V.u)
      push({ pts: rect(Math.min(...us), Math.max(...us), z - top.slabThickness, z + 0.1), depth: Math.min(...u.outer.map(V.d)) - 0.002, fill: color ? lighten(facade, 0.2) : '#ffffff', stroke: S(0.5), layer: 'slabs' })
    }
  }
  // pitched roof
  for (const rf of roofFaces(house, o.plinth)) {
    const pts = rf.pts.map((p) => ({ x: V.u(p), y: -p.z }))
    const us = pts.map((p) => p.x)
    if (Math.max(...us) - Math.min(...us) < 0.02) continue
    const d = rf.pts.reduce((s, p) => s + V.d(p), 0) / rf.pts.length
    if (!inView(Math.min(...rf.pts.map(V.d)))) continue
    push({ pts, depth: d, fill: rf.kind === 'roof' ? roofC : facade, stroke: S(0.5), layer: 'roof' })
  }
  if (!isFinite(uMin)) {
    uMin = 0
    uMax = V.span
  }
  return { faces, width: uMax - uMin, height: zTop, levels, uMin, uMax }
}

function accentWall(house: HouseState, f: Floor, wallId: string): boolean {
  const ext = house.exterior
  const w = f.walls.find((x) => x.id === wallId)
  if (!w) return false
  const D = house.plot.depth
  const facesFront = Math.abs(w.a.y - w.b.y) < 0.05 && Math.max(w.a.y, w.b.y) > D * 0.45
  const inside = f.rooms.find((r) => {
    const b = bbox(r.polygon)
    const m = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }
    return m.x >= b.x - 0.2 && m.x <= b.x + b.w + 0.2 && m.y >= b.y - 0.2 && m.y <= b.y + b.h + 0.2
  })
  switch (ext.accent) {
    case 'ground-floor':
      return f.level === 0
    case 'stair-tower':
      return inside?.type === 'stair' || inside?.type === 'mumty'
    case 'entrance':
      return facesFront && f.level === 0 && (inside?.type === 'foyer' || inside?.type === 'drawing')
    case 'front-feature':
      return facesFront && f.level >= 1
    default:
      return false
  }
}

export interface DrawnExtent {
  x: number
  y: number
  w: number
  h: number
}

function drawFaces(dc: DrawContext, faces: Face[]) {
  faces.sort((a, b) => b.depth - a.depth)
  for (const f of faces) {
    dc.layer(f.layer)
    if (f.pts.length === 2) {
      if (f.stroke) dc.line(f.pts[0], f.pts[1], f.stroke)
      continue
    }
    dc.polygon(f.pts, f.fill === 'none' ? null : { color: f.fill, opacity: f.opacity }, f.stroke)
    if (f.hatch) hatch(dc, f.pts, 0.22, 0, S(0.2, INK, { opacity: 0.35 }))
  }
}

function levelMarks(dc: DrawContext, b: Built, units: UnitSystem, x: number) {
  dc.layer('levels')
  const marks = [{ name: 'Ground level', z: 0 }, ...b.levels, { name: 'Top', z: b.height }]
  let lastLabel = Infinity
  for (const m of [...marks].sort((a, c) => a.z - c.z)) {
    const y = -m.z
    dc.line({ x: x - 0.2, y }, { x: x + 1.4, y }, S(0.35, INK, { dash: [3, 2] }))
    dc.polygon([{ x, y }, { x: x - 0.18, y: y - 0.24 }, { x: x + 0.18, y: y - 0.24 }], { color: INK }, null)
    // keep labels of close levels (plinth / ground) from overlapping
    const ly = Math.min(y - 0.1, lastLabel - 0.34)
    lastLabel = ly
    dc.text({ x: x + 0.3, y: ly }, `${m.name}  +${formatLength(m.z, units)}`, { size: 0.19, color: INK, align: 'left', baseline: 'bottom', condensed: true })
  }
}

function heightDim(dc: DrawContext, b: Built, units: UnitSystem, x: number) {
  dc.layer('dimensions')
  const st = S(0.4)
  dc.line({ x, y: 0 }, { x, y: -b.height }, st)
  for (const z of [0, b.height]) dc.line({ x: x - 0.15, y: -z + 0.15 }, { x: x + 0.15, y: -z - 0.15 }, S(0.7))
  dc.text({ x: x - 0.2, y: -b.height / 2 }, formatLength(b.height, units), { size: 0.26, color: INK, rotation: -Math.PI / 2, baseline: 'bottom', condensed: true })
}

/** Draws an elevation; returns the drawn extent in drawing coordinates (u, −z). */
export function drawElevation(dc: DrawContext, house: HouseState, side: ElevationSide, o: ElevationOptions): DrawnExtent {
  const b = collect(house, side, o)
  const pad = 1.2
  // ground
  dc.layer('ground')
  dc.polygon([{ x: b.uMin - pad, y: 0 }, { x: b.uMax + pad, y: 0 }, { x: b.uMax + pad, y: 0.35 }, { x: b.uMin - pad, y: 0.35 }], { color: o.color !== false ? '#e8e4dc' : '#ffffff' }, null)
  hatch(dc, [{ x: b.uMin - pad, y: 0 }, { x: b.uMax + pad, y: 0 }, { x: b.uMax + pad, y: 0.35 }, { x: b.uMin - pad, y: 0.35 }], 0.18, Math.PI / 4, S(0.25, INK, { opacity: 0.5 }))
  drawFaces(dc, b.faces)
  dc.layer('ground')
  dc.line({ x: b.uMin - pad, y: 0 }, { x: b.uMax + pad, y: 0 }, S(1.4))
  if (o.labels !== false) {
    levelMarks(dc, b, o.units, b.uMax + pad + 0.3)
    heightDim(dc, b, o.units, b.uMin - pad - 0.4)
  }
  return { x: b.uMin - pad - 1.2, y: -b.height - 0.8, w: b.width + 2 * pad + 5.2, h: b.height + 1.4 }
}

/**
 * Section A (cut across the plot at mid-depth, looking at the rear) or B (cut along the plot at
 * mid-width, looking left). Cut walls and slabs are poché; everything beyond is in elevation.
 */
export function drawSection(dc: DrawContext, house: HouseState, axis: SectionAxis, o: ElevationOptions): DrawnExtent {
  const ground = house.floors.find((f) => f.level === 0)
  const gb = bbox((ground?.rooms.filter((r) => !spec(r.type).outdoor).flatMap((r) => r.polygon) ?? house.plot.polygon).concat())
  const side: ElevationSide = axis === 'A' ? 'front' : 'left'
  const V = view(house, side)
  // cut plane in view depth
  const cutPt = axis === 'A' ? { x: 0, y: gb.y + gb.h * 0.45 } : { x: gb.x + gb.w * 0.5, y: 0 }
  const cutD = V.d(cutPt)
  const b = collect(house, side, { ...o, color: o.color }, { at: cutD })
  const pad = 1.2
  const el = floorElevations(house.floors, o.plinth)
  dc.layer('ground')
  dc.polygon([{ x: b.uMin - pad, y: 0 }, { x: b.uMax + pad, y: 0 }, { x: b.uMax + pad, y: 0.6 }, { x: b.uMin - pad, y: 0.6 }], { color: '#e8e4dc' }, null)
  drawFaces(dc, b.faces)
  // cut elements
  dc.layer('cut')
  const poche = { color: '#2a2e33' }
  const cutLine = axis === 'A' ? { a: { x: -1, y: cutPt.y }, b: { x: house.plot.width + 1, y: cutPt.y } } : { a: { x: cutPt.x, y: -1 }, b: { x: cutPt.x, y: house.plot.depth + 1 } }
  const onCut = (p: Vec2) => (axis === 'A' ? p.x : p.y)
  for (const f of sortedFloors(house.floors).filter((x) => x.level >= 0)) {
    const z = el.get(f.id) ?? 0
    for (const fr of wallFrames(f)) {
      const w = fr.wall
      const along = axis === 'A' ? Math.abs(w.a.y - w.b.y) > 0.05 : Math.abs(w.a.x - w.b.x) > 0.05
      if (!along) continue
      const t = axis === 'A' ? (cutPt.y - w.a.y) / (w.b.y - w.a.y) : (cutPt.x - w.a.x) / (w.b.x - w.a.x)
      if (t < 0 || t > 1) continue
      const p = { x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t }
      const u = V.u(p)
      const h = fr.height
      const op = f.openings.find((x) => x.wallId === w.id && Math.abs(x.offset - t * fr.L) < x.width / 2)
      const half = w.thickness / 2
      if (op) {
        // wall above and below the opening is cut; the opening shows as a gap
        if (op.sill > 0.01) dc.polygon(rectZ(u - half, u + half, z, z + op.sill), poche, S(0.8))
        dc.polygon(rectZ(u - half, u + half, z + op.sill + op.height, z + h), poche, S(0.8))
        if (op.kind === 'window') dc.line({ x: u, y: -(z + op.sill) }, { x: u, y: -(z + op.sill + op.height) }, S(0.6, '#4b8db3'))
      } else dc.polygon(rectZ(u - half, u + half, z, z + h), poche, S(0.8))
    }
    // stairs cut by the plane: stepped profile in poché
    for (const st of f.stairs) {
      const g = stairGeometry(st, f.height)
      const riser = f.height / st.risers
      for (const t of g.treads) {
        const along = t.poly.map((q) => (axis === 'A' ? q.y : q.x))
        const cutAt = axis === 'A' ? cutPt.y : cutPt.x
        if (!(Math.min(...along) < cutAt && Math.max(...along) > cutAt)) continue
        const us = t.poly.map(V.u)
        const bottom = t.kind === 'landing' ? t.z - 0.16 : Math.max(0, t.z - riser - 0.12)
        dc.polygon(rectZ(Math.min(...us), Math.max(...us), z + bottom, z + t.z), poche, S(0.6))
      }
    }
    // cut slab
    const slabTop = z
    const solid = f.rooms.filter((r) => r.type !== 'void' && !r.openToSky)
    for (const u of unionPolys(solid.map((r) => r.polygon))) {
      const xs = cutSpans(u.outer, cutLine, onCut)
      for (const [s0, s1] of xs) {
        const u0 = V.u(axis === 'A' ? { x: s0, y: cutPt.y } : { x: cutPt.x, y: s0 })
        const u1 = V.u(axis === 'A' ? { x: s1, y: cutPt.y } : { x: cutPt.x, y: s1 })
        const lo = f.level === 0 ? 0 : slabTop - f.slabThickness
        dc.polygon(rectZ(Math.min(u0, u1), Math.max(u0, u1), lo, slabTop), f.level === 0 ? { color: '#6d7074' } : poche, S(0.8))
      }
    }
  }
  const top = sortedFloors(house.floors).filter((f) => f.kind !== 'roof' && f.level >= 0).pop()
  if (top && !house.floors.some((f) => f.kind === 'roof') && house.exterior.roofType === 'flat') {
    const z = (el.get(top.id) ?? 0) + top.height
    for (const u of unionPolys(top.rooms.filter((r) => r.type !== 'void' && !spec(r.type).outdoor).map((r) => r.polygon)))
      for (const [s0, s1] of cutSpans(u.outer, cutLine, onCut)) {
        const u0 = V.u(axis === 'A' ? { x: s0, y: cutPt.y } : { x: cutPt.x, y: s0 })
        const u1 = V.u(axis === 'A' ? { x: s1, y: cutPt.y } : { x: cutPt.x, y: s1 })
        dc.polygon(rectZ(Math.min(u0, u1), Math.max(u0, u1), z - top.slabThickness, z), poche, S(0.8))
      }
  }
  dc.layer('ground')
  dc.line({ x: b.uMin - pad, y: 0 }, { x: b.uMax + pad, y: 0 }, S(1.4))
  if (o.labels !== false) {
    levelMarks(dc, b, o.units, b.uMax + pad + 0.3)
    heightDim(dc, b, o.units, b.uMin - pad - 0.4)
  }
  return { x: b.uMin - pad - 1.2, y: -b.height - 0.8, w: b.width + 2 * pad + 5.2, h: b.height + 1.6 }
}

const rectZ = (u0: number, u1: number, z0: number, z1: number): Vec2[] => [
  { x: u0, y: -z0 },
  { x: u1, y: -z0 },
  { x: u1, y: -z1 },
  { x: u0, y: -z1 }
]

/** Parameter spans where a straight cut line runs inside a polygon. */
function cutSpans(poly: Vec2[], line: { a: Vec2; b: Vec2 }, param: (p: Vec2) => number): [number, number][] {
  const hits: number[] = []
  const horiz = Math.abs(line.a.y - line.b.y) < 1e-9
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (horiz) {
      const y = line.a.y
      if (a.y > y !== b.y > y) hits.push(param({ x: a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y), y }))
    } else {
      const x = line.a.x
      if (a.x > x !== b.x > x) hits.push(param({ x, y: a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x) }))
    }
  }
  hits.sort((m, n) => m - n)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < hits.length; i += 2) out.push([hits[i], hits[i + 1]])
  return out
}

/** Where section cuts run in plan (for the section marks on the floor plan sheet). */
export function sectionLines(house: HouseState): { axis: SectionAxis; a: Vec2; b: Vec2 }[] {
  const ground = house.floors.find((f) => f.level === 0)
  const gb = bbox(ground?.rooms.filter((r) => !spec(r.type).outdoor).flatMap((r) => r.polygon) ?? house.plot.polygon)
  const y = gb.y + gb.h * 0.45
  const x = gb.x + gb.w * 0.5
  return [
    { axis: 'A', a: { x: gb.x - 1.5, y }, b: { x: gb.x + gb.w + 1.5, y } },
    { axis: 'B', a: { x, y: gb.y - 1.5 }, b: { x, y: gb.y + gb.h + 1.5 } }
  ]
}
