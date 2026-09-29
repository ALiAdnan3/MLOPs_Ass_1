import type { EntityRef, Floor, FurnitureItem, Project } from '../core/model/types'
import { uid } from '../core/model/ids'
import { commit, getProject } from '../state/store'
import { useUI } from '../state/ui'
import { deleteRoom, refreshFloor } from '../planner/operations'
import { bbox, centroid } from '../core/geometry/polygon'
import type { Draft } from 'immer'

/** Selection-level editing commands shared by shortcuts, menus and the inspector. */

export function floorOf(p: Project | Draft<Project>, ref: EntityRef) {
  return p.floors.find((f) => f.id === ref.floorId) ?? p.floors.find((f) => f.rooms.some((r) => r.id === ref.id) || f.walls.some((w) => w.id === ref.id) || f.furniture.some((x) => x.id === ref.id))
}

export function describe(ref: EntityRef): string {
  const p = getProject()
  const f = floorOf(p, ref) as Floor | undefined
  switch (ref.kind) {
    case 'room':
      return f?.rooms.find((r) => r.id === ref.id)?.name ?? 'Room'
    case 'wall':
      return 'Wall'
    case 'opening':
      return f?.openings.find((o) => o.id === ref.id)?.kind === 'window' ? 'Window' : 'Door'
    case 'furniture':
      return 'Furniture'
    case 'stair':
      return 'Stair'
    case 'column':
      return 'Column'
    case 'siteArea':
      return p.site.areas.find((a) => a.id === ref.id)?.name ?? 'Site area'
    case 'siteObject':
      return 'Garden object'
    default:
      return ref.kind
  }
}

export function deleteSelection() {
  const sel = useUI.getState().selection
  if (!sel.length) return
  commit(sel.length > 1 ? `Delete ${sel.length} items` : `Delete ${describe(sel[0]).toLowerCase()}`, (d) => {
    for (const ref of sel) {
      const f = floorOf(d, ref)
      switch (ref.kind) {
        case 'room':
          if (f) deleteRoom(f as Floor, ref.id, d.settings)
          break
        case 'wall': {
          if (!f) break
          const w = f.walls.find((x) => x.id === ref.id)
          if (!w) break
          if (w.source === 'manual') {
            f.walls = f.walls.filter((x) => x.id !== ref.id)
            f.openings = f.openings.filter((o) => o.wallId !== ref.id)
          } else {
            // removing a wall between rooms opens them up (open plan)
            w.kindOverride = 'virtual'
            f.openings = f.openings.filter((o) => o.wallId !== ref.id)
          }
          break
        }
        case 'opening':
          if (f) f.openings = f.openings.filter((o) => o.id !== ref.id)
          break
        case 'furniture':
          if (f) f.furniture = f.furniture.filter((o) => o.id !== ref.id)
          break
        case 'stair':
          if (f) f.stairs = f.stairs.filter((o) => o.id !== ref.id)
          break
        case 'column':
          if (f) f.columns = f.columns.filter((o) => o.id !== ref.id)
          break
        case 'annotation':
          if (f) f.annotations = f.annotations.filter((o) => o.id !== ref.id)
          break
        case 'siteArea':
          d.site.areas = d.site.areas.filter((a) => a.id !== ref.id)
          break
        case 'siteObject':
          d.site.objects = d.site.objects.filter((a) => a.id !== ref.id)
          break
        case 'gate':
          d.plot.gates = d.plot.gates.filter((g) => g.id !== ref.id)
          break
      }
    }
  })
  useUI.getState().select([])
}

export function copySelection() {
  const sel = useUI.getState().selection
  const p = getProject()
  const items: { kind: EntityRef['kind']; data: unknown }[] = []
  for (const ref of sel) {
    const f = floorOf(p, ref) as Floor | undefined
    const find = <T extends { id: string }>(list?: T[]) => list?.find((x) => x.id === ref.id)
    const data =
      ref.kind === 'room' ? find(f?.rooms) : ref.kind === 'furniture' ? find(f?.furniture) : ref.kind === 'column' ? find(f?.columns) : ref.kind === 'stair' ? find(f?.stairs) : ref.kind === 'siteObject' ? find(p.site.objects) : ref.kind === 'siteArea' ? find(p.site.areas) : ref.kind === 'annotation' ? find(f?.annotations) : undefined
    if (data) items.push({ kind: ref.kind, data: structuredClone(data) })
  }
  if (items.length) {
    useUI.getState().set({ clipboard: items })
    useUI.getState().toast({ kind: 'info', title: `Copied ${items.length} item${items.length > 1 ? 's' : ''}` })
  }
}

