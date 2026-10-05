import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { HouseState, SiteObject, Vec2 } from '../../core/model/types'
import { MeshBuilder } from '../MeshBuilder'
import type { MaterialManager } from '../materials/MaterialManager'
import { bbox, rectPoly } from '../../core/geometry/polygon'
import { effectiveKind } from '../../planner/walls'
import { floorElevations, sortedFloors } from '../../core/model/house'
import { spec } from '../../core/constraints/rooms'

/** Site & landscape (§29): ground, road, lawns, pool, boundary wall, gates, trees, lights. */

export interface SiteBuild {
  group: THREE.Group
  lights: { p: THREE.Vector3; kind: 'garden' | 'lamp' | 'gate' | 'wash' | 'strip'; dir?: THREE.Vector3 }[]
  colliders: { a: Vec2; b: Vec2; r: number }[]
}

export function buildSite(h: HouseState, mats: MaterialManager, plinth: number): SiteBuild {
  const mb = new MeshBuilder()
  const glassMb = new MeshBuilder()
  const lights: SiteBuild['lights'] = []
  const colliders: SiteBuild['colliders'] = []
  const plot = h.plot
  const pb = bbox(plot.polygon)
  const group = new THREE.Group()
  group.name = 'site'

  // surrounding ground
  const groundMat = mats.get('lib:grass-field', 'site')
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.set(pb.x + pb.w / 2, -0.02, pb.y + pb.h / 2)
  ground.receiveShadow = true
  const g = ground.geometry as THREE.PlaneGeometry
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 600, uv.getY(i) * 600)
  uv.needsUpdate = true
  ground.userData.surface = null
  group.add(ground)

  // plot base (soil / gravel under everything)
  mb.use(mats.get('lib:gravel', 'site'), null)
  mb.hPoly(plot.polygon, 0.004, true)

  // road + kerb + footpath on the road side
  const roadY = pb.y + pb.h
  const road = { x: pb.x - 40, y: roadY + 1.5, w: pb.w + 80, h: plot.roadWidth }
  mb.use(mats.get('lib:asphalt', 'site'), null)
  mb.hPoly(rectPoly(road), 0.002, true)
  mb.use(mats.get('lib:pavers-grey', 'site'), null)
  mb.slab(rectPoly({ x: road.x, y: roadY, w: road.w, h: 1.5 }), 0, 0.12, [])
  mb.use(mats.flat('#e8e8e2', 'site'), null)
  for (let x = road.x; x < road.x + road.w; x += 6) mb.box(x + 1.5, 0.006, road.y + road.h / 2, 3, 0.004, 0.12)

  // site areas
  for (const a of h.site.areas) {
    const surf = { kind: 'siteArea' as const, areaId: a.id }
    const mat = mats.get(a.material ?? defaultAreaMat(a.kind), 'site')
    switch (a.kind) {
      case 'pool': {
        const depth = a.depth ?? 1.5
        mb.use(mats.get('lib:ceramic-blue-mosaic', 'site'), surf)
        // pool shell (inside faces)
        const b = bbox(a.polygon)
        const inner = [...a.polygon].reverse()
        mb.extrudeSides(inner, -depth, 0.02)
        mb.hPoly(a.polygon, -depth, true)
        mb.use(mats.get('lib:stone-limestone', 'site'), surf)
        const cop = rectPoly({ x: b.x - 0.35, y: b.y - 0.35, w: b.w + 0.7, h: b.h + 0.7 })
        mb.slab(cop, 0.02, 0.09, [a.polygon], { bottom: false })
        glassMb.use(mat, surf, { castShadow: false })
        glassMb.hPoly(a.polygon, -0.12, true)
        lights.push({ p: new THREE.Vector3(b.x + b.w / 2, -0.8, b.y + b.h / 2), kind: 'garden' })
        break
      }
      case 'light_well': {
        const depth = a.depth ?? 3.5
        mb.use(mats.get('lib:concrete-smooth', 'site'), surf)
        mb.extrudeSides([...a.polygon].reverse(), -depth, 0.02)
        mb.use(mats.get('lib:gravel', 'site'), surf)
        mb.hPoly(a.polygon, -depth + plinth, true)
        mb.use(mats.get('lib:metal-black', 'site'), surf)
        const b = bbox(a.polygon)
        mb.box(b.x + b.w / 2, 1.05, b.y - 0.02, b.w, 0.04, 0.04)
        for (let x = b.x; x <= b.x + b.w + 1e-6; x += b.w / Math.max(1, Math.round(b.w / 1.2))) mb.box(x, 0.52, b.y - 0.02, 0.04, 1.05, 0.04)
        break
      }
      case 'deck':
        mb.use(mat, surf)
        mb.slab(a.polygon, 0.02, 0.1, [])
        break
      case 'patio':
      case 'outdoor_kitchen':
      case 'bbq_area':
      case 'outdoor_sitting':
        mb.use(mat, surf)
        mb.slab(a.polygon, 0.02, 0.08, [])
        break
      case 'driveway':
      case 'walkway':
        mb.use(mat, surf)
        mb.slab(a.polygon, 0.01, 0.04, [], { bottom: false })
        break
      case 'garden_bed':
        mb.use(mats.get('lib:soil-mulch', 'site'), surf)
        mb.slab(a.polygon, 0.01, 0.06, [], { bottom: false })
        break
      default:
        mb.use(mat, surf, { castShadow: false })
        mb.hPoly(a.polygon, 0.02, true)
    }
  }

  // boundary wall with gates and pillars
  if (plot.boundaryWall.enabled) {
    const bw = plot.boundaryWall
    const wallMat = mats.get(bw.material ?? h.exterior.facadeMaterial, 'site')
    const pts = plot.polygon
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const isFront = Math.abs(a.y - roadY) < 0.05 && Math.abs(b.y - roadY) < 0.05
      const segs: [Vec2, Vec2][] = isFront ? gapsFor(a, b, plot.gates.filter((gt) => gt.side === 'front'), pb.x) : [[a, b]]
      for (const [p, q] of segs) {
        const L = Math.hypot(q.x - p.x, q.y - p.y)
        if (L < 0.05) continue
        const dir = { x: (q.x - p.x) / L, y: (q.y - p.y) / L }
        const inward = inwardNormal(p, q, pb)
        const c = { x: (p.x + q.x) / 2 + inward.x * bw.thickness / 2, y: (p.y + q.y) / 2 + inward.y * bw.thickness / 2 }
        mb.use(wallMat, { kind: 'boundaryWall' })
        mb.box(c.x, bw.height / 2, c.y, L, bw.height, bw.thickness, -Math.atan2(dir.y, dir.x))
        mb.use(mats.get('lib:stone-limestone', 'site'), { kind: 'boundaryWall' })
        mb.box(c.x, bw.height + 0.03, c.y, L, 0.06, bw.thickness + 0.06, -Math.atan2(dir.y, dir.x))
        colliders.push({ a: p, b: q, r: bw.thickness })
      }
    }
    // gates
    for (const gt of plot.gates) {
      if (gt.side !== 'front') continue
      const x0 = pb.x + gt.offset - gt.width / 2
      const x1 = pb.x + gt.offset + gt.width / 2
      const y = roadY - bw.thickness / 2
      mb.use(mats.get(h.exterior.accentMaterial, 'site'), { kind: 'boundaryWall' })
      for (const x of [x0 - 0.25, x1 + 0.25]) {
        mb.box(x, (bw.height + 0.3) / 2, y, 0.5, bw.height + 0.3, 0.5)
        lights.push({ p: new THREE.Vector3(x, bw.height + 0.45, y), kind: 'gate' })
        mb.use(mats.flat('#fff3d6', 'site', { emissive: new THREE.Color('#ffe2a8'), emissiveIntensity: 0.2 }), null, { castShadow: false })
        mb.box(x, bw.height + 0.42, y, 0.22, 0.24, 0.22)
        mb.use(mats.get(h.exterior.accentMaterial, 'site'), { kind: 'boundaryWall' })
      }
      mb.use(mats.get('lib:metal-black', 'site'), { kind: 'boundaryWall' })
      const gh = Math.min(bw.height, 2.1)
      mb.box((x0 + x1) / 2, gh - 0.05, y, gt.width, 0.08, 0.06)
      mb.box((x0 + x1) / 2, 0.1, y, gt.width, 0.08, 0.06)
      const n = Math.max(3, Math.round(gt.width / 0.12))
      for (let k = 0; k <= n; k++) mb.box(x0 + (gt.width * k) / n, gh / 2, y, 0.025, gh - 0.1, 0.025)
      colliders.push({ a: { x: x0, y }, b: { x: x1, y }, r: 0.05 })
    }
  }

  // objects
  const trees: SiteObject[] = []
  const palms: SiteObject[] = []
  const shrubs: SiteObject[] = []
  for (const o of h.site.objects) {
    const p = o.position
    switch (o.kind) {
      case 'tree':
        trees.push(o)
        colliders.push({ a: p, b: p, r: 0.35 })
        break
      case 'palm':
        palms.push(o)
        colliders.push({ a: p, b: p, r: 0.3 })
        break
      case 'shrub':
      case 'flowers':
      case 'planter':
        shrubs.push(o)
        break
      case 'hedge':
        mb.use(mats.flat('#3f6b35', 'site', { roughness: 1 }), null)
        mb.box(p.x, 0.45, p.y, o.width ?? 2, 0.9, o.depth ?? 0.5, -o.rotation)
        break
      case 'pergola': {
        const w = o.width ?? 3
        const d = o.depth ?? 3
        mb.use(mats.get('lib:wood-teak', 'site'), null)
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1]
        ])
          mb.box(p.x + (sx * w) / 2, 1.3, p.y + (sz * d) / 2, 0.14, 2.6, 0.14)
        mb.box(p.x, 2.6, p.y - d / 2, w + 0.3, 0.18, 0.1)
        mb.box(p.x, 2.6, p.y + d / 2, w + 0.3, 0.18, 0.1)
        for (let x = -w / 2; x <= w / 2 + 1e-6; x += 0.45) mb.box(p.x + x, 2.72, p.y, 0.06, 0.12, d + 0.4)
        break
      }
      case 'bench':
      case 'outdoor_table':
        mb.use(mats.get('lib:wood-teak', 'site'), null)
        if (o.kind === 'bench') {
          mb.box(p.x, 0.45, p.y, 1.6, 0.06, 0.45, -o.rotation)
          mb.box(p.x, 0.22, p.y, 1.5, 0.44, 0.08, -o.rotation)
        } else {
          mb.box(p.x, 0.74, p.y, 1.4, 0.05, 0.9, -o.rotation)
          mb.box(p.x, 0.37, p.y, 0.1, 0.74, 0.1)
          mb.use(mats.flat('#d9d2c4', 'site'), null)
          for (const s of [-1, 1]) {
            mb.box(p.x + s * 0.4, 0.45, p.y - 0.7, 0.45, 0.06, 0.45)
            mb.box(p.x + s * 0.4, 0.45, p.y + 0.7, 0.45, 0.06, 0.45)
          }
        }
        break
      case 'lounger':
        mb.use(mats.flat('#efe9df', 'site'), null)
        mb.box(p.x, 0.3, p.y, 0.7, 0.12, 1.9, -o.rotation)
        break
      case 'umbrella':
        mb.use(mats.get('lib:metal-aluminum', 'site'), null)
        mb.cylinder(p.x, 0, p.y, 0.025, 0.025, 2.3, 6)
        mb.use(mats.flat('#e8dfcf', 'site', { side: THREE.DoubleSide }), null)
        mb.cylinder(p.x, 2.1, p.y, 1.4, 0.02, 0.45, 10, false)
        break
      case 'bbq_grill':
        mb.use(mats.get('lib:brick-red', 'site'), null)
        mb.box(p.x, 0.45, p.y, 1.4, 0.9, 0.7)
        mb.use(mats.get('lib:metal-black', 'site'), null)
        mb.box(p.x, 0.95, p.y, 0.8, 0.1, 0.5)
        break
      case 'fountain':
        mb.use(mats.get('lib:stone-limestone', 'site'), null)
        mb.cylinder(p.x, 0, p.y, 1.1, 1.1, 0.45, 20)
        mb.cylinder(p.x, 0.45, p.y, 0.2, 0.15, 0.6, 10)
        mb.cylinder(p.x, 1.05, p.y, 0.45, 0.5, 0.12, 14)
        glassMb.use(mats.get('lib:water-pool', 'site'), null, { castShadow: false })
        glassMb.cylinder(p.x, 0.36, p.y, 1.0, 1.0, 0.02, 20)
        break
      case 'swing':
        mb.use(mats.get('lib:metal-aluminum', 'site'), null)
        mb.box(p.x, 2.2, p.y, 2.2, 0.08, 0.08)
        for (const s of [-1, 1]) mb.box(p.x + s * 1.1, 1.1, p.y, 0.08, 2.2, 0.08)
        mb.use(mats.flat('#d64b3f', 'site'), null)
        mb.box(p.x, 0.5, p.y, 0.5, 0.05, 0.25)
        break
      case 'slide':
        mb.use(mats.flat('#2f7fb5', 'site'), null)
        mb.box(p.x, 0.8, p.y, 0.5, 0.05, 2.2)
        mb.box(p.x, 0.75, p.y - 1.0, 0.5, 1.5, 0.1)
        break
      case 'garden_light':
        mb.use(mats.get('lib:metal-black', 'site'), null)
        mb.box(p.x, 0.25, p.y, 0.08, 0.5, 0.08)
        mb.use(mats.flat('#fff3d6', 'site', { emissive: new THREE.Color('#ffe2a8'), emissiveIntensity: 0.2 }), null, { castShadow: false })
        mb.box(p.x, 0.55, p.y, 0.12, 0.08, 0.12)
        lights.push({ p: new THREE.Vector3(p.x, 0.6, p.y), kind: 'garden' })
        break
      case 'lamp_post':
        mb.use(mats.get('lib:metal-black', 'site'), null)
        mb.cylinder(p.x, 0, p.y, 0.06, 0.05, 3.2, 8)
        mb.use(mats.flat('#fff3d6', 'site', { emissive: new THREE.Color('#ffe2a8'), emissiveIntensity: 0.2 }), null, { castShadow: false })
        mb.sphere(p.x, 3.3, p.y, 0.18, 0.18, 0.18, 8)
        lights.push({ p: new THREE.Vector3(p.x, 3.2, p.y), kind: 'lamp' })
        break
      default:
        break
    }
  }

  // facade lighting
  const el = floorElevations(h.floors, plinth)
  const ground0 = h.floors.find((f) => f.level === 0)
  if (ground0 && (h.exterior.lighting.facadeWash || h.exterior.lighting.verticalStrips)) {
    const topFloor = sortedFloors(h.floors).filter((f) => f.kind !== 'roof').pop()
    const topY = topFloor ? (el.get(topFloor.id) ?? 0) + topFloor.height : 6
    const frontWalls = ground0.walls.filter((w) => effectiveKind(w) === 'exterior' && Math.abs(w.a.y - w.b.y) < 1e-3 && ground0.rooms.some((r) => !spec(r.type).outdoor && r.type !== 'garage' && Math.abs(bbox(r.polygon).y + bbox(r.polygon).h - w.a.y) < 0.02))
    for (const w of frontWalls) {
      const x0 = Math.min(w.a.x, w.b.x)
      const x1 = Math.max(w.a.x, w.b.x)
      const y = w.a.y + w.thickness / 2 + 0.25
      if (h.exterior.lighting.facadeWash) {
        const n = Math.max(1, Math.round((x1 - x0) / 3.2))
        for (let k = 0; k < n; k++) {
          const x = x0 + ((x1 - x0) * (k + 0.5)) / n
          mb.use(mats.get('lib:metal-black', 'site'), null)
          mb.box(x, 0.06, y, 0.16, 0.12, 0.16)
          lights.push({ p: new THREE.Vector3(x, 0.15, y), kind: 'wash', dir: new THREE.Vector3(0, 1, -0.15) })
        }
      }
      if (h.exterior.lighting.verticalStrips) {
        for (const x of [x0 + 0.12, x1 - 0.12]) {
          mb.use(mats.flat('#fff0d0', 'site', { emissive: new THREE.Color('#ffd89a'), emissiveIntensity: 0.2 }), null, { castShadow: false })
          mb.box(x, (topY + plinth) / 2, w.a.y + w.thickness / 2 + 0.01, 0.04, topY - plinth, 0.02)
          lights.push({ p: new THREE.Vector3(x, topY * 0.5, w.a.y + w.thickness / 2 + 0.3), kind: 'strip' })
        }
      }
    }
  }

  group.add(mb.build('site-solid'))
  const glass = glassMb.build('site-glass')
  glass.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = false) : null))
  group.add(glass)
  group.add(...instancedVegetation(trees, palms, shrubs, mats))
  return { group, lights, colliders }
}

