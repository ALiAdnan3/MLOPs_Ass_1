import { useEffect, useState } from 'react'
import { Pause, Play, RotateCcw, Video, Square } from 'lucide-react'
import { droneState, type DroneController, type DronePath } from '../engine/controllers/DroneController'
import { getEngine } from '../engine/Engine'
import { Seg, Slider, Switch } from '../ui/primitives'
import { useUI } from '../state/ui'
import { platform } from '../storage/platform'
import { useProject } from '../state/store'

/** Drone / cinematic mode controls (§11). */
export function DronePanel() {
  const [, force] = useState(0)
  const [show, setShow] = useState(false)
  const [path, setPath] = useState<DronePath>(droneState.path)
  const [speed, setSpeed] = useState(1)
  const [height, setHeight] = useState(0)
  const cameras = useProject((s) => s.project.cameras)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    droneState.listeners.add(l)
    return () => void droneState.listeners.delete(l)
  }, [])
  const ctrl = getEngine().controller as DroneController | null
  const toast = useUI((s) => s.toast)
  const record = async () => {
    if (!ctrl) return
    toast({ kind: 'info', title: 'Recording the walkthrough', body: 'Keep this window open until it finishes.' })
    const blob = await ctrl.record()
    const name = `${useProject.getState().project.name.replace(/[^\w ]+/g, '').trim() || 'house'} walkthrough.webm`
    const saved = await platform.saveDialog(name, [{ name: 'WebM video', extensions: ['webm'] }], await blob.arrayBuffer())
    if (saved) toast({ kind: 'success', title: 'Walkthrough video saved', body: saved.split(/[\\/]/).pop() })
  }
  return (
    <div className="panel-scroll">
      <div className="section">
        <div className="section-head">
          <h3>Drone view</h3>
          <span className="sub">{droneState.label}</span>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn primary" onClick={() => {
              if (!ctrl) return
              ctrl.playing = !ctrl.playing
              if (ctrl.t >= 1) ctrl.restart()
              droneState.playing = ctrl.playing
              force((n) => n + 1)
            }}>
            {droneState.playing ? <Pause /> : <Play />} {droneState.playing ? 'Pause' : 'Play'}
          </button>
          <button className="btn" onClick={() => ctrl?.restart()}>
            <RotateCcw /> Restart
          </button>
        </div>
        <Slider value={droneState.t * 100} min={0} max={100} step={0.1} onChange={(v) => {
            if (ctrl) {
              ctrl.t = v / 100
              ctrl.playing = false
              droneState.playing = false
              getEngine().invalidate()
            }
          }} label="Position along the route" />
      </div>
      <div className="section">
        <div className="prop">
          <label>Route</label>
          <select className="field" value={path} onChange={(e) => {
              const p = e.target.value as DronePath
              setPath(p)
              ctrl?.setPath(p)
            }}>
            <option value="full">Full tour: outside, then every room</option>
            <option value="exterior">Around the house</option>
            <option value="flyover">Fly-over</option>
            <option value="interior">Interior tour</option>
            <option value="bookmarks" disabled={cameras.length < 2}>
              Through my camera bookmarks{cameras.length < 2 ? ' (save 2+ first)' : ''}
            </option>
          </select>
        </div>
        <div className="prop">
          <label>Speed</label>
          <Seg value={String(speed)} onChange={(v) => {
              setSpeed(Number(v))
              if (ctrl) ctrl.speed = Number(v)
            }} options={['0.5', '1', '1.5', '2', '3'].map((v) => ({ value: v, label: `${v}×` }))} />
        </div>
        <div className="prop">
          <label>Camera height</label>
          <div className="row">
            <Slider value={height} min={-4} max={20} step={0.5} onChange={(v) => {
                setHeight(v)
                if (ctrl) ctrl.height = v
              }} label="Camera height offset" />
            <span className="tabular faint" style={{ width: 40 }}>
              {height > 0 ? '+' : ''}
              {height} m
            </span>
          </div>
        </div>
        <div className="prop">
          <label>Show path</label>
          <Switch on={show} onChange={(v) => {
              setShow(v)
              ctrl?.setShowPath(v)
            }} />
        </div>
      </div>
      <div className="section">
        <div className="section-head">
          <h3>Export video</h3>
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Records the whole route as a WebM video at 30 frames per second.
        </p>
        {droneState.recording ? (
          <button className="btn danger" onClick={() => ctrl?.stopRecording()}>
            <Square /> Stop recording
          </button>
        ) : (
          <button className="btn" onClick={() => void record()}>
            <Video /> Record walkthrough video
          </button>
        )}
      </div>
    </div>
  )
}
