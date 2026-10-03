import { useEffect, useMemo, useState } from 'react'
import { deepClone } from '../core/clone'
import { Eye, RotateCw, Copy, Trash2, Plus, DoorOpen, AppWindow } from 'lucide-react'
import { useProject, commit } from '../state/store'
import { useUI } from '../state/ui'
import type { CeilingType, DoorStyle, Floor, FurnitureCategory, LightFixtureKind, MaterialDef, Project, Room, SiteObjectKind, WindowStyle } from '../core/model/types'
import { spec } from '../core/constraints/rooms'
import { bbox, area, pointInPolygon, centroid as polygonCentroid } from '../core/geometry/polygon'
import { formatLength, formatAreaFor } from '../core/units/units'
import { LengthField, Seg, Slider, Switch, NumberField } from '../ui/primitives'
import { setRoomSize, refurnishRoom, refreshFloor } from '../planner/operations'
import { wallsOfRoom } from '../planner/walls'
import { addWindowToRoom, freeWindowSpot } from '../planner/openingsEdit'
import { segLength } from '../core/geometry/segment'
import { CATALOG, catalogItem, FURNITURE_CATEGORIES } from '../core/furniture/catalog'
import { MaterialPicker } from '../workspace/Inspector'
import { getEngine, hasEngine, kelvinColor } from '../engine/Engine'
import { uid } from '../core/model/ids'
import { sortedFloors } from '../core/model/house'

/**
 * ROOM DESIGNER (§17): every room customised on its own — size, finishes, colour, ceiling,
 * doors, windows, lighting, furniture, curtains. Gardens and patios get the same treatment.
 */

const PAINTS = ['#f1ede4', '#e9e4d8', '#d9d4c7', '#c9c4b9', '#a7b29a', '#9fb4c2', '#e2c9bd', '#c98f6d', '#5a6470', '#34393f']

export function RoomDesigner() {
  const project = useProject((s) => s.project)
  const sel = useUI((s) => s.selection)
  const floorId = useUI((s) => s.floorId)
  const ref = sel[0]
  const floor = project.floors.find((f) => f.id === (ref?.floorId ?? floorId)) ?? project.floors.find((f) => f.id === floorId)
  const room = ref?.kind === 'room' ? floor?.rooms.find((r) => r.id === ref.id) : undefined
  const siteArea = ref?.kind === 'siteArea' ? project.site.areas.find((a) => a.id === ref.id) : undefined
  // open on the main living space when nothing is selected, so the designer is never empty
  useEffect(() => {
    if (room || siteArea || !floor) return
    const order = ['tv_lounge', 'living', 'family', 'drawing', 'master_bedroom', 'bedroom', 'kitchen']
    const pick = [...floor.rooms].filter((r) => order.includes(r.type)).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))[0]
    if (!pick) return
    useUI.getState().set({ selection: [{ kind: 'room', id: pick.id, floorId: floor.id }], surface: { kind: 'roomFloor', floorId: floor.id, roomId: pick.id } })
    if (hasEngine()) getEngine().setCameraPreset('room', pick.id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="panel-scroll">
      <RoomChooser project={project} floor={floor} current={room?.id ?? siteArea?.id} />
      {room && floor && <RoomDesign project={project} floor={floor} room={room} />}
      {siteArea && <GardenDesign project={project} areaId={siteArea.id} />}
      {!room && !siteArea && (
        <div className="section">
          <p className="muted" style={{ margin: 0 }}>
            Choose a room above, or click one in the 3D view. Each room keeps its own finishes, lighting and furniture.
          </p>
        </div>
      )}
    </div>
  )
}

