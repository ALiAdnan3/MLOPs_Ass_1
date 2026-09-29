import type { MaterialAnalysis, MaterialCategory } from '../core/model/types'

/**
 * AI MATERIAL PROCESSING (§14). Classical computer vision on the uploaded photo:
 *  - colour: average + k-means dominant colours;
 *  - texture statistics: luminance spread, saturation, edge density;
 *  - structure tensor coherence → directional grain (wood, brushed metal);
 *  - autocorrelation of edge profiles → grout / joint periodicity (tiles, bricks, planks) and
 *    the repeat size, from which a real-world scale is estimated;
 *  - veins / speckle detection for marble and granite.
 * Then derives PBR maps: seamless base colour, height, normal and roughness.
 */

export interface AnalysisInput {
  data: Uint8ClampedArray
  w: number
  h: number
}

export interface PBRMaps {
  size: number
  base: Uint8ClampedArray
  height: Uint8ClampedArray
  normal: Uint8ClampedArray
  rough: Uint8ClampedArray
}

const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

function toHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}

function rgbToHsv(r: number, g: number, b: number) {
  r /= 255
  g /= 255
  b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: mx ? d / mx : 0, v: mx }
}

function kmeans(px: number[][], k: number, iters = 8) {
  const cs = Array.from({ length: k }, (_, i) => px[Math.floor(((i + 0.5) * px.length) / k)].slice())
  const assign = new Array(px.length).fill(0)
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < px.length; i++) {
      let best = 0
      let bd = Infinity
      for (let c = 0; c < k; c++) {
        const d = (px[i][0] - cs[c][0]) ** 2 + (px[i][1] - cs[c][1]) ** 2 + (px[i][2] - cs[c][2]) ** 2
        if (d < bd) {
          bd = d
          best = c
        }
      }
      assign[i] = best
    }
    const sums = cs.map(() => [0, 0, 0, 0])
    for (let i = 0; i < px.length; i++) {
      const s = sums[assign[i]]
      s[0] += px[i][0]
      s[1] += px[i][1]
      s[2] += px[i][2]
      s[3]++
    }
    for (let c = 0; c < k; c++) if (sums[c][3]) cs[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]]
  }
  const counts = cs.map((_, c) => assign.filter((a) => a === c).length)
  return cs.map((c, i) => ({ c, n: counts[i] })).sort((a, b) => b.n - a.n)
}

/** Dominant period (in px) and its strength from a 1D profile via autocorrelation. */
function period(profile: Float32Array): { p: number; strength: number } {
  const n = profile.length
  let mean = 0
  for (const v of profile) mean += v
  mean /= n
  let v0 = 0
  for (const v of profile) v0 += (v - mean) ** 2
  if (v0 < 1e-9) return { p: 0, strength: 0 }
  let best = { p: 0, strength: 0 }
  for (let lag = 6; lag < n / 2; lag++) {
    let s = 0
    for (let i = 0; i + lag < n; i++) s += (profile[i] - mean) * (profile[i + lag] - mean)
    const r = s / v0
    if (r > best.strength) best = { p: lag, strength: r }
  }
  return best
}

