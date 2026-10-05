import * as THREE from 'three'
import type { Floor, HouseState, MaterialDef, Opening, Room, SurfaceRef, Vec2, Wall, Exterior } from '../../core/model/types'
import { MeshBuilder, type V3 } from '../MeshBuilder'
import type { MaterialManager } from '../materials/MaterialManager'
import { wallFrames, wallPieces, type WallFrame } from '../../planner/wallGeometry'
import { wallsOfRoom } from '../../planner/walls'
import { spec } from '../../core/constraints/rooms'
import { stairGeometry } from '../../planner/stairs'
import { differencePolys, unionPolys, bbox, pointInPolygon, area } from '../../core/geometry/polygon'
import { lightsForRoom } from '../../planner/services'
import { buildFurniture } from './furniture'
import { sortedFloors, floorAbove, floorBelow } from '../../core/model/house'

/**
 * STRUCTURED MODEL → 3D GEOMETRY (§9, §55). Every mesh is generated from the house model:
 * walls with real door/window openings, slabs with stair openings, finishes per room, ceilings,
 * doors that swing, framed windows with glass, stairs of every type, columns and roofs.
 * Plan (x, y) maps to world (x, z); y is up; each floor is built at its own elevation.
 */

export interface BuildContext {
  house: HouseState
  mats: MaterialManager
  custom: MaterialDef[]
  doorsOpen: boolean
  showFurniture: boolean
  showStructure: boolean
  showCeilings: boolean
  pitchedRoofCoversTop: boolean
  plinth: number
}

export interface FloorBuild {
  group: THREE.Group
  /** Light fixture positions in floor-local coordinates (for night lighting). */
  lights: { p: THREE.Vector3; kind: string; roomId: string; warm: boolean; basement: boolean; on: boolean; intensity: number; kelvin?: number }[]
  /** Collision segments for walkthrough (plan coords). */
  colliders: { a: Vec2; b: Vec2; r: number }[]
}

const SLAB_EPS = 0.004

