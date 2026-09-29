import type { Floor, MaterialCategory, Project, SurfaceRef } from '../core/model/types'
import { spec } from '../core/constraints/rooms'
import { catalogItem } from '../core/furniture/catalog'

/**
 * Paintable surfaces (§13, §16): what a picked 3D surface is called, which material it wears now,
 * and how applying a material changes the model. Materials always live in the model, so the plan,
 * 3D, estimate and exports agree.
 */

export type ApplyScope = 'surface' | 'room' | 'floor' | 'house'

export interface SurfaceInfo {
  label: string
  detail: string
  current?: string
  fallback?: string
  /** Scopes that make sense for this surface. */
  scopes: { value: ApplyScope; label: string }[]
  /** Material categories suggested for it (library filter hint). */
  suggest: MaterialCategory[]
}

const floorOf = (p: Project, id?: string): Floor | undefined => p.floors.find((f) => f.id === id)

export function describeSurface(p: Project, s: SurfaceRef): SurfaceInfo | null {
  switch (s.kind) {
    case 'roomFloor':
    case 'roomCeiling': {
      const f = floorOf(p, s.floorId)
      const r = f?.rooms.find((x) => x.id === s.roomId)
      if (!f || !r) return null
      const sp = spec(r.type)
      const floorSurf = s.kind === 'roomFloor'
      return {
        label: `${r.name} ${floorSurf ? 'floor' : 'ceiling'}`,
        detail: `${f.name} floor`,
        current: floorSurf ? r.floorMaterial : r.ceilingMaterial,
        fallback: floorSurf ? sp.floorFinish : 'lib:paint-ceiling',
        scopes: [
          { value: 'surface', label: 'This room' },
          { value: 'floor', label: `Every ${floorSurf ? 'floor' : 'ceiling'} on ${f.name}` },
          { value: 'house', label: 'Whole house' }
        ],
        suggest: floorSurf ? ['marble', 'porcelain', 'ceramic', 'wood', 'granite', 'stone', 'concrete', 'fabric'] : ['paint', 'wood', 'concrete']
      }
    }
    case 'wallSide': {
      const f = floorOf(p, s.floorId)
      const w = f?.walls.find((x) => x.id === s.wallId)
      if (!f || !w) return null
      const r = s.roomId ? f.rooms.find((x) => x.id === s.roomId) : undefined
      return {
        label: r ? `${r.name} wall` : 'Wall',
        detail: `${f.name} floor, ${s.side} side`,
        current: w.sideMaterials?.[s.side] ?? r?.wallMaterial,
        fallback: r ? spec(r.type).wallFinish : 'lib:paint-warm-white',
        scopes: r
          ? [
              { value: 'surface', label: 'This wall only' },
              { value: 'room', label: `All walls of ${r.name}` }
            ]
          : [{ value: 'surface', label: 'This wall only' }],
        suggest: ['paint', 'wallpaper', 'stone', 'wood', 'marble', 'ceramic', 'brick', 'concrete']
      }
    }
    case 'exteriorWall':
      return {
        label: 'Exterior walls',
        detail: 'Facade finish of the house',
        current: p.exterior.facadeMaterial,
        scopes: [
          { value: 'house', label: 'Main facade' },
          { value: 'surface', label: 'Accent cladding' },
          { value: 'floor', label: 'Plinth' }
        ],
        suggest: ['paint', 'stone', 'brick', 'concrete', 'wood', 'marble', 'metal']
      }
    case 'stair': {
      const f = floorOf(p, s.floorId)
      const st = f?.stairs.find((x) => x.id === s.stairId)
      if (!st) return null
      return { label: 'Staircase', detail: `${st.type} stair, ${st.risers} steps`, current: st.material, fallback: 'lib:marble-botticino', scopes: [{ value: 'surface', label: 'This stair' }], suggest: ['marble', 'granite', 'wood', 'stone', 'porcelain', 'concrete'] }
    }
    case 'column': {
      const f = floorOf(p, s.floorId)
      const c = f?.columns.find((x) => x.id === s.columnId)
      if (!c) return null
      return {
        label: 'Column',
        detail: `${f!.name} floor`,
        current: c.material,
        fallback: 'lib:plaster-grey',
        scopes: [
          { value: 'surface', label: 'This column' },
          { value: 'house', label: 'All exposed columns' }
        ],
        suggest: ['stone', 'marble', 'paint', 'concrete', 'wood', 'metal']
      }
    }
    case 'furniture': {
      const f = floorOf(p, s.floorId)
      const it = f?.furniture.find((x) => x.id === s.furnitureId)
      if (!it) return null
      const c = catalogItem(it.type)
      const kitchen = c?.category === 'kitchen'
      return {
        label: c?.name ?? 'Furniture',
        detail: kitchen ? 'Kitchen counter and cabinets' : 'Furniture finish',
        current: it.materialId,
        fallback: kitchen ? 'lib:granite-black-galaxy' : 'lib:wood-oak',
        scopes: kitchen
          ? [
              { value: 'surface', label: 'This unit' },
              { value: 'room', label: 'All counters in this kitchen' }
            ]
          : [{ value: 'surface', label: 'This item' }],
        suggest: kitchen ? ['granite', 'marble', 'wood', 'porcelain', 'metal'] : ['wood', 'fabric', 'metal', 'marble', 'glass']
      }
    }
    case 'roof':
      return { label: 'Roof', detail: `${p.exterior.roofType} roof`, current: p.exterior.roofMaterial, scopes: [{ value: 'surface', label: 'Roof covering' }], suggest: ['roof', 'metal', 'concrete'] }
    case 'siteArea': {
      const a = p.site.areas.find((x) => x.id === s.areaId)
      if (!a) return null
      return {
        label: a.name ?? a.kind.replace('_', ' '),
        detail: 'Outdoor surface',
        current: a.material,
        scopes: [
          { value: 'surface', label: 'This area' },
          { value: 'house', label: `Every ${a.kind.replace('_', ' ')}` }
        ],
        suggest: ['ground', 'stone', 'porcelain', 'wood', 'concrete', 'brick']
      }
    }
    case 'boundaryWall':
      return { label: 'Boundary wall', detail: 'Plot boundary and gate pillars', current: p.plot.boundaryWall.material, fallback: p.exterior.facadeMaterial, scopes: [{ value: 'surface', label: 'Boundary wall' }], suggest: ['paint', 'stone', 'brick', 'concrete'] }
  }
}

