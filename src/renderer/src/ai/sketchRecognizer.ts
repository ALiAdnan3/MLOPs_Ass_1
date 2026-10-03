import type { Floor, Opening, Plot, ProjectSettings, Room, RoomType, Vec2 } from '../core/model/types'
import { findFaces, type Seg } from '../core/geometry/planar'
import { area, bbox, centroid, pointInPolygon, removeCollinear, largestInscribedRect, unionPolys, differencePolys } from '../core/geometry/polygon'
import { projectT, distToSegment, segLength } from '../core/geometry/segment'
import { ROOM_SPECS, spec } from '../core/constraints/rooms'
import { uid } from '../core/model/ids'
import { refreshFloor } from '../planner/operations'
import { furnishFloor, furnishRoom } from '../planner/furnish'
import { addDoor, sharedWalls } from '../planner/generator/openings'
import { addWindowToRoom } from '../planner/openingsEdit'
import { repairAccess } from '../planner/access'
import { effectiveKind } from '../planner/walls'
import { fitStair, risersFor } from '../planner/stairs'
import { FT } from '../core/units/units'

/**
 * SKETCH & IMAGE RECOGNITION (§19–§21). Freehand strokes or a plan image become clean geometry:
 *   strokes/pixels → line segments → axis snapping → collinear merging → corner closing →
 *   door gaps / door arcs / window marks → closed faces (rooms) → labels, dimensions, types →
 *   editable floor (walls rebuilt from rooms, openings re-hosted, stairs fitted, furnished).
 * Everything is in plan metres. Low-confidence room types are flagged so the UI can ask.
 */

export interface InkStroke {
  pts: Vec2[]
}
export interface TextMark {
  p: Vec2
  text: string
}

export interface RecognizedRoom {
  id: string
  polygon: Vec2[]
  type: RoomType
  name: string
  confidence: number
  reason: string
  label?: string
}
export interface RecognizedOpening {
  kind: 'door' | 'window'
  at: Vec2
  width: number
  horizontal: boolean
}
export interface RecognizedPlan {
  walls: Seg[]
  rooms: RecognizedRoom[]
  openings: RecognizedOpening[]
  /** Metres per sketch unit applied from dimension labels (1 = drawn to scale). */
  scale: number
  notes: string[]
}

/* ── strokes → raw segments ──────────────────────────────────────────────── */

function rdp(pts: Vec2[], eps: number): Vec2[] {
  if (pts.length < 3) return pts
  let idx = -1
  let dmax = 0
  const a = pts[0]
  const b = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], a, b)
    if (d > dmax) {
      dmax = d
      idx = i
    }
  }
  if (dmax <= eps) return [a, b]
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)]
}

interface Arc {
  center: Vec2
  radius: number
  mid: Vec2
}

/** Split strokes into straight pieces; strokes that bend smoothly through ~90° are door swings. */
export function vectorizeStrokes(strokes: InkStroke[], eps = 0.12): { segs: Seg[]; arcs: Arc[] } {
  const segs: Seg[] = []
  const arcs: Arc[] = []
  for (const s of strokes) {
    if (s.pts.length < 2) continue
    const simp = rdp(s.pts, eps)
    // arc test: many small same-direction turns adding up to 60–130°
    if (simp.length >= 4 && s.pts.length >= 8) {
      let turn = 0
      let sameSign = true
      let sign = 0
      for (let i = 1; i < simp.length - 1; i++) {
        const d1 = Math.atan2(simp[i].y - simp[i - 1].y, simp[i].x - simp[i - 1].x)
        const d2 = Math.atan2(simp[i + 1].y - simp[i].y, simp[i + 1].x - simp[i].x)
        let da = d2 - d1
        while (da > Math.PI) da -= 2 * Math.PI
        while (da < -Math.PI) da += 2 * Math.PI
        if (sign && Math.sign(da) !== sign && Math.abs(da) > 0.1) sameSign = false
        if (!sign && Math.abs(da) > 0.05) sign = Math.sign(da)
        turn += da
      }
      const chord = segLength(simp[0], simp[simp.length - 1])
      const deg = Math.abs(turn) * (180 / Math.PI)
      if (sameSign && deg > 55 && deg < 135 && chord > 0.4 && chord < 2.6) {
        // quarter circle: hinge is the corner of the right triangle on the concave side
        const p0 = s.pts[0]
        const p1 = s.pts[s.pts.length - 1]
        const m = s.pts[Math.floor(s.pts.length / 2)]
        const cands = [
          { x: p0.x, y: p1.y },
          { x: p1.x, y: p0.y }
        ]
        const center = cands.sort((c1, c2) => segLength(c2, m) - segLength(c1, m))[0]
        arcs.push({ center, radius: (segLength(center, p0) + segLength(center, p1)) / 2, mid: m })
        continue
      }
    }
    for (let i = 0; i < simp.length - 1; i++) if (segLength(simp[i], simp[i + 1]) > eps * 1.5) segs.push({ a: simp[i], b: simp[i + 1] })
  }
  return { segs, arcs }
}