export function buildFloor(floor: Floor, ctx: BuildContext): FloorBuild {
  const mb = new MeshBuilder()
  const glassMb = new MeshBuilder()
  const lights: FloorBuild['lights'] = []
  const colliders: FloorBuild['colliders'] = []
  const { mats, house } = ctx
  const floors = sortedFloors(house.floors)
  const above = floorAbove(floors, floor)
  const below = floorBelow(floors, floor)
  const ext = house.exterior
  const H = floor.height
  const slab = floor.slabThickness
  const fid = floor.id

  const wallFinish = (r: Room) => r.wallMaterial ?? spec(r.type).wallFinish
  const floorFinish = (r: Room) => r.floorMaterial ?? spec(r.type).floorFinish
  const concrete = mats.get('lib:concrete-smooth')

  // ── per-wall room segments on each side ─────────────────────────────────
  const sideSegs = new Map<string, { left: { t0: number; t1: number; room: Room }[]; right: { t0: number; t1: number; room: Room }[] }>()
  for (const r of floor.rooms) {
    for (const x of wallsOfRoom(floor, r)) {
      let s = sideSegs.get(x.wall.id)
      if (!s) sideSegs.set(x.wall.id, (s = { left: [], right: [] }))
      s[x.side].push({ t0: x.t0, t1: x.t1, room: r })
    }
  }
  const roomAt = (w: Wall, side: 'left' | 'right', t: number) => sideSegs.get(w.id)?.[side].find((s) => t >= s.t0 - 1e-4 && t <= s.t1 + 1e-4)?.room

  const mainDoorWall = floor.level === 0 ? floor.openings.find((o) => o.style === 'main')?.wallId : undefined
  const exteriorMat = (w: Wall, f: WallFrame, t: number): string => {
    // the indoor room behind the wall (a terrace or balcony in front of it is outside)
    const l = roomAt(w, 'left', t)
    const r = roomAt(w, 'right', t)
    const inside = [l, r].find((x) => x && !spec(x.type).outdoor) ?? l ?? r
    const facesFront = inside ? outwardDir(f, inside) === 'front' : false
    const hits = (placement: Exterior['accent']) => {
      switch (placement) {
        case 'ground-floor':
          return floor.level === 0
        case 'entrance':
          return w.id === mainDoorWall
        case 'stair-tower':
          return inside?.type === 'stair' || inside?.type === 'mumty'
        case 'front-feature':
          return (facesFront && floor.level >= 1 && !!inside && (inside.type === 'master_bedroom' || inside.type === 'family' || inside.type === 'bedroom') && isWidestFront(floor, inside)) || (facesFront && inside?.type === 'stair')
        default:
          return false
      }
    }
    if (hits(ext.accent)) return ext.accentMaterial
    if (ext.accent2 && hits(ext.accent2.placement)) return ext.accent2.material
    return ext.facadeMaterial
  }
  const sideMaterial = (w: Wall, f: WallFrame, side: 'left' | 'right', t: number): { id: string; surface: SurfaceRef } => {
    const override = w.sideMaterials?.[side]
    const room = roomAt(w, side, t)
    if (override) return { id: override, surface: { kind: 'wallSide', floorId: fid, wallId: w.id, side, roomId: room?.id } }
    if (room && !spec(room.type).outdoor && !(room.type === 'void' && room.openToSky) && room.type !== 'garage') return { id: wallFinish(room), surface: { kind: 'wallSide', floorId: fid, wallId: w.id, side, roomId: room.id } }
    if (room?.type === 'garage') return { id: room.wallMaterial ?? ext.facadeMaterial, surface: { kind: 'wallSide', floorId: fid, wallId: w.id, side, roomId: room.id } }
    return { id: exteriorMat(w, f, t), surface: { kind: 'exteriorWall', floorId: fid, wallId: w.id } }
  }

  // ── walls ───────────────────────────────────────────────────────────────
  for (const f of wallFrames(floor)) {
    const w = f.wall
    const th = w.thickness
    const hn = th / 2
    if (f.kind === 'railing') {
      buildRailing(mb, glassMb, mats, f, 'glass', fid)
      colliders.push({ a: w.a, b: w.b, r: 0.08 })
      continue
    }
    const segs = sideSegs.get(w.id)
    const breaks = new Set<number>()
    for (const s of [...(segs?.left ?? []), ...(segs?.right ?? [])]) {
      breaks.add(s.t0)
      breaks.add(s.t1)
    }
    const pieces = wallPieces(f, floor.openings)
    for (const p of pieces) {
      const cuts = [p.t0, ...[...breaks].filter((b) => b > p.t0 + 0.01 && b < p.t1 - 0.01).sort((a, b) => a - b), p.t1]
      for (let k = 0; k < cuts.length - 1; k++) {
        const t0 = cuts[k]
        const t1 = cuts[k + 1]
        const tm = Math.min(Math.max((t0 + t1) / 2, 0.001), f.L - 0.001)
        const L = sideMaterial(w, f, 'left', tm)
        const R = sideMaterial(w, f, 'right', tm)
        const A = (t: number, s: number): Vec2 => ({ x: w.a.x + f.dir.x * t + f.n.x * s, y: w.a.y + f.dir.y * t + f.n.y * s })
        const v = (q: Vec2, y: number): V3 => [q.x, y, q.y]
        const la = A(t0, hn)
        const lb = A(t1, hn)
        const ra = A(t0, -hn)
        const rb = A(t1, -hn)
        const u0 = t0
        const u1 = t1
        // left face (normal +n)
        mb.use(mats.get(L.id), L.surface)
        mb.face([v(lb, p.z0), v(la, p.z0), v(la, p.z1), v(lb, p.z1)], [[-u1, p.z0], [-u0, p.z0], [-u0, p.z1], [-u1, p.z1]], [f.n.x, 0, f.n.y])
        // right face (normal −n)
        mb.use(mats.get(R.id), R.surface)
        mb.face([v(ra, p.z0), v(rb, p.z0), v(rb, p.z1), v(ra, p.z1)], [[u0, p.z0], [u1, p.z0], [u1, p.z1], [u0, p.z1]], [-f.n.x, 0, -f.n.y])
        // top / bottom (sills, lintels, parapet coping)
        const capMat = f.kind === 'parapet' ? mats.get('lib:stone-limestone') : mats.get(L.id)
        mb.use(capMat, L.surface)
        if (p.z1 < f.height - 1e-3 || f.kind === 'parapet' || !above) mb.face([v(la, p.z1), v(ra, p.z1), v(rb, p.z1), v(lb, p.z1)], [[la.x, la.y], [ra.x, ra.y], [rb.x, rb.y], [lb.x, lb.y]], [0, 1, 0])
        if (p.z0 > 1e-3) mb.face([v(lb, p.z0), v(rb, p.z0), v(ra, p.z0), v(la, p.z0)], [[lb.x, lb.y], [rb.x, rb.y], [ra.x, ra.y], [la.x, la.y]], [0, -1, 0])
        // end caps (jambs / free ends)
        if (k === 0) mb.face([v(ra, p.z0), v(la, p.z0), v(la, p.z1), v(ra, p.z1)], [[0, p.z0], [th, p.z0], [th, p.z1], [0, p.z1]], [-f.dir.x, 0, -f.dir.y])
        if (k === cuts.length - 2) mb.face([v(lb, p.z0), v(rb, p.z0), v(rb, p.z1), v(lb, p.z1)], [[0, p.z0], [th, p.z0], [th, p.z1], [0, p.z1]], [f.dir.x, 0, f.dir.y])
      }
      if (p.z0 < 0.4) colliders.push({ a: { x: w.a.x + f.dir.x * p.t0, y: w.a.y + f.dir.y * p.t0 }, b: { x: w.a.x + f.dir.x * p.t1, y: w.a.y + f.dir.y * p.t1 }, r: th / 2 })
    }
    if (f.kind === 'parapet') {
      // coping overhang
      const cop = mats.get('lib:stone-limestone')
      mb.use(cop, { kind: 'exteriorWall', floorId: fid, wallId: w.id })
      const c = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }
      mb.box(c.x, f.height + 0.03, c.y, f.L + f.extA + f.extB, 0.06, th + 0.06, -Math.atan2(f.dir.y, f.dir.x))
    }
  }

  // ── openings ────────────────────────────────────────────────────────────
  const frames = new Map(wallFrames(floor).map((f) => [f.wall.id, f]))
  for (const o of floor.openings) {
    const f = frames.get(o.wallId)
    if (!f) continue
    buildOpening(mb, glassMb, ctx, floor, f, o, roomAt)
  }

  // ── slabs, finishes, ceilings ───────────────────────────────────────────
  const solidRooms = floor.rooms.filter((r) => r.type !== 'void' && !r.openToSky)
  const stairHolesHere = below ? below.stairs.map((s) => stairGeometry(s, below.height).outline) : []
  const merged = unionPolys(solidRooms.map((r) => r.polygon))
  if (floor.level === 0) {
    // plinth: from natural ground up to the finished floor
    const plinth = ctx.plinth
    mb.use(mats.get(ext.plinthMaterial), { kind: 'exteriorWall', floorId: fid })
    for (const m of unionPolys(floor.rooms.filter((r) => r.type !== 'void' && !spec(r.type).outdoor).map((r) => r.polygon))) mb.slab(m.outer, -plinth, -SLAB_EPS, m.holes, { top: false, bottom: false })
    for (const r of floor.rooms.filter((r) => r.type === 'garage')) {
      mb.use(mats.get(ext.plinthMaterial), { kind: 'exteriorWall', floorId: fid })
      mb.slab(r.polygon, -plinth, -SLAB_EPS, [], { top: false, bottom: false })
    }
  } else {
    mb.use(concrete, null)
    for (const m of merged) mb.slab(m.outer, -slab, -SLAB_EPS, [...m.holes, ...stairHolesHere.filter((h) => pointInPolygon(centerOf(h), m.outer))])
  }
  for (const r of solidRooms) {
    const holes = stairHolesHere.filter((h) => pointInPolygon(centerOf(h), r.polygon))
    const fin = floorFinish(r)
    mb.use(mats.get(fin), { kind: 'roomFloor', floorId: fid, roomId: r.id })
    mb.hPoly(r.polygon, SLAB_EPS, true, holes)
  }
  // ceilings (and roofs over rooms with nothing above)
  const coverAbove = above ? unionPolys(above.rooms.filter((r) => r.type !== 'void' && !r.openToSky).map((r) => r.polygon)) : []
  const stairHolesUp = floor.stairs.map((s) => stairGeometry(s, floor.height).outline)
  for (const r of floor.rooms) {
    const sp = spec(r.type)
    if (r.type === 'void' || r.openToSky || r.type === 'courtyard') continue
    const indoor = !sp.outdoor
    const dh = r.doubleHeight && above ? above.height : 0
    const cy = H - slab + dh - 0.003
    const holes = stairHolesUp.filter((h) => pointInPolygon(centerOf(h), r.polygon))
    if (indoor && ctx.showCeilings) {
      const ceilMat = mats.get(r.ceilingMaterial ?? spec(r.type).ceilingFinish)
      mb.use(ceilMat, { kind: 'roomCeiling', floorId: fid, roomId: r.id })
      if ((r.ceilingType === 'false-ceiling' || r.ceilingType === 'cove') && area(r.polygon) > 6) {
        const b = bbox(r.polygon)
        const inset = 0.45
        const inner: Vec2[] = [
          { x: b.x + inset, y: b.y + inset },
          { x: b.x + b.w - inset, y: b.y + inset },
          { x: b.x + b.w - inset, y: b.y + b.h - inset },
          { x: b.x + inset, y: b.y + b.h - inset }
        ]
        mb.hPoly(inner, cy, false, [])
        const band = differencePolys(r.polygon, inner)
        for (const bnd of band) mb.hPoly(bnd.outer, cy - 0.22, false, bnd.holes)
        mb.extrudeSides([...inner].reverse(), cy - 0.22, cy)
        if (r.ceilingType === 'cove') {
          const glow = mats.flat('#ffe6b8', 'house', { emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0.0 })
          glow.userData.emissiveLight = true
          mb.use(glow, null, { castShadow: false })
          mb.extrudeSides([...inner].reverse(), cy - 0.2, cy - 0.16)
        }
      } else mb.hPoly(r.polygon, cy, false, holes)
    }
    // exposed roof: parts of this room with nothing above
    const exposed = coverAbove.length ? differencePolys(r.polygon, ...coverAbove.map((c) => c.outer)) : [{ outer: r.polygon, holes: [] as Vec2[][] }]
    const isTopUnderPitched = !above && ctx.pitchedRoofCoversTop && floor.kind !== 'roof'
    if (indoor && !isTopUnderPitched) {
      for (const e of exposed) {
        if (area(e.outer) < 0.05) continue
        mb.use(mats.get(ext.roofMaterial), { kind: 'roof' })
        mb.slab(e.outer, H - slab + dh, H + dh, [...e.holes, ...holes], { bottom: false })
      }
    } else if (r.type === 'garage' && !above) {
      mb.use(mats.get(ext.roofMaterial), { kind: 'roof' })
      mb.slab(r.polygon, H - slab, H, [], {})
    } else if (r.type === 'garage') {
      for (const e of exposed) if (area(e.outer) > 0.05) {
        mb.use(concrete, { kind: 'roof' })
        mb.slab(e.outer, H - slab, H, e.holes, {})
      }
    }
    if (indoor || r.type === 'garage') {
      for (const l of lightsForRoom(r)) {
        lights.push({ p: new THREE.Vector3(l.p.x, cy - 0.05, l.p.y), kind: l.kind, roomId: r.id, warm: !['kitchen', 'bathroom', 'garage', 'laundry', 'store', 'mechanical'].includes(r.type), basement: floor.kind === 'basement', on: r.lighting?.on !== false, intensity: r.lighting?.intensity ?? 1, kelvin: r.lighting?.temperature })
        const em = mats.flat('#fff4e0', 'house', { emissive: new THREE.Color('#fff1d6'), emissiveIntensity: 0.2 })
        em.userData.emissiveLight = true
        mb.use(em, null, { castShadow: false })
        if (l.kind === 'chandelier') {
          mb.sphere(l.p.x, cy - 0.55, l.p.y, 0.32, 0.22, 0.32, 10)
          mb.use(mats.get('lib:metal-brass'), null)
          mb.cylinder(l.p.x, cy - 0.35, l.p.y, 0.01, 0.01, 0.35, 4, false)
        } else if (l.kind === 'pendant') mb.sphere(l.p.x, cy - 0.7, l.p.y, 0.14, 0.12, 0.14, 8)
        else if (l.kind === 'light') mb.cylinder(l.p.x, cy - 0.06, l.p.y, 0.22, 0.22, 0.05, 14)
        else mb.cylinder(l.p.x, cy - 0.012, l.p.y, 0.06, 0.06, 0.01, 10)
      }
    }
  }

  // ── stairs ──────────────────────────────────────────────────────────────
  for (const s of floor.stairs) {
    const g = stairGeometry(s, H)
    const smat = mats.get(s.material ?? 'lib:marble-botticino')
    const floating = s.type === 'floating' || s.type === 'modern'
    mb.use(smat, { kind: 'stair', floorId: fid, stairId: s.id })
    for (const t of g.treads) {
      const bottom = t.kind === 'landing' ? t.z - 0.16 : floating ? t.z - 0.06 : s.type === 'spiral' ? t.z - 0.05 : Math.max(0, t.z - g.riser - 0.04)
      mb.slab(t.poly, bottom, t.z, [])
    }
    if (s.type === 'spiral') {
      mb.use(mats.get('lib:metal-black'), { kind: 'stair', floorId: fid, stairId: s.id })
      const c = centerOf(g.outline)
      mb.cylinder(c.x, 0, c.y, 0.09, 0.09, H + 1, 12)
    }
    const rail = s.railing
    if (rail !== 'none') {
      for (const r of g.rails) buildStairRail(mb, glassMb, mats, r, rail, s.railingMaterial, fid, s.id)
    }
  }

  // ── columns ─────────────────────────────────────────────────────────────
  if (ctx.showStructure) {
    for (const c of floor.columns) {
      const mat = mats.get(c.material ?? (c.exposed ? ext.facadeMaterial : 'lib:plaster-grey'))
      mb.use(mat, { kind: 'column', floorId: fid, columnId: c.id })
      if (c.shape === 'round') mb.cylinder(c.position.x, 0, c.position.y, c.width / 2, c.width / 2, H - 0.001, 16)
      else mb.box(c.position.x, H / 2, c.position.y, c.width + 0.004, H - 0.002, c.depth + 0.004, -c.rotation)
      if (c.exposed) {
        colliders.push({ a: c.position, b: c.position, r: c.width / 2 + 0.05 })
        if (ext.columnStyle === 'classical') {
          mb.use(mats.get('lib:stone-limestone'), { kind: 'column', floorId: fid, columnId: c.id })
          mb.box(c.position.x, 0.1, c.position.y, c.width + 0.14, 0.2, c.depth + 0.14, 0)
          mb.box(c.position.x, H - 0.12, c.position.y, c.width + 0.14, 0.18, c.depth + 0.14, 0)
        }
      }
    }
  }

  // ── entrance canopy over the main door (§33) ────────────────────────────
  if (floor.level === 0 && ext.entranceCanopy) {
    for (const o of floor.openings.filter((x) => x.style === 'main')) {
      const w = floor.walls.find((x) => x.id === o.wallId)
      if (!w) continue
      const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
      if (L < 1e-3) continue
      const dir = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L }
      const n = { x: -dir.y, y: dir.x }
      const left = roomAt(w, 'left', o.offset)
      const out = left && !spec(left.type).outdoor ? -1 : 1
      const depth = 1.3
      const z = Math.min(H - slab - 0.12, o.sill + o.height + 0.35)
      const c = { x: w.a.x + dir.x * o.offset + n.x * out * (w.thickness / 2 + depth / 2), y: w.a.y + dir.y * o.offset + n.y * out * (w.thickness / 2 + depth / 2) }
      mb.use(mats.get(ext.accent !== 'none' ? ext.accentMaterial : ext.facadeMaterial), { kind: 'exteriorWall', floorId: fid, wallId: w.id })
      mb.box(c.x, z, c.y, o.width + 1.0, 0.16, depth, -Math.atan2(dir.y, dir.x))
      if (ext.entrancePillars) {
        // two pillars at the canopy's outer corners
        const reach = depth - 0.2
        const half = (o.width + 1.0) / 2 - 0.18
        for (const sgn of [-1, 1]) {
          const px = w.a.x + dir.x * (o.offset + sgn * half) + n.x * out * (w.thickness / 2 + reach)
          const py = w.a.y + dir.y * (o.offset + sgn * half) + n.y * out * (w.thickness / 2 + reach)
          const ph = z - 0.08
          if (ext.columnStyle === 'square') mb.box(px, ph / 2, py, 0.3, ph, 0.3, -Math.atan2(dir.y, dir.x))
          else {
            mb.cylinder(px, 0, py, 0.15, 0.15, ph, 16)
            if (ext.columnStyle === 'classical') {
              mb.box(px, 0.08, py, 0.42, 0.16, 0.42, 0)
              mb.box(px, ph - 0.08, py, 0.42, 0.16, 0.42, 0)
            }
          }
        }
      }
      lights.push({ p: new THREE.Vector3(c.x, z - 0.12, c.y), kind: 'downlight', roomId: '', warm: true, basement: false, on: true, intensity: 1 })
    }
  }

  // ── furniture ───────────────────────────────────────────────────────────
  if (ctx.showFurniture) buildFurniture(mb, glassMb, mats, floor, ctx)

  const group = new THREE.Group()
  group.name = `floor:${floor.id}`
  group.userData.floorId = floor.id
  const solid = mb.build('solid')
  solid.userData.floorId = floor.id
  group.add(solid)
  const glass = glassMb.build('glass')
  glass.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = false
      o.renderOrder = 2
    }
  })
  group.add(glass)
  return { group, lights, colliders }
}

