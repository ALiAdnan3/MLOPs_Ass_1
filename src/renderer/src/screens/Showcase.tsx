import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  ArrowLeft,
  BedDouble,
  BedSingle,
  ChefHat,
  Sofa,
  UtensilsCrossed,
  Warehouse,
  Trees,
  Fence,
  Car,
  Waves,
  Moon as MoonIcon,
  BookOpen,
  Dumbbell,
  Clapperboard,
  Footprints,
  SunMedium,
  UserRound,
  Shirt,
  ArrowUpDown,
  MoveVertical,
  Home as HomeIcon,
  Ruler,
  FileDown,
  Footprints as Walk,
  Sparkles,
  Aperture,
  Download,
  Box,
  ChevronLeft,
  ChevronRight,
  X,
  Image as ImageIcon,
  Rotate3d,
  Sun,
  CloudMoon,
  CirclePlay
} from 'lucide-react'
import { jsPDF } from 'jspdf'
import { useUI } from '../state/ui'
import { useProject, commit } from '../state/store'
import { useAssets } from '../state/assets'
import type { Project } from '../core/model/types'
import { Seg } from '../ui/primitives'
import { renderHouseImage } from '../render/houseImage'
import { AREA_GROUPS, areaViews, keyFeatures, plotSizeLabel, type AreaGroup, type AreaView, type KeyFeature, type Pose } from '../render/areaViews'
import { STYLE_TITLE, DISCLAIMER } from '../core/model/defaults'
import { presetById } from '../core/units/plots'
import { formatAreaFor } from '../core/units/units'
import { getEngine } from '../engine/Engine'
import { sortedFloors } from '../core/model/house'
import { sunriseSunset } from '../engine/lighting/sun'
import { platform, isDesktop } from '../storage/platform'
import { areaPrompt } from '../../../shared/aiImage'
import { uid } from '../core/model/ids'
import { openDemoHouse, setMode } from '../app/actions'
import { bbox } from '../core/geometry/polygon'
import { spec } from '../core/constraints/rooms'

/**
 * HOME SHOWCASE (amendment A9): the house as a property brochure. A hero picture, the key features
 * worked out from the design, and a picture of every area (kitchen, TV lounge, each bedroom and
 * bathroom, the car porch, terraces, the garden, the outside). Any area opens large, can be looked
 * around in 3D, path-traced (Photoreal) or turned into an AI photo, and the whole showcase saves as
 * a PDF brochure.
 */

type Light = 'day' | 'evening'
type Styling = 'staged' | 'exact'
const hasHouse = (p: Project) => p.floors.some((f) => f.rooms.length > 0)

/** The project lit for a picture: a clear afternoon, or blue hour just after sunset. */
function lit(p: Project, light: Light, interior: boolean): Project {
  const L = p.settings.lighting
  const time = light === 'evening' ? sunriseSunset(L.latitude, L.dayOfYear).sunset + 0.12 : interior ? 13.5 : 15.8
  return { ...p, settings: { ...p.settings, lighting: { ...L, preset: light === 'evening' ? 'custom' : 'afternoon', time, interiorLights: true, exteriorLights: true } } }
}

/** The brochure's opening picture: three-quarter front, a little raised, the whole house in frame. */
function heroPose(p: Project, aspect: number): Pose {
  const pts = p.floors.filter((f) => f.level >= 0).flatMap((f) => f.rooms.filter((r) => r.type !== 'void' && !spec(r.type).outdoor).flatMap((r) => r.polygon))
  const b = bbox(pts.length ? pts : p.plot.polygon)
  const H = p.floors.filter((f) => f.level >= 0 && f.kind !== 'roof').reduce((a, f) => a + f.height, 0) + p.settings.plinthHeight + 1.2
  const fov = 38
  const vf = THREE.MathUtils.degToRad(fov) / 2
  const hf = Math.atan(Math.tan(vf) * aspect)
  const target = new THREE.Vector3(b.x + b.w / 2, H * 0.45, b.y + b.h / 2)
  const az = 0.42
  const el = 0.2
  const dir = new THREE.Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
  const dist = (0.5 * Math.hypot(b.w, b.h, H)) / Math.sin(Math.min(vf, hf)) * 0.84
  const pos = target.clone().addScaledVector(dir, dist)
  return { position: pos.toArray() as [number, number, number], target: target.toArray() as [number, number, number], fov }
}