/* ── image → raw segments (§21) ──────────────────────────────────────────── */

export interface ImageSegments {
  segs: Seg[]
  thin: Seg[]
  width: number
  height: number
  wallPx: number
}

function otsu(gray: Uint8Array): number {
  const hist = new Array(256).fill(0)
  for (const g of gray) hist[g]++
  const total = gray.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let th = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const v = wB * wF * (mB - mF) ** 2
    if (v > best) {
      best = v
      th = t
    }
  }
  return th
}

/** Axis-aligned line bands in a plan drawing (walls are the long, thick ones). */
export function segmentsFromImage(img: ImageData): ImageSegments {
  const { width: W, height: H, data } = img
  const gray = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) gray[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) | 0
  const th = Math.min(170, otsu(gray))
  const dark = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) dark[i] = gray[i] < th ? 1 : 0
  const minRun = Math.max(12, Math.round(Math.min(W, H) * 0.035))
  type Band = { c0: number; c1: number; lo: number; hi: number; horiz: boolean }
  const scan = (horiz: boolean): Band[] => {
    const lines = horiz ? H : W
    const len = horiz ? W : H
    const at = (line: number, k: number) => (horiz ? dark[line * W + k] : dark[k * W + line])
    // runs per line
    const runs: [number, number][][] = []
    for (let l = 0; l < lines; l++) {
      const r: [number, number][] = []
      let s = -1
      let gap = 0
      for (let k = 0; k <= len; k++) {
        const v = k < len ? at(l, k) : 0
        if (v) {
          if (s < 0) s = k
          gap = 0
        } else if (s >= 0) {
          gap++
          if (gap > 2 || k === len) {
            const e = k - gap
            if (e - s + 1 >= minRun) r.push([s, e])
            s = -1
            gap = 0
          }
        }
      }
      runs.push(r)
    }
    // stack overlapping runs of consecutive lines into bands
    const out: Band[] = []
    const open: Band[] = []
    for (let l = 0; l < lines; l++) {
      const next: Band[] = []
      for (const [a, b] of runs[l]) {
        const hit = open.find((o) => o.hi === l - 1 && Math.min(o.c1, b) - Math.max(o.c0, a) > 0.6 * Math.min(o.c1 - o.c0, b - a))
        if (hit) {
          hit.hi = l
          hit.c0 = Math.min(hit.c0, a)
          hit.c1 = Math.max(hit.c1, b)
          next.push(hit)
        } else next.push({ c0: a, c1: b, lo: l, hi: l, horiz })
      }
      for (const o of open) if (!next.includes(o)) out.push(o)
      open.length = 0
      open.push(...next)
    }
    out.push(...open)
    return out.filter((b) => b.hi - b.lo + 1 <= Math.max(6, Math.min(W, H) * 0.04))
  }
  const bands = [...scan(true), ...scan(false)]
  // dominant wall thickness (length-weighted)
  const hist = new Map<number, number>()
  for (const b of bands) hist.set(b.hi - b.lo + 1, (hist.get(b.hi - b.lo + 1) ?? 0) + (b.c1 - b.c0))
  const wallPx = [...hist.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 2
  const toSeg = (b: Band): Seg => {
    const c = (b.lo + b.hi) / 2
    return b.horiz ? { a: { x: b.c0, y: c }, b: { x: b.c1, y: c } } : { a: { x: c, y: b.c0 }, b: { x: c, y: b.c1 } }
  }
  const thick = bands.filter((b) => b.hi - b.lo + 1 >= Math.max(2, wallPx * 0.6))
  const thin = bands.filter((b) => b.hi - b.lo + 1 < Math.max(2, wallPx * 0.6))
  return { segs: thick.map(toSeg), thin: thin.map(toSeg), width: W, height: H, wallPx }
}

