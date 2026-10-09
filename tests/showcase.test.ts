import { describe, expect, it } from 'vitest'
import { generateDesign } from '@/planner/generator'
import { defaultRequirements, defaultSettings, newProject, plotFromPreset } from '@/core/model/defaults'
import { areaViews, keyFeatures, plotSizeLabel } from '@/render/areaViews'
import { pointInPolygon } from '@/core/geometry/polygon'
import type { Project } from '@/core/model/types'
import { areaPrompt, imageEditParams } from '../src/shared/aiImage'

// Home Showcase and AI photos (amendment A9)

function house(preset: string, seed = 7): Project {
  const req = defaultRequirements()
  req.rooms.bedrooms = 4
  req.rooms.bathrooms = 5
  req.outdoor.cars = 2
  req.outdoor.garage = true
  const d = generateDesign(req, plotFromPreset(preset), 'luxury-open', { settings: defaultSettings(), seed, iterations: 1200 })
  return { ...newProject(), ...d.house, requirements: req } as Project
}

describe('Home Showcase areas', () => {
  const p = house('1-kanal')
  const views = areaViews(p)

  it('offers a picture of every kind of area', () => {
    const groups = new Set(views.map((v) => v.group))
    for (const g of ['exterior', 'living', 'kitchen', 'bedrooms', 'bathrooms', 'parking'] as const) expect(groups.has(g), g).toBe(true)
    const rooms = p.floors.flatMap((f) => f.rooms)
    const beds = rooms.filter((r) => ['master_bedroom', 'bedroom', 'guest_bedroom', 'kids_room'].includes(r.type))
    expect(views.filter((v) => v.group === 'bedrooms')).toHaveLength(beds.length)
    expect(views.filter((v) => v.group === 'bathrooms').length).toBe(rooms.filter((r) => r.type === 'bathroom' || r.type === 'powder').length)
    expect(new Set(views.map((v) => v.key)).size).toBe(views.length)
  })

  it('stands the camera inside each room, clear of furniture, looking into the room', () => {
    for (const v of views.filter((x) => x.kind === 'interior')) {
      const f = p.floors.find((x) => x.id === v.floorId)!
      const r = f.rooms.find((x) => x.id === v.roomId)!
      const cam = { x: v.pose.position[0], y: v.pose.position[2] }
      expect(pointInPolygon(cam, r.polygon), `${v.title} camera inside`).toBe(true)
      for (const it of f.furniture.filter((x) => pointInPolygon(x.position, r.polygon) && x.height > 1.1)) {
        // never inside a wardrobe, fridge or tall cabinet
        const inside = Math.abs(cam.x - it.position.x) < it.width / 2 && Math.abs(cam.y - it.position.y) < it.depth / 2
        expect(inside, `${v.title} camera inside ${it.type}`).toBe(false)
      }
      const look = Math.hypot(v.pose.target[0] - v.pose.position[0], v.pose.target[2] - v.pose.position[2])
      expect(look, `${v.title} looks across the room`).toBeGreaterThan(0.8)
      expect(v.pose.position[1]).toBeGreaterThan(v.pose.target[1])
    }
  })

  it('lists the key features of the actual design', () => {
    const f = keyFeatures(p)
    const titles = f.map((x) => x.title)
    expect(titles.some((t) => /^\d+ Bedrooms?$/.test(t))).toBe(true)
    expect(titles).toContain('Parking Space')
    expect(f.find((x) => x.title === 'Parking Space')!.detail).toBe('2 cars')
    expect(plotSizeLabel(p, '1 Kanal')).toBe('1 Kanal (500 sq yds)')
  })

  it('works on a small plot too', () => {
    const small = house('5-marla', 3)
    const v = areaViews(small)
    expect(v.some((x) => x.group === 'kitchen')).toBe(true)
    for (const x of v) for (const n of [...x.pose.position, ...x.pose.target]) expect(Number.isFinite(n)).toBe(true)
  })
})

describe('AI photo requests', () => {
  it('sends only the parameters each model accepts', () => {
    const g2 = imageEditParams('gpt-image-2', 'xhigh', '1536x1024')
    expect(g2).not.toHaveProperty('input_fidelity')
    expect(g2.quality).toBe('high')
    const g25 = imageEditParams('gpt-image-2.5-sunburst', 'xhigh', '1536x1024')
    expect(g25.quality).toBe('xhigh')
    expect(g25).toHaveProperty('input_fidelity', 'high')
    const g15 = imageEditParams('gpt-image-1.5', 'high', '2048x1152')
    expect(g15.size).toBe('1536x1024')
    expect(g15.output_format).toBe('jpeg')
  })

  it('as designed: asks for realism only', () => {
    const s = areaPrompt({ area: 'kitchen', kind: 'interior', style: 'Modern Luxury Villa', city: 'Lahore', finishes: ['white marble floor'], light: 'day', styling: 'exact' })
    expect(s).toContain('kitchen')
    expect(s).toContain('Lahore')
    expect(s).toContain('white marble floor')
    expect(s).toMatch(/Keep exactly the same camera/)
    expect(s).toMatch(/Do not add, remove, move or resize/)
    expect(s).toMatch(/no text/)
  })

  it('brochure staging (the default): dresses the rooms but keeps the architecture', () => {
    const s = areaPrompt({ area: 'master bedroom', kind: 'interior', style: 'Modern Luxury Villa', finishes: ['oak floor'], light: 'evening' })
    expect(s).toMatch(/luxury property brochure/)
    expect(s).toMatch(/Keep the same camera position/)
    expect(s).toMatch(/main furniture .* in the same places/)
    expect(s).toMatch(/do not change the architecture/)
    expect(s).toContain('oak floor')
    const ext = areaPrompt({ area: 'front of the house', kind: 'exterior', style: 'Modern Luxury Villa', light: 'evening' })
    expect(ext).toMatch(/blue hour/)
    expect(ext).toMatch(/number of floors/)
  })
})
