import { describe, expect, it } from 'vitest'
import { generateDesign, STRATEGIES } from '@/planner/generator'
import { defaultRequirements, defaultSettings, plotFromPreset } from '@/core/model/defaults'
import { validateHouse } from '@/planner/validation'
import type { Requirements } from '@/core/model/types'

const settings = defaultSettings()

function summarize(label: string, req: Requirements, preset: string, strategy: (typeof STRATEGIES)[number]['key'], seed = 7) {
  const d = generateDesign(req, plotFromPreset(preset), strategy, { settings, seed, iterations: 1800 })
  const issues = validateHouse(d.house)
  const errors = issues.filter((i) => i.severity === 'error')
  const lines = d.house.floors.map((f) => `  ${f.name}: ${f.rooms.map((r) => r.name).join(', ')} | walls ${f.walls.length} doors ${f.openings.filter((o) => o.kind === 'door').length} windows ${f.openings.filter((o) => o.kind === 'window').length} stairs ${f.stairs.length} furniture ${f.furniture.length}`)
  console.log(`\n${label} [${strategy}] score ${d.scores.overall} beds ${d.stats.bedrooms} baths ${d.stats.bathrooms} covered ${d.stats.coveredArea.toFixed(0)}m² garden ${d.stats.gardenArea.toFixed(0)}m²\n${lines.join('\n')}\n  errors: ${errors.map((e) => e.message).join(' | ') || 'none'}\n  warnings: ${d.warnings.slice(0, 4).join(' | ')}`)
  return { d, errors, issues }
}

describe('design generator', () => {
  it('generates valid 10 marla double-story designs for all strategies', () => {
    const req = defaultRequirements()
    for (const s of STRATEGIES) {
      const { d, errors } = summarize('10 marla', req, '10-marla', s.key)
      expect(d.house.floors.length).toBeGreaterThanOrEqual(2)
      expect(d.stats.bedrooms).toBeGreaterThanOrEqual(4)
      expect(errors.length).toBeLessThanOrEqual(2)
    }
  })

  it('handles the 1 kanal final scenario (§72)', () => {
    const req = defaultRequirements()
    req.floors = 'basement+ground+first'
    req.rooms.bedrooms = 5
    req.rooms.masterBedrooms = 1
    req.rooms.guestBedrooms = 2
    req.rooms.bathrooms = 7
    req.rooms.kitchens = 1
    req.rooms.dirtyKitchens = 1
    req.rooms.studyRooms = 1
    req.rooms.prayerRooms = 1
    req.outdoor.cars = 3
    req.outdoor.pool = true
    req.outdoor.patio = true
    req.outdoor.backLawn = true
    req.special.basement = true
    req.special.largeWindows = true
    req.style = 'luxury'
    req.preferences.luxury = 85
    req.preferences.privacy = 85
    const { d, errors } = summarize('1 kanal', req, '1-kanal', 'luxury-open', 11)
    expect(d.house.floors.some((f) => f.kind === 'basement')).toBe(true)
    expect(d.stats.parking).toBe(3)
    expect(errors.length).toBeLessThanOrEqual(3)
  })

  it('handles small 5 marla and big 4 kanal plots', () => {
    const small = defaultRequirements()
    small.rooms.bedrooms = 3
    small.rooms.guestBedrooms = 0
    small.rooms.bathrooms = 3
    small.rooms.drawingRooms = 1
    small.outdoor.cars = 1
    summarize('5 marla', small, '5-marla', 'family', 3)
    const big = defaultRequirements()
    big.floors = 'basement+ground+first'
    big.rooms.bedrooms = 6
    big.rooms.bathrooms = 8
    big.outdoor.pool = true
    big.outdoor.patio = true
    big.special.homeTheater = true
    big.special.gym = true
    big.special.doubleHeightLounge = true
    big.preferences.luxury = 90
    summarize('4 kanal', big, '4-kanal', 'luxury-open', 5)
  })
})
