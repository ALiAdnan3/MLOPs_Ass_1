import type { RoomType, Zone } from '../model/types'
import { ft } from '../units/units'

export interface RoomSpec {
  type: RoomType
  label: string
  zone: Zone
  /** Minimum clear dimension (m). */
  minWidth: number
  /** Minimum area (m²). */
  minArea: number
  /** Target width × depth (m) for a "standard" (10 marla) house. */
  target: [number, number]
  maxAspect: number
  /** Needs daylight / a window to the outside. */
  habitable: boolean
  wet: boolean
  /** Open to sky / outdoor finish. */
  outdoor: boolean
  /** People can walk in it (void and lift are not). */
  walkable: boolean
  /** Can act as circulation other rooms open onto. */
  circulation: boolean
  floorFinish: string
  wallFinish: string
  ceilingFinish: string
  /** Plan fill tint (light theme). */
  tint: string
  /** Search words for the NL parser / smart labeling. */
  words: string[]
}

const f = (w: number, d: number): [number, number] => [ft(w), ft(d)]

const S = (s: Partial<RoomSpec> & Pick<RoomSpec, 'type' | 'label' | 'zone' | 'target'>): RoomSpec => ({
  minWidth: ft(8),
  minArea: ft(8) * ft(8),
  maxAspect: 2.6,
  habitable: true,
  wet: false,
  outdoor: false,
  walkable: true,
  circulation: false,
  floorFinish: 'lib:porcelain-ivory',
  wallFinish: 'lib:paint-warm-white',
  ceilingFinish: 'lib:paint-ceiling',
  tint: '#EEF1F4',
  words: [],
  ...s
})

