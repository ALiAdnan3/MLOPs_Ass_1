import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  Home as HomeIcon,
  PencilRuler,
  PenLine,
  Sparkles,
  Box,
  Video,
  Palette,
  Save,
  Settings,
  Sun,
  Moon,
  Sunset,
  Upload,
  FolderOpen,
  CirclePlay,
  Play,
  Pencil,
  Square,
  Circle,
  Type,
  Eraser,
  Ruler,
  Wand2,
  Image as ImageIcon,
  Layers3,
  Share2,
  Maximize2,
  MousePointer2,
  Move,
  RotateCw,
  Scaling,
  Undo2,
  Redo2,
  Aperture,
  CloudMoon,
  UserRound,
  Building2,
  BedDouble,
  Bath,
  Car,
  Palmtree,
  ZoomIn,
  ZoomOut,
  Scan,
  SlidersHorizontal,
  Keyboard,
  LayoutGrid,
  Images
} from 'lucide-react'
import { useUI } from '../state/ui'
import { useProject, commit, getProject } from '../state/store'
import { useWizard } from './wizardState'
import { BrandMark, LengthField, Menu, Modal, Seg, Slider } from '../ui/primitives'
import { PLOT_PRESETS, presetById } from '../core/units/plots'
import { FT, formatAreaFor, formatLength, formatPlotSize } from '../core/units/units'
import { generateDesignsParallel } from '../ai/designService'
import { projectFromDesign, applyDesignToProject, openDemoHouse, dressDemo, setMode } from '../app/actions'
import { renderHouseImage } from '../render/houseImage'
import { renderPlanToCanvas } from '../render/planImage'
import { getEngine, hasEngine } from '../engine/Engine'
import type { ArchitecturalStyle, DesignOption, EntityRef, FloorsOption, MaterialCategory, Project, Room, UnitSystem } from '../core/model/types'
import { sortedFloors, floorElevations } from '../core/model/house'
import { bbox, area } from '../core/geometry/polygon'
import { spec } from '../core/constraints/rooms'
import { LIBRARY, resolveMaterial } from '../core/materials/library'
import { useMaterialThumb, thumbStyle } from '../render/materialThumb'
import { MaterialPicker } from '../workspace/Inspector'
import { setRoomSize, refurnishRoom } from '../planner/operations'
import { uploadMaterialFiles } from '../modes/materialUpload'
import { parseRequirements } from '../ai/requirementParser'
import { platform } from '../storage/platform'
import type { AutosaveEntry, RecentProject } from '../../../shared/api'
import { openProjectDialog, openRecent, restoreAutosave, saveProject } from '../storage/session'
import { TEMPLATES, templateRequirements } from '../planner/templates'
import { newProject, plotFromPreset, makePlot, DISCLAIMER, MIX_STYLES, STYLE_TITLE } from '../core/model/defaults'
import { planBearing, presetTime, sunriseSunset } from '../engine/lighting/sun'
import { useSketch } from '../modes/sketchState'
import { droneState, type DronePath } from '../engine/controllers/DroneController'
import { surfaceToEntity } from '../engine/Viewport3D'
import { rotateSelection } from '../editor/commands'
import { catalogItem } from '../core/furniture/catalog'
import { qiblaVector } from '../core/location'
import { CitySelect } from '../ui/CitySelect'
import { AuthoritySelect } from '../ui/AuthoritySelect'
import { setbacksFor } from '../core/bylaws'

/**
 * DESIGN DASHBOARD (home screen): set up the plot and requirements, generate designs in several
 * styles, see the house live in 3D (select, move, rotate and resize right there), compare the
 * rendered plan and cut-away, pick finishes with a room preview, adjust a room, and jump into
 * every tool.
 */

let sampleCache: Project | null = null

const hasHouse = (p: Project) => p.floors.some((f) => f.rooms.length > 0)
/** Blue hour: just after sunset for the plot's latitude and date, the sky still glowing and the lights on. */
const eveningTime = (L: { latitude: number; dayOfYear: number }) => Math.round((sunriseSunset(L.latitude, L.dayOfYear).sunset + 0.12) * 100) / 100
const atEvening = (p: Project) => void (p.settings.lighting = { ...p.settings.lighting, preset: 'custom', time: eveningTime(p.settings.lighting) })

export function Dashboard() {
  const project = useProject((s) => s.project)
  const real = hasHouse(project)
  const [sample, setSample] = useState<Project | null>(sampleCache)
  const shown = real ? project : sample
  const [designs, setDesigns] = useState<DesignOption[]>(() => project.designs)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [projectsOpen, setProjectsOpen] = useState(false)

  // a sample villa to show before the user has a house of their own
  useEffect(() => {
    if (real || sampleCache) return
    let alive = true
    const t = TEMPLATES.find((x) => x.id === '1k-luxury')!
    const req = templateRequirements(t)
    req.style = 'luxury'
    const timer = setTimeout(() => {
      generateDesignsParallel(req, plotFromPreset(t.preset), newProject().settings, () => {}, { strategies: ['luxury-open'], baseSeed: 2020, iterations: 1500 }).then(({ designs: ds }) => {
        if (!alive || !ds[0]) return
        const p = projectFromDesign(ds[0], req, ds, t.name)
        dressDemo(p)
        atEvening(p)
        sampleCache = p
        setSample(p)
      })
    }, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [real])

  // keep setup in step with the open project
  useEffect(() => {
    if (real) useWizard.setState({ req: structuredClone(project.requirements), plot: structuredClone(project.plot), targetExisting: true })
    if (project.designs.length) setDesigns(project.designs)
  }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // the room the right-hand panels work on (follows a room picked in the 3D view)
  const rooms = useMemo(() => (shown ? shown.floors.flatMap((f) => f.rooms.filter((r) => r.type !== 'void' && !spec(r.type).outdoor).map((r) => ({ f, r }))) : []), [shown])
  useEffect(() => {
    if (roomId && rooms.some((x) => x.r.id === roomId)) return
    const pick = rooms.find((x) => ['tv_lounge', 'living', 'drawing', 'family'].includes(x.r.type)) ?? rooms[0]
    setRoomId(pick?.r.id ?? null)
  }, [rooms, roomId])
  const current = rooms.find((x) => x.r.id === roomId)

  return (
    <div className="dash">
      <DashNav onProjects={() => setProjectsOpen(true)} />
      <div className="dash-grid">
        <SetupPanel project={real ? project : null} onDesigns={setDesigns} onProjects={() => setProjectsOpen(true)} />
        <main className="dash-center">
          <Hero project={shown} real={real} onRoom={setRoomId} />
          <div className="dash-tiles">
            <PlanTile project={shown} />
            <CutawayTile project={shown} />
          </div>
          <DesignStrip designs={designs} activeId={real ? project.activeDesignId : undefined} shown={shown} />
        </main>
        <aside className="dash-right">
          <FinishesPanel project={real ? project : null} view={shown} current={current} rooms={rooms} setRoomId={setRoomId} />
          <CustomizePanel project={real ? project : null} view={shown} current={current} rooms={rooms} setRoomId={setRoomId} />
          <SketchTools />
        </aside>
      </div>
      <FeatureRow />
      {projectsOpen && <ProjectsDialog onClose={() => setProjectsOpen(false)} />}
    </div>
  )
}

/* ── top navigation ──────────────────────────────────────────────────────── */

function DashNav({ onProjects }: { onProjects: () => void }) {
  const theme = useUI((s) => s.theme)
  const set = useUI((s) => s.set)
  const real = useProject((s) => hasHouse(s.project))
  const name = useProject((s) => s.project.name)
  const go = (mode: Parameters<typeof setMode>[0]) => {
    if (!real) {
      useUI.getState().toast({ kind: 'info', title: 'Generate or open a house first', body: 'Use Generate Possible Designs on the left, or open the demo house.' })
      return
    }
    set({ screen: 'workspace' })
    setMode(mode)
  }
  const items: { label: string; icon: JSX.Element; on?: boolean; run: () => void }[] = [
    { label: 'Home', icon: <HomeIcon />, on: true, run: () => {} },
    { label: 'Design', icon: <PencilRuler />, run: () => go('plan') },
    { label: 'Sketch', icon: <PenLine />, run: () => go('sketch') },
    { label: 'Generate Designs', icon: <Sparkles />, run: () => set({ screen: 'wizard' }) },
    { label: '3D View', icon: <Box />, run: () => go('3d') },
    { label: 'Video Tour', icon: <Video />, run: () => go('drone') },
    { label: 'Showcase', icon: <Images />, run: () => (real ? set({ screen: 'showcase' }) : go('plan')) },
    { label: 'Materials', icon: <Palette />, run: () => go('materials') },
    { label: 'Save / Export', icon: <Save />, run: () => (real ? useUI.getState().openDialog('export') : go('plan')) }
  ]
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <header className="dash-nav titlebar">
      <div className="brand">
        <span className="brand-tile">
          <BrandMark size={22} />
        </span>
        <span className="brand-text">
          <b>HomeForge AI</b>
          <small>Design • Plan • Visualize • Build</small>
        </span>
      </div>
      <div className="drag" />
      <nav className="dash-links">
        {items.map((i) => (
          <button key={i.label} className={i.on ? 'on' : ''} onClick={i.run} aria-label={i.label} data-tip={i.label}>
            {i.icon}
            <span>{i.label}</span>
          </button>
        ))}
      </nav>
      <div className="drag" />
      <button className="icon-btn" aria-label="Projects" data-tip="Open, recent and templates" onClick={onProjects}>
        <FolderOpen />
      </button>
      <button className="icon-btn" aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'} data-tip={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })}>
        {theme === 'dark' ? <Sun /> : <Moon />}
      </button>
      <button className="icon-btn" aria-label="Settings" data-tip="Settings" onClick={() => useUI.getState().openDialog('settings')}>
        <Settings />
      </button>
      <button className="avatar-btn" aria-label="Account and projects" data-tip={real ? name : 'Projects'} onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setMenu({ x: r.right - 220, y: r.bottom + 6 })
        }}>
        <UserRound />
      </button>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { heading: real ? name : 'HomeForge AI' },
            { label: 'Open, recent and templates…', onClick: onProjects },
            ...(real ? [{ label: 'Save project', shortcut: 'Ctrl+S', onClick: () => void saveProject() }] : []),
            { label: theme === 'dark' ? 'Light theme' : 'Dark theme', onClick: () => set({ theme: theme === 'dark' ? 'light' : 'dark' }) },
            { label: 'Keyboard shortcuts', onClick: () => useUI.getState().openDialog('shortcuts') },
            { label: 'Settings', onClick: () => useUI.getState().openDialog('settings') }
          ]}
        />
      )}
    </header>
  )
}