/* ── clean-up: snap, merge, close corners, find gaps ─────────────────────── */

interface Line {
  horiz: boolean
  c: number
  s0: number
  s1: number
  w: number
}

function toLines(segs: Seg[], angTol = 0.26): { lines: Line[]; other: Seg[] } {
  const lines: Line[] = []
  const other: Seg[] = []
  for (const s of segs) {
    const dx = s.b.x - s.a.x
    const dy = s.b.y - s.a.y
    const L = Math.hypot(dx, dy)
    const ang = Math.abs(Math.atan2(dy, dx))
    if (ang < angTol || ang > Math.PI - angTol) lines.push({ horiz: true, c: (s.a.y + s.b.y) / 2, s0: Math.min(s.a.x, s.b.x), s1: Math.max(s.a.x, s.b.x), w: L })
    else if (Math.abs(ang - Math.PI / 2) < angTol) lines.push({ horiz: false, c: (s.a.x + s.b.x) / 2, s0: Math.min(s.a.y, s.b.y), s1: Math.max(s.a.y, s.b.y), w: L })
    else if (L > 0.9) other.push(s)
  }
  return { lines, other }
}

/** Merge near-collinear lines; returns merged lines and the door gaps found between pieces. */
function mergeLines(lines: Line[], tol: number, gapMin: number, gapMax: number): { lines: Line[]; gaps: { horiz: boolean; c: number; s0: number; s1: number }[] } {
  const out: Line[] = []
  const gaps: { horiz: boolean; c: number; s0: number; s1: number }[] = []
  for (const horiz of [true, false]) {
    const ls = lines.filter((l) => l.horiz === horiz).sort((a, b) => a.c - b.c)
    // cluster by coordinate
    const clusters: Line[][] = []
    for (const l of ls) {
      const last = clusters[clusters.length - 1]
      const mean = last ? last.reduce((s, x) => s + x.c * x.w, 0) / last.reduce((s, x) => s + x.w, 0) : 0
      if (last && Math.abs(l.c - mean) <= tol) last.push(l)
      else clusters.push([l])
    }
    for (const cl of clusters) {
      const c = cl.reduce((s, x) => s + x.c * x.w, 0) / cl.reduce((s, x) => s + x.w, 0)
      const iv = cl.map((x) => [x.s0, x.s1] as [number, number]).sort((a, b) => a[0] - b[0])
      let cur = [...iv[0]] as [number, number]
      const flush = () => out.push({ horiz, c, s0: cur[0], s1: cur[1], w: cur[1] - cur[0] })
      for (let i = 1; i < iv.length; i++) {
        const [a, b] = iv[i]
        const gap = a - cur[1]
        if (gap <= tol * 1.2) cur[1] = Math.max(cur[1], b)
        else if (gap >= gapMin && gap <= gapMax) {
          gaps.push({ horiz, c, s0: cur[1], s1: a })
          cur[1] = Math.max(cur[1], b) // bridge: the wall continues, the gap becomes a door
        } else {
          flush()
          cur = [a, b]
        }
      }
      flush()
    }
  }
  return { lines: out, gaps }
}

/** Snap all line coordinates that are nearly equal to one value (so parallel walls align). */
function alignCoords(lines: Line[], tol: number) {
  for (const horiz of [true, false]) {
    const ls = lines.filter((l) => l.horiz === horiz).sort((a, b) => a.c - b.c)
    let group: Line[] = []
    const settle = () => {
      if (!group.length) return
      const c = group.reduce((s, x) => s + x.c * x.w, 0) / group.reduce((s, x) => s + x.w, 0)
      for (const g of group) g.c = c
      group = []
    }
    for (const l of ls) {
      if (group.length && l.c - group[group.length - 1].c > tol) settle()
      group.push(l)
    }
    settle()
  }
}

