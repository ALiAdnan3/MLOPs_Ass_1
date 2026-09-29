import { it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { generateDesign } from '@/planner/generator'
import { defaultRequirements, defaultSettings, plotFromPreset } from '@/core/model/defaults'
import { SvgContext } from '@/render/draw/svg'
import { drawPlan } from '@/render/draw/plan'
import { LIGHT_PLAN } from '@/render/draw/theme'
import { bbox } from '@/core/geometry/polygon'
import { validateHouse } from '@/planner/validation'

// Dev aid: writes SVGs of generated plans to test-results/plans for visual inspection.
it('renders generated plans to SVG', () => {
  mkdirSync('test-results/plans', { recursive: true })
  const cases: [string, string, Parameters<typeof generateDesign>[2], number][] = [
    ['10m-family', '10-marla', 'family', 7],
    ['10m-open', '10-marla', 'luxury-open', 8],
    ['10m-privacy', '10-marla', 'privacy', 9],
    ['1k-open', '1-kanal', 'luxury-open', 11],
    ['5m-family', '5-marla', 'family', 3],
    ['4k-open', '4-kanal', 'luxury-open', 5]
  ]
  for (const [name, preset, strat, seed] of cases) {
    const req = defaultRequirements()
    if (preset === '5-marla') {
      req.rooms.bedrooms = 3
      req.rooms.guestBedrooms = 0
      req.rooms.bathrooms = 3
      req.outdoor.cars = 1
    }
    if (preset === '4-kanal') {
      req.floors = 'basement+ground+first'
      req.rooms.bedrooms = 6
      req.rooms.bathrooms = 8
      req.outdoor.pool = true
      req.outdoor.patio = true
      req.special.homeTheater = true
      req.special.gym = true
      req.special.doubleHeightLounge = true
      req.preferences.luxury = 90
    }
    if (preset === '1-kanal') {
      req.floors = 'basement+ground+first'
      req.rooms.bedrooms = 5
      req.rooms.guestBedrooms = 2
      req.rooms.bathrooms = 7
      req.rooms.dirtyKitchens = 1
      req.outdoor.cars = 3
      req.outdoor.pool = true
      req.outdoor.patio = true
      req.special.basement = true
      req.preferences.luxury = 85
    }
    const d = generateDesign(req, plotFromPreset(preset), strat, { settings: defaultSettings(), seed, iterations: 2500 })
    const issues = validateHouse(d.house)
    const pb = bbox(d.house.plot.polygon)
    for (const f of d.house.floors) {
      const svg = new SvgContext(40, 0.02)
      drawPlan(svg, d.house, f, { theme: LIGHT_PLAN, layers: { architecture: true, structure: true, furniture: true, electrical: false, plumbing: false, landscape: true, lighting: false, materials: false, annotations: true }, units: 'ft-in' })
      const view = { x: pb.x - 2, y: pb.y - 2, w: pb.w + 4, h: pb.h + 12 }
      writeFileSync(`test-results/plans/${name}-${f.name}.svg`, svg.toString(view, '#ffffff', 900))
    }
    writeFileSync(`test-results/plans/${name}-issues.txt`, [`score ${JSON.stringify(d.scores)}`, ...d.explanation, '--- warnings', ...d.warnings, '--- issues', ...issues.map((i) => `${i.severity}: ${i.message}`)].join('\n'))
  }
})
