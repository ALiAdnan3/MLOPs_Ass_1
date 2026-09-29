import { useEffect, useRef, useState } from 'react'
import { useProject } from '../state/store'
import { walkState } from '../engine/controllers/WalkController'
import { getEngine } from '../engine/Engine'
import type { WalkController } from '../engine/controllers/WalkController'
import { Slider, Switch } from '../ui/primitives'
import { renderPlanToCanvas } from '../render/planImage'
import { bbox } from '../core/geometry/polygon'
import { spec } from '../core/constraints/rooms'
import { formatLength } from '../core/units/units'
import { sortedFloors } from '../core/model/house'

/** Walk inside (§12): controls, eye height, speed, collision, mini-map and room jumps. */
export function WalkPanel() {
  const [, force] = useState(0)
  const project = useProject((s) => s.project)
  const map = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    walkState.listeners.add(l)
    return () => void walkState.listeners.delete(l)
  }, [])
  const ctrl = getEngine().controller as WalkController | null
  const st = walkState.current
  const floor = project.floors.find((f) => f.id === st?.floorId)
  // mini-map
  useEffect(() => {
    const c = map.current
    if (!c || !floor || !st) return
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    const img = renderPlanToCanvas(project, floor, 280, 220, { theme, site: false, labels: false, dpr: 1 })
    const ctx = c.getContext('2d')!
    c.width = 280
    c.height = 220
    ctx.drawImage(img, 0, 0)
    const pts = floor.rooms.flatMap((r) => r.polygon)
    const b = bbox(pts)
    const s = Math.min((280 * 0.88) / b.w, (220 * 0.88) / b.h)
    const x = 140 - (b.x + b.w / 2) * s + st.pos.x * s
    const y = 110 - (b.y + b.h / 2) * s + st.pos.y * s
    ctx.fillStyle = '#f0b823'
    ctx.beginPath()
    ctx.moveTo(x - Math.sin(st.yaw) * 12, y - Math.cos(st.yaw) * 12)
    ctx.lineTo(x + Math.cos(st.yaw) * 5, y - Math.sin(st.yaw) * 5)
    ctx.lineTo(x - Math.cos(st.yaw) * 5, y + Math.sin(st.yaw) * 5)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fill()
  })
  const rooms = floor?.rooms.filter((r) => spec(r.type).walkable && r.type !== 'garage') ?? []
  return (
    <div className="panel-scroll">
      <div className="section">
        <div className="section-head">
          <h3>Walk inside</h3>
          <span className="sub">{floor?.name} floor</span>
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Click the view to look around with the mouse. <b>W A S D</b> or arrow keys to walk, <b>Shift</b> to go faster, <b>Page Up/Down</b> for eye height, <b>Esc</b> to release the mouse. A gamepad works too. Walk onto the stairs to change floors.
        </p>
        <canvas ref={map} className="mini-map" style={{ width: 280, height: 220 }} />
      </div>
      <div className="section">
        <div className="prop">
          <label>Eye height</label>
          <div className="row">
            <Slider value={st?.eye ?? 1.6} min={0.6} max={3.5} step={0.05} onChange={(v) => ctrl?.setEye(v)} label="Eye height" />
            <span className="tabular faint" style={{ width: 52 }}>
              {formatLength(st?.eye ?? 1.6, project.settings.units)}
            </span>
          </div>
        </div>
        <div className="prop">
          <label>Walking speed</label>
          <Slider value={st?.speed ?? 1.6} min={0.5} max={4} step={0.1} onChange={(v) => {
              if (ctrl) {
                ctrl.speed = v
                ctrl.publish()
              }
            }} label="Speed" />
        </div>
        <div className="prop">
          <label>Collisions</label>
          <Switch on={st?.collide ?? true} onChange={(v) => {
              if (ctrl) {
                ctrl.collide = v
                ctrl.publish()
              }
            }} label="Walls stop you" />
        </div>
      </div>
      <div className="section">
        <div className="section-head">
          <h3>Go to a room</h3>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {sortedFloors(project.floors)
            .filter((f) => f.kind !== 'roof')
            .map((f) => (
              <button key={f.id} className={`chip ${f.id === floor?.id ? 'on' : ''}`} onClick={() => {
                  const r = f.rooms.find((x) => ['tv_lounge', 'family', 'basement_lounge', 'foyer'].includes(x.type)) ?? f.rooms[0]
                  if (r && ctrl) {
                    const b = bbox(r.polygon)
                    ctrl.teleport(f.id, { x: b.x + b.w / 2, y: b.y + b.h / 2 })
                  }
                }}>
                {f.name}
              </button>
            ))}
        </div>
        <div className="list">
          {rooms.map((r) => (
            <div key={r.id} className="list-item" onClick={() => {
                const b = bbox(r.polygon)
                ctrl?.teleport(floor!.id, { x: b.x + b.w / 2, y: b.y + b.h / 2 })
              }}>
              {r.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