function defaultAreaMat(kind: string) {
  switch (kind) {
    case 'lawn':
    case 'play_area':
      return 'lib:grass-lawn'
    case 'driveway':
      return 'lib:pavers-grey'
    case 'walkway':
      return 'lib:stone-travertine'
    case 'deck':
      return 'lib:wood-deck'
    case 'pool':
      return 'lib:water-pool'
    default:
      return 'lib:porcelain-outdoor'
  }
}

function gapsFor(a: Vec2, b: Vec2, gates: { offset: number; width: number }[], x0: number): [Vec2, Vec2][] {
  const lo = Math.min(a.x, b.x)
  const hi = Math.max(a.x, b.x)
  const gaps = gates.map((g) => [x0 + g.offset - g.width / 2 - 0.5, x0 + g.offset + g.width / 2 + 0.5]).sort((p, q) => p[0] - q[0])
  const out: [Vec2, Vec2][] = []
  let x = lo
  for (const [g0, g1] of gaps) {
    if (g0 > x) out.push([{ x, y: a.y }, { x: g0, y: a.y }])
    x = Math.max(x, g1)
  }
  if (x < hi) out.push([{ x, y: a.y }, { x: hi, y: a.y }])
  return out
}

function inwardNormal(a: Vec2, b: Vec2, pb: { x: number; y: number; w: number; h: number }): Vec2 {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L }
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const c = { x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 }
  return (m.x + n.x - c.x) ** 2 + (m.y + n.y - c.y) ** 2 < (m.x - c.x) ** 2 + (m.y - c.y) ** 2 ? n : { x: -n.x, y: -n.y }
}

