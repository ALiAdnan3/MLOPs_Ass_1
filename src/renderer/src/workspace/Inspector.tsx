import { useMemo, useState } from 'react'
import { TriangleAlert, CircleAlert, Info, RotateCcw, Copy, GitCompare, Eye, EyeOff, CircleCheck } from 'lucide-react'
import { useProject, commit } from '../state/store'
import { useUI, type RightTab } from '../state/ui'
import type { Floor, LayerKey, Project, Room, RoomType } from '../core/model/types'
import { spec, ROOM_TYPE_GROUPS } from '../core/constraints/rooms'
import { bbox, area, pointInPolygon } from '../core/geometry/polygon'
import { formatLength, formatAreaFor } from '../core/units/units'
import { LengthField, NumberField, Seg, Switch, Slider } from '../ui/primitives'
import { setRoomSize, refurnishRoom, setFloorHeight } from '../planner/operations'
import { validateHouse, type Issue } from '../planner/validation'
import { areaSummary, designStats } from '../planner/metrics'
import { createVersion, restoreVersion, duplicateVersion, houseOf } from '../app/actions'
import { resolveMaterial, materialSwatch, LIBRARY } from '../core/materials/library'
import { catalogItem } from '../core/furniture/catalog'
import { wallsOfRoom, effectiveKind } from '../planner/walls'
import { segLength } from '../core/geometry/segment'
import { EstimatePanel } from './EstimatePanel'
import { useMaterialThumb, thumbStyle } from '../render/materialThumb'
import { lightsForRoom } from '../planner/services'
import { MaterialsPanel } from '../modes/MaterialsPanel'
import { RoomDesigner } from '../modes/RoomDesigner'
import { ExteriorPanel } from '../modes/ExteriorPanel'
import { WalkPanel } from '../modes/WalkPanel'
import { DronePanel } from '../modes/DronePanel'
import { SketchPanel } from '../modes/SketchPanel'
import { View3DPanel } from '../modes/View3DPanel'
import { CompareVersionsDialog } from '../dialogs/CompareVersions'
import type { StairType, RailingType, WallKind, DoorStyle, WindowStyle } from '../core/model/types'
import { floorOf } from '../editor/commands'

const TABS: { key: RightTab; label: string }[] = [
  { key: 'properties', label: 'Details' },
  { key: 'layers', label: 'Layers' },
  { key: 'validation', label: 'Issues' },
  { key: 'areas', label: 'Areas' },
  { key: 'versions', label: 'Versions' },
  { key: 'estimate', label: 'Cost' }
]

export function Inspector() {
  const open = useUI((s) => s.inspectorOpen)
  const mode = useUI((s) => s.mode)
  const tab = useUI((s) => s.rightTab)
  const set = useUI((s) => s.set)
  const project = useProject((s) => s.project)
  const issues = useMemo(() => validateHouse(houseOf(project)), [project.floors, project.site, project.plot]) // eslint-disable-line react-hooks/exhaustive-deps
  const errs = issues.filter((i) => i.severity === 'error').length
  if (mode === 'present') return null
  const modePanel =
    mode === 'materials' ? <MaterialsPanel /> : mode === 'interior' ? <RoomDesigner /> : mode === 'exterior' ? <ExteriorPanel /> : mode === 'walk' ? <WalkPanel /> : mode === 'drone' ? <DronePanel /> : mode === 'sketch' ? <SketchPanel /> : null
  return (
    <aside className={`inspector ${open ? '' : 'closed'}`} aria-label="Inspector">
      {modePanel ?? (
        <>
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => set({ rightTab: t.key })}>
                {t.label}
                {t.key === 'validation' && errs > 0 && <span className="count">{errs}</span>}
              </button>
            ))}
          </div>
          <div className="panel-scroll">
            {tab === 'properties' && (mode === '3d' ? <View3DPanel /> : null)}
            {tab === 'properties' && <Properties />}
            {tab === 'layers' && <Layers />}
            {tab === 'validation' && <Issues issues={issues} />}
            {tab === 'areas' && <Areas />}
            {tab === 'versions' && <Versions />}
            {tab === 'estimate' && <EstimatePanel />}
          </div>
        </>
      )}
    </aside>
  )
}

/* ── Properties ───────────────────────────────────────────────────────────── */

