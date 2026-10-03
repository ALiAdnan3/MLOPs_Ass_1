import * as THREE from 'three'
import type { Engine, Controller } from '../Engine'
import type { Floor, Project, Room, Vec2 } from '../../core/model/types'
import { bbox, area } from '../../core/geometry/polygon'
import { sortedFloors } from '../../core/model/house'
import { spec } from '../../core/constraints/rooms'
import { accessGraph, openingRooms, openingCenter } from '../../planner/validation'
import { stairGeometry } from '../../planner/stairs'

/**
 * Cinematic drone / tour camera. The route is generated from the model: exterior keyframes
 * around the plot, then an interior tour that walks through actual doors (room graph) and up
 * the actual stair. Supports play / pause / restart / speed / height offset / path presets,
 * a visible path line, and frame-exact video recording.
 */

export type DronePath = 'full' | 'exterior' | 'flyover' | 'interior' | 'bookmarks'

interface Key {
  p: THREE.Vector3
  look: THREE.Vector3
  label?: string
  exterior: boolean
}

/** `path` is the route the next drone flight starts on (the dashboard's tour buttons set it). */
export const droneState: { playing: boolean; t: number; label: string; recording: boolean; path: DronePath; listeners: Set<() => void> } = { playing: false, t: 0, label: '', recording: false, path: 'full', listeners: new Set() }
const notify = () => droneState.listeners.forEach((l) => l())

export class DroneController implements Controller {
  active = true
  playing = true
  t = 0
  speed = 1
  height = 0
  path: DronePath = 'full'
  private keys: Key[] = []
  private posCurve!: THREE.CatmullRomCurve3
  private lookCurve!: THREE.CatmullRomCurve3
  private duration = 60
  private line: THREE.Line | null = null
  showPath = false
  private rec: { recorder: MediaRecorder; chunks: Blob[]; track: CanvasCaptureMediaStreamTrack | null; resolve: (b: Blob) => void } | null = null
  private notifyT = 0

  constructor(private engine: Engine) {
    engine.setOptions({ viewMode: 'realistic', showAll: true })
    this.path = droneState.path
    this.build()
    droneState.playing = true
    notify()
  }

  setPath(p: DronePath) {
    this.path = p
    droneState.path = p
    this.t = 0
    this.build()
  }

  build() {
    const p = this.engine.project
    if (!p) return
    const keys = this.path === 'bookmarks' ? this.bookmarkKeys(p) : routeFor(p, this.path, (id) => this.engine.floorGroupY(id))
    this.keys = keys.length >= 2 ? keys : routeFor(p, 'exterior', (id) => this.engine.floorGroupY(id))
    this.posCurve = new THREE.CatmullRomCurve3(this.keys.map((k) => k.p), false, 'centripetal', 0.5)
    this.lookCurve = new THREE.CatmullRomCurve3(this.keys.map((k) => k.look), false, 'centripetal', 0.5)
    const len = this.posCurve.getLength()
    // interiors move slower than the aerial parts
    const interiorShare = this.keys.filter((k) => !k.exterior).length / this.keys.length
    this.duration = Math.max(20, len / (3.2 - interiorShare * 1.8))
    this.updateLine()
  }

  private bookmarkKeys(p: Project): Key[] {
    return p.cameras.map((b) => ({ p: new THREE.Vector3(...b.position), look: new THREE.Vector3(...b.target), label: b.name, exterior: b.position[1] > 3 }))
  }

  setShowPath(on: boolean) {
    this.showPath = on
    this.updateLine()
  }

  private updateLine() {
    if (this.line) {
      this.engine.helpers.remove(this.line)
      this.line.geometry.dispose()
      this.line = null
    }
    if (!this.showPath || !this.posCurve) return
    const pts = this.posCurve.getPoints(400).map((v) => new THREE.Vector3(v.x, v.y + (v.y > 3 ? this.height : 0), v.z))
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#f0b823' }))
    this.engine.helpers.add(this.line)
    this.engine.invalidate()
  }

  restart() {
    this.t = 0
    this.playing = true
  }

  update(dt: number): boolean {
    if (!this.posCurve) return false
    if (this.rec) dt = 1 / 30
    if (this.playing) {
      this.t += (dt * this.speed) / this.duration
      if (this.t >= 1) {
        this.t = 1
        this.playing = false
        if (this.rec) this.stopRecording()
      }
    }
    const u = easeInOut(this.t)
    const pos = this.posCurve.getPointAt(u)
    const look = this.lookCurve.getPointAt(u)
    if (pos.y > 3) {
      pos.y += this.height
      look.y += this.height * 0.6
    }
    const cam = this.engine.camera
    cam.position.copy(pos)
    cam.lookAt(look)
    cam.fov = pos.y > 4 ? 50 : 62
    cam.updateProjectionMatrix()
    this.rec?.track?.requestFrame()
    const idx = Math.min(this.keys.length - 1, Math.round(u * (this.keys.length - 1)))
    this.notifyT += dt
    if (this.notifyT > 0.15) {
      this.notifyT = 0
      droneState.playing = this.playing
      droneState.t = this.t
      droneState.label = this.keys[idx]?.label ?? droneState.label
      droneState.recording = !!this.rec
      notify()
    }
    return true
  }

