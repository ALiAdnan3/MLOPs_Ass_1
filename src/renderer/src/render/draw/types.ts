import type { Vec2 } from '../../core/model/types'

/**
 * Backend-agnostic drawing interface. The plan, elevations, sections and sheets are drawn once
 * against this API and rendered by Canvas (editor), SVG, PDF and DXF backends — so every export
 * is generated from the same model and the same drawing code.
 */

export interface Stroke {
  color: string
  /** Line weight in points (1pt ≈ 0.35 mm on paper; ≈ 1 CSS px on screen). */
  width: number
  dash?: number[]
  cap?: 'butt' | 'round' | 'square'
  opacity?: number
}

export interface Fill {
  color: string
  opacity?: number
}

export interface TextStyle {
  /** Cap height in world meters (scales with zoom). */
  size: number
  color: string
  weight?: number
  align?: 'left' | 'center' | 'right'
  baseline?: 'top' | 'middle' | 'bottom'
  /** Radians. */
  rotation?: number
  /** Narrow drafting lettering. */
  condensed?: boolean
  /** Minimum on-screen size in px (canvas only). */
  minPx?: number
  /** Maximum on-screen size in px (canvas only). */
  maxPx?: number
  opacity?: number
}

export interface DrawContext {
  kind: 'canvas' | 'svg' | 'pdf' | 'dxf'
  /** Screen/paper pixels per meter — for level-of-detail decisions. */
  pxPerMeter: number
  layer(name: string): void
  polygon(pts: Vec2[], fill?: Fill | null, stroke?: Stroke | null, holes?: Vec2[][]): void
  polyline(pts: Vec2[], stroke: Stroke, closed?: boolean): void
  line(a: Vec2, b: Vec2, stroke: Stroke): void
  circle(c: Vec2, r: number, fill?: Fill | null, stroke?: Stroke | null): void
  arc(c: Vec2, r: number, a0: number, a1: number, stroke: Stroke): void
  text(p: Vec2, s: string, style: TextStyle): void
}

/** Parallel hatch lines clipped to a polygon (drawn with the context's own line primitive). */
export function hatch(dc: DrawContext, poly: Vec2[], spacing: number, angle: number, stroke: Stroke) {
  if (poly.length < 3 || spacing <= 0) return
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  // rotate into hatch frame
  const rot = poly.map((p) => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c }))
  const ys = rot.map((p) => p.y)
  const y0 = Math.ceil(Math.min(...ys) / spacing) * spacing
  const y1 = Math.max(...ys)
  let count = 0
  for (let y = y0; y <= y1 && count < 4000; y += spacing, count++) {
    const xs: number[] = []
    for (let i = 0; i < rot.length; i++) {
      const a = rot[i]
      const b = rot[(i + 1) % rot.length]
      if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
    }
    xs.sort((m, n) => m - n)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const A = { x: xs[k] * c - y * s, y: xs[k] * s + y * c }
      const B = { x: xs[k + 1] * c - y * s, y: xs[k + 1] * s + y * c }
      dc.line(A, B, stroke)
    }
  }
}
