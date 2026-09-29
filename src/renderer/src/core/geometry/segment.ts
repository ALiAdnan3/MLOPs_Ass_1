import type { Vec2 } from '../model/types'
import { cross, dist, dot, EPS, len, norm, sub } from './vec'

/** Parameter t of the projection of p onto segment ab (unclamped). */
export function projectT(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  if (l2 < EPS) return 0
  return dot(sub(p, a), ab) / l2
}

export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const t = Math.max(0, Math.min(1, projectT(p, a, b)))
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return dist(p, closestOnSegment(p, a, b))
}

/** Signed perpendicular distance of p from the infinite line ab (positive on the perp()/"left" side). */
export function signedDistToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const d = norm(sub(b, a))
  return cross(d, sub(p, a))
}

/** Segment–segment intersection point (proper or touching), or null. */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { p: Vec2; t: number; u: number } | null {
  const r = sub(b, a)
  const s = sub(d, c)
  const den = cross(r, s)
  if (Math.abs(den) < EPS) return null
  const qp = sub(c, a)
  const t = cross(qp, s) / den
  const u = cross(qp, r) / den
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null
  return { p: { x: a.x + r.x * t, y: a.y + r.y * t }, t, u }
}

/** Infinite line intersection. */
export function lineIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = sub(b, a)
  const s = sub(d, c)
  const den = cross(r, s)
  if (Math.abs(den) < EPS) return null
  const t = cross(sub(c, a), s) / den
  return { x: a.x + r.x * t, y: a.y + r.y * t }
}

export function segLength(a: Vec2, b: Vec2) {
  return len(sub(b, a))
}

/** Are two segments on the same infinite line (within tolerance)? */
export function collinear(a: Vec2, b: Vec2, c: Vec2, d: Vec2, tol = 1e-3): boolean {
  const dir = norm(sub(b, a))
  const n = { x: -dir.y, y: dir.x }
  const dc = Math.abs(dot(sub(c, a), n))
  const dd = Math.abs(dot(sub(d, a), n))
  return dc < tol && dd < tol
}

/** Overlap interval of cd projected on ab, in ab-parameter space [0..1]; null if none. */
export function collinearOverlap(a: Vec2, b: Vec2, c: Vec2, d: Vec2, minLen = 1e-3): [number, number] | null {
  const t1 = projectT(c, a, b)
  const t2 = projectT(d, a, b)
  const lo = Math.max(0, Math.min(t1, t2))
  const hi = Math.min(1, Math.max(t1, t2))
  const L = segLength(a, b)
  if ((hi - lo) * L < minLen) return null
  return [lo, hi]
}

/** Point along segment at distance s from a. */
export function pointAt(a: Vec2, b: Vec2, s: number): Vec2 {
  const L = segLength(a, b)
  if (L < EPS) return { ...a }
  return { x: a.x + ((b.x - a.x) * s) / L, y: a.y + ((b.y - a.y) * s) / L }
}
