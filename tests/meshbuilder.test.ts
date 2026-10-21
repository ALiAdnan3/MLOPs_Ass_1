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
