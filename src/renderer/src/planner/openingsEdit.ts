import type { Floor, Opening, Room } from '../core/model/types'
import { wallsOfRoom, effectiveKind } from './walls'
import { segLength } from '../core/geometry/segment'
import { uid } from '../core/model/ids'

/** Opening edits shared by the room designer, facade editor and the natural-language editor. */

/** Widest free stretch on an exterior wall of `room`, or null. */
export function freeWindowSpot(floor: Floor, room: Room, minSpan = 0.7): { wallId: string; offset: number; span: number } | null {
  let best: { wallId: string; offset: number; span: number } | null = null
  for (const s of wallsOfRoom(floor, room)) {
    if (effectiveKind(s.wall) !== 'exterior') continue
    const taken = floor.openings
      .filter((o) => o.wallId === s.wall.id)
      .map((o) => [o.offset - o.width / 2 - 0.3, o.offset + o.width / 2 + 0.3] as const)
      .sort((a, b) => a[0] - b[0])
    const cuts: (readonly [number, number])[] = [[s.t0 + 0.35, s.t0 + 0.35], ...taken, [s.t1 - 0.35, s.t1 - 0.35]]
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = Math.max(cuts[i][1], s.t0 + 0.35)
      const b = Math.min(cuts[i + 1][0], s.t1 - 0.35)
      if (b - a > (best?.span ?? minSpan)) best = { wallId: s.wall.id, offset: (a + b) / 2, span: b - a }
    }
  }
  return best
}

export function addWindowToRoom(floor: Floor, room: Room, width = 1.8): Opening | null {
  const spot = freeWindowSpot(floor, room)
  if (!spot) return null
  const o: Opening = { id: uid('op'), kind: 'window', wallId: spot.wallId, offset: spot.offset, width: Math.min(width, spot.span), height: 1.5, sill: 0.9, style: 'casement' }
  floor.openings.push(o)
  return o
}

/**
 * Scale every exterior window by `factor` (width, and height when growing a lot), keeping each
 * inside its wall and clear of neighbouring openings. Returns how many changed.
 */
export function scaleWindows(floors: Floor[], factor: number, filter?: (f: Floor, o: Opening) => boolean): number {
  let n = 0
  for (const f of floors) {
    for (const o of f.openings) {
      if (o.kind !== 'window' || o.style === 'ventilator') continue
      const w = f.walls.find((x) => x.id === o.wallId)
      if (!w || effectiveKind(w) !== 'exterior') continue
      if (filter && !filter(f, o)) continue
      const L = segLength(w.a, w.b)
      const others = f.openings.filter((x) => x.wallId === w.id && x.id !== o.id)
      let lo = 0.15
      let hi = L - 0.15
      for (const x of others) {
        if (x.offset < o.offset) lo = Math.max(lo, x.offset + x.width / 2 + 0.3)
        else hi = Math.min(hi, x.offset - x.width / 2 - 0.3)
      }
      const maxW = Math.max(o.width, Math.min(2 * (o.offset - lo), 2 * (hi - o.offset)))
      const nw = Math.max(0.45, Math.min(maxW, o.width * factor))
      if (Math.abs(nw - o.width) > 0.01) {
        o.width = nw
        n++
      }
      if (factor >= 1.2 && o.style !== 'full-height') {
        const top = Math.min(f.height - f.slabThickness - 0.25, o.sill + o.height * 1.2)
        o.height = Math.max(o.height, top - o.sill)
      }
      if (factor < 1 && o.style !== 'full-height') o.height = Math.max(0.6, o.height * Math.max(0.8, factor))
    }
  }
  return n
}