export const ROOM_SPECS: Record<RoomType, RoomSpec> = {
  master_bedroom: S({ type: 'master_bedroom', label: 'Master Bedroom', zone: 'private', target: f(15, 17), minWidth: ft(11), minArea: ft(11) * ft(12), floorFinish: 'lib:wood-oak', tint: '#E8EEF6', words: ['master bedroom', 'master', 'main bedroom', 'master room'] }),
  bedroom: S({ type: 'bedroom', label: 'Bedroom', zone: 'private', target: f(13, 14), minWidth: ft(9.5), minArea: ft(9.5) * ft(10), floorFinish: 'lib:wood-oak', tint: '#E8EEF6', words: ['bedroom', 'bed room', 'room'] }),
  guest_bedroom: S({ type: 'guest_bedroom', label: 'Guest Bedroom', zone: 'public', target: f(12, 14), minWidth: ft(9.5), minArea: ft(9.5) * ft(10), floorFinish: 'lib:porcelain-ivory', tint: '#EAEFF2', words: ['guest bedroom', 'guest room', 'guest'] }),
  kids_room: S({ type: 'kids_room', label: 'Kids Room', zone: 'private', target: f(12, 13), minWidth: ft(9), minArea: ft(9) * ft(10), floorFinish: 'lib:wood-maple', tint: '#E8EEF6', words: ['kids room', 'children room', 'kids', 'nursery', 'child room'] }),
  bathroom: S({ type: 'bathroom', label: 'Bath', zone: 'private', target: f(6.5, 8.5), minWidth: ft(5), minArea: ft(5) * ft(7), maxAspect: 2.4, habitable: false, wet: true, floorFinish: 'lib:ceramic-grey-matte', wallFinish: 'lib:ceramic-white-gloss', ceilingFinish: 'lib:paint-ceiling', tint: '#E3EEF0', words: ['bathroom', 'bath', 'washroom', 'toilet', 'wc', 'restroom'] }),
  powder: S({ type: 'powder', label: 'Powder Room', zone: 'semi', target: f(5, 6.5), minWidth: ft(3.5), minArea: ft(3.5) * ft(5), maxAspect: 2.2, habitable: false, wet: true, floorFinish: 'lib:marble-carrara', wallFinish: 'lib:ceramic-white-gloss', tint: '#E3EEF0', words: ['powder room', 'powder', 'guest toilet', 'half bath'] }),
  kitchen: S({ type: 'kitchen', label: 'Kitchen', zone: 'semi', target: f(11, 13), minWidth: ft(7.5), minArea: ft(8) * ft(10), wet: true, floorFinish: 'lib:porcelain-concrete-grey', wallFinish: 'lib:paint-warm-white', tint: '#F4EFE6', words: ['kitchen', 'main kitchen', 'clean kitchen'] }),
  dirty_kitchen: S({ type: 'dirty_kitchen', label: 'Dirty Kitchen', zone: 'service', target: f(8, 10), minWidth: ft(6.5), minArea: ft(6.5) * ft(8), wet: true, floorFinish: 'lib:ceramic-grey-matte', tint: '#EFECE6', words: ['dirty kitchen', 'service kitchen', 'back kitchen', 'wet kitchen'] }),
  dining: S({ type: 'dining', label: 'Dining', zone: 'semi', target: f(12, 14), minWidth: ft(9), minArea: ft(9) * ft(11), floorFinish: 'lib:marble-botticino', tint: '#F3EEE4', words: ['dining room', 'dining', 'dinning'] }),
  tv_lounge: S({ type: 'tv_lounge', label: 'TV Lounge', zone: 'semi', target: f(16, 18), minWidth: ft(11), minArea: ft(11) * ft(13), circulation: true, floorFinish: 'lib:marble-carrara', tint: '#F2EDE3', words: ['tv lounge', 'lounge', 'living room', 'tv room', 'family lounge'] }),
  drawing: S({ type: 'drawing', label: 'Drawing Room', zone: 'public', target: f(14, 17), minWidth: ft(10.5), minArea: ft(11) * ft(12), floorFinish: 'lib:marble-botticino', tint: '#F4EEE2', words: ['drawing room', 'drawing', 'formal living', 'sitting room', 'baithak'] }),
  living: S({ type: 'living', label: 'Living Room', zone: 'semi', target: f(15, 17), minWidth: ft(11), minArea: ft(11) * ft(13), circulation: true, floorFinish: 'lib:marble-carrara', tint: '#F2EDE3', words: ['living room', 'living'] }),
  family: S({ type: 'family', label: 'Family Lounge', zone: 'private', target: f(14, 16), minWidth: ft(10), minArea: ft(10) * ft(12), circulation: true, floorFinish: 'lib:wood-oak', tint: '#EFEDE6', words: ['family room', 'family lounge', 'upper lounge'] }),
  study: S({ type: 'study', label: 'Study', zone: 'private', target: f(10, 12), minWidth: ft(8), minArea: ft(8) * ft(9), floorFinish: 'lib:wood-walnut', tint: '#ECEEE9', words: ['study room', 'study'] }),
  office: S({ type: 'office', label: 'Office', zone: 'public', target: f(11, 12), minWidth: ft(8), minArea: ft(8) * ft(9), floorFinish: 'lib:wood-walnut', tint: '#ECEEE9', words: ['office', 'home office', 'work room'] }),
  prayer: S({ type: 'prayer', label: 'Prayer Room', zone: 'private', target: f(8, 10), minWidth: ft(6.5), minArea: ft(6.5) * ft(8), floorFinish: 'lib:marble-carrara', tint: '#EEF0EA', words: ['prayer room', 'prayer', 'namaz room', 'musalla'] }),
  laundry: S({ type: 'laundry', label: 'Laundry', zone: 'service', target: f(6.5, 8), minWidth: ft(5), minArea: ft(5) * ft(6), habitable: false, wet: true, floorFinish: 'lib:ceramic-grey-matte', tint: '#EDEDEA', words: ['laundry', 'wash area', 'utility'] }),
  store: S({ type: 'store', label: 'Store', zone: 'service', target: f(6, 8), minWidth: ft(4), minArea: ft(4) * ft(5), habitable: false, floorFinish: 'lib:concrete-smooth', tint: '#EDEDEA', words: ['store room', 'store', 'storage'] }),
  pantry: S({ type: 'pantry', label: 'Pantry', zone: 'service', target: f(5, 6), minWidth: ft(4), minArea: ft(4) * ft(5), habitable: false, floorFinish: 'lib:ceramic-grey-matte', tint: '#EFECE6', words: ['pantry'] }),
  servant: S({ type: 'servant', label: 'Servant Room', zone: 'service', target: f(9, 10), minWidth: ft(7.5), minArea: ft(7.5) * ft(8), floorFinish: 'lib:ceramic-grey-matte', tint: '#EDEDEA', words: ['servant room', 'servant quarter', 'staff room', 'maid room', 'driver room'] }),
  servant_bath: S({ type: 'servant_bath', label: 'Servant Bath', zone: 'service', target: f(5, 6), minWidth: ft(4), minArea: ft(4) * ft(5), habitable: false, wet: true, floorFinish: 'lib:ceramic-grey-matte', wallFinish: 'lib:ceramic-white-gloss', tint: '#E3EEF0', words: ['servant bath', 'servant toilet', 'staff toilet'] }),
  walk_in_closet: S({ type: 'walk_in_closet', label: 'Walk-in Closet', zone: 'private', target: f(6, 8), minWidth: ft(5), minArea: ft(5) * ft(6), habitable: false, floorFinish: 'lib:wood-oak', tint: '#ECEAF1', words: ['walk-in closet', 'walk in closet', 'closet', 'wardrobe room'] }),
  dressing: S({ type: 'dressing', label: 'Dressing', zone: 'private', target: f(6, 7), minWidth: ft(4.5), minArea: ft(4.5) * ft(6), habitable: false, floorFinish: 'lib:wood-oak', tint: '#ECEAF1', words: ['dressing room', 'dressing', 'dresser'] }),
  foyer: S({ type: 'foyer', label: 'Entrance', zone: 'public', target: f(8, 10), minWidth: ft(5), minArea: ft(5) * ft(6), habitable: false, circulation: true, floorFinish: 'lib:marble-nero', tint: '#F1EEE8', words: ['entrance', 'foyer', 'entry', 'lobby', 'reception'] }),
  corridor: S({ type: 'corridor', label: 'Passage', zone: 'circulation', target: f(4, 12), minWidth: ft(3.5), minArea: ft(3.5) * ft(4), maxAspect: 12, habitable: false, circulation: true, floorFinish: 'lib:porcelain-ivory', tint: '#F1F1EF', words: ['corridor', 'passage', 'hallway', 'hall', 'gallery'] }),
  stair: S({ type: 'stair', label: 'Stairs', zone: 'circulation', target: f(9, 14), minWidth: ft(7), minArea: ft(7) * ft(10), maxAspect: 3, habitable: false, circulation: true, floorFinish: 'lib:marble-botticino', tint: '#EFEFEC', words: ['stairs', 'staircase', 'stair'] }),
  lift: S({ type: 'lift', label: 'Lift', zone: 'circulation', target: f(6, 6), minWidth: ft(5), minArea: ft(5) * ft(5), maxAspect: 1.6, habitable: false, walkable: false, floorFinish: 'lib:metal-brushed', tint: '#E8E8E6', words: ['lift', 'elevator'] }),
  garage: S({ type: 'garage', label: 'Garage', zone: 'service', target: f(20, 18), minWidth: ft(10), minArea: ft(10) * ft(17), maxAspect: 3.5, habitable: false, floorFinish: 'lib:pavers-grey', wallFinish: 'lib:plaster-grey', tint: '#EAEAE8', words: ['garage', 'car porch', 'porch', 'parking', 'carport'] }),
  terrace: S({ type: 'terrace', label: 'Terrace', zone: 'outdoor', target: f(14, 12), minWidth: ft(5), minArea: ft(5) * ft(8), maxAspect: 6, habitable: false, outdoor: true, floorFinish: 'lib:porcelain-outdoor', tint: '#EAF1E6', words: ['terrace', 'roof terrace', 'deck'] }),
  balcony: S({ type: 'balcony', label: 'Balcony', zone: 'outdoor', target: f(12, 4.5), minWidth: ft(3.5), minArea: ft(3.5) * ft(6), maxAspect: 8, habitable: false, outdoor: true, floorFinish: 'lib:porcelain-outdoor', tint: '#EAF1E6', words: ['balcony'] }),
  courtyard: S({ type: 'courtyard', label: 'Courtyard', zone: 'outdoor', target: f(12, 12), minWidth: ft(8), minArea: ft(8) * ft(8), habitable: false, outdoor: true, floorFinish: 'lib:stone-travertine', tint: '#E4EFE0', words: ['courtyard', 'central courtyard', 'sehan', 'open court'] }),
  home_theater: S({ type: 'home_theater', label: 'Home Theater', zone: 'semi', target: f(16, 20), minWidth: ft(12), minArea: ft(12) * ft(15), habitable: false, floorFinish: 'lib:fabric-carpet-charcoal', wallFinish: 'lib:fabric-acoustic', tint: '#E9E7EE', words: ['home theater', 'home theatre', 'cinema', 'theater', 'theatre', 'media room'] }),
  gym: S({ type: 'gym', label: 'Gym', zone: 'semi', target: f(14, 16), minWidth: ft(10), minArea: ft(10) * ft(12), floorFinish: 'lib:rubber-black', tint: '#E9ECEB', words: ['gym', 'fitness', 'workout'] }),
  game_room: S({ type: 'game_room', label: 'Game Room', zone: 'semi', target: f(14, 18), minWidth: ft(11), minArea: ft(11) * ft(13), floorFinish: 'lib:wood-walnut', tint: '#ECEAF0', words: ['game room', 'games room', 'play room', 'rec room', 'snooker'] }),
  library: S({ type: 'library', label: 'Library', zone: 'private', target: f(12, 14), minWidth: ft(9), minArea: ft(9) * ft(10), floorFinish: 'lib:wood-walnut', tint: '#ECEEE9', words: ['library', 'reading room'] }),
  basement_lounge: S({ type: 'basement_lounge', label: 'Basement Lounge', zone: 'semi', target: f(18, 20), minWidth: ft(12), minArea: ft(12) * ft(14), circulation: true, floorFinish: 'lib:porcelain-concrete-grey', tint: '#EFEDE6', words: ['basement lounge', 'basement living', 'rec lounge'] }),
  mechanical: S({ type: 'mechanical', label: 'Mechanical', zone: 'service', target: f(8, 10), minWidth: ft(6), minArea: ft(6) * ft(7), habitable: false, floorFinish: 'lib:concrete-smooth', wallFinish: 'lib:plaster-grey', tint: '#E8E8E6', words: ['mechanical room', 'mechanical', 'plant room', 'ups room', 'generator room'] }),
  wine_storage: S({ type: 'wine_storage', label: 'Wine / Storage', zone: 'service', target: f(8, 9), minWidth: ft(6), minArea: ft(6) * ft(6), habitable: false, floorFinish: 'lib:stone-slate', tint: '#EBE8E4', words: ['wine', 'cellar', 'wine storage'] }),
  void: S({ type: 'void', label: 'Open to Below', zone: 'void', target: f(12, 12), minWidth: ft(4), minArea: ft(4) * ft(4), maxAspect: 8, habitable: false, walkable: false, tint: '#FFFFFF', words: ['void', 'open to below', 'double height'] }),
  mumty: S({ type: 'mumty', label: 'Stair Cover', zone: 'circulation', target: f(9, 14), minWidth: ft(6), minArea: ft(6) * ft(9), habitable: false, circulation: true, floorFinish: 'lib:concrete-smooth', tint: '#EFEFEC', words: ['mumty', 'stair cover', 'roof stair'] }),
  rooftop_garden: S({ type: 'rooftop_garden', label: 'Rooftop Garden', zone: 'outdoor', target: f(14, 14), minWidth: ft(6), minArea: ft(6) * ft(8), maxAspect: 6, habitable: false, outdoor: true, floorFinish: 'lib:grass-lawn', tint: '#E0EEDB', words: ['rooftop garden', 'roof garden', 'green roof'] }),
  custom: S({ type: 'custom', label: 'Room', zone: 'semi', target: f(10, 12), words: [] })
}