/* ── vegetation geometry: organic canopies, real palms, clustered shrubs ───── */

/** Deterministic smooth-ish noise for displacing canopy vertices. */
function lumpy(x: number, y: number, z: number, seed: number) {
  return Math.sin(x * 2.1 + seed) * Math.sin(y * 1.7 + seed * 1.3) * Math.sin(z * 2.3 + seed * 0.7)
}

/** A lumpy sphere of foliage with a slight colour variation baked into vertex colours. */
function foliageBlob(r: number, cx: number, cy: number, cz: number, seed: number, tint: THREE.Color) {
  // welded so the displaced canopy shades smoothly instead of in flat facets
  const raw = new THREE.IcosahedronGeometry(r, 3)
  raw.deleteAttribute('normal')
  raw.deleteAttribute('uv')
  const g = mergeVertices(raw)
  const pos = g.attributes.position as THREE.BufferAttribute
  const col = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const k = 1 + 0.16 * lumpy(v.x, v.y, v.z, seed) + 0.06 * lumpy(v.x * 3, v.y * 3, v.z * 3, seed + 4)
    v.multiplyScalar(k)
    // flatter underside, like a real crown
    if (v.y < 0) v.y *= 0.72
    pos.setXYZ(i, v.x + cx, v.y + cy, v.z + cz)
    // darker inside and underneath, lighter on top
    const shade = 0.78 + 0.22 * Math.max(0, Math.min(1, (v.y / r + 1) / 2)) + 0.05 * lumpy(v.x * 5, v.y * 5, v.z * 5, seed + 9)
    col[i * 3] = tint.r * shade
    col[i * 3 + 1] = tint.g * shade
    col[i * 3 + 2] = tint.b * shade
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

function treeCrown() {
  const parts: [number, number, number, number][] = [
    [0, 4.0, 0, 1.45],
    [0.95, 3.55, 0.35, 1.05],
    [-0.85, 3.6, -0.4, 1.1],
    [0.25, 4.75, -0.3, 1.0],
    [-0.35, 3.3, 0.85, 0.9],
    [0.6, 3.3, -0.9, 0.85]
  ]
  const greens = ['#4d7a36', '#5a8a3e', '#466f31', '#628f45'].map((c) => new THREE.Color(c))
  return mergeGeometries(parts.map(([x, y, z, r], i) => foliageBlob(r, x, y, z, i * 1.7 + 0.3, greens[i % greens.length])))!
}

function treeTrunk() {
  const t = new THREE.CylinderGeometry(0.11, 0.2, 3.2, 8)
  t.translate(0, 1.6, 0)
  const b1 = new THREE.CylinderGeometry(0.05, 0.09, 1.4, 6)
  b1.translate(0, 0.7, 0)
  b1.rotateZ(0.7)
  b1.translate(0.2, 2.6, 0)
  const b2 = new THREE.CylinderGeometry(0.05, 0.08, 1.2, 6)
  b2.translate(0, 0.6, 0)
  b2.rotateX(-0.75)
  b2.translate(0, 2.4, -0.15)
  return mergeGeometries([t, b1, b2])!
}

/** A ringed, gently curved palm trunk. */
function palmTrunk() {
  const segs: THREE.BufferGeometry[] = []
  const n = 9
  for (let i = 0; i < n; i++) {
    const r0 = 0.19 - i * 0.008
    const g = new THREE.CylinderGeometry(r0 - 0.012, r0, 0.58, 8)
    const y = i * 0.56 + 0.29
    g.translate(Math.sin((i / n) * 1.4) * 0.35, y, 0)
    segs.push(g)
  }
  return mergeGeometries(segs)!
}

/** Drooping, V-folded palm fronds around the crown. */
function palmFronds() {
  const fronds: THREE.BufferGeometry[] = []
  const L = 2.8
  const N = 10
  const count = 11
  for (let f = 0; f < count; f++) {
    const pos: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= N; i++) {
      const t = i / N
      const along = t * L
      const droop = -1.25 * t * t + 0.35 * t
      const w = 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.08)) + 0.03
      // centre rib and two folded sides
      pos.push(along, droop, 0, along, droop - w * 0.25, w, along, droop - w * 0.25, -w)
      if (i < N) {
        const a = i * 3
        const b = a + 3
        idx.push(a, b, a + 1, b, b + 1, a + 1, a, a + 2, b, b, a + 2, b + 2)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    g.rotateZ(0.25 + (f % 3) * 0.12)
    g.rotateY((f / count) * Math.PI * 2 + (f % 2) * 0.2)
    g.translate(0.35 * Math.sin(1.4), 5.05, 0)
    fronds.push(g)
  }
  return mergeGeometries(fronds)!
}

