import * as THREE from 'three'
import type { Engine, Controller } from '../Engine'
import type { Floor, Vec2 } from '../../core/model/types'
import { stairGeometry } from '../../planner/stairs'
import { pointInPolygon, bbox } from '../../core/geometry/polygon'
import { closestOnSegment, projectT } from '../../core/geometry/segment'
import { sortedFloors } from '../../core/model/house'
import { spec } from '../../core/constraints/rooms'
import { openingCenter } from '../../planner/validation'
import { norm, perp, sub } from '../../core/geometry/vec'

/**
 * First-person walkthrough: WASD / arrow keys + mouse (pointer lock), optional gamepad,
 * collision against walls, railings and boundary walls, and stairs that carry you between floors.
 */

export interface WalkState {
  pos: Vec2
  yaw: number
  floorId: string
  eye: number
  speed: number
  collide: boolean
}

export const walkState: { current: WalkState | null; listeners: Set<() => void> } = { current: null, listeners: new Set() }

export class WalkController implements Controller {
  active = true
  pos: Vec2 = { x: 0, y: 0 }
  y = 0
  yaw = 0
  pitch = 0
  eye = 1.6
  speed = 1.6
  collide = true
  floor!: Floor
  private keys = new Set<string>()
  private radius = 0.25
  private disposeFns: (() => void)[] = []
  private notifyT = 0

