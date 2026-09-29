import { useProject, commit } from '../state/store'
import { useUI } from '../state/ui'
import { formatLength, formatAreaFor, GRID_PRESETS_IMPERIAL, GRID_PRESETS_METRIC, parseLength, inputUnit } from '../core/units/units'
import { bbox, area } from '../core/geometry/polygon'
import { segLength } from '../core/geometry/segment'
import type { Floor, UnitSystem, Project } from '../core/model/types'
import { setRoomSize } from '../planner/operations'
import { areaSummary } from '../planner/metrics'
import { houseOf } from '../app/actions'
import { useEffect, useState } from 'react'

export function StatusBar() {
  const project = useProject((s) => s.project)
  const sel = useUI((s) => s.selection)
  const floorId = useUI((s) => s.floorId)
  const uiMode = useUI((s) => s.uiMode)
  const cursor = useUI((s) => s.cursor)
  const mode = useUI((s) => s.mode)
  const u = project.settings.units
  const floor = project.floors.find((f) => f.id === floorId)
  const s = project.settings
  const ref = sel.length === 1 ? sel[0] : null
  const toggle = (k: keyof typeof s.snap) => commit(`Snapping ${k}`, (d) => void (d.settings.snap[k] = !d.settings.snap[k]))
  const grids = u === 'm' || u === 'cm' ? GRID_PRESETS_METRIC : GRID_PRESETS_IMPERIAL
  return (
    <footer className="statusbar" aria-label="Properties and dimensions">
      {ref && floor ? <Selection project={project} floor={floor} refKind={ref.kind} id={ref.id} /> : <Overview project={project} floor={floor} />}
      <div className="grow" />
      {uiMode === 'advanced' && cursor && mode === 'plan' && (
        <span className="tabular faint">
          X {formatLength(cursor.x, u)} Y {formatLength(cursor.y, u)}
        </span>
      )}
      {mode === 'plan' && (
        <>
          <div className="vsep" />
          <span className="faint">Snap</span>
          <div className="snaps">
            {(
              [
                ['grid', 'Grid'],
                ['walls', 'Walls'],
                ['objects', 'Objects'],
                ['guides', 'Guides'],
                ['dimensions', 'Dimensions']
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={s.snap[k] ? 'on' : ''} onClick={() => toggle(k)} aria-pressed={s.snap[k]}>
                {l}
              </button>
            ))}
          </div>
          <select className="field" style={{ width: 96, height: 22, fontSize: 12 }} value={grids.some((g) => Math.abs(g.value - s.grid) < 1e-6) ? String(s.grid) : 'custom'} aria-label="Grid size" onChange={(e) => {
              if (e.target.value === 'custom') {
                const v = parseLength(prompt('Grid spacing (e.g. 9in, 0.25m)') ?? '', inputUnit(u))
                if (v && v > 0.005) commit('Grid size', (d) => void (d.settings.grid = v))
              } else commit('Grid size', (d) => void (d.settings.grid = Number(e.target.value)))
            }}>
            {grids.map((g) => (
              <option key={g.label} value={g.value}>
                Grid {g.label}
              </option>
            ))}
            <option value="custom">{grids.some((g) => Math.abs(g.value - s.grid) < 1e-6) ? 'Custom…' : `Grid ${formatLength(s.grid, u)}`}</option>
          </select>
        </>
      )}
      <select className="field" style={{ width: 88, height: 22, fontSize: 12 }} value={u} aria-label="Units" onChange={(e) => commit('Units', (d) => void (d.settings.units = e.target.value as UnitSystem))}>
        <option value="ft-in">ft-in</option>
        <option value="ft">feet</option>
        <option value="m">meters</option>
        <option value="cm">cm</option>
      </select>
    </footer>
  )
}

function Overview({ project, floor }: { project: Project; floor?: Floor }) {
  const u = project.settings.units
  const a = areaSummary(houseOf(project))
  return (
    <>
      <span className="sel-name">{floor?.name ?? 'House'} floor</span>
      <span className="dim">
        <b>Floor area</b> {formatAreaFor(a.floorAreas.find((f) => f.floorId === floor?.id)?.area ?? 0, u)}
      </span>
      <span className="dim">
        <b>Covered</b> {formatAreaFor(a.coveredArea, u)}
      </span>
      <span className="dim">
        <b>Open</b> {formatAreaFor(a.openArea, u)}
      </span>
      <span className="dim">
        <b>Plot</b> {formatAreaFor(a.plotArea, u)}
      </span>
      {floor && (
        <span className="dim">
          <b>Floor height</b> {formatLength(floor.height, u)}
        </span>
      )}
    </>
  )
}

