import type { ArchitecturalStyle, Floor, Project, Requirements, Room, RoomType, RoofType, SiteArea, SiteAreaKind, Vec2 } from '../core/model/types'
import { EDIT_OPS } from '../../../shared/ai-schemas'
import { ROOM_SPECS, spec, isBathType } from '../core/constraints/rooms'
import { bbox, area, centroid, differencePolys, intersectPolys, largestInscribedRect, unionPolys, rectPoly, pointInPolygon } from '../core/geometry/polygon'
import { FT, formatLength, formatAreaFor } from '../core/units/units'
import { distToSegment } from '../core/geometry/segment'
import { wallsOfRoom, effectiveKind } from '../planner/walls'
import { setRoomSize, swapRooms, splitRoom, mergeRooms, refurnishRoom, refreshFloor, setFloorHeight, deleteRoom } from '../planner/operations'
import { addDoor, sharedWalls } from '../planner/generator/openings'
import { addWindowToRoom, scaleWindows } from '../planner/openingsEdit'
import { repairAccess } from '../planner/access'
import { validateHouse } from '../planner/validation'
import { applySmartLabels } from '../planner/labels'
import { exteriorForStyle } from '../core/model/defaults'
import { areaSummary, designStats } from '../planner/metrics'
import { measure, estimate, formatMoney } from '../planner/estimate'
import { sortedFloors } from '../core/model/house'
import { commit, getProject } from '../state/store'
import { useUI } from '../state/ui'
import { platform } from '../storage/platform'
import { uid } from '../core/model/ids'

/**
 * NATURAL LANGUAGE EDITING (§23) and the assistant's brain (§44).
 * Text → edit operations (offline rules, or Claude with structured output when enabled) →
 * real edits on the house model in one undoable step → a plain-language report of what changed,
 * which rooms moved, new dimensions and area changes.
 */

export type EditOpName = (typeof EDIT_OPS)[number]
export interface EditOp {
  op: EditOpName
  target: string | null
  other: string | null
  amount: number | null
  unit: 'ft' | 'in' | 'm' | 'cm' | 'percent' | 'count' | null
  axis: 'width' | 'length' | 'both' | null
  value: string | null
}
export interface EditPlan {
  operations: EditOp[]
  reply: string
  source: 'offline' | 'claude'
}
export interface EditResult {
  ok: boolean
  message: string
  changes: string[]
  moved: string[]
  areaChanges: { name: string; before: number; after: number }[]
  /** Needs a new layout: the requirements to regenerate with (asks before doing it). */
  regenerate?: Requirements
  /** The assistant needs a choice from the user. */
  choices?: string[]
}

const op = (o: Partial<EditOp> & { op: EditOpName }): EditOp => ({ target: null, other: null, amount: null, unit: null, axis: null, value: null, ...o })

/* ── room references ─────────────────────────────────────────────────────── */

interface RoomHit {
  floor: Floor
  room: Room
}

const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, half: 0.5 }

function aliasesOf(r: Room): string[] {
  const sp = spec(r.type)
  const out = new Set<string>([r.name.toLowerCase(), sp.label.toLowerCase(), ...sp.words])
  return [...out].filter((a) => a.length > 1 && a !== 'room')
}

/** Room mentions in a text, in reading order. Longer aliases win ("master bedroom" over "bedroom"). */
function roomMentions(text: string, p: Project, floorId: string): { hit: RoomHit | null; ambiguous: RoomHit[]; at: number; phrase: string }[] {
  const t = ` ${text.toLowerCase()} `
  const all: RoomHit[] = p.floors.flatMap((f) => f.rooms.filter((r) => r.type !== 'void').map((room) => ({ floor: f, room })))
  const found: { hit: RoomHit | null; ambiguous: RoomHit[]; at: number; phrase: string; len: number }[] = []
  const taken: [number, number][] = []
  const phrases = new Map<string, RoomHit[]>()
  for (const h of all) for (const a of aliasesOf(h.room)) phrases.set(a, [...(phrases.get(a) ?? []), h])
  const sorted = [...phrases.keys()].sort((a, b) => b.length - a.length)
  for (const ph of sorted) {
    const re = new RegExp(`[^a-z0-9]${ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*(\\d+))?(?=[^a-z0-9])`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(t))) {
      const s = m.index + 1
      const e = s + m[0].length - 1
      if (taken.some(([a, b]) => s < b && e > a)) continue
      taken.push([s, e])
      let cands = phrases.get(ph)!
      const num = m[1] ? Number(m[1]) : null
      if (num !== null) {
        const byName = cands.filter((c) => new RegExp(`\\b${num}\\b`).test(c.room.name))
        if (byName.length) cands = byName
        else {
          const same = all.filter((c) => c.room.type === cands[0].room.type)
          const ordered = sortedFloors(p.floors).flatMap((f) => same.filter((c) => c.floor.id === f.id))
          if (ordered[num - 1]) cands = [ordered[num - 1]]
        }
      }
      // exact name beats type words; the active floor breaks ties
      const exact = cands.filter((c) => c.room.name.toLowerCase() === ph || c.room.name.toLowerCase() === `${ph} ${num ?? ''}`.trim())
      if (exact.length === 1) cands = exact
      if (cands.length > 1) {
        const master = cands.filter((c) => c.room.type === 'master_bedroom')
        if (ph.includes('master') && master.length === 1) cands = master
      }
      if (cands.length > 1) {
        const here = cands.filter((c) => c.floor.id === floorId)
        if (here.length === 1) cands = here
      }
      found.push({ hit: cands.length === 1 ? cands[0] : null, ambiguous: cands.length > 1 ? cands : [], at: s, phrase: ph + (num !== null ? ` ${num}` : ''), len: ph.length })
    }
  }
  return found.sort((a, b) => a.at - b.at)
}

function findRoomRef(p: Project, ref: string | null, floorId: string): RoomHit | null {
  if (!ref) return null
  for (const f of p.floors) {
    const r = f.rooms.find((x) => x.id === ref)
    if (r) return { floor: f, room: r }
  }
  if (/\b(this|selected|current) room\b|^this$/i.test(ref)) {
    const sel = useUI.getState().selection[0]
    if (sel?.kind === 'room') {
      const f = p.floors.find((x) => x.id === sel.floorId)
      const r = f?.rooms.find((x) => x.id === sel.id)
      if (f && r) return { floor: f, room: r }
    }
  }
  const m = roomMentions(ref, p, floorId)
  return m[0]?.hit ?? m[0]?.ambiguous[0] ?? null
}

function typeFromText(t: string): RoomType | null {
  const s = ` ${t.toLowerCase()} `
  let best: { type: RoomType; len: number } | null = null
  for (const [type, sp] of Object.entries(ROOM_SPECS) as [RoomType, (typeof ROOM_SPECS)[RoomType]][]) {
    for (const w of [sp.label.toLowerCase(), ...sp.words]) {
      if (w === 'room' || w.length < 3) continue
      if (s.includes(` ${w} `) || s.includes(` ${w}s `) || s.includes(` ${w},`) || s.includes(` ${w}.`)) if (!best || w.length > best.len) best = { type, len: w.length }
    }
  }
  return best?.type ?? null
}

/* ── amounts ─────────────────────────────────────────────────────────────── */

