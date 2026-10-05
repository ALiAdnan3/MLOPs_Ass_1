import { useEffect, useRef, useState } from 'react'
import { makePlot } from '../core/model/defaults'
import { AuthoritySelect } from '../ui/AuthoritySelect'
import { setbacksFor } from '../core/bylaws'
import { CitySelect } from '../ui/CitySelect'
import { ArrowLeft, ArrowRight, Sparkles, Check } from 'lucide-react'
import { useUI } from '../state/ui'
import { useWizard } from './wizardState'
import { PLOT_PRESETS } from '../core/units/plots'
import { FT, formatArea, fromMeters, toMeters } from '../core/units/units'
import { area as polyArea, rectPoly } from '../core/geometry/polygon'
import type { ArchitecturalStyle, Compass, FloorsOption, LengthUnit, Preferences, RoomCounts, OutdoorRequirements, SpecialRequirements, StairPreference } from '../core/model/types'
import { Seg, Slider, Stepper, Switch, BrandMark } from '../ui/primitives'
import { northAngle } from '../engine/lighting/sun'
import { levelsFor } from '../planner/generator/program'
import { DISCLAIMER, exteriorForStyle } from '../core/model/defaults'
import { resolveMaterial, materialSwatch } from '../core/materials/library'

const STEPS = ['Plot', 'Floors', 'Rooms', 'Outdoor', 'Special', 'Style', 'Preferences', 'Review']

const FLOOR_OPTIONS: { v: FloorsOption; t: string; d: string }[] = [
  { v: 'single', t: 'Single story', d: 'Everything on the ground floor' },
  { v: 'double', t: 'Double story', d: 'Ground + first floor' },
  { v: 'triple', t: 'Triple story', d: 'Ground + first + second' },
  { v: 'basement+ground', t: 'Basement + Ground', d: 'Single story over a basement' },
  { v: 'basement+ground+first', t: 'Basement + Ground + First', d: 'Double story over a basement' },
  { v: 'basement+ground+first+second', t: 'Basement + Ground + First + Second', d: 'Three floors over a basement' },
  { v: 'custom', t: 'Custom', d: 'Choose the number of floors yourself' }
]

const ROOMS: { k: keyof RoomCounts; t: string }[] = [
  { k: 'bedrooms', t: 'Family bedrooms' },
  { k: 'masterBedrooms', t: 'Master bedrooms' },
  { k: 'guestBedrooms', t: 'Guest bedrooms' },
  { k: 'bathrooms', t: 'Bathrooms' },
  { k: 'powderRooms', t: 'Powder rooms' },
  { k: 'kitchens', t: 'Kitchens' },
  { k: 'dirtyKitchens', t: 'Dirty kitchens' },
  { k: 'diningRooms', t: 'Dining rooms' },
  { k: 'tvLounges', t: 'TV lounges' },
  { k: 'drawingRooms', t: 'Drawing rooms' },
  { k: 'livingRooms', t: 'Living rooms' },
  { k: 'familyRooms', t: 'Family rooms' },
  { k: 'studyRooms', t: 'Study rooms' },
  { k: 'offices', t: 'Offices' },
  { k: 'kidsRooms', t: 'Kids rooms' },
  { k: 'prayerRooms', t: 'Prayer rooms' },
  { k: 'laundries', t: 'Laundry' },
  { k: 'stores', t: 'Store rooms' },
  { k: 'pantries', t: 'Pantries' },
  { k: 'servantRooms', t: 'Servant rooms' },
  { k: 'servantBathrooms', t: 'Servant bathrooms' },
  { k: 'walkInClosets', t: 'Walk-in closets' },
  { k: 'dressingRooms', t: 'Dressing rooms' }
]

const OUTDOOR: { k: keyof OutdoorRequirements; t: string; d: string }[] = [
  { k: 'frontLawn', t: 'Front lawn', d: 'Green lawn facing the street' },
  { k: 'backLawn', t: 'Back lawn', d: 'Private garden behind the house' },
  { k: 'courtyard', t: 'Courtyard', d: 'Open-to-sky space inside the house' },
  { k: 'patio', t: 'Patio', d: 'Paved area off the lounge' },
  { k: 'terrace', t: 'Terrace', d: 'Open terrace on the upper floor' },
  { k: 'balcony', t: 'Balcony', d: 'Balconies for front rooms' },
  { k: 'pool', t: 'Swimming pool', d: 'In the back garden' },
  { k: 'outdoorKitchen', t: 'Outdoor kitchen', d: 'Cooking area outside' },
  { k: 'outdoorSitting', t: 'Outdoor sitting', d: 'Benches and a table outside' },
  { k: 'garden', t: 'Garden', d: 'Planting beds, shrubs and flowers' },
  { k: 'playArea', t: 'Play area', d: 'Swings and a slide' },
  { k: 'bbq', t: 'BBQ area', d: 'Built-in barbecue' }
]

