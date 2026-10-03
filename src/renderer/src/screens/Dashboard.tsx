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
  Type,
  Eraser,
  Ruler,
  Wand2,
  Image as ImageIcon,
  Layers3,
  Share2,
  Maximize2,
  Compass
} from 'lucide-react'
import { useUI } from '../state/ui'
import { useProject, commit, getProject } from '../state/store'
import { useWizard } from './wizardState'
import { BrandMark, Modal, Seg, Slider, Stepper } from '../ui/primitives'
import { PLOT_PRESETS } from '../core/units/plots'
import { formatAreaFor, formatLength, formatPlotSize } from '../core/units/units'
import { generateDesignsParallel } from '../ai/designService'
import { projectFromDesign, applyDesignToProject, openDemoHouse, dressDemo, setMode } from '../app/actions'
import { renderHouseImage } from '../render/houseImage'
import { renderPlanToCanvas } from '../render/planImage'
import { getEngine, hasEngine } from '../engine/Engine'
import type { DesignOption, FloorsOption, MaterialCategory, MaterialDef, Project, Room } from '../core/model/types'
import { sortedFloors, floorElevations } from '../core/model/house'
import { bbox, area } from '../core/geometry/polygon'
import { spec } from '../core/constraints/rooms'
import { LIBRARY } from '../core/materials/library'
import { useMaterialThumb, thumbStyle } from '../render/materialThumb'
import { MaterialPicker } from '../workspace/Inspector'
import { setRoomSize, refurnishRoom } from '../planner/operations'
import { uploadMaterialFiles } from '../modes/materialUpload'
import { parseRequirements } from '../ai/requirementParser'
import { platform } from '../storage/platform'
import type { AutosaveEntry, RecentProject } from '../../../shared/api'
import { openProjectDialog, openRecent, restoreAutosave, saveProject } from '../storage/session'
import { TEMPLATES, templateRequirements } from '../planner/templates'
import { newProject, plotFromPreset, DISCLAIMER } from '../core/model/defaults'
import { presetById } from '../core/units/plots'
import { northAngle } from '../engine/lighting/sun'
import { useSketch } from '../modes/sketchState'
import { droneState, type DronePath } from '../engine/controllers/DroneController'

/**
 * DESIGN DASHBOARD (home screen): one page to set up the plot and requirements, generate
 * designs, see the house live in 3D with its rendered plan and cut-away, pick finishes for any
 * room with a preview, tweak a room's size, and jump into every tool.
 */

let sampleCache: Project | null = null

const hasHouse = (p: Project) => p.floors.some((f) => f.rooms.length > 0)