export function analyzeImage(inp: AnalysisInput): MaterialAnalysis {
  const { data, w, h } = inp
  const N = w * h
  const L = new Float32Array(N)
  let sr = 0
  let sg = 0
  let sb = 0
  let sat = 0
  let hueX = 0
  let hueY = 0
  let bright = 0
  const sample: number[][] = []
  for (let i = 0; i < N; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    L[i] = lum(r, g, b)
    sr += r
    sg += g
    sb += b
    const hsv = rgbToHsv(r, g, b)
    sat += hsv.s
    if (hsv.s > 0.12) {
      hueX += Math.cos((hsv.h * Math.PI) / 180) * hsv.s
      hueY += Math.sin((hsv.h * Math.PI) / 180) * hsv.s
    }
    if (L[i] > 0.92) bright++
    if (i % Math.max(1, Math.floor(N / 3000)) === 0) sample.push([r, g, b])
  }
  const avg = [sr / N, sg / N, sb / N]
  const meanSat = sat / N
  const hue = ((Math.atan2(hueY, hueX) * 180) / Math.PI + 360) % 360
  let meanL = 0
  for (const v of L) meanL += v
  meanL /= N
  let varL = 0
  for (const v of L) varL += (v - meanL) ** 2
  const stdL = Math.sqrt(varL / N)
  // gradients, structure tensor, edge profiles
  let jxx = 0
  let jyy = 0
  let jxy = 0
  let edge = 0
  const colProfile = new Float32Array(w)
  const rowProfile = new Float32Array(h)
  let darkThin = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = L[i + 1] - L[i - 1]
      const gy = L[i + w] - L[i - w]
      jxx += gx * gx
      jyy += gy * gy
      jxy += gx * gy
      const m = Math.abs(gx) + Math.abs(gy)
      edge += m
      colProfile[x] += Math.abs(gx)
      rowProfile[y] += Math.abs(gy)
      // thin dark line detector (veins): darker than both neighbours across either axis
      const c = L[i]
      if ((c < L[i - 1] - 0.05 && c < L[i + 1] - 0.05) || (c < L[i - w] - 0.05 && c < L[i + w] - 0.05)) darkThin++
    }
  }
  const coherence = jxx + jyy > 1e-9 ? Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / (jxx + jyy) : 0
  const edgeDensity = edge / N
  const pc = period(colProfile)
  const pr = period(rowProfile)
  const gridScore = Math.min(pc.strength, pr.strength)
  const veinScore = darkThin / N
  const dom = kmeans(sample, 4)
  const warm = hue > 10 && hue < 50 && meanSat > 0.2
  const reddish = (hue < 25 || hue > 340) && meanSat > 0.3
  const green = hue > 70 && hue < 160 && meanSat > 0.25
  const notes: string[] = []

  // ── classification ──
  let type: MaterialCategory = 'stone'
  let pattern: MaterialAnalysis['pattern'] = 'none'
  let conf = 0.5
  if (stdL < 0.025 && edgeDensity < 0.02) {
    type = 'paint'
    conf = 0.85
    notes.push('Very uniform colour — treated as paint')
  } else if (green && edgeDensity > 0.05) {
    type = 'ground'
    conf = 0.6
    notes.push('Green, fine texture — looks like grass')
  } else if (gridScore > 0.3 && reddish && pr.p && pc.p && pc.p > pr.p * 1.6) {
    type = 'brick'
    pattern = 'bricks'
    conf = 0.55 + gridScore * 0.4
    notes.push('Regular horizontal courses with wider units — brickwork')
  } else if (coherence > 0.45 && (warm || (meanSat > 0.12 && hue < 60))) {
    type = 'wood'
    pattern = gridScore > 0.2 ? 'planks' : 'stripes'
    conf = 0.5 + coherence * 0.4
    notes.push('Strong directional grain in warm tones — wood')
  } else if (coherence > 0.5 && meanSat < 0.12) {
    type = 'metal'
    pattern = 'stripes'
    conf = 0.5 + coherence * 0.3
    notes.push('Fine parallel streaks, low saturation — brushed metal')
  } else if (gridScore > 0.35) {
    type = meanL > 0.55 ? 'ceramic' : 'porcelain'
    pattern = 'tiles'
    conf = 0.5 + gridScore * 0.45
    notes.push('Repeating joints on both axes — tiles')
  } else if (meanL > 0.6 && meanSat < 0.2 && veinScore > 0.004) {
    type = 'marble'
    pattern = 'veins'
    conf = 0.55 + Math.min(0.35, veinScore * 20)
    notes.push('Light stone with fine darker veins — marble')
  } else if (edgeDensity > 0.09 && stdL > 0.12) {
    type = 'granite'
    pattern = 'speckled'
    conf = 0.55
    notes.push('Dense contrasting speckles — granite')
  } else if (meanSat < 0.1 && stdL < 0.1) {
    type = 'concrete'
    conf = 0.55
    notes.push('Grey, low-contrast texture — concrete or plaster')
  } else if (meanSat > 0.25 && stdL > 0.12 && coherence < 0.3 && gridScore < 0.2 && dom.length >= 2 && dist3(dom[0].c, dom[1].c) > 90) {
    type = 'wallpaper'
    conf = 0.45
    notes.push('Two strong contrasting colours in a repeating motif — wallpaper')
  } else if (meanL > 0.55 && meanSat < 0.25 && veinScore > 0.002) {
    type = 'marble'
    pattern = 'veins'
    conf = 0.45
  } else {
    type = 'stone'
    conf = 0.45
    notes.push('Natural texture without joints — stone')
  }

  // ── physical estimates ──
  const highlight = bright / N
  const prior: Record<string, [number, number]> = {
    marble: [0.15, 0.6],
    granite: [0.14, 0.65],
    ceramic: [0.18, 0.45],
    porcelain: [0.35, 0.3],
    wood: [0.45, 0.25],
    concrete: [0.8, 0.08],
    brick: [0.85, 0.05],
    stone: [0.7, 0.12],
    paint: [0.88, 0.05],
    metal: [0.35, 0.8],
    wallpaper: [0.8, 0.05],
    ground: [0.95, 0.02]
  }
  const [r0, refl0] = prior[type] ?? [0.6, 0.15]
  const roughness = clamp(r0 - highlight * 0.8 + (edgeDensity > 0.1 ? 0.08 : 0), 0.05, 1)
  const reflectivity = clamp(refl0 + highlight * 1.5, 0, 1)

  // ── real-world scale: repeats in the image × typical unit size ──
  const unit: Record<string, number> = { ceramic: 0.3, porcelain: 0.6, brick: 0.24, wood: 0.19, marble: 0.6 }
  let scale = type === 'marble' ? 1.2 : type === 'wood' ? 1.6 : type === 'brick' ? 0.9 : type === 'concrete' ? 2 : type === 'paint' ? 2 : type === 'granite' ? 0.8 : 1
  let tileSize: number | undefined
  if (pattern === 'tiles' || pattern === 'bricks' || pattern === 'planks') {
    const pPx = pattern === 'planks' ? Math.min(pc.p || w, pr.p || h) : Math.max(pc.p, pr.p)
    if (pPx > 0) {
      const repeats = (pattern === 'bricks' ? h : w) / Math.max(1, pattern === 'bricks' ? pr.p : pPx)
      tileSize = unit[type] ?? 0.6
      scale = clamp(repeats * tileSize, 0.2, 6)
      notes.push(`About ${repeats.toFixed(1)} repeats across the photo → ${scale.toFixed(2)} m per image`)
    }
  }
  return {
    textureType: type,
    confidence: clamp(conf, 0.2, 0.95),
    pattern,
    tileSize,
    dominantColors: dom.map((d) => toHex(d.c[0], d.c[1], d.c[2])),
    averageColor: toHex(avg[0], avg[1], avg[2]),
    roughness,
    reflectivity,
    scale,
    notes
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const dist3 = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Make an image tileable: blend it with a half-offset copy near the seams. */
export function makeSeamless(src: Uint8ClampedArray, n: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  const band = Math.floor(n * 0.18)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4
      const ox = (x + n / 2) % n
      const oy = (y + n / 2) % n
      const j = (oy * n + ox) * 4
      const dx = Math.min(x, n - 1 - x)
      const dy = Math.min(y, n - 1 - y)
      const t = Math.min(1, Math.min(dx, dy) / band)
      const k = t * t * (3 - 2 * t)
      for (let c = 0; c < 3; c++) out[i + c] = src[j + c] * (1 - k) + src[i + c] * k
      out[i + 3] = 255
    }
  }
  // the offset copy's own seams now sit in the middle — fade them with the original
  return out
}

