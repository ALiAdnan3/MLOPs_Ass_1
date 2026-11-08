import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { generateDesign, unusableBaths } from '@/planner/generator'
import { defaultRequirements, defaultSettings, plotFromPreset } from '@/core/model/defaults'
import { validateHouse } from '@/planner/validation'
import { spec } from '@/core/constraints/rooms'
import { bbox, area } from '@/core/geometry/polygon'
import type { DesignStrategy, HouseState } from '@/core/model/types'

/**
 * Architectural quality of generated designs, measured over a fixed set of plots, strategies and
 * seeds (amendment A13, P4). The numbers are written to test-results/generator-quality.json under
 * the label in GQ_LABEL so generator changes can be compared before and after.
 *
 *   stack       share of upper-floor wet area (baths, kitchens, laundry) above wet rooms below
 *               (shorter plumbing stacks, no drains over bedrooms)
 *   wetOverDry  upper-floor wet area above bedrooms or living rooms (leak risk), m²
 *   aspect      mean excess of habitable rooms' proportions beyond 1 : 1.5
 *   corridor    corridor share of total floor area
 */

const settings = defaultSettings()

function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

export function qualityOf(h: HouseState) {
  const floors = [...h.floors].sort((a, b) => a.level - b.level)
  let wetUp = 0
  let wetStacked = 0
  let wetOverDry = 0
  for (const f of floors) {
    if (f.level <= 0) continue
    const below = floors.find((x) => x.level === f.level - 1)
    if (!below) continue
    for (const r of f.rooms.filter((x) => spec(x.type).wet)) {
      const rb = bbox(r.polygon)
      const a = rb.w * rb.h
      wetUp += a
      let s = 0
      let dry = 0
      for (const q of below.rooms) {
        const o = overlap(rb, bbox(q.polygon))
        if (!o) continue
        if (spec(q.type).wet) s += o
        else if (spec(q.type).habitable) dry += o
      }
      wetStacked += Math.min(a, s)
      wetOverDry += dry
    }
  }
  const hab = h.floors.flatMap((f) => f.rooms).filter((r) => spec(r.type).habitable && !spec(r.type).outdoor)
  const aspect =
    hab.reduce((s, r) => {
      const b = bbox(r.polygon)
      const asp = Math.max(b.w, b.h) / Math.max(0.1, Math.min(b.w, b.h))
      return s + Math.max(0, asp - 1.5)
    }, 0) / Math.max(1, hab.length)
  const total = h.floors.flatMap((f) => f.rooms).filter((r) => !spec(r.type).outdoor).reduce((s, r) => s + area(r.polygon), 0)
  const corr = h.floors.flatMap((f) => f.rooms).filter((r) => r.type === 'corridor').reduce((s, r) => s + area(r.polygon), 0)
  return { stack: wetUp ? wetStacked / wetUp : 1, wetOverDry, aspect, corridor: corr / Math.max(1, total) }
}

const CASES: { plot: string; floors?: 'ground+first' | 'ground+first+second' }[] = [{ plot: '5-marla' }, { plot: '10-marla' }, { plot: '1-kanal' }]
const STRATS: DesignStrategy[] = ['family', 'privacy', 'room-space']
const SEEDS = [3, 7]

describe('generator quality', () => {
  it('measures architectural quality over plots, strategies and seeds', () => {
    const rows: Record<string, number | string>[] = []
    for (const c of CASES) {
      for (const s of STRATS) {
        for (const seed of SEEDS) {
          const req = defaultRequirements()
          if (c.plot === '1-kanal') {
            req.rooms.bedrooms = 5
            req.rooms.bathrooms = 6
          }
          const d = generateDesign(req, plotFromPreset(c.plot), s, { settings, seed, iterations: 1800 })
          const q = qualityOf(d.house)
          const errors = validateHouse(d.house).filter((i) => i.severity === 'error').length
          rows.push({ plot: c.plot, strategy: s, seed, ...q, errors, badBaths: unusableBaths(d.house).length, light: d.scores.light, overall: d.scores.overall, beds: d.stats.bedrooms })
        }
      }
    }
    const mean = (k: string) => rows.reduce((s, r) => s + Number(r[k]), 0) / rows.length
    const summary = { label: process.env.GQ_LABEL ?? 'run', designs: rows.length, stack: mean('stack'), wetOverDry: mean('wetOverDry'), aspect: mean('aspect'), corridor: mean('corridor'), errors: mean('errors'), badBaths: mean('badBaths'), light: mean('light'), overall: mean('overall'), beds: mean('beds') }
    mkdirSync('test-results', { recursive: true })
    const file = 'test-results/generator-quality.json'
    const prev = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown[]) : []
    writeFileSync(file, JSON.stringify([...prev, { summary, rows }], null, 1))
    // every design keeps its bedrooms and stays buildable
    for (const r of rows) expect(Number(r.beds)).toBeGreaterThanOrEqual(3)
    expect(summary.errors).toBeLessThanOrEqual(1.5)
  }, 600_000)
})