/** Extend or trim line ends onto perpendicular lines within `reach` so corners close. */
function closeCorners(lines: Line[], reach: number) {
  const H = lines.filter((l) => l.horiz)
  const V = lines.filter((l) => !l.horiz)
  const snapEnd = (l: Line, which: 's0' | 's1', perp: Line[]) => {
    const v = l[which]
    let best: Line | null = null
    let bd = reach
    for (const p of perp) {
      if (l.c < p.s0 - reach || l.c > p.s1 + reach) continue
      const d = Math.abs(p.c - v)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    if (best) {
      l[which] = best.c
      best.s0 = Math.min(best.s0, l.c)
      best.s1 = Math.max(best.s1, l.c)
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const l of H) {
      snapEnd(l, 's0', V)
      snapEnd(l, 's1', V)
    }
    for (const l of V) {
      snapEnd(l, 's0', H)
      snapEnd(l, 's1', H)
    }
  }
}

const lineSeg = (l: Line): Seg => (l.horiz ? { a: { x: l.s0, y: l.c }, b: { x: l.s1, y: l.c } } : { a: { x: l.c, y: l.s0 }, b: { x: l.c, y: l.s1 } })

/* ── labels & dimensions ─────────────────────────────────────────────────── */

export function roomTypeFromLabel(text: string): { type: RoomType; label: string } | null {
  const s = ` ${text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')} `
  let best: { type: RoomType; len: number } | null = null
  for (const [type, sp] of Object.entries(ROOM_SPECS) as [RoomType, (typeof ROOM_SPECS)[RoomType]][]) {
    for (const w of [sp.label.toLowerCase(), ...sp.words]) {
      if (w.length < 2) continue
      if (s.includes(` ${w} `) && (!best || w.length > best.len)) best = { type, len: w.length }
    }
  }
  const short: Record<string, RoomType> = { br: 'bedroom', bed: 'bedroom', mbr: 'master_bedroom', bath: 'bathroom', wc: 'bathroom', kit: 'kitchen', ktn: 'kitchen', din: 'dining', lvg: 'tv_lounge', liv: 'tv_lounge', drw: 'drawing', dr: 'drawing', str: 'store', lnd: 'laundry', gar: 'garage', stairs: 'stair', up: 'stair', dn: 'stair' }
  if (!best) {
    const k = s.trim().split(/\s+/)[0]
    if (short[k]) return { type: short[k], label: text }
    return null
  }
  return { type: best.type, label: text }
}

/** "14x16", "14' x 16'", "4.2 x 5 m" → width and length in metres. */
export function parseDimensionLabel(text: string): { w: number; l: number } | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:'|ft|feet|m)?\s*(?:"|\d+")?\s*[x×*by]+\s*(\d+(?:\.\d+)?)\s*('|ft|feet|m)?/i)
  if (!m) return null
  const metric = /m$/i.test(m[3] ?? '') && !/ft|feet/i.test(m[3] ?? '')
  const k = metric ? 1 : FT
  return { w: Number(m[1]) * k, l: Number(m[2]) * k }
}

function guessType(a: number, largest: number, rect: { w: number; h: number }): { type: RoomType; confidence: number; reason: string } {
  const aspect = Math.max(rect.w, rect.h) / Math.max(0.1, Math.min(rect.w, rect.h))
  if (a < 2.2) return { type: 'store', confidence: 0.4, reason: 'very small space' }
  if (aspect > 3.2 && Math.min(rect.w, rect.h) < 1.6) return { type: 'corridor', confidence: 0.55, reason: 'long and narrow' }
  if (a < 5.5) return { type: 'bathroom', confidence: 0.5, reason: 'bathroom-sized' }
  if (a >= largest - 1e-6 && a > 14) return { type: 'tv_lounge', confidence: 0.55, reason: 'largest space' }
  if (a < 9) return { type: 'kitchen', confidence: 0.35, reason: 'kitchen-sized' }
  return { type: 'bedroom', confidence: 0.45, reason: 'bedroom-sized' }
}

