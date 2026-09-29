import type { Floor, Opening, Vec2, Wall } from '../core/model/types'
import { add, dist, dot, norm, perp, scale, sub } from '../core/geometry/vec'
import { distToSegment, segLength } from '../core/geometry/segment'
import { effectiveKind } from './walls'

/**
 * Wall solids shared by the 2D plan (poché) and the 3D model, so both always agree:
 * corner extensions, pieces between openings, and the opening cut-outs.
 */

export interface WallFrame {
  wall: Wall
  L: number
  dir: Vec2
  n: Vec2
  /** Extension beyond a / b so corners close. */
  extA: number
  extB: number
  height: number
  kind: ReturnType<typeof effectiveKind>
}

export interface WallPiece {
  t0: number
  t1: number
  /** Bottom and top of this solid (above FFL). */
  z0: number
  z1: number
  /** Which opening this piece sits under/over (for sill/lintel styling). */
  openingId?: string
}

export function wallHeight(w: Wall, floorHeight: number, kind = effectiveKind(w)): number {
  if (w.height !== undefined) return w.height
  if (kind === 'railing') return 1.05
  if (kind === 'parapet') return 1.05
  return floorHeight
}

/** Corner extensions: extend an endpoint by half the thickness of the walls meeting it at an angle. */
export function wallFrames(floor: Floor): WallFrame[] {
  const walls = floor.walls.filter((w) => effectiveKind(w) !== 'virtual')
  const frames: WallFrame[] = []
  for (const w of walls) {
    const L = segLength(w.a, w.b)
    if (L < 1e-3) continue
    const dir = norm(sub(w.b, w.a))
    const ext = (p: Vec2) => {
      let e = 0
      for (const o of walls) {
        if (o.id === w.id) continue
        const od = norm(sub(o.b, o.a))
        const parallel = Math.abs(Math.abs(dot(od, dir)) - 1) < 1e-3
        if (parallel) continue
        const touching = dist(o.a, p) < 0.02 || dist(o.b, p) < 0.02 || distToSegment(p, o.a, o.b) < 0.02
        if (touching) e = Math.max(e, o.thickness / 2)
      }
      return e
    }
    const kind = effectiveKind(w)
    frames.push({ wall: w, L, dir, n: perp(dir), extA: ext(w.a), extB: ext(w.b), height: wallHeight(w, floor.height, kind), kind })
  }
  return frames
}

/** Solid pieces of a wall after cutting doors/windows (in wall parameter t, meters from a). */
export function wallPieces(f: WallFrame, openings: Opening[]): WallPiece[] {
  const ops = openings.filter((o) => o.wallId === f.wall.id).sort((a, b) => a.offset - b.offset)
  const pieces: WallPiece[] = []
  let t = -f.extA
  const H = f.height
  for (const o of ops) {
    const o0 = Math.max(-f.extA, o.offset - o.width / 2)
    const o1 = Math.min(f.L + f.extB, o.offset + o.width / 2)
    if (o0 > t + 1e-4) pieces.push({ t0: t, t1: o0, z0: 0, z1: H })
    const top = Math.min(H, o.sill + o.height)
    if (o.sill > 1e-3) pieces.push({ t0: o0, t1: o1, z0: 0, z1: Math.min(o.sill, H), openingId: o.id })
    if (top < H - 1e-3) pieces.push({ t0: o0, t1: o1, z0: top, z1: H, openingId: o.id })
    t = Math.max(t, o1)
  }
  if (f.L + f.extB > t + 1e-4) pieces.push({ t0: t, t1: f.L + f.extB, z0: 0, z1: H })
  return pieces
}

/** Plan rectangle (4 points) for a wall stretch [t0, t1]. */
export function wallRect(f: WallFrame, t0: number, t1: number, thickness = f.wall.thickness): Vec2[] {
  const h = thickness / 2
  const a = add(f.wall.a, scale(f.dir, t0))
  const b = add(f.wall.a, scale(f.dir, t1))
  return [add(a, scale(f.n, h)), add(b, scale(f.n, h)), add(b, scale(f.n, -h)), add(a, scale(f.n, -h))]
}

/** Plan poché pieces: full-height pieces only (openings leave gaps). */
export function planWallPieces(f: WallFrame, openings: Opening[]): { t0: number; t1: number }[] {
  const ops = openings.filter((o) => o.wallId === f.wall.id).sort((a, b) => a.offset - b.offset)
  const out: { t0: number; t1: number }[] = []
  let t = -f.extA
  for (const o of ops) {
    const o0 = o.offset - o.width / 2
    const o1 = o.offset + o.width / 2
    if (o0 > t + 1e-4) out.push({ t0: t, t1: o0 })
    t = Math.max(t, o1)
  }
  if (f.L + f.extB > t + 1e-4) out.push({ t0: t, t1: f.L + f.extB })
  return out
}

export function pointOnWall(w: Wall, t: number): Vec2 {
  const d = norm(sub(w.b, w.a))
  return add(w.a, scale(d, t))
}
