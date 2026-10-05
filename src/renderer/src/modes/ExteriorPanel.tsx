import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Undo2, Maximize2, Moon } from 'lucide-react'
import { useProject, commit, getProject, undo } from '../state/store'
import { useUI } from '../state/ui'
import type { ArchitecturalStyle, Exterior, Project, RoofType } from '../core/model/types'
import { exteriorForStyle } from '../core/model/defaults'
import { MaterialPicker } from '../workspace/Inspector'
import { LengthField, Modal, Seg, Slider, Switch } from '../ui/primitives'
import { drawingSvg } from '../export/drawingsExport'
import type { ElevationSide } from '../export/elevation'
import { scaleWindows } from '../planner/openingsEdit'
import { planEdit, applyEditPlan, type EditResult } from '../ai/nlEditor'
import { presetTime } from '../engine/lighting/sun'
import { kelvinColor, getEngine, hasEngine } from '../engine/Engine'
import { spec } from '../core/constraints/rooms'
import { bbox } from '../core/geometry/polygon'
import { effectiveKind } from '../planner/walls'
import { formatLength } from '../core/units/units'

/**
 * EXTERIOR mode (§33, §34): live elevations drawn from the model, facade editing (materials,
 * cladding, windows, doors, balconies, columns, roof, lighting, boundary) and an AI exterior
 * request box that edits the real 3D model.
 */