/* ── recognition ─────────────────────────────────────────────────────────── */

export interface RecognizeOptions {
  /** Snapping tolerance in metres (≈ how sloppy the drawing is). */
  tol?: number
  arcs?: Arc[]
  texts?: TextMark[]
  /** Thin marks near walls that indicate windows (image mode). */
  windowMarks?: Seg[]
  /** Keep coordinates as drawn (adding to an existing plan): dimension labels do not rescale. */
  noScale?: boolean
}

export function recognize(rawSegs: Seg[], o: RecognizeOptions = {}): RecognizedPlan {
  const tol = o.tol ?? 0.3
  const notes: string[] = []
  const texts = o.texts ?? []
  // windows drawn as a short line alongside a wall (double line) — pull them out before merging
  const { lines: raw, other } = toLines(rawSegs)
  const windowMarks: Line[] = []
  const wallCands: Line[] = []
  const sortedByLen = [...raw].sort((a, b) => b.w - a.w)
  for (const l of sortedByLen) {
    const short = l.w < 2.6
    const twin = short && wallCands.some((w) => w.horiz === l.horiz && w.w > l.w * 1.4 && Math.abs(w.c - l.c) > tol * 0.35 && Math.abs(w.c - l.c) < tol * 1.7 && l.s0 >= w.s0 - 0.2 && l.s1 <= w.s1 + 0.2)
    if (twin) windowMarks.push(l)
    else wallCands.push(l)
  }
  if (o.windowMarks) windowMarks.push(...toLines(o.windowMarks).lines)
  const merged = mergeLines(wallCands, tol, 0.55, 1.7)
  const lines = merged.lines.filter((l) => l.w > tol * 0.8)
  alignCoords(lines, tol * 0.6)
  closeCorners(lines, tol * 1.6)
  const walls = [...lines.map(lineSeg), ...other]
  // faces → rooms
  let faces = findFaces(walls, Math.max(0.05, tol * 0.3), 0.9).map((f) => removeCollinear(f, 1e-3))
  faces = faces.filter((f) => f.length >= 3)
  // drop a face that is the union of others (outer ring traced as a hole-less face)
  faces = faces.filter((f) => {
    const inside = faces.filter((g) => g !== f && pointInPolygon(centroid(g), f) && area(g) < area(f))
    return inside.reduce((s, g) => s + area(g), 0) < area(f) * 0.6
  })
  if (!faces.length) notes.push('No closed rooms were found. Make sure room outlines meet at the corners.')
  // scale from dimension labels
  let scale = 1
  const ratios: number[] = []
  for (const t of texts) {
    const d = parseDimensionLabel(t.text)
    if (!d) continue
    const f = faces.find((g) => pointInPolygon(t.p, g))
    if (!f) continue
    const b = bbox(f)
    const measured = [b.w, b.h].sort((a, c) => a - c)
    const labelled = [d.w, d.l].sort((a, c) => a - c)
    ratios.push(labelled[0] / measured[0], labelled[1] / measured[1])
  }
  if (ratios.length && !o.noScale) {
    ratios.sort((a, b) => a - b)
    scale = ratios[Math.floor(ratios.length / 2)]
    if (Math.abs(scale - 1) > 0.03) notes.push(`Scaled by ${scale.toFixed(2)} to match the dimensions you wrote.`)
    else scale = 1
  }
  const S = (p: Vec2): Vec2 => ({ x: p.x * scale, y: p.y * scale })
  const largest = Math.max(0, ...faces.map((f) => area(f) * scale * scale))
  const rooms: RecognizedRoom[] = faces.map((f) => {
    const poly = f.map(S)
    const a = area(poly)
    const b = bbox(poly)
    const lab = texts.map((t) => ({ t, r: roomTypeFromLabel(t.text) })).find((x) => x.r && pointInPolygon(S(x.t.p), poly))
    if (lab?.r) return { id: uid('rm'), polygon: poly, type: lab.r.type, name: niceName(lab.t.text, lab.r.type), confidence: 0.95, reason: `labelled "${lab.t.text}"`, label: lab.t.text }
    const g = guessType(a, largest, b)
    return { id: uid('rm'), polygon: poly, type: g.type, name: spec(g.type).label, confidence: g.confidence, reason: g.reason }
  })
  // stairs drawn as many short parallel lines inside a room
  for (const r of rooms) {
    if (r.label) continue
    const inside = raw.filter((l) => l.w < 1.6 && l.w > 0.6 && pointInPolygon(S({ x: l.horiz ? (l.s0 + l.s1) / 2 : l.c, y: l.horiz ? l.c : (l.s0 + l.s1) / 2 }), r.polygon))
    if (inside.length >= 5) {
      r.type = 'stair'
      r.name = 'Stairs'
      r.confidence = 0.7
      r.reason = 'many parallel treads drawn inside'
    }
  }
  // openings
  const openings: RecognizedOpening[] = []
  for (const g of merged.gaps) {
    const mid = (g.s0 + g.s1) / 2
    openings.push({ kind: 'door', at: S(g.horiz ? { x: mid, y: g.c } : { x: g.c, y: mid }), width: (g.s1 - g.s0) * scale, horizontal: g.horiz })
  }
  for (const arc of o.arcs ?? []) {
    // door on the wall nearest to the hinge; its centre is half a leaf along that wall towards the swing
    let best: { l: Line; d: number } | null = null
    for (const l of lines) {
      const d = distToSegment(arc.center, lineSeg(l).a, lineSeg(l).b)
      if (d < tol * 1.5 && (!best || d < best.d)) best = { l, d }
    }
    if (!best) continue
    const l = best.l
    const r = Math.max(0.7, Math.min(1.5, arc.radius))
    const along = l.horiz ? Math.sign(arc.mid.x - arc.center.x) || 1 : Math.sign(arc.mid.y - arc.center.y) || 1
    const at = l.horiz ? { x: arc.center.x + (along * r) / 2, y: l.c } : { x: l.c, y: arc.center.y + (along * r) / 2 }
    if (!openings.some((q) => segLength(q.at, S(at)) < 0.6)) openings.push({ kind: 'door', at: S(at), width: r * scale, horizontal: l.horiz })
  }
  for (const w of windowMarks) {
    const mid = (w.s0 + w.s1) / 2
    const host = lines.filter((l) => l.horiz === w.horiz && mid >= l.s0 && mid <= l.s1 && Math.abs(l.c - w.c) < tol * 1.6).sort((a, b) => Math.abs(a.c - w.c) - Math.abs(b.c - w.c))[0]
    if (!host) continue
    openings.push({ kind: 'window', at: S(w.horiz ? { x: mid, y: host.c } : { x: host.c, y: mid }), width: Math.max(0.6, w.w * scale), horizontal: w.horiz })
  }
  for (const t of texts) {
    const k = t.text.trim().toLowerCase()
    if (k !== 'w' && k !== 'win' && k !== 'window' && k !== 'd' && k !== 'door') continue
    let best: { l: Line; d: number } | null = null
    for (const l of lines) {
      const s = lineSeg(l)
      const d = distToSegment(t.p, s.a, s.b)
      if (d < tol * 2 && (!best || d < best.d)) best = { l, d }
    }
    if (!best) continue
    const s = lineSeg(best.l)
    const L = segLength(s.a, s.b)
    const tt = Math.max(0.6, Math.min(L - 0.6, projectT(t.p, s.a, s.b) * L))
    const at = best.l.horiz ? { x: s.a.x + tt, y: best.l.c } : { x: best.l.c, y: s.a.y + tt }
    openings.push({ kind: k.startsWith('w') ? 'window' : 'door', at: S(at), width: k.startsWith('w') ? 1.5 : 0.9, horizontal: best.l.horiz })
  }
  const doors = openings.filter((x) => x.kind === 'door').length
  const wins = openings.filter((x) => x.kind === 'window').length
  notes.unshift(`Found ${lines.length} walls, ${rooms.length} rooms, ${doors} doors and ${wins} windows.`)
  return { walls: walls.map((w) => ({ a: S(w.a), b: S(w.b) })), rooms, openings, scale, notes }
}

