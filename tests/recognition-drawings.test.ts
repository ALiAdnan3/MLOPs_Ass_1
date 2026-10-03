import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { vectorizeStrokes, recognize, applyRecognizedPlan, type InkStroke } from '@/ai/sketchRecognizer'
import { generateDesign } from '@/planner/generator'
import { defaultRequirements, defaultSettings, makeFloor, newProject, plotFromPreset } from '@/core/model/defaults'
import { listDrawings, drawSheet, A3, DRAWING_KINDS } from '@/export/sheets'
import { SvgContext } from '@/render/draw/svg'
import { DxfContext } from '@/export/contexts'
import { drawDrawing } from '@/export/sheets'
import type { Vec2 } from '@/core/model/types'

/** A wobbly hand-drawn line from a to b (deterministic jitter). */
function hand(a: Vec2, b: Vec2, seed: number, overshoot = 0.15): InkStroke {
  const pts: Vec2[] = []
  const n = 24
  const L = Math.hypot(b.x - a.x, b.y - a.y)
  const dx = (b.x - a.x) / L
  const dy = (b.y - a.y) / L
  for (let i = 0; i <= n; i++) {
    const t = -overshoot / L + (i / n) * (1 + (2 * overshoot) / L)
    const j = Math.sin(i * 1.7 + seed) * 0.05
    pts.push({ x: a.x + (b.x - a.x) * t - dy * j, y: a.y + (b.y - a.y) * t + dx * j })
  }
  return { pts }
}

describe('sketch recognition (§19, §20)', () => {
  it('turns a wobbly 3-room sketch with a door gap and labels into a clean plan', () => {
    // 10 m × 8 m outline; a wall at y=4 splits it; the top half is split again at x=5.
    // The bottom half gets a 1 m door gap in the middle wall.
    const s: InkStroke[] = [
      hand({ x: 0, y: 0 }, { x: 10, y: 0 }, 1),
      hand({ x: 10, y: 0 }, { x: 10, y: 8 }, 2),
      hand({ x: 10, y: 8 }, { x: 0, y: 8 }, 3),
      hand({ x: 0, y: 8 }, { x: 0, y: 0 }, 4),
      hand({ x: 0, y: 4.05 }, { x: 4.5, y: 3.95 }, 5, 0.1),
      hand({ x: 5.5, y: 4 }, { x: 10, y: 4.05 }, 6, 0.1),
      hand({ x: 5, y: 0 }, { x: 5.05, y: 4 }, 7)
    ]
    const { segs, arcs } = vectorizeStrokes(s)
    const plan = recognize(segs, { arcs, tol: 0.35, texts: [{ p: { x: 2.5, y: 2 }, text: 'Bedroom 12x13' }, { p: { x: 7.5, y: 2 }, text: 'Kitchen' }, { p: { x: 5, y: 6 }, text: 'Lounge' }] })
    console.log(plan.notes.join(' | '), plan.rooms.map((r) => `${r.name}(${r.type} ${r.confidence})`).join(', '))
    expect(plan.rooms.length).toBe(3)
    const types = plan.rooms.map((r) => r.type).sort()
    expect(types).toEqual(['bedroom', 'kitchen', 'tv_lounge'])
    expect(plan.openings.filter((o) => o.kind === 'door').length).toBeGreaterThanOrEqual(1)
    // labelled 12×13 ft bedroom scales the sketch (drawn 5×4 m ≈ 16×13 ft)
    expect(plan.scale).toBeGreaterThan(0.7)
    // becomes an editable floor
    const plot = plotFromPreset('10-marla')
    const floor = makeFloor('ground', 0, defaultSettings().floorHeight)
    const r = applyRecognizedPlan(plan, floor, plot, defaultSettings())
    console.log('apply warnings:', r.warnings.join(' | ') || 'none')
    expect(floor.rooms.length).toBe(3)
    expect(floor.walls.length).toBeGreaterThan(5)
    expect(floor.openings.some((o) => o.kind === 'door')).toBe(true)
  })

  it('asks when a room type is only guessed', () => {
    const s: InkStroke[] = [hand({ x: 0, y: 0 }, { x: 4, y: 0 }, 1), hand({ x: 4, y: 0 }, { x: 4, y: 3.5 }, 2), hand({ x: 4, y: 3.5 }, { x: 0, y: 3.5 }, 3), hand({ x: 0, y: 3.5 }, { x: 0, y: 0 }, 4)]
    const { segs } = vectorizeStrokes(s)
    const plan = recognize(segs, { tol: 0.35 })
    expect(plan.rooms.length).toBe(1)
    expect(plan.rooms[0].confidence).toBeLessThan(0.6)
  })
})