function centerOf(poly: Vec2[]): Vec2 {
  const b = bbox(poly)
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

function outwardDir(f: WallFrame, inside: Room): 'front' | 'back' | 'left' | 'right' {
  const c = centerOf(inside.polygon)
  const mid = { x: (f.wall.a.x + f.wall.b.x) / 2, y: (f.wall.a.y + f.wall.b.y) / 2 }
  const dx = mid.x - c.x
  const dy = mid.y - c.y
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? 'front' : 'back'
  return dx > 0 ? 'right' : 'left'
}

function isWidestFront(floor: Floor, room: Room) {
  const b = bbox(room.polygon)
  const front = b.y + b.h
  const candidates = floor.rooms.filter((r) => ['master_bedroom', 'family', 'bedroom'].includes(r.type) && Math.abs(bbox(r.polygon).y + bbox(r.polygon).h - front) < 0.05)
  return candidates.sort((a, c) => bbox(c.polygon).w - bbox(a.polygon).w)[0]?.id === room.id
}

function buildRailing(mb: MeshBuilder, glassMb: MeshBuilder, mats: MaterialManager, f: WallFrame, style: 'glass' | 'metal', fid: string) {
  const w = f.wall
  const H = 1.05
  const c = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }
  const rot = -Math.atan2(f.dir.y, f.dir.x)
  const metal = mats.get('lib:metal-black')
  mb.use(metal, { kind: 'exteriorWall', floorId: fid, wallId: w.id })
  mb.box(c.x, H, c.y, f.L, 0.05, 0.06, rot)
  mb.box(c.x, 0.04, c.y, f.L, 0.08, 0.06, rot)
  const n = Math.max(1, Math.round(f.L / 1.2))
  for (let i = 0; i <= n; i++) {
    const t = (f.L * i) / n
    mb.box(w.a.x + f.dir.x * t, H / 2, w.a.y + f.dir.y * t, 0.04, H, 0.04, rot)
  }
  if (style === 'glass') {
    glassMb.use(mats.get('lib:glass-clear'), { kind: 'exteriorWall', floorId: fid, wallId: w.id }, { castShadow: false })
    glassMb.box(c.x, H / 2 + 0.02, c.y, f.L, H - 0.1, 0.012, rot)
  }
}

