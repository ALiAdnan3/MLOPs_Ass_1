import type { Vec2 } from '../model/types'
import { signedArea } from './polygon'
import { segmentIntersection } from './segment'
import { dist } from './vec'

export interface Seg {
  a: Vec2
  b: Vec2
}

/**
 * Find the bounded faces (closed regions) of a set of line segments.
 * Steps: split at intersections → merge nearby vertices → prune dangling edges → trace faces
 * with the "sharpest left turn" rule. Returns polygons of the bounded faces.
 */
export function findFaces(segments: Seg[], tol = 0.05, minArea = 0.5): Vec2[][] {
  // 1. split segments at all pairwise intersections
  const cuts: number[][] = segments.map(() => [0, 1])
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const s = segments[i]
      const t = segments[j]
      const hit = segmentIntersection(s.a, s.b, t.a, t.b)
      if (hit) {
        cuts[i].push(hit.t)
        cuts[j].push(hit.u)
      }
    }
  }
  const pieces: Seg[] = []
  segments.forEach((s, i) => {
    const ts = [...new Set(cuts[i].map((t) => Math.round(t * 1e6) / 1e6))].sort((x, y) => x - y)
    for (let k = 0; k < ts.length - 1; k++) {
      const a = { x: s.a.x + (s.b.x - s.a.x) * ts[k], y: s.a.y + (s.b.y - s.a.y) * ts[k] }
      const b = { x: s.a.x + (s.b.x - s.a.x) * ts[k + 1], y: s.a.y + (s.b.y - s.a.y) * ts[k + 1] }
      if (dist(a, b) > tol * 0.5) pieces.push({ a, b })
    }
  })

  // 2. merge vertices within tolerance
  const verts: Vec2[] = []
  const vid = (p: Vec2) => {
    for (let i = 0; i < verts.length; i++) if (dist(verts[i], p) <= tol) return i
    verts.push({ ...p })
    return verts.length - 1
  }
  const adj = new Map<number, Set<number>>()
  const link = (u: number, w: number) => {
    if (u === w) return
    if (!adj.has(u)) adj.set(u, new Set())
    if (!adj.has(w)) adj.set(w, new Set())
    adj.get(u)!.add(w)
    adj.get(w)!.add(u)
  }
  for (const p of pieces) link(vid(p.a), vid(p.b))

  // 3. prune dangling edges (degree-1 vertices), repeatedly
  let pruned = true
  while (pruned) {
    pruned = false
    for (const [u, ns] of adj) {
      if (ns.size <= 1) {
        for (const w of ns) adj.get(w)?.delete(u)
        adj.delete(u)
        pruned = true
      }
    }
  }

  // 4. sort neighbors by angle
  const sorted = new Map<number, number[]>()
  for (const [u, ns] of adj) {
    const list = [...ns].sort((p, q) => ang(verts[u], verts[p]) - ang(verts[u], verts[q]))
    sorted.set(u, list)
  }

  // 5. trace faces over directed edges
  const used = new Set<string>()
  const faces: Vec2[][] = []
  for (const [u, ns] of sorted) {
    for (const w of ns) {
      const key = `${u}>${w}`
      if (used.has(key)) continue
      const loop: number[] = []
      let a = u
      let b = w
      let guard = 0
      while (guard++ < 10000) {
        const k = `${a}>${b}`
        if (used.has(k)) break
        used.add(k)
        loop.push(a)
        const list = sorted.get(b)!
        const idx = list.indexOf(a)
        // next neighbor clockwise from a (sharpest left turn)
        const next = list[(idx - 1 + list.length) % list.length]
        a = b
        b = next
      }
      if (loop.length >= 3) {
        const poly = loop.map((i) => verts[i])
        const sa = signedArea(poly)
        if (sa > minArea) faces.push(poly)
      }
    }
  }
  return faces
}

function ang(o: Vec2, p: Vec2) {
  return Math.atan2(p.y - o.y, p.x - o.x)
}
