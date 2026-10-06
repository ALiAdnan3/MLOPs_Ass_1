import type { ArchitecturalStyle, FloorsOption, Requirements, RoomCounts } from '../core/model/types'
import { PLOT_PRESETS } from '../core/units/plots'
import { FT } from '../core/units/units'

/**
 * AI TEXT → STRUCTURED REQUIREMENTS (§22), offline. A deterministic phrase parser that
 * understands plot sizes (marla/kanal/feet/meters), floors, room counts (digits or words),
 * outdoor spaces, special features, style and preference adjectives. It also reports exactly
 * which phrase produced which requirement, so the user can see what was understood.
 */

export interface ParseFinding {
  phrase: string
  meaning: string
}

export interface ParsedRequirements {
  req: Requirements
  plot?: { presetId?: string; widthM?: number; depthM?: number }
  findings: ParseFinding[]
  unclear: string[]
}

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, single: 1, two: 2, double: 2, pair: 2, three: 3, triple: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }
const numOf = (s: string) => (/^\d+$/.test(s) ? parseInt(s, 10) : NUM[s.toLowerCase()] ?? NaN)
const N = '(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|single|double|triple)'

const ROOM_PATTERNS: { key: keyof RoomCounts; re: string; label: string }[] = [
  { key: 'masterBedrooms', re: 'master\\s*(?:bed)?rooms?|master\\s*suites?', label: 'master bedroom' },
  { key: 'guestBedrooms', re: 'guest\\s*(?:bed)?rooms?|guest\\s*suites?', label: 'guest bedroom' },
  { key: 'kidsRooms', re: "kids?'?\\s*rooms?|children'?s?\\s*rooms?|nursery", label: 'kids room' },
  { key: 'servantRooms', re: 'servants?\\s*(?:rooms?|quarters?)|maid\\s*rooms?|staff\\s*rooms?|driver\\s*rooms?', label: 'servant room' },
  { key: 'servantBathrooms', re: 'servants?\\s*(?:bath(?:room)?s?|toilets?)', label: 'servant bath' },
  { key: 'bedrooms', re: 'bed\\s*rooms?|beds?|bhk', label: 'bedroom' },
  { key: 'powderRooms', re: 'powder\\s*rooms?|guest\\s*toilets?|half\\s*baths?', label: 'powder room' },
  { key: 'bathrooms', re: 'bath\\s*rooms?|baths?|washrooms?|toilets?', label: 'bathroom' },
  { key: 'dirtyKitchens', re: 'dirty\\s*kitchens?|service\\s*kitchens?|wet\\s*kitchens?|back\\s*kitchens?', label: 'dirty kitchen' },
  { key: 'kitchens', re: 'kitchens?', label: 'kitchen' },
  { key: 'diningRooms', re: 'dining\\s*(?:rooms?|areas?|halls?)?|dinning', label: 'dining room' },
  { key: 'tvLounges', re: 't\\.?v\\.?\\s*lounges?|lounges?', label: 'TV lounge' },
  { key: 'drawingRooms', re: 'drawing\\s*(?:rooms?)?|formal\\s*sitting|baithak', label: 'drawing room' },
  { key: 'livingRooms', re: 'living\\s*rooms?|formal\\s*living', label: 'living room' },
  { key: 'familyRooms', re: 'family\\s*(?:rooms?|lounges?)', label: 'family room' },
  { key: 'studyRooms', re: 'stud(?:y|ies)(?:\\s*rooms?)?', label: 'study' },
  { key: 'offices', re: '(?:home\\s*)?offices?', label: 'office' },
  { key: 'prayerRooms', re: 'prayer\\s*(?:rooms?|areas?)|namaz\\s*rooms?', label: 'prayer room' },
  { key: 'laundries', re: 'laundr(?:y|ies)(?:\\s*rooms?)?|utility\\s*rooms?', label: 'laundry' },
  { key: 'stores', re: 'store\\s*rooms?|stores?|storage\\s*rooms?', label: 'store' },
  { key: 'pantries', re: 'pantr(?:y|ies)', label: 'pantry' },
  { key: 'walkInClosets', re: 'walk[-\\s]*in\\s*closets?|walk[-\\s]*in\\s*wardrobes?', label: 'walk-in closet' },
  { key: 'dressingRooms', re: 'dressing\\s*(?:rooms?|areas?)?', label: 'dressing room' }
]