const SPECIAL: { k: keyof SpecialRequirements; t: string; d: string }[] = [
  { k: 'basement', t: 'Basement', d: 'Adds a floor below ground' },
  { k: 'doubleHeightLounge', t: 'Double-height lounge', d: 'Lounge open through two floors' },
  { k: 'doubleHeightEntrance', t: 'Double-height entrance', d: 'A tall entrance hall' },
  { k: 'pillars', t: 'Pillars', d: 'Pillars carrying the entrance porch' },
  { k: 'centralCourtyard', t: 'Central courtyard', d: 'Light into the middle of the house' },
  { k: 'largeWindows', t: 'Large windows', d: 'Floor-to-ceiling glass in living areas' },
  { k: 'skylight', t: 'Skylight', d: 'Daylight from the roof' },
  { k: 'atrium', t: 'Atrium', d: 'Tall top-lit hall' },
  { k: 'elevator', t: 'Elevator', d: 'Lift serving every floor' },
  { k: 'homeTheater', t: 'Home theater', d: 'Dedicated cinema room' },
  { k: 'gym', t: 'Gym', d: 'Workout room' },
  { k: 'gameRoom', t: 'Game room', d: 'Pool table and games' },
  { k: 'library', t: 'Library', d: 'Book-lined reading room' },
  { k: 'office', t: 'Office', d: 'Room for working from home' },
  { k: 'rooftopGarden', t: 'Rooftop garden', d: 'Green roof terrace' }
]

const STYLES: { v: ArchitecturalStyle; t: string; d: string }[] = [
  { v: 'modern', t: 'Modern', d: 'White render, stone feature wall, flat roof' },
  { v: 'contemporary', t: 'Contemporary', d: 'Warm render with timber accents' },
  { v: 'minimalist', t: 'Minimalist', d: 'Clean planes, board-formed concrete' },
  { v: 'traditional', t: 'Traditional', d: 'Gutka brick base, timber windows' },
  { v: 'luxury', t: 'Modern Luxury Villa', d: 'Slate hip roof, stone base, timber panels, big glass' },
  { v: 'islamic', t: 'Islamic', d: 'Sandstone, arches and courtyards' },
  { v: 'mediterranean', t: 'Mediterranean', d: 'Travertine and clay-tile hip roof' },
  { v: 'european', t: 'European', d: 'Limestone base, mansard slate roof' },
  { v: 'colonial', t: 'Colonial', d: 'Red brick, white trim, gable roof' },
  { v: 'industrial', t: 'Industrial', d: 'Dark brick, corten steel, black frames' },
  { v: 'farmhouse', t: 'Farmhouse', d: 'White walls, metal gable roof' },
  { v: 'pakistani_modern', t: 'Pakistani Modern', d: 'Render with gutka feature, flat roof' },
  { v: 'custom', t: 'Custom', d: 'Start neutral and style it later' }
]

const PREFS: { k: keyof Preferences; t: string; lo: string; hi: string }[] = [
  { k: 'privacy', t: 'Privacy', lo: 'Open to guests', hi: 'Family rooms well away' },
  { k: 'naturalLight', t: 'Natural light', lo: 'Fewer windows', hi: 'As bright as possible' },
  { k: 'ventilation', t: 'Ventilation', lo: 'Standard', hi: 'Cross-ventilation' },
  { k: 'openSpace', t: 'Open space', lo: 'Separate rooms', hi: 'Open plan' },
  { k: 'luxury', t: 'Luxury', lo: 'Economical', hi: 'Generous rooms' },
  { k: 'greenSpace', t: 'Green space', lo: 'More house', hi: 'More garden' },
  { k: 'parking', t: 'Parking', lo: 'Minimal', hi: 'Ample' },
  { k: 'entertainment', t: 'Entertainment', lo: 'Quiet home', hi: 'Hosting often' },
  { k: 'familySpace', t: 'Family space', lo: 'Small household', hi: 'Joint family' }
]

