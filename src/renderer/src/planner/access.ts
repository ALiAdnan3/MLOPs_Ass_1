import type { Floor, HouseState, Room } from '../core/model/types'
import type { IdFactory } from '../core/model/ids'
import { uid } from '../core/model/ids'
import { spec } from '../core/constraints/rooms'
import { accessGraph } from './validation'
import { addDoor, sharedWalls, DOOR_W } from './generator/openings'
import { effectiveKind } from './walls'

/** Rooms reachable from the entrance(s) through doors, open separators and stairs. */
export function reachableRooms(h: Pick<HouseState, 'floors'>): Set<string> {
  const { adj, entries } = accessGraph(h)
  const seen = new Set<string>(entries)
  const q = [...entries]
  while (q.length) {
    const c = q.shift()!
    for (const n of adj.get(c) ?? [])
      if (!seen.has(n)) {
        seen.add(n)
        q.push(n)
      }
  }
  return seen
}

const HUBS = new Set(['foyer', 'tv_lounge', 'living', 'family', 'corridor', 'basement_lounge', 'dining', 'stair', 'mumty'])

function needsAccess(r: Room) {
  const sp = spec(r.type)
  return sp.walkable && r.type !== 'garage'
}

/**
 * Add doors until every walkable room is reachable (where the geometry allows it).
 * Returns a human-readable log of the doors that were added.
 */
export function repairAccess(h: Pick<HouseState, 'floors'>, ids: IdFactory = uid, maxPasses = 8): string[] {
  const log: string[] = []
  for (let pass = 0; pass < maxPasses; pass++) {
    const reach = reachableRooms(h)
    let changed = false
    // no entrance at all: open the best ground-floor hub to the outside
    if (!reach.size) {
      const g = h.floors.find((f) => f.level === 0)
      const hub = g?.rooms.find((r) => HUBS.has(r.type) && r.type !== 'stair')
      if (g && hub && addDoor(g, g.openings, hub, null, 'main', DOOR_W.main, ids, { prefer: 'center' })) {
        log.push(`Added a main entrance to ${hub.name}`)
        changed = true
      }
      if (!changed) break
      continue
    }
    for (const f of h.floors) {
      for (const r of f.rooms) {
        if (!needsAccess(r) || reach.has(r.id)) continue
        if (connectRoom(f, r, reach, ids)) {
          log.push(`Added a door from ${r.name} to keep it reachable`)
          changed = true
        }
      }
    }
    if (!changed) break
  }
  return log
}

function connectRoom(f: Floor, r: Room, reach: Set<string>, ids: IdFactory): boolean {
  const cands = f.rooms
    .filter((o) => o.id !== r.id && reach.has(o.id) && spec(o.type).walkable)
    .map((o) => ({ o, s: sharedWalls(f, r, o).filter((x) => effectiveKind(x.wall) !== 'railing') }))
    .filter((x) => x.s.length && x.s[0].t1 - x.s[0].t0 >= 0.85)
    .sort((a, b) => (HUBS.has(b.o.type) ? 1 : 0) - (HUBS.has(a.o.type) ? 1 : 0) || b.s[0].t1 - b.s[0].t0 - (a.s[0].t1 - a.s[0].t0))
  for (const { o, s } of cands) {
    const L = s[0].t1 - s[0].t0
    const bath = r.type === 'bathroom' || r.type === 'powder' || r.type === 'servant_bath'
    const w = Math.min(bath ? DOOR_W.bath : DOOR_W.room, L - 0.16)
    if (w < 0.6) continue
    if (addDoor(f, f.openings, r, o, spec(r.type).outdoor ? 'sliding' : 'single', w, ids, { swingInto: r })) return true
  }
  return false
}