const STYLE_WORDS: [RegExp, ArchitecturalStyle][] = [
  [/pakistani\s*modern|desi\s*modern/, 'pakistani_modern'],
  [/ultra[-\s]*modern|modern/, 'modern'],
  [/contemporary/, 'contemporary'],
  [/minimal(ist)?/, 'minimalist'],
  [/marble\s*(luxury|villa|house|facade)|classic(al)?\s*luxur(y|ious)/, 'luxury_classic'],
  [/traditional|classic\b/, 'traditional'],
  [/luxur(y|ious)|palatial/, 'luxury'],
  [/islamic|mughal/, 'islamic'],
  [/mediterranean|spanish/, 'mediterranean'],
  [/european|french/, 'european'],
  [/colonial|victorian/, 'colonial'],
  [/industrial/, 'industrial'],
  [/farm\s*house|farmhouse/, 'farmhouse']
]

export function parseRequirements(text: string, base: Requirements): ParsedRequirements {
  const req = structuredClone(base)
  const t = ' ' + text.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ') + ' '
  const findings: ParseFinding[] = []
  const unclear: string[] = []
  const found = (phrase: string, meaning: string) => findings.push({ phrase: phrase.trim(), meaning })
  let plot: ParsedRequirements['plot']

  // ── plot size ──
  const marla = t.match(/(\d+(?:\.\d+)?)\s*[-\s]?marla/)
  const kanal = t.match(/(\d+(?:\.\d+)?|one|two|four|half)\s*[-\s]?kanal/)
  const dims = t.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|'|m|meters?)?\s*(?:x|by|×|\*)\s*(\d+(?:\.\d+)?)\s*(ft|feet|foot|'|m|meters?)?/)
  if (kanal) {
    const k = kanal[1] === 'half' ? 0.5 : numOf(kanal[1]) || parseFloat(kanal[1])
    const m = Math.round(k * 20)
    const preset = PLOT_PRESETS.find((p) => p.marla === m)
    if (preset) plot = { presetId: preset.id }
    else plot = { widthM: Math.sqrt(m * 225 * 0.55) * FT, depthM: Math.sqrt((m * 225) / 0.55) * FT }
    found(kanal[0], `${k} kanal plot`)
  } else if (marla) {
    const m = parseFloat(marla[1])
    const preset = PLOT_PRESETS.find((p) => Math.abs(p.marla - m) < 0.01)
    if (preset) plot = { presetId: preset.id }
    else plot = { widthM: Math.sqrt(m * 225 * 0.55) * FT, depthM: Math.sqrt((m * 225) / 0.55) * FT }
    found(marla[0], `${m} marla plot`)
  }
  if (dims) {
    const unit = (dims[3] ?? '').startsWith('m') ? 1 : FT
    const a = parseFloat(dims[1]) * unit
    const b = parseFloat(dims[2]) * unit
    plot = { ...plot, widthM: Math.min(a, b), depthM: Math.max(a, b), presetId: plot?.presetId && !dims ? plot.presetId : undefined }
    found(dims[0], `plot ${dims[1]} × ${dims[2]} ${unit === 1 ? 'm' : 'ft'}`)
  }

  // ── floors ──
  const setFloors = (f: FloorsOption, phrase: string, meaning: string) => {
    req.floors = f
    found(phrase, meaning)
  }
  const basement = /basement|cellar|under\s*ground\s*floor/.test(t)
  const storey = t.match(/(single|one|1|double|two|2|triple|three|3)[-\s]*(?:stor(?:e)?y|stor(?:e)?ys|stor(?:e)?ied|floors?|level|unit)/)
  const groundPlus = t.match(/ground\s*\+\s*(\d)|g\s*\+\s*(\d)/)
  let above = 0
  if (storey) {
    const v = storey[1]
    above = v === 'single' || v === 'one' || v === '1' ? 1 : v === 'double' || v === 'two' || v === '2' ? 2 : 3
  } else if (groundPlus) above = 1 + parseInt(groundPlus[1] ?? groundPlus[2], 10)
  if (above) {
    const map: Record<string, FloorsOption> = { '1': basement ? 'basement+ground' : 'single', '2': basement ? 'basement+ground+first' : 'double', '3': basement ? 'basement+ground+first+second' : 'triple' }
    setFloors(map[String(Math.min(3, above))], storey?.[0] ?? groundPlus![0], `${above} floor${above > 1 ? 's' : ''}${basement ? ' plus basement' : ''}`)
  }
  if (basement) {
    req.special.basement = true
    if (!above) {
      req.floors = req.floors === 'single' ? 'basement+ground' : req.floors === 'triple' ? 'basement+ground+first+second' : 'basement+ground+first'
    }
    found('basement', 'basement floor')
  }

  // ── rooms ──
  const counted = new Set<keyof RoomCounts>()
  for (const p of ROOM_PATTERNS) {
    const re = new RegExp(`${N}\\s*(?:x\\s*)?(?:large |big |spacious |small |separate |attached |modern |open |formal |luxury )?(${p.re})\\b`, 'g')
    let m: RegExpExecArray | null
    let total = 0
    let phrase = ''
    const consumed: [number, number][] = []
    while ((m = re.exec(t))) {
      const n = numOf(m[1])
      if (!Number.isFinite(n)) continue
      total += n
      phrase = m[0]
      consumed.push([m.index, m.index + m[0].length])
    }
    if (total > 0) {
      ;(req.rooms[p.key] as number) = total
      counted.add(p.key)
      found(phrase, `${total} × ${p.label}`)
      continue
    }
    // mentioned without a number → at least one
    const bare = new RegExp(`\\b(${p.re})\\b`).exec(t)
    if (bare && !counted.has(p.key)) {
      if (p.key === 'bedrooms' || p.key === 'bathrooms' || p.key === 'kitchens' || p.key === 'tvLounges') continue
      if ((req.rooms[p.key] as number) < 1) (req.rooms[p.key] as number) = 1
      counted.add(p.key)
      found(bare[0], `a ${p.label}`)
    }
  }
  // "4 bedrooms" includes masters: keep the master count within the total
  if (counted.has('bedrooms') && !counted.has('masterBedrooms')) req.rooms.masterBedrooms = Math.min(1, req.rooms.bedrooms)
  if (counted.has('bedrooms') && req.rooms.masterBedrooms > req.rooms.bedrooms) req.rooms.masterBedrooms = req.rooms.bedrooms
  if (counted.has('kitchens') && req.rooms.kitchens >= 2 && !counted.has('dirtyKitchens')) {
    req.rooms.dirtyKitchens = req.rooms.kitchens - 1
    req.rooms.kitchens = 1
    found('kitchens', 'second kitchen treated as a dirty kitchen')
  }
  if (counted.has('bedrooms') && !counted.has('bathrooms')) {
    req.rooms.bathrooms = req.rooms.bedrooms + req.rooms.guestBedrooms
    found('(implied)', `${req.rooms.bathrooms} bathrooms, one per bedroom`)
  }

  // ── outdoor ──
  const cars = t.match(new RegExp(`${N}\\s*(?:-\\s*)?cars?\\s*(?:parking|garage|porch)?|(?:parking|garage|porch)\\s*(?:for\\s*)?${N}\\s*cars?`))
  if (cars) {
    const n = numOf(cars[1] ?? cars[2])
    req.outdoor.garage = true
    req.outdoor.cars = Math.max(1, Math.min(4, n))
    found(cars[0], `${req.outdoor.cars}-car garage`)
  } else if (/garage|car\s*porch|parking/.test(t)) {
    req.outdoor.garage = true
    found('garage', 'garage / car porch')
  }
  const flag = (re: RegExp, set: () => void, meaning: string) => {
    const m = t.match(re)
    if (m) {
      set()
      found(m[0], meaning)
    }
  }
  flag(/back\s*(?:yard\s*)?lawn|rear\s*lawn|back\s*garden/, () => (req.outdoor.backLawn = true), 'back lawn')
  flag(/front\s*lawn|front\s*garden/, () => (req.outdoor.frontLawn = true), 'front lawn')
  flag(/(large|big|spacious|huge)\s*lawn/, () => {
    req.outdoor.frontLawn = true
    req.outdoor.backLawn = true
    req.preferences.greenSpace = Math.max(req.preferences.greenSpace, 80)
  }, 'large lawn')
  if (/\blawn\b/.test(t) && !req.outdoor.backLawn && !req.outdoor.frontLawn) {
    req.outdoor.frontLawn = true
    found('lawn', 'front lawn')
  }
  flag(/patio/, () => (req.outdoor.patio = true), 'patio')
  flag(/terrace/, () => (req.outdoor.terrace = true), 'terrace')
  flag(/balcon(y|ies)/, () => (req.outdoor.balcony = true), 'balcony')
  flag(/swimming\s*pool|\bpool\b/, () => (req.outdoor.pool = true), 'swimming pool')
  flag(/outdoor\s*kitchen/, () => (req.outdoor.outdoorKitchen = true), 'outdoor kitchen')
  flag(/outdoor\s*(sitting|seating)/, () => (req.outdoor.outdoorSitting = true), 'outdoor sitting')
  flag(/\bgarden\b/, () => (req.outdoor.garden = true), 'garden')
  flag(/play\s*(area|ground)/, () => (req.outdoor.playArea = true), 'play area')
  flag(/bbq|barbe?que|barbecue/, () => (req.outdoor.bbq = true), 'BBQ area')
  flag(/courtyard|sehan/, () => {
    req.outdoor.courtyard = true
    req.special.centralCourtyard = true
  }, 'central courtyard')

  // ── special ──
  flag(/double[-\s]*height\s*(lounge|living|hall)/, () => (req.special.doubleHeightLounge = true), 'double-height lounge')
  flag(/double[-\s]*height\s*(entrance|entry|foyer|lobby)/, () => (req.special.doubleHeightEntrance = true), 'double-height entrance')
  flag(/(large|big|floor[-\s]*to[-\s]*ceiling|full[-\s]*height)\s*(glass\s*)?windows?|lots of glass/, () => (req.special.largeWindows = true), 'large windows')
  flag(/sky\s*lights?/, () => (req.special.skylight = true), 'skylight')
  flag(/atrium/, () => (req.special.atrium = true), 'atrium')
  flag(/elevator|\blift\b/, () => (req.special.elevator = true), 'elevator')
  flag(/home\s*(theater|theatre|cinema)|cinema\s*room|media\s*room/, () => (req.special.homeTheater = true), 'home theater')
  flag(/\bgym\b|fitness/, () => (req.special.gym = true), 'gym')
  flag(/game\s*room|games\s*room|snooker/, () => (req.special.gameRoom = true), 'game room')
  flag(/library/, () => (req.special.library = true), 'library')
  flag(/roof\s*top\s*garden|rooftop\s*garden|roof\s*garden/, () => (req.special.rooftopGarden = true), 'rooftop garden')
  const stair = t.match(/(spiral|floating|straight|l[-\s]shaped|u[-\s]shaped)\s*stair/)
  if (stair) {
    const s = stair[1].replace(/[-\s]shaped/, '').toUpperCase()
    req.special.stairType = (s === 'SPIRAL' ? 'spiral' : s === 'FLOATING' ? 'floating' : s === 'STRAIGHT' ? 'straight' : s === 'L' ? 'L' : 'U') as Requirements['special']['stairType']
    found(stair[0], `${stair[1]} staircase`)
  }

  // ── style ──
  for (const [re, style] of STYLE_WORDS) {
    const m = t.match(re)
    if (m) {
      req.style = style
      found(m[0], `${style.replace('_', ' ')} style`)
      if (style === 'luxury' || style === 'luxury_classic') req.preferences.luxury = Math.max(req.preferences.luxury, 80)
      break
    }
  }

  // ── preferences ──
  const pref = (re: RegExp, key: keyof Requirements['preferences'], value: number, meaning: string) => {
    const m = t.match(re)
    if (m) {
      req.preferences[key] = value
      found(m[0], meaning)
    }
  }
  pref(/(high|more|maximum|lots of|a lot of|full)\s*privacy|private/, 'privacy', 85, 'high privacy')
  pref(/(lots of|plenty of|more|maximum|great|good|natural)\s*(day)?light|bright/, 'naturalLight', 85, 'plenty of natural light')
  pref(/(cross|good|more)\s*ventilation|airy/, 'ventilation', 85, 'good ventilation')
  pref(/open[-\s]*(plan|space|layout|concept)/, 'openSpace', 85, 'open-plan living')
  pref(/(more|lots of|maximum)\s*(green|garden|greenery)/, 'greenSpace', 85, 'more green space')
  pref(/entertain(ing|ment)/, 'entertainment', 80, 'space to entertain')
  pref(/(big|large|joint)\s*family/, 'familySpace', 85, 'large family')

  if (!findings.length) unclear.push('No house details were recognised. Try: "10 marla double storey, 4 bedrooms, 2 car parking, lawn".')
  return { req, plot, findings, unclear }
}
