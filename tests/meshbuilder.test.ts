import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { MeshBuilder, type V3 } from '@/engine/MeshBuilder'

// The fast cylinder (written straight into the buffers) must produce exactly what the original,
// face-by-face version did: same vertices, normals, UVs and triangles.

function referenceCylinder(mb: MeshBuilder, cx: number, y0: number, cz: number, r0: number, r1: number, h: number, seg = 12, caps = true) {
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
    mb.face([p0, q0, q1, p1], [[u0, y0], [u0, top], [u1, top], [u1, y0]], n)
    if (caps) {
      if (r1 > 0) mb.face([[cx, top, cz], q0, q1].reverse() as V3[], [[0, 0], [q1[0], q1[2]], [q0[0], q0[2]]], [0, 1, 0])
      if (r0 > 0) mb.face([[cx, y0, cz], p0, p1] as V3[], [[0, 0], [p0[0], p0[2]], [p1[0], p1[2]]], [0, -1, 0])
    }
  }
}

function arrays(mb: MeshBuilder) {
  const g = mb.build() as THREE.Group
  const mesh = g.children[0] as THREE.Mesh
  const geo = mesh.geometry
  return {
    pos: [...(geo.attributes.position.array as Float32Array)],
    nor: [...(geo.attributes.normal.array as Float32Array)],
    uv: [...(geo.attributes.uv.array as Float32Array)],
    idx: [...(geo.index!.array as ArrayLike<number> as number[])]
  }
}

describe('MeshBuilder.cylinder', () => {
  const mat = new THREE.MeshStandardMaterial()
  for (const [r0, r1, seg, caps] of [[0.15, 0.15, 16, true], [0.2, 0.05, 8, true], [0.1, 0, 12, true], [0.3, 0.3, 6, false]] as const) {
    it(`matches the original (r0 ${r0}, r1 ${r1}, ${seg} segments, caps ${caps})`, () => {
      const a = new MeshBuilder().use(mat)
      a.cylinder(1.5, 0.2, -2, r0, r1, 2.4, seg, caps)
      const b = new MeshBuilder().use(mat)
      referenceCylinder(b, 1.5, 0.2, -2, r0, r1, 2.4, seg, caps)
      const x = arrays(a)
      const y = arrays(b)
      expect(x.idx).toEqual(y.idx)
      for (const k of ['pos', 'nor', 'uv'] as const) {
        expect(x[k].length).toBe(y[k].length)
        x[k].forEach((v, i) => expect(v).toBeCloseTo(y[k][i], 5))
      }
    })
  }
})

describe('MeshBuilder.roundedBox', () => {
  const mat = new THREE.MeshStandardMaterial()
  for (const rot of [0, 0.7]) {
    it(`fills the box's bounds and faces outwards (rotation ${rot})`, () => {
      const mb = new MeshBuilder().use(mat)
      mb.roundedBox(1, 0.5, -2, 2, 0.8, 0.9, rot, 0.06, 3)
      const ref = new MeshBuilder().use(mat)
      ref.box(1, 0.5, -2, 2, 0.8, 0.9, rot)
      const g = (mb.build() as THREE.Group).children[0] as THREE.Mesh
      const r = (ref.build() as THREE.Group).children[0] as THREE.Mesh
      g.geometry.computeBoundingBox()
      r.geometry.computeBoundingBox()
      const a = g.geometry.boundingBox!
      const b = r.geometry.boundingBox!
      if (rot === 0) {
        for (const k of ['x', 'y', 'z'] as const) {
          expect(a.min[k]).toBeCloseTo(b.min[k], 5)
          expect(a.max[k]).toBeCloseTo(b.max[k], 5)
        }
      } else expect(a.min.y).toBeCloseTo(b.min.y, 5)
      // every triangle's winding agrees with its vertex normals (no inside-out faces)
      const P = g.geometry.attributes.position
      const N = g.geometry.attributes.normal
      const I = g.geometry.index!
      const v = (i: number) => new THREE.Vector3().fromBufferAttribute(P, i)
      let bad = 0
      for (let t = 0; t < I.count / 3; t++) {
        const [i0, i1, i2] = [I.getX(3 * t), I.getX(3 * t + 1), I.getX(3 * t + 2)]
        const cr = v(i1).sub(v(i0)).cross(v(i2).sub(v(i0)))
        if (cr.lengthSq() < 1e-14) continue
        const n = new THREE.Vector3().fromBufferAttribute(N, i0).add(new THREE.Vector3().fromBufferAttribute(N, i1)).add(new THREE.Vector3().fromBufferAttribute(N, i2))
        if (cr.dot(n) < 0) bad++
      }
      expect(bad).toBe(0)
    })
  }
})
