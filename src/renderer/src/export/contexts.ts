import type { jsPDF } from 'jspdf'
import type { Vec2 } from '../core/model/types'
import type { DrawContext, Fill, Stroke, TextStyle } from '../render/draw/types'

/**
 * Extra DrawContext backends for exports: a transform wrapper (drawings placed on a paper sheet),
 * a jsPDF vector backend and an ASCII DXF writer. The same drawing code feeds all of them.
 */

/** Places world-space drawing (meters) onto a sheet: p' = o + p·s. Strips screen-only text clamps. */
export class TransformContext implements DrawContext {
  kind: DrawContext['kind']
  pxPerMeter: number
  constructor(
    private inner: DrawContext,
    private s: number,
    private ox: number,
    private oy: number,
    private strokeScale = 1
  ) {
    this.kind = inner.kind
    this.pxPerMeter = inner.pxPerMeter * s
  }
  private p = (q: Vec2): Vec2 => ({ x: this.ox + q.x * this.s, y: this.oy + q.y * this.s })
  private st = (s: Stroke): Stroke => (this.strokeScale === 1 ? s : { ...s, width: s.width * this.strokeScale, dash: s.dash?.map((d) => d * this.strokeScale) })
  layer(name: string) {
    this.inner.layer(name)
  }
  polygon(pts: Vec2[], fill?: Fill | null, stroke?: Stroke | null, holes?: Vec2[][]) {
    this.inner.polygon(pts.map(this.p), fill, stroke ? this.st(stroke) : stroke, holes?.map((h) => h.map(this.p)))
  }
  polyline(pts: Vec2[], stroke: Stroke, closed?: boolean) {
    this.inner.polyline(pts.map(this.p), this.st(stroke), closed)
  }
  line(a: Vec2, b: Vec2, stroke: Stroke) {
    this.inner.line(this.p(a), this.p(b), this.st(stroke))
  }
  circle(c: Vec2, r: number, fill?: Fill | null, stroke?: Stroke | null) {
    this.inner.circle(this.p(c), r * this.s, fill, stroke ? this.st(stroke) : stroke)
  }
  arc(c: Vec2, r: number, a0: number, a1: number, stroke: Stroke) {
    this.inner.arc(this.p(c), r * this.s, a0, a1, this.st(stroke))
  }
  text(p: Vec2, s: string, t: TextStyle) {
    // drafting text keeps its true printed size on sheets (no on-screen min/max clamps)
    this.inner.text(this.p(p), s, { ...t, size: t.size * this.s, minPx: undefined, maxPx: undefined })
  }
}

const PT = 0.3528 // mm per point

/** Plain-ASCII drafting text for PDF core fonts and DXF. */
export function asciiText(s: string) {
  return s
    .replace(/′/g, "'")
    .replace(/″/g, '"')
    .replace(/²/g, '2')
    .replace(/×/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e]/g, '')
}

