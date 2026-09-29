import type { Floor, HouseState, Project, Room, Wall } from './types'

/** Floors sorted bottom → top. */
export function sortedFloors(floors: Floor[]): Floor[] {
  return [...floors].sort((a, b) => a.level - b.level)
}

/** Finished-floor elevation of every floor (m above ground level). */
export function floorElevations(floors: Floor[], plinth: number): Map<string, number> {
  const out = new Map<string, number>()
  const s = sortedFloors(floors)
  const g = s.findIndex((f) => f.level >= 0)
  let z = plinth
  for (let i = Math.max(0, g); i < s.length; i++) {
    out.set(s[i].id, z)
    z += s[i].height
  }
  z = plinth
  for (let i = g - 1; i >= 0; i--) {
    z -= s[i].height
    out.set(s[i].id, z)
  }
  return out
}

export function floorAbove(floors: Floor[], f: Floor): Floor | undefined {
  return sortedFloors(floors).find((x) => x.level === f.level + 1)
}

export function floorBelow(floors: Floor[], f: Floor): Floor | undefined {
  return sortedFloors(floors).find((x) => x.level === f.level - 1)
}

export function findRoom(house: Pick<HouseState, 'floors'>, roomId: string): { floor: Floor; room: Room } | undefined {
  for (const floor of house.floors) {
    const room = floor.rooms.find((r) => r.id === roomId)
    if (room) return { floor, room }
  }
  return undefined
}

export function findWall(house: Pick<HouseState, 'floors'>, wallId: string): { floor: Floor; wall: Wall } | undefined {
  for (const floor of house.floors) {
    const wall = floor.walls.find((w) => w.id === wallId)
    if (wall) return { floor, wall }
  }
  return undefined
}

export function houseOf(p: Project): HouseState {
  return { plot: p.plot, floors: p.floors, site: p.site, exterior: p.exterior }
}

export function clearHeight(floor: Floor, room?: Room) {
  return room?.ceilingHeight ?? floor.height - floor.slabThickness
}
