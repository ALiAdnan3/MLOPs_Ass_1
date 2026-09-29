import type { Vec2 } from '../model/types'

export const EPS = 1e-6

export const v = (x: number, y: number): Vec2 => ({ x, y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x
export const len = (a: Vec2) => Math.hypot(a.x, a.y)
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
export const eq = (a: Vec2, b: Vec2, tol = 1e-4) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol

export function norm(a: Vec2): Vec2 {
  const l = len(a)
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}

/** Left normal in a y-down plan (rotate +90° in math coords = (−y, x) → in y-down that is visually "left" walking a→b). */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x })

export function rotate(p: Vec2, angle: number, origin: Vec2 = { x: 0, y: 0 }): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c }
}

export const round = (n: number, step = 1e-4) => Math.round(n / step) * step
export const roundV = (p: Vec2, step = 1e-4): Vec2 => ({ x: round(p.x, step), y: round(p.y, step) })

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export const angleOf = (a: Vec2) => Math.atan2(a.y, a.x)

export function normalizeAngle(a: number) {
  let r = a % (Math.PI * 2)
  if (r < 0) r += Math.PI * 2
  return r
}