export function Wizard() {
  const w = useWizard()
  const set = useUI((s) => s.set)
  const next = () => (w.step < STEPS.length - 1 ? w.setStep(w.step + 1) : generate())
  const generate = () => set({ screen: 'designs' })
  return (
    <div className="wizard">
      <nav className="steps" aria-label="Steps">
        <div className="row" style={{ padding: '0 10px 18px', gap: 10, cursor: 'pointer' }} onClick={() => set({ screen: 'home' })}>
          <BrandMark size={20} />
          <span className="wide" style={{ fontWeight: 650 }}>
            New house
          </span>
        </div>
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i === w.step ? 'on' : ''} ${i < w.step ? 'done' : ''}`} onClick={() => w.setStep(i)}>
            <span className="n">{i < w.step ? <Check size={12} /> : i + 1}</span>
            {s}
          </div>
        ))}
      </nav>
      <div className="wizard-main">
        <div className="wizard-body">
          {w.step === 0 && <PlotStep />}
          {w.step === 1 && <FloorsStep />}
          {w.step === 2 && <RoomsStep />}
          {w.step === 3 && <OutdoorStep />}
          {w.step === 4 && <SpecialStep />}
          {w.step === 5 && <StyleStep />}
          {w.step === 6 && <PrefsStep />}
          {w.step === 7 && <ReviewStep />}
        </div>
        <div className="wizard-foot">
          <button className="btn ghost" onClick={() => (w.step ? w.setStep(w.step - 1) : set({ screen: 'home' }))}>
            <ArrowLeft /> {w.step ? 'Back' : 'Start screen'}
          </button>
          <div className="grow" />
          {w.step < 7 && (
            <button className="btn" onClick={() => w.setStep(7)}>
              Skip to review
            </button>
          )}
          <button className="btn primary" onClick={next}>
            {w.step < 7 ? (
              <>
                Next: {STEPS[w.step + 1]} <ArrowRight />
              </>
            ) : (
              <>
                <Sparkles /> Generate designs
              </>
            )}
          </button>
        </div>
      </div>
      <Summary />
    </div>
  )
}

function PlotStep() {
  const w = useWizard()
  const uiMode = useUI((s) => s.uiMode)
  const [unit, setUnit] = useState<LengthUnit>('ft')
  const width = fromMeters(w.plot.width, unit)
  const depth = fromMeters(w.plot.depth, unit)
  const a = polyArea(w.plot.polygon)
  return (
    <>
      <h2>Your plot</h2>
      <p className="lead">Pick your plot size, or enter the exact width (road side) and length. The road side is the front of the house.</p>
      <div className="plot-presets">
        {PLOT_PRESETS.map((p) => (
          <button key={p.id} className={`plot-preset ${w.plotMode === 'preset' && w.plot.presetId === p.id ? 'on' : ''}`} onClick={() => w.choosePreset(p.id)}>
            <div className="n">{p.label}</div>
            <div className="s">
              {p.widthFt} × {p.depthFt} ft
            </div>
          </button>
        ))}
      </div>
      <div className="form-grid" style={{ marginTop: 20 }}>
        <div className="form-row">
          <label>Plot width (road side)</label>
          <input className="field" type="number" min={1} step={0.5} value={round2(width)} onChange={(e) => w.setCustom(toMeters(Number(e.target.value) || 1, unit), w.plot.depth)} />
        </div>
        <div className="form-row">
          <label>Plot length</label>
          <input className="field" type="number" min={1} step={0.5} value={round2(depth)} onChange={(e) => w.setCustom(w.plot.width, toMeters(Number(e.target.value) || 1, unit))} />
        </div>
        <div className="form-row">
          <label>Unit</label>
          <Seg value={unit} onChange={setUnit} full options={[{ value: 'ft', label: 'Feet' }, { value: 'in', label: 'Inches' }, { value: 'm', label: 'Meters' }, { value: 'cm', label: 'cm' }]} />
        </div>
        <div className="form-row">
          <label>Plot area</label>
          <div className="field row" style={{ justifyContent: 'space-between' }}>
            <span className="tabular">{formatArea(a, 'sqft')}</span>
            <span className="faint tabular">
              {formatArea(a, 'marla')} ({formatArea(a, 'sqm')})
            </span>
          </div>
        </div>
      </div>
      <h3 style={{ marginTop: 26, marginBottom: 10 }}>Orientation</h3>
      <div className="form-grid">
        <div className="form-row">
          <label>City</label>
          <CitySelect plot={w.plot} onChange={(loc) => w.setPlot((p) => (p.location = loc))} />
        </div>
        <div className="form-row">
          <label>Building rules</label>
          <AuthoritySelect
            value={w.plot.authority}
            onChange={(a) =>
              w.setPlot((p) => {
                p.authority = a
                p.setbacks = a ? setbacksFor(a, p) : makePlot(p.width, p.depth, p.presetId).setbacks
              })
            }
          />
        </div>
        <div className="form-row">
          <label>Road side faces</label>
          <Seg value={w.plot.roadSide} onChange={(v: Compass) => w.setPlot((p) => (p.roadSide = v))} full options={(['N', 'E', 'S', 'W'] as Compass[]).map((c) => ({ value: c, label: { N: 'North', E: 'East', S: 'South', W: 'West' }[c] }))} />
        </div>
        <div className="form-row">
          <label>Corner plot</label>
          <div className="row">
            <Switch on={w.plot.corner} onChange={(v) => w.setPlot((p) => (p.corner = v))} label="Corner plot" />
            {w.plot.corner && <Seg value={w.plot.cornerSide} onChange={(v: 'left' | 'right') => w.setPlot((p) => (p.cornerSide = v))} options={[{ value: 'left', label: 'Road on left' }, { value: 'right', label: 'Road on right' }]} />}
          </div>
        </div>
        {uiMode === 'advanced' && (
          <div className="form-row">
            <label>North correction (°)</label>
            <input className="field" type="number" value={w.plot.northOffset} onChange={(e) => w.setPlot((p) => (p.northOffset = Number(e.target.value) || 0))} />
          </div>
        )}
      </div>
      {uiMode === 'advanced' && (
        <>
          <h3 style={{ marginTop: 26, marginBottom: 6 }}>Irregular plot</h3>
          <p className="muted" style={{ marginBottom: 10 }}>
            Drag the corners to match an irregular boundary. The house is placed in the largest usable rectangle.
          </p>
          <IrregularEditor />
        </>
      )}
    </>
  )
}

function IrregularEditor() {
  const w = useWizard()
  const ref = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const poly = w.plot.polygon
  const maxDim = Math.max(w.plot.width, w.plot.depth) * 1.3
  const S = 360 / maxDim
  const off = 20
  const toSvg = (p: { x: number; y: number }) => ({ x: off + p.x * S, y: off + p.y * S })
  useEffect(() => {
    if (drag === null) return
    const move = (e: PointerEvent) => {
      const r = ref.current!.getBoundingClientRect()
      const x = (e.clientX - r.left - off) / S
      const y = (e.clientY - r.top - off) / S
      const next = poly.map((p, i) => (i === drag ? { x: Math.round(x * 4) / 4, y: Math.round(y * 4) / 4 } : p))
      w.setPolygon(next)
    }
    const up = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, poly, S, w])
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
      <svg ref={ref} width={400} height={400} style={{ background: 'var(--canvas)', border: '1px solid var(--line-soft)', borderRadius: 6 }}>
        <polygon points={poly.map((p) => `${toSvg(p).x},${toSvg(p).y}`).join(' ')} fill="var(--tape-soft)" stroke="var(--tape)" strokeWidth="1.5" />
        {poly.map((p, i) => (
          <circle key={i} cx={toSvg(p).x} cy={toSvg(p).y} r={7} fill="var(--panel)" stroke="var(--tape)" strokeWidth="2" style={{ cursor: 'grab' }} onPointerDown={() => setDrag(i)} />
        ))}
        <text x={200} y={396} textAnchor="middle" fill="var(--text-3)" fontSize="11">
          Road side
        </text>
      </svg>
      <div className="col">
        <button className="btn" onClick={() => w.setPolygon([...poly.slice(0, poly.length - 1), { x: (poly[poly.length - 1].x + poly[0].x) / 2, y: (poly[poly.length - 1].y + poly[0].y) / 2 + 1 }, poly[poly.length - 1]])}>
          Add a corner
        </button>
        <button className="btn" onClick={() => w.setPolygon(rectPoly({ x: 0, y: 0, w: w.plot.width, h: w.plot.depth }))}>
          Reset to rectangle
        </button>
      </div>
    </div>
  )
}

function FloorsStep() {
  const w = useWizard()
  return (
    <>
      <h2>Floors</h2>
      <p className="lead">How many floors should the house have? A basement adds space below ground for a lounge, theater, gym or storage.</p>
      <div className="option-grid">
        {FLOOR_OPTIONS.map((o) => (
          <button key={o.v} className={`option ${w.req.floors === o.v ? 'on' : ''}`} onClick={() => w.setReq((r) => (r.floors = o.v))}>
            <span className="t">{o.t}</span>
            <span className="d">{o.d}</span>
          </button>
        ))}
      </div>
      {w.req.floors === 'custom' && (
        <div className="form-grid" style={{ marginTop: 18 }}>
          <div className="counter-row">
            <span>Floors above ground</span>
            <Stepper value={w.req.customFloors.above} min={1} max={5} onChange={(v) => w.setReq((r) => (r.customFloors.above = v))} />
          </div>
          <div className="counter-row">
            <span>Basement</span>
            <Switch on={w.req.customFloors.basement} onChange={(v) => w.setReq((r) => (r.customFloors.basement = v))} />
          </div>
        </div>
      )}
    </>
  )
}

function RoomsStep() {
  const w = useWizard()
  return (
    <>
      <h2>Rooms</h2>
      <p className="lead">Set how many of each room you need. Master bedrooms and kids rooms count within the bedroom total; guest bedrooms come in addition. Bathrooms are attached to bedrooms first.</p>
      <div className="form-grid">
        {ROOMS.map((r) => (
          <div key={r.k} className="counter-row">
            <span>{r.t}</span>
            <Stepper value={w.req.rooms[r.k]} max={r.k === 'bathrooms' ? 20 : 12} onChange={(v) => w.setReq((x) => ((x.rooms[r.k] as number) = v))} />
          </div>
        ))}
      </div>
    </>
  )
}

function OutdoorStep() {
  const w = useWizard()
  return (
    <>
      <h2>Outdoor</h2>
      <p className="lead">Parking and outdoor spaces. The generator reserves yard space for these before sizing the house.</p>
      <div className="form-grid" style={{ marginBottom: 16 }}>
        <div className="counter-row">
          <span>Garage / car porch</span>
          <Switch on={w.req.outdoor.garage} onChange={(v) => w.setReq((r) => (r.outdoor.garage = v))} />
        </div>
        {w.req.outdoor.garage && (
          <div className="counter-row">
            <span>Number of cars</span>
            <Stepper value={w.req.outdoor.cars} min={1} max={4} onChange={(v) => w.setReq((r) => (r.outdoor.cars = v))} />
          </div>
        )}
      </div>
      <div className="option-grid">
        {OUTDOOR.map((o) => (
          <button key={o.k} className={`option ${w.req.outdoor[o.k] ? 'on' : ''}`} onClick={() => w.setReq((r) => ((r.outdoor[o.k] as boolean) = !r.outdoor[o.k]))}>
            <span className="t">{o.t}</span>
            <span className="d">{o.d}</span>
          </button>
        ))}
      </div>
    </>
  )
}

function SpecialStep() {
  const w = useWizard()
  return (
    <>
      <h2>Special features</h2>
      <p className="lead">Extras that shape the plan and the 3D model.</p>
      <div className="option-grid">
        {SPECIAL.map((o) => (
          <button key={o.k} className={`option ${w.req.special[o.k] ? 'on' : ''}`} onClick={() => w.setReq((r) => ((r.special[o.k] as boolean) = !r.special[o.k]))}>
            <span className="t">{o.t}</span>
            <span className="d">{o.d}</span>
          </button>
        ))}
      </div>
      <div className="form-grid" style={{ marginTop: 18 }}>
        <div className="form-row">
          <label>Staircase type</label>
          <select className="field" value={w.req.special.stairType} onChange={(e) => w.setReq((r) => (r.special.stairType = e.target.value as StairPreference))}>
            {['auto', 'straight', 'L', 'U', 'spiral', 'floating', 'modern', 'traditional'].map((s) => (
              <option key={s} value={s}>
                {s === 'auto' ? 'Best fit (automatic)' : s === 'L' ? 'L-shaped' : s === 'U' ? 'U-shaped' : s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  )
}

function StyleStep() {
  const w = useWizard()
  return (
    <>
      <h2>Architectural style</h2>
      <p className="lead">Sets the facade materials, roof shape, window frames and columns. You can change any of them later.</p>
      <div className="option-grid">
        {STYLES.map((o) => (
          <button key={o.v} className={`option ${w.req.style === o.v ? 'on' : ''}`} onClick={() => w.setReq((r) => (r.style = o.v))}>
            <StyleChips style={o.v} />
            <span className="t">{o.t}</span>
            <span className="d">{o.d}</span>
          </button>
        ))}
      </div>
      {w.req.style === 'custom' && (
        <div className="form-row" style={{ marginTop: 16, maxWidth: 420 }}>
          <label>Describe your style</label>
          <input className="field" value={w.req.customStyle ?? ''} onChange={(e) => w.setReq((r) => (r.customStyle = e.target.value))} placeholder="e.g. white render with walnut timber and black frames" />
        </div>
      )}
    </>
  )
}

/** The style's real facade, cladding, plinth and roof finishes as a small palette strip. */
function StyleChips({ style }: { style: ArchitecturalStyle }) {
  const e = exteriorForStyle(style)
  const ids = [e.facadeMaterial, e.accentMaterial, e.plinthMaterial, e.roofType === 'flat' ? e.windowFrameMaterial : e.roofMaterial]
  return (
    <span className="style-chips" aria-hidden>
      {ids.map((id, i) => (
        <i key={i} style={{ background: materialSwatch(resolveMaterial(id, [])) }} />
      ))}
    </span>
  )
}

function PrefsStep() {
  const w = useWizard()
  return (
    <>
      <h2>Preferences</h2>
      <p className="lead">These weigh the trade-offs when rooms compete for space and light.</p>
      <div style={{ maxWidth: 640 }}>
        {PREFS.map((p) => (
          <div key={p.k} className="pref-row">
            <span>{p.t}</span>
            <div>
              <Slider value={w.req.preferences[p.k]} min={0} max={100} onChange={(v) => w.setReq((r) => (r.preferences[p.k] = v))} label={p.t} />
              <div className="row faint" style={{ justifyContent: 'space-between', fontSize: 11 }}>
                <span>{p.lo}</span>
                <span>{p.hi}</span>
              </div>
            </div>
            <span className="v">{w.req.preferences[p.k]}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function ReviewStep() {
  const w = useWizard()
  return (
    <>
      <h2>Ready to generate</h2>
      <p className="lead">HomeForge will generate five alternative designs. Each is a complete, editable plan with walls, doors, windows, stairs, columns, furniture and garden, and comes with the reasoning behind it.</p>
      {w.findings.length > 0 && (
        <div className="section" style={{ padding: 0, border: 'none', marginBottom: 18 }}>
          <div className="section-title">Understood from your description</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {w.findings.map((f, i) => (
              <span key={i} className="chip" data-tip={`“${f.phrase}”`}>
                {f.meaning}
              </span>
            ))}
          </div>
          {w.unclear.map((u, i) => (
            <p key={i} className="muted" style={{ marginTop: 8 }}>
              {u}
            </p>
          ))}
        </div>
      )}
      <div className="option-grid" style={{ maxWidth: 760 }}>
        {[
          ['A', 'Modern Family Layout', 'Balanced rooms around a central family lounge'],
          ['B', 'Luxury Open Layout', 'Open lounge, dining and kitchen'],
          ['C', 'Privacy Focused Layout', 'Guests at the front, family rooms away'],
          ['D', 'Maximum Garden Layout', 'Compact footprint, more green space'],
          ['E', 'Maximum Room Space Layout', 'Uses the full buildable area']
        ].map(([l, t, d]) => (
          <div key={l} className="option">
            <span className="t">
              <span style={{ color: 'var(--tape)', marginRight: 6 }}>{l}</span>
              {t}
            </span>
            <span className="d">{d}</span>
          </div>
        ))}
      </div>
      <p className="disclaimer" style={{ marginTop: 22 }}>
        {DISCLAIMER}
      </p>
    </>
  )
}

function Summary() {
  const w = useWizard()
  const ref = useRef<HTMLCanvasElement>(null)
  const a = polyArea(w.plot.polygon)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const W = 290
    const H = 230
    const dpr = window.devicePixelRatio || 1
    c.width = W * dpr
    c.height = H * dpr
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    const css = getComputedStyle(document.documentElement)
    ctx.fillStyle = css.getPropertyValue('--canvas')
    ctx.fillRect(0, 0, W, H)
    const s = Math.min((W - 60) / w.plot.width, (H - 60) / w.plot.depth)
    const ox = (W - w.plot.width * s) / 2
    const oy = (H - 30 - w.plot.depth * s) / 2
    ctx.beginPath()
    w.plot.polygon.forEach((p, i) => (i ? ctx.lineTo(ox + p.x * s, oy + p.y * s) : ctx.moveTo(ox + p.x * s, oy + p.y * s)))
    ctx.closePath()
    ctx.fillStyle = css.getPropertyValue('--tape-soft')
    ctx.fill()
    ctx.strokeStyle = css.getPropertyValue('--tape')
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 3])
    ctx.stroke()
    ctx.setLineDash([])
    const sb = w.plot.setbacks
    ctx.strokeStyle = css.getPropertyValue('--text-3')
    ctx.strokeRect(ox + sb.left * s, oy + sb.rear * s, (w.plot.width - sb.left - sb.right) * s, (w.plot.depth - sb.front - sb.rear) * s)
    ctx.fillStyle = css.getPropertyValue('--raised-2')
    ctx.fillRect(ox - 10, oy + w.plot.depth * s + 4, w.plot.width * s + 20, 14)
    ctx.fillStyle = css.getPropertyValue('--text-2')
    ctx.font = '11px Archivo Variable, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('ROAD', ox + (w.plot.width * s) / 2, oy + w.plot.depth * s + 15)
    ctx.fillText(`${round1(w.plot.width / FT)}′`, ox + (w.plot.width * s) / 2, oy - 6)
    ctx.save()
    ctx.translate(ox - 8, oy + (w.plot.depth * s) / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText(`${round1(w.plot.depth / FT)}′`, 0, 0)
    ctx.restore()
    // north arrow
    const na = northAngle(w.plot)
    ctx.save()
    ctx.translate(W - 22, 22)
    ctx.rotate(na)
    ctx.beginPath()
    ctx.moveTo(0, -12)
    ctx.lineTo(6, 8)
    ctx.lineTo(0, 4)
    ctx.lineTo(-6, 8)
    ctx.closePath()
    ctx.fillStyle = css.getPropertyValue('--text')
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = css.getPropertyValue('--text')
    ctx.fillText('N', W - 22 + Math.sin(na) * 20, 26 - Math.cos(na) * 20)
  }, [w.plot])
  const r = w.req
  const levels = levelsFor(r)
  return (
    <aside className="summary">
      <div className="section-title" style={{ marginBottom: 0 }}>
        Summary
      </div>
      <canvas ref={ref} style={{ height: 230 }} />
      <dl className="kv">
        <dt>Plot</dt>
        <dd>
          {round1(w.plot.width / FT)} × {round1(w.plot.depth / FT)} ft
        </dd>
        <dt>Area</dt>
        <dd>
          {formatArea(a, 'sqft')} ({formatArea(a, 'marla')})
        </dd>
        <dt>Floors</dt>
        <dd>{levels.map((l) => (l < 0 ? 'Basement' : l === 0 ? 'Ground' : l === 1 ? 'First' : l === 2 ? 'Second' : `L${l}`)).join(', ')}</dd>
        <dt>Bedrooms</dt>
        <dd>
          {r.rooms.bedrooms}
          {r.rooms.guestBedrooms ? ` + ${r.rooms.guestBedrooms} guest` : ''}
        </dd>
        <dt>Bathrooms</dt>
        <dd>{r.rooms.bathrooms}</dd>
        <dt>Kitchens</dt>
        <dd>
          {r.rooms.kitchens}
          {r.rooms.dirtyKitchens ? ` + ${r.rooms.dirtyKitchens} dirty` : ''}
        </dd>
        <dt>Parking</dt>
        <dd>{r.outdoor.garage ? `${r.outdoor.cars} car${r.outdoor.cars > 1 ? 's' : ''}` : 'None'}</dd>
        <dt>Style</dt>
        <dd style={{ textTransform: 'capitalize' }}>{r.style.replace('_', ' ')}</dd>
      </dl>
    </aside>
  )
}

const round1 = (v: number) => Math.round(v * 10) / 10
const round2 = (v: number) => Math.round(v * 100) / 100