function buildStairRail(mb: MeshBuilder, glassMb: MeshBuilder, mats: MaterialManager, r: { a: Vec2; b: Vec2; za: number; zb: number }, kind: 'glass' | 'metal' | 'wood', matId: string | undefined, fid: string, sid: string) {
  const L = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y)
  if (L < 0.02) return
  const H = 0.92
  const surf: SurfaceRef = { kind: 'stair', floorId: fid, stairId: sid }
  const hand = mats.get(matId ?? (kind === 'wood' ? 'lib:wood-walnut' : 'lib:metal-black'))
  const v = (p: Vec2, y: number): V3 => [p.x, y, p.y]
  // handrail as a thin sloped box made of 4 faces
  const d = { x: (r.b.x - r.a.x) / L, y: (r.b.y - r.a.y) / L }
  const n = { x: -d.y * 0.025, y: d.x * 0.025 }
  const a1 = { x: r.a.x + n.x, y: r.a.y + n.y }
  const a2 = { x: r.a.x - n.x, y: r.a.y - n.y }
  const b1 = { x: r.b.x + n.x, y: r.b.y + n.y }
  const b2 = { x: r.b.x - n.x, y: r.b.y - n.y }
  mb.use(hand, surf)
  const ya = r.za + H
  const yb = r.zb + H
  mb.quad(v(a1, ya + 0.04), v(b1, yb + 0.04), v(b2, yb + 0.04), v(a2, ya + 0.04))
  mb.quad(v(a2, ya), v(b2, yb), v(b1, yb), v(a1, ya))
  mb.quad(v(a1, ya), v(b1, yb), v(b1, yb + 0.04), v(a1, ya + 0.04))
  mb.quad(v(b2, yb), v(a2, ya), v(a2, ya + 0.04), v(b2, yb + 0.04))
  if (kind === 'glass') {
    glassMb.use(mats.get('lib:glass-clear'), surf, { castShadow: false })
    glassMb.quad(v(r.a, r.za + 0.05), v(r.b, r.zb + 0.05), v(r.b, yb - 0.02), v(r.a, ya - 0.02))
  } else {
    const count = Math.max(1, Math.floor(L / (kind === 'wood' ? 0.14 : 0.12)))
    const bal = mats.get(kind === 'wood' ? 'lib:wood-walnut' : 'lib:metal-black')
    mb.use(bal, surf)
    for (let i = 0; i <= count; i++) {
      const t = i / count
      const p = { x: r.a.x + (r.b.x - r.a.x) * t, y: r.a.y + (r.b.y - r.a.y) * t }
      const z = r.za + (r.zb - r.za) * t
      const s = kind === 'wood' ? 0.035 : 0.018
      mb.box(p.x, z + H / 2, p.y, s, H, s, 0, { top: false, bottom: false })
    }
  }
}