/** Mutates a draft project so the surface (and the chosen scope) wears material `id`. */
export function applySurfaceMaterial(d: Project, s: SurfaceRef, id: string, scope: ApplyScope = 'surface') {
  switch (s.kind) {
    case 'roomFloor':
    case 'roomCeiling': {
      const key = s.kind === 'roomFloor' ? 'floorMaterial' : 'ceilingMaterial'
      const rooms =
        scope === 'house'
          ? d.floors.flatMap((f) => f.rooms)
          : scope === 'floor'
            ? (floorOf(d, s.floorId)?.rooms ?? [])
            : (floorOf(d, s.floorId)?.rooms.filter((r) => r.id === s.roomId) ?? [])
      for (const r of rooms) {
        const sp = spec(r.type)
        // keep wet areas, outdoor spaces and voids on their own finishes when painting broadly
        if (scope !== 'surface' && (sp.wet || sp.outdoor || r.type === 'void' || r.type === 'garage' || r.type === 'mumty')) continue
        r[key] = id
      }
      break
    }
    case 'wallSide': {
      const f = floorOf(d, s.floorId)
      if (!f) return
      if (scope === 'room' && s.roomId) {
        const r = f.rooms.find((x) => x.id === s.roomId)
        if (r) r.wallMaterial = id
        // clear per-side overrides that face this room so the room finish shows everywhere
        for (const w of f.walls) {
          if (!w.sideMaterials) continue
          if (w.id === s.wallId) w.sideMaterials[s.side] = undefined
        }
      } else {
        const w = f.walls.find((x) => x.id === s.wallId)
        if (w) w.sideMaterials = { ...w.sideMaterials, [s.side]: id }
      }
      break
    }
    case 'exteriorWall':
      if (scope === 'surface') {
        d.exterior.accentMaterial = id
        if (d.exterior.accent === 'none') d.exterior.accent = 'front-feature'
      } else if (scope === 'floor') d.exterior.plinthMaterial = id
      else d.exterior.facadeMaterial = id
      break
    case 'stair': {
      const st = floorOf(d, s.floorId)?.stairs.find((x) => x.id === s.stairId)
      if (st) st.material = id
      break
    }
    case 'column': {
      if (scope === 'house') for (const f of d.floors) for (const c of f.columns) c.material = id
      else {
        const c = floorOf(d, s.floorId)?.columns.find((x) => x.id === s.columnId)
        if (c) c.material = id
      }
      break
    }
    case 'furniture': {
      const f = floorOf(d, s.floorId)
      const it = f?.furniture.find((x) => x.id === s.furnitureId)
      if (!f || !it) return
      if (scope === 'room') {
        for (const x of f.furniture) if (catalogItem(x.type)?.category === 'kitchen' && Math.hypot(x.position.x - it.position.x, x.position.y - it.position.y) < 8) x.materialId = id
      } else it.materialId = id
      break
    }
    case 'roof':
      d.exterior.roofMaterial = id
      break
    case 'siteArea': {
      const a = d.site.areas.find((x) => x.id === s.areaId)
      if (!a) return
      if (scope === 'house') for (const x of d.site.areas) if (x.kind === a.kind) x.material = id
      a.material = id
      break
    }
    case 'boundaryWall':
      d.plot.boundaryWall.material = id
      break
  }
}

/** Surface a model selection maps to, for applying materials from the 2D plan too. */
export function surfaceForSelection(p: Project, ref: { kind: string; id: string; floorId?: string }): SurfaceRef | null {
  switch (ref.kind) {
    case 'room':
      return ref.floorId ? { kind: 'roomFloor', floorId: ref.floorId, roomId: ref.id } : null
    case 'stair':
      return ref.floorId ? { kind: 'stair', floorId: ref.floorId, stairId: ref.id } : null
    case 'column':
      return ref.floorId ? { kind: 'column', floorId: ref.floorId, columnId: ref.id } : null
    case 'furniture':
      return ref.floorId ? { kind: 'furniture', floorId: ref.floorId, furnitureId: ref.id } : null
    case 'siteArea':
      return { kind: 'siteArea', areaId: ref.id }
    case 'wall': {
      const f = p.floors.find((x) => x.id === ref.floorId)
      const w = f?.walls.find((x) => x.id === ref.id)
      if (!f || !w) return null
      return w.kind === 'exterior' ? { kind: 'exteriorWall', floorId: f.id, wallId: w.id } : { kind: 'wallSide', floorId: f.id, wallId: w.id, side: 'left' }
    }
    default:
      return null
  }
}