export const spec = (t: RoomType) => ROOM_SPECS[t] ?? ROOM_SPECS.custom

export const isWalkable = (t: RoomType) => spec(t).walkable
export const isOutdoorRoom = (t: RoomType) => spec(t).outdoor
export const isIndoor = (t: RoomType) => !spec(t).outdoor && t !== 'void'
export const isBedroomType = (t: RoomType) => t === 'master_bedroom' || t === 'bedroom' || t === 'guest_bedroom' || t === 'kids_room' || t === 'servant'
export const isBathType = (t: RoomType) => t === 'bathroom' || t === 'powder' || t === 'servant_bath'

/** Room types offered in pickers, grouped. */
export const ROOM_TYPE_GROUPS: { label: string; types: RoomType[] }[] = [
  { label: 'Bedrooms', types: ['master_bedroom', 'bedroom', 'guest_bedroom', 'kids_room', 'servant'] },
  { label: 'Bath & dressing', types: ['bathroom', 'powder', 'servant_bath', 'walk_in_closet', 'dressing'] },
  { label: 'Living', types: ['tv_lounge', 'drawing', 'living', 'family', 'dining', 'foyer'] },
  { label: 'Kitchen & service', types: ['kitchen', 'dirty_kitchen', 'pantry', 'laundry', 'store', 'mechanical', 'wine_storage'] },
  { label: 'Work & leisure', types: ['study', 'office', 'library', 'prayer', 'home_theater', 'gym', 'game_room', 'basement_lounge'] },
  { label: 'Circulation', types: ['corridor', 'stair', 'lift', 'void', 'mumty'] },
  { label: 'Outdoor & parking', types: ['garage', 'terrace', 'balcony', 'courtyard', 'rooftop_garden'] },
  { label: 'Other', types: ['custom'] }
]
