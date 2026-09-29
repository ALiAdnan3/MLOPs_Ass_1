import type { DesignStrategy, Requirements } from '../core/model/types'
import { defaultRequirements } from '../core/model/defaults'

/** Starter templates (§62). Each is a requirement set + plot + strategy; the result is fully editable. */
export interface Template {
  id: string
  name: string
  preset: string
  strategy: DesignStrategy
  seed: number
  blurb: string
  req: (r: Requirements) => Requirements
}

const R = (patch: (r: Requirements) => void) => (base: Requirements) => {
  const r = structuredClone(base)
  patch(r)
  return r
}

export const TEMPLATES: Template[] = [
  {
    id: '5m-modern',
    name: '5 Marla Modern',
    preset: '5-marla',
    strategy: 'family',
    seed: 5101,
    blurb: '3 bedrooms, single car porch, compact modern facade',
    req: R((r) => {
      r.floors = 'double'
      Object.assign(r.rooms, { bedrooms: 3, masterBedrooms: 1, guestBedrooms: 0, bathrooms: 3, drawingRooms: 1, familyRooms: 0, laundries: 0, stores: 0, dressingRooms: 0 })
      r.outdoor.cars = 1
      r.outdoor.terrace = false
      r.style = 'modern'
    })
  },
  {
    id: '5m-double',
    name: '5 Marla Double Story',
    preset: '5-marla',
    strategy: 'room-space',
    seed: 5202,
    blurb: '4 bedrooms over two floors, rooms built over the porch',
    req: R((r) => {
      r.floors = 'double'
      Object.assign(r.rooms, { bedrooms: 4, masterBedrooms: 1, guestBedrooms: 0, bathrooms: 4, drawingRooms: 1, familyRooms: 0, laundries: 1, stores: 0, dressingRooms: 0 })
      r.outdoor.cars = 1
      r.style = 'pakistani_modern'
    })
  },
  {
    id: '10m-modern',
    name: '10 Marla Modern',
    preset: '10-marla',
    strategy: 'family',
    seed: 1010,
    blurb: '5 bedrooms, drawing room, 2-car porch, front lawn',
    req: R((r) => {
      r.style = 'modern'
    })
  },
  {
    id: '10m-luxury',
    name: '10 Marla Luxury',
    preset: '10-marla',
    strategy: 'luxury-open',
    seed: 1020,
    blurb: 'Open lounge and dining, large windows, marble throughout',
    req: R((r) => {
      r.style = 'luxury'
      r.special.largeWindows = true
      r.preferences.luxury = 85
      r.preferences.openSpace = 80
      r.rooms.dirtyKitchens = 1
    })
  },
  {
    id: '10m-basement',
    name: '10 Marla Basement',
    preset: '10-marla',
    strategy: 'family',
    seed: 1030,
    blurb: 'Basement lounge and home theater under a double-story house',
    req: R((r) => {
      r.floors = 'basement+ground+first'
      r.special.basement = true
      r.special.homeTheater = true
      r.style = 'contemporary'
    })
  },
  {
    id: '15m-luxury',
    name: '15 Marla Luxury',
    preset: '15-marla',
    strategy: 'luxury-open',
    seed: 1510,
    blurb: '5 bedrooms, patio, dirty kitchen, double-height lounge',
    req: R((r) => {
      r.style = 'luxury'
      r.rooms.bedrooms = 5
      r.rooms.bathrooms = 6
      r.rooms.dirtyKitchens = 1
      r.outdoor.patio = true
      r.outdoor.backLawn = true
      r.special.doubleHeightLounge = true
      r.special.largeWindows = true
      r.preferences.luxury = 80
    })
  },
  {
    id: '1k-modern',
    name: '1 Kanal Modern',
    preset: '1-kanal',
    strategy: 'family',
    seed: 2010,
    blurb: '5 bedrooms, 3-car porch, patio and back lawn',
    req: R((r) => {
      r.rooms.bedrooms = 5
      r.rooms.bathrooms = 6
      r.rooms.dirtyKitchens = 1
      r.rooms.studyRooms = 1
      r.outdoor.cars = 3
      r.outdoor.patio = true
      r.outdoor.backLawn = true
      r.style = 'modern'
    })
  },
  {
    id: '1k-luxury',
    name: '1 Kanal Luxury',
    preset: '1-kanal',
    strategy: 'luxury-open',
    seed: 2020,
    blurb: 'Basement, pool, 2 guest rooms, prayer room — the full brief',
    req: R((r) => {
      r.floors = 'basement+ground+first'
      r.special.basement = true
      Object.assign(r.rooms, { bedrooms: 5, guestBedrooms: 2, bathrooms: 8, dirtyKitchens: 1, studyRooms: 1, prayerRooms: 1 })
      r.outdoor.cars = 3
      r.outdoor.pool = true
      r.outdoor.patio = true
      r.outdoor.backLawn = true
      r.special.largeWindows = true
      r.style = 'luxury'
      r.preferences.luxury = 85
      r.preferences.privacy = 85
    })
  },
  {
    id: '2k-estate',
    name: '2 Kanal Estate',
    preset: '2-kanal',
    strategy: 'luxury-open',
    seed: 3010,
    blurb: '6 bedrooms, pool, gym, home theater, landscaped grounds',
    req: R((r) => {
      r.floors = 'basement+ground+first'
      r.special.basement = true
      Object.assign(r.rooms, { bedrooms: 6, guestBedrooms: 2, bathrooms: 9, dirtyKitchens: 1, studyRooms: 1, prayerRooms: 1, servantRooms: 1, servantBathrooms: 1 })
      r.outdoor.cars = 4
      r.outdoor.pool = true
      r.outdoor.patio = true
      r.outdoor.backLawn = true
      r.outdoor.bbq = true
      r.special.gym = true
      r.special.homeTheater = true
      r.style = 'mediterranean'
      r.preferences.luxury = 90
    })
  },
  {
    id: '4k-estate',
    name: '4 Kanal Estate',
    preset: '4-kanal',
    strategy: 'garden',
    seed: 4010,
    blurb: 'Grand estate with lift, double-height lounge and gardens',
    req: R((r) => {
      r.floors = 'basement+ground+first'
      r.special.basement = true
      Object.assign(r.rooms, { bedrooms: 7, guestBedrooms: 2, bathrooms: 10, dirtyKitchens: 1, studyRooms: 1, prayerRooms: 1, servantRooms: 2, servantBathrooms: 2, livingRooms: 1 })
      r.outdoor.cars = 4
      r.outdoor.pool = true
      r.outdoor.patio = true
      r.outdoor.backLawn = true
      r.outdoor.playArea = true
      r.outdoor.bbq = true
      r.special.gym = true
      r.special.homeTheater = true
      r.special.elevator = true
      r.special.doubleHeightLounge = true
      r.style = 'luxury'
      r.preferences.luxury = 95
      r.preferences.greenSpace = 85
    })
  }
]

export function templateRequirements(t: Template) {
  return t.req(defaultRequirements())
}
