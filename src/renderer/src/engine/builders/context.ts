import * as THREE from 'three'
import type { Plot } from '../../core/model/types'
import { MeshBuilder } from '../MeshBuilder'
import type { MaterialManager } from '../materials/MaterialManager'
import { bbox } from '../../core/geometry/polygon'

/**
 * The street around the plot (amendment A13): neighbouring houses on both sides, as found in a
 * Pakistani housing society. Each has flat roofs with parapets, a water tank on the roof, a
 * boundary wall with a gate, and a plastered or brick-clad front. A house standing alone in an
 * endless field read as a computer model; with neighbours it reads as a place.
 *
 * Kept deliberately plain (massing with windows) so the design stays the subject. The road runs
 * along the plot's front edge (plan +y), so neighbours sit at plan x either side. They are hidden
 * in the flat elevation views.
 */

/** A small deterministic generator so a plot always gets the same street. */
function rng(seed: number) {
  let s = Math.floor(seed * 1000) % 2147483647 || 1
  return () => {
    s = (s * 48271) % 2147483647
    return s / 2147483647
  }
}

const FACADES = ['lib:render-white', 'lib:render-ivory', 'lib:paint-beige', 'lib:paint-off-white', 'lib:paint-greige', 'lib:plaster-grey']
const CLADDING = ['lib:brick-gutka', 'lib:stone-sandstone', 'lib:stone-ledgestone', 'lib:brick-red']

