/** Tileable value noise + fBm on a unit square (period = frequency), seeded. */

export function makeNoise(seed: number) {
  const perm = new Uint16Array(512)
  const vals = new Float32Array(256)
  let s = seed >>> 0 || 1
  const rnd = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  for (let i = 0; i < 256; i++) vals[i] = rnd()

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  /** Value noise at (x, y) with integer period px, py (tileable). Returns 0..1. */
  function noise(x: number, y: number, px: number, py: number) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const x0 = ((xi % px) + px) % px
    const y0 = ((yi % py) + py) % py
    const x1 = (x0 + 1) % px
    const y1 = (y0 + 1) % py
    const v = (a: number, b: number) => vals[perm[(perm[a & 255] + b) & 511] & 255]
    const u = fade(xf)
    const w = fade(yf)
    const a = v(x0, y0) + (v(x1, y0) - v(x0, y0)) * u
    const b = v(x0, y1) + (v(x1, y1) - v(x0, y1)) * u
    return a + (b - a) * w
  }
  /** Tileable fBm on u,v ∈ [0,1): base frequency f, octaves n. Returns ~0..1. */
  function fbm(u: number, v: number, f: number, octaves = 5, gain = 0.5) {
    let amp = 1
    let sum = 0
    let norm = 0
    let freq = f
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(u * freq, v * freq, freq, freq)
      norm += amp
      amp *= gain
      freq *= 2
    }
    return sum / norm
  }
  /** Ridged/turbulent variant (|2n−1|). */
  function turb(u: number, v: number, f: number, octaves = 5) {
    let amp = 1
    let sum = 0
    let norm = 0
    let freq = f
    for (let o = 0; o < octaves; o++) {
      sum += amp * Math.abs(noise(u * freq, v * freq, freq, freq) * 2 - 1)
      norm += amp
      amp *= 0.5
      freq *= 2
    }
    return sum / norm
  }
  /** Tileable cellular (Worley F1) distance on a grid of n×n cells. */
  function cells(u: number, v: number, n: number) {
    const x = u * n
    const y = v * n
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    let d1 = 9
    let d2 = 9
    let id = 0
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx
        const cy = yi + dy
        const wx = ((cx % n) + n) % n
        const wy = ((cy % n) + n) % n
        const h = perm[(perm[wx & 255] + wy) & 511]
        const fx = cx + vals[h]
        const fy = cy + vals[(h * 7 + 13) & 255]
        const d = Math.hypot(x - fx, y - fy)
        if (d < d1) {
          d2 = d1
          d1 = d
          id = h
        } else if (d < d2) d2 = d
      }
    return { d1, d2, id }
  }
  return { noise, fbm, turb, cells, rnd }
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const mix = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
