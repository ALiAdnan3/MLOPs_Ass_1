import * as THREE from 'three'
import type { SurfaceRef, Vec2 } from '../core/model/types'

/**
 * Accumulates triangles per material and emits one merged mesh per material (few draw calls),
 * recording which triangle ranges belong to which model surface so picking still resolves to
 * "the living-room floor" or "the left side of wall X".
 */

export type V3 = [number, number, number]
export type UV = [number, number]

export interface SurfaceRange {
  start: number
  count: number
  surface: SurfaceRef | null
}

interface Part {
  material: THREE.Material
  pos: number[]
  nor: number[]
  uv: number[]
  idx: number[]
  ranges: SurfaceRange[]
  castShadow: boolean
  receiveShadow: boolean
}

export class MeshBuilder {
  private parts = new Map<string, Part>()
  private cur!: Part
  private surf: SurfaceRef | null = null

  use(material: THREE.Material, surface: SurfaceRef | null = null, opts: { key?: string; castShadow?: boolean; receiveShadow?: boolean } = {}) {
    const key = opts.key ?? material.uuid
    let p = this.parts.get(key)
    if (!p) {
      p = { material, pos: [], nor: [], uv: [], idx: [], ranges: [], castShadow: opts.castShadow ?? true, receiveShadow: opts.receiveShadow ?? true }
      this.parts.set(key, p)
    }
    this.cur = p
    this.surf = surface
    return this
  }

  private mark(tris: number) {
    const p = this.cur
    const start = p.idx.length / 3 - tris
    const last = p.ranges[p.ranges.length - 1]
    if (last && last.surface === this.surf && last.start + last.count === start) last.count += tris
    else p.ranges.push({ start, count: tris, surface: this.surf })
  }

  /** Planar polygon (convex or not, no holes) given in order; normal inferred if omitted. */
  face(vs: V3[], uvs: UV[], normal?: V3) {
    if (vs.length < 3) return
    const p = this.cur
    const n = normal ?? faceNormal(vs)
    const base = p.pos.length / 3
    for (let i = 0; i < vs.length; i++) {
      p.pos.push(vs[i][0], vs[i][1], vs[i][2])
      p.nor.push(n[0], n[1], n[2])
      p.uv.push(uvs[i][0], uvs[i][1])
    }
    for (let i = 1; i < vs.length - 1; i++) p.idx.push(base, base + i, base + i + 1)
    this.mark(vs.length - 2)
  }

  quad(a: V3, b: V3, c: V3, d: V3, uvs?: UV[], normal?: V3) {
    this.face([a, b, c, d], uvs ?? boxUV([a, b, c, d], normal ?? faceNormal([a, b, c])), normal)
  }