function niceName(label: string, type: RoomType) {
  const t = label.trim()
  if (t.length > 2 && /[a-z]/i.test(t) && !/^\d/.test(t)) return t.replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return spec(type).label
}

/* ── recognized plan → editable floor ────────────────────────────────────── */

/**
 * Replace a floor's rooms with the recognized plan, placed inside the plot's buildable area
 * (centred across the width, front edge at the front setback). Walls are rebuilt from rooms;
 * openings are re-hosted on the rebuilt walls; missing access gets doors; rooms are furnished.
 */
export function applyRecognizedPlan(plan: RecognizedPlan, floor: Floor, plot: Plot, settings: ProjectSettings, opts: { place?: 'fit' | 'keep' } = {}): { warnings: string[] } {
  const warnings: string[] = []
  const all = plan.rooms.flatMap((r) => r.polygon)
  if (!all.length) throw new Error('There are no rooms to create.')
  const b = bbox(all)
  const bw = plot.width - plot.setbacks.left - plot.setbacks.right
  const bd = plot.depth - plot.setbacks.front - plot.setbacks.rear
  if (b.w > bw + 0.05 || b.h > bd + 0.05) warnings.push(`The drawing (${(b.w / FT).toFixed(0)} × ${(b.h / FT).toFixed(0)} ft) is larger than the buildable area (${(bw / FT).toFixed(0)} × ${(bd / FT).toFixed(0)} ft); check the scale or the plot size.`)
  const dx = opts.place === 'keep' ? 0 : plot.setbacks.left + Math.max(0, (bw - b.w) / 2) - b.x
  const dy = opts.place === 'keep' ? 0 : plot.depth - plot.setbacks.front - b.h - b.y
  const T = (p: Vec2) => ({ x: Math.round((p.x + dx) * 1000) / 1000, y: Math.round((p.y + dy) * 1000) / 1000 })
  floor.rooms = plan.rooms.map<Room>((r) => ({ id: r.id, name: r.name, autoName: !r.label, type: r.type, polygon: r.polygon.map(T) }))
  floor.openings = []
  floor.furniture = []
  floor.stairs = []
  floor.columns = []
  floor.beams = []
  refreshFloor(floor, settings)
  // re-host openings on the rebuilt walls
  for (const o of plan.openings) {
    const at = T(o.at)
    let best: { id: string; t: number; L: number; d: number } | null = null
    for (const w of floor.walls) {
      if (effectiveKind(w) === 'virtual') continue
      const d = distToSegment(at, w.a, w.b)
      const L = segLength(w.a, w.b)
      if (d < 0.35 && L > 0.8 && (!best || d < best.d)) best = { id: w.id, t: projectT(at, w.a, w.b) * L, L, d }
    }
    if (!best) continue
    const width = Math.min(o.width, best.L - 0.2)
    const offset = Math.max(width / 2 + 0.1, Math.min(best.L - width / 2 - 0.1, best.t))
    const clash = floor.openings.some((x) => x.wallId === best!.id && Math.abs(x.offset - offset) < (x.width + width) / 2 + 0.1)
    if (clash) continue
    const w = floor.walls.find((x) => x.id === best!.id)!
    const exterior = effectiveKind(w) === 'exterior'
    const op: Opening =
      o.kind === 'door'
        ? { id: uid('op'), kind: 'door', wallId: w.id, offset, width: Math.max(0.7, Math.min(1.8, width)), height: 2.13, sill: 0, style: exterior && width > 1.1 ? 'main' : 'single', hinge: 'start', swing: 'left' }
        : { id: uid('op'), kind: 'window', wallId: w.id, offset, width: Math.max(0.6, Math.min(3, width)), height: 1.5, sill: 0.9, style: 'casement' }
    floor.openings.push(op)
  }
  // the entrance: an exterior door facing the road becomes the main door
  const front = floor.openings
    .filter((x) => x.kind === 'door')
    .map((x) => ({ x, w: floor.walls.find((w) => w.id === x.wallId)! }))
    .filter(({ w }) => effectiveKind(w) === 'exterior')
    .sort((p, q) => Math.max(q.w.a.y, q.w.b.y) - Math.max(p.w.a.y, p.w.b.y))[0]
  if (front) front.x.style = 'main'
  // stairs inside stair rooms
  for (const r of floor.rooms.filter((x) => x.type === 'stair')) {
    const R = largestInscribedRect(r.polygon, 0.1)
    const n = risersFor(floor.height)
    let placed = false
    for (const t of ['U', 'L', 'straight'] as const) {
      const fit = fitStair(t, R, 'front', n)
      if (!fit) continue
      floor.stairs.push({ id: uid('st'), type: t, turn: 'right', railing: 'glass', risers: n, tread: 0.27, ...fit })
      placed = true
      break
    }
    if (!placed) warnings.push(`${r.name} is too small for a staircase; widen it in the plan.`)
  }
  const fixed = repairAccess({ floors: [floor] }, uid)
  if (fixed.length) warnings.push(...fixed.slice(0, 3))
  floor.furniture = furnishFloor(floor, uid, { luxury: 50 })
  return { warnings }
}