/** jsPDF backend. Coordinates are paper millimetres. */
export class PdfContext implements DrawContext {
  kind = 'pdf' as const
  pxPerMeter = 4000
  private alpha = 1
  constructor(private doc: jsPDF) {}
  layer() {}
  private setAlpha(a: number) {
    if (a === this.alpha) return
    this.alpha = a
    const d = this.doc as unknown as { GState: new (o: Record<string, number>) => unknown; setGState: (g: unknown) => void }
    d.setGState(new d.GState({ opacity: a, 'stroke-opacity': a }))
  }
  private stroke(s: Stroke) {
    this.doc.setDrawColor(s.color)
    this.doc.setLineWidth(Math.max(0.05, s.width * PT))
    this.doc.setLineDashPattern(s.dash ? s.dash.map((d) => d * PT) : [], 0)
    this.doc.setLineCap(s.cap === 'round' ? 'round' : s.cap === 'square' ? 'square' : 'butt')
    this.doc.setLineJoin('round')
  }
  private ring(pts: Vec2[], close: boolean) {
    this.doc.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) this.doc.lineTo(pts[i].x, pts[i].y)
    if (close) this.doc.close()
  }
  polygon(pts: Vec2[], fill?: Fill | null, stroke?: Stroke | null, holes?: Vec2[][]) {
    if (pts.length < 2 || (!fill && !stroke)) return
    if (fill) {
      this.setAlpha(fill.opacity ?? 1)
      this.doc.setFillColor(fill.color)
      this.ring(pts, true)
      for (const h of holes ?? []) if (h.length > 2) this.ring(h, true)
      this.doc.fillEvenOdd()
    }
    if (stroke) {
      this.setAlpha(stroke.opacity ?? 1)
      this.stroke(stroke)
      this.ring(pts, true)
      for (const h of holes ?? []) if (h.length > 2) this.ring(h, true)
      this.doc.stroke()
    }
    this.setAlpha(1)
  }
  polyline(pts: Vec2[], stroke: Stroke, closed = false) {
    if (pts.length < 2) return
    this.setAlpha(stroke.opacity ?? 1)
    this.stroke(stroke)
    this.ring(pts, closed)
    this.doc.stroke()
    this.setAlpha(1)
  }
  line(a: Vec2, b: Vec2, stroke: Stroke) {
    this.polyline([a, b], stroke)
  }
  circle(c: Vec2, r: number, fill?: Fill | null, stroke?: Stroke | null) {
    if (fill) {
      this.setAlpha(fill.opacity ?? 1)
      this.doc.setFillColor(fill.color)
    }
    if (stroke) this.stroke(stroke)
    this.doc.circle(c.x, c.y, r, fill && stroke ? 'FD' : fill ? 'F' : 'S')
    this.setAlpha(1)
  }
  arc(c: Vec2, r: number, a0: number, a1: number, stroke: Stroke) {
    const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 0.12))
    const pts: Vec2[] = []
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })
    }
    this.polyline(pts, stroke)
  }
  text(p: Vec2, s: string, t: TextStyle) {
    const sizeMm = t.size / 0.72
    const pt = sizeMm / PT
    if (pt < 2) return
    this.setAlpha(t.opacity ?? 1)
    this.doc.setTextColor(t.color)
    this.doc.setFont('helvetica', (t.weight ?? 450) >= 600 ? 'bold' : 'normal')
    this.doc.setFontSize(pt)
    this.doc.text(asciiText(s), p.x, p.y, {
      align: t.align ?? 'center',
      baseline: t.baseline === 'top' ? 'top' : t.baseline === 'bottom' ? 'bottom' : 'middle',
      angle: t.rotation ? (-t.rotation * 180) / Math.PI : 0
    })
    this.setAlpha(1)
  }
}

/* ── DXF ─────────────────────────────────────────────────────────────────── */

const ACI: [number, [number, number, number]][] = [
  [1, [255, 0, 0]],
  [2, [255, 255, 0]],
  [3, [0, 255, 0]],
  [4, [0, 255, 255]],
  [5, [0, 0, 255]],
  [6, [255, 0, 255]],
  [8, [128, 128, 128]],
  [9, [192, 192, 192]],
  [30, [255, 127, 0]],
  [250, [51, 51, 51]]
]