  /** Horizontal polygon at height y (plan coords x,y → world x,z). Up-facing if `up`. */
  hPoly(pts: Vec2[], y: number, up: boolean, holes: Vec2[][] = [], uvRot = 0) {
    if (pts.length < 3) return
    const contour = pts.map((p) => new THREE.Vector2(p.x, p.y))
    const hs = holes.filter((h) => h.length >= 3).map((h) => h.map((p) => new THREE.Vector2(p.x, p.y)))
    let tris: number[][]
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, hs)
    } catch {
      return
    }
    const all = [...contour, ...hs.flat()]
    const p = this.cur
    const base = p.pos.length / 3
    const ny = up ? 1 : -1
    const c = Math.cos(uvRot)
    const s = Math.sin(uvRot)
    for (const v of all) {
      p.pos.push(v.x, y, v.y)
      p.nor.push(0, ny, 0)
      p.uv.push(v.x * c - v.y * s, -(v.x * s + v.y * c))
    }
    const ccw = THREE.ShapeUtils.isClockWise(contour) ? !up : up
    for (const t of tris) {
      if (ccw) p.idx.push(base + t[0], base + t[2], base + t[1])
      else p.idx.push(base + t[0], base + t[1], base + t[2])
    }
    this.mark(tris.length)
  }

  /** Vertical extrusion of a polygon's sides between y0 and y1 (outward faces). */
  extrudeSides(pts: Vec2[], y0: number, y1: number) {
    const cw = THREE.ShapeUtils.isClockWise(pts.map((p) => new THREE.Vector2(p.x, p.y)))
    let along = 0
    for (let i = 0; i < pts.length; i++) {
      const a = cw ? pts[(i + 1) % pts.length] : pts[i]
      const b = cw ? pts[i] : pts[(i + 1) % pts.length]
      const L = Math.hypot(b.x - a.x, b.y - a.y)
      if (L < 1e-5) continue
      const n: V3 = [(b.y - a.y) / L, 0, -(b.x - a.x) / L]
      this.face(
        [
          [a.x, y0, a.y],
          [b.x, y0, b.y],
          [b.x, y1, b.y],
          [a.x, y1, a.y]
        ],
        [
          [along, y0],
          [along + L, y0],
          [along + L, y1],
          [along, y1]
        ],
        n
      )
      along += L
    }
  }

  /** Solid slab: polygon extruded between y0 and y1 with caps. */
  slab(pts: Vec2[], y0: number, y1: number, holes: Vec2[][] = [], caps: { top?: boolean; bottom?: boolean; sides?: boolean } = {}) {
    if (caps.top !== false) this.hPoly(pts, y1, true, holes)
    if (caps.bottom !== false) this.hPoly(pts, y0, false, holes)
    if (caps.sides !== false) {
      this.extrudeSides(pts, y0, y1)
      for (const h of holes) this.extrudeSides([...h].reverse(), y0, y1)
    }
  }

  /** Oriented box: center (x, y, z), size (w along local x, h, d along local z), rotation about Y. */
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, rotY = 0, faces: { top?: boolean; bottom?: boolean } = {}) {
    const c = Math.cos(rotY)
    const s = Math.sin(rotY)
    const P = (x: number, y: number, z: number): V3 => [cx + x * c + z * s, cy + y, cz - x * s + z * c]
    const hw = w / 2
    const hh = h / 2
    const hd = d / 2
    const v = [P(-hw, -hh, -hd), P(hw, -hh, -hd), P(hw, hh, -hd), P(-hw, hh, -hd), P(-hw, -hh, hd), P(hw, -hh, hd), P(hw, hh, hd), P(-hw, hh, hd)]
    const quads: [number, number, number, number][] = [
      [4, 5, 6, 7], // +z
      [1, 0, 3, 2], // -z
      [5, 1, 2, 6], // +x
      [0, 4, 7, 3] // -x
    ]
    if (faces.top !== false) quads.push([7, 6, 2, 3])
    if (faces.bottom !== false) quads.push([0, 1, 5, 4])
    for (const q of quads) this.quad(v[q[0]], v[q[1]], v[q[2]], v[q[3]])
  }

  /** Cylinder (or cone) along Y. */
  cylinder(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, seg = 12, caps = true) {
    const top = y0 + h
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2
      const a1 = ((i + 1) / seg) * Math.PI * 2
      const p0: V3 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0]
      const p1: V3 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0]
      const q1: V3 = [cx + Math.cos(a1) * r1, top, cz + Math.sin(a1) * r1]
      const q0: V3 = [cx + Math.cos(a0) * r1, top, cz + Math.sin(a0) * r1]
      const u0 = (a0 / (Math.PI * 2)) * 2 * Math.PI * r0
      const u1 = (a1 / (Math.PI * 2)) * 2 * Math.PI * r0
      const n: V3 = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)]
      this.face([p0, q0, q1, p1], [
        [u0, y0],
        [u0, top],
        [u1, top],
        [u1, y0]
      ], n)
      if (caps) {
        if (r1 > 0) this.face([[cx, top, cz], q0, q1].reverse() as V3[], [[0, 0], [q1[0], q1[2]], [q0[0], q0[2]]], [0, 1, 0])
        if (r0 > 0) this.face([[cx, y0, cz], p0, p1] as V3[], [[0, 0], [p0[0], p0[2]], [p1[0], p1[2]]], [0, -1, 0])
      }
    }
  }

  /** Low-poly sphere / ellipsoid. */
  sphere(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, seg = 8) {
    const rows = Math.max(3, Math.round(seg / 2))
    for (let j = 0; j < rows; j++) {
      const t0 = (j / rows) * Math.PI
      const t1 = ((j + 1) / rows) * Math.PI
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2
        const a1 = ((i + 1) / seg) * Math.PI * 2
        const pt = (t: number, a: number): V3 => [cx + Math.sin(t) * Math.cos(a) * rx, cy + Math.cos(t) * ry, cz + Math.sin(t) * Math.sin(a) * rz]
        const quad = [pt(t0, a0), pt(t0, a1), pt(t1, a1), pt(t1, a0)]
        const mid = pt((t0 + t1) / 2, (a0 + a1) / 2)
        const n: V3 = [(mid[0] - cx) / rx, (mid[1] - cy) / ry, (mid[2] - cz) / rz]
        const l = Math.hypot(...n) || 1
        this.face(quad, quad.map((q) => [q[0] + q[2], q[1]] as UV), [n[0] / l, n[1] / l, n[2] / l])
      }
    }
  }

  isEmpty() {
    for (const p of this.parts.values()) if (p.idx.length) return false
    return true
  }

  build(name = 'batch'): THREE.Group {
    const g = new THREE.Group()
    g.name = name
    for (const p of this.parts.values()) {
      if (!p.idx.length) continue
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3))
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2))
      const vcount = p.pos.length / 3
      geo.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(p.idx, 1) : new THREE.Uint16BufferAttribute(p.idx, 1))
      geo.computeBoundingSphere()
      geo.computeBoundingBox()
      const mesh = new THREE.Mesh(geo, p.material)
      mesh.castShadow = p.castShadow
      mesh.receiveShadow = p.receiveShadow
      mesh.userData.ranges = p.ranges
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      g.add(mesh)
    }
    return g
  }
}

