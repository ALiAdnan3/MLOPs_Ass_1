import * as THREE from 'three'
import type { Floor, FurnitureItem, SurfaceRef } from '../../core/model/types'
import type { MeshBuilder } from '../MeshBuilder'
import type { MaterialManager } from '../materials/MaterialManager'
import type { BuildContext } from './house'
import { catalogItem } from '../../core/furniture/catalog'

/**
 * Procedural low-poly furniture (§18). Built in the item's local frame (x = width, z = depth,
 * front faces +z) and merged into the floor batch. The item's `materialId` drives its main
 * surface (countertop, upholstery, carcass) so materials can be applied to furniture too.
 */

const CAR_PAINTS = ['#e9e9e7', '#b9bcc0', '#1e2022', '#6b1f24', '#28415e']

export function buildFurniture(mb: MeshBuilder, glassMb: MeshBuilder, mats: MaterialManager, floor: Floor, ctx: BuildContext) {
  void ctx
  for (const f of floor.furniture) buildItem(mb, glassMb, mats, floor.id, f)
}

export function buildItem(mb: MeshBuilder, glassMb: MeshBuilder, mats: MaterialManager, floorId: string, f: FurnitureItem) {
  const c = catalogItem(f.type)
  const model = c?.model ?? 'box'
  const W = f.width
  const D = f.depth
  const Hh = f.height
  const E = f.elevation ?? 0
  const rot = -f.rotation
  const cs = Math.cos(f.rotation)
  const sn = Math.sin(f.rotation)
  const surf: SurfaceRef = { kind: 'furniture', floorId, furnitureId: f.id }
  /** Box in local coords: center (x, y, z), size (w, h, d). */
  const B = (x: number, y: number, z: number, w: number, h: number, d: number) => {
    const wx = f.position.x + x * cs - z * sn
    const wz = f.position.y + x * sn + z * cs
    mb.box(wx, E + y, wz, w, h, d, rot)
  }
  const G = (x: number, y: number, z: number, w: number, h: number, d: number) => {
    const wx = f.position.x + x * cs - z * sn
    const wz = f.position.y + x * sn + z * cs
    glassMb.box(wx, E + y, wz, w, h, d, rot)
  }
  const Cyl = (x: number, y0: number, z: number, r0: number, r1: number, h: number, seg = 12) => {
    const wx = f.position.x + x * cs - z * sn
    const wz = f.position.y + x * sn + z * cs
    mb.cylinder(wx, E + y0, wz, r0, r1, h, seg)
  }
  const Sph = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
    const wx = f.position.x + x * cs - z * sn
    const wz = f.position.y + x * sn + z * cs
    mb.sphere(wx, E + y, wz, rx, ry, rz, 8)
  }
  const main = (fallback: string) => mats.get(f.materialId ?? fallback)
  const col = (fallback: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) => mats.flat(f.color ?? fallback, 'house', { roughness: 0.85, ...opts })
  const white = mats.flat('#f4f4f2', 'house', { roughness: 0.25 })
  const dark = mats.flat('#1c1d1f', 'house', { roughness: 0.4 })
  const chrome = mats.get('lib:metal-brushed')
  const wood = (id = 'lib:wood-oak') => mats.get(id)
  const legs = (w: number, d: number, h: number, t = 0.04, inset = 0.04) => {
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ])
      B(sx * (w / 2 - inset - t / 2), h / 2, sz * (d / 2 - inset - t / 2), t, h, t)
  }

  switch (model) {
    case 'bed': {
      mb.use(wood('lib:wood-walnut'), surf)
      B(0, 0.15, 0.02, W, 0.3, D - 0.04)
      mb.use(main('lib:fabric-grey'), surf)
      B(0, Math.min(Hh, 1.1) / 2 + 0.1, -D / 2 + 0.05, W + 0.06, Math.min(Hh, 1.1) - 0.2, 0.1)
      mb.use(col('#f2f0ec'), surf)
      B(0, 0.41, 0.04, W - 0.08, 0.22, D - 0.18)
      mb.use(col('#ffffff'), surf)
      const pw = W > 1.2 ? W / 2 - 0.12 : W - 0.2
      for (const px of W > 1.2 ? [-W / 4, W / 4] : [0]) B(px, 0.57, -D / 2 + 0.36, pw, 0.12, 0.38)
      mb.use(col(f.color ?? '#7f8f9c'), surf)
      B(0, 0.54, D * 0.18, W - 0.02, 0.05, D * 0.6)
      break
    }
    case 'bunk':
      mb.use(wood(), surf)
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1]
      ])
        B((sx * W) / 2 - sx * 0.03, Hh / 2, (sz * D) / 2 - sz * 0.03, 0.06, Hh, 0.06)
      for (const y of [0.3, 1.2]) {
        mb.use(wood(), surf)
        B(0, y, 0, W, 0.08, D)
        mb.use(col('#f2f0ec'), surf)
        B(0, y + 0.12, 0, W - 0.1, 0.16, D - 0.1)
      }
      break
    case 'crib':
      mb.use(white, surf)
      B(0, 0.35, 0, W, 0.08, D)
      for (let i = 0; i <= 8; i++) B(-W / 2 + (W * i) / 8, 0.6, -D / 2, 0.02, 0.6, 0.02)
      for (let i = 0; i <= 8; i++) B(-W / 2 + (W * i) / 8, 0.6, D / 2, 0.02, 0.6, 0.02)
      break
    case 'cabinet':
    case 'workbench': {
      mb.use(main(model === 'workbench' ? 'lib:wood-teak' : 'lib:wood-walnut'), surf)
      B(0, Hh / 2, 0, W, Hh, D)
      mb.use(dark, surf)
      const n = Math.max(1, Math.round(W / 0.5))
      for (let i = 0; i < n; i++) B(-W / 2 + (W * (i + 0.5)) / n, Hh * 0.72, D / 2 + 0.006, 0.12, 0.015, 0.012)
      break
    }
    case 'ottoman':
      mb.use(main('lib:fabric-leather'), surf)
      B(0, Hh / 2, 0, W, Hh, D)
      break
    case 'sofa':
    case 'armchair':
    case 'theater': {
      const fab = main(model === 'theater' ? 'lib:fabric-carpet-charcoal' : 'lib:fabric-grey')
      mb.use(fab, surf)
      B(0, 0.21, 0.02, W, 0.26, D - 0.04)
      B(0, 0.52, -D / 2 + 0.11, W, 0.6, 0.22)
      B(-W / 2 + 0.08, 0.36, 0.02, 0.16, 0.36, D - 0.04)
      B(W / 2 - 0.08, 0.36, 0.02, 0.16, 0.36, D - 0.04)
      mb.use(col(model === 'theater' ? '#3d2f35' : '#9fa3a6'), surf)
      const seats = model === 'theater' ? Math.max(2, Math.round(W / 0.8)) : model === 'armchair' ? 1 : Math.max(2, Math.round((W - 0.32) / 0.7))
      const sw = (W - 0.32) / seats
      for (let i = 0; i < seats; i++) B(-W / 2 + 0.16 + sw * (i + 0.5), 0.39, 0.08, sw - 0.02, 0.1, D - 0.3)
      mb.use(dark, surf)
      legs(W, D, 0.08, 0.05, 0.06)
      break
    }
    case 'sofa-l': {
      const fab = main('lib:fabric-grey')
      mb.use(fab, surf)
      B(0, 0.21, -D / 2 + 0.45, W, 0.26, 0.9)
      B(W / 2 - 0.45, 0.21, 0.45, 0.9, 0.26, D - 0.9)
      B(0, 0.52, -D / 2 + 0.11, W, 0.6, 0.22)
      B(-W / 2 + 0.08, 0.36, -D / 2 + 0.45, 0.16, 0.36, 0.9)
      mb.use(col('#9fa3a6'), surf)
      B(-0.25, 0.39, -D / 2 + 0.5, W - 1.2, 0.1, 0.6)
      B(W / 2 - 0.45, 0.39, 0.45, 0.8, 0.1, D - 1.1)
      break
    }
    case 'dining': {
      const tw = Math.max(0.8, W - 0.9)
      const td = Math.max(0.8, D - 0.9)
      mb.use(main('lib:wood-walnut'), surf)
      B(0, 0.74, 0, tw, 0.04, td)
      legs(tw, td, 0.72, 0.06, 0.08)
      const chairsAlong = Math.max(1, Math.round(tw / 0.6))
      const chair = (x: number, z: number, face: number) => {
        mb.use(col('#cbbba4'), surf)
        B(x, 0.46, z, 0.44, 0.06, 0.44)
        const bz = z + face * 0.2
        B(x, 0.72, bz, 0.44, 0.5, 0.05)
        mb.use(wood('lib:wood-walnut'), surf)
        for (const [dx, dz] of [
          [-0.19, -0.19],
          [0.19, -0.19],
          [0.19, 0.19],
          [-0.19, 0.19]
        ])
          B(x + dx, 0.22, z + dz, 0.035, 0.44, 0.035)
      }
      for (let i = 0; i < chairsAlong; i++) {
        const x = -tw / 2 + (tw * (i + 0.5)) / chairsAlong
        chair(x, -td / 2 - 0.25, -1)
        chair(x, td / 2 + 0.25, 1)
      }
      if (td > 1.0) {
        chair(-tw / 2 - 0.3, 0, 0)
        chair(tw / 2 + 0.3, 0, 0)
      }
      break
    }
    case 'chair':
    case 'office-chair':
      mb.use(main(model === 'office-chair' ? 'lib:fabric-carpet-charcoal' : 'lib:wood-oak'), surf)
      B(0, 0.46, 0, W * 0.9, 0.06, D * 0.9)
      B(0, 0.75, -D / 2 + 0.04, W * 0.9, 0.55, 0.05)
      mb.use(chrome, surf)
      if (model === 'office-chair') Cyl(0, 0.05, 0, 0.03, 0.03, 0.4, 8)
      else legs(W * 0.9, D * 0.9, 0.44, 0.03, 0.03)
      break
    case 'table':
    case 'table-low':
    case 'desk': {
      const top = model === 'table-low' ? Hh : Math.max(Hh, 0.74)
      mb.use(main(model === 'table-low' ? 'lib:marble-carrara' : 'lib:wood-walnut'), surf)
      B(0, top - 0.02, 0, W, 0.04, D)
      mb.use(model === 'table-low' ? mats.get('lib:metal-brass') : wood('lib:wood-walnut'), surf)
      legs(W, D, top - 0.04, 0.04, 0.06)
      if (model === 'desk') {
        mb.use(wood('lib:wood-walnut'), surf)
        B(W / 2 - 0.22, 0.36, 0, 0.4, 0.7, D - 0.08)
      }
      break
    }
    case 'tv-unit':
      mb.use(main('lib:wood-walnut'), surf)
      B(0, 0.25, 0, W, 0.5, D)
      mb.use(dark, surf)
      B(0, 0.5 + 0.37, -0.05, Math.min(W * 0.75, 1.65), 0.72, 0.05)
      mb.use(mats.flat('#0c0d0f', 'house', { roughness: 0.15, metalness: 0.2 }), surf)
      B(0, 0.5 + 0.37, -0.02, Math.min(W * 0.75, 1.65) - 0.03, 0.69, 0.005)
      break
    case 'tv-wall':
      mb.use(main('lib:wood-walnut'), surf)
      B(0, 0.9, -D / 2 + 0.01, W, 1.8, 0.02)
      mb.use(mats.flat('#0c0d0f', 'house', { roughness: 0.15 }), surf)
      B(0, 0.95, 0, Math.min(W - 0.3, 1.45), 0.82, 0.04)
      break
    case 'wardrobe': {
      mb.use(main('lib:wood-oak'), surf)
      B(0, Hh / 2, 0, W, Hh, D)
      mb.use(mats.flat('#d8d2c7', 'house', { roughness: 0.6 }), surf)
      const doors = Math.max(2, Math.round(W / 0.55))
      for (let i = 1; i < doors; i++) B(-W / 2 + (W * i) / doors, Hh / 2, D / 2 + 0.003, 0.006, Hh - 0.05, 0.006)
      mb.use(chrome, surf)
      for (let i = 0; i < doors; i++) B(-W / 2 + (W * (i + 0.5)) / doors + (i % 2 ? -0.18 : 0.18) * (W / doors / 0.55), Hh * 0.5, D / 2 + 0.02, 0.015, 0.35, 0.02)
      break
    }
    case 'shelf':
    case 'bookshelf': {
      mb.use(main(model === 'bookshelf' ? 'lib:wood-walnut' : 'lib:metal-aluminum'), surf)
      B(-W / 2 + 0.015, Hh / 2, 0, 0.03, Hh, D)
      B(W / 2 - 0.015, Hh / 2, 0, 0.03, Hh, D)
      const n = Math.max(2, Math.round(Hh / 0.38))
      for (let i = 0; i <= n; i++) B(0, (Hh * i) / n + 0.015, 0, W, 0.03, D)
      if (model === 'bookshelf') {
        const colors = ['#7a2f2a', '#2f4a57', '#c9a45b', '#4a5a3a', '#e8e1d2', '#3a3b3f']
        for (let i = 0; i < n; i++) {
          let x = -W / 2 + 0.05
          let k = 0
          while (x < W / 2 - 0.08) {
            const bw = 0.025 + ((i * 7 + k * 13) % 5) * 0.008
            const bh = (Hh / n) * (0.6 + ((i + k) % 3) * 0.12)
            mb.use(mats.flat(colors[(i * 3 + k) % colors.length], 'house'), surf)
            B(x + bw / 2, (Hh * i) / n + 0.03 + bh / 2, 0.02, bw, bh, D * 0.7)
            x += bw + 0.004
            k++
          }
        }
      }
      break
    }
    case 'counter':
    case 'counter-sink':
    case 'counter-hob':
    case 'island': {
      mb.use(mats.get('lib:paint-warm-white'), surf)
      B(0, 0.43, 0, W, 0.86, D - 0.02)
      mb.use(dark, surf)
      B(0, 0.05, D / 2 - 0.06, W, 0.1, 0.02)
      const doors = Math.max(1, Math.round(W / 0.6))
      mb.use(mats.flat('#c9c5bd', 'house', { roughness: 0.5 }), surf)
      for (let i = 1; i < doors; i++) B(-W / 2 + (W * i) / doors, 0.45, D / 2 - 0.009, 0.005, 0.7, 0.005)
      mb.use(main('lib:granite-black-galaxy'), surf)
      B(0, 0.885, 0.01, W + 0.01, 0.04, D + 0.02)
      if (model !== 'island') {
        mb.use(mats.get('lib:paint-warm-white'), surf)
        B(0, 1.85, -D / 2 + 0.18, W, 0.7, 0.35)
        mb.use(mats.get('lib:ceramic-subway'), surf)
        B(0, 1.2, -D / 2 + 0.005, W, 0.6, 0.01)
      }
      if (model === 'counter-sink') {
        mb.use(mats.get('lib:metal-brushed'), surf)
        B(0, 0.9, 0.02, 0.7, 0.012, 0.42)
        mb.use(dark, surf)
        B(0, 0.902, 0.02, 0.62, 0.012, 0.34)
        mb.use(chrome, surf)
        Cyl(0, 0.9, -D / 2 + 0.1, 0.015, 0.015, 0.32, 8)
      }
      if (model === 'counter-hob') {
        mb.use(mats.flat('#0f1011', 'house', { roughness: 0.1 }), surf)
        B(0, 0.908, 0.02, 0.6, 0.01, 0.52)
        mb.use(mats.get('lib:metal-brushed'), surf)
        B(0, 1.75, -D / 2 + 0.25, 0.7, 0.12, 0.45)
      }
      if (model === 'island') {
        mb.use(col('#2f3336'), surf)
        for (const x of [-W / 3, 0, W / 3]) {
          Cyl(x, 0, D / 2 + 0.3, 0.02, 0.02, 0.62, 6)
          Cyl(x, 0.62, D / 2 + 0.3, 0.18, 0.18, 0.05, 12)
        }
      }
      break
    }
    case 'fridge':
      mb.use(main('lib:metal-brushed'), surf)
      B(0, Hh / 2, 0, W, Hh, D)
      mb.use(dark, surf)
      B(0, Hh * 0.62, D / 2 + 0.002, W - 0.02, 0.01, 0.005)
      B(W / 2 - 0.08, Hh * 0.75, D / 2 + 0.02, 0.02, 0.4, 0.03)
      break
    case 'bathtub':
      mb.use(white, surf)
      B(0, 0.29, 0, W, 0.58, D)
      mb.use(mats.flat('#e9eef0', 'house', { roughness: 0.15 }), surf)
      B(0, 0.585, 0, W - 0.14, 0.004, D - 0.14)
      break
    case 'shower':
      mb.use(mats.get('lib:ceramic-grey-matte'), surf)
      B(0, 0.03, 0, W, 0.06, D)
      mb.use(chrome, surf)
      B(0, 2.05, -D / 2 + 0.2, 0.25, 0.02, 0.25)
      glassMb.use(mats.get('lib:glass-clear'), surf, { castShadow: false })
      G(0, 1.0, D / 2, W, 1.9, 0.01)
      G(W / 2, 1.0, 0, 0.01, 1.9, D)
      break
    case 'wc':
      mb.use(white, surf)
      B(0, 0.55, -D / 2 + 0.09, W, 0.42, 0.18)
      Sph(0, 0.28, 0.08, W / 2, 0.2, D / 2 - 0.1)
      B(0, 0.2, 0.0, W * 0.6, 0.4, D * 0.5)
      break
    case 'vanity': {
      mb.use(main('lib:wood-walnut'), surf)
      B(0, 0.43, 0, W, 0.66, D)
      mb.use(mats.get('lib:marble-carrara'), surf)
      B(0, 0.8, 0, W + 0.02, 0.04, D + 0.02)
      mb.use(white, surf)
      Cyl(0, 0.82, 0.02, 0.2, 0.18, 0.12, 16)
      mb.use(mats.flat('#dfe9ee', 'house', { roughness: 0.02, metalness: 0.9 }), surf)
      B(0, 1.55, -D / 2 + 0.01, Math.min(W, 0.9), 0.8, 0.01)
      break
    }
    case 'rug':
      mb.use(main('lib:fabric-linen'), surf)
      B(0, 0.006, 0, W, 0.012, D)
      break
    case 'plant':
      mb.use(mats.get('lib:concrete-smooth'), surf)
      Cyl(0, 0, 0, W * 0.32, W * 0.4, 0.4, 12)
      mb.use(mats.flat('#4c7a3d', 'house', { roughness: 0.9 }), surf)
      Sph(0, 0.75, 0, W * 0.5, Hh * 0.35, W * 0.5)
      Sph(0.08, 1.0, -0.05, W * 0.35, Hh * 0.25, W * 0.35)
      break
    case 'lamp':
      mb.use(chrome, surf)
      Cyl(0, 0, 0, 0.15, 0.15, 0.03, 12)
      Cyl(0, 0.03, 0, 0.012, 0.012, Hh - 0.35, 6)
      mb.use(mats.flat('#f3ead9', 'house', { emissive: new THREE.Color('#ffdfaa'), emissiveIntensity: 0.4 }), surf)
      Cyl(0, Hh - 0.35, 0, 0.2, 0.14, 0.3, 14)
      break
    case 'art':
      mb.use(dark, surf)
      B(0, Hh / 2, 0, W, Hh, 0.03)
      mb.use(mats.get('lib:wallpaper-geometric'), surf)
      B(0, Hh / 2, 0.016, W - 0.08, Hh - 0.08, 0.004)
      break
    case 'car': {
      const paint = mats.flat(f.color ?? CAR_PAINTS[Math.abs(hashStr(f.id)) % CAR_PAINTS.length], 'house', { roughness: 0.25, metalness: 0.6 })
      mb.use(paint, surf)
      B(0, 0.5, 0, W, 0.55, D)
      B(0, 0.95, -0.15, W * 0.86, 0.42, D * 0.5)
      mb.use(dark, surf)
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1]
      ])
        B(sx * (W / 2 - 0.05), 0.32, sz * (D / 2 - 0.75), 0.22, 0.64, 0.64)
      glassMb.use(mats.get('lib:glass-grey'), surf, { castShadow: false })
      G(0, 0.98, -0.15, W * 0.87, 0.34, D * 0.51)
      mb.use(mats.flat('#fff7e0', 'house', { emissive: new THREE.Color('#fff2cc'), emissiveIntensity: 0.2 }), surf)
      B(-W / 2 + 0.25, 0.6, D / 2, 0.3, 0.1, 0.02)
      B(W / 2 - 0.25, 0.6, D / 2, 0.3, 0.1, 0.02)
      break
    }
    case 'ev-charger':
      mb.use(white, surf)
      B(0, 0, 0, W, 0.45, D)
      mb.use(mats.flat('#46b37b', 'house', { emissive: new THREE.Color('#46b37b'), emissiveIntensity: 0.6 }), surf)
      B(0, 0.1, D / 2, 0.08, 0.02, 0.01)
      break
    case 'washer':
      mb.use(white, surf)
      B(0, Hh / 2, 0, W, Hh, D)
      mb.use(dark, surf)
      B(0, Hh * 0.45, D / 2 + 0.003, W * 0.6, W * 0.6, 0.01)
      break
    case 'tank':
      mb.use(main(f.type === 'water-tank' ? 'lib:metal-black' : 'lib:paint-warm-white'), surf)
      Cyl(0, 0, 0, W / 2, W / 2, Hh, 18)
      break
    case 'solar': {
      mb.use(mats.get('lib:metal-aluminum'), surf)
      B(0, 0.25, D / 3, 0.05, 0.5, 0.05)
      B(0, 0.25, -D / 3, 0.05, 0.5, 0.05)
      mb.use(mats.flat('#1b2a3d', 'house', { roughness: 0.15, metalness: 0.3 }), surf)
      const tilt = 0.4
      const cx = f.position.x
      const cz = f.position.y
      const hx = W / 2
      const hz = D / 2
      const P = (x: number, z: number, y: number): [number, number, number] => [cx + x * cs - z * sn, E + y, cz + x * sn + z * cs]
      mb.quad(P(-hx, -hz, 0.3 + tilt * 1.2), P(hx, -hz, 0.3 + tilt * 1.2), P(hx, hz, 0.3), P(-hx, hz, 0.3))
      break
    }
    case 'treadmill':
      mb.use(dark, surf)
      B(0, 0.12, 0.1, W, 0.18, D - 0.2)
      B(0, 0.75, -D / 2 + 0.1, W, 0.1, 0.1)
      B(-W / 2 + 0.04, 0.6, -D / 2 + 0.2, 0.05, 1.2, 0.05)
      B(W / 2 - 0.04, 0.6, -D / 2 + 0.2, 0.05, 1.2, 0.05)
      break
    case 'bench':
      mb.use(dark, surf)
      B(0, 0.45, 0.3, 0.3, 0.08, 1.2)
      B(0, 1.0, -0.6, W, 0.05, 0.05)
      B(-W / 2 + 0.1, 0.6, -0.6, 0.06, 1.2, 0.06)
      B(W / 2 - 0.1, 0.6, -0.6, 0.06, 1.2, 0.06)
      break
    case 'bike':
      mb.use(dark, surf)
      B(0, 0.1, 0, 0.1, 0.2, D)
      B(0, 0.6, -0.3, 0.06, 1.0, 0.06)
      B(0, 0.95, 0.3, 0.3, 0.06, 0.3)
      break
    case 'screen':
      mb.use(mats.flat('#f7f7f7', 'house', { roughness: 0.95, emissive: new THREE.Color('#9fb8ff'), emissiveIntensity: 0.05 }), surf)
      B(0, Hh / 2, 0, W, Hh, 0.03)
      break
    case 'pool-table':
      mb.use(wood('lib:wood-walnut'), surf)
      B(0, 0.55, 0, W, 0.3, D)
      legs(W, D, 0.45, 0.14, 0.12)
      mb.use(mats.flat('#1f6b45', 'house', { roughness: 1 }), surf)
      B(0, 0.705, 0, W - 0.2, 0.01, D - 0.2)
      break
    case 'lounger':
      mb.use(main('lib:wood-teak'), surf)
      B(0, 0.2, 0.2, W, 0.06, D - 0.5)
      mb.use(col('#e9e4da'), surf)
      B(0, 0.26, 0.2, W - 0.06, 0.06, D - 0.55)
      B(0, 0.45, -D / 2 + 0.3, W - 0.06, 0.4, 0.3)
      break
    default:
      mb.use(main('lib:wood-oak'), surf)
      B(0, Hh / 2, 0, W, Hh, D)
  }
}

function hashStr(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
