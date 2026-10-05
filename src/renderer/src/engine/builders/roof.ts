import * as THREE from 'three'
import type { HouseState } from '../../core/model/types'
import { MeshBuilder, type V3 } from '../MeshBuilder'
import type { MaterialManager } from '../materials/MaterialManager'
import { bbox, unionPolys } from '../../core/geometry/polygon'
import { floorElevations, sortedFloors } from '../../core/model/house'
import { spec } from '../../core/constraints/rooms'

/** Pitched roofs (hip, gable, shed, mansard) over the top floor for styles that call for them. */
export function buildPitchedRoof(h: HouseState, mats: MaterialManager, plinth: number): THREE.Group | null {
  const ext = h.exterior
  if (ext.roofType === 'flat') return null
  const floors = sortedFloors(h.floors).filter((f) => f.kind !== 'roof')
  const top = floors[floors.length - 1]
  if (!top) return null
  const el = floorElevations(h.floors, plinth)
  const base = (el.get(top.id) ?? 0) + top.height
  const polys = unionPolys(top.rooms.filter((r) => !spec(r.type).outdoor && r.type !== 'void').map((r) => r.polygon))
  if (!polys.length) return null
  const mb = new MeshBuilder()
  const roofMat = mats.get(ext.roofMaterial, 'double')
  const gableMat = mats.get(ext.facadeMaterial, 'double')
  // deep eaves read as a real roof; hip roofs sit lower so square plans do not become pyramids
  const ov = ext.roofType === 'hip' ? 0.85 : 0.6
  for (const p of polys) {
    const b = bbox(p.outer)
    const x0 = b.x - ov
    const x1 = b.x + b.w + ov
    const z0 = b.y - ov
    const z1 = b.y + b.h + ov
    const alongX = b.w >= b.h
    const span = alongX ? z1 - z0 : x1 - x0
    const pitch = ext.roofType === 'shed' ? 0.25 : ext.roofType === 'hip' ? 0.42 : 0.55
    const rise = (span / 2) * pitch
    const y = base
    const v = (x: number, yy: number, z: number): V3 => [x, yy, z]
    mb.use(roofMat, { kind: 'roof' })
    if (ext.roofType === 'gable' || ext.roofType === 'mansard') {
      if (alongX) {
        const zm = (z0 + z1) / 2
        if (ext.roofType === 'mansard') {
          const k = 0.35
          const zi0 = z0 + span * k * 0.5
          const zi1 = z1 - span * k * 0.5
          const ym = y + rise * 1.3
          mb.quad(v(x0, y, z0), v(x1, y, z0), v(x1, ym, zi0), v(x0, ym, zi0))
          mb.quad(v(x1, y, z1), v(x0, y, z1), v(x0, ym, zi1), v(x1, ym, zi1))
          mb.quad(v(x0, ym, zi0), v(x1, ym, zi0), v(x1, ym + rise * 0.3, zm), v(x0, ym + rise * 0.3, zm))
          mb.quad(v(x1, ym, zi1), v(x0, ym, zi1), v(x0, ym + rise * 0.3, zm), v(x1, ym + rise * 0.3, zm))
          mb.use(gableMat, { kind: 'roof' })
          mb.face([v(x0, y, z1), v(x0, y, z0), v(x0, ym, zi0), v(x0, ym + rise * 0.3, zm), v(x0, ym, zi1)].reverse() as V3[], [[z1, y], [z0, y], [zi0, ym], [zm, ym + rise * 0.3], [zi1, ym]].reverse() as [number, number][])
          mb.face([v(x1, y, z0), v(x1, y, z1), v(x1, ym, zi1), v(x1, ym + rise * 0.3, zm), v(x1, ym, zi0)].reverse() as V3[], [[z0, y], [z1, y], [zi1, ym], [zm, ym + rise * 0.3], [zi0, ym]].reverse() as [number, number][])
        } else {
          mb.quad(v(x0, y, z0), v(x1, y, z0), v(x1, y + rise, zm), v(x0, y + rise, zm))
          mb.quad(v(x1, y, z1), v(x0, y, z1), v(x0, y + rise, zm), v(x1, y + rise, zm))
          mb.use(gableMat, { kind: 'roof' })
          mb.face([v(x0 + ov, y, z1 - ov), v(x0 + ov, y + rise - 0.05, zm), v(x0 + ov, y, z0 + ov)], [[z1, y], [zm, y + rise], [z0, y]])
          mb.face([v(x1 - ov, y, z0 + ov), v(x1 - ov, y + rise - 0.05, zm), v(x1 - ov, y, z1 - ov)], [[z0, y], [zm, y + rise], [z1, y]])
        }
      } else {
        const xm = (x0 + x1) / 2
        mb.quad(v(x0, y, z1), v(x0, y, z0), v(xm, y + rise, z0), v(xm, y + rise, z1))
        mb.quad(v(x1, y, z0), v(x1, y, z1), v(xm, y + rise, z1), v(xm, y + rise, z0))
        mb.use(gableMat, { kind: 'roof' })
        mb.face([v(x0 + ov, y, z0 + ov), v(xm, y + rise - 0.05, z0 + ov), v(x1 - ov, y, z0 + ov)], [[x0, y], [xm, y + rise], [x1, y]])
        mb.face([v(x1 - ov, y, z1 - ov), v(xm, y + rise - 0.05, z1 - ov), v(x0 + ov, y, z1 - ov)], [[x1, y], [xm, y + rise], [x0, y]])
      }
    } else if (ext.roofType === 'shed') {
      mb.quad(v(x0, y + rise * 2, z0), v(x1, y + rise * 2, z0), v(x1, y, z1), v(x0, y, z1))
      mb.use(gableMat, { kind: 'roof' })
      mb.face([v(x0 + ov, y, z1 - ov), v(x0 + ov, y + rise * 2, z0 + ov), v(x0 + ov, y, z0 + ov)], [[z1, y], [z0, y + rise * 2], [z0, y]])
      mb.face([v(x1 - ov, y, z0 + ov), v(x1 - ov, y + rise * 2, z0 + ov), v(x1 - ov, y, z1 - ov)], [[z0, y], [z0, y + rise * 2], [z1, y]])
      mb.face([v(x0 + ov, y, z0 + ov), v(x0 + ov, y + rise * 2, z0 + ov), v(x1 - ov, y + rise * 2, z0 + ov), v(x1 - ov, y, z0 + ov)].reverse() as V3[], [[x0, y], [x0, y + rise * 2], [x1, y + rise * 2], [x1, y]].reverse() as [number, number][])
    } else {
      // hip
      const inset = Math.min(x1 - x0, z1 - z0) / 2
      if (alongX) {
        const zm = (z0 + z1) / 2
        const r0 = x0 + inset
        const r1 = x1 - inset
        mb.quad(v(x0, y, z0), v(x1, y, z0), v(r1, y + rise, zm), v(r0, y + rise, zm))
        mb.quad(v(x1, y, z1), v(x0, y, z1), v(r0, y + rise, zm), v(r1, y + rise, zm))
        mb.face([v(x0, y, z1), v(x0, y, z0), v(r0, y + rise, zm)], [[z1, y], [z0, y], [zm, y + rise]])
        mb.face([v(x1, y, z0), v(x1, y, z1), v(r1, y + rise, zm)], [[z0, y], [z1, y], [zm, y + rise]])
      } else {
        const xm = (x0 + x1) / 2
        const r0 = z0 + inset
        const r1 = z1 - inset
        mb.quad(v(x0, y, z1), v(x0, y, z0), v(xm, y + rise, r0), v(xm, y + rise, r1))
        mb.quad(v(x1, y, z0), v(x1, y, z1), v(xm, y + rise, r1), v(xm, y + rise, r0))
        mb.face([v(x0, y, z0), v(x1, y, z0), v(xm, y + rise, r0)], [[x0, y], [x1, y], [xm, y + rise]])
        mb.face([v(x1, y, z1), v(x0, y, z1), v(xm, y + rise, r1)], [[x1, y], [x0, y], [xm, y + rise]])
      }
    }
    // soffit under the eaves (timber when the facade carries timber cladding) and a deep fascia
    const timber = ext.accent2?.material.includes('wood') ? ext.accent2.material : ext.accentMaterial.includes('wood') ? ext.accentMaterial : null
    mb.use(mats.get(timber ?? 'lib:paint-warm-white', 'double'), { kind: 'roof' })
    mb.hPoly([{ x: x0, y: z0 }, { x: x1, y: z0 }, { x: x1, y: z1 }, { x: x0, y: z1 }], y - 0.01, false, [p.outer])
    mb.use(mats.get('lib:paint-charcoal'), { kind: 'roof' })
    mb.extrudeSides([{ x: x0, y: z0 }, { x: x1, y: z0 }, { x: x1, y: z1 }, { x: x0, y: z1 }], y - 0.26, y + 0.04)
  }
  return mb.build('pitched-roof')
}