/**
 * Add recognized rooms to an existing floor (§72 "draw an additional room"): sketch coordinates
 * are plan coordinates, new rooms are trimmed where they overlap existing ones, get a door to
 * their neighbour, windows on new outside walls, furniture — and lawns they sit on shrink.
 */
export function addRecognizedRooms(plan: RecognizedPlan, floor: Floor, settings: ProjectSettings, site?: { areas: { polygon: Vec2[] }[] }): { added: Room[]; warnings: string[] } {
  const warnings: string[] = []
  const existing = unionPolys(floor.rooms.filter((r) => r.type !== 'void').map((r) => r.polygon))
  const added: Room[] = []
  for (const r of plan.rooms) {
    let poly = r.polygon.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }))
    if (existing.length) {
      const pieces = differencePolys(poly, ...existing.map((e) => e.outer)).filter((x) => !x.holes.length).sort((a, b) => area(b.outer) - area(a.outer))
      if (!pieces[0] || area(pieces[0].outer) < 1.2) continue
      poly = removeCollinear(pieces[0].outer, 1e-3)
    }
    const room: Room = { id: r.id, name: r.name, autoName: !r.label, type: r.type, polygon: poly }
    floor.rooms.push(room)
    added.push(room)
  }
  if (!added.length) {
    warnings.push('The sketch only covered rooms that already exist; draw the new room outside the current walls.')
    return { added, warnings }
  }
  refreshFloor(floor, settings)
  for (const room of added) {
    // a door to the neighbour it shares the longest wall with
    const nb = floor.rooms
      .filter((x) => x.id !== room.id && !added.includes(x))
      .map((x) => ({ x, len: sharedWalls(floor, room, x).reduce((sum, w) => sum + (w.t1 - w.t0), 0) }))
      .filter((q) => q.len > 0.9)
      .sort((a, b) => b.len - a.len)[0]
    if (nb) addDoor(floor, floor.openings, nb.x, room, 'single', 0.9, uid, { swingInto: room })
    else addDoor(floor, floor.openings, room, null, 'single', 0.9, uid)
    const r = floor.rooms.find((x) => x.id === room.id)!
    if (!spec(r.type).wet || area(r.polygon) > 4) addWindowToRoom(floor, r, spec(r.type).wet ? 0.6 : 1.5)
    floor.furniture.push(...furnishRoom(floor, r, uid, { luxury: 50 }))
  }
  // lawns / paving under a new ground-floor room give way to it
  if (site && floor.level === 0)
    for (const a of site.areas)
      for (const room of added) {
        const left = differencePolys(a.polygon, room.polygon).filter((x) => !x.holes.length).sort((p, q) => area(q.outer) - area(p.outer))[0]
        if (left && area(left.outer) < area(a.polygon) - 0.05) a.polygon = left.outer
      }
  return { added, warnings }
}
