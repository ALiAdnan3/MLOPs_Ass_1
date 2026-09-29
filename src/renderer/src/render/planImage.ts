import type { Floor, HouseState, Project } from '../core/model/types'
import { CanvasContext } from './draw/canvas'
import { drawPlan, type PlanMode } from './draw/plan'
import { DARK_PLAN, LIGHT_PLAN, PRINT_PLAN } from './draw/theme'
import { bbox } from '../core/geometry/polygon'
import { defaultSettings } from '../core/model/defaults'

/** Render a floor plan into an offscreen canvas (thumbnails, design cards, PNG export). */
export function renderPlanToCanvas(
  p: Pick<Project, 'settings' | 'materials'> & HouseState,
  floor: Floor,
  width: number,
  height: number,
  o: { theme?: 'dark' | 'light' | 'print'; site?: boolean; mode?: PlanMode; pad?: number; dpr?: number; labels?: boolean } = {}
): HTMLCanvasElement {
  const dpr = o.dpr ?? 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')!
  const theme = o.theme === 'dark' ? DARK_PLAN : o.theme === 'print' ? PRINT_PLAN : LIGHT_PLAN
  ctx.fillStyle = theme.paper
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const pts = o.site === false ? floor.rooms.flatMap((r) => r.polygon) : p.plot.polygon
  const b = bbox(pts.length ? pts : p.plot.polygon)
  const pad = o.pad ?? 0.06
  const scale = Math.min((width * (1 - 2 * pad)) / Math.max(1, b.w), (height * (1 - 2 * pad)) / Math.max(1, b.h))
  const view = { scale, ox: width / 2 - (b.x + b.w / 2) * scale, oy: height / 2 - (b.y + b.h / 2) * scale }
  const dc = new CanvasContext(ctx, view, dpr)
  const settings = p.settings ?? defaultSettings()
  drawPlan(dc, p, floor, {
    theme,
    layers: { ...settings.layers, electrical: o.mode === 'electrical', lighting: o.mode === 'lighting', plumbing: false },
    units: settings.units,
    showSite: o.site !== false,
    showLabels: o.labels !== false,
    mode: o.mode,
    materials: p.materials
  })
  return canvas
}
