import { describe, expect, it } from 'vitest'
import { generateDesign, STRATEGIES, unusableBaths } from '@/planner/generator'
import { defaultRequirements, defaultSettings, plotFromPreset, COST_PRESETS } from '@/core/model/defaults'
import { validateHouse } from '@/planner/validation'
import { qiblaBearing, qiblaConflict, qiblaVector, CITIES } from '@/core/location'
import { measure, estimate } from '@/planner/estimate'
import { bandFor, checkBylaws, setbacksFor, type Authority } from '@/core/bylaws'
import { layoutSolar, PANEL, solarEconomics } from '@/planner/solar'
import { facingOf } from '@/core/location'
import { pointInPolygon, rectsOverlap } from '@/core/geometry/polygon'

/** Amendments A1 (Qibla) and A3 (grey structure / finishing). */

const city = (n: string) => CITIES.find((c) => c.name === n)!

describe('A1 Qibla', () => {
  it('matches published Qibla bearings', () => {
    const b = (n: string) => qiblaBearing(city(n).lat, city(n).lon)
    expect(b('London')).toBeCloseTo(119, 0)
    expect(b('New York')).toBeCloseTo(58.5, 0)
    expect(b('Lahore')).toBeGreaterThan(259)
    expect(b('Lahore')).toBeLessThan(262)
    expect(b('Karachi')).toBeGreaterThan(265)
    expect(b('Karachi')).toBeLessThan(269)
  })

  it('flags a WC facing or backing the Qibla, not one side-on to it', () => {
    // road to the south: plan +y is south, so west is plan -x
    const q = qiblaVector({ roadSide: 'S', northOffset: 0, location: { city: 'Karachi', lat: city('Karachi').lat, lon: city('Karachi').lon } })
    expect(q.x).toBeLessThan(-0.95)
    expect(qiblaConflict(-Math.PI / 2, q)).toBe('back') // on the left wall, facing east
    expect(qiblaConflict(Math.PI / 2, q)).toBe('faces') // on the right wall, facing west
    expect(qiblaConflict(0, q)).toBeNull() // on the north wall, facing south
  })

  it('gives every bathroom a WC and seats nearly all side-on to the Qibla', () => {
    const settings = defaultSettings()
    let total = 0
    let conflicts = 0
    for (const [preset, strategy] of [
      ['10-marla', STRATEGIES[0].key],
      ['1-kanal', STRATEGIES[1].key],
      ['5-marla', STRATEGIES[2].key]
    ] as const) {
      for (const roadSide of ['S', 'E'] as const) {
        const plot = plotFromPreset(preset)
        plot.roadSide = roadSide
        const d = generateDesign(defaultRequirements(), plot, strategy, { settings, seed: 11, iterations: 1200 })
        const baths = d.house.floors.flatMap((f) => f.rooms.filter((r) => /bath|powder/.test(r.type)))
        const wcs = d.house.floors.flatMap((f) => f.furniture.filter((x) => x.type === 'wc'))
        expect(wcs.length).toBe(baths.length)
        total += wcs.length
        conflicts += validateHouse(d.house).filter((i) => i.code === 'qibla').length
      }
    }
    // a WC only ends up facing (or backing) the Qibla when no side-on wall can take it; it is then flagged
    expect(conflicts / total).toBeLessThan(0.1)
  })
})

describe('A3 grey structure and finishing', () => {
  it('splits the estimate into two phases that add up', () => {
    const d = generateDesign(defaultRequirements(), plotFromPreset('10-marla'), STRATEGIES[0].key, { settings: defaultSettings(), seed: 3, iterations: 1200 })
    const e = estimate(measure(d.house, []), COST_PRESETS.pakistan)
    expect(e.grey).toBeGreaterThan(0)
    expect(e.finishing).toBeGreaterThan(0)
    expect(e.grey + e.finishing).toBeCloseTo(e.total, 3)
    expect(e.lines.find((l) => l.key === 'structure')!.phase).toBe('grey')
    expect(e.lines.find((l) => l.key === 'marble')!.phase).toBe('finishing')
  })
})

describe('A7 usable bathrooms', () => {
  it('never delivers a house without a usable bathroom, even on 3 and 5 marla', () => {
    const settings = defaultSettings()
    let flagged = 0
    let designs = 0
    for (const preset of ['3-marla', '5-marla', '7-marla']) {
      for (const s of STRATEGIES) {
        const d = generateDesign(defaultRequirements(), plotFromPreset(preset), s.key, { settings, seed: 11, iterations: 1000 })
        const baths = d.house.floors.flatMap((f) => f.rooms.filter((r) => r.type === 'bathroom'))
        expect(baths.length).toBeGreaterThan(0)
        for (const f of d.house.floors) for (const r of f.rooms.filter((x) => x.type === 'bathroom')) expect(f.furniture.some((x) => x.type === 'wc' && x.position.x > Math.min(...r.polygon.map((p) => p.x)) && x.position.x < Math.max(...r.polygon.map((p) => p.x)))).toBe(true)
        const bad = unusableBaths(d.house)
        // anything still too small is told to the user, never silent
        if (bad.length) expect(d.warnings.join(' ')).toContain(bad[0])
        flagged += bad.length
        designs++
      }
    }
    expect(flagged).toBeLessThanOrEqual(1)
    expect(designs).toBe(15)
  })
})