export function Properties() {
  const project = useProject((s) => s.project)
  const sel = useUI((s) => s.selection)
  const floorId = useUI((s) => s.floorId)
  const floor = project.floors.find((f) => f.id === floorId)
  if (!floor) return null
  if (sel.length > 1)
    return (
      <div className="section">
        <div className="section-head">
          <h3>{sel.length} items selected</h3>
        </div>
        <p className="muted">Move them together by dragging, delete with Del, or duplicate with Ctrl+D.</p>
      </div>
    )
  const ref = sel[0]
  if (!ref) return <FloorProps project={project} floor={floor} />
  const f = (floorOf(project, ref) as Floor | undefined) ?? floor
  switch (ref.kind) {
    case 'room': {
      const r = f.rooms.find((x) => x.id === ref.id)
      return r ? <RoomProps project={project} floor={f} room={r} /> : null
    }
    case 'wall':
      return <WallProps project={project} floor={f} id={ref.id} />
    case 'opening':
      return <OpeningProps project={project} floor={f} id={ref.id} />
    case 'furniture':
      return <FurnitureProps project={project} floor={f} id={ref.id} />
    case 'stair':
      return <StairProps project={project} floor={f} id={ref.id} />
    case 'column':
      return <ColumnProps project={project} floor={f} id={ref.id} />
    case 'siteArea':
      return <SiteAreaProps project={project} id={ref.id} />
    case 'siteObject':
      return <SiteObjectProps project={project} id={ref.id} />
    default:
      return <FloorProps project={project} floor={floor} />
  }
}

const upFloor = (floorId: string, label: string, fn: (f: Floor) => void, coalesce?: string) => commit(label, (d) => fn(d.floors.find((x) => x.id === floorId) as Floor), coalesce ? { coalesce } : undefined)

function FloorProps({ project, floor }: { project: Project; floor: Floor }) {
  const u = project.settings.units
  const a = areaSummary(houseOf(project))
  const st = designStats(houseOf(project))
  const uiMode = useUI((s) => s.uiMode)
  return (
    <>
      <div className="section">
        <div className="section-head">
          <h3>{floor.name} floor</h3>
          <span className="sub">{floor.rooms.length} rooms</span>
        </div>
        <div className="prop">
          <label>Floor height</label>
          <LengthField value={floor.height} units={u} min={2.4} max={6} onCommit={(v) => commit(`Set ${floor.name} height`, (d) => setFloorHeight(d as Project, floor.id, v), { major: true })} tip="Floor-to-floor height; the 3D model and stairs update" />
        </div>
        {uiMode === 'advanced' && (
          <div className="prop">
            <label>Slab thickness</label>
            <LengthField value={floor.slabThickness} units={u} min={0.1} max={0.4} onCommit={(v) => upFloor(floor.id, 'Slab thickness', (f) => void (f.slabThickness = v))} />
          </div>
        )}
        <div className="prop">
          <label>Visible</label>
          <Switch on={floor.visible} onChange={(v) => upFloor(floor.id, v ? 'Show floor' : 'Hide floor', (f) => void (f.visible = v))} />
        </div>
      </div>
      <div className="section">
        <div className="section-head">
          <h3>House</h3>
        </div>
        <div className="stat-grid">
          <Stat k="Covered area" v={formatAreaFor(a.coveredArea, u)} />
          <Stat k="Total floor area" v={formatAreaFor(a.totalFloorArea, u)} />
          <Stat k="Bedrooms" v={String(st.bedrooms)} />
          <Stat k="Bathrooms" v={String(st.bathrooms)} />
          <Stat k="Parking" v={`${st.parking} cars`} />
          <Stat k="Garden" v={formatAreaFor(a.gardenArea, u)} />
        </div>
      </div>
      <div className="section">
        <p className="muted">Select a room, wall, door, window or piece of furniture to see and edit its details. Double-click a room to rename it.</p>
      </div>
    </>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat">
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  )
}

