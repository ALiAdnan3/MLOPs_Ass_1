import type { Vec2 } from '../../core/model/types'
import type { DrawContext, Fill, Stroke, TextStyle } from './types'

export interface ViewTransform {
  /** Pixels per meter. */
  scale: number
  /** Screen position (CSS px) of world origin. */
  ox: number
  oy: number
}

export const toScreen = (v: ViewTransform, p: Vec2): Vec2 => ({ x: p.x * v.scale + v.ox, y: p.y * v.scale + v.oy })
export const toWorld = (v: ViewTransform, p: Vec2): Vec2 => ({ x: (p.x - v.ox) / v.scale, y: (p.y - v.oy) / v.scale })

/** Canvas 2D backend for the live editor. Line weights are cosmetic (constant on screen). */
export class CanvasContext implements DrawContext {
  kind = 'canvas' as const
  pxPerMeter: number
  constructor(
    private ctx: CanvasRenderingContext2D,
    private v: ViewTransform,
    private dpr: number,
    private font = "'Archivo Variable', Archivo, 'Segoe UI', sans-serif"
  ) {
    this.pxPerMeter = v.scale
  }
  layer() {}
  private applyStroke(s: Stroke) {
    const c = this.ctx
    c.strokeStyle = s.color
    c.lineWidth = Math.max(0.5, s.width) * this.dpr
    c.setLineDash(s.dash ? s.dash.map((d) => d * this.dpr) : [])
    c.lineCap = s.cap ?? 'butt'
    c.lineJoin = 'round'
    c.globalAlpha = s.opacity ?? 1
  }
  private path(pts: Vec2[], close: boolean) {
    const c = this.ctx
    const { scale, ox, oy } = this.v
    const d = this.dpr
    c.moveTo((pts[0].x * scale + ox) * d, (pts[0].y * scale + oy) * d)
    for (let i = 1; i < pts.length; i++) c.lineTo((pts[i].x * scale + ox) * d, (pts[i].y * scale + oy) * d)
    if (close) c.closePath()
  }
  polygon(pts: Vec2[], fill?: Fill | null, stroke?: Stroke | null, holes?: Vec2[][]) {
    if (pts.length < 2) return
    const c = this.ctx
    c.beginPath()
    this.path(pts, true)
    for (const h of holes ?? []) if (h.length > 2) this.path(h, true)
    if (fill) {
      c.globalAlpha = fill.opacity ?? 1
      c.fillStyle = fill.color
      c.fill('evenodd')
    }
    if (stroke) {
      this.applyStroke(stroke)
      c.stroke()
    }
    c.globalAlpha = 1
  }
  polyline(pts: Vec2[], stroke: Stroke, closed = false) {
    if (pts.length < 2) return
    const c = this.ctx
    c.beginPath()
    this.path(pts, closed)
    this.applyStroke(stroke)
    c.stroke()
    c.globalAlpha = 1
  }
  line(a: Vec2, b: Vec2, stroke: Stroke) {
    this.polyline([a, b], stroke)
  }
  circle(cn: Vec2, r: number, fill?: Fill | null, stroke?: Stroke | null) {
    const c = this.ctx
    const p = toScreen(this.v, cn)
    c.beginPath()
    c.arc(p.x * this.dpr, p.y * this.dpr, Math.max(0.5, r * this.v.scale) * this.dpr, 0, Math.PI * 2)
    if (fill) {
      c.globalAlpha = fill.opacity ?? 1
      c.fillStyle = fill.color
      c.fill()
    }
    if (stroke) {
      this.applyStroke(stroke)
      c.stroke()
    }
    c.globalAlpha = 1
  }
  arc(cn: Vec2, r: number, a0: number, a1: number, stroke: Stroke) {
    const c = this.ctx
    const p = toScreen(this.v, cn)
    c.beginPath()
    c.arc(p.x * this.dpr, p.y * this.dpr, r * this.v.scale * this.dpr, a0, a1)
    this.applyStroke(stroke)
    c.stroke()
    c.globalAlpha = 1
  }
  text(pw: Vec2, s: string, t: TextStyle) {
    const c = this.ctx
    let px = (t.size / 0.72) * this.v.scale
    if (t.minPx && px < t.minPx) {
      if (px < t.minPx * 0.55) return // too small to read: skip
      px = t.minPx
    }
    if (t.maxPx && px > t.maxPx) px = t.maxPx
    const p = toScreen(this.v, pw)
    c.save()
    c.globalAlpha = t.opacity ?? 1
    c.translate(p.x * this.dpr, p.y * this.dpr)
    if (t.rotation) c.rotate(t.rotation)
    c.font = `${t.weight ?? 450} ${t.condensed ? 'condensed ' : ''}${px * this.dpr}px ${this.font}`
    try {
      ;(c as CanvasRenderingContext2D & { fontStretch?: string; letterSpacing?: string }).fontStretch = t.condensed ? 'condensed' : 'normal'
      if (t.condensed) (c as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${0.04 * px * this.dpr}px`
    } catch {
      /* older engines */
    }
    c.fillStyle = t.color
    c.textAlign = t.align ?? 'center'
    c.textBaseline = t.baseline === 'top' ? 'top' : t.baseline === 'bottom' ? 'bottom' : 'middle'
    c.fillText(s, 0, 0)
    c.restore()
  }
}