export function buildContext(plot: Plot, mats: MaterialManager, houseFront?: number): THREE.Group {
  const pb = bbox(plot.polygon)
  const mb = new MeshBuilder()
  const glass = mats.flat('#2a3138', 'site', { roughness: 0.08, metalness: 0.4 })
  // some windows are lit at night (the engine raises their glow after dusk), so the street looks lived in
  const litGlass = mats.flat('#262c33', 'site', { roughness: 0.08, metalness: 0.3, emissive: new THREE.Color('#ffc98a'), emissiveIntensity: 0 })
  litGlass.userData.windowGlow = true
  // a soft glow behind curtains, well below this house's own lit rooms
  litGlass.userData.glowScale = 0.22
  const pane = () => (random() < 0.35 ? litGlass : glass)
  const frame = mats.flat('#d8d6d0', 'site', { roughness: 0.5 })
  const dark = mats.flat('#3a3c3f', 'site', { roughness: 0.6 })
  const tank = mats.flat('#2b2e33', 'site', { roughness: 0.7 })
  const gate = mats.get('lib:metal-black', 'site')
  const random = rng(pb.w * 7.3 + pb.h * 3.1 + 11)
  const W = pb.w
  const D = pb.h
  const front = pb.y + D
  // two neighbours on each side, the same plot size as this one
  for (const side of [-1, 1]) {
    for (let k = 1; k <= 2; k++) {
      const x0 = side < 0 ? pb.x - k * W : pb.x + W + (k - 1) * W
      const seed = random()
      // the nearest neighbours stay at two storeys at most, so they frame the house rather than hide it
      const floors = seed < 0.3 ? 1 : seed < 0.92 || k === 1 ? 2 : 3
      const fh = 3.2
      // no neighbour comes forward of this house's front
      const minFront = houseFront !== undefined ? Math.max(2, front - houseFront) : 3
      const setFront = Math.max(minFront, 3) + random() * 1.5
      const setBack = 1.5 + random()
      const sideGap = 0.15
      const hx0 = x0 + sideGap
      const hw = W - sideGap * 2
      const hz0 = pb.y + setBack
      const hd = D - setFront - setBack
      const H = floors * fh + 0.45
      const cx = hx0 + hw / 2
      const cz = hz0 + hd / 2
      // the house
      mb.use(mats.get(FACADES[Math.floor(random() * FACADES.length)], 'site'), null)
      mb.box(cx, H / 2, cz, hw, H, hd)
      // parapet
      mb.box(cx, H + 0.5, cz + hd / 2 - 0.1, hw, 1, 0.2)
      mb.box(cx, H + 0.5, cz - hd / 2 + 0.1, hw, 1, 0.2)
      mb.box(hx0 + 0.1, H + 0.5, cz, 0.2, 1, hd - 0.4)
      mb.box(hx0 + hw - 0.1, H + 0.5, cz, 0.2, 1, hd - 0.4)
      // stair tower (mumty) and water tanks on the roof
      const mw = Math.min(3.2, hw * 0.3)
      const mx = side < 0 ? hx0 + hw - mw / 2 - 0.6 : hx0 + mw / 2 + 0.6
      mb.box(mx, H + 1.35, cz - hd * 0.15, mw, 2.7, 3.4)
      mb.use(tank, null)
      mb.cylinder(mx, H + 2.7, cz - hd * 0.15, 0.55, 0.55, 1.1, 12)
      if (random() < 0.6) mb.cylinder(mx + (side < 0 ? -1.3 : 1.3), H + 2.7, cz - hd * 0.15, 0.5, 0.5, 1, 12)
      // cladding band on part of the front, and a porch slab
      if (random() < 0.55) {
        mb.use(mats.get(CLADDING[Math.floor(random() * CLADDING.length)], 'site'), null)
        const cw = hw * (0.3 + random() * 0.25)
        mb.box(hx0 + (random() < 0.5 ? cw / 2 : hw - cw / 2), H / 2, hz0 + hd + 0.04, cw, H, 0.08)
      }
      mb.use(dark, null)
      mb.box(cx, fh - 0.1, hz0 + hd + 0.9, hw * 0.55, 0.2, 1.8)
      // windows on the front and the visible side, one row per floor
      for (let f = 0; f < floors; f++) {
        const y = f * fh + 1.55
        const n = Math.max(2, Math.floor(hw / 3.4))
        for (let i = 0; i < n; i++) {
          const wx = hx0 + (hw * (i + 0.5)) / n
          const ww = Math.min(1.8, (hw / n) * 0.55)
          mb.use(frame, null)
          mb.box(wx, y, hz0 + hd + 0.03, ww + 0.12, 1.42, 0.06)
          mb.use(pane(), null)
          mb.box(wx, y, hz0 + hd + 0.065, ww, 1.3, 0.02)
        }
        // the side facing this plot (k = 1) or the street end (k = 2)
        const sx = side < 0 ? hx0 + hw : hx0
        const ns = Math.max(1, Math.floor(hd / 4.5))
        for (let i = 0; i < ns; i++) {
          const wz = hz0 + (hd * (i + 0.5)) / ns
          mb.use(frame, null)
          // outwards from that side is -side (towards this plot for the nearer neighbour)
          mb.box(sx - side * 0.03, y, wz, 0.06, 1.25, 1.3)
          mb.use(pane(), null)
          mb.box(sx - side * 0.065, y, wz, 0.02, 1.12, 1.15)
        }
      }
      // paved forecourt between the house and the road
      mb.use(mats.get('lib:pavers-grey', 'site'), null)
      mb.box(x0 + W / 2, 0.02, (hz0 + hd + front) / 2, W - 0.4, 0.04, front - (hz0 + hd))
      // boundary wall on the road with a gate, and the side walls
      mb.use(mats.get(FACADES[0], 'site'), null)
      const wallH = 2.1
      const gw = Math.min(4.2, W * 0.32)
      const gx = side < 0 ? x0 + W - gw / 2 - 0.4 : x0 + gw / 2 + 0.4
      const leftLen = gx - gw / 2 - x0
      const rightLen = x0 + W - (gx + gw / 2)
      if (leftLen > 0.05) mb.box(x0 + leftLen / 2, wallH / 2, front - 0.1, leftLen, wallH, 0.2)
      if (rightLen > 0.05) mb.box(gx + gw / 2 + rightLen / 2, wallH / 2, front - 0.1, rightLen, wallH, 0.2)
      const outer = side < 0 ? x0 + 0.1 : x0 + W - 0.1
      if (k === 2) mb.box(outer, wallH / 2, pb.y + D / 2, 0.2, wallH, D)
      mb.box(x0 + W / 2, wallH / 2, pb.y + 0.1, W, wallH, 0.2)
      mb.use(gate, null)
      mb.box(gx, 0.95, front - 0.1, gw, 1.8, 0.05)
    }
  }
  // the row behind, back to back with this one (their fronts face the next street): their backs,
  // roofs and tanks close the block in views from above and from the garden
  for (let k = -2; k <= 2; k++) {
    const x0 = pb.x + k * W
    const floors = random() < 0.35 ? 1 : 2
    const H = floors * 3.2 + 0.45
    const back = pb.y - 0.2
    const hd = D - 1.6 - 4.5
    const hz1 = back - 1.6
    const cz = hz1 - hd / 2
    const hw = W - 0.3
    const cx = x0 + W / 2
    mb.use(mats.get(FACADES[Math.floor(random() * FACADES.length)], 'site'), null)
    mb.box(cx, H / 2, cz, hw, H, hd)
    mb.box(cx, H + 0.5, hz1 - 0.1, hw, 1, 0.2)
    mb.box(cx, H + 0.5, hz1 - hd + 0.1, hw, 1, 0.2)
    mb.box(x0 + 0.25, H + 0.5, cz, 0.2, 1, hd - 0.4)
    mb.box(x0 + W - 0.25, H + 0.5, cz, 0.2, 1, hd - 0.4)
    const mx = x0 + W * (0.3 + random() * 0.4)
    mb.box(mx, H + 1.35, cz, 3, 2.7, 3.4)
    mb.use(tank, null)
    mb.cylinder(mx, H + 2.7, cz, 0.55, 0.55, 1.1, 12)
    // the back wall's windows (towards this plot)
    for (let f = 0; f < floors; f++) {
      const n = Math.max(2, Math.floor(hw / 3.6))
      for (let i = 0; i < n; i++) {
        const wx = x0 + 0.15 + (hw * (i + 0.5)) / n
        mb.use(frame, null)
        mb.box(wx, f * 3.2 + 1.7, hz1 + 0.03, 1.2, 1.1, 0.06)
        mb.use(pane(), null)
        mb.box(wx, f * 3.2 + 1.7, hz1 + 0.065, 1.08, 0.98, 0.02)
      }
    }
    // the rear boundary wall between the rows (this plot builds its own)
    if (k !== 0) {
      mb.use(mats.get(FACADES[0], 'site'), null)
      mb.box(cx, 1.05, back, W, 2.1, 0.2)
    }
  }
  const g = mb.build('context')
  g.userData.context = true
  return g
}
