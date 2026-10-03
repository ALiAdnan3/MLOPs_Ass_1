import type { Floor, FurnitureItem, HouseState, MaterialDef, SiteAreaKind, Vec2 } from '../core/model/types'
import type { ViewTransform } from './draw/canvas'
import { resolveMaterial, materialSwatch } from '../core/materials/library'
import { materialThumb } from './materialThumb'
import { spec } from '../core/constraints/rooms'
import { bbox, unionPolys } from '../core/geometry/polygon'
import { catalogItem } from '../core/furniture/catalog'

/**
 * Presentation-plan underlay (§7 "rendered" look): the real materials of the model — floor
 * finishes, lawns, paving, pool water, road — painted as textures at true scale, plus soft
 * contact shadows under the house, furniture, cars and trees. Ink linework is drawn on top by
 * the normal plan renderer, so the drawing stays exact.
 */

const TEX = 256
const images = new Map<string, { img: HTMLImageElement; ready: boolean; scale: number }>()
let pending: (() => void) | null = null

const AREA_DEFAULT: Partial<Record<SiteAreaKind, string>> = {
  lawn: 'lib:grass-lawn',
  garden_bed: 'lib:soil-mulch',
  play_area: 'lib:rubber-black',
  driveway: 'lib:pavers-grey',
  walkway: 'lib:pavers-grey',
  patio: 'lib:porcelain-outdoor',
  outdoor_sitting: 'lib:porcelain-outdoor',
  bbq_area: 'lib:pavers-red',
  outdoor_kitchen: 'lib:porcelain-outdoor',
  deck: 'lib:wood-deck',
  pool: 'lib:water-pool',
  water_feature: 'lib:water-pool',
  light_well: 'lib:gravel'
}

/** A repeating texture for a material, in world metres; null until its image has loaded. */
function pattern(ctx: CanvasRenderingContext2D, def: MaterialDef | undefined, onReady: () => void): CanvasPattern | string {
  if (!def) return '#d9d4ca'
  const key = `${def.id}|${def.assetId ?? ''}|${def.procedural?.colors.join(',') ?? ''}|${def.brightness}|${def.contrast}`
  let e = images.get(key)
  if (!e) {
    const img = new Image()
    e = { img, ready: false, scale: def.scale }
    images.set(key, e)
    const entry = e
    img.onload = () => {
      entry.ready = true
      onReady()
    }
    materialThumb(def, TEX).then((url) => {
      if (url) img.src = url
    })
  }
  if (!e.ready || !e.img.naturalWidth) {
    pending = onReady
    return materialSwatch(def)
  }
  const p = ctx.createPattern(e.img, 'repeat')
  if (!p) return materialSwatch(def)
  // one image repeat spans def.scale metres
  const k = Math.max(0.05, def.scale) / e.img.naturalWidth
  p.setTransform(new DOMMatrix().scaleSelf(k, k))
  return p
}

function path(ctx: CanvasRenderingContext2D, poly: Vec2[]) {
  ctx.moveTo(poly[0].x, poly[0].y)
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y)
  ctx.closePath()
}

function fillPoly(ctx: CanvasRenderingContext2D, poly: Vec2[], style: CanvasPattern | string, holes: Vec2[][] = []) {
  if (poly.length < 3) return
  ctx.beginPath()
  path(ctx, poly)
  for (const h of holes) if (h.length > 2) path(ctx, h)
  ctx.fillStyle = style
  ctx.fill('evenodd')
}

function rotatedRect(f: FurnitureItem): Vec2[] {
  const c = Math.cos(f.rotation)
  const s = Math.sin(f.rotation)
  const w = f.width / 2
  const d = f.depth / 2
  return [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d]
  ].map(([x, y]) => ({ x: f.position.x + x * c - y * s, y: f.position.y + x * s + y * c }))
}

export interface UnderlayOptions {
  site: boolean
  materials: MaterialDef[]
  /** Called when a texture finishes loading (redraw). */
  onReady: () => void
  /** Plain fills while dragging (keeps interaction fast). */
  lite?: boolean
}