  constructor(private engine: Engine) {
    const p = engine.project
    if (!p) return
    const floors = sortedFloors(p.floors)
    const ground = floors.find((f) => f.level === 0) ?? floors[0]
    this.floor = ground
    // start just inside the main entrance, facing into the house
    const main = ground.openings.find((o) => o.style === 'main') ?? ground.openings.find((o) => o.kind === 'door')
    const w = main && ground.walls.find((x) => x.id === main.wallId)
    if (main && w) {
      const c = openingCenter(w, main)
      const n = perp(norm(sub(w.b, w.a)))
      const inA = { x: c.x + n.x * 1.2, y: c.y + n.y * 1.2 }
      const inB = { x: c.x - n.x * 1.2, y: c.y - n.y * 1.2 }
      const inside = ground.rooms.some((r) => pointInPolygon(inA, r.polygon) && !spec(r.type).outdoor && r.type !== 'garage') ? inA : inB
      this.pos = inside
      this.yaw = Math.atan2(-(inside.x - c.x), -(inside.y - c.y))
    } else {
      const r = ground.rooms.find((x) => spec(x.type).walkable && !spec(x.type).outdoor) ?? ground.rooms[0]
      const b = r ? bbox(r.polygon) : { x: 0, y: 0, w: 1, h: 1 }
      this.pos = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    }
    engine.setOptions({ viewMode: 'realistic', showAll: true })
    this.y = engine.floorGroupY(ground.id)
    const canvas = engine.canvas
    const onClick = () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.()
    }
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return
      this.yaw -= e.movementX * 0.0022
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - e.movementY * 0.0022))
    }
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (e.type === 'keydown') {
        if ((e.target as HTMLElement)?.tagName === 'INPUT') return
        this.keys.add(k)
        if (k === 'pageup') this.setEye(this.eye + 0.1)
        if (k === 'pagedown') this.setEye(this.eye - 0.1)
      } else this.keys.delete(k)
    }
    const blur = () => this.keys.clear()
    canvas.addEventListener('click', onClick)
    document.addEventListener('mousemove', onMove)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', blur)
    this.disposeFns.push(() => {
      canvas.removeEventListener('click', onClick)
      document.removeEventListener('mousemove', onMove)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', blur)
      if (document.pointerLockElement === canvas) document.exitPointerLock()
    })
    this.publish()
  }

  setEye(h: number) {
    this.eye = Math.max(0.6, Math.min(3.5, h))
    this.publish()
  }

  teleport(roomFloorId: string, p: Vec2) {
    const f = this.engine.project?.floors.find((x) => x.id === roomFloorId)
    if (!f) return
    this.floor = f
    this.pos = { ...p }
    this.y = this.engine.floorGroupY(f.id)
    this.publish()
  }

  update(dt: number): boolean {
    const p = this.engine.project
    if (!p || !this.floor) return false
    let fwd = 0
    let side = 0
    const K = this.keys
    if (K.has('w') || K.has('arrowup')) fwd += 1
    if (K.has('s') || K.has('arrowdown')) fwd -= 1
    if (K.has('a')) side -= 1
    if (K.has('d')) side += 1
    if (K.has('arrowleft')) this.yaw += dt * 1.8
    if (K.has('arrowright')) this.yaw -= dt * 1.8
    // gamepad
    const gp = navigator.getGamepads?.().find((g) => g)
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v)
      side += dz(gp.axes[0])
      fwd -= dz(gp.axes[1])
      this.yaw -= dz(gp.axes[2] ?? 0) * dt * 2.2
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - dz(gp.axes[3] ?? 0) * dt * 1.8))
    }
    const moving = fwd !== 0 || side !== 0
    const run = K.has('shift') ? 2.2 : 1
    if (moving) {
      const l = Math.hypot(fwd, side)
      const sp = (this.speed * run * dt) / l
      // plan-space forward (−sin, −cos) and right (cos, −sin) for the current yaw
      const mx = -Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * side
      const my = -Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * side
      this.move({ x: this.pos.x + mx * sp, y: this.pos.y + my * sp })
    }
    this.followStairs()
    const cam = this.engine.camera
    const eyeY = this.y + this.eye
    cam.position.set(this.pos.x, eyeY, this.pos.y)
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch))
    cam.lookAt(cam.position.clone().add(dir))
    this.notifyT += dt
    if (this.notifyT > 0.2) {
      this.notifyT = 0
      this.publish()
    }
    return true
  }

  private move(target: Vec2) {
    if (!this.collide) {
      this.pos = target
      return
    }
    let p = { ...target }
    const cols = this.engine.colliders(this.floor.id)
    // resolve penetration a few times (slides along walls)
    for (let iter = 0; iter < 3; iter++) {
      for (const c of cols) {
        const q = c.a === c.b || (c.a.x === c.b.x && c.a.y === c.b.y) ? c.a : closestOnSegment(p, c.a, c.b)
        const dx = p.x - q.x
        const dy = p.y - q.y
        const d = Math.hypot(dx, dy)
        const min = this.radius + c.r
        if (d < min && d > 1e-6) {
          p = { x: q.x + (dx / d) * min, y: q.y + (dy / d) * min }
        }
      }
    }
    this.pos = p
  }

  private followStairs() {
    const p = this.engine.project!
    const floors = sortedFloors(p.floors)
    const idx = floors.findIndex((f) => f.id === this.floor.id)
    const base = this.engine.floorGroupY(this.floor.id)
    // going up on this floor's stairs
    for (const s of this.floor.stairs) {
      const g = stairGeometry(s, this.floor.height)
      if (!pointInPolygon(this.pos, g.outline)) continue
      const z = pathHeight(g.path, this.pos)
      this.y = base + z
      if (z >= this.floor.height - 0.05 && floors[idx + 1]) {
        this.floor = floors[idx + 1]
        this.publish()
      }
      return
    }
    // coming down onto the floor below
    const below = floors[idx - 1]
    if (below) {
      const bb = this.engine.floorGroupY(below.id)
      for (const s of below.stairs) {
        const g = stairGeometry(s, below.height)
        if (!pointInPolygon(this.pos, g.outline)) continue
        const z = pathHeight(g.path, this.pos)
        if (z < below.height - 0.1) {
          this.floor = below
          this.y = bb + z
          this.publish()
          return
        }
      }
    }
    this.y = base
  }

  publish() {
    walkState.current = { pos: this.pos, yaw: this.yaw, floorId: this.floor?.id, eye: this.eye, speed: this.speed, collide: this.collide }
    walkState.listeners.forEach((l) => l())
  }

  dispose() {
    this.active = false
    this.disposeFns.forEach((f) => f())
    walkState.current = null
    walkState.listeners.forEach((l) => l())
    ;(this.engine as Engine).controls.enabled = true
  }
}

/** Height along a stair walking path at the point nearest to p. */
function pathHeight(path: { p: Vec2; z: number }[], p: Vec2): number {
  let best = { d: Infinity, z: 0 }
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const t = Math.max(0, Math.min(1, projectT(p, a.p, b.p)))
    const q = { x: a.p.x + (b.p.x - a.p.x) * t, y: a.p.y + (b.p.y - a.p.y) * t }
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (d < best.d) best = { d, z: a.z + (b.z - a.z) * t }
  }
  return best.z
}