function Selection({ project, floor, refKind, id }: { project: Project; floor: Floor; refKind: string; id: string }) {
  const u = project.settings.units
  if (refKind === 'room') {
    const r = floor.rooms.find((x) => x.id === id)
    if (!r) return null
    const b = bbox(r.polygon)
    return (
      <>
        <span className="sel-name">{r.name}</span>
        <DimInput label="W" value={b.w} units={u} onCommit={(v) => commit(`Set ${r.name} width`, (d) => void setRoomSize(d.floors.find((f) => f.id === floor.id) as Floor, id, 'x', v, d.settings))} />
        <DimInput label="L" value={b.h} units={u} onCommit={(v) => commit(`Set ${r.name} length`, (d) => void setRoomSize(d.floors.find((f) => f.id === floor.id) as Floor, id, 'y', v, d.settings))} />
        <DimInput label="H" value={r.ceilingHeight ?? floor.height - floor.slabThickness} units={u} onCommit={(v) => commit(`Set ${r.name} ceiling`, (d) => void ((d.floors.find((f) => f.id === floor.id) as Floor).rooms.find((x) => x.id === id)!.ceilingHeight = v))} />
        <span className="dim">
          <b>Area</b> {formatAreaFor(area(r.polygon), u)}
        </span>
      </>
    )
  }
  if (refKind === 'wall') {
    const w = floor.walls.find((x) => x.id === id)
    if (!w) return null
    return (
      <>
        <span className="sel-name">Wall</span>
        <span className="dim">
          <b>Length</b> {formatLength(segLength(w.a, w.b), u)}
        </span>
        <DimInput label="Thickness" value={w.thickness} units={u} onCommit={(v) => commit('Wall thickness', (d) => {
            const x = (d.floors.find((f) => f.id === floor.id) as Floor).walls.find((q) => q.id === id)!
            x.thickness = v
            x.thicknessLocked = true
          })} />
        <DimInput label="Height" value={w.height ?? floor.height} units={u} onCommit={(v) => commit('Wall height', (d) => void ((d.floors.find((f) => f.id === floor.id) as Floor).walls.find((q) => q.id === id)!.height = v))} />
      </>
    )
  }
  if (refKind === 'opening') {
    const o = floor.openings.find((x) => x.id === id)
    if (!o) return null
    const upd = (label: string, fn: (x: NonNullable<typeof o>) => void) => commit(label, (d) => fn((d.floors.find((f) => f.id === floor.id) as Floor).openings.find((q) => q.id === id)!))
    return (
      <>
        <span className="sel-name">{o.kind === 'door' ? 'Door' : 'Window'}</span>
        <DimInput label="W" value={o.width} units={u} onCommit={(v) => upd('Opening width', (x) => void (x.width = v))} />
        <DimInput label="H" value={o.height} units={u} onCommit={(v) => upd('Opening height', (x) => void (x.height = v))} />
        {o.kind === 'window' && <DimInput label="Sill" value={o.sill} units={u} onCommit={(v) => upd('Sill height', (x) => void (x.sill = v))} />}
      </>
    )
  }
  if (refKind === 'furniture') {
    const f = floor.furniture.find((x) => x.id === id)
    if (!f) return null
    const upd = (label: string, fn: (x: NonNullable<typeof f>) => void) => commit(label, (d) => fn((d.floors.find((q) => q.id === floor.id) as Floor).furniture.find((q) => q.id === id)!))
    return (
      <>
        <span className="sel-name">{f.label ?? f.type}</span>
        <DimInput label="W" value={f.width} units={u} onCommit={(v) => upd('Resize furniture', (x) => void (x.width = v))} />
        <DimInput label="D" value={f.depth} units={u} onCommit={(v) => upd('Resize furniture', (x) => void (x.depth = v))} />
        <DimInput label="H" value={f.height} units={u} onCommit={(v) => upd('Resize furniture', (x) => void (x.height = v))} />
        <span className="dim">
          <b>Rotation</b> {Math.round((f.rotation * 180) / Math.PI)}°
        </span>
      </>
    )
  }
  return <span className="sel-name">{refKind}</span>
}

function DimInput(props: { label: string; value: number; units: UnitSystem; onCommit: (v: number) => void }) {
  const [text, setText] = useState(formatLength(props.value, props.units))
  const [focus, setFocus] = useState(false)
  useEffect(() => {
    if (!focus) setText(formatLength(props.value, props.units))
  }, [props.value, props.units, focus])
  return (
    <label className="dim">
      <b>{props.label}</b>
      <input
        value={text}
        onFocus={(e) => {
          setFocus(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          setFocus(false)
          const v = parseLength(text, inputUnit(props.units))
          if (v && v > 0.05 && Math.abs(v - props.value) > 1e-4) props.onCommit(v)
          else setText(formatLength(props.value, props.units))
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}
