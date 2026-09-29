import polygonClipping, { type MultiPolygon, type Polygon as PCPolygon } from 'polygon-clipping'
import type { Vec2 } from '../model/types'
import { cross, dist, EPS, sub } from './vec'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const rectPoly = (r: Rect): Vec2[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h }
]

export function signedArea(poly: Vec2[]): number {
  let a = 0
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % n]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

export const area = (poly: Vec2[]) => Math.abs(signedArea(poly))

export function perimeter(poly: Vec2[]) {
  let p = 0
  for (let i = 0; i < poly.length; i++) p += dist(poly[i], poly[(i + 1) % poly.length])
  return p
}

export function centroid(poly: Vec2[]): Vec2 {
  const a = signedArea(poly)
  if (Math.abs(a) < EPS) {
    const s = poly.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
    return { x: s.x / poly.length, y: s.y / poly.length }
  }
  let cx = 0
  let cy = 0
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % n]
    const f = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

export function bbox(points: Vec2[]): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function pointInRect(p: Vec2, r: Rect, pad = 0) {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0) {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y
}

/** Is the polygon an axis-aligned rectangle? */
export function isAxisRect(poly: Vec2[], tol = 1e-3): boolean {
  const clean = removeCollinear(poly, tol)
  if (clean.length !== 4) return false
  for (let i = 0; i < 4; i++) {
    const a = clean[i]
    const b = clean[(i + 1) % 4]
    if (Math.abs(a.x - b.x) > tol && Math.abs(a.y - b.y) > tol) return false
  }
  return true
}

/** Remove duplicate and collinear vertices. */
export function removeCollinear(poly: Vec2[], tol = 1e-4): Vec2[] {
  let pts = poly.filter((p, i) => dist(p, poly[(i + 1) % poly.length]) > tol)
  let changed = true
  while (changed && pts.length > 3) {
    changed = false
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]
      const b = pts[i]
      const c = pts[(i + 1) % pts.length]
      const cr = cross(sub(b, a), sub(c, b))
      if (Math.abs(cr) < tol * Math.max(dist(a, b), dist(b, c), 1e-9)) {
        pts = pts.slice(0, i).concat(pts.slice(i + 1))
        changed = true
        break
      }
    }
  }
  return pts
}

export function edges(poly: Vec2[]): [Vec2, Vec2][] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]] as [Vec2, Vec2])
}

export function translatePoly(poly: Vec2[], dx: number, dy: number): Vec2[] {
  return poly.map((p) => ({ x: p.x + dx, y: p.y + dy }))
}

// ─── Booleans (polygon-clipping) ────────────────────────────────────────────

const toPC = (poly: Vec2[]): PCPolygon => [poly.map((p) => [p.x, p.y] as [number, number])]
const fromRing = (ring: [number, number][]): Vec2[] => {
  const pts = ring.map(([x, y]) => ({ x, y }))
  if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-9) pts.pop()
  return pts
}

/** Outer rings of a multipolygon result (holes are returned separately). */
export interface PolyWithHoles {
  outer: Vec2[]
  holes: Vec2[][]
}

function fromMulti(mp: MultiPolygon): PolyWithHoles[] {
  return mp.map((pg) => ({ outer: fromRing(pg[0] as [number, number][]), holes: pg.slice(1).map((r) => fromRing(r as [number, number][])) }))
}

export function unionPolys(polys: Vec2[][]): PolyWithHoles[] {
  const valid = polys.filter((p) => p.length >= 3 && area(p) > 1e-6)
  if (!valid.length) return []
  try {
    const [first, ...rest] = valid.map(toPC)
    return fromMulti(polygonClipping.union(first, ...rest))
  } catch {
    return valid.map((p) => ({ outer: p, holes: [] }))
  }
}

export function intersectPolys(a: Vec2[], b: Vec2[]): PolyWithHoles[] {
  try {
    return fromMulti(polygonClipping.intersection(toPC(a), toPC(b)))
  } catch {
    return []
  }
}

export function differencePolys(a: Vec2[], ...subtract: Vec2[][]): PolyWithHoles[] {
  const subs = subtract.filter((p) => p.length >= 3)
  if (!subs.length) return [{ outer: a, holes: [] }]
  try {
    return fromMulti(polygonClipping.difference(toPC(a), ...subs.map(toPC)))
  } catch {
    return [{ outer: a, holes: [] }]
  }
}

export function overlapArea(a: Vec2[], b: Vec2[]): number {
  const ra = bbox(a)
  const rb = bbox(b)
  if (!rectsOverlap(ra, rb)) return 0
  return intersectPolys(a, b).reduce((s, p) => s + area(p.outer) - p.holes.reduce((h, r) => h + area(r), 0), 0)
}

export function polyWithHolesArea(p: PolyWithHoles) {
  return area(p.outer) - p.holes.reduce((s, h) => s + area(h), 0)
}

/** Inset an axis-aligned rectangle-ish polygon via its bbox (used for furniture fitting). */
export function insetRect(r: Rect, d: number): Rect {
  return { x: r.x + d, y: r.y + d, w: Math.max(0, r.w - 2 * d), h: Math.max(0, r.h - 2 * d) }
}

/**
 * Largest axis-aligned rectangle inside a polygon (grid sampled, maximal-rectangle-in-histogram).
 * Used for irregular plots (buildable envelope) and for fitting furniture in L-shaped rooms.
 */
export function largestInscribedRect(poly: Vec2[], step = 0.25): Rect {
  const b = bbox(poly)
  const cols = Math.max(1, Math.floor(b.w / step))
  const rows = Math.max(1, Math.floor(b.h / step))
  const heights = new Array(cols).fill(0)
  let best: Rect = { x: b.x, y: b.y, w: 0, h: 0 }
  let bestArea = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: b.x + (c + 0.5) * step, y: b.y + (r + 0.5) * step }
      heights[c] = pointInPolygon(p, poly) ? heights[c] + 1 : 0
    }
    // largest rectangle in histogram
    const stack: number[] = []
    for (let c = 0; c <= cols; c++) {
      const h = c === cols ? 0 : heights[c]
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop()!
        const height = heights[top]
        const left = stack.length ? stack[stack.length - 1] + 1 : 0
        const width = c - left
        const a = width * height
        if (a > bestArea) {
          bestArea = a
          best = { x: b.x + left * step, y: b.y + (r - height + 1) * step, w: width * step, h: height * step }
        }
      }
      stack.push(c)
    }
  }
  return best
}