export function MaterialPicker(props: { value?: string; fallback?: string; onChange: (id: string) => void; categories?: string[]; project: Project }) {
  const id = props.value ?? props.fallback
  const m = resolveMaterial(id, props.project.materials)
  const all = [...props.project.materials, ...LIBRARY].filter((x) => !props.categories || props.categories.includes(x.category))
  const url = useMaterialThumb(m)
  return (
    <div className="row mat-pick" style={{ gap: 6 }}>
      <span className="swatch lg" style={thumbStyle(m, url)} />
      <select className="field" value={id ?? ''} onChange={(e) => props.onChange(e.target.value)}>
        {all.map((x) => (
          <option key={x.id} value={x.id}>
            {x.source === 'library' ? '' : '★ '}
            {x.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function RoomProps({ project, floor, room }: { project: Project; floor: Floor; room: Room }) {
  const u = project.settings.units
  const b = bbox(room.polygon)
  const sp = spec(room.type)
  const upRoom = (label: string, fn: (r: Room) => void, coalesce?: string) => upFloor(floor.id, label, (f) => fn(f.rooms.find((x) => x.id === room.id)!), coalesce)
  const segs = wallsOfRoom(floor, room)
  const inRoom = (o: { wallId: string; offset: number }) => segs.some((w) => w.wall.id === o.wallId && o.offset >= w.t0 - 0.01 && o.offset <= w.t1 + 0.01)
  const doors = floor.openings.filter((o) => o.kind === 'door' && inRoom(o))
  const windows = floor.openings.filter((o) => o.kind === 'window' && inRoom(o))
  const furniture = floor.furniture.filter((x) => pointInPolygon(x.position, room.polygon))
  const groups = new Map<string, number>()
  for (const f of furniture) {
    const n = catalogItem(f.type)?.name ?? f.type
    groups.set(n, (groups.get(n) ?? 0) + 1)
  }
  const lights = new Map<string, number>()
  const LIGHT_NAMES: Record<string, string> = { downlight: 'Ceiling lights', light: 'Ceiling light', chandelier: 'Chandelier', pendant: 'Pendant lights', cove: 'Cove lighting', 'wall-light': 'Wall lights' }
  for (const l of lightsForRoom(room)) {
    const n = LIGHT_NAMES[l.kind] ?? l.kind
    lights.set(n, (lights.get(n) ?? 0) + 1)
  }
  const lamps = furniture.filter((f) => f.type === 'floor-lamp').length
  if (lamps) lights.set('Floor lamps', lamps)
  const lightOn = room.lighting?.on !== false
  const furnishOn = furniture.length > 0
  const height = room.ceilingHeight ?? floor.height - floor.slabThickness
  return (
    <>
      <div className="section selected-head">
        <div className="faint" style={{ fontSize: 11 }}>Selected</div>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="field room-title"
            value={room.name}
            aria-label="Room name"
            onChange={(e) =>
              upRoom(
                'Rename room',
                (r) => {
                  r.name = e.target.value
                  r.autoName = false
                },
                `name-${room.id}`
              )
            }
          />
          <select className="field" style={{ width: 128 }} value={room.type} onChange={(e) => upRoom('Change room type', (r) => void (r.type = e.target.value as RoomType))} aria-label="Room type">
            {ROOM_TYPE_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.types.map((t) => (
                  <option key={t} value={t}>
                    {spec(t).label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
          {floor.name} floor, {sp.label}
        </div>
      </div>
      <div className="section">
        <div className="section-head">
          <h3>Dimensions</h3>
        </div>
        <div className="dim-table">
          <label>Length</label>
          <LengthField value={b.h} units={u} min={0.6} onCommit={(v) => upFloor(floor.id, `Set ${room.name} length`, (f) => void setRoomSize(f, room.id, 'y', v, project.settings))} tip="Neighbouring rooms adjust" />
          <label>Width</label>
          <LengthField value={b.w} units={u} min={0.6} onCommit={(v) => upFloor(floor.id, `Set ${room.name} width`, (f) => void setRoomSize(f, room.id, 'x', v, project.settings))} tip="Neighbouring rooms adjust" />
          <label>Area</label>
          <span className="tabular dim-ro">{formatAreaFor(area(room.polygon), u)}</span>
          <label>Height</label>
          <LengthField value={height} units={u} min={2.2} max={8} onCommit={(v) => upRoom('Ceiling height', (r) => void (r.ceilingHeight = v))} tip="Clear ceiling height" />
        </div>
      </div>
      <div className="section">
        <div className="section-head">
          <h3>Room settings</h3>
        </div>
        <div className="mat-row">
          <label>Floor material</label>
          <MaterialPicker project={project} value={room.floorMaterial} fallback={sp.floorFinish} onChange={(id) => upRoom('Floor material', (r) => void (r.floorMaterial = id))} />
        </div>
        <div className="mat-row">
          <label>Wall material</label>
          <MaterialPicker project={project} value={room.wallMaterial} fallback={sp.wallFinish} onChange={(id) => upRoom('Wall material', (r) => void (r.wallMaterial = id))} />
        </div>
        <div className="mat-row">
          <label>Ceiling</label>
          <Seg full value={room.ceilingType ?? 'flat'} onChange={(v) => upRoom('Ceiling type', (r) => void (r.ceilingType = v))} options={[{ value: 'flat', label: 'Flat' }, { value: 'false-ceiling', label: 'False ceiling' }, { value: 'cove', label: 'Cove' }]} />
        </div>
        <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => useUI.getState().set({ mode: 'materials', surface: { kind: 'roomFloor', floorId: floor.id, roomId: room.id } })}>
          Change material
        </button>
      </div>
      <div className="section">
        <div className="section-head">
          <h3>Furniture</h3>
          <div className="actions">
            <Switch
              on={furnishOn}
              label="Furniture"
              onChange={(v) =>
                upFloor(floor.id, v ? `Furnish ${room.name}` : `Clear ${room.name}`, (f) => {
                  if (v) refurnishRoom(f, room.id, project.requirements.preferences.luxury)
                  else f.furniture = f.furniture.filter((x) => !pointInPolygon(x.position, room.polygon))
                })
              }
            />
          </div>
        </div>
        {groups.size ? (
          <div className="count-list">
            {[...groups.entries()].map(([n, c]) => (
              <div key={n} className="count-row">
                <span>{n}</span>
                <span className="tabular">{c}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="faint" style={{ fontSize: 12, margin: 0 }}>
            Empty. Switch on to furnish it automatically.
          </p>
        )}
      </div>
      <div className="section">
        <div className="section-head">
          <h3>Lighting</h3>
          <div className="actions">
            <Switch
              on={lightOn}
              label="Lighting"
              onChange={(v) => upRoom(v ? 'Lights on' : 'Lights off', (r) => void (r.lighting = { on: v, fixture: r.lighting?.fixture ?? 'downlights', intensity: r.lighting?.intensity ?? 1, temperature: r.lighting?.temperature ?? 3000 }))}
            />
          </div>
        </div>
        <div className="count-list">
          {[...lights.entries()].map(([n, c]) => (
            <div key={n} className="count-row">
              <span>{n}</span>
              <span className="tabular">{c}</span>
            </div>
          ))}
          <div className="count-row faint">
            <span>Doors and windows</span>
            <span className="tabular">
              {doors.length} / {windows.length}
            </span>
          </div>
        </div>
      </div>
      <div className="section" style={{ borderBottom: 'none' }}>
        <button className="btn primary big" style={{ width: '100%' }} onClick={() => useUI.getState().set({ mode: 'interior', selection: [{ kind: 'room', id: room.id, floorId: floor.id }] })}>
          Edit room
        </button>
        <UseAdvanced>
          <div className="faint tabular" style={{ fontSize: 11, marginTop: 8 }}>
            X {formatLength(b.x, u)}, Y {formatLength(b.y, u)}
          </div>
        </UseAdvanced>
      </div>
    </>
  )
}

function UseAdvanced({ children }: { children: React.ReactNode }) {
  const m = useUI((s) => s.uiMode)
  return m === 'advanced' ? <>{children}</> : null
}

function WallProps({ project, floor, id }: { project: Project; floor: Floor; id: string }) {
  const w = floor.walls.find((x) => x.id === id)
  if (!w) return null
  const u = project.settings.units
  const up = (label: string, fn: (x: NonNullable<typeof w>) => void) => upFloor(floor.id, label, (f) => fn(f.walls.find((q) => q.id === id)!))
  return (
    <div className="section">
      <div className="section-head">
        <h3>Wall</h3>
        <span className="sub">{effectiveKind(w)}</span>
      </div>
      <div className="prop">
        <label>Length</label>
        <span className="tabular">{formatLength(segLength(w.a, w.b), u)}</span>
      </div>
      <div className="prop">
        <label>Thickness</label>
        <LengthField value={w.thickness} units={u} min={0.05} max={0.6} onCommit={(v) => up('Wall thickness', (x) => {
            x.thickness = v
            x.thicknessLocked = true
          })} />
      </div>
      <div className="prop">
        <label>Height</label>
        <LengthField value={w.height ?? floor.height} units={u} min={0.3} max={8} onCommit={(v) => up('Wall height', (x) => void (x.height = v))} />
      </div>
      <div className="prop">
        <label>Type</label>
        <select className="field" value={w.kindOverride ?? 'auto'} onChange={(e) => up('Wall type', (x) => void (x.kindOverride = e.target.value === 'auto' ? undefined : (e.target.value as WallKind)))}>
          <option value="auto">Automatic ({w.kind})</option>
          <option value="interior">Solid interior wall</option>
          <option value="exterior">Exterior wall</option>
          <option value="virtual">Open (no wall)</option>
          <option value="railing">Railing</option>
          <option value="parapet">Low wall / parapet</option>
        </select>
      </div>
      <div className="prop">
        <label>Left side</label>
        <MaterialPicker project={project} value={w.sideMaterials?.left} fallback="lib:paint-warm-white" onChange={(m) => up('Wall finish', (x) => void (x.sideMaterials = { ...x.sideMaterials, left: m }))} />
      </div>
      <div className="prop">
        <label>Right side</label>
        <MaterialPicker project={project} value={w.sideMaterials?.right} fallback="lib:paint-warm-white" onChange={(m) => up('Wall finish', (x) => void (x.sideMaterials = { ...x.sideMaterials, right: m }))} />
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
        Drag the wall to move it. Rooms on both sides resize with it.
      </p>
    </div>
  )
}

function OpeningProps({ project, floor, id }: { project: Project; floor: Floor; id: string }) {
  const o = floor.openings.find((x) => x.id === id)
  if (!o) return null
  const u = project.settings.units
  const up = (label: string, fn: (x: NonNullable<typeof o>) => void) => upFloor(floor.id, label, (f) => fn(f.openings.find((q) => q.id === id)!))
  const styles = o.kind === 'door' ? ['single', 'double', 'sliding', 'pocket', 'french', 'main', 'garage', 'opening'] : ['casement', 'sliding', 'fixed', 'full-height', 'ventilator', 'arched']
  return (
    <div className="section">
      <div className="section-head">
        <h3>{o.kind === 'door' ? 'Door' : 'Window'}</h3>
      </div>
      <div className="prop">
        <label>Style</label>
        <select className="field" value={o.style} onChange={(e) => up('Opening style', (x) => void (x.style = e.target.value as DoorStyle | WindowStyle))}>
          {styles.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1).replace('-', ' ')}
            </option>
          ))}
        </select>
      </div>
      <div className="prop-grid">
        <LengthField prefix="W" value={o.width} units={u} min={0.3} max={6} onCommit={(v) => up('Opening width', (x) => void (x.width = v))} />
        <LengthField prefix="H" value={o.height} units={u} min={0.3} max={4} onCommit={(v) => up('Opening height', (x) => void (x.height = v))} />
        {o.kind === 'window' && <LengthField prefix="S" value={o.sill} units={u} min={0} max={3} onCommit={(v) => up('Sill height', (x) => void (x.sill = v))} tip="Sill height" />}
      </div>
      {o.kind === 'door' && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={() => up('Flip door swing', (x) => void (x.swing = x.swing === 'left' ? 'right' : 'left'))}>
            Flip swing side
          </button>
          <button className="btn sm" onClick={() => up('Flip door hinge', (x) => void (x.hinge = x.hinge === 'end' ? 'start' : 'end'))}>
            Flip hinge
          </button>
        </div>
      )}
      <div className="prop" style={{ marginTop: 8 }}>
        <label>Frame</label>
        <MaterialPicker project={project} value={o.frameMaterial} fallback={o.kind === 'window' ? project.exterior.windowFrameMaterial : 'lib:wood-oak'} categories={['wood', 'metal', 'paint']} onChange={(m) => up('Frame material', (x) => void (x.frameMaterial = m))} />
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
        Drag to slide along the wall; drag the round handles to resize.
      </p>
    </div>
  )
}

function FurnitureProps({ project, floor, id }: { project: Project; floor: Floor; id: string }) {
  const f = floor.furniture.find((x) => x.id === id)
  if (!f) return null
  const c = catalogItem(f.type)
  const u = project.settings.units
  const up = (label: string, fn: (x: NonNullable<typeof f>) => void) => upFloor(floor.id, label, (fl) => fn(fl.furniture.find((q) => q.id === id)!))
  return (
    <div className="section">
      <div className="section-head">
        <h3>{c?.name ?? f.type}</h3>
      </div>
      <div className="prop-grid">
        <LengthField prefix="W" value={f.width} units={u} min={0.1} onCommit={(v) => up('Resize', (x) => void (x.width = v))} />
        <LengthField prefix="D" value={f.depth} units={u} min={0.05} onCommit={(v) => up('Resize', (x) => void (x.depth = v))} />
        <LengthField prefix="H" value={f.height} units={u} min={0.01} onCommit={(v) => up('Resize', (x) => void (x.height = v))} />
        <NumberField prefix="°" value={Math.round((f.rotation * 180) / Math.PI)} step={15} onCommit={(v) => up('Rotate', (x) => void (x.rotation = (((v % 360) + 360) % 360) * (Math.PI / 180)))} />
      </div>
      <div className="prop" style={{ marginTop: 8 }}>
        <label>Material</label>
        <MaterialPicker project={project} value={f.materialId} fallback={c?.category === 'kitchen' ? 'lib:granite-black-galaxy' : c?.category === 'sofas' ? 'lib:fabric-grey' : 'lib:wood-oak'} onChange={(m) => up('Furniture material', (x) => void (x.materialId = m))} />
      </div>
      <div className="prop">
        <label>Colour</label>
        <input type="color" value={f.color ?? c?.color ?? '#aaaaaa'} onChange={(e) => up('Furniture colour', (x) => void (x.color = e.target.value))} />
      </div>
    </div>
  )
}

function StairProps({ project, floor, id }: { project: Project; floor: Floor; id: string }) {
  const s = floor.stairs.find((x) => x.id === id)
  if (!s) return null
  const u = project.settings.units
  const up = (label: string, fn: (x: NonNullable<typeof s>) => void) => upFloor(floor.id, label, (f) => fn(f.stairs.find((q) => q.id === id)!))
  return (
    <div className="section">
      <div className="section-head">
        <h3>Stair</h3>
        <span className="sub">
          {s.risers} steps, {formatLength(floor.height / s.risers, u)} risers
        </span>
      </div>
      <div className="prop">
        <label>Type</label>
        <select className="field" value={s.type} onChange={(e) => up('Stair type', (x) => void (x.type = e.target.value as StairType))}>
          {['straight', 'L', 'U', 'spiral', 'floating', 'modern', 'traditional'].map((t) => (
            <option key={t} value={t}>
              {t === 'L' ? 'L-shaped' : t === 'U' ? 'U-shaped' : t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div className="prop-grid">
        <LengthField prefix="W" value={s.width} units={u} min={0.7} max={2} onCommit={(v) => up('Stair width', (x) => void (x.width = v))} tip="Flight width" />
        <LengthField prefix="T" value={s.tread} units={u} min={0.2} max={0.4} onCommit={(v) => up('Tread depth', (x) => void (x.tread = v))} tip="Tread depth" />
        <NumberField prefix="#" value={s.risers} min={4} max={40} onCommit={(v) => up('Number of steps', (x) => void (x.risers = Math.round(v)))} />
        <Seg value={s.turn} onChange={(v) => up('Stair turn', (x) => void (x.turn = v))} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />
      </div>
      <div className="prop" style={{ marginTop: 8 }}>
        <label>Material</label>
        <MaterialPicker project={project} value={s.material} fallback="lib:marble-botticino" onChange={(m) => up('Stair material', (x) => void (x.material = m))} />
      </div>
      <div className="prop">
        <label>Railing</label>
        <Seg value={s.railing} onChange={(v: RailingType) => up('Railing', (x) => void (x.railing = v))} options={[{ value: 'glass', label: 'Glass' }, { value: 'metal', label: 'Metal' }, { value: 'wood', label: 'Wood' }, { value: 'none', label: 'None' }]} />
      </div>
    </div>
  )
}

function ColumnProps({ project, floor, id }: { project: Project; floor: Floor; id: string }) {
  const c = floor.columns.find((x) => x.id === id)
  if (!c) return null
  const u = project.settings.units
  const up = (label: string, fn: (x: NonNullable<typeof c>) => void) => upFloor(floor.id, label, (f) => fn(f.columns.find((q) => q.id === id)!))
  return (
    <div className="section">
      <div className="section-head">
        <h3>Column</h3>
      </div>
      <div className="prop-grid">
        <LengthField prefix="W" value={c.width} units={u} min={0.1} onCommit={(v) => up('Column size', (x) => void (x.width = v))} />
        <LengthField prefix="D" value={c.depth} units={u} min={0.1} onCommit={(v) => up('Column size', (x) => void (x.depth = v))} />
      </div>
      <div className="prop" style={{ marginTop: 8 }}>
        <label>Shape</label>
        <Seg value={c.shape} onChange={(v) => up('Column shape', (x) => void (x.shape = v))} options={[{ value: 'rect', label: 'Square' }, { value: 'round', label: 'Round' }]} />
      </div>
      <div className="prop">
        <label>Material</label>
        <MaterialPicker project={project} value={c.material} fallback="lib:plaster-grey" onChange={(m) => up('Column material', (x) => void (x.material = m))} />
      </div>
    </div>
  )
}

function SiteAreaProps({ project, id }: { project: Project; id: string }) {
  const a = project.site.areas.find((x) => x.id === id)
  if (!a) return null
  const b = bbox(a.polygon)
  const u = project.settings.units
  return (
    <div className="section">
      <div className="section-head">
        <h3>{a.name ?? a.kind.replace('_', ' ')}</h3>
        <span className="sub">{formatAreaFor(area(a.polygon), u)}</span>
      </div>
      <div className="kv">
        <dt>Size</dt>
        <dd>
          {formatLength(b.w, u)} × {formatLength(b.h, u)}
        </dd>
      </div>
      <div className="prop" style={{ marginTop: 8 }}>
        <label>Surface</label>
        <MaterialPicker project={project} value={a.material} fallback="lib:grass-lawn" onChange={(m) => commit('Site surface', (d) => void (d.site.areas.find((x) => x.id === id)!.material = m))} />
      </div>
      {a.kind === 'pool' && (
        <div className="prop">
          <label>Depth</label>
          <LengthField value={a.depth ?? 1.5} units={u} min={0.5} max={3} onCommit={(v) => commit('Pool depth', (d) => void (d.site.areas.find((x) => x.id === id)!.depth = v))} />
        </div>
      )}
    </div>
  )
}

function SiteObjectProps({ project, id }: { project: Project; id: string }) {
  const o = project.site.objects.find((x) => x.id === id)
  if (!o) return null
  return (
    <div className="section">
      <div className="section-head">
        <h3>{o.kind.replace('_', ' ')}</h3>
      </div>
      <div className="prop">
        <label>Size</label>
        <Slider value={o.scale} min={0.4} max={2} step={0.05} onChange={(v) => commit('Scale', (d) => void (d.site.objects.find((x) => x.id === id)!.scale = v), { coalesce: `scale-${id}` })} />
      </div>
    </div>
  )
}

/* ── Layers ───────────────────────────────────────────────────────────────── */

const LAYERS: { k: LayerKey; label: string; d: string }[] = [
  { k: 'architecture', label: 'Architecture', d: 'Walls, doors, windows, stairs' },
  { k: 'structure', label: 'Structure', d: 'Columns and beams' },
  { k: 'furniture', label: 'Furniture', d: 'All furniture and fixtures' },
  { k: 'electrical', label: 'Electrical', d: 'Switches, sockets, fans, AC points, DB' },
  { k: 'plumbing', label: 'Plumbing', d: 'Fixtures, supply and drain lines' },
  { k: 'landscape', label: 'Landscape', d: 'Lawns, trees, pool, driveway' },
  { k: 'lighting', label: 'Lighting', d: 'Light fixtures and coverage' },
  { k: 'materials', label: 'Materials', d: 'Colour rooms by floor finish' },
  { k: 'annotations', label: 'Annotations', d: 'Labels, dimensions and notes' }
]

function Layers() {
  const layers = useProject((s) => s.project.settings.layers)
  return (
    <div className="section">
      <div className="section-head">
        <h3>Layers</h3>
      </div>
      <div className="list">
        {LAYERS.map((l) => (
          <div key={l.k} className="list-item" onClick={() => commit(`${layers[l.k] ? 'Hide' : 'Show'} ${l.label.toLowerCase()}`, (d) => void (d.settings.layers[l.k] = !d.settings.layers[l.k]))}>
            {layers[l.k] ? <Eye size={15} /> : <EyeOff size={15} className="faint" />}
            <div>
              <div>{l.label}</div>
              <div className="faint" style={{ fontSize: 11 }}>
                {l.d}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Issues ───────────────────────────────────────────────────────────────── */

function Issues({ issues }: { issues: Issue[] }) {
  const set = useUI((s) => s.set)
  if (!issues.length)
    return (
      <div className="empty">
        <CircleCheck />
        <div>No problems found. Every room is reachable and the geometry checks out.</div>
      </div>
    )
  const order = { error: 0, warning: 1, info: 2 }
  return (
    <div className="section">
      <div className="section-head">
        <h3>Design check</h3>
        <span className="sub">
          {issues.filter((i) => i.severity === 'error').length} errors, {issues.filter((i) => i.severity === 'warning').length} warnings
        </span>
      </div>
      {[...issues].sort((a, b) => order[a.severity] - order[b.severity]).map((i) => (
        <div
          key={i.id}
          className={`issue ${i.severity}`}
          onClick={() => {
            if (i.ref) set({ floorId: i.ref.floorId ?? i.floorId ?? useUI.getState().floorId, selection: [i.ref], mode: useUI.getState().mode === 'present' ? 'plan' : useUI.getState().mode })
          }}
        >
          {i.severity === 'error' ? <CircleAlert /> : i.severity === 'warning' ? <TriangleAlert /> : <Info />}
          <div>
            <div className="m">{i.message}</div>
            <div className="f">{i.why}</div>
            <div className="f">{i.fix}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Areas ────────────────────────────────────────────────────────────────── */

function Areas() {
  const project = useProject((s) => s.project)
  const u = project.settings.units
  const a = areaSummary(houseOf(project))
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <div className="section">
        <div className="section-head">
          <h3>Areas</h3>
        </div>
        <div className="stat-grid">
          <Stat k="Plot area" v={formatAreaFor(a.plotArea, u)} />
          <Stat k="Covered area" v={formatAreaFor(a.coveredArea, u)} />
          <Stat k="Open area" v={formatAreaFor(a.openArea, u)} />
          <Stat k="Total floor area" v={formatAreaFor(a.totalFloorArea, u)} />
          <Stat k="Garage" v={formatAreaFor(a.garageArea, u)} />
          <Stat k="Garden" v={formatAreaFor(a.gardenArea, u)} />
        </div>
      </div>
      {a.floorAreas.map((f) => (
        <div key={f.floorId} className="section">
          <div className="section-head" style={{ cursor: 'pointer', marginBottom: open === f.floorId ? 10 : 0 }} onClick={() => setOpen(open === f.floorId ? null : f.floorId)}>
            <h3>{f.name}</h3>
            <span className="sub">{formatAreaFor(f.area, u)}</span>
          </div>
          {open === f.floorId && (
            <div className="list">
              {a.roomAreas
                .filter((r) => r.floorId === f.floorId)
                .map((r) => (
                  <div key={r.roomId} className="list-item" onClick={() => useUI.getState().set({ floorId: f.floorId, selection: [{ kind: 'room', id: r.roomId, floorId: f.floorId }] })}>
                    {r.name}
                    <span className="meta">{formatAreaFor(r.area, u)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

/* ── Versions ─────────────────────────────────────────────────────────────── */

function Versions() {
  const versions = useProject((s) => s.project.versions)
  const autoVersion = useProject((s) => s.project.settings.autoVersion)
  const [name, setName] = useState('')
  const [cmp, setCmp] = useState<string[]>([])
  return (
    <>
      <div className="section">
        <div className="section-head">
          <h3>Save a version</h3>
        </div>
        <div className="row">
          <input className="field" placeholder="e.g. Added basement" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && (createVersion(name.trim()), setName(''))} />
          <button className="btn primary" disabled={!name.trim()} onClick={() => {
              createVersion(name.trim())
              setName('')
            }}>
            Save
          </button>
        </div>
        <label className="check faint" style={{ marginTop: 10, fontSize: 12 }}>
          <input type="checkbox" checked={autoVersion} onChange={(e) => commit('Auto versions', (d) => void (d.settings.autoVersion = e.target.checked))} /> Create a version automatically after major changes
        </label>
      </div>
      <div className="section">
        <div className="section-head">
          <h3>History</h3>
          {cmp.length === 2 && (
            <div className="actions">
              <button className="btn sm" onClick={() => useUI.getState().openDialog('compare-versions', { a: cmp[0], b: cmp[1] })}>
                <GitCompare size={13} /> Compare
              </button>
            </div>
          )}
        </div>
        <div className="list">
          {[...versions].reverse().map((v) => (
            <div key={v.id} className={`list-item ${cmp.includes(v.id) ? 'on' : ''}`} style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={cmp.includes(v.id)} onChange={(e) => setCmp((c) => (e.target.checked ? [...c, v.id].slice(-2) : c.filter((x) => x !== v.id)))} aria-label="Select for comparison" style={{ marginTop: 3 }} />
              <div className="grow">
                <div>
                  <b className="tabular">Version {v.number}</b>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {v.name}
                </div>
                <div className="faint" style={{ fontSize: 11 }}>
                  {new Date(v.createdAt).toLocaleString()}
                </div>
              </div>
              <button className="icon-btn" data-tip="Restore this version" onClick={() => restoreVersion(v.id)}>
                <RotateCcw />
              </button>
              <button className="icon-btn" data-tip="Duplicate" onClick={() => duplicateVersion(v.id)}>
                <Copy />
              </button>
            </div>
          ))}
        </div>
      </div>
      <CompareVersionsDialog />
    </>
  )
}