export function faceNormal(vs: V3[]): V3 {
  const [a, b, c] = vs
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const n: V3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
  const l = Math.hypot(n[0], n[1], n[2]) || 1
  return [n[0] / l, n[1] / l, n[2] / l]
}

/** World-space box mapping (meters) by dominant normal axis. */
export function boxUV(vs: V3[], n: V3): UV[] {
  const ax = Math.abs(n[0])
  const ay = Math.abs(n[1])
  const az = Math.abs(n[2])
  if (ay >= ax && ay >= az) return vs.map((v) => [v[0], -v[2]])
  if (ax >= az) return vs.map((v) => [v[2] * Math.sign(n[0] || 1), v[1]])
  return vs.map((v) => [v[0] * -Math.sign(n[2] || 1), v[1]])
}

/** Resolve a picked triangle to its surface. */
export function surfaceAt(mesh: THREE.Mesh, faceIndex: number): SurfaceRef | null {
  const ranges = mesh.userData.ranges as SurfaceRange[] | undefined
  if (!ranges) return (mesh.userData.surface as SurfaceRef) ?? null
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    const r = ranges[m]
    if (faceIndex < r.start) hi = m - 1
    else if (faceIndex >= r.start + r.count) lo = m + 1
    else return r.surface
  }
  return null
}

/** Extract the triangles of one surface as a standalone geometry (for hover highlights). */
export function surfaceGeometry(mesh: THREE.Mesh, surface: SurfaceRef, same: (a: SurfaceRef | null, b: SurfaceRef) => boolean): THREE.BufferGeometry | null {
  const ranges = (mesh.userData.ranges as SurfaceRange[] | undefined)?.filter((r) => same(r.surface, surface))
  if (!ranges?.length) return null
  const idx = mesh.geometry.getIndex()
  const pos = mesh.geometry.getAttribute('position')
  if (!idx) return null
  const out: number[] = []
  for (const r of ranges) {
    for (let t = r.start; t < r.start + r.count; t++) {
      for (let k = 0; k < 3; k++) {
        const vi = idx.getX(t * 3 + k)
        out.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
  g.computeVertexNormals()
  return g
}