function RoomChooser({ project, floor, current }: { project: Project; floor?: Floor; current?: string }) {
  const floors = sortedFloors(project.floors).filter((f) => f.rooms.length)
  const choose = (v: string) => {
    const [kind, fid, id] = v.split('|')
    const ui = useUI.getState()
    if (kind === 'room') {
      ui.set({ selection: [{ kind: 'room', id, floorId: fid }], floorId: fid, surface: { kind: 'roomFloor', floorId: fid, roomId: id } })
      if (hasEngine()) getEngine().setCameraPreset('room', id)
    } else ui.set({ selection: [{ kind: 'siteArea', id }], surface: { kind: 'siteArea', areaId: id } })
  }
  const value = current ? (project.site.areas.some((a) => a.id === current) ? `site||${current}` : `room|${floor?.id}|${current}`) : ''
  const outdoor = project.site.areas.filter((a) => ['lawn', 'patio', 'garden_bed', 'deck', 'outdoor_sitting', 'play_area', 'bbq_area'].includes(a.kind))
  return (
    <div className="section">
      <div className="section-head">
        <h3>Room designer</h3>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <select className="field" value={value} onChange={(e) => choose(e.target.value)} aria-label="Room to design">
          <option value="" disabled>
            Choose a room…
          </option>
          {floors.map((f) => (
            <optgroup key={f.id} label={`${f.name} floor`}>
              {f.rooms
                .filter((r) => r.type !== 'void' && r.type !== 'lift')
                .map((r) => (
                  <option key={r.id} value={`room|${f.id}|${r.id}`}>
                    {r.name}
                  </option>
                ))}
            </optgroup>
          ))}
          {outdoor.length > 0 && (
            <optgroup label="Outdoor">
              {outdoor.map((a) => (
                <option key={a.id} value={`site||${a.id}`}>
                  {a.name ?? a.kind.replace('_', ' ')}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {current && floor && !project.site.areas.some((a) => a.id === current) && (
          <button className="icon-btn" data-tip="Look inside" aria-label="Look inside" onClick={() => hasEngine() && getEngine().setCameraPreset('room', current)}>
            <Eye />
          </button>
        )}
      </div>
    </div>
  )
}

const upFloor = (floorId: string, label: string, fn: (f: Floor) => void, coalesce?: string) => commit(label, (d) => fn(d.floors.find((x) => x.id === floorId) as Floor), coalesce ? { coalesce } : undefined)

function ensurePaint(d: Project, hex: string): string {
  const id = `cus:paint-${hex.slice(1).toLowerCase()}`
  if (!d.materials.some((m) => m.id === id)) {
    const m: MaterialDef = {
      id,
      name: `Paint ${hex.toUpperCase()}`,
      category: 'paint',
      source: 'custom',
      color: '#ffffff',
      procedural: { kind: 'plaster', seed: 4242, colors: [hex] },
      scale: 2,
      rotation: 0,
      offset: { x: 0, y: 0 },
      roughness: 0.9,
      metalness: 0,
      reflection: 0.05,
      brightness: 0,
      contrast: 0,
      normalStrength: 0.2
    }
    d.materials.push(m)
  }
  return id
}

function RoomDesign({ project, floor, room }: { project: Project; floor: Floor; room: Room }) {
  const u = project.settings.units
  const sp = spec(room.type)
  const b = bbox(room.polygon)
  const upRoom = (label: string, fn: (r: Room) => void, coalesce?: string) => upFloor(floor.id, label, (f) => fn(f.rooms.find((x) => x.id === room.id)!), coalesce)
  const refurnish = (label: string, fn: (r: Room) => void) =>
    upFloor(floor.id, label, (f) => {
      const r = f.rooms.find((x) => x.id === room.id)!
      fn(r)
      refurnishRoom(f, r.id, project.requirements.preferences.luxury)
    })
  const bedroom = ['master_bedroom', 'bedroom', 'guest_bedroom', 'kids_room', 'servant'].includes(room.type)
  const living = ['tv_lounge', 'living', 'family', 'drawing', 'basement_lounge', 'home_theater', 'game_room'].includes(room.type)
  const kitchen = room.type === 'kitchen' || room.type === 'dirty_kitchen'
  const garage = room.type === 'garage'
  const light = room.lighting ?? { on: true, fixture: defaultFixture(room), intensity: 1, temperature: sp.wet || kitchen ? 4000 : 3000 }
  const setLight = (label: string, patch: Partial<typeof light>, co?: string) => upRoom(label, (r) => void (r.lighting = { ...light, ...patch }), co)
  const furnish = room.furnish ?? {}
  const want = (k: keyof typeof furnish) => furnish[k] !== false
  const toggle = (k: keyof typeof furnish, label: string) => refurnish(`${want(k) ? 'Remove' : 'Add'} ${label.toLowerCase()}`, (r) => void (r.furnish = { ...r.furnish, [k]: !want(k) }))
  const wallColor = room.color ?? undefined
  return (
    <>
      <div className="section">
        <div className="section-head">
          <h3>{room.name}</h3>
          <span className="sub">
            {sp.label}, {formatAreaFor(area(room.polygon), u)}
          </span>
        </div>
        <div className="prop-grid">
          <LengthField prefix="W" value={b.w} units={u} min={0.6} onCommit={(v) => upFloor(floor.id, `Set ${room.name} width`, (f) => void setRoomSize(f, room.id, 'x', v, project.settings))} tip="Width; neighbouring rooms adjust" />
          <LengthField prefix="L" value={b.h} units={u} min={0.6} onCommit={(v) => upFloor(floor.id, `Set ${room.name} length`, (f) => void setRoomSize(f, room.id, 'y', v, project.settings))} tip="Length; neighbouring rooms adjust" />
          <LengthField prefix="H" value={room.ceilingHeight ?? floor.height - floor.slabThickness} units={u} min={2.2} max={8} onCommit={(v) => upRoom('Ceiling height', (r) => void (r.ceilingHeight = v))} tip="Clear ceiling height" />
          <input className="field" value={room.name} aria-label="Room name" onChange={(e) => upRoom('Rename room', (r) => {
              r.name = e.target.value
              r.autoName = false
            }, `name-${room.id}`)} />
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>Finishes</h3>
        </div>
        <div className="prop">
          <label>Floor</label>
          <MaterialPicker project={project} value={room.floorMaterial} fallback={sp.floorFinish} onChange={(id) => upRoom('Floor material', (r) => void (r.floorMaterial = id))} />
        </div>
        <div className="prop">
          <label>Walls</label>
          <MaterialPicker project={project} value={room.wallMaterial} fallback={sp.wallFinish} onChange={(id) => upRoom('Wall material', (r) => {
              r.wallMaterial = id
              r.color = undefined
            })} />
        </div>
        <div className="prop">
          <label>Wall colour</label>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {PAINTS.map((c) => (
              <button key={c} className="swatch" aria-label={`Paint ${c}`} data-tip={c.toUpperCase()} style={{ background: c, cursor: 'pointer', outline: wallColor === c ? '2px solid var(--tape)' : undefined, outlineOffset: 1 }} onClick={() => commit('Wall colour', (d) => {
                  const r = d.floors.find((x) => x.id === floor.id)!.rooms.find((x) => x.id === room.id)!
                  r.wallMaterial = ensurePaint(d as Project, c)
                  r.color = c
                })} />
            ))}
            <input type="color" aria-label="Custom wall colour" value={wallColor ?? '#f1ede4'} onChange={(e) => commit('Wall colour', (d) => {
                const r = d.floors.find((x) => x.id === floor.id)!.rooms.find((x) => x.id === room.id)!
                r.wallMaterial = ensurePaint(d as Project, e.target.value)
                r.color = e.target.value
              }, { coalesce: `wallcolor-${room.id}` })} style={{ width: 22, height: 20, padding: 0, border: 'none', background: 'none' }} />
          </div>
        </div>
        <div className="prop">
          <label>Ceiling</label>
          <Seg<CeilingType> value={room.ceilingType ?? 'flat'} onChange={(v) => upRoom('Ceiling type', (r) => void (r.ceilingType = v))} options={[{ value: 'flat', label: 'Flat' }, { value: 'false-ceiling', label: 'False' }, { value: 'cove', label: 'Cove' }]} />
        </div>
        <div className="prop">
          <label>Ceiling finish</label>
          <MaterialPicker project={project} value={room.ceilingMaterial} fallback="lib:paint-ceiling" categories={['paint', 'wood', 'concrete', 'metal']} onChange={(id) => upRoom('Ceiling finish', (r) => void (r.ceilingMaterial = id))} />
        </div>
        {kitchen && <KitchenFinishes floor={floor} room={room} project={project} />}
      </div>

      <OpeningsSection project={project} floor={floor} room={room} />

      <div className="section">
        <div className="section-head">
          <h3>Lighting</h3>
          <div className="actions">
            <Switch on={light.on} onChange={(v) => setLight(v ? 'Lights on' : 'Lights off', { on: v })} label="Lights on" />
          </div>
        </div>
        <div className="prop">
          <label>Fixture</label>
          <select className="field" value={light.fixture} onChange={(e) => setLight('Light fixture', { fixture: e.target.value as LightFixtureKind })}>
            <option value="downlights">Recessed downlights</option>
            <option value="chandelier">Chandelier</option>
            <option value="pendant">Pendants</option>
            <option value="panel">Ceiling panel</option>
            <option value="cove">Cove lighting</option>
            <option value="fan-light">Fan with light</option>
          </select>
        </div>
        <div className="prop">
          <label>Brightness</label>
          <div className="row grow" style={{ gap: 8 }}>
            <Slider value={light.intensity} min={0.2} max={2} step={0.05} label="Brightness" onChange={(v) => setLight('Light brightness', { intensity: v }, `li-${room.id}`)} />
            <span className="tabular faint" style={{ width: 40, textAlign: 'right', fontSize: 12 }}>
              {Math.round(light.intensity * 100)}%
            </span>
          </div>
        </div>
        <div className="prop">
          <label>Colour</label>
          <div className="row grow" style={{ gap: 8 }}>
            <span className="swatch" style={{ background: kelvinColor(light.temperature), borderRadius: '50%' }} />
            <Slider value={light.temperature} min={2200} max={6500} step={100} label="Colour temperature" onChange={(v) => setLight('Light colour', { temperature: v }, `lt-${room.id}`)} />
            <span className="tabular faint" style={{ width: 44, textAlign: 'right', fontSize: 12 }}>
              {light.temperature}K
            </span>
          </div>
        </div>
        <div className="row" style={{ gap: 5 }}>
          {[
            { k: 2700, l: 'Warm' },
            { k: 4000, l: 'Neutral' },
            { k: 5700, l: 'Daylight' }
          ].map((x) => (
            <button key={x.k} className={`chip ${light.temperature === x.k ? 'on' : ''}`} onClick={() => setLight('Light colour', { temperature: x.k })}>
              {x.l}
            </button>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
          Lights glow in Evening and Night lighting (sun and camera controls on the 3D toolbar).
        </p>
      </div>

      {garage ? (
        <GarageSection floor={floor} room={room} project={project} />
      ) : (
        <div className="section">
          <div className="section-head">
            <h3>Furniture</h3>
            <div className="actions">
              <button className="btn sm" onClick={() => refurnish(`Furnish ${room.name}`, () => {})} data-tip="Lay the room out again with the current switches">
                Re-furnish
              </button>
            </div>
          </div>
          <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
            {bedroom && <FurnishToggle label="Bed" on={want('bed')} onChange={() => toggle('bed', 'Bed')} />}
            {bedroom && <FurnishToggle label="Wardrobe" on={want('wardrobe')} onChange={() => toggle('wardrobe', 'Wardrobe')} />}
            {(bedroom || living) && <FurnishToggle label="TV" on={want('tv')} onChange={() => toggle('tv', 'TV')} />}
            {(living || room.type === 'dining') && <FurnishToggle label="Seating" on={want('seating')} onChange={() => toggle('seating', 'Seating')} />}
            {(bedroom || room.type === 'study' || room.type === 'office' || room.type === 'library') && <FurnishToggle label="Desk" on={want('desk')} onChange={() => toggle('desk', 'Desk')} />}
            <FurnishToggle label="Decorations" on={want('decor')} onChange={() => toggle('decor', 'Decorations')} />
          </div>
          <FurnitureList floor={floor} room={room} project={project} />
        </div>
      )}

      {!sp.outdoor && !garage && (
        <div className="section">
          <div className="section-head">
            <h3>Curtains</h3>
            <div className="actions">
              <Switch on={!!room.curtains?.enabled} onChange={(v) => upRoom(v ? 'Add curtains' : 'Remove curtains', (r) => void (r.curtains = { enabled: v, color: r.curtains?.color ?? '#d8cfc0' }))} label="Curtains" />
            </div>
          </div>
          {room.curtains?.enabled && (
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {['#d8cfc0', '#efe9df', '#8c8d8f', '#3b3c3f', '#6b4f3a', '#2f4a3c', '#1f3350', '#a0524a'].map((c) => (
                <button key={c} className="swatch" aria-label={`Curtain ${c}`} style={{ background: c, cursor: 'pointer', outline: room.curtains?.color === c ? '2px solid var(--tape)' : undefined, outlineOffset: 1 }} onClick={() => upRoom('Curtain colour', (r) => void (r.curtains = { enabled: true, color: c }))} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function defaultFixture(r: Room): LightFixtureKind {
  if (['drawing', 'dining', 'foyer'].includes(r.type)) return 'chandelier'
  if (r.type === 'kitchen') return 'pendant'
  if (['master_bedroom', 'bedroom', 'guest_bedroom', 'kids_room'].includes(r.type)) return 'panel'
  return 'downlights'
}

function FurnishToggle(props: { label: string; on: boolean; onChange: () => void }) {
  return (
    <label className="row" style={{ gap: 8, padding: '6px 8px', background: 'var(--panel-2)', borderRadius: 4, cursor: 'pointer' }}>
      <Switch on={props.on} onChange={props.onChange} label={props.label} />
      <span>{props.label}</span>
    </label>
  )
}

function KitchenFinishes({ project, floor, room }: { project: Project; floor: Floor; room: Room }) {
  const units = floor.furniture.filter((x) => pointInPolygon(x.position, room.polygon) && catalogItem(x.type)?.category === 'kitchen')
  if (!units.length) return null
  const cur = units[0]
  const apply = (label: string, fn: (x: (typeof units)[number]) => void) =>
    upFloor(floor.id, label, (f) => {
      for (const x of f.furniture) if (units.some((k) => k.id === x.id)) fn(x)
    })
  return (
    <>
      <div className="prop">
        <label>Counter top</label>
        <MaterialPicker project={project} value={cur.materialId} fallback="lib:granite-black-galaxy" categories={['granite', 'marble', 'porcelain', 'wood', 'concrete', 'metal']} onChange={(id) => apply('Counter top material', (x) => void (x.materialId = id))} />
      </div>
      <div className="prop">
        <label>Cabinets</label>
        <input type="color" aria-label="Cabinet colour" value={cur.color ?? '#e8e4dc'} onChange={(e) => apply('Cabinet colour', (x) => void (x.color = e.target.value))} />
      </div>
    </>
  )
}

/* ── doors & windows ─────────────────────────────────────────────────────── */

function OpeningsSection({ project, floor, room }: { project: Project; floor: Floor; room: Room }) {
  const u = project.settings.units
  const segs = wallsOfRoom(floor, room)
  const mine = floor.openings.filter((o) => segs.some((w) => w.wall.id === o.wallId && o.offset >= w.t0 - 0.01 && o.offset <= w.t1 + 0.01))
  const up = (id: string, label: string, fn: (o: (typeof mine)[number]) => void) => upFloor(floor.id, label, (f) => fn(f.openings.find((x) => x.id === id)!))
  const addWindow = () => {
    if (!freeWindowSpot(floor, room)) {
      useUI.getState().toast({ kind: 'warning', title: 'No room for another window', body: `${room.name} has no free outside wall long enough. Widen the room or remove a window first.` })
      return
    }
    upFloor(floor.id, `Add window to ${room.name}`, (f) => void addWindowToRoom(f, f.rooms.find((x) => x.id === room.id)!))
  }
  return (
    <div className="section">
      <div className="section-head">
        <h3>Doors and windows</h3>
        <div className="actions">
          <button className="btn sm" onClick={addWindow}>
            <Plus size={13} /> Window
          </button>
        </div>
      </div>
      {!mine.length && <p className="faint" style={{ fontSize: 12 }}>No doors or windows yet. Use the Door and Window tools in the 2D plan to place them exactly.</p>}
      <div className="list">
        {mine.map((o) => {
          const w = floor.walls.find((x) => x.id === o.wallId)
          const styles = o.kind === 'door' ? ['single', 'double', 'sliding', 'pocket', 'french', 'main', 'garage', 'opening'] : ['casement', 'sliding', 'fixed', 'full-height', 'ventilator', 'arched']
          return (
            <div key={o.id} className="list-item" style={{ gap: 6 }} onClick={() => useUI.getState().set({ selection: [{ kind: 'opening', id: o.id, floorId: floor.id }] })}>
              {o.kind === 'door' ? <DoorOpen size={15} className="faint" /> : <AppWindow size={15} className="faint" />}
              <select className="field" style={{ flex: 1.2 }} value={o.style} onClick={(e) => e.stopPropagation()} onChange={(e) => up(o.id, 'Opening style', (x) => {
                  x.style = e.target.value as DoorStyle | WindowStyle
                  if (x.style === 'full-height') {
                    x.sill = 0.05
                    x.height = Math.min(2.6, floor.height - 0.4)
                  }
                })}>
                {styles.map((s) => (
                  <option key={s} value={s}>
                    {s[0].toUpperCase() + s.slice(1).replace('-', ' ')}
                  </option>
                ))}
              </select>
              <div style={{ width: 100 }} onClick={(e) => e.stopPropagation()}>
                <LengthField value={o.width} units={u} min={0.4} max={w ? Math.max(0.5, segLength(w.a, w.b) - 0.2) : 6} onCommit={(v) => up(o.id, 'Opening width', (x) => void (x.width = v))} tip="Width" />
              </div>
              <button className="icon-btn" aria-label="Remove" data-tip="Remove" onClick={(e) => {
                  e.stopPropagation()
                  upFloor(floor.id, `Remove ${o.kind}`, (f) => void (f.openings = f.openings.filter((x) => x.id !== o.id)))
                }}>
                <Trash2 />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── furniture ───────────────────────────────────────────────────────────── */

function FurnitureList({ project, floor, room }: { project: Project; floor: Floor; room: Room }) {
  const items = floor.furniture.filter((x) => pointInPolygon(x.position, room.polygon))
  const [cat, setCat] = useState<FurnitureCategory>(defaultCategory(room))
  const choices = useMemo(() => CATALOG.filter((c) => c.category === cat), [cat])
  const add = (key: string) => {
    const c = catalogItem(key)!
    const ctr = polygonCentroid(room.polygon)
    upFloor(floor.id, `Add ${c.name.toLowerCase()}`, (f) =>
      void f.furniture.push({ id: uid('fur'), type: key, position: { ...ctr }, rotation: 0, width: c.w, depth: c.d, height: c.h, elevation: c.elevation })
    )
    useUI.getState().toast({ kind: 'info', title: `${c.name} added to ${room.name}`, body: 'Drag it into place in the 2D plan; R rotates it.' })
  }
  const up = (label: string, fn: (f: Floor) => void) => upFloor(floor.id, label, fn)
  void project
  return (
    <>
      <div className="list" style={{ marginBottom: 10 }}>
        {items.map((x) => (
          <div key={x.id} className="list-item" style={{ gap: 4 }} onClick={() => useUI.getState().set({ selection: [{ kind: 'furniture', id: x.id, floorId: floor.id }], surface: { kind: 'furniture', floorId: floor.id, furnitureId: x.id } })}>
            <span className="grow">{catalogItem(x.type)?.name ?? x.type}</span>
            <button className="icon-btn" aria-label="Rotate" data-tip="Rotate 90°" onClick={(e) => {
                e.stopPropagation()
                up('Rotate', (f) => {
                  const it = f.furniture.find((q) => q.id === x.id)!
                  it.rotation = (it.rotation + Math.PI / 2) % (Math.PI * 2)
                })
              }}>
              <RotateCw />
            </button>
            <button className="icon-btn" aria-label="Duplicate" data-tip="Duplicate" onClick={(e) => {
                e.stopPropagation()
                up('Duplicate', (f) => {
                  const it = f.furniture.find((q) => q.id === x.id)!
                  f.furniture.push({ ...deepClone(it), id: uid('fur'), position: { x: it.position.x + 0.4, y: it.position.y + 0.4 } })
                })
              }}>
              <Copy />
            </button>
            <button className="icon-btn" aria-label="Delete" data-tip="Delete" onClick={(e) => {
                e.stopPropagation()
                up('Delete furniture', (f) => void (f.furniture = f.furniture.filter((q) => q.id !== x.id)))
              }}>
              <Trash2 />
            </button>
          </div>
        ))}
        {!items.length && <div className="faint" style={{ fontSize: 12 }}>No furniture in this room.</div>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <select className="field" style={{ flex: 1 }} value={cat} onChange={(e) => setCat(e.target.value as FurnitureCategory)} aria-label="Furniture category">
          {FURNITURE_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <select className="field" style={{ flex: 1.3 }} value="" onChange={(e) => e.target.value && add(e.target.value)} aria-label="Add furniture">
          <option value="">Add…</option>
          {choices.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}

function defaultCategory(r: Room): FurnitureCategory {
  if (['master_bedroom', 'bedroom', 'guest_bedroom', 'kids_room', 'servant'].includes(r.type)) return 'beds'
  if (r.type === 'kitchen' || r.type === 'dirty_kitchen') return 'kitchen'
  if (r.type === 'bathroom' || r.type === 'powder' || r.type === 'servant_bath') return 'sinks'
  if (r.type === 'dining') return 'dining'
  if (r.type === 'study' || r.type === 'office') return 'desks'
  if (r.type === 'terrace' || r.type === 'balcony' || r.type === 'rooftop_garden') return 'outdoor'
  if (r.type === 'gym') return 'fitness'
  return 'sofas'
}

/* ── garage ──────────────────────────────────────────────────────────────── */

function GarageSection({ project, floor, room }: { project: Project; floor: Floor; room: Room }) {
  const g = room.garage ?? { cars: Math.max(1, Math.floor(bbox(room.polygon).w / 2.9)), storage: false, workshop: false, evCharger: false }
  const set = (label: string, patch: Partial<typeof g>) =>
    upFloor(floor.id, label, (f) => {
      const r = f.rooms.find((x) => x.id === room.id)!
      r.garage = { ...g, ...patch }
      refurnishRoom(f, r.id, project.requirements.preferences.luxury)
    })
  const fits = Math.max(1, Math.floor(bbox(room.polygon).w / 2.6))
  return (
    <div className="section">
      <div className="section-head">
        <h3>Garage</h3>
        <span className="sub">
          {formatLength(bbox(room.polygon).w, project.settings.units)} wide
        </span>
      </div>
      <div className="prop">
        <label>Type</label>
        <Seg value={room.enclosed === false ? 'porch' : 'closed'} onChange={(v) => upFloor(floor.id, v === 'porch' ? 'Open car porch' : 'Enclosed garage', (f) => {
            const r = f.rooms.find((x) => x.id === room.id)!
            r.enclosed = v !== 'porch'
            refreshFloor(f, project.settings)
          })} options={[{ value: 'porch', label: 'Car porch' }, { value: 'closed', label: 'Enclosed' }]} />
      </div>
      <div className="prop">
        <label>Cars</label>
        <NumberField value={g.cars} min={1} max={4} step={1} onCommit={(v) => {
            const n = Math.round(v)
            if (n > fits) useUI.getState().toast({ kind: 'warning', title: `${n} cars need about ${(n * 2.9).toFixed(1)} m of width`, body: 'Widen the garage in the plan; the cars are placed as far as they fit.' })
            set('Garage cars', { cars: n })
          }} />
      </div>
      <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <FurnishToggle label="Storage" on={g.storage} onChange={() => set('Garage storage', { storage: !g.storage })} />
        <FurnishToggle label="Workshop" on={g.workshop} onChange={() => set('Garage workshop', { workshop: !g.workshop })} />
        <FurnishToggle label="EV charger" on={g.evCharger} onChange={() => set('EV charger', { evCharger: !g.evCharger })} />
      </div>
      <div className="prop" style={{ marginTop: 10 }}>
        <label>Floor</label>
        <MaterialPicker project={project} value={room.floorMaterial} fallback="lib:concrete-smooth" categories={['concrete', 'porcelain', 'ground', 'stone']} onChange={(id) => upFloor(floor.id, 'Garage floor', (f) => void (f.rooms.find((x) => x.id === room.id)!.floorMaterial = id))} />
      </div>
    </div>
  )
}

/* ── garden / patio ──────────────────────────────────────────────────────── */

const GARDEN_OBJECTS: { kind: SiteObjectKind; label: string }[] = [
  { kind: 'tree', label: 'Tree' },
  { kind: 'palm', label: 'Palm' },
  { kind: 'shrub', label: 'Shrub' },
  { kind: 'flowers', label: 'Flower bed' },
  { kind: 'hedge', label: 'Hedge' },
  { kind: 'planter', label: 'Planter' },
  { kind: 'bench', label: 'Bench' },
  { kind: 'outdoor_table', label: 'Outdoor table' },
  { kind: 'lounger', label: 'Lounger' },
  { kind: 'umbrella', label: 'Umbrella' },
  { kind: 'pergola', label: 'Pergola' },
  { kind: 'fountain', label: 'Fountain' },
  { kind: 'swing', label: 'Swing' },
  { kind: 'bbq_grill', label: 'BBQ grill' },
  { kind: 'garden_light', label: 'Garden light' }
]

function GardenDesign({ project, areaId }: { project: Project; areaId: string }) {
  const a = project.site.areas.find((x) => x.id === areaId)!
  const u = project.settings.units
  const inside = project.site.objects.filter((o) => pointInPolygon(o.position, a.polygon))
  const add = (kind: SiteObjectKind) => {
    const b = bbox(a.polygon)
    let p = polygonCentroid(a.polygon)
    // spread new objects so they do not stack
    for (let k = 0; k < 40; k++) {
      const q = { x: b.x + 0.6 + Math.random() * Math.max(0.1, b.w - 1.2), y: b.y + 0.6 + Math.random() * Math.max(0.1, b.h - 1.2) }
      if (pointInPolygon(q, a.polygon) && inside.every((o) => Math.hypot(o.position.x - q.x, o.position.y - q.y) > 1.2)) {
        p = q
        break
      }
    }
    commit(`Add ${kind.replace('_', ' ')}`, (d) => void d.site.objects.push({ id: uid('obj'), kind, position: p, rotation: 0, scale: 1 }))
  }
  return (
    <>
      <div className="section">
        <div className="section-head">
          <h3>{a.name ?? a.kind.replace('_', ' ')}</h3>
          <span className="sub">{formatAreaFor(area(a.polygon), u)}</span>
        </div>
        <div className="prop">
          <label>Surface</label>
          <MaterialPicker project={project} value={a.material} fallback={a.kind === 'lawn' ? 'lib:grass-lawn' : 'lib:porcelain-outdoor'} categories={['ground', 'stone', 'porcelain', 'wood', 'concrete', 'brick']} onChange={(m) => commit('Outdoor surface', (d) => void (d.site.areas.find((x) => x.id === areaId)!.material = m))} />
        </div>
      </div>
      <div className="section">
        <div className="section-head">
          <h3>Planting and furniture</h3>
          <span className="sub">{inside.length} items</span>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          {GARDEN_OBJECTS.map((g) => (
            <button key={g.kind} className="chip" onClick={() => add(g.kind)}>
              <Plus size={11} /> {g.label}
            </button>
          ))}
        </div>
        <div className="list">
          {inside.map((o) => (
            <div key={o.id} className="list-item" onClick={() => useUI.getState().set({ selection: [{ kind: 'siteObject', id: o.id }] })}>
              <span className="grow">{GARDEN_OBJECTS.find((g) => g.kind === o.kind)?.label ?? o.kind}</span>
              <button className="icon-btn" aria-label="Remove" data-tip="Remove" onClick={(e) => {
                  e.stopPropagation()
                  commit('Remove garden item', (d) => void (d.site.objects = d.site.objects.filter((x) => x.id !== o.id)))
                }}>
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
