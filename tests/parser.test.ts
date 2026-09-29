import { describe, expect, it } from 'vitest'
import { parseRequirements } from '@/ai/requirementParser'
import { defaultRequirements } from '@/core/model/defaults'

describe('requirement parser (§22)', () => {
  it('understands the spec example sentence', () => {
    const r = parseRequirements('Design a modern 10 marla double-storey house with 4 bedrooms, 2 car parking, basement, large lawn, patio, dirty kitchen, drawing room and a double-height entrance.', defaultRequirements())
    expect(r.plot?.presetId).toBe('10-marla')
    expect(r.req.floors).toBe('basement+ground+first')
    expect(r.req.special.basement).toBe(true)
    expect(r.req.rooms.bedrooms).toBe(4)
    expect(r.req.outdoor.cars).toBe(2)
    expect(r.req.outdoor.patio).toBe(true)
    expect(r.req.outdoor.frontLawn && r.req.outdoor.backLawn).toBe(true)
    expect(r.req.rooms.dirtyKitchens).toBe(1)
    expect(r.req.rooms.drawingRooms).toBe(1)
    expect(r.req.special.doubleHeightEntrance).toBe(true)
    expect(r.req.style).toBe('modern')
  })

  it('handles the final-scenario brief (§72)', () => {
    const r = parseRequirements('1 kanal, double story with basement, 5 bedrooms, 2 guest rooms, 3 car garage, large lawn, patio, swimming pool, drawing room, dining room, TV lounge, 2 kitchens, study, prayer room, modern luxury, large windows, high privacy', defaultRequirements())
    expect(r.plot?.presetId).toBe('1-kanal')
    expect(r.req.floors).toBe('basement+ground+first')
    expect(r.req.rooms.bedrooms).toBe(5)
    expect(r.req.rooms.guestBedrooms).toBe(2)
    expect(r.req.outdoor.cars).toBe(3)
    expect(r.req.outdoor.pool).toBe(true)
    expect(r.req.rooms.kitchens).toBe(1)
    expect(r.req.rooms.dirtyKitchens).toBe(1)
    expect(r.req.rooms.studyRooms).toBe(1)
    expect(r.req.rooms.prayerRooms).toBe(1)
    expect(r.req.special.largeWindows).toBe(true)
    expect(r.req.preferences.privacy).toBeGreaterThanOrEqual(85)
  })

  it('reads explicit plot dimensions', () => {
    const r = parseRequirements('35 x 70 ft plot, single storey, three bedrooms', defaultRequirements())
    expect(r.plot?.widthM).toBeCloseTo(35 * 0.3048)
    expect(r.plot?.depthM).toBeCloseTo(70 * 0.3048)
    expect(r.req.floors).toBe('single')
    expect(r.req.rooms.bedrooms).toBe(3)
  })
})
