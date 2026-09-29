import type { ProceduralKind } from '../../core/model/types'
import { clamp01, hexToRgb, makeNoise, mix, smooth } from './noise'

/**
 * Procedural, seamless PBR textures for the material library (§16) — generated offline at the
 * requested resolution. Each generator returns colour (RGBA), a height field (for normal maps)
 * and a roughness modulation field.
 */

export interface TexRequest {
  kind: ProceduralKind
  colors: string[]
  params?: Record<string, number>
  seed: number
  size: number
  /** Real-world size of the texture tile (m) — pattern sizes are relative to this. */
  scale: number
}

export interface TexResult {
  size: number
  color: Uint8ClampedArray
  height: Float32Array
  rough: Float32Array
}

type RGB = [number, number, number]

export function generateTexture(req: TexRequest): TexResult {
  const N = req.size
  const color = new Uint8ClampedArray(N * N * 4)
  const height = new Float32Array(N * N)
  const rough = new Float32Array(N * N).fill(1)
  const nz = makeNoise(req.seed)
  const P = req.params ?? {}
  const C: RGB[] = req.colors.map(hexToRgb)
  while (C.length < 4) C.push(C[C.length - 1] ?? [200, 200, 200])
  const S = req.scale
  const put = (i: number, c: RGB, h: number, r = 1) => {
    color[i * 4] = c[0]
    color[i * 4 + 1] = c[1]
    color[i * 4 + 2] = c[2]
    color[i * 4 + 3] = 255
    height[i] = h
    rough[i] = r
  }
  const lerpC = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
  const shade = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k]
  const hash = (a: number, b: number) => {
    let h = (a * 374761393 + b * 668265263 + req.seed * 1442695041) | 0
    h = (h ^ (h >>> 13)) * 1274126177
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  const count = (size: number) => Math.max(1, Math.round(S / Math.max(0.01, size)))

  for (let y = 0; y < N; y++) {
    const v = y / N
    for (let x = 0; x < N; x++) {
      const u = x / N
      const i = y * N + x
      switch (req.kind) {
        case 'marble': {
          const cloud = nz.fbm(u, v, 3, 5)
          const t = nz.turb(u, v, 2, 6)
          const veinA = Math.abs(Math.sin(Math.PI * 2 * (u * 2 + v) + t * 7 + cloud * 2))
          const veinB = Math.abs(Math.sin(Math.PI * 2 * (u - v * 2) * 2 + nz.turb(u + 0.37, v, 3, 5) * 9))
          const vi = P.veins ?? 0.5
          const soft = 1 - smooth(0, 0.35 * vi + 0.05, veinA)
          const thin = 1 - smooth(0, 0.035 * vi + 0.008, veinB)
          let c = lerpC(C[0], shade(C[0], 0.93), cloud)
          c = lerpC(c, C[1], soft * 0.55 * vi + 0.05 * soft)
          c = lerpC(c, C[2], thin * 0.8)
          let h = 0.5 - thin * 0.05
          let r = 1 - soft * 0.1
          if ((P.tile ?? 0) > 0) {
            const n = count(P.tile)
            const gu = (u * n) % 1
            const gv = (v * n) % 1
            // distance to the nearest joint in meters; 1.5 mm joints
            const dm = Math.min(gu, 1 - gu, gv, 1 - gv) * (S / n)
            if (dm < 0.0015) {
              c = shade(c, 0.86)
              h = 0.35
              r = 1.3
            }
            // slight per-tile tone variation, like real slabs from different blocks
            const tid = hash(Math.floor(u * n), Math.floor(v * n))
            c = shade(c, 0.97 + tid * 0.05)
          }
          put(i, c, h, r)
          break
        }
        case 'granite': {
          const base = nz.fbm(u, v, 6, 4)
          const fine = nz.noise(u * 180, v * 180, 180, 180)
          const fine2 = nz.noise(u * 90 + 5, v * 90 + 3, 90, 90)
          const speck = P.speck ?? 0.3
          let c = lerpC(C[0], C[1], smooth(0.35, 0.75, fine2 * 0.7 + base * 0.3))
          if (fine > 1 - speck * 0.35) c = lerpC(c, C[2], smooth(1 - speck * 0.35, 1, fine) * 0.9 + 0.1)
          put(i, c, 0.5 + (fine - 0.5) * 0.04, 1 + (fine2 - 0.5) * 0.2)
          break
        }
        case 'tiles':
        case 'pavers': {
          const tw = P.tw ?? P.pw ?? 0.6
          const th = P.th ?? P.ph ?? 0.6
          const nx = count(tw)
          const ny = count(th)
          const row = Math.floor(v * ny)
          const off = (P.stagger ?? (req.kind === 'pavers' ? 1 : 0)) && row % 2 ? 0.5 / nx : 0
          const uu = (u + off) % 1
          const col = Math.floor(uu * nx)
          const fu = (uu * nx) % 1
          const fv = (v * ny) % 1
          const grout = (P.grout ?? (req.kind === 'pavers' ? 0.006 : 0.003)) / S
          const gx = grout * nx
          const gy = grout * ny
          const edge = Math.min(fu / gx, (1 - fu) / gx, fv / gy, (1 - fv) / gy)
          const tvar = hash(col, row)
          const noiseAmt = P.noise ?? 0.08
          let c = shade(C[0], 1 - noiseAmt / 2 + tvar * noiseAmt)
          c = lerpC(c, shade(C[0], 0.92), nz.fbm(u, v, 8, 3) * 0.4)
          if (req.kind === 'pavers') c = lerpC(C[Math.floor(tvar * 3) % 3], c, 0.5)
          if (P.motif) {
            // encaustic rosette
            const cx = fu - 0.5
            const cy = fv - 0.5
            const rr = Math.hypot(cx, cy)
            const ang = Math.atan2(cy, cx)
            const petal = Math.abs(Math.cos(ang * 4)) * 0.28 + 0.08
            if (rr < petal || Math.abs(Math.abs(cx) - Math.abs(cy)) < 0.03 || Math.min(fu, 1 - fu, fv, 1 - fv) < 0.06) c = C[1]
          }
          let h = 0.55
          let r = 1
          if (edge < 1) {
            c = C[1]
            h = 0.3
            r = 1.4
          } else if (edge < 2.2) h = 0.3 + 0.25 * ((edge - 1) / 1.2)
          put(i, c, h, r)
          break
        }
        case 'wood': {
          const pw = P.plank ?? 0.19
          const pl = P.length ?? 1.6
          const ny = count(pw)
          const row = Math.floor(v * ny)
          const nx = Math.max(1, Math.round(S / pl))
          const off = hash(row, 7) * 0.8
          const uu = (u + off / nx) % 1
          const col = Math.floor(uu * nx)
          const fv = (v * ny) % 1
          const fu = (uu * nx) % 1
          const tone = hash(row, col)
          const grain = nz.fbm(u * 1, v * 1, 4, 4)
          const rings = Math.sin((fv * 3 + grain * 5 + tone * 10) * Math.PI * 2 + Math.sin(u * Math.PI * 2 * nx * 1.5) * 0.6) * 0.5 + 0.5
          const fibers = nz.noise(u * 400, v * 12 * ny, 400, 12 * ny)
          let c = lerpC(C[0], C[1], smooth(0.2, 0.95, rings) * 0.6 + fibers * 0.25)
          c = lerpC(c, C[2], tone * 0.35)
          const gap = (P.gap ? 0.006 : 0.0015) / S
          const eu = Math.min(fu, 1 - fu) / (gap * nx)
          const ev = Math.min(fv, 1 - fv) / (gap * ny)
          let h = 0.5 + (fibers - 0.5) * 0.08
          let r = 1 + (rings - 0.5) * 0.15
          if (eu < 1 || ev < 1) {
            c = shade(c, 0.45)
            h = 0.25
            r = 1.3
          }
          put(i, c, h, r)
          break
        }
        case 'parquet': {
          const pw = P.plank ?? 0.09
          const blocks = count(pw * 3)
          const bx = Math.floor(u * blocks)
          const by = Math.floor(v * blocks)
          const lu = (u * blocks) % 1
          const lv = (v * blocks) % 1
          const horiz = (bx + by) % 2 === 0
          const along = horiz ? lu : lv
          const across = horiz ? lv : lu
          const plank = Math.floor(across * 3)
          const fa = (across * 3) % 1
          const tone = hash(bx * 3 + plank, by)
          const grain = Math.sin((along * 6 + nz.fbm(u, v, 6, 3) * 4 + tone * 5) * Math.PI * 2) * 0.5 + 0.5
          let c = lerpC(C[0], C[1], grain * 0.5)
          c = lerpC(c, C[2], tone * 0.4)
          let h = 0.5
          const e = Math.min(fa, 1 - fa, along, 1 - along)
          if (e < 0.03) {
            c = shade(c, 0.5)
            h = 0.3
          }
          put(i, c, h, 1)
          break
        }
        case 'concrete':
        case 'terrazzo': {
          const f = nz.fbm(u, v, 4, 5)
          const pores = nz.cells(u, v, 40)
          let c = lerpC(C[0], C[1], f)
          let h = 0.5 + (f - 0.5) * 0.1
          if (req.kind === 'terrazzo') {
            const chip = nz.cells(u, v, 22)
            if (chip.d1 < 0.32) {
              const k = chip.id % 3
              c = C[1 + k] ?? C[1]
              h = 0.52
            } else c = lerpC(C[0], shade(C[0], 0.95), f)
          } else if (pores.d1 < 0.08) {
            c = shade(c, 0.75)
            h = 0.4
          }
          if (P.boards) {
            const nb = count(P.boards)
            const fb = (v * nb) % 1
            if (Math.min(fb, 1 - fb) < 0.02) {
              c = shade(c, 0.85)
              h = 0.42
            }
            c = shade(c, 0.95 + hash(Math.floor(v * nb), 3) * 0.08)
          }
          put(i, c, h, 1 + (f - 0.5) * 0.2)
          break
        }
        case 'brick': {
          const bw = (P.bw ?? 0.228) + (P.mortar ?? 0.01)
          const bh = (P.bh ?? 0.076) + (P.mortar ?? 0.01)
          const nx = count(bw)
          const ny = count(bh)
          const row = Math.floor(v * ny)
          const uu = (u + (row % 2 ? 0.5 / nx : 0)) % 1
          const col = Math.floor(uu * nx)
          const fu = (uu * nx) % 1
          const fv = (v * ny) % 1
          const m = (P.mortar ?? 0.01) / S
          const edge = Math.min(fu / (m * nx), (1 - fu) / (m * nx), fv / (m * ny), (1 - fv) / (m * ny))
          const t = hash(col, row)
          let c = t < 0.33 ? C[0] : t < 0.66 ? C[1] : C[2]
          c = lerpC(c, shade(c, 0.85), nz.fbm(u, v, 12, 3))
          let h = 0.6 + (nz.noise(u * 200, v * 200, 200, 200) - 0.5) * 0.05
          let r = 1
          if (edge < 1) {
            c = lerpC(C[3], shade(C[3], 0.9), nz.noise(u * 300, v * 300, 300, 300))
            h = 0.3
            r = 1.2
          }
          put(i, c, h, r)
          break
        }
        case 'stone': {
          let c: RGB
          let h = 0.5
          if (P.ledge) {
            const ny = count(0.07)
            const row = Math.floor(v * ny)
            const nx = 3 + Math.floor(hash(row, 1) * 3)
            const uu = (u + hash(row, 2)) % 1
            const col = Math.floor(uu * nx)
            const fv = (v * ny) % 1
            const fu = (uu * nx) % 1
            const t = hash(col, row)
            c = t < 0.33 ? C[0] : t < 0.66 ? C[1] : C[2]
            c = lerpC(c, shade(c, 0.8), nz.fbm(u, v, 16, 3))
            h = 0.5 + t * 0.3 + (nz.noise(u * 100, v * 100, 100, 100) - 0.5) * 0.1
            if (fv < 0.12 || fu < 0.02) {
              c = shade(C[1], 0.35)
              h = 0.05
            }
          } else if (P.ashlar) {
            const ny = count(0.3)
            const row = Math.floor(v * ny)
            const nx = 2 + Math.floor(hash(row, 5) * 3)
            const uu = (u + hash(row, 9) * 0.5) % 1
            const col = Math.floor(uu * nx)
            const fv = (v * ny) % 1
            const fu = (uu * nx) % 1
            const t = hash(col, row)
            c = lerpC(C[0], C[2], t)
            c = lerpC(c, C[1], nz.fbm(u, v, 10, 4) * 0.6)
            h = 0.55 + (nz.fbm(u, v, 20, 3) - 0.5) * 0.2
            if (Math.min(fv * ny * 0.3, (1 - fv) * ny * 0.3) < 0.012 * ny * 0.3 * 3 || Math.min(fu, 1 - fu) * (S / nx) < 0.008) {
              c = shade(C[1], 0.6)
              h = 0.2
            }
          } else {
            // travertine / limestone: horizontal banding and pits
            const band = nz.fbm(u * 0.3, v * 3, 3, 5)
            c = lerpC(C[0], C[1], smooth(0.3, 0.8, band))
            c = lerpC(c, C[2], nz.fbm(u, v, 8, 3) * 0.3)
            if (P.pores) {
              const p = nz.cells(u * 3, v, 30)
              if (p.d1 < 0.12 && hash(p.id, 1) > 0.5) {
                c = shade(c, 0.7)
                h = 0.3
              }
            }
            if ((P.tile ?? 0) > 0) {
              const n = count(P.tile!)
              const fu = (u * n) % 1
              const fv = (v * n) % 1
              if (Math.min(fu, 1 - fu, fv, 1 - fv) < 0.004 * n) {
                c = shade(c, 0.8)
                h = 0.3
              }
            }
          }
          put(i, c, h, 1)
          break
        }
        case 'slate': {
          const layers = nz.fbm(u, v * 0.4, 5, 6)
          const cleft = nz.turb(u, v, 8, 4)
          let c = lerpC(C[0], C[1], layers)
          c = lerpC(c, C[2], smooth(0.5, 0.9, cleft) * 0.5)
          put(i, c, 0.5 + (cleft - 0.5) * 0.3, 1 + (layers - 0.5) * 0.3)
          break
        }
        case 'plaster': {
          const f = nz.fbm(u, v, 12, 4)
          const amt = P.rough ? 0.12 : 0.035
          put(i, shade(C[0], 1 - amt / 2 + f * amt), 0.5 + (f - 0.5) * (P.rough ? 0.5 : 0.08), 1)
          break
        }
        case 'metal': {
          const streak = P.brushed ? nz.fbm(u * 0.02, v * 1, 180, 2) : nz.fbm(u, v, 20, 3)
          put(i, shade(C[0], 0.92 + streak * 0.16), 0.5 + (streak - 0.5) * 0.04, 1 + (streak - 0.5) * 0.4)
          break
        }
        case 'glass':
        case 'water': {
          const w = req.kind === 'water' ? nz.turb(u, v, 6, 4) : nz.fbm(u, v, 8, 2)
          const c = req.kind === 'water' ? lerpC(C[0], C[1], smooth(0.1, 0.5, 1 - w)) : C[0]
          put(i, c, 0.5 + (w - 0.5) * (req.kind === 'water' ? 0.6 : 0.02), 1)
          break
        }
        case 'roof-tiles': {
          const ny = count(0.33)
          const nx = count(0.22)
          const row = Math.floor(v * ny)
          const uu = (u + (row % 2 ? 0.5 / nx : 0)) % 1
          const col = Math.floor(uu * nx)
          const fu = (uu * nx) % 1
          const fv = (v * ny) % 1
          const barrel = Math.sin(fu * Math.PI)
          const t = hash(col, row)
          let c = t < 0.33 ? C[0] : t < 0.66 ? C[1] : C[2]
          c = shade(c, 0.7 + barrel * 0.35 - (1 - fv) * 0.12)
          put(i, c, barrel * 0.8 * (0.4 + fv * 0.6), 1)
          break
        }
        case 'shingles': {
          const ny = count(0.18)
          const nx = count(0.3)
          const row = Math.floor(v * ny)
          const uu = (u + (row % 2 ? 0.5 / nx : 0)) % 1
          const col = Math.floor(uu * nx)
          const fu = (uu * nx) % 1
          const fv = (v * ny) % 1
          const t = hash(col, row)
          let c = lerpC(C[0], C[2], t)
          c = lerpC(c, C[1], nz.fbm(u, v, 20, 3) * 0.4)
          let h = 0.4 + fv * 0.4
          if (fv > 0.9 || Math.min(fu, 1 - fu) < 0.015) {
            c = shade(c, 0.5)
            h = 0.1
          }
          put(i, c, h, 1)
          break
        }
        case 'standing-seam': {
          const n = count(0.5)
          const fu = (u * n) % 1
          const seam = Math.exp(-Math.pow((fu - 0.5) * 40, 2))
          const c = shade(lerpC(C[0], C[1], nz.fbm(u, v, 4, 2) * 0.3), 0.95 + seam * 0.2)
          put(i, c, 0.4 + seam * 0.5, 1)
          break
        }
        case 'wallpaper': {
          const motif = P.motif ?? 1
          const n = count(motif === 2 ? 0.05 : 0.25)
          const fu = (u * n) % 1
          const fv = (v * n) % 1
          let on = false
          if (motif === 1) {
            const cx = fu - 0.5
            const cy = fv - 0.5
            const r = Math.hypot(cx * 1.3, cy)
            const a = Math.atan2(cy, cx)
            on = r < 0.18 + 0.12 * Math.cos(a * 3) * Math.sin(a * 2) || (Math.abs(r - 0.38) < 0.02 && Math.cos(a * 8) > 0)
          } else if (motif === 2) on = fu < 0.18
          else if (motif === 3) on = Math.abs(Math.abs(fu - 0.5) + Math.abs(fv - 0.5) - 0.35) < 0.04
          else {
            const lx = fu - 0.5
            const ly = fv - 0.5
            const rot = hash(Math.floor(u * n), Math.floor(v * n)) * Math.PI
            const rx = lx * Math.cos(rot) - ly * Math.sin(rot)
            const ry = lx * Math.sin(rot) + ly * Math.cos(rot)
            on = rx * rx / 0.09 + ry * ry / 0.012 < 1
          }
          const base = shade(C[0], 0.97 + nz.fbm(u, v, 30, 2) * 0.06)
          put(i, on ? C[1] : base, on ? 0.52 : 0.5, 1)
          break
        }
        case 'grass': {
          const f = nz.fbm(u, v, 6, 5)
          const blades = nz.noise(u * 260, v * 60, 260, 60)
          let c = lerpC(C[0], C[1], f)
          c = lerpC(c, C[2], smooth(0.6, 1, blades) * 0.6)
          put(i, c, 0.4 + blades * 0.3, 1)
          break
        }
        case 'asphalt':
        case 'gravel': {
          const cell = nz.cells(u, v, req.kind === 'gravel' ? 90 : 160)
          const t = hash(cell.id, 3)
          let c = t < 0.4 ? C[0] : t < 0.8 ? C[1] : C[2]
          c = shade(c, 0.85 + (1 - cell.d1) * 0.25)
          const h = req.kind === 'gravel' ? 0.6 - cell.d1 * 0.4 : 0.5 + (cell.d2 - cell.d1) * 0.1
          put(i, c, h, 1)
          break
        }
        case 'fabric': {
          const n = count(0.004)
          const w1 = Math.sin(u * n * Math.PI * 2)
          const w2 = Math.sin(v * n * Math.PI * 2)
          const weave = (w1 * w2 + 1) / 2
          const f = nz.fbm(u, v, 20, 3)
          put(i, lerpC(C[0], C[1], weave * 0.5 + f * 0.3), 0.5 + weave * 0.15, 1)
          break
        }
        default:
          put(i, C[0], 0.5, 1)
      }
    }
  }
  return { size: N, color, height, rough }
}