function shrubCluster() {
  const tint = new THREE.Color('#557f3c')
  return mergeGeometries([foliageBlob(0.5, 0, 0.45, 0, 1, tint), foliageBlob(0.36, 0.38, 0.35, 0.12, 2, tint.clone().multiplyScalar(1.08)), foliageBlob(0.34, -0.3, 0.33, -0.22, 3, tint.clone().multiplyScalar(0.92))])!
}

/** Trees, palms and shrubs as instanced meshes (§50: object instancing). */
function instancedVegetation(trees: SiteObject[], palms: SiteObject[], shrubs: SiteObject[], mats: MaterialManager): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  const bark = mats.flat('#5b4636', 'site', { roughness: 1 })
  const leaves = mats.flat('#ffffff', 'site', { roughness: 0.92, vertexColors: true })
  const palmLeaf = mats.flat('#5e8a3b', 'site', { roughness: 0.85, side: THREE.DoubleSide })
  const palmBark = mats.flat('#7a6650', 'site', { roughness: 1 })
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const make = (geo: THREE.BufferGeometry, mat: THREE.Material, list: SiteObject[], place: (o: SiteObject, i: number) => void) => {
    if (!list.length) return
    const im = new THREE.InstancedMesh(geo, mat, list.length)
    list.forEach((o, i) => {
      place(o, i)
      im.setMatrixAt(i, m)
    })
    im.castShadow = true
    im.receiveShadow = true
    im.instanceMatrix.needsUpdate = true
    out.push(im)
  }
  const at = (o: SiteObject, spin = 0, sy = 1) => m.compose(p.set(o.position.x, 0, o.position.y), q.setFromAxisAngle(up, o.rotation + spin), s.set(o.scale, o.scale * sy, o.scale))
  make(treeTrunk(), bark, trees, (o) => at(o))
  make(treeCrown(), leaves, trees, (o) => at(o, 0, 0.95))
  make(palmTrunk(), palmBark, palms, (o) => at(o))
  make(palmFronds(), palmLeaf, palms, (o) => at(o))
  const bush = shrubCluster()
  const flowerMat = mats.flat('#c9567a', 'site', { roughness: 0.9 })
  make(bush, leaves, shrubs.filter((x) => x.kind !== 'flowers'), (o) => at(o))
  const flowerBed = new THREE.IcosahedronGeometry(0.55, 1)
  flowerBed.translate(0, 0.3, 0)
  make(flowerBed, flowerMat, shrubs.filter((x) => x.kind === 'flowers'), (o) => m.compose(p.set(o.position.x, -0.15, o.position.y), q.identity(), s.set(o.scale, 0.6, o.scale)))
  return out
}