/**
 * Pictures are kept per version of what they show. Edits share unchanged parts (immer), so adding
 * an AI photo or renaming the project does not re-render the whole gallery; moving a wall does.
 */
const ids = new WeakMap<object, number>()
let nextId = 1
const idOf = (o: object) => ids.get(o) ?? (ids.set(o, nextId++), nextId - 1)
const looks = (p: Project) => [p.floors, p.site, p.exterior, p.materials, p.settings, p.plot].map(idOf).join('.')
const cache = new Map<string, Map<string, string>>()
const cached = (p: Project) => {
  const k = looks(p)
  let m = cache.get(k)
  if (!m) {
    cache.set(k, (m = new Map()))
    // keep the last few versions only
    while (cache.size > 4) cache.delete(cache.keys().next().value!)
  }
  return m
}

function useRender(p: Project | null, key: string, make: (() => Promise<string>) | null) {
  const version = p ? looks(p) : ''
  const [url, setUrl] = useState<string | null>(() => (p ? (cached(p).get(key) ?? null) : null))
  useEffect(() => {
    if (!p || !make) return
    const hit = cached(p).get(key)
    if (hit) return setUrl(hit)
    setUrl(null)
    let alive = true
    make().then((u) => {
      cached(p).set(key, u)
      if (alive) setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [version, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return url
}

/**
 * Make an AI photo of one area from its render and keep it with the project (concept board and
 * presentation included). Returns an error message, or null when it worked.
 */
async function makeAiPhoto(project: Project, v: AreaView, light: Light, styling: Styling): Promise<string | null> {
  // lossless, so the model starts from every detail of the render
  const url = await renderHouseImage(lit(project, light, v.kind === 'interior'), { width: 1536, height: 1024, floorId: v.floorId, pose: v.pose, doorsOpen: v.kind !== 'interior', type: 'image/png' })
  const image = await (await fetch(url)).arrayBuffer()
  URL.revokeObjectURL(url)
  const prompt = areaPrompt({ area: v.promptArea, kind: v.kind, style: STYLE_TITLE[project.exterior.style] ?? 'modern', city: project.plot.location?.city, finishes: v.finishes, light, styling })
  const res = await platform.aiImage({ image, mediaType: 'image/png', prompt, size: '1536x1024' })
  if (!res.ok) return res.error
  const title = `${v.title} (AI photo)`
  const a = await useAssets.getState().put(new Blob([res.image], { type: res.mediaType }), title)
  commit(`AI photo: ${v.title}`, (d) => void d.conceptImages.push({ id: uid('ci'), title, assetId: a.id, createdAt: Date.now(), prompt: `${res.model}: ${prompt}`, areaKey: v.key, source: 'ai-photo' }))
  return null
}

/** Can AI photos be made here? Explains what is missing when not. */
async function aiReady(): Promise<boolean> {
  if (!isDesktop) {
    useUI.getState().toast({ kind: 'info', title: 'AI photos need the desktop app', body: 'They use your own OpenAI key, kept on your computer.' })
    return false
  }
  const s = await platform.settings.get()
  if (!s.hasOpenAiKey) {
    useUI.getState().toast({ kind: 'info', title: 'Add an OpenAI key first', body: 'Settings, AI photos. Each photo is charged to your OpenAI account.', action: { label: 'Open Settings', run: () => useUI.getState().openDialog('settings') } })
    return false
  }
  return true
}

/** The latest AI photo kept for an area, if any. */
function useAiPhoto(p: Project, areaKey: string): string | undefined {
  const assets = useAssets((s) => s.assets)
  const ci = [...p.conceptImages].reverse().find((c) => c.areaKey === areaKey && c.source === 'ai-photo')
  return ci ? assets[ci.assetId]?.url : undefined
}

export function Showcase() {
  const project = useProject((s) => s.project)
  const real = hasHouse(project)
  const set = useUI((s) => s.set)
  const [extLight, setExtLight] = useState<Light>('evening')
  const [intLight, setIntLight] = useState<Light>('day')
  const [filter, setFilter] = useState<AreaGroup | 'all'>('all')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [showAi, setShowAi] = useState(true)
  const [styling, setStyling] = useState<Styling>('staged')
  const [busyPdf, setBusyPdf] = useState(false)
  const [batch, setBatch] = useState<{ phase: 'confirm' | 'running'; done: number; total: number; failed: number; lastError?: string } | null>(null)
  const stopBatch = useRef(false)
  const views = useMemo(() => (real ? areaViews(project) : []), [project, real])
  const features = useMemo(() => (real ? keyFeatures(project) : []), [project, real])
  const groups = AREA_GROUPS.filter((g) => views.some((v) => v.group === g.key))
  const shown = filter === 'all' ? views : views.filter((v) => v.group === filter)
  const lightOf = (v: AreaView) => (v.kind === 'interior' ? intLight : extLight)

  if (!real)
    return (
      <div className="sc-screen">
        <ShowcaseBar onPdf={null} />
        <div className="sc-empty">
          <HomeIcon size={34} />
          <h2>No house to show yet</h2>
          <p>Generate a design or open the demo house, and every room of it appears here as a picture.</p>
          <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => set({ screen: 'home' })}>
              Generate a design
            </button>
            <button className="btn" onClick={() => void openDemoHouse('showcase')}>
              <CirclePlay size={14} /> Demo house
            </button>
          </div>
        </div>
      </div>
    )

  const style = STYLE_TITLE[project.exterior.style] ?? 'Modern Home'
  const preset = presetById(project.plot.presetId)?.label
  const beds = project.floors.flatMap((f) => f.rooms).filter((r) => ['master_bedroom', 'bedroom', 'guest_bedroom', 'kids_room'].includes(r.type)).length
  const floors = sortedFloors(project.floors).filter((f) => f.kind !== 'roof' && f.rooms.length).length
  const total = project.floors.flatMap((f) => f.rooms).filter((r) => r.type !== 'void' && !spec(r.type).outdoor).reduce((a, r) => a + Math.abs(bbox(r.polygon).w * bbox(r.polygon).h), 0)

  const pdf = async () => {
    setBusyPdf(true)
    try {
      await exportBrochure(project, views, features, { extLight, intLight, showAi })
    } finally {
      setBusyPdf(false)
    }
  }
  // AI photos for every area on show that has none yet, a few at a time
  const batchTargets = shown.filter((v) => !project.conceptImages.some((c) => c.areaKey === v.key && c.source === 'ai-photo'))
  const runBatch = async () => {
    const list = batchTargets
    stopBatch.current = false
    let done = 0
    let failed = 0
    let lastError: string | undefined
    setBatch({ phase: 'running', done, total: list.length, failed })
    let next = 0
    const worker = async () => {
      while (!stopBatch.current && next < list.length) {
        const v = list[next++]
        const err = await makeAiPhoto(useProject.getState().project, v, lightOf(v), styling).catch((e: Error) => e.message)
        if (err) {
          failed++
          lastError = err
          // a missing key or an exhausted account fails every photo: stop at once
          if (/key|credit|billing|verification|rate-limit/i.test(err)) stopBatch.current = true
        } else done++
        setBatch({ phase: 'running', done, total: list.length, failed, lastError })
      }
    }
    await Promise.all([worker(), worker(), worker()])
    setBatch(null)
    if (failed) useUI.getState().showError({ what: `${failed} AI photo${failed === 1 ? '' : 's'} could not be made.`, why: lastError ?? 'The image service did not answer.', fix: 'Check the key and billing in Settings, AI photos, then try again; finished photos are kept.' })
    else if (done) useUI.getState().toast({ kind: 'success', title: `${done} AI photos ready`, body: 'Kept with the project; the brochure uses them.' })
  }
  const openIdx = openKey ? shown.findIndex((v) => v.key === openKey) : -1
  return (
    <div className="sc-screen">
      <ShowcaseBar onPdf={busyPdf ? undefined : () => void pdf()} busy={busyPdf} />
      <div className="sc-scroll">
        <article className="sc-brochure">
          <header className="sc-head">
            <span className="sc-logo">
              <HomeIcon />
            </span>
            <div className="grow">
              <h1>{style.replace(/Villa$/, 'Home')}</h1>
              <p>
                {styleTagline(project.exterior.style)} | {beds} BHK | {floors} {floors === 1 ? 'Floor' : 'Floors'} | {formatAreaFor(total, project.settings.units)} covered
              </p>
            </div>
            <div className="sc-plot">
              <Ruler size={18} />
              <span>
                <b>Plot Size</b>
                <small>{plotSizeLabel(project, preset)}</small>
              </span>
            </div>
          </header>
          <Hero project={project} light={extLight} onOpen={() => setOpenKey('ext-front')} />
          <section className="sc-features">
            <h2>Key Features</h2>
            <div className="sc-feature-grid">
              {features.map((f) => (
                <div key={f.title} className="sc-feature">
                  <span className="ico">{featureIcon(f)}</span>
                  <span>
                    <b>{f.title}</b>
                    {f.detail && <small>({f.detail})</small>}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="sc-areas">
            <div className="sc-areas-head">
              <h2>Explore Every Area</h2>
              <div className="grow" />
              <label className="sc-toggle" data-tip="Light for the outside and the gardens">
                <Sun size={13} /> Outside
                <Seg value={extLight} onChange={setExtLight} options={[{ value: 'day', label: 'Day' }, { value: 'evening', label: 'Evening' }]} />
              </label>
              <label className="sc-toggle" data-tip="Light for the rooms">
                <CloudMoon size={13} /> Rooms
                <Seg value={intLight} onChange={setIntLight} options={[{ value: 'day', label: 'Day' }, { value: 'evening', label: 'Evening' }]} />
              </label>
              <label className="sc-toggle" data-tip="Staged: dressed like a property brochure (rugs, art, plants, lighting) on the house as designed. As designed: realism only, nothing added.">
                <Sparkles size={13} /> AI style
                <Seg value={styling} onChange={setStyling} options={[{ value: 'staged', label: 'Brochure staging' }, { value: 'exact', label: 'As designed' }]} />
              </label>
              <button className="btn sm primary" disabled={!!batch || !batchTargets.length} onClick={async () => (await aiReady()) && setBatch({ phase: 'confirm', done: 0, total: batchTargets.length, failed: 0 })} data-tip="Turn every picture shown below into an AI photo">
                <Sparkles size={13} /> {batchTargets.length ? `AI photos for ${filter === 'all' ? 'all areas' : 'these areas'}` : 'All have AI photos'}
              </button>
              <label className="side-check" data-tip="Show AI photos where you have made them">
                <input type="checkbox" checked={showAi} onChange={(e) => setShowAi(e.target.checked)} />
                AI photos
              </label>
            </div>
            {batch?.phase === 'confirm' && (
              <div className="sc-batch" role="alert">
                <Sparkles size={15} />
                <span className="grow">
                  Make <b>{batch.total} AI photos</b> with your OpenAI account? Each one is charged by OpenAI and takes about a minute; three are made at a time.
                </span>
                <button className="btn sm primary" onClick={() => void runBatch()}>
                  Make {batch.total} photos
                </button>
                <button className="btn sm ghost" onClick={() => setBatch(null)}>
                  Cancel
                </button>
              </div>
            )}
            {batch?.phase === 'running' && (
              <div className="sc-batch" role="status">
                <span className="spinner" />
                <span className="grow">
                  AI photos: {batch.done} of {batch.total} ready{batch.failed ? `, ${batch.failed} failed` : ''}…
                </span>
                <div className="sc-progress">
                  <i style={{ width: `${((batch.done + batch.failed) / Math.max(1, batch.total)) * 100}%` }} />
                </div>
                <button className="btn sm ghost" onClick={() => (stopBatch.current = true)}>
                  Stop after the current ones
                </button>
              </div>
            )}
            <div className="sc-chips" role="tablist" aria-label="Areas">
              <button role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
                All areas <span>{views.length}</span>
              </button>
              {groups.map((g) => (
                <button key={g.key} role="tab" aria-selected={filter === g.key} className={filter === g.key ? 'on' : ''} onClick={() => setFilter(g.key)}>
                  {g.label} <span>{views.filter((v) => v.group === g.key).length}</span>
                </button>
              ))}
            </div>
            <div className="sc-gallery">
              {shown.map((v) => (
                <AreaCard key={v.key} project={project} view={v} light={lightOf(v)} showAi={showAi} onOpen={() => setOpenKey(v.key)} />
              ))}
            </div>
          </section>
          <p className="sc-disclaimer">{DISCLAIMER}</p>
        </article>
      </div>
      {openIdx >= 0 && (
        <Viewer
          project={project}
          views={shown}
          index={openIdx}
          lightOf={lightOf}
          styling={styling}
          onIndex={(i) => setOpenKey(shown[(i + shown.length) % shown.length].key)}
          onClose={() => setOpenKey(null)}
        />
      )}
      {openKey === 'ext-front' && openIdx < 0 && (
        <Viewer project={project} views={views} index={views.findIndex((v) => v.key === 'ext-front')} lightOf={lightOf} styling={styling} onIndex={(i) => setOpenKey(views[(i + views.length) % views.length].key)} onClose={() => setOpenKey(null)} />
      )}
    </div>
  )
}

function styleTagline(style: string) {
  switch (style) {
    case 'luxury':
      return 'Elegant Design | Spacious Living | Premium Lifestyle'
    case 'luxury_classic':
      return 'Marble Elegance | Classical Detail | Premium Lifestyle'
    case 'european':
      return 'Timeless Design | Grand Proportions'
    case 'minimalist':
      return 'Clean Lines | Light-filled Spaces'
    case 'traditional':
      return 'Warm Materials | Family Living'
    default:
      return 'Thoughtful Design | Comfortable Living'
  }
}

function featureIcon(f: KeyFeature) {
  const m: Record<KeyFeature['icon'], JSX.Element> = {
    bed: <BedDouble />,
    guest: <BedSingle />,
    kitchen: <ChefHat />,
    sofa: <Sofa />,
    dining: <UtensilsCrossed />,
    basement: <Warehouse />,
    patio: <Fence />,
    balcony: <Fence />,
    car: <Car />,
    garden: <Trees />,
    pool: <Waves />,
    prayer: <MoonIcon />,
    study: <BookOpen />,
    gym: <Dumbbell />,
    theater: <Clapperboard />,
    stairs: <Footprints />,
    solar: <SunMedium />,
    servant: <UserRound />,
    laundry: <Shirt />,
    lift: <ArrowUpDown />,
    height: <MoveVertical />
  }
  return m[f.icon]
}

function ShowcaseBar({ onPdf, busy }: { onPdf: (() => void) | null | undefined; busy?: boolean }) {
  const set = useUI((s) => s.set)
  const real = useProject((s) => hasHouse(s.project))
  return (
    <header className="titlebar sc-bar">
      <button className="btn ghost sm" onClick={() => set({ screen: 'home' })}>
        <ArrowLeft size={15} /> Home
      </button>
      <div className="sc-bar-title">
        <ImageIcon size={16} /> Home Showcase
      </div>
      <div className="drag" />
      {real && (
        <>
          <button className="btn sm" onClick={() => {
              set({ screen: 'workspace' })
              setMode('walk')
            }} data-tip="Walk through the house at eye level">
            <Walk size={14} /> Walk through
          </button>
          <button className="btn sm" onClick={() => {
              set({ screen: 'workspace' })
              setMode('drone')
            }} data-tip="Drone and interior video tours">
            <CirclePlay size={14} /> Video tour
          </button>
          <button className="btn sm primary" disabled={!onPdf} onClick={() => onPdf?.()} data-tip="Save this showcase as a PDF brochure">
            <FileDown size={14} /> {busy ? 'Preparing brochure…' : 'Save brochure (PDF)'}
          </button>
        </>
      )}
    </header>
  )
}

function Hero({ project, light, onOpen }: { project: Project; light: Light; onOpen: () => void }) {
  const ai = useAiPhoto(project, 'ext-front')
  const url = useRender(project, `hero|${light}`, () => renderHouseImage(lit(project, light, false), { width: 1680, height: 760, pose: heroPose(project, 1680 / 760) }))
  const src = ai ?? url
  return (
    <button className="sc-hero" onClick={onOpen} aria-label="Open the front of the house">
      {src ? <img src={src} alt="The house" /> : <span className="spinner" />}
      {ai && <span className="sc-badge">AI photo</span>}
    </button>
  )
}

function AreaCard({ project, view, light, showAi, onOpen }: { project: Project; view: AreaView; light: Light; showAi: boolean; onOpen: () => void }) {
  const ai = useAiPhoto(project, view.key)
  const url = useRender(project, `card|${view.key}|${light}`, () => renderHouseImage(lit(project, light, view.kind === 'interior'), { width: 720, height: 450, floorId: view.floorId, pose: view.pose, doorsOpen: view.kind !== 'interior' }))
  const src = showAi && ai ? ai : url
  return (
    <button className="sc-card" onClick={onOpen} aria-label={`Open ${view.title}`}>
      <span className="img">
        {src ? <img src={src} alt={view.title} loading="lazy" /> : <span className="spinner" />}
        {showAi && ai && <span className="sc-badge">AI photo</span>}
      </span>
      <span className="cap">
        <b>{view.title}</b>
        <small>{view.subtitle}</small>
      </span>
    </button>
  )
}

/* ── large viewer ───────────────────────────────────────────────────────── */

type Tab = 'render' | 'live' | 'ai'

function Viewer({ project, views, index, lightOf, styling, onIndex, onClose }: { project: Project; views: AreaView[]; index: number; lightOf: (v: AreaView) => Light; styling: Styling; onIndex: (i: number) => void; onClose: () => void }) {
  const v = views[index]
  const light = lightOf(v)
  const ai = useAiPhoto(project, v.key)
  const [tab, setTab] = useState<Tab>(ai ? 'ai' : 'render')
  const [aiState, setAiState] = useState<{ working: boolean; started: number; error?: string }>({ working: false, started: 0 })
  const [elapsed, setElapsed] = useState(0)
  const big = useRender(project, `big|${v.key}|${light}`, () => renderHouseImage(lit(project, light, v.kind === 'interior'), { width: 1680, height: 1050, floorId: v.floorId, pose: v.pose, doorsOpen: v.kind !== 'interior' }))
  const live = useRef<HTMLDivElement>(null)

  useEffect(() => setTab(ai ? 'ai' : 'render'), [v.key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useUI.getState().dialog) onClose()
      if (tab !== 'live' && e.key === 'ArrowRight') onIndex(index + 1)
      if (tab !== 'live' && e.key === 'ArrowLeft') onIndex(index - 1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [index, tab, onClose, onIndex])
  useEffect(() => {
    if (!aiState.working) return
    const t = setInterval(() => setElapsed(Math.round((Date.now() - aiState.started) / 1000)), 500)
    return () => clearInterval(t)
  }, [aiState])

  // look around: the live 3D view, starting from this area's camera
  useEffect(() => {
    const el = live.current
    if (tab !== 'live' || !el) return
    const e = getEngine()
    e.mount(el)
    e.setController(null)
    e.update(lit(project, light, v.kind === 'interior'), { floorId: v.floorId ?? sortedFloors(project.floors).find((f) => f.level === 0)!.id, showAll: true, viewMode: 'realistic', explodeGap: 0, doorsOpen: true, showFurniture: true, showStructure: true })
    e.camera.fov = v.pose.fov
    e.camera.updateProjectionMatrix()
    e.flyTo(new THREE.Vector3(...v.pose.position), new THREE.Vector3(...v.pose.target), 0)
    e.controls.maxPolarAngle = Math.PI
    return () => {
      e.camera.fov = 50
      e.camera.updateProjectionMatrix()
      e.controls.maxPolarAngle = Math.PI * 0.495
      e.unmount(el)
    }
  }, [tab, v.key, light]) // eslint-disable-line react-hooks/exhaustive-deps

  const photoreal = () => {
    setTab('live')
    // the photoreal dialog traces the live view, so give it a frame to mount first
    setTimeout(() => useUI.getState().openDialog('photoreal'), 250)
  }
  const makeAi = async () => {
    if (!(await aiReady())) return
    setAiState({ working: true, started: Date.now() })
    setElapsed(0)
    try {
      const err = await makeAiPhoto(project, v, light, styling)
      if (err) return setAiState({ working: false, started: 0, error: err })
      setAiState({ working: false, started: 0 })
      setTab('ai')
      useUI.getState().toast({ kind: 'success', title: 'AI photo ready', body: 'Kept with the project, on the concept board and in the presentation.' })
    } catch (e) {
      setAiState({ working: false, started: 0, error: (e as Error).message })
    }
  }
  const save = async () => {
    const url = tab === 'ai' && ai ? ai : big
    if (!url) return
    const data = await (await fetch(url)).arrayBuffer()
    const name = `${project.name.replace(/[^\w ]+/g, '').trim() || 'house'} - ${v.title.replace(/[^\w ]+/g, '')}${tab === 'ai' ? ' (AI photo)' : ''}.jpg`
    const saved = await platform.saveDialog(name, [{ name: 'JPEG image', extensions: ['jpg'] }], data)
    if (saved) useUI.getState().toast({ kind: 'success', title: 'Image saved', body: saved.split(/[\\/]/).pop() })
  }
  const openInEditor = () => {
    const ui = useUI.getState()
    ui.set({ screen: 'workspace', ...(v.floorId ? { floorId: v.floorId } : {}), ...(v.roomId && v.floorId ? { selection: [{ kind: 'room' as const, id: v.roomId, floorId: v.floorId }] } : {}) })
    setMode('3d')
    // after the 3D view has mounted, put the camera where this picture was taken
    setTimeout(() => {
      const e = getEngine()
      e.camera.fov = 50
      e.camera.updateProjectionMatrix()
      e.flyTo(new THREE.Vector3(...v.pose.position), new THREE.Vector3(...v.pose.target), 0.8)
      if (v.kind === 'interior') e.controls.maxPolarAngle = Math.PI
    }, 400)
  }

  return (
    <div className="sc-viewer" role="dialog" aria-label={v.title}>
      <header>
        <div className="grow">
          <b>{v.title}</b>
          <small>{v.subtitle}</small>
        </div>
        <Seg
          value={tab}
          onChange={(t) => setTab(t)}
          options={[
            { value: 'render', label: 'Picture', tip: 'Rendered from the 3D model' },
            { value: 'live', label: 'Look around', tip: 'Drag to look around in 3D' },
            ...(ai ? [{ value: 'ai' as Tab, label: 'AI photo', tip: 'Made from the picture by an AI image model' }] : [])
          ]}
        />
        <button className="icon-btn" aria-label="Close" data-tip="Close (Esc)" onClick={onClose}>
          <X />
        </button>
      </header>
      <div className="sc-stage">
        <button className="sc-nav prev" aria-label="Previous area" onClick={() => onIndex(index - 1)}>
          <ChevronLeft />
        </button>
        {tab === 'live' ? (
          <div ref={live} className="sc-live" />
        ) : tab === 'ai' && ai ? (
          <img src={ai} alt={`${v.title}, AI photo`} />
        ) : big ? (
          <img src={big} alt={v.title} />
        ) : (
          <span className="spinner" />
        )}
        {aiState.working && (
          <div className="sc-working">
            <span className="spinner" /> Making the AI photo… {elapsed}s
            <small>This usually takes 30 to 90 seconds.</small>
          </div>
        )}
        <button className="sc-nav next" aria-label="Next area" onClick={() => onIndex(index + 1)}>
          <ChevronRight />
        </button>
      </div>
      {aiState.error && (
        <div className="sc-error" role="alert">
          <b>The AI photo could not be made.</b> {aiState.error}
          <button className="link-btn" onClick={() => setAiState({ working: false, started: 0 })}>
            Dismiss
          </button>
        </div>
      )}
      <footer>
        <button className="btn" onClick={() => setTab('live')}>
          <Rotate3d size={14} /> Look around in 3D
        </button>
        <button className="btn" onClick={photoreal} data-tip="Path-traced: real light bounce, soft shadows, reflections">
          <Aperture size={14} /> Photoreal render
        </button>
        <button className="btn primary" disabled={aiState.working} onClick={() => void makeAi()} data-tip="Turns this picture into a photograph-like image with an OpenAI image model; the layout stays as designed">
          <Sparkles size={14} /> {ai ? 'New AI photo' : 'Make AI photo'}
        </button>
        <div className="grow" />
        <button className="btn ghost" onClick={() => void save()}>
          <Download size={14} /> Save image
        </button>
        <button className="btn ghost" onClick={openInEditor}>
          <Box size={14} /> Open in 3D editor
        </button>
        <span className="faint sc-count">
          {index + 1} / {views.length}
        </span>
      </footer>
      {tab === 'ai' && <p className="sc-ai-note">AI photo: an impression made from the rendered model. Small details can differ from the design; the drawings are what gets built.</p>}
    </div>
  )
}

/* ── PDF brochure ───────────────────────────────────────────────────────── */

const ascii = (s: string) => s.replace(/′/g, "'").replace(/″/g, '"').replace(/×/g, 'x').replace(/²/g, '2').replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '')

async function dataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob()
  return await new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(blob)
  })
}

async function exportBrochure(p: Project, views: AreaView[], features: KeyFeature[], o: { extLight: Light; intLight: Light; showAi: boolean }) {
  const ui = useUI.getState()
  ui.set({ busy: 'Preparing the brochure…' })
  try {
    const assets = useAssets.getState().assets
    const aiFor = (k: string) => {
      if (!o.showAi) return undefined
      const ci = [...p.conceptImages].reverse().find((c) => c.areaKey === k && c.source === 'ai-photo')
      return ci ? assets[ci.assetId]?.url : undefined
    }
    const pic = async (v: AreaView) => {
      const light = v.kind === 'interior' ? o.intLight : o.extLight
      const k = `card|${v.key}|${light}`
      const hit = aiFor(v.key) ?? cached(p).get(k)
      const url = hit ?? (await renderHouseImage(lit(p, light, v.kind === 'interior'), { width: 720, height: 450, floorId: v.floorId, pose: v.pose, doorsOpen: v.kind !== 'interior' }))
      if (!hit) cached(p).set(k, url)
      return dataUrl(url)
    }
    const heroKey = `hero|${o.extLight}`
    const heroUrl = aiFor('ext-front') ?? cached(p).get(heroKey) ?? (await renderHouseImage(lit(p, o.extLight, false), { width: 1680, height: 760, pose: heroPose(p, 1680 / 760) }))
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210
    const H = 297
    const bg = () => {
      doc.setFillColor(11, 22, 38)
      doc.rect(0, 0, W, H, 'F')
    }
    bg()
    // header
    const style = STYLE_TITLE[p.exterior.style] ?? 'Modern Home'
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(19)
    doc.text(ascii(style.replace(/Villa$/, 'Home')), 12, 17)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(140, 175, 220)
    doc.text(ascii(styleTagline(p.exterior.style)), 12, 23)
    doc.setDrawColor(70, 110, 170)
    doc.setFillColor(18, 36, 62)
    doc.roundedRect(W - 70, 9, 58, 16, 2, 2, 'FD')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.text('Plot Size', W - 66, 15.5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(ascii(plotSizeLabel(p, presetById(p.plot.presetId)?.label)), W - 66, 21)
    // hero
    doc.addImage(await dataUrl(heroUrl), 'JPEG', 0, 30, W, (W * 760) / 1680)
    let y = 30 + (W * 760) / 1680 + 9
    // key features
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(255, 255, 255)
    doc.text('Key Features', 12, y)
    y += 6
    doc.setFontSize(8.5)
    const colW = (W - 24) / 4
    features.forEach((f, i) => {
      const cx = 12 + (i % 4) * colW
      const cy = y + Math.floor(i / 4) * 12.5
      doc.setFillColor(47, 123, 255)
      doc.circle(cx + 1.5, cy - 1.2, 1.1, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(255, 255, 255)
      doc.text(ascii(f.title), cx + 4.5, cy)
      if (f.detail) {
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(150, 170, 195)
        doc.text((doc.splitTextToSize(ascii(`(${f.detail})`), colW - 7) as string[]).slice(0, 2), cx + 4.5, cy + 3.8)
      }
    })
    y += Math.ceil(features.length / 4) * 12.5 + 3
    // gallery, three across, continuing on new pages
    const gw = (W - 24 - 8) / 3
    const gh = (gw * 450) / 720
    const items = views.filter((v) => v.key !== 'ext-front')
    for (let i = 0; i < items.length; i++) {
      const col = i % 3
      if (col === 0 && y + gh + 9 > H - 12) {
        doc.addPage()
        bg()
        y = 14
      }
      const x = 12 + col * (gw + 4)
      ui.set({ busy: `Preparing the brochure… ${i + 1} of ${items.length}` })
      doc.addImage(await pic(items[i]), 'JPEG', x, y, gw, gh)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(255, 255, 255)
      doc.text(ascii(items[i].title).slice(0, 38), x, y + gh + 4)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(150, 170, 195)
      doc.text(ascii(items[i].subtitle).slice(0, 52), x, y + gh + 7.3)
      if (col === 2 || i === items.length - 1) y += gh + 11
    }
    doc.setFontSize(6.5)
    doc.setTextColor(120, 135, 155)
    doc.text(doc.splitTextToSize(ascii(DISCLAIMER), W - 24), 12, H - 8)
    const path = await platform.saveDialog(`${(p.name || 'house').replace(/[^\w]+/g, '-').toLowerCase()}-brochure.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], doc.output('arraybuffer'))
    if (path) ui.toast({ kind: 'success', title: 'Brochure saved', body: path.split(/[\\/]/).pop(), action: path.includes('/') || path.includes('\\') ? { label: 'Show in folder', run: () => void platform.showInFolder(path) } : undefined })
  } catch (e) {
    ui.showError({ what: 'The brochure could not be saved.', why: (e as Error).message, fix: 'Try again; if it keeps failing, export the presentation instead.' })
  } finally {
    ui.set({ busy: null })
  }
}