function parseAmount(t: string): { amount: number; unit: EditOp['unit'] } | null {
  const m = t.match(/(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half)\s*(feet|foot|ft|'|inches|inch|in\b|"|meters?|metres?|m\b|cm|centimet(?:er|re)s?|%|percent|per cent)/i)
  if (!m) return null
  const n = NUM_WORDS[m[1].toLowerCase()] ?? Number(m[1])
  const u = m[2].toLowerCase()
  const unit: EditOp['unit'] = /^(feet|foot|ft|')$/.test(u) ? 'ft' : /^(inches|inch|in|")$/.test(u) ? 'in' : /^(meters?|metres?|m)$/.test(u) ? 'm' : /^(cm|centim)/.test(u) ? 'cm' : 'percent'
  return { amount: n, unit }
}

const toMeters = (a: number, u: EditOp['unit']) => (u === 'm' ? a : u === 'cm' ? a / 100 : u === 'in' ? a * 0.0254 : a * FT)

function countIn(t: string): number | null {
  const m = t.match(/(\d+|one|two|three|four|five|six)\s*(?:cars?|vehicles?)/i)
  if (!m) return null
  return NUM_WORDS[m[1].toLowerCase()] ?? Number(m[1])
}

/* ── offline parser ──────────────────────────────────────────────────────── */

const MATERIAL_WORDS: [RegExp, string][] = [
  [/\b(stone|stone cladding|sandstone|ledge ?stone)\b/, 'stone'],
  [/\b(brick|bricks|gutka|exposed brick)\b/, 'brick'],
  [/\bmarble\b/, 'marble'],
  [/\b(wood|wooden|timber|teak|oak|walnut)\b/, 'wood'],
  [/\b(concrete|exposed concrete|cement)\b/, 'concrete'],
  [/\bgranite\b/, 'granite'],
  [/\b(tiles?|porcelain|ceramic)\b/, 'tiles'],
  [/\b(white|off-white|paint|painted)\b/, 'paint'],
  [/\b(grey|gray|charcoal|dark)\b/, 'grey'],
  [/\b(metal|steel|aluminium|aluminum)\b/, 'metal'],
  [/\b(carpet)\b/, 'carpet']
]

const STYLES: ArchitecturalStyle[] = ['modern', 'contemporary', 'minimalist', 'traditional', 'luxury', 'islamic', 'mediterranean', 'european', 'colonial', 'industrial', 'farmhouse']

export function parseEditOffline(text: string, p: Project, floorId: string): EditPlan {
  const ops: EditOp[] = []
  const clauses = text
    .replace(/\s+/g, ' ')
    .split(/(?:[.;!?]\s+|\n|,\s*(?:and\s+)?(?=(?:make|add|move|swap|remove|delete|change|increase|reduce|use|put|turn|convert|rename|set|give|also)\b)|\band then\b|\bthen\b|\balso\b)/i)
    .map((c) => c.trim())
    .filter(Boolean)
  const all = text.toLowerCase()
  const ref0 = (m: { hit: RoomHit | null; phrase: string }) => m.hit?.room.id ?? m.phrase
  for (const clause of clauses) {
    const c = clause.toLowerCase()
    const rooms = roomMentions(c, p, floorId)
    const amt = parseAmount(c)
    const grow = /\b(larger|bigger|wider|longer|increase|expand|extend|enlarge|grow|more space|spacious|taller|higher|raise)\b/.test(c)
    const shrink = /\b(smaller|narrower|shorter|reduce|decrease|shrink|lower|less)\b/.test(c)
    const addVerb = /\b(add|include|put|build|create|want|need|give me|with)\b/.test(c)

    // questions → answers from the model
    if (/^(what|how|which|where|is|are|does|do|can|why|tell me|show me)\b/.test(c) || /\?\s*$/.test(clause)) {
      ops.push(op({ op: 'answer', value: clause }))
      continue
    }
    if (/\b(improve|fix|optimi[sz]e|clean up|tidy)\b.*\b(layout|plan|design|house|access|problems?|issues?)\b|^improve layout$/.test(c)) {
      ops.push(op({ op: 'improve_layout' }))
      continue
    }
    if (/\bbasement\b/.test(c) && addVerb) {
      ops.push(op({ op: 'add_basement' }))
      continue
    }
    if (/\b(add|another|extra|one more)\b.*\b(floor|storey|story)\b/.test(c) && !rooms.length) {
      ops.push(op({ op: 'add_floor' }))
      continue
    }
    // parking / garage
    if (/\b(garage|parking|car porch|carport|cars?)\b/.test(c) && !/\b(floor|wall)s?\b.*\b(marble|tile|stone)/.test(c)) {
      const n = countIn(c)
      if (n) {
        ops.push(op({ op: 'set_garage_cars', amount: n, unit: 'count' }))
        continue
      }
      if (/\b(more|add|another|extra|bigger|larger)\b/.test(c)) {
        const cur = p.floors.flatMap((f) => f.rooms).filter((r) => r.type === 'garage').reduce((s, r) => s + (r.garage?.cars ?? Math.max(1, Math.floor(bbox(r.polygon).w / 2.9))), 0)
        ops.push(op({ op: 'set_garage_cars', amount: cur + 1, unit: 'count' }))
        continue
      }
    }
    // outdoor areas
    const siteKind: SiteAreaKind | null = /\b(swimming )?pool\b/.test(c) ? 'pool' : /\bpatio\b/.test(c) ? 'patio' : /\b(lawn|garden|grass)\b/.test(c) && !/rooftop|roof garden/.test(c) ? 'lawn' : /\bdriveway\b/.test(c) ? 'driveway' : /\bdeck\b/.test(c) && !rooms.length ? 'deck' : /\b(play ?area|playground|kids area)\b/.test(c) ? 'play_area' : /\b(bbq|barbecue|barbeque)\b/.test(c) ? 'bbq_area' : /\b(flower bed|garden bed|planting)\b/.test(c) ? 'garden_bed' : null
    if (siteKind && !rooms.some((r) => r.hit && !spec(r.hit.room.type).outdoor)) {
      const exists = p.site.areas.some((a) => a.kind === siteKind)
      if (/\b(remove|delete|no|without|get rid of)\b/.test(c)) ops.push(op({ op: 'scale_site_area', target: siteKind, amount: -100, unit: 'percent' }))
      else if (grow || shrink) ops.push(op({ op: 'scale_site_area', target: siteKind, amount: (amt?.unit === 'percent' ? amt.amount : 30) * (shrink && !grow ? -1 : 1), unit: 'percent' }))
      else if (!exists || /\b(add|another|new|put|build)\b/.test(c)) ops.push(op({ op: 'add_site_area', target: siteKind }))
      continue
    }
    // ceiling / floor height
    if (/\b(ceiling|ceilings|floor height|storey height|height of the (house|floors?))\b/.test(c)) {
      const target = /\b(ground|first|second|third|basement)\b/.exec(c)?.[1] ?? null
      if (/\bto\b/.test(c) && amt && amt.unit !== 'percent') ops.push(op({ op: 'set_floor_height', target, amount: amt.amount, unit: amt.unit }))
      else ops.push(op({ op: 'adjust_floor_height', target, amount: (amt && amt.unit !== 'percent' ? amt.amount : 1) * (shrink && !grow ? -1 : 1), unit: amt?.unit ?? 'ft' }))
      continue
    }
    // roof
    const roof = c.match(/\b(flat|hip|hipped|gable|gabled|pitched|sloped|sloping|shed|mono-?pitch|mansard)\s+roof/)
    if (roof) {
      const v = roof[1].startsWith('hip') ? 'hip' : roof[1].startsWith('gable') || roof[1] === 'pitched' || roof[1].startsWith('slop') ? 'gable' : roof[1].startsWith('shed') || roof[1].startsWith('mono') ? 'shed' : roof[1]
      ops.push(op({ op: 'set_roof', value: v }))
    }
    // exterior style
    const style = STYLES.find((s) => new RegExp(`\\b${s}\\b`).test(c))
    if (style && /\b(style|look|elevation|exterior|facade|façade|front|house|design|more|make it|make the)\b/.test(c) && !rooms.some((r) => r.hit)) ops.push(op({ op: 'set_style', value: style }))
    // windows
    if (/\bwindows?\b/.test(c)) {
      if (/\b(add|another|extra|new|more)\b.*\bwindow\b/.test(c) && rooms.length) ops.push(op({ op: 'add_window', target: rooms[0].hit?.room.id ?? rooms[0].phrase }))
      else if (/\b(large|larger|bigger|big|wider|floor[- ]to[- ]ceiling|full[- ]height|more glass|glass)\b/.test(c)) ops.push(op({ op: 'set_window_scale', amount: amt?.unit === 'percent' ? 1 + amt.amount / 100 : /floor[- ]to[- ]ceiling|full[- ]height/.test(c) ? 1.45 : 1.3 }))
      else if (/\b(smaller|narrower|reduce)\b/.test(c)) ops.push(op({ op: 'set_window_scale', amount: amt?.unit === 'percent' ? 1 - amt.amount / 100 : 0.8 }))
    }
    // exterior lighting
    if (/\blight(s|ing)?\b/.test(c) && /\b(vertical|strip|facade|façade|wash|garden|gate|exterior|outdoor|outside|elevation|front)\b/.test(c) && !rooms.some((r) => r.hit)) {
      const v = /vertical|strip/.test(c) ? 'vertical' : /facade|façade|wash|elevation|front/.test(c) ? 'wash' : /garden/.test(c) ? 'garden' : /gate/.test(c) ? 'gate' : 'all'
      ops.push(op({ op: 'add_exterior_lighting', value: v }))
    }
    // materials
    const mat = MATERIAL_WORDS.find(([re]) => re.test(c))?.[1]
    // "TV wall → stone", "feature wall in stone": the wall behind the TV / sofa of a lounge
    if (mat && /\b(tv|feature|accent)\s+wall\b/.test(c)) {
      const lounge = rooms.find((m) => m.hit && ['tv_lounge', 'living', 'family', 'drawing', 'basement_lounge', 'master_bedroom', 'bedroom'].includes(m.hit.room.type))
      ops.push(op({ op: 'set_room_material', target: lounge ? ref0(lounge) : 'tv lounge', value: `tvwall:${mat}` }))
      continue
    }
    const surface = /\b(floor|floors|flooring)\b/.test(c) ? 'floor' : /\bwalls?\b/.test(c) ? 'walls' : /\bceiling\b/.test(c) ? 'ceiling' : null
    if (mat && /\b(this|my|uploaded|the one i)\b/.test(c) && rooms.some((r) => r.hit || r.ambiguous.length)) {
      ops.push(op({ op: 'apply_uploaded_material', target: rooms[0].hit?.room.id ?? rooms[0].phrase, value: surface ?? 'floor' }))
      continue
    }
    if (mat && (surface || rooms.some((r) => r.hit)) && rooms.length && !/\b(exterior|facade|façade|elevation|outside)\b/.test(c)) {
      ops.push(op({ op: 'set_room_material', target: rooms[0].hit?.room.id ?? rooms[0].phrase, value: `${surface ?? 'floor'}:${mat}` }))
      continue
    }
    if (mat && /\b(exterior|facade|façade|elevation|outside|cladding|front|house|boundary)\b/.test(c)) {
      const target = /\b(cladding|feature|accent)\b/.test(c) ? 'accent' : /\bboundary\b/.test(c) ? 'boundary' : /\bplinth\b/.test(c) ? 'plinth' : 'facade'
      ops.push(op({ op: 'set_exterior_material', target, value: mat }))
      continue
    }
    if (ops.length && (style || roof || /\bwindows?\b|\blight/.test(c))) continue
    // room operations
    const r0 = rooms[0]
    const r1 = rooms[1]
    const ref = (m?: (typeof rooms)[number]) => (m ? (m.hit?.room.id ?? m.phrase) : null)
    if (/\b(swap|switch|exchange)\b/.test(c) && r0 && r1) {
      ops.push(op({ op: 'swap_rooms', target: ref(r0), other: ref(r1) }))
      continue
    }
    if (/\b(move|shift|bring|relocate|put)\b/.test(c) && /\b(closer|near|next to|beside|adjacent|towards?)\b/.test(c) && r0 && r1) {
      ops.push(op({ op: 'move_room_near', target: ref(r0), other: ref(r1) }))
      continue
    }
    const newType = /\b(add|another|extra|new|attach|include)\b/.test(c) ? typeFromText(c.replace(/\b(beside|next to|near|adjacent to|attached to|to|for|in|with)\b.*$/, '')) : null
    if (newType && /\b(add|another|extra|new|include)\b/.test(c)) {
      const besideM = c.match(/\b(beside|next to|near|adjacent to|attached to|with|to|for|in)\b(.*)$/)
      const neighbour = besideM ? roomMentions(besideM[2], p, floorId)[0] : undefined
      if (neighbour) ops.push(op({ op: 'add_room_beside', value: newType, other: ref(neighbour) }))
      else ops.push(op({ op: 'add_room', value: newType }))
      continue
    }
    if (/\b(remove|delete|get rid of|demolish)\b/.test(c) && r0) {
      ops.push(op({ op: 'remove_room', target: ref(r0) }))
      continue
    }
    const rename = clause.match(/\b(?:rename|call|name)\b\s+(?:the\s+)?(.+?)\s+(?:to|as)\s+["“']?([^"”']+)["”']?$/i)
    if (rename && r0) {
      ops.push(op({ op: 'rename_room', target: ref(r0), value: rename[2].trim() }))
      continue
    }
    const conv = c.match(/\b(make|turn|convert|change|use)\b.*\b(into|to|as)\b\s+(?:a|an)?\s*(.+)$/)
    if (conv && r0 && !grow && !shrink) {
      const t = typeFromText(conv[3])
      if (t && t !== r0.hit?.room.type) {
        ops.push(op({ op: 'change_room_type', target: ref(r0), value: t }))
        continue
      }
    }
    const dims = c.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|')?\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)\s*(ft|feet|'|m|meters?|metres?)?/)
    if (dims && r0) {
      const unit = dims[3] && /^m/.test(dims[3]) ? 'm' : 'ft'
      ops.push(op({ op: 'set_room_size', target: ref(r0), axis: 'both', value: `${dims[1]}x${dims[2]}`, unit }))
      continue
    }
    if ((grow || shrink) && r0) {
      const axis: EditOp['axis'] = /\b(wider|narrower|width|widen)\b/.test(c) ? 'width' : /\b(longer|shorter|length|deeper|depth)\b/.test(c) ? 'length' : 'both'
      let a = amt?.amount ?? (amt ? 0 : axis === 'both' ? 1.5 : 2)
      let unit = amt?.unit ?? 'ft'
      if (unit === 'percent') {
        const b = r0.hit ? bbox(r0.hit.room.polygon) : { w: 4, h: 4 }
        a = ((axis === 'length' ? b.h : b.w) * a) / 100
        unit = 'm'
      }
      ops.push(op({ op: 'resize_room', target: ref(r0), amount: a * (shrink && !grow ? -1 : 1), unit, axis }))
      continue
    }
    // requirement-level changes ("5 bedrooms", "more bedrooms")
    const bed = c.match(/(\d+|one|two|three|four|five|six|seven)\s+bed(room)?s?\b/)
    if (bed || /\b(more|extra|another)\s+bedrooms?\b/.test(c)) {
      const cur = p.requirements.rooms.bedrooms
      const n = bed ? (NUM_WORDS[bed[1]] ?? Number(bed[1])) : cur + 1
      ops.push(op({ op: 'set_requirement', value: `rooms.bedrooms=${n}` }), op({ op: 'regenerate' }))
      continue
    }
  }
  const reply = ops.length ? describeOps(ops, p, floorId) : "I couldn't turn that into a change. Try: “Make the master bedroom 2 feet wider”, “Add a bathroom beside bedroom 3”, “Make the garage large enough for 3 cars” or “Change the exterior to stone”."
  void all
  return { operations: dedupe(ops), reply, source: 'offline' }
}

function dedupe(ops: EditOp[]) {
  const seen = new Set<string>()
  return ops.filter((o) => {
    const k = JSON.stringify(o)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function describeOps(ops: EditOp[], p: Project, floorId: string): string {
  const name = (ref: string | null) => findRoomRef(p, ref, floorId)?.room.name ?? ref ?? 'the room'
  return ops
    .map((o) => {
      switch (o.op) {
        case 'resize_room':
          return `${(o.amount ?? 0) >= 0 ? 'Enlarge' : 'Reduce'} ${name(o.target)}`
        case 'set_room_size':
          return `Resize ${name(o.target)} to ${o.value}`
        case 'move_room_near':
          return `Move ${name(o.target)} next to ${name(o.other)}`
        case 'swap_rooms':
          return `Swap ${name(o.target)} and ${name(o.other)}`
        case 'add_room_beside':
          return `Add a ${spec(o.value as RoomType).label.toLowerCase()} beside ${name(o.other)}`
        case 'add_room':
          return `Add a ${spec(o.value as RoomType).label.toLowerCase()}`
        case 'remove_room':
          return `Remove ${name(o.target)}`
        case 'set_garage_cars':
          return `Fit ${o.amount} cars in the garage`
        case 'adjust_floor_height':
          return `${(o.amount ?? 0) >= 0 ? 'Raise' : 'Lower'} the ceilings`
        case 'set_floor_height':
          return `Set the ceiling height`
        case 'scale_site_area':
          return (o.amount ?? 0) <= -100 ? `Remove the ${o.target}` : `${(o.amount ?? 0) > 0 ? 'Enlarge' : 'Reduce'} the ${o.target}`
        case 'add_site_area':
          return `Add a ${String(o.target).replace('_', ' ')}`
        case 'set_exterior_material':
          return `Use ${o.value} on the ${o.target === 'accent' ? 'facade cladding' : o.target ?? 'facade'}`
        case 'set_room_material':
          return `Use ${String(o.value).split(':')[1]} on the ${name(o.target)} ${String(o.value).split(':')[0]}`
        case 'apply_uploaded_material':
          return `Apply your uploaded material to the ${name(o.target)} ${o.value}`
        case 'set_style':
          return `Switch the exterior to ${o.value} style`
        case 'set_roof':
          return `Change to a ${o.value} roof`
        case 'set_window_scale':
          return (o.amount ?? 1) >= 1 ? 'Make the windows larger' : 'Make the windows smaller'
        case 'add_window':
          return `Add a window to ${name(o.target)}`
        case 'add_exterior_lighting':
          return 'Add exterior lighting'
        case 'improve_layout':
          return 'Fix layout problems'
        case 'add_basement':
          return 'Add a basement'
        case 'add_floor':
          return 'Add a floor'
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('. ')
}

/* ── context for Claude ──────────────────────────────────────────────────── */

export function summarizeForAi(p: Project): string {
  const ft = (m: number) => Math.round((m / FT) * 10) / 10
  return JSON.stringify({
    plot: { widthFt: ft(p.plot.width), depthFt: ft(p.plot.depth), road: p.plot.roadSide },
    floors: sortedFloors(p.floors).map((f) => ({
      id: f.id,
      name: f.name,
      heightFt: ft(f.height),
      rooms: f.rooms.filter((r) => r.type !== 'void').map((r) => {
        const b = bbox(r.polygon)
        return { id: r.id, name: r.name, type: r.type, widthFt: ft(b.w), lengthFt: ft(b.h), areaSqft: Math.round(area(r.polygon) / (FT * FT)), garageCars: r.garage?.cars }
      })
    })),
    site: p.site.areas.map((a) => ({ id: a.id, kind: a.kind, areaSqft: Math.round(area(a.polygon) / (FT * FT)) })),
    exterior: { style: p.exterior.style, roof: p.exterior.roofType, facade: p.exterior.facadeMaterial, accent: p.exterior.accentMaterial },
    uploadedMaterials: p.materials.filter((m) => m.source === 'upload').map((m) => ({ id: m.id, name: m.name, type: m.category })),
    selected: useUI.getState().selection[0] ?? null
  })
}

/** Text → plan: Claude when the user enabled it (with offline fallback), otherwise offline rules. */
export async function planEdit(text: string): Promise<EditPlan> {
  const p = getProject()
  const floorId = useUI.getState().floorId
  let useClaude = false
  try {
    const s = await platform.settings.get()
    useClaude = s.aiProvider === 'claude' && s.hasApiKey
  } catch {
    useClaude = false
  }
  if (useClaude) {
    const r = await platform.ai({ task: 'edit', text, context: summarizeForAi(p) })
    const data = r.data as { operations?: EditOp[]; reply?: string } | undefined
    if (r.ok && data && Array.isArray(data.operations)) {
      const ops = data.operations.filter((o) => (EDIT_OPS as readonly string[]).includes(o.op))
      return { operations: ops, reply: data.reply ?? describeOps(ops, p, floorId), source: 'claude' }
    }
    const off = parseEditOffline(text, p, floorId)
    off.reply = `${r.error ? `${r.error} ` : ''}${off.reply}`
    return off
  }
  return parseEditOffline(text, p, floorId)
}

/* ── executor ────────────────────────────────────────────────────────────── */

const LIB_FOR: Record<string, { facade: string; accent: string; floor: string; walls: string }> = {
  stone: { facade: 'lib:stone-sandstone', accent: 'lib:stone-ledgestone', floor: 'lib:stone-travertine', walls: 'lib:stone-ledgestone' },
  brick: { facade: 'lib:brick-gutka', accent: 'lib:brick-red', floor: 'lib:pavers-red', walls: 'lib:brick-white' },
  marble: { facade: 'lib:marble-botticino', accent: 'lib:marble-sunny-grey', floor: 'lib:marble-botticino', walls: 'lib:marble-carrara' },
  wood: { facade: 'lib:wood-teak', accent: 'lib:wood-teak', floor: 'lib:wood-oak', walls: 'lib:wood-walnut' },
  concrete: { facade: 'lib:concrete-board', accent: 'lib:concrete-board', floor: 'lib:concrete-polished', walls: 'lib:concrete-smooth' },
  granite: { facade: 'lib:granite-grey-sardo', accent: 'lib:granite-absolute-black', floor: 'lib:granite-tan-brown', walls: 'lib:granite-grey-sardo' },
  tiles: { facade: 'lib:porcelain-concrete-grey', accent: 'lib:porcelain-black-matte', floor: 'lib:porcelain-ivory', walls: 'lib:ceramic-white-gloss' },
  paint: { facade: 'lib:render-white', accent: 'lib:render-graphite', floor: 'lib:porcelain-ivory', walls: 'lib:paint-warm-white' },
  grey: { facade: 'lib:render-graphite', accent: 'lib:render-graphite', floor: 'lib:porcelain-concrete-grey', walls: 'lib:paint-light-grey' },
  metal: { facade: 'lib:metal-aluminum', accent: 'lib:metal-corten', floor: 'lib:concrete-polished', walls: 'lib:metal-brushed' },
  carpet: { facade: 'lib:render-white', accent: 'lib:render-graphite', floor: 'lib:fabric-carpet-charcoal', walls: 'lib:paint-warm-white' }
}

const matId = (v: string, slot: 'facade' | 'accent' | 'floor' | 'walls') => (v.startsWith('lib:') || v.startsWith('upl:') || v.startsWith('cus:') ? v : (LIB_FOR[v] ?? LIB_FOR.paint)[slot])

interface Snap {
  name: string
  area: number
  c: Vec2
  w: number
  h: number
}

function snapshotRooms(p: Project): Map<string, Snap> {
  const m = new Map<string, Snap>()
  for (const f of p.floors)
    for (const r of f.rooms) {
      const b = bbox(r.polygon)
      m.set(r.id, { name: r.name, area: area(r.polygon), c: centroid(r.polygon), w: b.w, h: b.h })
    }
  return m
}

class EditError extends Error {}

export async function applyEditPlan(plan: EditPlan, label: string): Promise<EditResult> {
  const p0 = getProject()
  const floorId = useUI.getState().floorId
  const before = snapshotRooms(p0)
  const changes: string[] = []
  const errors: string[] = []
  let regenerate: Requirements | undefined
  let answer: string | null = null
  let choices: string[] | undefined
  // ambiguity check before touching the model
  for (const o of plan.operations) {
    for (const ref of [o.target, o.other]) {
      if (!ref || ['add_site_area', 'scale_site_area', 'set_exterior_material', 'set_floor_height', 'adjust_floor_height', 'set_style', 'set_roof', 'add_exterior_lighting', 'set_window_scale'].includes(o.op)) continue
      if (p0.floors.some((f) => f.rooms.some((r) => r.id === ref))) continue
      const m = roomMentions(ref, p0, floorId)[0]
      if (m && !m.hit && m.ambiguous.length > 1) {
        choices = m.ambiguous.map((h) => `${h.room.name} (${h.floor.name.toLowerCase()} floor)`)
        return { ok: false, message: `Which one do you mean: ${m.ambiguous.map((h) => h.room.name).join(', ')}? Say it again with the room's name, for example "${m.ambiguous[1].room.name}".`, changes: [], moved: [], areaChanges: [], choices }
      }
    }
  }
  const immediate = plan.operations.filter((o) => !['set_requirement', 'regenerate', 'add_floor', 'add_basement', 'answer'].includes(o.op))
  for (const o of plan.operations) {
    if (o.op === 'answer') answer = answerQuestion(o.value ?? '', p0, floorId)
    if (o.op === 'set_requirement' || o.op === 'add_floor' || o.op === 'add_basement') {
      const req = structuredClone(regenerate ?? p0.requirements)
      if (o.op === 'add_basement') req.special.basement = true
      if (o.op === 'add_floor') req.floors = req.floors === 'single' ? 'double' : req.floors === 'double' ? 'triple' : req.floors === 'basement+ground' ? 'basement+ground+first' : req.floors === 'basement+ground+first' ? 'basement+ground+first+second' : req.floors
      if (o.op === 'set_requirement' && o.value?.includes('=')) setPath(req as unknown as Record<string, unknown>, o.value.split('=')[0].trim(), o.value.split('=')[1].trim())
      regenerate = req
    }
  }
  if (immediate.length) {
    try {
      commit(label, (d) => {
        for (const o of immediate) {
          try {
            const msg = execute(d as unknown as Project, o, floorId)
            if (msg) changes.push(msg)
          } catch (e) {
            if (e instanceof EditError) errors.push(e.message)
            else throw e
          }
        }
        applySmartLabels(d as unknown as Project)
      }, { major: true })
    } catch (e) {
      return { ok: false, message: `That change could not be made: ${(e as Error).message}. Nothing was changed.`, changes: [], moved: [], areaChanges: [] }
    }
  }
  const p1 = getProject()
  const after = snapshotRooms(p1)
  const moved: string[] = []
  const areaChanges: EditResult['areaChanges'] = []
  const u = p1.settings.units
  for (const [id, a] of after) {
    const b = before.get(id)
    if (!b) {
      changes.push(`New room: ${a.name}, ${formatLength(a.w, u)} × ${formatLength(a.h, u)} (${formatAreaFor(a.area, u)})`)
      continue
    }
    if (Math.abs(a.area - b.area) > 0.05) areaChanges.push({ name: a.name, before: b.area, after: a.area })
    else if (Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) > 0.3) moved.push(a.name)
  }
  for (const [id, b] of before) if (!after.has(id)) changes.push(`Removed: ${b.name}`)
  const lines: string[] = []
  if (answer) lines.push(answer)
  if (changes.length) lines.push(...changes)
  if (errors.length) lines.push(...errors.map((e) => `Not done: ${e}`))
  if (regenerate) lines.push('This needs a new layout, because the rooms have to be re-planned. Choose "Regenerate" to create it; your finishes are kept and the current plan is saved as a version.')
  const ok = changes.length > 0 || !!answer || !!regenerate || areaChanges.length > 0
  return {
    ok: ok && !(errors.length && !changes.length && !areaChanges.length),
    message: lines.join('\n') || (errors.length ? errors.join('\n') : plan.reply),
    changes,
    moved,
    areaChanges,
    regenerate
  }
}

function setPath(o: Record<string, unknown>, path: string, raw: string) {
  const keys = path.split('.')
  let cur: Record<string, unknown> = o
  for (const k of keys.slice(0, -1)) {
    if (typeof cur[k] !== 'object' || cur[k] === null) return
    cur = cur[k] as Record<string, unknown>
  }
  const last = keys[keys.length - 1]
  const prev = cur[last]
  cur[last] = typeof prev === 'number' ? Number(raw) : typeof prev === 'boolean' ? raw === 'true' || raw === 'yes' : raw
}

function mustRoom(p: Project, ref: string | null, floorId: string): RoomHit {
  const h = findRoomRef(p, ref, floorId)
  if (!h) throw new EditError(`I couldn't find "${ref ?? 'that room'}" in this house.`)
  return h
}

/** Executes one operation on a draft project. Returns a sentence describing the change. */
function execute(d: Project, o: EditOp, floorId: string): string | null {
  const s = d.settings
  const u = s.units
  switch (o.op) {
    case 'resize_room': {
      const { floor, room } = mustRoom(d, o.target, floorId)
      const delta = toMeters(o.amount ?? 0, o.unit)
      const b = bbox(room.polygon)
      const axes: ('x' | 'y')[] = o.axis === 'length' ? ['y'] : o.axis === 'width' ? ['x'] : ['x', 'y']
      for (const ax of axes) {
        const cur = ax === 'x' ? b.w : b.h
        const target = Math.max(spec(room.type).minWidth * 0.8, cur + delta)
        const res = setRoomSize(floor, room.id, ax, target, s)
        if (res && typeof res === 'object' && 'ok' in res && !(res as { ok: boolean }).ok) throw new EditError(`${room.name} can't grow that way: ${(res as { reason?: string }).reason ?? 'the plot edge or stairs are in the way'}.`)
      }
      const nb = bbox(floor.rooms.find((r) => r.id === room.id)!.polygon)
      refurnishRoom(floor, room.id, d.requirements.preferences.luxury)
      return `${room.name} is now ${formatLength(nb.w, u)} × ${formatLength(nb.h, u)}`
    }
    case 'set_room_size': {
      const { floor, room } = mustRoom(d, o.target, floorId)
      const [w, l] = (o.value ?? '').split(/x|×/).map(Number)
      const conv = (v: number) => (o.unit === 'm' ? v : v * FT)
      if (w) setRoomSize(floor, room.id, 'x', conv(w), s)
      if (l) setRoomSize(floor, room.id, 'y', conv(l), s)
      if (!w && o.amount) setRoomSize(floor, room.id, o.axis === 'length' ? 'y' : 'x', toMeters(o.amount, o.unit), s)
      refurnishRoom(floor, room.id, d.requirements.preferences.luxury)
      const nb = bbox(floor.rooms.find((r) => r.id === room.id)!.polygon)
      return `${room.name} is now ${formatLength(nb.w, u)} × ${formatLength(nb.h, u)}`
    }
    case 'swap_rooms': {
      const a = mustRoom(d, o.target, floorId)
      const b = mustRoom(d, o.other, floorId)
      if (a.floor.id !== b.floor.id) throw new EditError(`${a.room.name} and ${b.room.name} are on different floors.`)
      if (!swapRooms(a.floor, a.room.id, b.room.id, s)) throw new EditError(`${a.room.name} and ${b.room.name} could not be swapped.`)
      refurnishRoom(a.floor, a.room.id, d.requirements.preferences.luxury)
      refurnishRoom(a.floor, b.room.id, d.requirements.preferences.luxury)
      return `${a.room.name} and ${b.room.name} swapped places`
    }
    case 'move_room_near': {
      const a = mustRoom(d, o.target, floorId)
      const b = mustRoom(d, o.other, floorId)
      if (a.floor.id !== b.floor.id) throw new EditError(`${a.room.name} and ${b.room.name} are on different floors; move it with the plan editor instead.`)
      const f = a.floor
      if (sharedWalls(f, a.room, b.room).length) return `${a.room.name} already shares a wall with ${b.room.name}`
      const aArea = area(a.room.polygon)
      const cands = f.rooms
        .filter((r) => r.id !== a.room.id && r.id !== b.room.id && sharedWalls(f, r, b.room).length && !['stair', 'lift', 'corridor', 'foyer', 'void', 'garage'].includes(r.type) && !spec(r.type).outdoor)
        .sort((x, y) => Math.abs(area(x.polygon) - aArea) - Math.abs(area(y.polygon) - aArea))
      const pick = cands[0]
      if (!pick) throw new EditError(`there is no room next to ${b.room.name} that ${a.room.name} can trade places with.`)
      const ratio = area(pick.polygon) / aArea
      if (ratio < 0.45 || ratio > 2.2) throw new EditError(`the rooms next to ${b.room.name} are too different in size to trade with ${a.room.name}.`)
      swapRooms(f, a.room.id, pick.id, s)
      refurnishRoom(f, a.room.id, d.requirements.preferences.luxury)
      refurnishRoom(f, pick.id, d.requirements.preferences.luxury)
      return `${a.room.name} moved next to ${b.room.name} (it traded places with ${pick.name})`
    }
    case 'add_room_beside':
    case 'add_room': {
      const type = (o.value as RoomType) ?? 'store'
      let host: RoomHit | null = o.other ? mustRoom(d, o.other, floorId) : null
      const need = Math.max(spec(type).minWidth, isBathType(type) ? 1.6 : 2.0)
      if (!host) {
        const f = d.floors.find((x) => x.id === floorId) ?? d.floors.find((x) => x.level === 0)!
        const hostType = (r: Room) => (isBathType(type) ? ['master_bedroom', 'bedroom', 'guest_bedroom'].includes(r.type) : ['tv_lounge', 'family', 'living', 'drawing', 'bedroom', 'master_bedroom', 'basement_lounge'].includes(r.type))
        const cands = f.rooms.filter(hostType).filter((r) => Math.max(bbox(r.polygon).w, bbox(r.polygon).h) - need >= spec(r.type).minWidth).sort((x, y) => area(y.polygon) - area(x.polygon))
        if (!cands[0]) {
          if (type === 'bedroom' || type === 'kitchen' || type === 'tv_lounge' || type === 'dining') throw new EditError(`a ${spec(type).label.toLowerCase()} needs a new layout; ask for "more bedrooms" to regenerate the plan.`)
          throw new EditError(`there is no room on this floor large enough to take a ${spec(type).label.toLowerCase()} from.`)
        }
        host = { floor: f, room: cands[0] }
      }
      const { floor, room } = host
      const b = bbox(room.polygon)
      const alongX = b.w >= b.h
      const long = alongX ? b.w : b.h
      if (long - need < spec(room.type).minWidth * 0.9) throw new EditError(`${room.name} is too small to give up ${formatLength(need, u)} for a ${spec(type).label.toLowerCase()}. Enlarge it first.`)
      const at = alongX ? b.x + b.w - need : b.y + b.h - need
      const nr = splitRoom(floor, room.id, alongX ? 'x' : 'y', at, s)
      if (!nr) throw new EditError(`${room.name} could not be split.`)
      nr.type = type
      nr.name = spec(type).label
      nr.autoName = true
      if (isBathType(type) && ['master_bedroom', 'bedroom', 'guest_bedroom', 'kids_room'].includes(room.type)) nr.parentId = room.id
      refreshFloor(floor, s)
      const fresh = floor.rooms.find((r) => r.id === nr.id)!
      const host2 = floor.rooms.find((r) => r.id === room.id)!
      if (!floor.openings.some((op2) => op2.kind === 'door' && sharedWalls(floor, fresh, host2).some((w) => w.wall.id === op2.wallId))) addDoor(floor, floor.openings, host2, fresh, 'single', isBathType(type) ? 0.76 : 0.9, uid, { swingInto: fresh })
      refurnishRoom(floor, host2.id, d.requirements.preferences.luxury)
      refurnishRoom(floor, fresh.id, d.requirements.preferences.luxury)
      const nb = bbox(fresh.polygon)
      return `Added ${spec(type).label.toLowerCase()} (${formatLength(nb.w, u)} × ${formatLength(nb.h, u)}) taken from ${room.name}`
    }
    case 'remove_room': {
      const { floor, room } = mustRoom(d, o.target, floorId)
      if (room.type === 'stair') throw new EditError('the staircase connects the floors and cannot be removed here.')
      const neighbours = floor.rooms
        .filter((r) => r.id !== room.id && r.type !== 'stair' && r.type !== 'void')
        .map((r) => ({ r, len: sharedWalls(floor, r, room).reduce((sum, w) => sum + (w.t1 - w.t0), 0) }))
        .filter((x) => x.len > 0.5)
        .sort((a, b) => b.len - a.len)
      if (neighbours[0]) {
        const merged = mergeRooms(floor, [neighbours[0].r.id, room.id], s)
        if (merged) {
          refurnishRoom(floor, merged.id, d.requirements.preferences.luxury)
          return `${room.name} removed; its space joined ${neighbours[0].r.name}`
        }
      }
      deleteRoom(floor, room.id, s)
      return `${room.name} removed`
    }
    case 'rename_room': {
      const { room } = mustRoom(d, o.target, floorId)
      const old = room.name
      room.name = o.value ?? room.name
      room.autoName = false
      return `${old} renamed to ${room.name}`
    }
    case 'change_room_type': {
      const { floor, room } = mustRoom(d, o.target, floorId)
      const t = o.value as RoomType
      if (!ROOM_SPECS[t]) throw new EditError(`"${o.value}" is not a room type I know.`)
      const old = room.name
      room.type = t
      room.autoName = true
      room.floorMaterial = undefined
      room.wallMaterial = undefined
      refreshFloor(floor, s)
      refurnishRoom(floor, room.id, d.requirements.preferences.luxury)
      return `${old} is now a ${spec(t).label.toLowerCase()}`
    }
    case 'set_garage_cars': {
      const cars = Math.max(1, Math.min(4, Math.round(o.amount ?? 2)))
      const hit = d.floors.flatMap((f) => f.rooms.filter((r) => r.type === 'garage').map((room) => ({ floor: f, room })))[0]
      if (!hit) throw new EditError('this house has no garage or car porch yet; add parking in the requirements and regenerate.')
      const { floor, room } = hit
      const need = cars * 2.75 + 0.3
      const b = bbox(room.polygon)
      if (b.w < need) {
        setRoomSize(floor, room.id, 'x', need, s)
        const nb = bbox(floor.rooms.find((r) => r.id === room.id)!.polygon)
        if (nb.w < need - 0.05) throw new EditError(`the plot only leaves room for a ${formatLength(nb.w, u)} wide garage, which fits ${Math.max(1, Math.floor(nb.w / 2.75))} cars.`)
      }
      if (b.h < 5.2) setRoomSize(floor, room.id, 'y', 5.4, s)
      const r = floor.rooms.find((x) => x.id === room.id)!
      r.garage = { cars, storage: r.garage?.storage ?? false, workshop: r.garage?.workshop ?? false, evCharger: r.garage?.evCharger ?? false }
      d.requirements.outdoor.cars = cars
      d.requirements.outdoor.garage = true
      refurnishRoom(floor, r.id, d.requirements.preferences.luxury)
      const nb = bbox(r.polygon)
      return `Garage now fits ${cars} cars (${formatLength(nb.w, u)} × ${formatLength(nb.h, u)})`
    }
    case 'set_floor_height':
    case 'adjust_floor_height': {
      const floors = o.target ? d.floors.filter((f) => f.name.toLowerCase().includes(o.target!.toLowerCase())) : d.floors.filter((f) => f.kind !== 'roof')
      if (!floors.length) throw new EditError(`there is no "${o.target}" floor.`)
      for (const f of floors) {
        const h = o.op === 'set_floor_height' ? toMeters(o.amount ?? 11, o.unit) + f.slabThickness : f.height + toMeters(o.amount ?? 1, o.unit)
        if (h < 2.6 || h > 6) throw new EditError(`a floor height of ${formatLength(h, u)} is outside the 8′6″ to 20′ range.`)
        setFloorHeight(d, f.id, h)
      }
      const f0 = floors[0]
      const nf = d.floors.find((x) => x.id === f0.id)!
      return `${floors.length > 1 ? 'Ceilings' : `${f0.name} ceiling`} now ${formatLength(nf.height - nf.slabThickness, u)} clear (floor to floor ${formatLength(nf.height, u)}); stairs were updated`
    }
    case 'scale_site_area': {
      const kind = (o.target ?? 'patio') as SiteAreaKind
      const areas = d.site.areas.filter((a) => a.kind === kind)
      if (!areas.length) {
        if ((o.amount ?? 0) > 0) return execute(d, op({ op: 'add_site_area', target: kind }), floorId)
        throw new EditError(`there is no ${kind.replace('_', ' ')} to change.`)
      }
      if ((o.amount ?? 0) <= -100) {
        const lawn = d.site.areas.find((a) => a.kind === 'lawn')
        d.site.areas = d.site.areas.filter((a) => a.kind !== kind)
        if (lawn && kind !== 'lawn') for (const a of areas) mergeIntoLawn(d, lawn, a)
        return `${kind.replace('_', ' ')} removed; the space went back to the lawn`
      }
      const factor = Math.sqrt(Math.max(0.2, 1 + (o.amount ?? 25) / 100))
      const a = areas.sort((x, y) => area(y.polygon) - area(x.polygon))[0]
      const beforeA = area(a.polygon)
      const next = grownArea(d, a, factor)
      if (!next) throw new EditError(`the ${kind.replace('_', ' ')} is already as large as the open space allows.`)
      a.polygon = next
      const lawn = d.site.areas.find((x) => x.kind === 'lawn' && x.id !== a.id)
      if (lawn && factor > 1) {
        const rest = differencePolys(lawn.polygon, next).sort((x, y) => area(y.outer) - area(x.outer))[0]
        if (rest) lawn.polygon = rest.outer
      }
      return `The ${kind.replace('_', ' ')} is now ${formatAreaFor(area(next), u)} (was ${formatAreaFor(beforeA, u)})`
    }
    case 'add_site_area': {
      const kind = (o.target ?? 'patio') as SiteAreaKind
      const size: Record<string, [number, number]> = { pool: [8, 4], patio: [4.5, 4], play_area: [4, 4], bbq_area: [3, 3], garden_bed: [4, 1.2], deck: [4, 3], lawn: [6, 5], driveway: [3, 6] }
      const [w, h] = size[kind] ?? [4, 4]
      const lawns = d.site.areas.filter((a) => a.kind === 'lawn').sort((x, y) => area(y.polygon) - area(x.polygon))
      if (!lawns.length) throw new EditError(`there is no open garden to place a ${kind.replace('_', ' ')} in.`)
      // the lawn whose largest clear rectangle is biggest; sizes shrink to fit down to a practical minimum
      const cand = lawns.map((l) => ({ l, R: largestInscribedRect(l.polygon, 0.2) })).sort((a, b) => Math.min(b.R.w, b.R.h) * Math.max(b.R.w, b.R.h) - Math.min(a.R.w, a.R.h) * Math.max(a.R.w, a.R.h))[0]
      const lawn = cand.l
      const R = cand.R
      const minW = kind === 'pool' ? 5 : w * 0.6
      const minH = kind === 'pool' ? 2.6 : h * 0.6
      const along = R.w >= R.h
      const pw = along ? Math.min(w, R.w - 0.6) : Math.min(h, R.w - 0.4)
      const ph = along ? Math.min(h, R.h - 0.4) : Math.min(w, R.h - 0.6)
      if (Math.max(pw, ph) < minW || Math.min(pw, ph) < minH) throw new EditError(`the largest open lawn is ${formatLength(R.w, u)} × ${formatLength(R.h, u)}; a ${kind.replace('_', ' ')} needs at least ${formatLength(minW, u)} × ${formatLength(minH, u)}.`)
      // try the corners of the clear rectangle so the lawn keeps a simple outline (no holes)
      const corners = [
        { x: R.x + (R.w - pw) / 2, y: R.y },
        { x: R.x, y: R.y },
        { x: R.x + R.w - pw, y: R.y },
        { x: R.x, y: R.y + R.h - ph },
        { x: R.x + R.w - pw, y: R.y + R.h - ph }
      ]
      let rect = { ...corners[0], w: pw, h: ph }
      let rest: ReturnType<typeof differencePolys> = []
      for (const c of corners) {
        const r = { ...c, w: pw, h: ph }
        const diff = differencePolys(lawn.polygon, rectPoly(r))
        if (diff.every((x) => !x.holes.length)) {
          rect = r
          rest = diff
          break
        }
      }
      if (!rest.length) {
        // open a slot from the pool to the lawn edge so no hole is left
        const lb = bbox(lawn.polygon)
        rest = differencePolys(lawn.polygon, rectPoly(rect), rectPoly({ x: rect.x + pw / 2 - 0.05, y: lb.y - 1, w: 0.1, h: rect.y - lb.y + 1 }))
      }
      const poly = rectPoly(rect)
      const area2: SiteArea = { id: uid('area'), kind, polygon: poly, name: kind === 'pool' ? 'Swimming Pool' : undefined, depth: kind === 'pool' ? 1.5 : undefined, material: kind === 'pool' ? 'lib:water-pool' : kind === 'patio' ? 'lib:porcelain-outdoor' : undefined }
      d.site.areas.push(area2)
      const pieces = rest.filter((x) => area(x.outer) > 0.5).sort((x, y) => area(y.outer) - area(x.outer))
      if (pieces[0]) lawn.polygon = pieces[0].outer
      for (const extra of pieces.slice(1)) d.site.areas.push({ id: uid('area'), kind: 'lawn', polygon: extra.outer, material: lawn.material })
      if (kind === 'pool') {
        d.requirements.outdoor.pool = true
        // a timber deck along the pool on whichever side has room
        const below = R.y + R.h - (rect.y + ph)
        const above = rect.y - R.y
        const dh = Math.min(1.5, Math.max(below, above))
        if (dh > 0.8) {
          const deck = rectPoly({ x: rect.x, y: below >= above ? rect.y + ph : rect.y - dh, w: pw, h: dh })
          const rest2 = differencePolys(lawn.polygon, deck).filter((x) => area(x.outer) > 0.5)
          if (rest2.length === 1 && !rest2[0].holes.length) {
            d.site.areas.push({ id: uid('area'), kind: 'deck', polygon: deck, material: 'lib:wood-deck' })
            lawn.polygon = rest2[0].outer
          }
        }
      }
      return `Added a ${kind === 'pool' ? 'swimming pool' : kind.replace('_', ' ')} (${formatLength(pw, u)} × ${formatLength(ph, u)}) in the garden`
    }
    case 'set_exterior_material': {
      const v = o.value ?? 'stone'
      const t = o.target ?? 'facade'
      if (t === 'accent') {
        d.exterior.accentMaterial = matId(v, 'accent')
        if (d.exterior.accent === 'none') d.exterior.accent = 'front-feature'
        return `Front feature cladding changed to ${v}`
      }
      if (t === 'boundary') {
        d.plot.boundaryWall.material = matId(v, 'facade')
        return `Boundary wall finish changed to ${v}`
      }
      if (t === 'plinth') {
        d.exterior.plinthMaterial = matId(v, 'accent')
        return `Plinth changed to ${v}`
      }
      d.exterior.facadeMaterial = matId(v, 'facade')
      return `Exterior walls changed to ${v}`
    }
    case 'set_room_material':
    case 'apply_uploaded_material': {
      if (o.op === 'set_room_material' && (o.value ?? '').startsWith('tvwall:')) {
        const hit = findRoomRef(d, o.target, floorId) ?? mustRoom(d, 'tv lounge', floorId)
        return tvWall(d, hit.floor, hit.room, matId(o.value!.split(':')[1] || 'stone', 'accent'))
      }
      const { room } = mustRoom(d, o.target, floorId)
      if (room.type === 'stair') {
        // "stairs → wood" means the staircase itself (treads and risers), on every floor it serves
        const id = o.op === 'apply_uploaded_material' ? ([...d.materials].reverse().find((x) => x.source === 'upload')?.id ?? '') : matId((o.value ?? 'floor:wood').split(':')[1] || 'wood', 'floor')
        if (!id) throw new EditError('there is no uploaded material yet.')
        let n = 0
        for (const f of d.floors)
          for (const st of f.stairs) {
            st.material = id
            n++
          }
        if (!n) throw new EditError('this house has no staircase.')
        return `Stairs now ${d.materials.find((x) => x.id === id)?.name ?? id.replace(/^lib:/, '').replace(/-/g, ' ')}`
      }
      const [surfRaw, m] = o.op === 'apply_uploaded_material' ? [o.value ?? 'floor', ''] : (o.value ?? 'floor:marble').split(':')
      const surf = surfRaw.startsWith('wall') ? 'walls' : surfRaw.startsWith('ceil') ? 'ceiling' : 'floor'
      let id: string
      if (o.op === 'apply_uploaded_material') {
        const up = [...d.materials].reverse().find((x) => x.source === 'upload')
        if (!up) throw new EditError('there is no uploaded material yet. Upload the photo in Materials mode first.')
        id = up.id
      } else id = matId(m || 'marble', surf === 'floor' ? 'floor' : 'walls')
      if (surf === 'floor') room.floorMaterial = id
      else if (surf === 'walls') room.wallMaterial = id
      else room.ceilingMaterial = id
      const name = d.materials.find((x) => x.id === id)?.name ?? id.replace(/^lib:/, '').replace(/-/g, ' ')
      return `${room.name} ${surf} now ${name}`
    }
    case 'set_style': {
      const style = (o.value ?? 'modern') as ArchitecturalStyle
      if (!STYLES.includes(style) && style !== 'pakistani_modern') throw new EditError(`"${o.value}" is not a style I know.`)
      const keep = { windowScale: d.exterior.windowScale }
      d.exterior = { ...exteriorForStyle(style), ...keep }
      d.requirements.style = style
      return `Exterior restyled as ${style.replace('_', ' ')}: facade, cladding, roof and lighting updated`
    }
    case 'set_roof': {
      const v = (o.value ?? 'flat') as RoofType
      if (!['flat', 'hip', 'gable', 'shed', 'mansard'].includes(v)) throw new EditError(`"${o.value}" is not a roof type I know.`)
      d.exterior.roofType = v
      if (v !== 'flat' && d.exterior.roofMaterial === 'lib:roof-membrane') d.exterior.roofMaterial = 'lib:roof-clay'
      return `Roof changed to ${v}`
    }
    case 'set_window_scale': {
      const k = Math.max(0.5, Math.min(2, o.amount ?? 1.3))
      const n = scaleWindows(d.floors, k)
      d.exterior.windowScale = Math.max(0.5, Math.min(2, d.exterior.windowScale * k))
      return `${n} windows made ${k >= 1 ? 'larger' : 'smaller'} (${Math.round(Math.abs(k - 1) * 100)}%)`
    }
    case 'add_window': {
      const { floor, room } = mustRoom(d, o.target, floorId)
      const w = addWindowToRoom(floor, room)
      if (!w) throw new EditError(`${room.name} has no free outside wall for another window.`)
      return `Added a ${formatLength(w.width, u)} window to ${room.name}`
    }
    case 'add_exterior_lighting': {
      const L = d.exterior.lighting
      const v = o.value ?? 'all'
      if (v === 'vertical' || v === 'all') L.verticalStrips = true
      if (v === 'wash' || v === 'all') L.facadeWash = true
      if (v === 'garden' || v === 'all') L.gardenLights = true
      if (v === 'gate' || v === 'all') L.gateLights = true
      d.settings.lighting.exteriorLights = true
      return `Exterior lighting added (${v === 'all' ? 'facade, strips, garden and gate' : v === 'vertical' ? 'vertical strip lights' : v === 'wash' ? 'facade wash lights' : `${v} lights`}); switch to evening or night lighting to see it`
    }
    case 'improve_layout': {
      const beforeIssues = validateHouse({ plot: d.plot, floors: d.floors, site: d.site, exterior: d.exterior }).filter((i) => i.severity === 'error').length
      const log = repairAccess(d, uid)
      for (const f of d.floors) refreshFloor(f, s)
      const afterIssues = validateHouse({ plot: d.plot, floors: d.floors, site: d.site, exterior: d.exterior }).filter((i) => i.severity === 'error').length
      if (!log.length && beforeIssues === 0) return 'The layout already passes every check: all rooms are reachable, sized and lit'
      return `${log.length ? log.slice(0, 4).join('; ') : 'Checked the layout'}. Errors: ${beforeIssues} before, ${afterIssues} now`
    }
    default:
      return null
  }
}

/** Finish the wall the TV (or, failing that, the sofa) stands against with a feature material. */
function tvWall(d: Project, floor: Floor, room: Room, id: string): string {
  const inRoom = floor.furniture.filter((f) => pointInPolygon(f.position, room.polygon))
  const anchor = inRoom.find((f) => /tv/.test(f.type)) ?? inRoom.find((f) => /sofa|bed/.test(f.type))
  const segs = wallsOfRoom(floor, room).filter((x) => effectiveKind(x.wall) !== 'virtual')
  if (!segs.length) throw new EditError(`${room.name} has no solid walls.`)
  const target = anchor?.position ?? centroid(room.polygon)
  const best = segs.map((x) => ({ x, d: distToSegment(target, x.wall.a, x.wall.b) })).sort((a, b) => a.d - b.d)[0].x
  const w = floor.walls.find((q) => q.id === best.wall.id)!
  w.sideMaterials = { ...w.sideMaterials, [best.side]: id }
  const name = d.materials.find((x) => x.id === id)?.name ?? id.replace(/^lib:/, '').replace(/-/g, ' ')
  return `${anchor && /tv/.test(anchor.type) ? 'TV wall' : 'Feature wall'} in ${room.name} now ${name}`
}

function mergeIntoLawn(d: Project, lawn: SiteArea, a: SiteArea) {
  const u = unionPolys([lawn.polygon, a.polygon]).sort((x, y) => area(y.outer) - area(x.outer))[0]
  if (u && !u.holes.length) lawn.polygon = u.outer
}

/** Grow a site area about its centre, clipped to the open ground (plot minus house). */
function grownArea(d: Project, a: SiteArea, k: number): Vec2[] | null {
  const b = bbox(a.polygon)
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const scaled = a.polygon.map((q) => ({ x: c.x + (q.x - c.x) * k, y: c.y + (q.y - c.y) * k }))
  const ground = d.floors.find((f) => f.level === 0)
  const house = unionPolys((ground?.rooms ?? []).filter((r) => !spec(r.type).outdoor || r.type === 'garage').map((r) => r.polygon))
  const others = d.site.areas.filter((x) => x.id !== a.id && x.kind !== 'lawn' && x.kind !== 'garden_bed').map((x) => x.polygon)
  let pieces = intersectPolys(scaled, d.plot.polygon)
  const cut = [...house.map((h) => h.outer), ...others]
  if (cut.length) pieces = pieces.flatMap((pc) => differencePolys(pc.outer, ...cut))
  const best = pieces.filter((pc) => pc.outer.length >= 3).sort((x, y) => area(y.outer) - area(x.outer))[0]
  if (!best || area(best.outer) < area(a.polygon) * (k > 1 ? 1.02 : 0)) return k < 1 ? scaled : null
  return best.outer
}

/* ── answers ─────────────────────────────────────────────────────────────── */

function answerQuestion(q: string, p: Project, floorId: string): string {
  const t = q.toLowerCase()
  const u = p.settings.units
  const h = { plot: p.plot, floors: p.floors, site: p.site, exterior: p.exterior }
  const a = areaSummary(h)
  const st = designStats(h)
  const m = roomMentions(t, p, floorId)[0]
  if (m?.hit && /\b(big|size|large|area|dimension|wide|long)\b/.test(t)) {
    const b = bbox(m.hit.room.polygon)
    return `${m.hit.room.name} is ${formatLength(b.w, u)} × ${formatLength(b.h, u)}, ${formatAreaFor(area(m.hit.room.polygon), u)}, on the ${m.hit.floor.name.toLowerCase()} floor, with a ${formatLength(m.hit.floor.height - m.hit.floor.slabThickness, u)} ceiling.`
  }
  if (/\b(cost|price|budget|estimate|expensive|how much)\b/.test(t)) {
    const e = estimate(measure(h, p.materials), p.costRates)
    return `The rough construction estimate is ${formatMoney(e.total, p.costRates.currency)} at ${p.costRates.region} rates. The Estimate tab breaks it down by category; it is a preliminary figure, not a quote.`
  }
  if (/\bcovered\b/.test(t)) return `Covered area on the ground floor is ${formatAreaFor(a.coveredArea, u)}; total floor area across all floors is ${formatAreaFor(a.totalFloorArea, u)}.`
  if (/\b(total|floor) area\b|\bhow big is the house\b/.test(t)) return `Total floor area is ${formatAreaFor(a.totalFloorArea, u)} over ${st.floors} floors on a ${formatAreaFor(a.plotArea, u)} plot.`
  if (/\bbedrooms?\b/.test(t)) return `The house has ${st.bedrooms} bedrooms and ${st.bathrooms} bathrooms.`
  if (/\b(garden|lawn|green)\b/.test(t)) return `Garden and lawn area is ${formatAreaFor(a.gardenArea, u)}; open area on the plot is ${formatAreaFor(a.openArea, u)}.`
  if (/\b(parking|cars?|garage)\b/.test(t)) return `Parking fits ${st.parking} car${st.parking === 1 ? '' : 's'}.`
  if (/\b(problem|issue|wrong|error)s?\b/.test(t)) {
    const is = validateHouse(h)
    if (!is.length) return 'No problems found: every room is reachable, sized and lit.'
    return `Found ${is.length} item${is.length === 1 ? '' : 's'} to check, for example: ${is
      .slice(0, 3)
      .map((i) => i.message)
      .join('; ')}. Say "improve layout" to fix what can be fixed automatically.`
  }
  if (/\bwhy\b/.test(t)) {
    const d = p.designs.find((x) => x.id === p.activeDesignId)
    if (d) return `Why this design:\n${d.explanation.map((e) => `• ${e}`).join('\n')}`
  }
  return `This ${formatAreaFor(a.plotArea, u)} house has ${st.bedrooms} bedrooms, ${st.bathrooms} bathrooms, ${st.floors} floors and ${formatAreaFor(a.totalFloorArea, u)} of floor area. Ask about a room ("how big is the kitchen?"), the cost, the garden or any problems.`
}