function aci(hex: string): number {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  if (Number.isNaN(n)) return 7
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const lum = (c[0] + c[1] + c[2]) / 3
  const sat = Math.max(...c) - Math.min(...c)
  if (sat < 40) return lum < 90 ? 7 : lum < 170 ? 8 : 9 // dark ink prints as 7 (black/white)
  let best = 7
  let bd = Infinity
  for (const [i, rgb] of ACI) {
    const d = (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}

/**
 * ASCII DXF (AutoCAD R12 entities + layer table). Units are metres, y flipped so plans read
 * north-up as drawn. Fills become outlines (R12 has no hatch); walls keep their poché outline.
 */
export class DxfContext implements DrawContext {
  kind = 'dxf' as const
  pxPerMeter = 200
  private cur = '0'
  private layers = new Map<string, number>()
  private out: string[] = []
  layer(name: string) {
    this.cur = name.replace(/[^A-Za-z0-9_-]/g, '_').toUpperCase() || '0'
  }
  private use(color: string) {
    if (!this.layers.has(this.cur)) this.layers.set(this.cur, aci(color))
    return aci(color)
  }
  private g(code: number, v: string | number) {
    this.out.push(String(code), typeof v === 'number' ? (Math.round(v * 1e6) / 1e6).toString() : v)
  }
  private poly(pts: Vec2[], closed: boolean, color: string) {
    if (pts.length < 2) return
    const c = this.use(color)
    this.g(0, 'POLYLINE')
    this.g(8, this.cur)
    this.g(62, c)
    this.g(66, 1)
    this.g(10, 0)
    this.g(20, 0)
    this.g(30, 0)
    this.g(70, closed ? 1 : 0)
    for (const p of pts) {
      this.g(0, 'VERTEX')
      this.g(8, this.cur)
      this.g(10, p.x)
      this.g(20, -p.y)
      this.g(30, 0)
    }
    this.g(0, 'SEQEND')
    this.g(8, this.cur)
  }
  polygon(pts: Vec2[], fill?: Fill | null, stroke?: Stroke | null, holes?: Vec2[][]) {
    const color = stroke?.color ?? fill?.color ?? '#000000'
    // skip pure background fills (paper, room tints) — they carry no geometry for CAD
    if (!stroke && fill && isLight(fill.color)) return
    this.poly(pts, true, color)
    for (const h of holes ?? []) this.poly(h, true, color)
  }
  polyline(pts: Vec2[], stroke: Stroke, closed = false) {
    this.poly(pts, closed, stroke.color)
  }
  line(a: Vec2, b: Vec2, stroke: Stroke) {
    const c = this.use(stroke.color)
    this.g(0, 'LINE')
    this.g(8, this.cur)
    this.g(62, c)
    this.g(10, a.x)
    this.g(20, -a.y)
    this.g(30, 0)
    this.g(11, b.x)
    this.g(21, -b.y)
    this.g(31, 0)
  }
  circle(c0: Vec2, r: number, fill?: Fill | null, stroke?: Stroke | null) {
    const c = this.use(stroke?.color ?? fill?.color ?? '#000000')
    this.g(0, 'CIRCLE')
    this.g(8, this.cur)
    this.g(62, c)
    this.g(10, c0.x)
    this.g(20, -c0.y)
    this.g(30, 0)
    this.g(40, r)
  }
  arc(c0: Vec2, r: number, a0: number, a1: number, stroke: Stroke) {
    const c = this.use(stroke.color)
    // y flip mirrors angles: plan angle a → −a; swap to keep counter-clockwise order
    const s = (-a1 * 180) / Math.PI
    const e = (-a0 * 180) / Math.PI
    this.g(0, 'ARC')
    this.g(8, this.cur)
    this.g(62, c)
    this.g(10, c0.x)
    this.g(20, -c0.y)
    this.g(30, 0)
    this.g(40, r)
    this.g(50, ((s % 360) + 360) % 360)
    this.g(51, ((e % 360) + 360) % 360)
  }
  text(p: Vec2, s: string, t: TextStyle) {
    const txt = asciiText(s)
    if (!txt.trim()) return
    const c = this.use(t.color)
    const h = t.align === 'left' ? 0 : t.align === 'right' ? 2 : 1
    const v = t.baseline === 'top' ? 3 : t.baseline === 'bottom' ? 1 : 2
    this.g(0, 'TEXT')
    this.g(8, this.cur)
    this.g(62, c)
    this.g(10, p.x)
    this.g(20, -p.y)
    this.g(30, 0)
    this.g(40, t.size)
    this.g(1, txt)
    if (t.rotation) this.g(50, (-t.rotation * 180) / Math.PI)
    this.g(72, h)
    this.g(73, v)
    this.g(11, p.x)
    this.g(21, -p.y)
    this.g(31, 0)
  }
  toString(): string {
    const head = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC']
    const tables = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(this.layers.size + 1)]
    tables.push('0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS')
    for (const [name, color] of this.layers) tables.push('0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS')
    tables.push('0', 'ENDTAB', '0', 'ENDSEC')
    return [...head, ...tables, '0', 'SECTION', '2', 'ENTITIES', ...this.out, '0', 'ENDSEC', '0', 'EOF'].join('\r\n') + '\r\n'
  }
}

function isLight(hex: string) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  if (Number.isNaN(n)) return false
  return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255) > 3 * 200
}
