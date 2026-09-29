import { describe, expect, it } from 'vitest'
import { rebuildWalls, effectiveKind } from '@/planner/walls'
import { findFaces } from '@/core/geometry/planar'
import { makeFloor, defaultSettings } from '@/core/model/defaults'
import { rectPoly, area } from '@/core/geometry/polygon'
import type { Room } from '@/core/model/types'
import { parseLength, formatLength, FT } from '@/core/units/units'

const room = (id: string, x: number, y: number, w: number, h: number, type: Room['type'] = 'bedroom'): Room => ({
  id,
  name: id,
  autoName: true,
  type,
  polygon: rectPoly({ x, y, w, h })
})

describe('units', () => {
  it('parses and formats feet-inches', () => {
    expect(parseLength(`14'6"`, 'ft')).toBeCloseTo(14.5 * FT, 6)
    expect(parseLength('4.2m', 'ft')).toBeCloseTo(4.2)
    expect(parseLength('12', 'ft')).toBeCloseTo(12 * FT)
    expect(parseLength('350 cm', 'ft')).toBeCloseTo(3.5)
    expect(formatLength(14.5 * FT, 'ft-in')).toBe('14′ 6″')
  })
})

describe('rebuildWalls', () => {
  it('derives one interior wall for a shared edge and exterior walls around', () => {
    const floor = makeFloor('ground', 0)
    floor.rooms = [room('A', 0, 0, 4, 5), room('B', 4, 0, 3, 5)]
    const res = rebuildWalls(floor, defaultSettings())
    const interior = res.walls.filter((w) => effectiveKind(w) === 'interior')
    const exterior = res.walls.filter((w) => effectiveKind(w) === 'exterior')
    expect(interior).toHaveLength(1)
    expect(exterior).toHaveLength(4)
    const top = exterior.find((w) => Math.abs(w.a.y) < 1e-6 && Math.abs(w.b.y) < 1e-6)!
    expect(Math.abs(top.b.x - top.a.x)).toBeCloseTo(7)
  })

  it('keeps wall ids and re-hosts openings when a shared edge moves', () => {
    const floor = makeFloor('ground', 0)
    floor.rooms = [room('A', 0, 0, 4, 5), room('B', 4, 0, 3, 5)]
    let res = rebuildWalls(floor, defaultSettings())
    floor.walls = res.walls
    const mid = floor.walls.find((w) => Math.abs(w.a.x - 4) < 1e-6 && Math.abs(w.b.x - 4) < 1e-6)!
    floor.openings = [{ id: 'd1', kind: 'door', wallId: mid.id, offset: 1, width: 0.9, height: 2.1, sill: 0, style: 'single' }]
    const top = floor.walls.find((w) => Math.abs(w.a.y) < 1e-6 && Math.abs(w.b.y) < 1e-6)!
    floor.openings.push({ id: 'w1', kind: 'window', wallId: top.id, offset: 5.5, width: 1.2, height: 1.2, sill: 0.9, style: 'casement' })
    // move the shared edge from x=4 to x=4.5
    floor.rooms = [room('A', 0, 0, 4.5, 5), room('B', 4.5, 0, 2.5, 5)]
    res = rebuildWalls(floor, defaultSettings())
    const newMid = res.walls.find((w) => Math.abs(w.a.x - 4.5) < 1e-6)!
    expect(res.walls.find((w) => w.id === top.id)).toBeTruthy()
    // the door was on x=4 which no longer has a wall → dropped (the caller moves openings with the edge)
    expect(res.droppedOpenings.map((o) => o.id)).toContain('d1')
    expect(res.openings.find((o) => o.id === 'w1')!.wallId).toBe(top.id)
    expect(newMid).toBeTruthy()
  })

  it('makes stair ↔ lounge virtual and balcony edges railings', () => {
    const floor = makeFloor('upper', 1)
    floor.rooms = [room('S', 0, 0, 3, 4, 'stair'), room('L', 3, 0, 5, 4, 'family'), room('Bal', 3, 4, 5, 1.2, 'balcony')]
    const res = rebuildWalls(floor, defaultSettings())
    expect(res.walls.some((w) => w.kind === 'virtual')).toBe(true)
    expect(res.walls.some((w) => w.kind === 'railing')).toBe(true)
  })
})

describe('findFaces', () => {
  it('finds two rooms from a divided rectangle drawn as strokes', () => {
    const segs = [
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 10, y: 6 } },
      { a: { x: 10, y: 6 }, b: { x: 0, y: 6 } },
      { a: { x: 0, y: 6 }, b: { x: 0, y: 0 } },
      { a: { x: 4, y: -0.3 }, b: { x: 4, y: 6.4 } } // overshooting divider
    ]
    const faces = findFaces(segs)
    expect(faces).toHaveLength(2)
    const areas = faces.map(area).sort((a, b) => a - b)
    expect(areas[0]).toBeCloseTo(24)
    expect(areas[1]).toBeCloseTo(36)
  })
})