export function generateMaps(base: Uint8ClampedArray, n: number, a: MaterialAnalysis, seamless: boolean): PBRMaps {
  const color = seamless ? makeSeamless(base, n) : base
  const H = new Float32Array(n * n)
  for (let i = 0; i < n * n; i++) H[i] = lum(color[i * 4], color[i * 4 + 1], color[i * 4 + 2])
  // light blur for a smoother height field
  const Hb = new Float32Array(n * n)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += H[((y + dy + n) % n) * n + ((x + dx + n) % n)]
      Hb[y * n + x] = s / 9
    }
  // joints (tiles/bricks) are recessed: darken-to-deep mapping; stone keeps its relief
  const invert = a.pattern === 'tiles' || a.pattern === 'bricks' || a.pattern === 'planks'
  const height = new Uint8ClampedArray(n * n * 4)
  const rough = new Uint8ClampedArray(n * n * 4)
  const strength = a.textureType === 'paint' || a.textureType === 'marble' ? 1.2 : a.textureType === 'brick' || a.textureType === 'stone' ? 4 : 2.5
  const normal = new Uint8ClampedArray(n * n * 4)
  const at = (x: number, y: number) => Hb[((y + n) % n) * n + ((x + n) % n)] * (invert ? 1 : 1)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x
      const hv = Hb[i]
      height[i * 4] = height[i * 4 + 1] = height[i * 4 + 2] = hv * 255
      height[i * 4 + 3] = 255
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const l = Math.hypot(dx, dy, 1)
      normal[i * 4] = ((-dx / l) * 0.5 + 0.5) * 255
      normal[i * 4 + 1] = ((dy / l) * 0.5 + 0.5) * 255
      normal[i * 4 + 2] = ((1 / l) * 0.5 + 0.5) * 255
      normal[i * 4 + 3] = 255
      const rv = clamp(a.roughness * (1 + (0.5 - hv) * 0.35), 0.02, 1)
      rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = rv * 255
      rough[i * 4 + 3] = 255
    }
  return { size: n, base: color, height, normal, rough }
}