  /** Record the route as a WebM video (§11 export walkthrough). */
  record(): Promise<Blob> {
    const canvas = this.engine.canvas
    const stream = canvas.captureStream(0)
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    return new Promise<Blob>((resolve) => {
      this.rec = { recorder, chunks, track, resolve }
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
      recorder.start(500)
      this.t = 0
      this.playing = true
      droneState.recording = true
      notify()
    })
  }

  stopRecording() {
    const r = this.rec
    if (!r) return
    this.rec = null
    r.recorder.stop()
    droneState.recording = false
    notify()
  }

  dispose() {
    this.active = false
    if (this.rec) this.stopRecording()
    if (this.line) {
      this.engine.helpers.remove(this.line)
      this.line.geometry.dispose()
    }
    droneState.playing = false
    notify()
  }
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2) * 0.15 + t * 0.85

/** Generate the camera route from the house model. */
export function routeFor(p: Project, path: DronePath, floorY: (id: string) => number): Key[] {
  const floors = sortedFloors(p.floors)
  const ground = floors.find((f) => f.level === 0) ?? floors[0]
  const pb = bbox(p.plot.polygon)
  const house = bbox(ground.rooms.filter((r) => !spec(r.type).outdoor).flatMap((r) => r.polygon))
  const hc = { x: house.x + house.w / 2, y: house.y + house.h / 2 }
  const top = floors.filter((f) => f.kind !== 'roof').reduce((s, f) => Math.max(s, floorY(f.id) + f.height), 6)
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const center = V(hc.x, top * 0.45, hc.y)
  const keys: Key[] = []
  const front = pb.y + pb.h
  const ext = (p0: THREE.Vector3, look: THREE.Vector3, label: string) => keys.push({ p: p0, look, label, exterior: true })
  if (path !== 'interior') {
    const R = Math.max(house.w, house.h) * 0.95 + 8
    ext(V(pb.x + pb.w / 2, top + 9, front + 22), V(hc.x, top * 0.4, hc.y), 'Above the front gate')
    ext(V(pb.x + pb.w / 2, top * 0.7 + 4, front + 9), center, 'Approaching the house')
    // arc around the front facade
    for (let k = 0; k <= 4; k++) {
      const a = -0.9 + (1.8 * k) / 4
      ext(V(hc.x + Math.sin(a) * R, top * 0.55 + 2, hc.y + Math.cos(a) * R), center, 'Front facade')
    }
    if (path !== 'flyover') {
      ext(V(hc.x + R * 0.6, top + 6, hc.y + R * 0.2), V(hc.x, top, hc.y), 'Above the roof')
      ext(V(hc.x, top + 18, hc.y + 2), V(hc.x, 0, hc.y - 1), 'The whole plot')
      ext(V(hc.x - R * 0.7, top * 0.6 + 3, pb.y - 6), V(hc.x, top * 0.35, hc.y), 'Back garden')
      if (path === 'exterior') {
        for (let k = 0; k <= 5; k++) {
          const a = Math.PI * 0.9 + (Math.PI * 1.1 * k) / 5
          ext(V(hc.x + Math.sin(a) * R, top * 0.5 + 2, hc.y + Math.cos(a) * R), center, 'Around the house')
        }
        return keys
      }
    } else {
      ext(V(hc.x, top + 14, hc.y), V(hc.x, 0, hc.y - 2), 'Over the roof')
      ext(V(hc.x, top + 10, pb.y - 10), V(hc.x, top * 0.3, hc.y), 'Back garden')
      return keys
    }
  }
  // interior tour
  const eye = (f: Floor) => floorY(f.id) + 1.6
  const main = ground.openings.find((o) => o.style === 'main') ?? ground.openings.find((o) => o.kind === 'door')
  const mw = main && ground.walls.find((x) => x.id === main.wallId)
  const room = (f: Floor, types: string[]) => f.rooms.filter((r) => types.includes(r.type)).sort((a, b) => area(b.polygon) - area(a.polygon))[0]
  const ctr = (r: Room) => {
    const b = bbox(r.polygon)
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  }
  const at = (f: Floor, q: Vec2, lookQ: Vec2, label: string) => keys.push({ p: V(q.x, eye(f), q.y), look: V(lookQ.x, eye(f) - 0.2, lookQ.y), label, exterior: false })
  let cur: Room | undefined
  if (main && mw) {
    const c = openingCenter(mw, main)
    const { left, right } = openingRooms(ground, main)
    const inside = [left, right].find((r) => r && !spec(r.type).outdoor && r.type !== 'garage')
    cur = inside
    const outsideDir = inside ? { x: c.x - ctr(inside).x, y: c.y - ctr(inside).y } : { x: 0, y: 1 }
    const l = Math.hypot(outsideDir.x, outsideDir.y) || 1
    const outP = { x: c.x + (outsideDir.x / l) * 3.5, y: c.y + (outsideDir.y / l) * 3.5 }
    keys.push({ p: V(outP.x, eye(ground) + 0.3, outP.y), look: V(c.x, eye(ground), c.y), label: 'Main entrance', exterior: false })
    at(ground, c, inside ? ctr(inside) : hc, 'Entering')
  }
  const visit = (f: Floor, target: Room | undefined, label: string) => {
    if (!target) return
    const hops = pathThroughDoors(f, cur, target)
    for (const h of hops) at(f, h.p, h.next, label)
    at(f, ctr(target), offsetLook(target), label)
    cur = target
  }
  visit(ground, room(ground, ['tv_lounge', 'living', 'foyer']), 'Living room')
  visit(ground, room(ground, ['dining']), 'Dining')
  visit(ground, room(ground, ['kitchen']), 'Kitchen')
  // upstairs via the stair
  const st = ground.stairs[0]
  const upper = floors.find((f) => f.level === 1)
  if (st && upper) {
    const hall = ground.rooms.find((r) => r.type === 'stair')
    if (hall) visit(ground, hall, 'Stairs')
    const g = stairGeometry(st, ground.height)
    for (let i = 0; i < g.path.length; i++) {
      const q = g.path[i]
      const nxt = g.path[Math.min(g.path.length - 1, i + 1)]
      keys.push({ p: V(q.p.x, floorY(ground.id) + q.z + 1.6, q.p.y), look: V(nxt.p.x + (nxt.p.x - q.p.x) * 2, floorY(ground.id) + nxt.z + 1.5, nxt.p.y + (nxt.p.y - q.p.y) * 2), label: 'Upstairs', exterior: false })
    }
    cur = upper.rooms.find((r) => r.type === 'stair')
    visit(upper, room(upper, ['family', 'corridor']), 'Upper lounge')
    const beds = upper.rooms.filter((r) => ['master_bedroom', 'bedroom', 'kids_room'].includes(r.type)).sort((a, b) => (a.type === 'master_bedroom' ? -1 : 0) - (b.type === 'master_bedroom' ? -1 : 0)).slice(0, 3)
    for (const b of beds) visit(upper, b, b.name)
  } else {
    const beds = ground.rooms.filter((r) => ['master_bedroom', 'bedroom'].includes(r.type)).slice(0, 2)
    for (const b of beds) visit(ground, b, b.name)
  }
  return keys
}