export function drawTexturedUnderlay(ctx: CanvasRenderingContext2D, v: ViewTransform, dpr: number, house: HouseState, floor: Floor, o: UnderlayOptions) {
  const mat = (id: string | undefined) => resolveMaterial(id, o.materials)
  const tex = (id: string | undefined) => (o.lite ? materialSwatch(mat(id)) : pattern(ctx, mat(id), o.onReady))
  ctx.save()
  ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.ox, dpr * v.oy)
  const px = 1 / v.scale // one screen pixel in metres
  const plot = house.plot
  const pb = bbox(plot.polygon)

  if (o.site) {
    // road
    fillPoly(ctx, [{ x: pb.x - 6, y: pb.y + pb.h }, { x: pb.x + pb.w + 6, y: pb.y + pb.h }, { x: pb.x + pb.w + 6, y: pb.y + pb.h + plot.roadWidth }, { x: pb.x - 6, y: pb.y + pb.h + plot.roadWidth }], tex('lib:asphalt'))
    ctx.fillStyle = '#c9ccd1'
    ctx.fillRect(pb.x - 6, pb.y + pb.h, pb.w + 12, 1.2)
    // ground of the plot, then designed areas
    fillPoly(ctx, plot.polygon, tex('lib:gravel'))
    for (const a of house.site.areas) {
      const id = a.material ?? AREA_DEFAULT[a.kind] ?? 'lib:pavers-grey'
      fillPoly(ctx, a.polygon, tex(id))
      if (a.kind === 'pool' && !o.lite) {
        // depth: darker water towards the middle and a light coping edge
        const b = bbox(a.polygon)
        const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h)
        g.addColorStop(0, 'rgba(255,255,255,0.25)')
        g.addColorStop(1, 'rgba(0,40,70,0.25)')
        fillPoly(ctx, a.polygon, g as unknown as string)
        ctx.lineWidth = 0.25
        ctx.strokeStyle = '#efece6'
        ctx.beginPath()
        path(ctx, a.polygon)
        ctx.stroke()
      }
    }
  }

  // soft shadow of the building on the ground
  const solid = floor.rooms.filter((r) => r.type !== 'void' && !(spec(r.type).outdoor && r.type !== 'garage'))
  if (!o.lite && floor.level === 0) {
    ctx.save()
    ctx.filter = `blur(${Math.max(1, 0.25 / px)}px)`
    ctx.fillStyle = 'rgba(20, 28, 36, 0.32)'
    for (const u of unionPolys(solid.map((r) => r.polygon))) {
      ctx.beginPath()
      path(ctx, u.outer.map((p) => ({ x: p.x + 0.35, y: p.y + 0.45 })))
      ctx.fill()
    }
    ctx.restore()
  }

  // floor finishes, room by room
  for (const r of floor.rooms) {
    if (r.type === 'void') continue
    const id = r.floorMaterial ?? (r.type === 'garage' ? 'lib:concrete-smooth' : spec(r.type).floorFinish)
    fillPoly(ctx, r.polygon, tex(id))
  }
  // a whisper of ambient occlusion along room edges
  if (!o.lite) {
    ctx.save()
    ctx.lineJoin = 'round'
    for (const r of floor.rooms) {
      if (r.type === 'void' || spec(r.type).outdoor) continue
      ctx.save()
      ctx.beginPath()
      path(ctx, r.polygon)
      ctx.clip()
      ctx.lineWidth = 0.35
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'
      ctx.filter = `blur(${Math.max(1, 0.12 / px)}px)`
      ctx.beginPath()
      path(ctx, r.polygon)
      ctx.stroke()
      ctx.restore()
    }
    ctx.restore()
  }

  // contact shadows: furniture, cars, trees
  if (!o.lite) {
    ctx.save()
    ctx.filter = `blur(${Math.max(1, 0.08 / px)}px)`
    ctx.fillStyle = 'rgba(15, 20, 28, 0.28)'
    for (const f of floor.furniture) {
      const c = catalogItem(f.type)
      if (!c || c.category === 'lighting' || (f.elevation ?? 0) > 1.2) continue
      const off = Math.min(0.18, 0.06 + f.height * 0.05)
      ctx.beginPath()
      path(ctx, rotatedRect(f).map((p) => ({ x: p.x + off, y: p.y + off })))
      ctx.fill()
    }
    if (o.site)
      for (const ob of house.site.objects) {
        if (ob.kind !== 'tree' && ob.kind !== 'palm' && ob.kind !== 'shrub') continue
        const r = (ob.kind === 'palm' ? 1.6 : ob.kind === 'shrub' ? 0.6 : 2.0) * ob.scale
        ctx.beginPath()
        ctx.ellipse(ob.position.x + r * 0.35, ob.position.y + r * 0.45, r * 0.95, r * 0.8, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    ctx.restore()
  }
  ctx.restore()
}

/** True while some texture is still loading (the caller's redraw callback will fire). */
export function texturesPending() {
  return pending !== null
}