/** Normal map from a height field (tileable Sobel). strength ~1–4. */
export function heightToNormal(h: Float32Array, N: number, strength = 2): Uint8ClampedArray {
  const out = new Uint8ClampedArray(N * N * 4)
  const at = (x: number, y: number) => h[((y + N) % N) * N + ((x + N) % N)]
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength
      const nz = 1
      const l = Math.hypot(dx, dy, nz)
      const i = (y * N + x) * 4
      out[i] = ((-dx / l) * 0.5 + 0.5) * 255
      out[i + 1] = ((dy / l) * 0.5 + 0.5) * 255
      out[i + 2] = ((nz / l) * 0.5 + 0.5) * 255
      out[i + 3] = 255
    }
  return out
}

/** Roughness map (G channel) from a base roughness and modulation field. */
export function roughnessMap(base: number, mod: Float32Array, N: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(N * N * 4)
  for (let i = 0; i < N * N; i++) {
    const r = clamp01(base * mod[i]) * 255
    out[i * 4] = r
    out[i * 4 + 1] = r
    out[i * 4 + 2] = r
    out[i * 4 + 3] = 255
  }
  return out
}

/** Apply brightness/contrast (−1..1) in place. */
export function adjustColor(c: Uint8ClampedArray, brightness: number, contrast: number) {
  if (!brightness && !contrast) return c
  const k = Math.tan(((contrast + 1) * Math.PI) / 4)
  for (let i = 0; i < c.length; i += 4) {
    for (let j = 0; j < 3; j++) {
      const v = c[i + j] / 255
      c[i + j] = clamp01((v - 0.5) * k + 0.5 + brightness * 0.5) * 255
    }
  }
  return c
}
