import type { Vec2 } from '../../core/model/types'
import type { DrawContext, Fill, Stroke, TextStyle } from './types'

/** SVG backend. Coordinates are world meters; line weights convert via `ptWorld` (m per point). */
export class SvgContext implements DrawContext {
  kind = 'svg' as const
  parts: string[] = []
  private open = false
  constructor(
    public pxPerMeter: number,
    private ptWorld: number,
    private font = "Archivo, 'Segoe UI', Arial, sans-serif"
  ) {}

  layer(name: string) {
    if (this.open) this.parts.push('</g>')
    this.parts.push(`<g id="${esc(name)}">`)
    this.open = true
  }
  private st(s?: Stroke | null) {
    if (!s) return 'stroke="none"'
    const dash = s.dash ? ` stroke-dasharray="${s.dash.map((d) => fmt(d * this.ptWorld)).join(' ')}"` : ''
    const op = s.opacity !== undefined ? ` stroke-opacity="${s.opacity}"` : ''
    return `stroke="${s.color}" stroke-width="${fmt(s.width * this.ptWorld)}" stroke-linecap="${s.cap ?? 'butt'}" stroke-linejoin="round"${dash}${op}`
  }
  private fl(f?: Fill | null) {
    if (!f) return 'fill="none"'
    return `fill="${f.color}"${f.opacity !== undefined ? ` fill-opacity="${f.opacity}"` : ''}`
  }
  polygon(pts: Vec2[], fill?: Fill | null, stroke?: Stroke | null, holes?: Vec2[][]) {
    if (pts.length < 2) return
    const ring = (r: Vec2[]) => `M${r.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join('L')}Z`
    const d = ring(pts) + (holes ?? []).map(ring).join('')
    this.parts.push(`<path d="${d}" fill-rule="evenodd" ${this.fl(fill)} ${this.st(stroke)}/>`)
  }
  polyline(pts: Vec2[], stroke: Stroke, closed = false) {
    if (pts.length < 2) return
    this.parts.push(`<${closed ? 'polygon' : 'polyline'} points="${pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ')}" fill="none" ${this.st(stroke)}/>`)
  }
  line(a: Vec2, b: Vec2, stroke: Stroke) {
    this.parts.push(`<line x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}" ${this.st(stroke)}/>`)
  }
  circle(c: Vec2, r: number, fill?: Fill | null, stroke?: Stroke | null) {
    this.parts.push(`<circle cx="${fmt(c.x)}" cy="${fmt(c.y)}" r="${fmt(r)}" ${this.fl(fill)} ${this.st(stroke)}/>`)
  }
  arc(c: Vec2, r: number, a0: number, a1: number, stroke: Stroke) {
    const p0 = { x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) }
    const p1 = { x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) }
    const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0
    this.parts.push(`<path d="M${fmt(p0.x)} ${fmt(p0.y)}A${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(p1.x)} ${fmt(p1.y)}" fill="none" ${this.st(stroke)}/>`)
  }
  text(p: Vec2, s: string, t: TextStyle) {
    const size = t.size / 0.72
    const anchor = t.align === 'left' ? 'start' : t.align === 'right' ? 'end' : 'middle'
    const base = t.baseline === 'top' ? 'hanging' : t.baseline === 'bottom' ? 'auto' : 'central'
    const rot = t.rotation ? ` transform="rotate(${fmt((t.rotation * 180) / Math.PI)} ${fmt(p.x)} ${fmt(p.y)})"` : ''
    const stretch = t.condensed ? ' font-stretch="condensed" letter-spacing="0.04em"' : ''
    this.parts.push(
      `<text x="${fmt(p.x)}" y="${fmt(p.y)}" font-family="${this.font}" font-size="${fmt(size)}" font-weight="${t.weight ?? 450}" fill="${t.color}"${t.opacity !== undefined ? ` fill-opacity="${t.opacity}"` : ''} text-anchor="${anchor}" dominant-baseline="${base}"${stretch}${rot}>${esc(s)}</text>`
    )
  }
  toString(view: { x: number; y: number; w: number; h: number }, bg?: string, widthPx?: number) {
    const body = this.parts.join('') + (this.open ? '</g>' : '')
    const w = widthPx ?? Math.round(view.w * this.pxPerMeter)
    const h = Math.round((w * view.h) / view.w)
    const rect = bg ? `<rect x="${fmt(view.x)}" y="${fmt(view.y)}" width="${fmt(view.w)}" height="${fmt(view.h)}" fill="${bg}"/>` : ''
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${fmt(view.x)} ${fmt(view.y)} ${fmt(view.w)} ${fmt(view.h)}">${rect}${body}</svg>`
  }
}

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString()
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