describe('drawing output (§32, §33)', () => {
  const req = defaultRequirements()
  const d = generateDesign(req, plotFromPreset('10-marla'), 'family', { settings: defaultSettings(), seed: 5, iterations: 900 })
  const p = newProject('Drawing test', d.house.plot)
  p.floors = d.house.floors
  p.site = d.house.site
  p.exterior = d.house.exterior

  it('composes every drawing kind on an A3 sheet (SVG)', () => {
    const specs = listDrawings(p, DRAWING_KINDS.map((k) => k.kind))
    expect(specs.length).toBeGreaterThanOrEqual(15)
    mkdirSync('test-results/sheets', { recursive: true })
    specs.forEach((s, i) => {
      const svg = new SvgContext(96 / 25.4, 0.3528)
      const info = drawSheet(svg, p, s, i, specs.length)
      const out = svg.toString({ x: 0, y: 0, w: A3.w, h: A3.h }, '#ffffff')
      expect(out.length).toBeGreaterThan(3000)
      expect(info.scale).toBeGreaterThanOrEqual(50)
      writeFileSync(`test-results/sheets/${s.number}-${s.id}.svg`, out)
    })
  })

  it('writes DXF with entities and layers', () => {
    const spec = listDrawings(p, ['floor-plan'])[0]
    const dxf = new DxfContext()
    drawDrawing(dxf, p, spec, { color: false })
    const txt = dxf.toString()
    expect(txt).toContain('ENTITIES')
    expect((txt.match(/\r\nLINE\r\n/g) ?? []).length + (txt.match(/\r\nPOLYLINE\r\n/g) ?? []).length).toBeGreaterThan(40)
    expect(txt).toContain('WALLS')
    writeFileSync('test-results/sheets/ground-floor.dxf', txt)
  })
})

describe('sketch: add a room to an existing house (§72)', () => {
  it('adds a sketched room behind the house with a door, windows and furniture', async () => {
    const { useSketch, runRecognition } = await import('@/modes/sketchState')
    const { addRecognizedRooms } = await import('@/ai/sketchRecognizer')
    const d = generateDesign(defaultRequirements(), plotFromPreset('1-kanal'), 'family', { settings: defaultSettings(), seed: 3, iterations: 900 })
    const floor = structuredClone(d.house.floors.find((f) => f.level === 0)!)
    const site = structuredClone(d.house.site)
    const house = floor.rooms.filter((r) => !['garage', 'terrace', 'courtyard'].includes(r.type)).flatMap((r) => r.polygon)
    const top = Math.min(...house.map((p) => p.y))
    const left = Math.min(...house.map((p) => p.x))
    // a 4 m × 3.5 m study drawn behind the house, sharing its rear wall
    const x0 = left + 1
    const s = [hand({ x: x0, y: top }, { x: x0, y: top - 3.5 }, 1), hand({ x: x0, y: top - 3.5 }, { x: x0 + 4, y: top - 3.5 }, 2), hand({ x: x0 + 4, y: top - 3.5 }, { x: x0 + 4, y: top }, 3)]
    useSketch.getState().set({ strokes: s, texts: [{ p: { x: x0 + 2, y: top - 1.7 }, text: 'Study' }], mode: 'add', image: null })
    const plan = runRecognition(floor)
    console.log(plan.notes.join(' | '), plan.rooms.map((r) => r.name))
    expect(plan.rooms.length).toBe(1)
    expect(plan.rooms[0].type).toBe('study')
    const before = floor.rooms.length
    const res = addRecognizedRooms(plan, floor, defaultSettings(), site)
    console.log('warnings:', res.warnings.join(' | ') || 'none')
    expect(floor.rooms.length).toBe(before + 1)
    const study = floor.rooms.find((r) => r.type === 'study')!
    expect(study).toBeTruthy()
    const b = { w: Math.max(...study.polygon.map((p) => p.x)) - Math.min(...study.polygon.map((p) => p.x)), h: Math.max(...study.polygon.map((p) => p.y)) - Math.min(...study.polygon.map((p) => p.y)) }
    expect(b.w).toBeGreaterThan(3.5)
    expect(b.h).toBeGreaterThan(3)
    expect(floor.furniture.length).toBeGreaterThan(0)
  })
})
