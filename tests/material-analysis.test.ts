import { describe, expect, it } from 'vitest'
import { analyzeImage } from '@/ai/materialAnalysis'

/** §15 material detection on synthetic photos with known answers. */

function image(n: number, px: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(n * n * 4)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const [r, g, b] = px(x, y)
      const i = (y * n + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  return { data, w: n, h: n }
}

// the same white marble the end-to-end scenario uploads: soft grey veins that all run one way
const whiteMarble = image(256, (x, y) => {
  const t = x * 0.018 + y * 0.011
  let turb = 0
  for (const f of [1, 2, 4, 8]) turb += Math.abs(Math.sin((x * f * 0.9 + y * f * 1.3) * 0.013 + f)) / f
  const v = Math.abs(Math.sin(t + turb * 2.4))
  const base = 236 - Math.max(0, 1 - v * 7) * 70 - ((x ^ y) % 5)
  return [base, base, Math.min(255, base + 3)]
})

// brushed steel: dense fine horizontal streaks over a mid grey
const brushedSteel = image(256, (x, y) => {
  const s = Math.sin(y * 1.7) * 18 + Math.sin(y * 0.37 + 1) * 10 + Math.sin(x * 0.02 + y * 3.1) * 6
  const v = 150 + s
  return [v, v + 2, v + 6]
})

describe('material analysis', () => {
  it('reads light stone with parallel veins as marble, not metal', () => {
    const a = analyzeImage(whiteMarble)
    expect(a.textureType).toBe('marble')
    expect(a.pattern).toBe('veins')
  })

  it('still reads dense parallel streaks in grey as brushed metal', () => {
    expect(analyzeImage(brushedSteel).textureType).toBe('metal')
  })
})