const STYLE_LIST: { value: ArchitecturalStyle; label: string }[] = [
  { value: 'modern', label: 'Modern' },
  { value: 'contemporary', label: 'Contemporary' },
  { value: 'minimalist', label: 'Minimalist' },
  { value: 'pakistani_modern', label: 'Pakistani modern' },
  { value: 'traditional', label: 'Traditional' },
  { value: 'luxury', label: 'Luxury' },
  { value: 'islamic', label: 'Islamic' },
  { value: 'mediterranean', label: 'Mediterranean' },
  { value: 'european', label: 'European' },
  { value: 'colonial', label: 'Colonial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'farmhouse', label: 'Farmhouse' }
]

const upExt = (label: string, fn: (e: Exterior) => void, coalesce?: string) => commit(label, (d) => fn(d.exterior as Exterior), coalesce ? { coalesce } : undefined)

export function ExteriorPanel() {
  const project = useProject((s) => s.project)
  const ext = project.exterior
  const u = project.settings.units
  return (
    <div className="panel-scroll">
      <ElevationPreview project={project} />
      <AiExterior />
      <div className="section">
        <div className="section-head">
          <h3>Style</h3>
        </div>
        <div className="prop">
          <label>Architecture</label>
          <select className="field" value={ext.style} onChange={(e) => {
              const s = e.target.value as ArchitecturalStyle
              commit(`Style: ${s.replace('_', ' ')}`, (d) => {
                d.exterior = { ...exteriorForStyle(s), windowScale: d.exterior.windowScale }
                d.requirements.style = s
              }, { major: true })
            }}>
            {STYLE_LIST.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <p className="faint" style={{ fontSize: 12, margin: '6px 0 0' }}>
          Changing the style resets facade materials, roof and lighting to that style. Adjust them below.
        </p>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>Facade</h3>
        </div>
        <div className="prop">
          <label>Walls</label>
          <MaterialPicker project={project} value={ext.facadeMaterial} categories={['paint', 'stone', 'brick', 'concrete', 'marble', 'wood', 'metal', 'granite', 'porcelain']} onChange={(id) => upExt('Facade material', (e) => void (e.facadeMaterial = id))} />
        </div>
        <div className="prop">
          <label>Cladding</label>
          <MaterialPicker project={project} value={ext.accentMaterial} categories={['stone', 'brick', 'wood', 'marble', 'granite', 'concrete', 'metal', 'porcelain']} onChange={(id) => upExt('Cladding material', (e) => void (e.accentMaterial = id))} />
        </div>
        <div className="prop">
          <label>Cladding on</label>
          <select className="field" value={ext.accent} onChange={(e) => upExt('Cladding placement', (x) => void (x.accent = e.target.value as Exterior['accent']))}>
            <option value="none">Nowhere</option>
            <option value="front-feature">Front feature walls</option>
            <option value="entrance">Around the entrance</option>
            <option value="stair-tower">Stair tower</option>
            <option value="ground-floor">Whole ground floor</option>
          </select>
        </div>
        <div className="prop">
          <label>Second cladding</label>
          <MaterialPicker project={project} value={ext.accent2?.material ?? 'lib:wood-teak'} categories={['wood', 'stone', 'brick', 'marble', 'granite', 'concrete', 'metal', 'porcelain']} onChange={(id) => upExt('Second cladding material', (e) => void (e.accent2 = { material: id, placement: e.accent2?.placement ?? 'front-feature' }))} />
        </div>
        <div className="prop">
          <label>Second cladding on</label>
          <select className="field" value={ext.accent2?.placement ?? 'none'} onChange={(e) => upExt('Second cladding placement', (x) => void (x.accent2 = e.target.value === 'none' ? undefined : { material: x.accent2?.material ?? 'lib:wood-teak', placement: e.target.value as Exterior['accent'] }))}>
            <option value="none">Nowhere</option>
            <option value="front-feature">Front feature walls</option>
            <option value="entrance">Around the entrance</option>
            <option value="stair-tower">Stair tower</option>
            <option value="ground-floor">Whole ground floor</option>
          </select>
        </div>
        <div className="prop">
          <label>Plinth</label>
          <MaterialPicker project={project} value={ext.plinthMaterial} categories={['stone', 'granite', 'concrete', 'brick', 'marble']} onChange={(id) => upExt('Plinth material', (e) => void (e.plinthMaterial = id))} />
        </div>
        <div className="prop">
          <label>Entrance canopy</label>
          <Switch on={ext.entranceCanopy} onChange={(v) => upExt(v ? 'Add entrance canopy' : 'Remove entrance canopy', (e) => void (e.entranceCanopy = v))} label="Entrance canopy" />
        </div>
        <div className="prop">
          <label>Entrance pillars</label>
          <Switch on={!!ext.entrancePillars} onChange={(v) => upExt(v ? 'Add entrance pillars' : 'Remove entrance pillars', (e) => {
              e.entrancePillars = v
              if (v) e.entranceCanopy = true
            })} label="Entrance pillars" />
        </div>
      </div>

      <WindowsDoors project={project} />
      <BalconiesColumns project={project} />

      <div className="section">
        <div className="section-head">
          <h3>Roof</h3>
        </div>
        <div className="prop">
          <label>Type</label>
          <Seg<RoofType> value={ext.roofType} onChange={(v) => upExt(`Roof: ${v}`, (e) => {
              e.roofType = v
              if (v !== 'flat' && e.roofMaterial === 'lib:roof-membrane') e.roofMaterial = 'lib:roof-clay'
            })} options={[{ value: 'flat', label: 'Flat' }, { value: 'hip', label: 'Hip' }, { value: 'gable', label: 'Gable' }, { value: 'shed', label: 'Shed' }, { value: 'mansard', label: 'Mansard' }]} />
        </div>
        <div className="prop">
          <label>Covering</label>
          <MaterialPicker project={project} value={ext.roofMaterial} categories={['roof', 'metal', 'concrete']} onChange={(id) => upExt('Roof material', (e) => void (e.roofMaterial = id))} />
        </div>
        {ext.roofType === 'flat' && (
          <div className="prop">
            <label>Parapet height</label>
            <LengthField value={ext.parapetHeight} units={u} min={0.6} max={1.8} onCommit={(v) => commit('Parapet height', (d) => {
                d.exterior.parapetHeight = v
                for (const f of d.floors) for (const w of f.walls) if (effectiveKind(w) === 'parapet') w.height = v
              })} />
          </div>
        )}
      </div>

      <ExteriorLighting project={project} />

      <div className="section">
        <div className="section-head">
          <h3>Boundary wall</h3>
          <div className="actions">
            <Switch on={project.plot.boundaryWall.enabled} onChange={(v) => commit(v ? 'Add boundary wall' : 'Remove boundary wall', (d) => void (d.plot.boundaryWall.enabled = v))} label="Boundary wall" />
          </div>
        </div>
        {project.plot.boundaryWall.enabled && (
          <>
            <div className="prop">
              <label>Height</label>
              <LengthField value={project.plot.boundaryWall.height} units={u} min={0.9} max={3.6} onCommit={(v) => commit('Boundary wall height', (d) => void (d.plot.boundaryWall.height = v))} />
            </div>
            <div className="prop">
              <label>Finish</label>
              <MaterialPicker project={project} value={project.plot.boundaryWall.material} fallback={ext.facadeMaterial} categories={['paint', 'stone', 'brick', 'concrete']} onChange={(id) => commit('Boundary wall finish', (d) => void (d.plot.boundaryWall.material = id))} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ── live elevation preview ──────────────────────────────────────────────── */

function ElevationPreview({ project }: { project: Project }) {
  const [side, setSide] = useState<ElevationSide>('front')
  const [big, setBig] = useState(false)
  const house = useMemo(() => ({ plot: project.plot, floors: project.floors, site: project.site, exterior: project.exterior, materials: project.materials, settings: project.settings }), [project.plot, project.floors, project.site, project.exterior, project.materials, project.settings])
  const [src, setSrc] = useState('')
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const svg = drawingSvg(getProject(), { id: `elev-${side}`, kind: 'elevation', side, title: '', number: '' }, true, big ? 1400 : 560)
        setSrc('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg))
      } catch (e) {
        console.error(e)
        setSrc('')
      }
    }, 80)
    return () => clearTimeout(t)
  }, [house, side, big])
  return (
    <div className="section">
      <div className="section-head">
        <h3>Elevations</h3>
        <div className="actions">
          <button className="icon-btn" aria-label="Enlarge" data-tip="Enlarge" onClick={() => setBig(true)}>
            <Maximize2 />
          </button>
        </div>
      </div>
      <Seg full value={side} onChange={setSide} options={[{ value: 'front', label: 'Front' }, { value: 'rear', label: 'Rear' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />
      <div style={{ marginTop: 8, background: '#fff', borderRadius: 4, border: '1px solid var(--line)', minHeight: 120, display: 'grid', placeItems: 'center', cursor: 'zoom-in' }} onClick={() => setBig(true)}>
        {src ? <img src={src} alt={`${side} elevation`} style={{ width: '100%', display: 'block' }} /> : <span className="faint">Drawing…</span>}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <span className="faint grow" style={{ fontSize: 11 }}>
          Drawn from the model; updates as you edit.
        </span>
        <button className="btn sm" onClick={() => useUI.getState().openDialog('export', { preset: 'drawings' })}>
          Export drawings
        </button>
      </div>
      {big && (
        <Modal title={`${side[0].toUpperCase() + side.slice(1)} elevation`} size="xwide" onClose={() => setBig(false)}>
          <Seg value={side} onChange={setSide} options={[{ value: 'front', label: 'Front' }, { value: 'rear', label: 'Rear' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />
          <div style={{ marginTop: 10, background: '#fff', borderRadius: 4 }}>{src && <img src={src} alt="" style={{ width: '100%', display: 'block' }} />}</div>
        </Modal>
      )}
    </div>
  )
}

/* ── AI exterior generator (§34) ─────────────────────────────────────────── */

function AiExterior() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<EditResult | null>(null)
  const run = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      const plan = await planEdit(text)
      const r = await applyEditPlan(plan, `Exterior: ${text.length > 40 ? text.slice(0, 38) + '…' : text}`)
      setRes(r)
      if (hasEngine()) getEngine().setCameraPreset('facade')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="section">
      <div className="section-head">
        <h3>Describe the exterior</h3>
      </div>
      <textarea className="field" rows={3} style={{ height: 'auto', resize: 'vertical', padding: '6px 8px' }} placeholder="Make the front elevation more modern with large glass windows, stone cladding and vertical lighting." value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && void run()} aria-label="Describe the exterior" />
      <div className="row" style={{ marginTop: 8 }}>
        <span className="faint grow" style={{ fontSize: 11 }}>
          Changes the real model: materials, windows, roof, lighting.
        </span>
        <button className="btn primary sm" disabled={busy || !text.trim()} onClick={() => void run()}>
          <Sparkles size={13} /> {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>
      {res && (
        <div className="msg ai" style={{ marginTop: 10, maxWidth: '100%', fontSize: 12 }}>
          {res.message}
          {(res.changes.length > 0 || res.areaChanges.length > 0) && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => {
                  undo()
                  setRes(null)
                }}>
                <Undo2 size={13} /> Undo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── windows, doors ──────────────────────────────────────────────────────── */

function WindowsDoors({ project }: { project: Project }) {
  const ext = project.exterior
  const mainDoors = project.floors.flatMap((f) => f.openings.filter((o) => o.style === 'main').map((o) => ({ f, o })))
  const u = project.settings.units
  const scale = (k: number, label: string) => commit(label, (d) => {
    scaleWindows(d.floors, k)
    d.exterior.windowScale = Math.max(0.5, Math.min(2, d.exterior.windowScale * k))
  })
  const frontGlass = () =>
    commit('Full-height glass on the front', (d) => {
      const D = d.plot.depth
      for (const f of d.floors) {
        if (f.kind === 'roof' || f.level < 0) continue
        for (const o of f.openings) {
          if (o.kind !== 'window') continue
          const w = f.walls.find((x) => x.id === o.wallId)
          if (!w || effectiveKind(w) !== 'exterior') continue
          const facesFront = Math.abs(w.a.y - w.b.y) < 0.05 && Math.max(w.a.y, w.b.y) > D * 0.4
          const room = f.rooms.find((r) => {
            const b = bbox(r.polygon)
            const m = { x: w.a.x + ((w.b.x - w.a.x) * o.offset) / Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), y: w.a.y }
            return m.x > b.x - 0.3 && m.x < b.x + b.w + 0.3 && Math.abs(m.y - b.y - b.h) < 0.4
          })
          if (!facesFront || !room || spec(room.type).wet) continue
          o.style = 'full-height'
          o.sill = 0.05
          o.height = Math.min(2.7, f.height - f.slabThickness - 0.3)
        }
      }
    })
  return (
    <div className="section">
      <div className="section-head">
        <h3>Windows and doors</h3>
        <span className="sub tabular">{Math.round(ext.windowScale * 100)}% size</span>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className="btn sm" onClick={() => scale(0.85, 'Smaller windows')}>
          Smaller
        </button>
        <button className="btn sm" onClick={() => scale(1.15, 'Larger windows')}>
          Larger
        </button>
        <button className="btn sm" onClick={frontGlass} data-tip="Living rooms and bedrooms facing the road get floor-to-ceiling glass">
          Full-height glass at front
        </button>
      </div>
      <div className="prop">
        <label>Frames</label>
        <MaterialPicker project={project} value={ext.windowFrameMaterial} categories={['metal', 'wood', 'paint']} onChange={(id) => upExt('Window frames', (e) => void (e.windowFrameMaterial = id))} />
      </div>
      {mainDoors.map(({ f, o }) => (
        <div key={o.id}>
          <div className="prop">
            <label>Main door</label>
            <MaterialPicker project={project} value={o.leafMaterial} fallback="lib:wood-walnut" categories={['wood', 'metal', 'glass', 'paint']} onChange={(id) => commit('Main door finish', (d) => void (d.floors.find((x) => x.id === f.id)!.openings.find((x) => x.id === o.id)!.leafMaterial = id))} />
          </div>
          <div className="prop">
            <label>Door width</label>
            <LengthField value={o.width} units={u} min={0.9} max={2.4} onCommit={(v) => commit('Main door width', (d) => void (d.floors.find((x) => x.id === f.id)!.openings.find((x) => x.id === o.id)!.width = v))} />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── balconies & columns ─────────────────────────────────────────────────── */

function BalconiesColumns({ project }: { project: Project }) {
  const ext = project.exterior
  const u = project.settings.units
  const balconies = project.floors.flatMap((f) => f.rooms.filter((r) => r.type === 'balcony' || r.type === 'terrace').map((r) => ({ f, r })))
  const exposed = project.floors.flatMap((f) => f.columns.filter((c) => c.exposed))
  return (
    <div className="section">
      <div className="section-head">
        <h3>Balconies and columns</h3>
      </div>
      {balconies.length ? (
        <div className="list" style={{ marginBottom: 10 }}>
          {balconies.map(({ f, r }) => {
            const b = bbox(r.polygon)
            return (
              <div key={r.id} className="list-item" onClick={() => {
                  useUI.getState().set({ floorId: f.id, selection: [{ kind: 'room', id: r.id, floorId: f.id }], surface: { kind: 'roomFloor', floorId: f.id, roomId: r.id } })
                  if (hasEngine()) getEngine().setCameraPreset('facade')
                }}>
                <span className="grow">
                  {r.name} <span className="faint">({f.name.toLowerCase()})</span>
                </span>
                <span className="meta tabular">
                  {formatLength(b.w, u)} × {formatLength(b.h, u)}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 12 }}>
          No balconies. Draw one on an upper floor with the Room tool and set its type to Balcony; railings are added automatically.
        </p>
      )}
      <div className="prop">
        <label>Column style</label>
        <Seg value={ext.columnStyle} onChange={(v) => commit(`Columns: ${v}`, (d) => {
            d.exterior.columnStyle = v
            for (const f of d.floors) for (const c of f.columns) if (c.exposed) c.shape = v === 'round' ? 'round' : 'rect'
          })} options={[{ value: 'square', label: 'Square' }, { value: 'round', label: 'Round' }, { value: 'classical', label: 'Classical' }]} />
      </div>
      <div className="prop">
        <label>Column finish</label>
        <MaterialPicker project={project} value={exposed[0]?.material} fallback={ext.facadeMaterial} categories={['paint', 'stone', 'marble', 'concrete', 'wood', 'metal']} onChange={(id) => commit('Column finish', (d) => {
            for (const f of d.floors) for (const c of f.columns) if (c.exposed) c.material = id
          })} />
      </div>
      <div className="faint" style={{ fontSize: 11 }}>
        {exposed.length} exposed column{exposed.length === 1 ? '' : 's'} (porches and car porch). Resize them in the 2D plan.
      </div>
    </div>
  )
}

/* ── lighting ────────────────────────────────────────────────────────────── */

function ExteriorLighting({ project }: { project: Project }) {
  const L = project.exterior.lighting
  const set = (label: string, fn: (l: Exterior['lighting']) => void, co?: string) => upExt(label, (e) => fn(e.lighting), co)
  const night = () =>
    commit('Lighting: night', (d) => {
      d.settings.lighting.preset = 'night'
      d.settings.lighting.time = presetTime('night', d.settings.lighting.latitude, d.settings.lighting.dayOfYear)
      d.settings.lighting.exteriorLights = true
    })
  return (
    <div className="section">
      <div className="section-head">
        <h3>Exterior lighting</h3>
        <div className="actions">
          <button className="btn sm" onClick={night}>
            <Moon size={13} /> See at night
          </button>
        </div>
      </div>
      {(
        [
          ['facadeWash', 'Facade wash lights'],
          ['verticalStrips', 'Vertical strip lights'],
          ['gardenLights', 'Garden lights'],
          ['gateLights', 'Gate pillar lights']
        ] as const
      ).map(([k, label]) => (
        <div key={k} className="prop">
          <label>{label}</label>
          <Switch on={L[k]} onChange={(v) => set(label, (l) => void (l[k] = v))} label={label} />
        </div>
      ))}
      <div className="prop">
        <label>Light colour</label>
        <div className="row grow" style={{ gap: 8 }}>
          <span className="swatch" style={{ background: kelvinColor(L.temperature), borderRadius: '50%' }} />
          <Slider value={L.temperature} min={2200} max={6500} step={100} label="Exterior light colour" onChange={(v) => set('Exterior light colour', (l) => void (l.temperature = v), 'ext-temp')} />
          <span className="tabular faint" style={{ width: 44, textAlign: 'right', fontSize: 12 }}>
            {L.temperature}K
          </span>
        </div>
      </div>
    </div>
  )
}