export function Dashboard() {
  const project = useProject((s) => s.project)
  const real = hasHouse(project)
  const [sample, setSample] = useState<Project | null>(sampleCache)
  const shown = real ? project : sample
  const [designs, setDesigns] = useState<DesignOption[]>(() => project.designs)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [projectsOpen, setProjectsOpen] = useState(false)

  // a sample house to show before the user has one
  useEffect(() => {
    if (real || sampleCache) return
    let alive = true
    const t = TEMPLATES.find((x) => x.id === '1k-luxury')!
    const req = templateRequirements(t)
    const timer = setTimeout(() => {
      generateDesignsParallel(req, plotFromPreset(t.preset), newProject().settings, () => {}, { strategies: ['luxury-open'], baseSeed: 2020, iterations: 1500 }).then(({ designs: ds }) => {
        if (!alive || !ds[0]) return
        const p = projectFromDesign(ds[0], req, ds, t.name)
        dressDemo(p)
        p.settings.lighting = { ...p.settings.lighting, preset: 'sunset', time: 17.6 }
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

  // the room the right-hand panels work on
  const rooms = useMemo(() => (shown ? shown.floors.flatMap((f) => f.rooms.filter((r) => r.type !== 'void').map((r) => ({ f, r }))) : []), [shown])
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
          <Hero project={shown} />
          <div className="dash-tiles">
            <PlanTile project={shown} />
            <CutawayTile project={shown} />
          </div>
          <DesignStrip designs={designs} activeId={real ? project.activeDesignId : undefined} />
        </main>
        <aside className="dash-right">
          <FinishesPanel project={real ? project : null} view={shown} current={current} rooms={rooms} setRoomId={setRoomId} />
          <CustomizePanel project={real ? project : null} current={current} />
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
    { label: 'Materials', icon: <Palette />, run: () => go('materials') },
    { label: 'Save / Export', icon: <Save />, run: () => (real ? useUI.getState().openDialog('export') : go('plan')) }
  ]
  return (
    <header className="dash-nav titlebar">
      <div className="brand">
        <span className="brand-tile">
          <BrandMark size={22} />
        </span>
        <span className="brand-text">
          <b>HomeForge AI</b>
          <small>Design. Generate. Customize. Experience Your Home.</small>
        </span>
      </div>
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
      <button className="icon-btn" aria-label="Settings" data-tip="Settings" onClick={() => useUI.getState().openDialog('settings')}>
        <Settings />
      </button>
      <button className="icon-btn" aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'} data-tip={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })}>
        {theme === 'dark' ? <Sun /> : <Moon />}
      </button>
    </header>
  )
}

/* ── left: project setup ─────────────────────────────────────────────────── */

const SIZES = ['5-marla', '7-marla', '10-marla', '15-marla', '1-kanal', '2-kanal', '4-kanal']
const FLOORS: { v: FloorsOption; label: string }[] = [
  { v: 'single', label: '1 (ground only)' },
  { v: 'double', label: '2 (double storey)' },
  { v: 'triple', label: '3 (triple storey)' },
  { v: 'basement+ground', label: 'Basement + 1' },
  { v: 'basement+ground+first', label: 'Basement + 2' },
  { v: 'basement+ground+first+second', label: 'Basement + 3' }
]

function SetupPanel(props: { project: Project | null; onDesigns: (d: DesignOption[]) => void; onProjects: () => void }) {
  const w = useWizard()
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState<string | null>(null)
  const u = props.project?.settings.units ?? 'ft-in'
  const preset = w.plot.presetId
  const generate = async () => {
    setRunning('Starting…')
    let done = 0
    try {
      const { designs, errors } = await generateDesignsParallel(w.req, w.plot, props.project?.settings ?? newProject().settings, (g) => {
        if (g.design) done += 1
        setRunning(`Designing… ${done} of 5 ready`)
      }, {})
      if (!designs.length) {
        useUI.getState().showError({ what: 'No design could be generated.', why: errors[0]?.why ?? 'The requirements do not fit on this plot.', fix: errors[0]?.fix ?? 'Choose a larger plot or fewer rooms, then try again.', retry: () => void generate() })
        return
      }
      props.onDesigns(designs)
      // the first design becomes the house straight away; the strip offers the others
      const p = getProject()
      if (!hasHouse(p)) {
        const np = projectFromDesign(designs[0], structuredClone(w.req), designs)
        useProject.getState().load(np)
      } else {
        commit('Update requirements', (d) => {
          d.requirements = structuredClone(w.req) as typeof d.requirements
          d.designs = designs as typeof d.designs
        })
        applyDesignToProject(designs[0])
      }
      const g = sortedFloors(getProject().floors).find((f) => f.level === 0)
      useUI.getState().set({ floorId: g?.id ?? '' })
      useUI.getState().toast({ kind: 'success', title: `${designs.length} designs ready`, body: 'Design A is shown. Pick another from the strip below the 3D view.' })
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
    { label: 'Garage', on: req.outdoor.garage, set: (v) => w.setReq((r) => void (r.outdoor.garage = v)) },
    { label: 'Lawn / garden', on: req.outdoor.frontLawn || req.outdoor.backLawn, set: (v) => w.setReq((r) => {
        r.outdoor.frontLawn = v
        r.outdoor.backLawn = v
      }) },
    { label: 'Pool', on: req.outdoor.pool, set: (v) => w.setReq((r) => void (r.outdoor.pool = v)) },
    { label: 'Double height', on: req.special.doubleHeightLounge, set: (v) => w.setReq((r) => void (r.special.doubleHeightLounge = v)) }
  ]
  const rooms = props.project ? props.project.floors.flatMap((f) => f.rooms.filter((r) => !['void', 'corridor', 'foyer', 'stair', 'mumty', 'balcony', 'terrace'].includes(r.type) && !spec(r.type).outdoor)) : []
  return (
    <aside className="dash-left">
      <section className="dash-card">
        <header>
          <h3>Start</h3>
        </header>
        <textarea className="field" rows={3} placeholder="Describe the house you want, for example: 10 marla, 2 floors, 4 bedrooms, basement, lawn, 2 car garage" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && describe()} aria-label="Describe your house" />
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
          <h3>House size</h3>
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
          <button className={!preset ? 'on' : ''} onClick={() => useUI.getState().set({ screen: 'wizard' })}>
            Custom size
          </button>
        </div>
      </section>
      <section className="dash-card">
        <header>
          <h3>House requirements</h3>
        </header>
        <div className="req-row">
          <span>Floors</span>
          <select className="field" value={req.floors === 'custom' ? 'double' : req.floors} onChange={(e) => w.setReq((r) => void (r.floors = e.target.value as FloorsOption))}>
            {FLOORS.map((f) => (
              <option key={f.v} value={f.v}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="req-row">
          <span>Bedrooms</span>
          <Stepper value={req.rooms.bedrooms} min={1} max={12} onChange={(v) => w.setReq((r) => {
              r.rooms.bedrooms = v
              r.rooms.bathrooms = Math.max(r.rooms.bathrooms, v)
            })} />
        </div>
        <div className="req-row">
          <span>Bathrooms</span>
          <Stepper value={req.rooms.bathrooms} min={1} max={14} onChange={(v) => w.setReq((r) => void (r.rooms.bathrooms = v))} />
        </div>
        <div className="req-row">
          <span>Car parking</span>
          <Stepper value={req.outdoor.cars} min={0} max={4} onChange={(v) => w.setReq((r) => {
              r.outdoor.cars = v
              r.outdoor.garage = v > 0
            })} />
        </div>
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
      {rooms.length > 0 && (
        <section className="dash-card">
          <header>
            <h3>Room dimensions</h3>
            <span className="sub">{u === 'm' || u === 'cm' ? 'metres' : 'feet'}</span>
          </header>
          <div className="room-dims">
            {rooms.slice(0, 12).map((r) => {
              const b = bbox(r.polygon)
              return (
                <div key={r.id} className="count-row">
                  <span>{r.name}</span>
                  <span className="tabular">
                    {formatLength(b.w, u, { compact: true })} × {formatLength(b.h, u, { compact: true })}
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

/* ── centre: hero, tiles, designs ────────────────────────────────────────── */

type HeroView = 'exterior' | 'interior' | 'top' | 'orbit'

function Hero({ project }: { project: Project | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<HeroView>('orbit')
  const lighting = useProject((s) => s.project.settings.lighting.preset)
  const real = useProject((s) => hasHouse(s.project))
  useEffect(() => {
    const el = ref.current
    if (!el || !project) return
    const e = getEngine()
    e.mount(el)
    e.setController(null)
    e.update(project, heroOptions(project))
    if (view === 'orbit') {
      // wider than the standard orbit: the hero is a very wide frame
      const c = e.houseCenter()
      const s = Math.max(10, Math.min(60, Math.max(project.plot.width, project.plot.depth)))
      e.flyTo(new THREE.Vector3(c.x + s * 1.1, c.y + s * 0.62, c.z + s * 1.3), c, 0)
    } else e.setCameraPreset(view === 'exterior' ? 'facade' : view === 'interior' ? 'interior' : 'top', undefined, false)
    e.controls.autoRotate = view === 'orbit'
    e.controls.autoRotateSpeed = 0.35
    e.controls.update()
    let raf = 0
    const spin = () => {
      if (e.controls.autoRotate) {
        e.controls.update()
        e.invalidate()
      }
      raf = requestAnimationFrame(spin)
    }
    raf = requestAnimationFrame(spin)
    return () => {
      cancelAnimationFrame(raf)
      e.controls.autoRotate = false
      e.unmount(el)
    }
    // the camera is framed once per house and view; edits below only refresh the scene
  }, [project?.id, view]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (project && ref.current && hasEngine() && getEngine().container === ref.current) getEngine().update(project, heroOptions(project))
  }, [project])
  const setLight = (preset: 'noon' | 'sunset' | 'night') => {
    if (!real) return
    const time = preset === 'noon' ? 12.5 : preset === 'sunset' ? 17.8 : 20.5
    commit(`Lighting: ${preset}`, (d) => {
      d.settings.lighting.preset = preset
      d.settings.lighting.time = time
    })
  }
  const na = project ? (northAngle(project.plot) * 180) / Math.PI : 0
  return (
    <section className="dash-hero">
      <div ref={ref} className="dash-hero-canvas" />
      {!project && (
        <div className="dash-hero-wait">
          <span className="spinner" /> Preparing a house to show you…
        </div>
      )}
      <span className="hero-chip">3D view ({view === 'interior' ? 'interior' : view === 'top' ? 'top' : 'exterior'})</span>
      <div className="hero-panel">
        <div className="faint" style={{ fontSize: 11 }}>
          View mode
        </div>
        <Seg value={view} onChange={setView} options={[{ value: 'orbit', label: 'Orbit' }, { value: 'exterior', label: 'Exterior' }, { value: 'interior', label: 'Interior' }, { value: 'top', label: 'Top' }]} />
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <div className="seg">
            {(
              [
                ['noon', <Sun key="d" />, 'Day'],
                ['sunset', <Sunset key="s" />, 'Sunset'],
                ['night', <Moon key="n" />, 'Night']
              ] as const
            ).map(([k, icon, label]) => (
              <button key={k} className={lighting === k ? 'on' : ''} data-tip={real ? label : 'Generate a house first'} aria-label={label} onClick={() => setLight(k)}>
                {icon}
              </button>
            ))}
          </div>
          <div className="grow" />
          <span className="compass" data-tip="North" style={{ transform: `rotate(${na}deg)` }}>
            <Compass size={18} />
          </span>
          <button className="icon-btn" aria-label="Open full 3D" data-tip="Open full 3D" disabled={!real} onClick={() => {
              useUI.getState().set({ screen: 'workspace' })
              setMode('3d')
            }}>
            <Maximize2 />
          </button>
        </div>
      </div>
    </section>
  )
}

function heroOptions(p: Project) {
  const g = sortedFloors(p.floors).find((f) => f.level === 0) ?? p.floors[0]
  return { floorId: g.id, showAll: true, viewMode: 'realistic' as const, explodeGap: 0, doorsOpen: true, showFurniture: true, showStructure: true }
}

function PlanTile({ project }: { project: Project | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || !project) return
    const r = el.getBoundingClientRect()
    const fl = plansFor(project, r.width / Math.max(1, r.height))
    if (!fl.length) return
    let t = 0
    const w = Math.max(140, Math.min(r.width / fl.length, (r.height * project.plot.width) / Math.max(1, project.plot.depth) + 60))
    const canvases = fl.map((f) => {
      const c = renderPlanToCanvas(project, f, w, Math.max(140, r.height), {
        theme: 'rendered',
        site: true,
        dpr: window.devicePixelRatio || 1,
        pad: 0.05,
        onReady: () => {
          clearTimeout(t)
          t = window.setTimeout(() => setTick((n) => n + 1), 120)
        }
      })
      c.style.width = `${w}px`
      c.style.height = '100%'
      return c
    })
    el.replaceChildren(...canvases)
    return () => clearTimeout(t)
  }, [project, tick])
  const fl = project ? plansFor(project, 2.6) : []
  return (
    <section className="dash-tile" onClick={() => project && hasHouse(getProject()) && (useUI.getState().set({ screen: 'workspace' }), setMode('plan'))}>
      <div ref={ref} className="dash-tile-img light" />
      <span className="hero-chip">{fl.length > 1 ? `2D floor plans (${fl.map((f) => f.name.toLowerCase()).join(', ')})` : '2D floor plan (ground floor)'}</span>
    </section>
  )
}

/** The floors a plan tile shows: the ground floor, plus the next one up when a portrait plot leaves room beside it. */
function plansFor(p: Project, aspect: number) {
  const fs = sortedFloors(p.floors).filter((f) => f.level >= 0 && f.rooms.length > 0)
  const g = fs.find((f) => f.level === 0) ?? fs[0]
  if (!g) return []
  const second = fs.find((f) => f.level === 1)
  return second && p.plot.depth / Math.max(1, p.plot.width) * aspect > 2.2 ? [g, second] : [g]
}

function CutawayTile({ project }: { project: Project | null }) {
  const [img, setImg] = useState<string | null>(null)
  useEffect(() => {
    if (!project) return
    let alive = true
    const g = sortedFloors(project.floors).find((f) => f.level === 0)!
    const all = project.floors.flatMap((f) => (f.level === 0 ? f.rooms.flatMap((r) => r.polygon) : []))
    const b = bbox(all.length ? all : project.plot.polygon)
    const el = floorElevations(project.floors, project.settings.plinthHeight).get(g.id) ?? 0
    const c = { x: b.x + b.w / 2, z: b.y + b.h / 2 }
    const size = Math.max(b.w, b.h)
    const t = setTimeout(() => {
      renderHouseImage(project, { width: 720, height: 420, viewMode: 'dollhouse', floorId: g.id, pose: { position: [c.x + size * 0.55, el + size * 0.95, c.z + size * 0.85], target: [c.x, el, c.z], fov: 42 } }).then((u) => alive && setImg(u))
    }, 600)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [project])
  return (
    <section className="dash-tile" onClick={() => project && hasHouse(getProject()) && (useUI.getState().set({ screen: 'workspace', viewMode: 'dollhouse' }), setMode('3d'))}>
      <div className="dash-tile-img" style={img ? { backgroundImage: `url("${img}")` } : undefined}>
        {!img && <span className="spinner" />}
      </div>
      <span className="hero-chip">3D floor plan (ground floor)</span>
    </section>
  )
}

function DesignStrip({ designs, activeId }: { designs: DesignOption[]; activeId?: string }) {
  const [sort, setSort] = useState<'overall' | 'garden' | 'space' | 'privacy'>('overall')
  const list = [...designs].sort((a, b) => b.scores[sort] - a.scores[sort])
  const select = (d: DesignOption) => {
    const p = getProject()
    if (!hasHouse(p)) useProject.getState().load(projectFromDesign(d, structuredClone(useWizard.getState().req), designs))
    else applyDesignToProject(d)
    useUI.getState().toast({ kind: 'success', title: `${d.label}: ${d.name}`, body: 'Now shown in 3D and in the plan.' })
  }
  return (
    <section className="dash-designs">
      <header>
        <h3>Generated house designs</h3>
        <span className="faint" style={{ fontSize: 11 }}>
          based on your requirements
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
          <div className="dash-empty">Set the house size and requirements on the left, then choose Generate possible designs. Five complete designs appear here.</div>
        )}
        <VideoCard />
      </div>
    </section>
  )
}

function DesignCard({ d, on, onSelect }: { d: DesignOption; on: boolean; onSelect: () => void }) {
  const [img, setImg] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const p = { ...newProject(), ...d.house } as Project
    p.settings.lighting = { ...p.settings.lighting, preset: 'sunset', time: 17.4 }
    renderHouseImage(p, { width: 360, height: 220, view: 'street' }).then((u) => alive && setImg(u))
    return () => {
      alive = false
    }
  }, [d])
  const s = d.stats
  return (
    <article className={`dash-design ${on ? 'on' : ''}`}>
      <div className="img" style={img ? { backgroundImage: `url("${img}")` } : undefined}>
        {!img && <span className="spinner" />}
        <span className="letter">{d.label}</span>
      </div>
      <div className="body">
        <b>{d.name}</b>
        <span className="faint">
          {s.floors} floors, {s.bedrooms} bed, {s.bathrooms} bath
        </span>
        <span className="faint">{formatAreaFor(s.totalFloorArea, 'ft-in')}</span>
        <button className={`btn sm ${on ? '' : 'primary'}`} onClick={onSelect} disabled={on}>
          {on ? 'Selected' : 'Select'}
        </button>
      </div>
    </article>
  )
}

function VideoCard() {
  const real = useProject((s) => hasHouse(s.project))
  const go = (route: DronePath) => {
    if (!real) return useUI.getState().toast({ kind: 'info', title: 'Generate or open a house first' })
    droneState.path = route
    useUI.getState().set({ screen: 'workspace' })
    setMode('drone')
  }
  return (
    <article className="dash-video">
      <button className="play" onClick={() => go('full')} aria-label="Play the drone tour">
        <Play />
      </button>
      <span>View this design in motion</span>
      <div className="seg">
        <button onClick={() => go('exterior')}>Drone</button>
        <button onClick={() => go('interior')}>Interior</button>
        <button onClick={() => go('flyover')}>Flyover</button>
      </div>
    </article>
  )
}

/* ── right: finishes, customisation, sketch ──────────────────────────────── */

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
  const [surface, setSurface] = useState<'floor' | 'walls'>('floor')
  const [preview, setPreview] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const list = LIBRARY.filter((m) => MAT_TABS.find((t) => t.key === tab)!.cats.includes(m.category)).slice(0, 11)
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
  // interior preview of the chosen room, refreshed after finishes change
  const sig = cur ? `${cur.r.id}|${cur.r.floorMaterial}|${cur.r.wallMaterial}|${cur.r.ceilingType}` : ''
  useEffect(() => {
    const v = props.view
    if (!v || !cur) return setPreview(null)
    let alive = true
    const b = bbox(cur.r.polygon)
    const y = (floorElevations(v.floors, v.settings.plinthHeight).get(cur.f.id) ?? 0) + 1.5
    const t = setTimeout(() => {
      renderHouseImage(props.project ? getProject() : v, { width: 640, height: 300, floorId: cur.f.id, pose: { position: [b.x + Math.min(0.5, b.w * 0.12), y, b.y + Math.min(0.5, b.h * 0.12)], target: [b.x + b.w * 0.85, y - 0.35, b.y + b.h * 0.85], fov: 70 } }).then((u) => alive && setPreview(u))
    }, 700)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [sig, props.view?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="dash-card">
      <header>
        <h3>Materials and finishes</h3>
      </header>
      <div className="dock-tabs">
        {MAT_TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="fin-grid">
        {list.map((m) => (
          <FinSwatch key={m.id} m={m} on={cur ? (surface === 'floor' ? cur.r.floorMaterial : cur.r.wallMaterial) === m.id : false} onClick={() => apply(m.id, m.name)} />
        ))}
        <button className="fin-swatch upload" onClick={() => file.current?.click()} data-tip="Upload your own photo">
          <span className="img">
            <Upload />
          </span>
          <span className="n">Custom upload</span>
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
      <div className="fin-preview" style={preview ? { backgroundImage: `url("${preview}")` } : undefined}>
        {!preview && props.view && <span className="spinner" />}
        <div className="fin-foot">
          <span>
            Applied to:{' '}
            <select className="field" value={cur?.r.id ?? ''} onChange={(e) => props.setRoomId(e.target.value)} aria-label="Room">
              {props.rooms.map(({ f, r }) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({f.name.toLowerCase()})
                </option>
              ))}
            </select>
          </span>
          <Seg value={surface} onChange={setSurface} options={[{ value: 'floor', label: 'Floor' }, { value: 'walls', label: 'Walls' }]} />
        </div>
      </div>
    </section>
  )
}

function FinSwatch({ m, on, onClick }: { m: MaterialDef; on: boolean; onClick: () => void }) {
  const url = useMaterialThumb(m)
  return (
    <button className={`fin-swatch ${on ? 'on' : ''}`} onClick={onClick} data-tip={`Apply ${m.name}`}>
      <span className="img" style={thumbStyle(m, url)} />
      <span className="n">{m.name}</span>
    </button>
  )
}

const STYLES: { key: string; label: string; luxury: number }[] = [
  { key: 'modern', label: 'Modern', luxury: 60 },
  { key: 'luxury', label: 'Luxury', luxury: 90 },
  { key: 'minimal', label: 'Minimal', luxury: 20 }
]

function CustomizePanel({ project, current }: { project: Project | null; current?: RoomPick }) {
  const [style, setStyle] = useState('modern')
  const b = current ? bbox(current.r.polygon) : { w: 4, h: 4 }
  const height0 = current ? (current.r.ceilingHeight ?? current.f.height - current.f.slabThickness) : 3
  const [dims, setDims] = useState({ l: b.h, w: b.w, h: height0 })
  useEffect(() => setDims({ l: b.h, w: b.w, h: height0 }), [current?.r.id, b.w, b.h, height0]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!project || !current) return null
  const u = project.settings.units
  const sp = spec(current.r.type)
  const up = (label: string, fn: (r: Room) => void) => commit(label, (d) => fn(d.floors.find((f) => f.id === current.f.id)!.rooms.find((x) => x.id === current.r.id)!))
  const changed = Math.abs(dims.l - b.h) > 0.01 || Math.abs(dims.w - b.w) > 0.01 || Math.abs(dims.h - height0) > 0.01
  const applyDims = () => {
    commit(`Resize ${current.r.name}`, (d) => {
      const f = d.floors.find((x) => x.id === current.f.id)!
      if (Math.abs(dims.w - b.w) > 0.01) setRoomSize(f as never, current.r.id, 'x', dims.w, d.settings)
      if (Math.abs(dims.l - b.h) > 0.01) setRoomSize(f as never, current.r.id, 'y', dims.l, d.settings)
      const r = f.rooms.find((x) => x.id === current.r.id)
      if (r && Math.abs(dims.h - height0) > 0.01) r.ceilingHeight = dims.h
    })
  }
  return (
    <>
      <section className="dash-card">
        <header>
          <h3>Room customization</h3>
          <span className="sub">{current.r.name}</span>
        </header>
        <div className="req-row">
          <span>Flooring</span>
          <MaterialPicker project={project} value={current.r.floorMaterial} fallback={sp.floorFinish} onChange={(id) => up('Flooring', (r) => void (r.floorMaterial = id))} />
        </div>
        <div className="req-row">
          <span>Wall finish</span>
          <MaterialPicker project={project} value={current.r.wallMaterial} fallback={sp.wallFinish} onChange={(id) => up('Wall finish', (r) => void (r.wallMaterial = id))} />
        </div>
        <div className="req-row">
          <span>Ceiling</span>
          <select className="field" value={current.r.ceilingType ?? 'flat'} onChange={(e) => up('Ceiling design', (r) => void (r.ceilingType = e.target.value as Room['ceilingType']))}>
            <option value="flat">Flat ceiling</option>
            <option value="false-ceiling">False ceiling</option>
            <option value="cove">Cove lighting ceiling</option>
          </select>
        </div>
        <div className="req-row">
          <span>Furniture style</span>
          <select className="field" value={style} onChange={(e) => {
              setStyle(e.target.value)
              const lux = STYLES.find((s) => s.key === e.target.value)!.luxury
              commit(`Furnish ${current.r.name} (${e.target.value})`, (d) => refurnishRoom(d.floors.find((f) => f.id === current.f.id)! as never, current.r.id, lux))
            }}>
            {STYLES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </section>
      <section className="dash-card">
        <header>
          <h3>Adjust dimensions</h3>
          <span className="sub">{formatAreaFor(dims.l * dims.w, u)}</span>
        </header>
        {(
          [
            ['l', 'Length', b.h * 0.6, b.h * 1.5],
            ['w', 'Width', b.w * 0.6, b.w * 1.5],
            ['h', 'Height', 2.4, 5]
          ] as const
        ).map(([k, label, min, max]) => (
          <div key={k} className="dim-slider">
            <span>{label}</span>
            <Slider value={dims[k]} min={min} max={max} step={0.05} label={label} onChange={(v) => setDims((d) => ({ ...d, [k]: v }))} />
            <span className="tabular">{formatLength(dims[k], u, { compact: true })}</span>
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
  const open = (tool: 'pen' | 'eraser' | 'text' | 'pan', mode: 'add' | 'replace' = 'add') => {
    const real = hasHouse(getProject())
    useSketch.getState().set({ tool, mode: real ? mode : 'replace' })
    useUI.getState().set({ screen: 'workspace' })
    setMode('sketch')
  }
  const tools: { label: string; icon: JSX.Element; run: () => void }[] = [
    { label: 'Free draw', icon: <Pencil />, run: () => open('pen') },
    { label: 'Rectangle', icon: <Square />, run: () => {
        useUI.getState().set({ screen: 'workspace', tool: 'room', toolOption: 'bedroom' })
        setMode('plan')
      } },
    { label: 'Measure', icon: <Ruler />, run: () => {
        useUI.getState().set({ screen: 'workspace', tool: 'measure' })
        setMode('plan')
      } },
    { label: 'Text', icon: <Type />, run: () => open('text') },
    { label: 'Erase', icon: <Eraser />, run: () => open('eraser') }
  ]
  return (
    <section className="dash-card">
      <header>
        <h3>Sketch tools</h3>
      </header>
      <div className="sketch-tools">
        {tools.map((t) => (
          <button key={t.label} onClick={t.run}>
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
    { title: 'Design your home', text: 'Plot, floors, rooms and preferences, step by step.', icon: <PencilRuler />, run: () => useUI.getState().set({ screen: 'wizard' }) },
    { title: 'Upload materials', text: 'Your own marble, stone or tile photos in 3D.', icon: <ImageIcon />, run: () => go('materials') },
    { title: 'Generate designs', text: 'Five complete layouts from your requirements.', icon: <Sparkles />, run: () => useUI.getState().set({ screen: 'wizard' }) },
    { title: '3D visualization', text: 'Day, sunset and night, inside and out.', icon: <Box />, run: () => go('3d') },
    { title: 'Sketch and plan', text: 'Draw by hand; it becomes a clean plan.', icon: <PenLine />, run: () => go('sketch') },
    { title: 'Video tour', text: 'Drone flights and walkthroughs, exportable.', icon: <Video />, run: () => go('drone') },
    { title: 'Edit and customize', text: 'Resize rooms, move walls, change anything.', icon: <Layers3 />, run: () => go('plan') },
    { title: 'Save and export', text: 'Drawings, images, 3D model, presentation.', icon: <Share2 />, run: () => (real ? useUI.getState().openDialog('export') : go('plan')) }
  ]
  return (
    <footer className="dash-features">
      <h4>Key features</h4>
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
        {area(getProject().plot.polygon) > 0 ? '' : ''}
        {PLOT_PRESETS.length} plot sizes available, from 3 marla to 4 kanal.
      </p>
    </Modal>
  )
}