/* ── left: project setup ─────────────────────────────────────────────────── */

const SIZES = ['5-marla', '7-marla', '10-marla', '15-marla', '1-kanal', '2-kanal', '4-kanal']
const FLOORS: { v: FloorsOption; label: string }[] = [
  { v: 'single', label: '1' },
  { v: 'double', label: '2' },
  { v: 'triple', label: '3' },
  { v: 'basement+ground', label: 'Basement + 1' },
  { v: 'basement+ground+first', label: 'Basement + 2' },
  { v: 'basement+ground+first+second', label: 'Basement + 3' }
]
const STYLE_CHOICES: { v: ArchitecturalStyle | 'mix'; label: string }[] = [
  { v: 'mix', label: 'Mix of styles' },
  ...(['luxury', 'luxury_classic', 'contemporary', 'european', 'minimalist', 'traditional', 'modern', 'mediterranean', 'colonial', 'islamic', 'farmhouse', 'industrial', 'pakistani_modern'] as ArchitecturalStyle[]).map((v) => ({ v, label: STYLE_TITLE[v] }))
]
const metric = (u: UnitSystem) => u === 'm' || u === 'cm'
const num = (m: number, u: UnitSystem) => (metric(u) ? m : m / FT)

function SetupPanel(props: { project: Project | null; onDesigns: (d: DesignOption[]) => void; onProjects: () => void }) {
  const w = useWizard()
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState<string | null>(null)
  const [styleChoice, setStyleChoice] = useState<ArchitecturalStyle | 'mix'>('mix')
  const [dimUnits, setDimUnits] = useState<UnitSystem>('m')
  const u = props.project?.settings.units ?? 'ft-in'
  const preset = w.plot.presetId
  const custom = !preset
  const generate = async () => {
    setRunning('Starting…')
    let done = 0
    try {
      const req = styleChoice === 'mix' ? w.req : { ...w.req, style: styleChoice }
      const { designs, errors } = await generateDesignsParallel(req, w.plot, props.project?.settings ?? newProject().settings, (g) => {
        if (g.design) done += 1
        setRunning(`Designing… ${done} of 5 ready`)
      }, styleChoice === 'mix' ? { styles: MIX_STYLES } : {})
      if (!designs.length) {
        useUI.getState().showError({ what: 'No design could be generated.', why: errors[0]?.why ?? 'The requirements do not fit on this plot.', fix: errors[0]?.fix ?? 'Choose a larger plot or fewer rooms, then try again.', retry: () => void generate() })
        return
      }
      // the luxury villa (or the first design) becomes the house straight away; the strip offers the others
      const first = designs.find((d) => d.strategy === 'luxury-open') ?? designs[0]
      props.onDesigns(designs)
      const p = getProject()
      if (!hasHouse(p)) {
        const np = projectFromDesign(first, structuredClone(req), designs)
        atEvening(np)
        useProject.getState().load(np)
      } else {
        commit('Update requirements', (d) => {
          d.requirements = structuredClone(req) as typeof d.requirements
          d.designs = designs as typeof d.designs
        })
        applyDesignToProject(first)
      }
      const g = sortedFloors(getProject().floors).find((f) => f.level === 0)
      useUI.getState().set({ floorId: g?.id ?? '' })
      useUI.getState().toast({ kind: 'success', title: `${designs.length} designs ready`, body: `${STYLE_TITLE[first.house.exterior.style]} is shown. Pick another from the strip below the 3D view.` })
    } finally {
      setRunning(null)
    }
  }
  const describe = () => {
    if (!prompt.trim()) return
    const r = parseRequirements(prompt, w.req)
    w.applyParsed(r, prompt)
    useUI.getState().toast({ kind: 'info', title: 'Requirements filled in', body: r.findings.slice(0, 4).map((f) => f.meaning).join(', ') || 'Check them below, then generate.' })
  }
  // full review: the step-by-step wizard opens on the filled-in requirements
  const plan = () => {
    if (!prompt.trim()) return
    const ws = useWizard.getState()
    ws.reset()
    const r = parseRequirements(prompt, ws.req)
    ws.applyParsed(r, prompt)
    useUI.getState().set({ screen: 'wizard' })
    useWizard.getState().setStep(r.plot ? 7 : 0)
  }
  const req = w.req
  const toggles: { label: string; on: boolean; set: (v: boolean) => void }[] = [
    { label: 'Patio', on: req.outdoor.patio, set: (v) => w.setReq((r) => void (r.outdoor.patio = v)) },
    { label: 'Basement', on: req.special.basement || req.floors.startsWith('basement'), set: (v) => w.setReq((r) => {
        r.special.basement = v
        if (v && !r.floors.startsWith('basement')) r.floors = r.floors === 'single' ? 'basement+ground' : r.floors === 'triple' ? 'basement+ground+first+second' : 'basement+ground+first'
        if (!v && r.floors.startsWith('basement')) r.floors = r.floors === 'basement+ground' ? 'single' : r.floors === 'basement+ground+first' ? 'double' : 'triple'
      }) },
    { label: 'Garage', on: req.outdoor.garage, set: (v) => w.setReq((r) => {
        r.outdoor.garage = v
        if (v && r.outdoor.cars === 0) r.outdoor.cars = 1
      }) },
    { label: 'Lawn / Garden', on: req.outdoor.frontLawn || req.outdoor.backLawn, set: (v) => w.setReq((r) => {
        r.outdoor.frontLawn = v
        r.outdoor.backLawn = v
      }) },
    { label: 'Pillars', on: !!req.special.pillars, set: (v) => w.setReq((r) => void (r.special.pillars = v)) },
    { label: 'Pool', on: req.outdoor.pool, set: (v) => w.setReq((r) => void (r.outdoor.pool = v)) },
    { label: 'Double height', on: req.special.doubleHeightLounge, set: (v) => w.setReq((r) => void (r.special.doubleHeightLounge = v)) }
  ]
  const roomList = props.project ? props.project.floors.flatMap((f) => f.rooms.filter((r) => !['void', 'corridor', 'foyer', 'stair', 'mumty', 'balcony', 'terrace', 'lift'].includes(r.type) && !spec(r.type).outdoor)) : []
  const fmt = (m: number) => (metric(dimUnits) ? (Math.round(m * 10) / 10).toString() : formatLength(m, 'ft-in', { compact: true }))
  const reqRow = (icon: JSX.Element, label: string, control: JSX.Element) => (
    <div className="req-row">
      <span className="req-label">
        {icon}
        {label}
      </span>
      {control}
    </div>
  )
  const numSelect = (value: number, min: number, max: number, onChange: (v: number) => void, aria: string) => (
    <select className="field" value={value} aria-label={aria} onChange={(e) => onChange(Number(e.target.value))}>
      {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  )
  return (
    <aside className="dash-left">
      <div className="panel-title">
        <PencilRuler size={16} /> Project Setup
      </div>
      <section className="dash-card">
        <header>
          <h3>Describe your house</h3>
        </header>
        <textarea className="field" rows={2} placeholder="Describe the house you want, for example: 10 marla, 2 floors, 4 bedrooms, basement, lawn, 2 car garage" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && describe()} aria-label="Describe your house" />
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <button className="btn sm primary grow" disabled={!prompt.trim()} onClick={plan} data-tip="Review every requirement step by step">
            Plan my house
          </button>
          <button className="btn sm" disabled={!prompt.trim()} onClick={describe} data-tip="Fill in the setup below without leaving this page">
            <Wand2 size={13} /> Fill in
          </button>
        </div>
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <button className="btn sm ghost" onClick={() => void openDemoHouse('home')}>
            <CirclePlay size={13} /> Demo house
          </button>
          <button className="btn sm ghost" onClick={props.onProjects}>
            <FolderOpen size={13} /> Open or recent
          </button>
        </div>
      </section>
      <section className="dash-card">
        <header>
          <h3>House Size</h3>
          <span className="sub">{formatPlotSize(w.plot.width, w.plot.depth, u)}</span>
        </header>
        <div className="size-grid">
          {SIZES.map((id) => {
            const pr = presetById(id)!
            return (
              <button key={id} className={preset === id ? 'on' : ''} onClick={() => w.choosePreset(id)}>
                {pr.label}
              </button>
            )
          })}
        </div>
        <label className="side-check custom-size">
          <input type="checkbox" checked={custom} onChange={(e) => (e.target.checked ? w.setCustom(w.plot.width, w.plot.depth) : w.choosePreset('10-marla'))} />
          Custom Size
        </label>
        {custom && (
          <div className="custom-size-fields">
            <LengthField value={w.plot.width} units={u} min={4.5} max={150} onCommit={(v) => w.setCustom(v, w.plot.depth)} tip="Plot width (frontage)" />
            <span className="faint">×</span>
            <LengthField value={w.plot.depth} units={u} min={7} max={250} onCommit={(v) => w.setCustom(w.plot.width, v)} tip="Plot depth" />
          </div>
        )}
        {reqRow(<Building2 size={14} />, 'City', (
          <CitySelect
            plot={w.plot}
            onChange={(loc) => {
              w.setPlot((p) => void (p.location = loc))
              if (props.project)
                commit(`Location: ${loc.city}`, (d) => {
                  d.plot.location = loc
                  d.settings.lighting.latitude = loc.lat
                })
            }}
          />
        ))}
        {reqRow(<SlidersHorizontal size={14} />, 'Rules', (
          <AuthoritySelect
            value={w.plot.authority}
            onChange={(a) => {
              w.setPlot((p) => {
                p.authority = a
                if (a) p.setbacks = setbacksFor(a, p)
                else p.setbacks = makePlot(p.width, p.depth, p.presetId).setbacks
              })
              if (props.project)
                commit(a ? 'Building rules' : 'No authority rules', (d) => {
                  d.plot.authority = a
                  if (a) d.plot.setbacks = setbacksFor(a, d.plot)
                })
            }}
          />
        ))}
      </section>
      <section className="dash-card">
        <header>
          <h3>House Requirements</h3>
        </header>
        {reqRow(<Layers3 size={14} />, 'Floors', (
          <select className="field" aria-label="Floors" value={req.floors === 'custom' ? 'double' : req.floors} onChange={(e) => w.setReq((r) => void (r.floors = e.target.value as FloorsOption))}>
            {FLOORS.map((f) => (
              <option key={f.v} value={f.v}>
                {f.label}
              </option>
            ))}
          </select>
        ))}
        {reqRow(<BedDouble size={14} />, 'Bedrooms', numSelect(req.rooms.bedrooms, 1, 10, (v) => w.setReq((r) => {
          r.rooms.bedrooms = v
          r.rooms.bathrooms = Math.max(r.rooms.bathrooms, v)
        }), 'Bedrooms'))}
        {reqRow(<Bath size={14} />, 'Bathrooms', numSelect(req.rooms.bathrooms, 1, 12, (v) => w.setReq((r) => void (r.rooms.bathrooms = v)), 'Bathrooms'))}
        {reqRow(<Car size={14} />, 'Car parking', numSelect(req.outdoor.cars, 0, 4, (v) => w.setReq((r) => {
          r.outdoor.cars = v
          r.outdoor.garage = v > 0
        }), 'Car parking'))}
        {reqRow(<Palmtree size={14} />, 'Style', (
          <select className="field" aria-label="Style" value={styleChoice} onChange={(e) => {
              const v = e.target.value as ArchitecturalStyle | 'mix'
              setStyleChoice(v)
              if (v !== 'mix') w.setReq((r) => void (r.style = v))
            }}>
            {STYLE_CHOICES.map((s) => (
              <option key={s.v} value={s.v}>
                {s.label}
              </option>
            ))}
          </select>
        ))}
        <div className="req-checks">
          {toggles.map((t) => (
            <label key={t.label} className="side-check">
              <input type="checkbox" checked={t.on} onChange={(e) => t.set(e.target.checked)} />
              {t.label}
            </label>
          ))}
        </div>
        <button className="link-btn" onClick={() => useUI.getState().set({ screen: 'wizard' })}>
          All requirements and preferences
        </button>
      </section>
      {roomList.length > 0 && (
        <section className="dash-card">
          <header>
            <h3>Room Dimensions</h3>
            <Seg value={dimUnits === 'm' ? 'm' : 'ft-in'} onChange={(v) => setDimUnits(v as UnitSystem)} options={[{ value: 'm', label: 'm' }, { value: 'ft-in', label: 'ft' }]} />
          </header>
          <div className="room-dims">
            {roomList.slice(0, 14).map((r) => {
              const b = bbox(r.polygon)
              return (
                <div key={r.id} className="count-row">
                  <span>{r.name}</span>
                  <span className="tabular dim-chip">
                    {fmt(Math.max(b.w, b.h))} × {fmt(Math.min(b.w, b.h))}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}
      <button className="btn primary big gen-btn" disabled={!!running} onClick={() => void generate()}>
        <Sparkles size={16} /> {running ? running : 'Generate possible designs'}
      </button>
      <p className="faint" style={{ fontSize: 11, margin: '8px 2px 0' }}>
        {DISCLAIMER}
      </p>
    </aside>
  )
}

/* ── centre: hero (live 3D with editing tools) ───────────────────────────── */

type HeroView = 'exterior' | 'interior' | 'top'
type ExtCam = 'drone' | 'street' | 'facade' | 'orbit' | 'front' | 'back' | 'left' | 'right'
type HeroTool = 'select' | 'move' | 'rotate' | 'resize'

const EXT_CAMS: { key: ExtCam; label: string }[] = [
  { key: 'drone', label: 'Drone view' },
  { key: 'street', label: 'Street view' },
  { key: 'facade', label: 'Front facade' },
  { key: 'orbit', label: 'Orbit (turning)' },
  { key: 'front', label: 'Front' },
  { key: 'back', label: 'Back' },
  { key: 'left', label: 'Left side' },
  { key: 'right', label: 'Right side' }
]

/**
 * Camera for the dashboard hero: a three-quarter view of the front from the left, either raised
 * ("drone") or from the road at eye level, distanced so the whole house fits, and nudged so the house
 * sits clear of the View Mode panel on the right.
 */
function heroPose(p: Project, cam: 'drone' | 'street', aspect: number) {
  const pts = p.floors.filter((f) => f.level >= 0).flatMap((f) => f.rooms.filter((r) => r.type !== 'void' && !spec(r.type).outdoor).flatMap((r) => r.polygon))
  const b = bbox(pts.length ? pts : p.plot.polygon)
  const H = p.floors.filter((f) => f.level >= 0 && f.kind !== 'roof').reduce((a, f) => a + f.height, 0) + p.settings.plinthHeight + 1.2
  const fov = cam === 'drone' ? 40 : 50
  const vf = THREE.MathUtils.degToRad(fov) / 2
  const hf = Math.atan(Math.tan(vf) * aspect)
  const target = new THREE.Vector3(b.x + b.w / 2, H * 0.5, b.y + b.h / 2)
  const az = cam === 'drone' ? 0.4 : 0.36
  const el = cam === 'drone' ? 0.3 : 0.04
  const dir = new THREE.Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
  // fit the house's bounding sphere, but don't step back further than the road for an eye-level view
  const r = 0.5 * Math.hypot(b.w, b.h, H)
  let dist = (r / Math.sin(Math.min(vf, hf))) * (cam === 'drone' ? 0.98 : 0.9)
  if (cam === 'street') dist = Math.min(dist, (p.plot.depth + p.plot.roadWidth * 0.8 - target.z) / Math.cos(az))
  const pos = target.clone().addScaledVector(dir, dist)
  if (cam === 'street') pos.y = 1.7
  const right = new THREE.Vector3().subVectors(target, pos).cross(new THREE.Vector3(0, 1, 0)).normalize()
  const shift = dist * Math.tan(hf) * 0.08
  pos.addScaledVector(right, shift)
  target.addScaledVector(right, shift)
  // and lowered in the frame, below the toolbar across the top
  const camUp = right.clone().cross(new THREE.Vector3().subVectors(target, pos)).normalize()
  const lift = dist * Math.tan(vf) * 0.14
  pos.addScaledVector(camUp, lift)
  target.addScaledVector(camUp, lift)
  return { pos, target, fov }
}

function entityLabel(p: Project, e: EntityRef | undefined): string | null {
  if (!e) return null
  const f = p.floors.find((x) => x.id === e.floorId)
  switch (e.kind) {
    case 'room':
      return f?.rooms.find((r) => r.id === e.id)?.name ?? 'Room'
    case 'furniture': {
      const it = f?.furniture.find((x) => x.id === e.id)
      return it ? (catalogItem(it.type)?.name ?? it.type) : 'Furniture'
    }
    case 'wall':
      return 'Wall'
    case 'stair':
      return 'Stairs'
    case 'column':
      return 'Column'
    case 'siteArea':
      return p.site.areas.find((a) => a.id === e.id)?.name ?? 'Garden area'
    default:
      return null
  }
}

function Hero({ project, real, onRoom }: { project: Project | null; real: boolean; onRoom: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<HeroView>('exterior')
  const [cam, setCam] = useState<string>('drone')
  const [tool, setTool] = useState<HeroTool>('select')
  const [needle, setNeedle] = useState(0)
  const canUndo = useProject((s) => s.past.length > 0)
  const canRedo = useProject((s) => s.future.length > 0)
  const selection = useUI((s) => s.selection)
  const live = useProject((s) => s.project)
  const lighting = (real ? live : (project ?? live)).settings.lighting
  const rooms = useMemo(() => (project ? project.floors.flatMap((f) => f.rooms.filter((r) => spec(r.type).walkable && !spec(r.type).outdoor && r.type !== 'garage').map((r) => ({ f, r }))) : []), [project])

  // mount the shared engine here and frame the camera for the chosen view
  useEffect(() => {
    const el = ref.current
    if (!el || !project) return
    const e = getEngine()
    e.mount(el)
    e.setController(null)
    e.update(project, heroOptions(project))
    e.controls.autoRotate = false
    if (view === 'exterior') {
      if (cam === 'drone' || cam === 'street') {
        const pose = heroPose(project, cam, el.clientWidth / Math.max(1, el.clientHeight))
        e.camera.fov = pose.fov
        e.camera.updateProjectionMatrix()
        e.flyTo(pose.pos, pose.target, 0)
      } else if (cam === 'orbit') {
        const c = e.houseCenter()
        const s = Math.max(10, Math.min(60, Math.max(project.plot.width, project.plot.depth)))
        e.flyTo(new THREE.Vector3(c.x + s * 1.1, c.y + s * 0.62, c.z + s * 1.3), c, 0)
        e.controls.autoRotate = true
        e.controls.autoRotateSpeed = 0.35
      } else e.setCameraPreset(cam as 'facade' | 'front' | 'back' | 'left' | 'right', undefined, false)
    } else if (view === 'interior') {
      const r = rooms.find((x) => x.r.id === cam) ?? rooms.find((x) => ['tv_lounge', 'living', 'drawing'].includes(x.r.type)) ?? rooms[0]
      if (r) {
        useUI.getState().set({ floorId: r.f.id })
        e.update(project, { ...heroOptions(project), floorId: r.f.id })
        e.setCameraPreset('room', r.r.id, false)
      } else e.setCameraPreset('interior', undefined, false)
    } else e.setCameraPreset('top', undefined, false)
    e.controls.update()
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      if (e.controls.autoRotate) {
        e.controls.update()
        e.invalidate()
      }
      // the compass follows the camera
      if (t - last > 100) {
        last = t
        // the way the view faces across the ground (straight down: the top of the screen)
        const cm = e.active
        cm.updateMatrixWorld()
        const f = new THREE.Vector3(0, 0, -1).transformDirection(cm.matrixWorld)
        if (Math.abs(f.y) > 0.95) f.set(0, 1, 0).transformDirection(cm.matrixWorld)
        const n = planBearing(project.plot, 0)
        const sx = -n.x * f.z + n.y * f.x
        const sy = n.x * f.x + n.y * f.z
        setNeedle((Math.atan2(sx, sy) * 180) / Math.PI)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      e.controls.autoRotate = false
      e.camera.fov = 50
      e.camera.updateProjectionMatrix()
      e.highlight(null, 'select')
      e.unmount(el)
    }
    // the camera is framed once per house and view; edits below only refresh the scene
  }, [project?.id, view, cam]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (project && ref.current && hasEngine() && getEngine().container === ref.current) getEngine().update(project, heroOptions(project))
  }, [project])

  // picking: a click (not a drag) selects what is under the pointer
  const down = useRef<{ x: number; y: number } | null>(null)
  const onUp = (ev: React.PointerEvent) => {
    const d = down.current
    down.current = null
    if (!d || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 4 || ev.button !== 0 || !project || !hasEngine()) return
    const e = getEngine()
    const hit = e.pick(ev.clientX, ev.clientY)
    const ent = surfaceToEntity(hit?.surface ?? null)
    e.highlight(hit?.surface ?? null, 'select')
    if (!real) {
      if (ent) useUI.getState().toast({ kind: 'info', title: 'This is a sample house', body: 'Generate or open your own house to edit it.' })
      return
    }
    useUI.getState().set({ selection: ent ? [ent] : [], surface: hit?.surface ?? null })
    if (ent?.kind === 'room') onRoom(ent.id)
    if (ent && tool !== 'select') runTool(tool, ent)
  }

  const needSel = () => {
    useUI.getState().toast({ kind: 'info', title: 'Select something first', body: 'Click a room, wall or piece of furniture in the 3D view.' })
  }
  const openEditor = (label: string, body: string) => {
    useUI.getState().set({ screen: 'workspace', tool: 'select' })
    setMode('plan')
    useUI.getState().toast({ kind: 'info', title: label, body })
  }
  const runTool = (t: HeroTool, ent: EntityRef | undefined = selection[0]) => {
    setTool(t)
    if (t === 'select') return
    if (!real) return useUI.getState().toast({ kind: 'info', title: 'Generate or open a house first' })
    if (!ent) return needSel()
    if (ent.floorId) useUI.getState().set({ floorId: ent.floorId })
    if (t === 'move') return openEditor('Drag to move it', 'The selection is kept in the plan. Drag it, or use the arrow keys.')
    if (t === 'rotate') {
      if (ent.kind === 'furniture' || ent.kind === 'stair' || ent.kind === 'column') {
        rotateSelection(Math.PI / 2)
        return useUI.getState().toast({ kind: 'success', title: 'Turned 90°', body: 'Press Rotate again to keep turning; Ctrl+Z undoes it.' })
      }
      return openEditor('Rooms and walls turn in the plan', 'Drag a corner to reshape, or redraw the room with the Draw room tool.')
    }
    if (t === 'resize') {
      if (ent.kind === 'room') {
        onRoom(ent.id)
        document.querySelector('.dims-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return useUI.getState().toast({ kind: 'info', title: 'Resize on the right', body: 'Set length, width and height under Adjust Dimensions, then Apply changes.' })
      }
      return openEditor('Drag the handles to resize', 'The selection is kept in the plan.')
    }
  }
  const setLight = (time: number, preset: 'noon' | 'sunset' | 'night' | 'custom') => {
    if (!real) return useUI.getState().toast({ kind: 'info', title: 'Generate or open a house first', body: 'The sample house keeps its evening light.' })
    commit('Lighting', (d) => {
      d.settings.lighting.preset = preset
      d.settings.lighting.time = time
    })
  }
  const sel = selection[0]
  const selLabel = real ? entityLabel(live, sel) : null
  const { sunset } = sunriseSunset(lighting.latitude, lighting.dayOfYear)
  const t = lighting.time
  const lightKey = t > sunset - 1 || t < 6 ? (t > sunset + 0.75 || t < 6 ? 'night' : t > sunset ? 'evening' : 'sunset') : 'day'
  const lights = [
    ['day', <Sun key="d" />, 'Day', presetTime('noon', lighting.latitude, lighting.dayOfYear), 'noon'],
    ['sunset', <Sunset key="s" />, 'Sunset', presetTime('sunset', lighting.latitude, lighting.dayOfYear), 'sunset'],
    ['evening', <CloudMoon key="e" />, 'Evening', eveningTime(lighting), 'custom'],
    ['night', <Moon key="n" />, 'Night', presetTime('night', lighting.latitude, lighting.dayOfYear), 'night']
  ] as const
  const tools: { k: HeroTool | 'draw' | 'measure' | 'undo' | 'redo'; label: string; icon: JSX.Element; run: () => void; disabled?: boolean; on?: boolean }[] = [
    { k: 'select', label: 'Select', icon: <MousePointer2 />, run: () => runTool('select'), on: tool === 'select' },
    { k: 'move', label: 'Move', icon: <Move />, run: () => runTool('move'), on: tool === 'move' },
    { k: 'rotate', label: 'Rotate', icon: <RotateCw />, run: () => runTool('rotate'), on: tool === 'rotate' },
    { k: 'resize', label: 'Resize', icon: <Scaling />, run: () => runTool('resize'), on: tool === 'resize' },
    { k: 'draw', label: 'Draw / Sketch', icon: <PenLine />, run: () => {
        if (!real) useSketch.getState().set({ mode: 'replace' })
        else useSketch.getState().set({ mode: 'add', tool: 'pen' })
        useUI.getState().set({ screen: 'workspace' })
        setMode('sketch')
      } },
    { k: 'measure', label: 'Measure', icon: <Ruler />, run: () => {
        if (!real) return useUI.getState().toast({ kind: 'info', title: 'Generate or open a house first' })
        // switching mode resets the tool, so pick the tool after
        useUI.getState().set({ screen: 'workspace' })
        setMode('plan')
        useUI.getState().set({ tool: 'measure' })
      } },
    { k: 'undo', label: 'Undo', icon: <Undo2 />, run: () => useProject.getState().undo(), disabled: !canUndo },
    { k: 'redo', label: 'Redo', icon: <Redo2 />, run: () => useProject.getState().redo(), disabled: !canRedo }
  ]
  return (
    <section className="dash-hero">
      <div ref={ref} className="dash-hero-canvas" onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })} onPointerUp={onUp} />
      {!project && (
        <div className="dash-hero-wait">
          <span className="spinner" /> Preparing a house to show you…
        </div>
      )}
      <div className="hero-tools" role="toolbar" aria-label="3D tools">
        {tools.map((t, i) => (
          <button key={t.k} className={`${t.on ? 'on' : ''} ${i === 6 ? 'sep' : ''}`} disabled={t.disabled} onClick={t.run} aria-label={t.label} data-tip={t.label}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="hero-panel">
        <div className="hero-panel-label">View Mode</div>
        <Seg
          value={view}
          onChange={(v) => {
            setView(v)
            setCam(v === 'exterior' ? 'drone' : '')
          }}
          options={[{ value: 'exterior', label: 'Exterior' }, { value: 'interior', label: 'Interior' }, { value: 'top', label: 'Top View' }]}
        />
        <div className="hero-panel-row">
          <div className="grow">
            <div className="hero-panel-label">Camera</div>
            <select className="field" aria-label="Camera" value={cam} disabled={view === 'top'} onChange={(e) => setCam(e.target.value)}>
              {view === 'interior'
                ? rooms.map(({ f, r }) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({f.name.toLowerCase()})
                    </option>
                  ))
                : view === 'top'
                  ? [<option key="t">Plan from above</option>]
                  : EXT_CAMS.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
            </select>
          </div>
          <svg className="compass-rose" viewBox="-30 -30 60 60" aria-label="Compass" role="img">
            <circle r="27" className="ring" />
            <g transform={`rotate(${needle})`}>
              <path d="M0,-19 L5,0 L0,4 L-5,0 Z" className="n" />
              <path d="M0,19 L5,0 L0,-4 L-5,0 Z" className="s" />
              <text y="-21.5">N</text>
              <text x="22" y="1.5">E</text>
              <text y="25">S</text>
              <text x="-22" y="1.5">W</text>
            </g>
          </svg>
        </div>
        <div className="hero-panel-row">
          <div className="seg hero-light">
            {lights.map(([k, icon, label, time, preset]) => (
              <button key={k} className={lightKey === k ? 'on' : ''} data-tip={label} aria-label={label} onClick={() => setLight(time, preset)}>
                {icon}
              </button>
            ))}
          </div>
          <div className="grow" />
          <button className="icon-btn" aria-label="Explore every area" data-tip="Explore every area: kitchen, lounge, bedrooms, bathrooms…" disabled={!real} onClick={() => useUI.getState().set({ screen: 'showcase' })}>
            <Images />
          </button>
          <button className="icon-btn" aria-label="Photoreal render" data-tip="Photoreal render" onClick={() => useUI.getState().openDialog('photoreal')}>
            <Aperture />
          </button>
          <button className="icon-btn" aria-label="Open full 3D" data-tip="Open full 3D" disabled={!real} onClick={() => {
              useUI.getState().set({ screen: 'workspace' })
              setMode('3d')
            }}>
            <Maximize2 />
          </button>
        </div>
      </div>
      <span className="hero-chip">3D View ({view === 'exterior' ? 'Exterior' : view === 'interior' ? 'Interior' : 'Top'})</span>
      {selLabel && (
        <span className="hero-chip sel">
          {selLabel} selected
          <button className="link-btn" onClick={() => runTool('move', sel)}>
            Edit in plan
          </button>
        </span>
      )}
    </section>
  )
}

function heroOptions(p: Project) {
  const g = sortedFloors(p.floors).find((f) => f.level === 0) ?? p.floors[0]
  return { floorId: g.id, showAll: true, viewMode: 'realistic' as const, explodeGap: 0, doorsOpen: true, showFurniture: true, showStructure: true }
}

/* ── centre: plan tiles ──────────────────────────────────────────────────── */

function TileZoom({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  return (
    <div className="tile-zoom" onClick={(e) => e.stopPropagation()}>
      <button aria-label="Zoom in" data-tip="Zoom in" onClick={() => setZoom(Math.min(3, zoom * 1.25))}>
        <ZoomIn />
      </button>
      <button aria-label="Zoom out" data-tip="Zoom out" onClick={() => setZoom(Math.max(0.6, zoom / 1.25))}>
        <ZoomOut />
      </button>
      <button aria-label="Fit" data-tip="Fit" onClick={() => setZoom(1)}>
        <Scan />
      </button>
    </div>
  )
}

function PlanTile({ project }: { project: Project | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [tick, setTick] = useState(0)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el || !project) return
    const r = el.getBoundingClientRect()
    const fl = plansFor(project, r.width / Math.max(1, r.height))
    if (!fl.length) return
    let t = 0
    const w = Math.max(140, Math.min(r.width / fl.length, (r.height * project.plot.width) / Math.max(1, project.plot.depth) + 60))
    const canvases = fl.map((f) => {
      const c = renderPlanToCanvas(project, f, w * zoom, Math.max(140, r.height) * zoom, {
        theme: 'rendered',
        site: true,
        dpr: window.devicePixelRatio || 1,
        pad: 0.05,
        onReady: () => {
          clearTimeout(t)
          t = window.setTimeout(() => setTick((n) => n + 1), 120)
        }
      })
      c.style.width = `${w * zoom}px`
      c.style.height = `${Math.max(140, r.height) * zoom}px`
      c.style.flex = 'none'
      return c
    })
    el.replaceChildren(...canvases)
    // keep the middle of the drawing in view when zoomed
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2
    return () => clearTimeout(t)
  }, [project, tick, zoom])
  const fl = project ? plansFor(project, 2.6) : []
  return (
    <section className="dash-tile" onClick={() => project && hasHouse(getProject()) && (useUI.getState().set({ screen: 'workspace' }), setMode('plan'))}>
      <div ref={ref} className={`dash-tile-img light ${zoom > 1 ? 'scroll' : ''}`} />
      <span className="hero-chip">{fl.length > 1 ? `2D Floor Plan (${fl.map((f) => f.name).join(' + ')})` : '2D Floor Plan (Ground Floor)'}</span>
      <TileZoom zoom={zoom} setZoom={setZoom} />
    </section>
  )
}

/** The floors a plan tile shows: the ground floor, plus the next one up when a portrait plot leaves room beside it. */
function plansFor(p: Project, aspect: number) {
  const fs = sortedFloors(p.floors).filter((f) => f.level >= 0 && f.rooms.length > 0)
  const g = fs.find((f) => f.level === 0) ?? fs[0]
  if (!g) return []
  const second = fs.find((f) => f.level === 1)
  return second && (p.plot.depth / Math.max(1, p.plot.width)) * aspect > 2.2 ? [g, second] : [g]
}

function CutawayTile({ project }: { project: Project | null }) {
  const [img, setImg] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    if (!project) return
    let alive = true
    const g = sortedFloors(project.floors).find((f) => f.level === 0)!
    const all = project.floors.flatMap((f) => (f.level === 0 ? f.rooms.flatMap((r) => r.polygon) : []))
    const b = bbox(all.length ? all : project.plot.polygon)
    const el = floorElevations(project.floors, project.settings.plinthHeight).get(g.id) ?? 0
    const c = { x: b.x + b.w / 2, z: b.y + b.h / 2 }
    const size = Math.max(b.w, b.h) / zoom
    const t = setTimeout(() => {
      renderHouseImage(project, { width: 720, height: 420, viewMode: 'dollhouse', floorId: g.id, pose: { position: [c.x + size * 0.55, el + size * 0.95, c.z + size * 0.85], target: [c.x, el, c.z], fov: 42 } }).then((u) => alive && setImg(u))
    }, 600)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [project, zoom])
  return (
    <section className="dash-tile" onClick={() => project && hasHouse(getProject()) && (useUI.getState().set({ screen: 'workspace', viewMode: 'dollhouse' }), setMode('3d'))}>
      <div className="dash-tile-img" style={img ? { backgroundImage: `url("${img}")` } : undefined}>
        {!img && <span className="spinner" />}
      </div>
      <span className="hero-chip">3D Floor Plan (Ground Floor)</span>
      <TileZoom zoom={zoom} setZoom={setZoom} />
    </section>
  )
}

/* ── centre: designs ─────────────────────────────────────────────────────── */

function designTitle(d: DesignOption) {
  return STYLE_TITLE[d.house.exterior.style] ?? d.name
}

function DesignStrip({ designs, activeId, shown }: { designs: DesignOption[]; activeId?: string; shown: Project | null }) {
  const [sort, setSort] = useState<'overall' | 'garden' | 'space' | 'privacy'>('overall')
  const list = [...designs].sort((a, b) => b.scores[sort] - a.scores[sort])
  const select = (d: DesignOption) => {
    const p = getProject()
    if (!hasHouse(p)) {
      const np = projectFromDesign(d, structuredClone(useWizard.getState().req), designs)
      atEvening(np)
      useProject.getState().load(np)
    } else applyDesignToProject(d)
    useUI.getState().toast({ kind: 'success', title: designTitle(d), body: `${d.name}. Now shown in 3D and in the plan.` })
  }
  return (
    <section className="dash-designs">
      <header>
        <h3>Generated House Designs</h3>
        <span className="faint" style={{ fontSize: 11 }}>
          (based on your requirements)
        </span>
        <div className="grow" />
        <label className="faint" style={{ fontSize: 12 }}>
          Sort by{' '}
          <select className="field" style={{ width: 'auto', height: 26 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="overall">Most suitable</option>
            <option value="garden">Most garden</option>
            <option value="space">Largest rooms</option>
            <option value="privacy">Most privacy</option>
          </select>
        </label>
      </header>
      <div className="dash-design-row">
        {list.length ? (
          list.map((d) => <DesignCard key={d.id} d={d} on={d.id === activeId} onSelect={() => select(d)} />)
        ) : (
          <div className="dash-empty">Set the house size and requirements on the left, then choose Generate possible designs. Five complete designs, each in its own style, appear here.</div>
        )}
        <VideoCard shown={shown} />
      </div>
    </section>
  )
}

function DesignCard({ d, on, onSelect }: { d: DesignOption; on: boolean; onSelect: () => void }) {
  const [img, setImg] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const p = { ...newProject(), ...d.house } as Project
    // golden hour reads best at thumbnail size
    p.settings.lighting = { ...p.settings.lighting, preset: 'sunset', time: presetTime('sunset', p.settings.lighting.latitude, p.settings.lighting.dayOfYear) }
    renderHouseImage(p, { width: 360, height: 220, view: 'street' }).then((u) => alive && setImg(u))
    return () => {
      alive = false
    }
  }, [d])
  const s = d.stats
  const size = presetById(d.house.plot.presetId)?.label ?? formatAreaFor(area(d.house.plot.polygon), 'ft-in')
  return (
    <article className={`dash-design ${on ? 'on' : ''}`} data-tip={d.name}>
      <div className="img" style={img ? { backgroundImage: `url("${img}")` } : undefined}>
        {!img && <span className="spinner" />}
        <span className="letter">{d.label}</span>
      </div>
      <div className="body">
        <b>{designTitle(d)}</b>
        <span className="faint">
          {size} | {s.floors} Floors | {s.bedrooms} BHK
        </span>
        <span className="faint">
          {s.bathrooms} bath, {formatAreaFor(s.totalFloorArea, 'ft-in')}
        </span>
        <button className={`btn sm ${on ? '' : 'primary'}`} onClick={onSelect} disabled={on}>
          {on ? 'Selected' : 'Select'}
        </button>
      </div>
    </article>
  )
}

function VideoCard({ shown }: { shown: Project | null }) {
  const real = useProject((s) => hasHouse(s.project))
  const [img, setImg] = useState<string | null>(null)
  useEffect(() => {
    if (!shown) return
    let alive = true
    const t = setTimeout(() => void renderHouseImage(shown, { width: 420, height: 260, view: 'aerial' }).then((u) => alive && setImg(u)), 1400)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [shown?.id, shown?.activeDesignId]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = (route: DronePath) => {
    if (!real) return useUI.getState().toast({ kind: 'info', title: 'Generate or open a house first' })
    droneState.path = route
    useUI.getState().set({ screen: 'workspace' })
    setMode('drone')
  }
  return (
    <article className="dash-video" style={img ? { backgroundImage: `linear-gradient(rgba(8,16,29,.25), rgba(8,16,29,.7)), url("${img}")` } : undefined}>
      <span className="video-title">View This Design in Detail</span>
      <button className="play" onClick={() => go('full')} aria-label="Play the drone tour">
        <Play />
      </button>
      <div className="seg">
        <button onClick={() => go('exterior')}>Drone Tour</button>
        <button onClick={() => go('interior')}>Interior Tour</button>
        <button onClick={() => go('flyover')}>Exterior Views</button>
      </div>
    </article>
  )
}

/* ── right: finishes, customisation, sketch ──────────────────────────────── */

const SWATCHES: Record<string, { id: string; name: string }[]> = {
  marble: [
    { id: 'lib:marble-carrara', name: 'White Marble' },
    { id: 'lib:marble-nero', name: 'Black Marble' },
    { id: 'lib:marble-botticino', name: 'Beige Marble' },
    { id: 'lib:stone-slate', name: 'Grey Stone' },
    { id: 'lib:marble-emperador', name: 'Brown Marble' },
    { id: 'lib:marble-verde', name: 'Green Marble' },
    { id: 'lib:granite-black-galaxy', name: 'Granite' }
  ],
  wood: [
    { id: 'lib:wood-oak', name: 'Natural Oak' },
    { id: 'lib:wood-walnut', name: 'Walnut' },
    { id: 'lib:wood-teak', name: 'Teak' },
    { id: 'lib:wood-herringbone', name: 'Herringbone' },
    { id: 'lib:wood-maple', name: 'Light Maple' },
    { id: 'lib:wood-wenge', name: 'Wenge' },
    { id: 'lib:porcelain-wood-look', name: 'Wood-look Tile' }
  ],
  tiles: [
    { id: 'lib:porcelain-statuario', name: 'Statuario Slab' },
    { id: 'lib:porcelain-ivory', name: 'Ivory Tile' },
    { id: 'lib:ceramic-grey-matte', name: 'Grey Matte' },
    { id: 'lib:porcelain-concrete-grey', name: 'Concrete Grey' },
    { id: 'lib:porcelain-black-matte', name: 'Black Matte' },
    { id: 'lib:ceramic-subway', name: 'Subway White' },
    { id: 'lib:ceramic-moroccan', name: 'Moroccan' }
  ],
  other: [
    { id: 'lib:paint-warm-white', name: 'Warm White' },
    { id: 'lib:paint-greige', name: 'Greige Paint' },
    { id: 'lib:paint-sage', name: 'Sage Green' },
    { id: 'lib:wallpaper-linen', name: 'Linen Paper' },
    { id: 'lib:wallpaper-damask', name: 'Damask' },
    { id: 'lib:concrete-polished', name: 'Polished Concrete' },
    { id: 'lib:terrazzo-classic', name: 'Terrazzo' }
  ]
}
const MAT_TABS: { key: string; label: string; cats: MaterialCategory[] }[] = [
  { key: 'marble', label: 'Marble / Stone', cats: ['marble', 'granite', 'stone'] },
  { key: 'wood', label: 'Wood', cats: ['wood'] },
  { key: 'tiles', label: 'Tiles', cats: ['ceramic', 'porcelain'] },
  { key: 'other', label: 'Others', cats: ['paint', 'wallpaper', 'concrete', 'brick', 'fabric'] }
]

interface RoomPick {
  f: Project['floors'][number]
  r: Room
}

function FinishesPanel(props: { project: Project | null; view: Project | null; current?: RoomPick; rooms: RoomPick[]; setRoomId: (id: string) => void }) {
  const [tab, setTab] = useState('marble')
  const [all, setAll] = useState(false)
  const [surface, setSurface] = useState<'floor' | 'walls'>('floor')
  const [preview, setPreview] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const cur = props.current
  const apply = (id: string, name: string) => {
    if (!props.project || !cur) {
      useUI.getState().toast({ kind: 'info', title: 'Generate or open a house first' })
      return
    }
    commit(`${name} on ${cur.r.name} ${surface}`, (d) => {
      const r = d.floors.find((f) => f.id === cur.f.id)!.rooms.find((x) => x.id === cur.r.id)!
      if (surface === 'floor') r.floorMaterial = id
      else r.wallMaterial = id
    })
  }
  const changeMaterial = () => {
    if (!props.project || !cur) return useUI.getState().toast({ kind: 'info', title: 'Generate or open a house first' })
    useUI.getState().set({ screen: 'workspace', floorId: cur.f.id, selection: [{ kind: 'room', id: cur.r.id, floorId: cur.f.id }], surface: surface === 'floor' ? { kind: 'roomFloor', floorId: cur.f.id, roomId: cur.r.id } : null })
    setMode('materials')
  }
  // interior preview of the chosen room, refreshed after finishes change
  const sig = cur ? `${cur.r.id}|${cur.r.floorMaterial}|${cur.r.wallMaterial}|${cur.r.ceilingType}` : ''
  useEffect(() => {
    const v = props.view
    if (!v || !cur) return setPreview(null)
    let alive = true
    const b = bbox(cur.r.polygon)
    const y = (floorElevations(v.floors, v.settings.plinthHeight).get(cur.f.id) ?? 0) + 1.5
    const t = setTimeout(() => {
      // finishes are judged in daylight, whatever time the hero shows
      const src = props.project ? getProject() : v
      const day = { ...src, settings: { ...src.settings, lighting: { ...src.settings.lighting, preset: 'afternoon' as const, time: 14.5 } } }
      renderHouseImage(day, { width: 640, height: 300, floorId: cur.f.id, pose: { position: [b.x + Math.min(0.5, b.w * 0.12), y, b.y + Math.min(0.5, b.h * 0.12)], target: [b.x + b.w * 0.85, y - 0.35, b.y + b.h * 0.85], fov: 70 } }).then((u) => alive && setPreview(u))
    }, 700)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [sig, props.view?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // the curated swatches, or every library material in the category (plus the user's uploads)
  const cats = MAT_TABS.find((t) => t.key === tab)!.cats
  const extra = all ? [...LIBRARY, ...(props.project?.materials ?? [])].filter((m) => cats.includes(m.category) && !SWATCHES[tab].some((x) => x.id === m.id)).map((m) => ({ id: m.id, name: m.name })) : []
  const swatches = [...SWATCHES[tab], ...extra]
  const curId = cur ? (surface === 'floor' ? (cur.r.floorMaterial ?? spec(cur.r.type).floorFinish) : (cur.r.wallMaterial ?? spec(cur.r.type).wallFinish)) : undefined
  return (
    <section className="dash-card">
      <header>
        <h3>Materials &amp; Finishes</h3>
        <Seg value={surface} onChange={setSurface} options={[{ value: 'floor', label: 'Floor' }, { value: 'walls', label: 'Walls' }]} />
      </header>
      <div className="dock-tabs">
        {MAT_TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className={`fin-grid ${all ? 'all' : ''}`}>
        {swatches.map((s) => (
          <FinSwatch key={s.id} id={s.id} name={s.name} on={curId === s.id} onClick={() => apply(s.id, s.name)} />
        ))}
        <button className="fin-swatch upload" onClick={() => file.current?.click()} data-tip="Upload your own photo">
          <span className="img">
            <Upload />
          </span>
          <span className="n">Custom Upload</span>
        </button>
        <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => {
            const f = [...(e.target.files ?? [])]
            e.target.value = ''
            if (!f.length) return
            const [id] = await uploadMaterialFiles(f, { quiet: true })
            const def = getProject().materials.find((m) => m.id === id)
            if (!def) return
            if (props.project && cur) {
              apply(def.id, def.name)
              useUI.getState().toast({ kind: 'success', title: `${def.name} applied`, body: `${cur.r.name} ${surface}. Detected as ${def.analysis?.textureType ?? def.category}. Undo with Ctrl+Z.` })
            } else useUI.getState().toast({ kind: 'success', title: `${def.name} added to My materials`, body: 'Generate or open a house to apply it.' })
          }} />
      </div>
      <button className="link-btn fin-more" onClick={() => setAll((v) => !v)}>
        <LayoutGrid size={12} /> {all ? 'Show fewer' : `Show all ${MAT_TABS.find((t) => t.key === tab)!.label.toLowerCase()} materials`}
      </button>
      <div className="fin-preview" style={preview ? { backgroundImage: `url("${preview}")` } : undefined}>
        {!preview && props.view && <span className="spinner" />}
        <div className="fin-foot">
          <span className="applied">
            Applied to:{' '}
            <select className="field" value={cur?.r.id ?? ''} onChange={(e) => props.setRoomId(e.target.value)} aria-label="Room the finish goes on">
              {props.rooms.map(({ f, r }) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({f.name.toLowerCase()})
                </option>
              ))}
            </select>{' '}
            <b>{surface === 'floor' ? 'Floor' : 'Walls'}</b>
          </span>
          <button className="btn sm" onClick={changeMaterial}>
            Change Material
          </button>
        </div>
      </div>
    </section>
  )
}

function FinSwatch({ id, name, on, onClick }: { id: string; name: string; on: boolean; onClick: () => void }) {
  const m = resolveMaterial(id, [])
  const url = useMaterialThumb(m)
  return (
    <button className={`fin-swatch ${on ? 'on' : ''}`} onClick={onClick} data-tip={`${m?.name ?? name}: apply`} aria-label={`Apply ${name}`}>
      <span className="img" style={m ? thumbStyle(m, url) : undefined} />
      <span className="n">{name}</span>
    </button>
  )
}

const FURNITURE_STYLES: { key: string; label: string; luxury: number }[] = [
  { key: 'modern', label: 'Modern', luxury: 60 },
  { key: 'luxury', label: 'Luxury', luxury: 90 },
  { key: 'minimal', label: 'Minimal', luxury: 20 }
]
const CEILINGS: { v: NonNullable<Room['ceilingType']>; label: string }[] = [
  { v: 'flat', label: 'Flat Ceiling' },
  { v: 'false-ceiling', label: 'False Ceiling' },
  { v: 'cove', label: 'Cove Lighting' }
]

function CustomizePanel({ project, view, current, rooms, setRoomId }: { project: Project | null; view: Project | null; current?: RoomPick; rooms: RoomPick[]; setRoomId: (id: string) => void }) {
  const [style, setStyle] = useState('modern')
  const b = current ? bbox(current.r.polygon) : { w: 4, h: 4 }
  const height0 = current ? (current.r.ceilingHeight ?? current.f.height - current.f.slabThickness) : 3
  const [dims, setDims] = useState({ l: b.h, w: b.w, h: height0 })
  useEffect(() => setDims({ l: b.h, w: b.w, h: height0 }), [current?.r.id, b.w, b.h, height0]) // eslint-disable-line react-hooks/exhaustive-deps
  const shownProject = project ?? view
  if (!shownProject || !current) return null
  // the sample house is for looking at: edits ask for a house of the user's own
  const sampleOnly = () => {
    useUI.getState().toast({ kind: 'info', title: 'This is a sample house', body: 'Generate or open your own house to customise its rooms.' })
  }
  const u: UnitSystem = metric(shownProject.settings.units) ? 'm' : 'ft'
  const sp = spec(current.r.type)
  const up = (label: string, fn: (r: Room) => void) => {
    if (!project) return void sampleOnly()
    commit(label, (d) => fn(d.floors.find((f) => f.id === current.f.id)!.rooms.find((x) => x.id === current.r.id)!))
  }
  const changed = Math.abs(dims.l - b.h) > 0.01 || Math.abs(dims.w - b.w) > 0.01 || Math.abs(dims.h - height0) > 0.01
  const applyDims = () => {
    if (!project) return void sampleOnly()
    commit(`Resize ${current.r.name}`, (d) => {
      const f = d.floors.find((x) => x.id === current.f.id)!
      if (Math.abs(dims.w - b.w) > 0.01) setRoomSize(f as never, current.r.id, 'x', dims.w, d.settings)
      if (Math.abs(dims.l - b.h) > 0.01) setRoomSize(f as never, current.r.id, 'y', dims.l, d.settings)
      const r = f.rooms.find((x) => x.id === current.r.id)
      if (r && Math.abs(dims.h - height0) > 0.01) r.ceilingHeight = dims.h
    })
  }
  const ceilingThumb = current.r.ceilingType === 'cove' ? 'cove' : current.r.ceilingType === 'false-ceiling' ? 'false' : 'flat'
  return (
    <>
      <section className="dash-card">
        <header>
          <h3>Room Customization</h3>
        </header>
        <div className="room-pick">
          <BedDouble size={16} />
          <select className="field" aria-label="Room to customize" value={current.r.id} onChange={(e) => setRoomId(e.target.value)}>
            {rooms.map(({ f, r }) => (
              <option key={r.id} value={r.id}>
                {r.name} ({f.name.toLowerCase()})
              </option>
            ))}
          </select>
        </div>
        <div className="req-row">
          <span>Flooring</span>
          <MaterialPicker project={shownProject} value={current.r.floorMaterial} fallback={sp.floorFinish} onChange={(id) => up('Flooring', (r) => void (r.floorMaterial = id))} />
        </div>
        <div className="req-row">
          <span>Wall Finish</span>
          <MaterialPicker project={shownProject} value={current.r.wallMaterial} fallback={sp.wallFinish} onChange={(id) => up('Wall finish', (r) => void (r.wallMaterial = id))} />
        </div>
        <div className="req-row thumb-row">
          <span>Ceiling Design</span>
          <select className="field" value={current.r.ceilingType ?? 'flat'} onChange={(e) => up('Ceiling design', (r) => void (r.ceilingType = e.target.value as Room['ceilingType']))}>
            {CEILINGS.map((c) => (
              <option key={c.v} value={c.v}>
                {c.label}
              </option>
            ))}
          </select>
          <span className={`ceil-thumb ${ceilingThumb}`} aria-hidden />
        </div>
        <div className="req-row thumb-row">
          <span>Furniture Style</span>
          <select className="field" value={style} onChange={(e) => {
              if (!project) return void sampleOnly()
              setStyle(e.target.value)
              const lux = FURNITURE_STYLES.find((s) => s.key === e.target.value)!.luxury
              commit(`Furnish ${current.r.name} (${e.target.value})`, (d) => refurnishRoom(d.floors.find((f) => f.id === current.f.id)! as never, current.r.id, lux, qiblaVector(d.plot)))
            }}>
            {FURNITURE_STYLES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <span className={`furn-thumb ${style}`} aria-hidden />
        </div>
      </section>
      <section className="dash-card dims-card">
        <header>
          <h3>Adjust Dimensions</h3>
          <span className="sub">
            {current.r.name}, {formatAreaFor(dims.l * dims.w, shownProject.settings.units)}
          </span>
        </header>
        {(
          [
            ['l', 'Length', b.h * 0.6, b.h * 1.5],
            ['w', 'Width', b.w * 0.6, b.w * 1.5],
            ['h', 'Height', 2.4, 5]
          ] as const
        ).map(([k, label, min, max]) => (
          <div key={k} className="dim-slider">
            <span>
              {label} ({u === 'm' ? 'm' : 'ft'})
            </span>
            <Slider value={dims[k]} min={min} max={max} step={0.05} label={label} onChange={(v) => setDims((d) => ({ ...d, [k]: v }))} />
            <input
              className="field dim-num tabular"
              type="number"
              aria-label={`${label} in ${u === 'm' ? 'metres' : 'feet'}`}
              step={u === 'm' ? 0.1 : 0.5}
              value={Math.round(num(dims[k], u) * 10) / 10}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (!Number.isFinite(v) || v <= 0) return
                const m = u === 'm' ? v : v * FT
                setDims((d) => ({ ...d, [k]: Math.max(min * 0.5, Math.min(max * 1.5, m)) }))
              }}
            />
          </div>
        ))}
        <button className="btn primary" style={{ width: '100%', marginTop: 6 }} disabled={!changed} onClick={applyDims}>
          Apply changes
        </button>
      </section>
    </>
  )
}

function SketchTools() {
  const open = (tool: 'pen' | 'rect' | 'circle' | 'eraser' | 'text') => {
    const real = hasHouse(getProject())
    useSketch.getState().set({ tool, mode: real ? 'add' : 'replace' })
    useUI.getState().set({ screen: 'workspace' })
    setMode('sketch')
  }
  const plan = (tool: 'room' | 'measure') => {
    if (!hasHouse(getProject())) return useUI.getState().toast({ kind: 'info', title: 'Generate or open a house first', body: 'Or use Free Draw or Rectangle to sketch a new plan.' })
    useUI.getState().set({ screen: 'workspace' })
    setMode('plan')
    useUI.getState().set({ tool, ...(tool === 'room' ? { toolOption: 'bedroom' } : {}) })
  }
  const tools: { label: string; icon: JSX.Element; tip: string; run: () => void }[] = [
    { label: 'Free Draw', icon: <Pencil />, tip: 'Draw walls and rooms by hand', run: () => open('pen') },
    { label: 'Rectangle', icon: <Square />, tip: 'Drag out a room', run: () => open('rect') },
    { label: 'Circle', icon: <Circle />, tip: 'A small circle becomes a round pillar', run: () => open('circle') },
    { label: 'Text', icon: <Type />, tip: 'Label a room, e.g. "Kitchen" or "12x14"', run: () => open('text') },
    { label: 'Erase', icon: <Eraser />, tip: 'Rub out strokes and labels', run: () => open('eraser') },
    { label: 'Draw Room', icon: <LayoutGrid />, tip: 'Drag out a new room straight in the plan', run: () => plan('room') },
    { label: 'Measure', icon: <Ruler />, tip: 'Measure any distance in the plan', run: () => plan('measure') }
  ]
  return (
    <section className="dash-card">
      <header>
        <h3>Sketch Tools</h3>
      </header>
      <div className="sketch-tools">
        {tools.map((t) => (
          <button key={t.label} onClick={t.run} data-tip={t.tip}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/* ── bottom: key features ────────────────────────────────────────────────── */

function FeatureRow() {
  const real = useProject((s) => hasHouse(s.project))
  const go = (mode: Parameters<typeof setMode>[0]) => {
    if (!real) return useUI.getState().toast({ kind: 'info', title: 'Generate or open a house first' })
    useUI.getState().set({ screen: 'workspace' })
    setMode(mode)
  }
  const features: { title: string; text: string; icon: JSX.Element; run: () => void }[] = [
    { title: 'Design Your Home', text: 'Adjust length, width, height, rooms, floors, etc.', icon: <PencilRuler />, run: () => useUI.getState().set({ screen: 'wizard' }) },
    { title: 'Upload Materials', text: 'Use your own marble, stone or tiles and see 3D results.', icon: <ImageIcon />, run: () => go('materials') },
    { title: 'Generate Designs', text: 'Get several house designs based on your requirements.', icon: <Sparkles />, run: () => useUI.getState().set({ screen: 'wizard' }) },
    { title: '3D Visualization', text: 'See your design in 3D, interior and exterior.', icon: <Box />, run: () => go('3d') },
    { title: 'Sketch & Plan', text: 'Draw your own sketches and convert them to 3D.', icon: <PenLine />, run: () => go('sketch') },
    { title: 'Video Tour', text: 'Explore with drone views and walkthroughs.', icon: <Video />, run: () => go('drone') },
    { title: 'Edit & Customize', text: 'Resize, change materials, move walls, add features.', icon: <Layers3 />, run: () => go('plan') },
    { title: 'Save & Export', text: 'Save your design, download plans or share.', icon: <Share2 />, run: () => (real ? useUI.getState().openDialog('export') : go('plan')) }
  ]
  return (
    <footer className="dash-features">
      <h4>Key Features of This App</h4>
      <div className="dash-feature-row">
        {features.map((f) => (
          <button key={f.title} className="dash-feature" onClick={f.run}>
            <span className="ico">{f.icon}</span>
            <span>
              <b>{f.title}</b>
              <small>{f.text}</small>
            </span>
          </button>
        ))}
      </div>
    </footer>
  )
}

/* ── open / recent / templates ───────────────────────────────────────────── */

function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [autos, setAutos] = useState<AutosaveEntry[]>([])
  useEffect(() => {
    platform.recent.list().then(setRecent).catch(() => setRecent([]))
    platform.autosave.list().then((a) => setAutos(a.slice(0, 6))).catch(() => setAutos([]))
  }, [])
  const stay = async (fn: () => Promise<unknown>) => {
    await fn()
    useUI.getState().set({ screen: 'home' })
    onClose()
  }
  return (
    <Modal title="Projects" subtitle="Open a saved house, restore an autosave, or start from a template." onClose={onClose} size="wide">
      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <button className="btn primary" onClick={() => void stay(openProjectDialog)}>
          <FolderOpen size={14} /> Open a .homeforge file
        </button>
        <button className="btn" onClick={() => void stay(() => openDemoHouse('home'))}>
          <CirclePlay size={14} /> Demo house
        </button>
        <button className="btn" onClick={() => {
            useWizard.getState().reset()
            useUI.getState().set({ screen: 'wizard' })
          }}>
          <PencilRuler size={14} /> New house, step by step
        </button>
        <div className="grow" />
        {hasHouse(getProject()) && (
          <button className="btn" onClick={() => void saveProject()}>
            <Save size={14} /> Save current
          </button>
        )}
        <button className="btn ghost" onClick={() => useUI.getState().openDialog('shortcuts')}>
          <Keyboard size={14} /> Shortcuts
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <h4 className="section-title">Recent</h4>
          <div className="list">
            {recent.length ? (
              recent.map((r) => (
                <button key={r.path} className="list-item" onClick={() => void stay(() => openRecent(r.path))}>
                  <span className="swatch lg" style={r.thumbnail ? { backgroundImage: `url("${r.thumbnail}")` } : undefined} />
                  <span className="grow">
                    <span style={{ display: 'block' }}>{r.name}</span>
                    <span className="faint" style={{ fontSize: 11 }}>
                      {r.plot ? `${r.plot}, ` : ''}opened {new Date(r.openedAt).toLocaleDateString()}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <p className="faint">No recent projects yet.</p>
            )}
            {autos.map((a) => (
              <button key={a.id} className="list-item" onClick={() => void stay(() => restoreAutosave(a.id))}>
                <span className="grow">
                  <span style={{ display: 'block' }}>{a.name}</span>
                  <span className="faint" style={{ fontSize: 11 }}>
                    Autosave, {new Date(a.savedAt).toLocaleString()}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <h4 className="section-title">Templates</h4>
          <div className="list">
            {TEMPLATES.map((t) => (
              <button key={t.id} className="list-item" data-tip={t.blurb} onClick={() => {
                  const w = useWizard.getState()
                  w.reset()
                  w.choosePreset(t.preset)
                  w.setReq((r) => Object.assign(r, structuredClone(templateRequirements(t))))
                  onClose()
                  useUI.getState().toast({ kind: 'info', title: `${t.name} loaded into setup`, body: 'Choose Generate possible designs.' })
                }}>
                <span className="grow">{t.name}</span>
                <span className="meta">{presetById(t.preset)?.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="faint" style={{ fontSize: 11, marginTop: 12 }}>
        {PLOT_PRESETS.length} plot sizes available, from 3 marla to 4 kanal.
      </p>
    </Modal>
  )
}