function offsetLook(r: Room): Vec2 {
  const b = bbox(r.polygon)
  return { x: b.x + b.w * 0.85, y: b.y + b.h * 0.2 }
}

/** Door-to-door route between two rooms on a floor (BFS over the access graph). */
function pathThroughDoors(f: Floor, from: Room | undefined, to: Room): { p: Vec2; next: Vec2 }[] {
  if (!from || from.id === to.id) return []
  const { adj } = accessGraph({ floors: [f] })
  const prev = new Map<string, string>()
  const q = [from.id]
  const seen = new Set(q)
  while (q.length) {
    const c = q.shift()!
    if (c === to.id) break
    for (const n of adj.get(c) ?? []) {
      if (seen.has(n)) continue
      seen.add(n)
      prev.set(n, c)
      q.push(n)
    }
  }
  if (!prev.has(to.id)) return []
  const chain: string[] = [to.id]
  while (chain[0] !== from.id) chain.unshift(prev.get(chain[0])!)
  const out: { p: Vec2; next: Vec2 }[] = []
  for (let i = 0; i < chain.length - 1; i++) {
    const a = f.rooms.find((r) => r.id === chain[i])!
    const b = f.rooms.find((r) => r.id === chain[i + 1])!
    const door = f.openings.find((o) => {
      if (o.kind !== 'door') return false
      const rr = openingRooms(f, o)
      return (rr.left?.id === a.id && rr.right?.id === b.id) || (rr.left?.id === b.id && rr.right?.id === a.id)
    })
    const bc = bbox(b.polygon)
    const nextC = { x: bc.x + bc.w / 2, y: bc.y + bc.h / 2 }
    if (door) {
      const w = f.walls.find((x) => x.id === door.wallId)!
      out.push({ p: openingCenter(w, door), next: nextC })
    }
  }
  return out
}