export function pasteClipboard(offset = 0.6) {
  const ui = useUI.getState()
  const clip = ui.clipboard as { kind: EntityRef['kind']; data: Record<string, unknown> }[] | null
  if (!clip?.length) return
  const floorId = ui.floorId
  const refs: EntityRef[] = []
  commit('Paste', (d) => {
    const f = d.floors.find((x) => x.id === floorId)
    if (!f) return
    for (const c of clip) {
      const item = structuredClone(c.data) as Record<string, unknown> & { id: string }
      const shift = (p: { x: number; y: number }) => ({ x: p.x + offset, y: p.y + offset })
      switch (c.kind) {
        case 'room': {
          const r = item as unknown as Floor['rooms'][number]
          r.id = uid('rm')
          r.polygon = r.polygon.map(shift)
          r.name = `${r.name} copy`
          r.autoName = false
          delete r.parentId
          f.rooms.push(r)
          refreshFloor(f as Floor, d.settings)
          refs.push({ kind: 'room', id: r.id, floorId })
          break
        }
        case 'furniture': {
          const x = item as unknown as FurnitureItem
          x.id = uid('fur')
          x.position = shift(x.position)
          f.furniture.push(x)
          refs.push({ kind: 'furniture', id: x.id, floorId })
          break
        }
        case 'column': {
          const x = item as unknown as Floor['columns'][number]
          x.id = uid('col')
          x.position = shift(x.position)
          f.columns.push(x)
          refs.push({ kind: 'column', id: x.id, floorId })
          break
        }
        case 'stair': {
          const x = item as unknown as Floor['stairs'][number]
          x.id = uid('str')
          x.position = shift(x.position)
          f.stairs.push(x)
          refs.push({ kind: 'stair', id: x.id, floorId })
          break
        }
        case 'siteObject': {
          const x = item as unknown as Project['site']['objects'][number]
          x.id = uid('obj')
          x.position = shift(x.position)
          d.site.objects.push(x)
          refs.push({ kind: 'siteObject', id: x.id })
          break
        }
        case 'siteArea': {
          const x = item as unknown as Project['site']['areas'][number]
          x.id = uid('sit')
          x.polygon = x.polygon.map(shift)
          d.site.areas.push(x)
          refs.push({ kind: 'siteArea', id: x.id })
          break
        }
        case 'annotation': {
          const x = item as unknown as Floor['annotations'][number]
          x.id = uid('ann')
          if (x.kind === 'text') x.position = shift(x.position)
          else {
            x.a = shift(x.a)
            x.b = shift(x.b)
          }
          f.annotations.push(x)
          refs.push({ kind: 'annotation', id: x.id, floorId })
          break
        }
      }
    }
  })
  ui.select(refs)
}

export function duplicateSelection() {
  const saved = useUI.getState().clipboard
  copySelection()
  pasteClipboard()
  useUI.getState().set({ clipboard: saved })
}

export function rotateSelection(angle = Math.PI / 2) {
  const sel = useUI.getState().selection
  if (!sel.length) return
  commit('Rotate', (d) => {
    for (const ref of sel) {
      const f = floorOf(d, ref)
      if (ref.kind === 'furniture') {
        const x = f?.furniture.find((o) => o.id === ref.id)
        if (x) x.rotation = norm(x.rotation + angle)
      } else if (ref.kind === 'column') {
        const x = f?.columns.find((o) => o.id === ref.id)
        if (x) x.rotation = norm(x.rotation + angle)
      } else if (ref.kind === 'stair') {
        const x = f?.stairs.find((o) => o.id === ref.id)
        if (x) x.rotation = norm(x.rotation + angle)
      } else if (ref.kind === 'siteObject') {
        const x = d.site.objects.find((o) => o.id === ref.id)
        if (x) x.rotation = norm(x.rotation + angle)
      } else if (ref.kind === 'room' && f) {
        const r = f.rooms.find((o) => o.id === ref.id)
        if (!r) continue
        const c = centroid(r.polygon)
        const cs = Math.cos(angle)
        const sn = Math.sin(angle)
        r.polygon = r.polygon.map((p) => ({ x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs }))
        refreshFloor(f as Floor, d.settings)
      } else if (ref.kind === 'opening' && f) {
        const o = f.openings.find((x) => x.id === ref.id)
        if (o && o.kind === 'door') {
          // cycle hinge / swing: flip swing, then hinge
          if (o.swing === 'left') o.swing = 'right'
          else {
            o.swing = 'left'
            o.hinge = o.hinge === 'end' ? 'start' : 'end'
          }
        }
      }
    }
  })
}

const norm = (a: number) => {
  let r = a % (Math.PI * 2)
  if (r < 0) r += Math.PI * 2
  return Math.round(r * 1e6) / 1e6
}

export function selectionBounds(p: Project, refs: EntityRef[]) {
  const pts: { x: number; y: number }[] = []
  for (const ref of refs) {
    const f = floorOf(p, ref) as Floor | undefined
    if (ref.kind === 'room') pts.push(...(f?.rooms.find((r) => r.id === ref.id)?.polygon ?? []))
    if (ref.kind === 'furniture') {
      const x = f?.furniture.find((r) => r.id === ref.id)
      if (x) pts.push(x.position)
    }
  }
  return pts.length ? bbox(pts) : null
}