function buildOpening(mb: MeshBuilder, glassMb: MeshBuilder, ctx: BuildContext, floor: Floor, f: WallFrame, o: Opening, roomAt: (w: Wall, side: 'left' | 'right', t: number) => Room | undefined) {
  const { mats } = ctx
  const w = f.wall
  const th = Math.max(w.thickness, 0.08)
  const rot = -Math.atan2(f.dir.y, f.dir.x)
  const c = { x: w.a.x + f.dir.x * o.offset, y: w.a.y + f.dir.y * o.offset }
  const ext = ctx.house.exterior
  const surf: SurfaceRef = { kind: 'wallSide', floorId: floor.id, wallId: w.id, side: 'left' }
  const frameMat = mats.get(o.frameMaterial ?? (o.kind === 'window' ? ext.windowFrameMaterial : o.style === 'main' ? 'lib:wood-walnut' : 'lib:wood-oak'))
  const at = (t: number, s: number, y: number): V3 => [c.x + f.dir.x * t + f.n.x * s, y, c.y + f.dir.y * t + f.n.y * s]
  const W = o.width
  const Hh = o.height
  const s0 = o.sill
  const fr = 0.05
  const frameDepth = o.kind === 'window' ? 0.08 : th + 0.02
  const along = (t: number, y: number, len: number, hgt: number, depth: number, off = 0) => {
    const p = at(t, off, y)
    mb.box(p[0], p[1], p[2], len, hgt, depth, rot)
  }
  if (o.kind === 'window') {
    mb.use(frameMat, surf)
    // frame
    along(0, s0 + fr / 2, W, fr, frameDepth)
    along(0, s0 + Hh - fr / 2, W, fr, frameDepth)
    along(-W / 2 + fr / 2, s0 + Hh / 2, fr, Hh, frameDepth)
    along(W / 2 - fr / 2, s0 + Hh / 2, fr, Hh, frameDepth)
    // mullions
    const mull: number[] = []
    if (o.style === 'sliding' || o.style === 'casement') mull.push(0)
    if (o.style === 'full-height') for (let k = 1; k < Math.round(W / 1.1); k++) mull.push(-W / 2 + (W * k) / Math.round(W / 1.1))
    for (const m of mull) along(m, s0 + Hh / 2, 0.035, Hh, frameDepth * 0.8)
    if (o.style === 'full-height' && Hh > 2) along(0, s0 + Hh - 0.45, W, 0.035, frameDepth * 0.8)
    if (o.style === 'ventilator') for (let k = 1; k < 4; k++) along(0, s0 + (Hh * k) / 4, W - 2 * fr, 0.02, frameDepth * 0.6)
    // exterior sill
    if (s0 > 0.2) {
      const outer = roomAt(w, 'left', o.offset) ? -1 : 1
      mb.use(mats.get('lib:stone-limestone'), surf)
      along(0, s0 - 0.025, W + 0.1, 0.05, 0.1, outer * (th / 2 + 0.02))
    }
    glassMb.use(mats.get(o.style === 'ventilator' ? 'lib:glass-frosted' : 'lib:glass-clear'), surf, { castShadow: false })
    const g = at(0, 0, s0 + Hh / 2)
    glassMb.box(g[0], g[1], g[2], W - 2 * fr, Hh - 2 * fr, 0.01, rot)
    // the lit interior seen through an outside window: dark by day, warm glow at dusk and night.
    // A single outward-facing quad, so it is invisible from inside the room.
    const sides = (['left', 'right'] as const).map((sd) => ({ sd, room: roomAt(w, sd, o.offset) }))
    const inner = sides.find((x) => x.room && !spec(x.room.type).outdoor && x.room.type !== 'void')
    const outer = sides.find((x) => x !== inner)
    if (inner && (!outer?.room || spec(outer.room.type).outdoor)) {
      const sgn = inner.sd === 'left' ? 1 : -1
      const lit = inner.room!.lighting?.on !== false
      const gm = mats.flat('#0d131b', 'house', { roughness: 1, emissive: new THREE.Color(lit ? '#ffcf91' : '#000000'), emissiveIntensity: 0 })
      gm.userData.windowGlow = lit
      mb.use(gm, null, { castShadow: false, receiveShadow: false })
      const d0 = sgn * (th / 2 + 0.55)
      const hw = (W - 2 * fr) / 2
      const y0 = s0 + fr
      const y1 = s0 + Hh - fr
      const q = [at(-hw, d0, y0), at(hw, d0, y0), at(hw, d0, y1), at(-hw, d0, y1)]
      const nn: [number, number, number] = [-sgn * f.n.x, 0, -sgn * f.n.y]
      const uv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
      if (sgn === 1) mb.face([q[3], q[2], q[1], q[0]], [uv[3], uv[2], uv[1], uv[0]], nn)
      else mb.face(q, uv, nn)
    }
    // curtains on the room side
    for (const side of ['left', 'right'] as const) {
      const room = roomAt(w, side, o.offset)
      if (!room?.curtains?.enabled) continue
      const sgn = side === 'left' ? 1 : -1
      const floorH = floor.height - floor.slabThickness
      mb.use(mats.flat(room.curtains.color, 'house', { roughness: 1, side: THREE.DoubleSide }), { kind: 'roomCeiling', floorId: floor.id, roomId: room.id })
      const cw = Math.min(0.5, W * 0.25)
      for (const e of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          const t = e * (W / 2 + 0.1 - cw / 2) + (k - 1.5) * (cw / 4)
          const p = at(t, sgn * (th / 2 + 0.12 + (k % 2) * 0.03), floorH / 2 - 0.02)
          mb.box(p[0], p[1], p[2], cw / 4, floorH - 0.1, 0.02, rot)
        }
      }
      mb.use(mats.get('lib:metal-black'), null)
      const p = at(0, sgn * (th / 2 + 0.14), floorH - 0.12)
      mb.box(p[0], p[1], p[2], W + 0.6, 0.025, 0.025, rot)
    }
    return
  }
  // doors
  if (o.style === 'opening') {
    mb.use(frameMat, surf)
    along(-W / 2 - 0.01, Hh / 2, 0.03, Hh, th + 0.03)
    along(W / 2 + 0.01, Hh / 2, 0.03, Hh, th + 0.03)
    along(0, Hh + 0.015, W + 0.08, 0.03, th + 0.03)
    return
  }
  mb.use(frameMat, surf)
  along(-W / 2 + fr / 2, Hh / 2, fr, Hh, frameDepth)
  along(W / 2 - fr / 2, Hh / 2, fr, Hh, frameDepth)
  along(0, Hh - fr / 2, W, fr, frameDepth)
  const leafMat = mats.get(o.leafMaterial ?? (o.style === 'main' ? 'lib:wood-walnut' : o.style === 'garage' ? 'lib:metal-aluminum' : floor.rooms.some((r) => r.type === 'bathroom') && false ? 'lib:paint-warm-white' : 'lib:wood-oak'))
  if (o.style === 'garage') {
    mb.use(leafMat, surf)
    along(0, Hh / 2, W - 2 * fr, Hh - fr, 0.05)
    mb.use(mats.get('lib:metal-black'), surf)
    for (let k = 1; k < 5; k++) along(0, (Hh * k) / 5, W - 2 * fr, 0.015, 0.06)
    return
  }
  if (o.style === 'sliding' || o.style === 'french' || o.style === 'pocket') {
    // two glazed panels
    const pw = (W - 2 * fr) / 2 + 0.03
    for (const [k, off] of [
      [-1, -0.02],
      [1, 0.02]
    ] as [number, number][]) {
      const shift = ctx.doorsOpen && o.style !== 'french' && k === 1 ? -pw * 0.6 : 0
      mb.use(mats.get(ext.windowFrameMaterial), surf)
      const t = k * pw / 2 + shift
      along(t, Hh / 2, pw, 0.05, 0.04, off)
      along(t, fr, pw, 0.08, 0.04, off)
      along(t, Hh - fr - 0.02, pw, 0.05, 0.04, off)
      along(t - pw / 2 + 0.025, Hh / 2, 0.05, Hh - fr, 0.04, off)
      along(t + pw / 2 - 0.025, Hh / 2, 0.05, Hh - fr, 0.04, off)
      glassMb.use(mats.get('lib:glass-clear'), surf, { castShadow: false })
      const g = at(t, off, Hh / 2)
      glassMb.box(g[0], g[1], g[2], pw - 0.1, Hh - fr - 0.12, 0.01, rot)
    }
    return
  }
  // swing leaves
  const double = o.style === 'double' || o.style === 'main'
  const leaves = double ? [
    { hingeT: -W / 2 + fr, width: W / 2 - fr, dirSign: 1 },
    { hingeT: W / 2 - fr, width: W / 2 - fr, dirSign: -1 }
  ] : [{ hingeT: o.hinge === 'end' ? W / 2 - fr : -W / 2 + fr, width: W - 2 * fr, dirSign: o.hinge === 'end' ? -1 : 1 }]
  const swingSide = o.swing === 'right' ? -1 : 1
  const angle = ctx.doorsOpen ? (Math.PI / 180) * 80 : 0
  for (const l of leaves) {
    const hinge = { x: c.x + f.dir.x * l.hingeT, y: c.y + f.dir.y * l.hingeT }
    // leaf direction rotated from the wall direction towards the swing side
    const base = { x: f.dir.x * l.dirSign, y: f.dir.y * l.dirSign }
    const nrm = { x: f.n.x * swingSide, y: f.n.y * swingSide }
    const dx = base.x * Math.cos(angle) + nrm.x * Math.sin(angle)
    const dy = base.y * Math.cos(angle) + nrm.y * Math.sin(angle)
    const cx = hinge.x + dx * (l.width / 2) + nrm.x * (th / 2 - 0.02) * (ctx.doorsOpen ? 1 : 0)
    const cy = hinge.y + dy * (l.width / 2) + nrm.y * (th / 2 - 0.02) * (ctx.doorsOpen ? 1 : 0)
    const lr = -Math.atan2(dy, dx)
    mb.use(leafMat, surf)
    mb.box(cx, (Hh - fr) / 2 + 0.005, cy, l.width, Hh - fr - 0.01, 0.04, lr)
    if (o.style === 'main') {
      mb.use(mats.get('lib:wood-wenge'), surf)
      for (let k = 1; k < 4; k++) mb.box(cx + dx * (l.width * (k / 4 - 0.5)), (Hh - fr) / 2, cy + dy * (l.width * (k / 4 - 0.5)), 0.02, Hh - 0.4, 0.05, lr)
    }
    // handle
    mb.use(mats.get('lib:metal-brushed'), surf)
    const hx = hinge.x + dx * (l.width - 0.08)
    const hy = hinge.y + dy * (l.width - 0.08)
    mb.box(hx, 1.0, hy, 0.02, o.style === 'main' ? 0.6 : 0.12, 0.08, lr)
  }
}

/** Is a pitched roof going to cover the top floor (no flat roof floor)? */
export function hasPitchedRoof(h: HouseState) {
  return h.exterior.roofType !== 'flat' && !h.floors.some((f) => f.kind === 'roof')
}