describe('A2 rooftop solar', () => {
  it('lays equator-facing, unshaded rows inside the open roof', () => {
    for (const roadSide of ['S', 'N', 'E'] as const) {
      const plot = plotFromPreset('1-kanal')
      plot.roadSide = roadSide
      const d = generateDesign(defaultRequirements(), plot, STRATEGIES[0].key, { settings: defaultSettings(), seed: 4, iterations: 1200 })
      const roof = d.house.floors.find((f) => f.kind === 'roof')!
      const l = layoutSolar(d.house)
      expect(l.panels.length).toBeGreaterThan(8)
      const south = roadSide === 'S' ? { x: 0, y: 1 } : roadSide === 'N' ? { x: 0, y: -1 } : { x: -1, y: 0 }
      for (const p of l.panels) {
        const f = facingOf(p.rotation)
        expect(f.x * south.x + f.y * south.y).toBeGreaterThan(0.99)
        expect(roof.rooms.some((r) => r.type === 'terrace' && pointInPolygon(p.position, r.polygon))).toBe(true)
      }
      // generated houses carry a typical 12-panel system
      expect(roof.furniture.filter((x) => x.type === 'solar-panel').length).toBe(Math.min(12, l.panels.length))
      const e = solarEconomics(l, COST_PRESETS.pakistan)
      expect(l.kwp).toBeCloseTo((l.panels.length * PANEL.watt) / 1000, 5)
      expect(e.payback).toBeGreaterThan(1)
      expect(e.payback).toBeLessThan(8)
      expect(l.rowPitch).toBeGreaterThan(2.5)
    }
  })

  it('keeps panels off the stair cover and water tank', () => {
    const d = generateDesign(defaultRequirements(), plotFromPreset('10-marla'), STRATEGIES[0].key, { settings: defaultSettings(), seed: 4, iterations: 1200 })
    const roof = d.house.floors.find((f) => f.kind === 'roof')!
    const blocks = roof.furniture.filter((x) => x.type === 'water-tank').map((x) => ({ x: x.position.x - x.width / 2, y: x.position.y - x.depth / 2, w: x.width, h: x.depth }))
    for (const p of roof.furniture.filter((x) => x.type === 'solar-panel')) {
      const r = { x: p.position.x - 0.5, y: p.position.y - 0.5, w: 1, h: 1 }
      expect(blocks.some((b) => rectsOverlap(b, r, 0))).toBe(false)
      expect(roof.rooms.filter((x) => x.type === 'mumty').some((m) => pointInPolygon(p.position, m.polygon))).toBe(false)
    }
  })
})

describe('A4 building rules', () => {
  const FT = 0.3048
  it('reads the published open spaces for each plot size', () => {
    const p10 = plotFromPreset('10-marla')
    expect(setbacksFor('lda', p10)).toMatchObject({ front: 10 * FT, rear: 7 * FT })
    expect(setbacksFor('lda', p10).left + setbacksFor('lda', p10).right).toBeCloseTo(5 * FT, 5)
    expect(bandFor('lda', plotFromPreset('5-marla'))).toMatchObject({ coverage: 0.75, storeys: 3, height: 38 })
    expect(bandFor('lda', plotFromPreset('1-kanal'))).toMatchObject({ coverage: 0.65, storeys: 4 })
    const d10 = setbacksFor('dha-lahore', p10)
    expect(d10.front).toBeCloseTo(10.75 * FT, 5)
    expect(bandFor('dha-lahore', plotFromPreset('1-kanal'))).toMatchObject({ firstOfGround: 0.8, sides: 2, storeys: 2 })
  })

  it('generates designs that meet LDA and DHA Lahore rules', () => {
    const settings = defaultSettings()
    for (const [a, preset, strategy] of [
      ['lda', '5-marla', 'family'],
      ['lda', '1-kanal', 'luxury-open'],
      ['dha-lahore', '7-marla', 'garden'],
      ['dha-lahore', '2-kanal', 'room-space']
    ] as [Authority, string, (typeof STRATEGIES)[number]['key']][]) {
      const plot = plotFromPreset(preset)
      plot.authority = a
      plot.setbacks = setbacksFor(a, plot)
      const d = generateDesign(defaultRequirements(), plot, strategy, { settings, seed: 11, iterations: 1000 })
      const fails = checkBylaws(d.house, a, { plinth: 0.457, parapet: d.house.exterior.parapetHeight }).filter((c) => !c.ok)
      expect(fails.map((c) => `${a} ${preset}: ${c.label} ${c.actual}`)).toEqual([])
      expect(validateHouse(d.house).filter((i) => i.severity === 'error')).toEqual([])
    }
  })
})
