import { useEffect, useRef, useState } from 'react'
import { FolderOpen, PencilRuler, CirclePlay, Clock, Sparkles } from 'lucide-react'
import { useUI } from '../state/ui'
import { BrandMark } from '../ui/primitives'
import { platform } from '../storage/platform'
import type { AutosaveEntry, RecentProject } from '../../../shared/api'
import { openProjectDialog, openRecent, restoreAutosave } from '../storage/session'
import { openDemoHouse, startTemplate } from '../app/actions'
import { TEMPLATES, templateRequirements } from '../planner/templates'
import { plotFromPreset, DISCLAIMER, newProject } from '../core/model/defaults'
import { generateDesignsParallel } from '../ai/designService'
import { getEngine } from '../engine/Engine'
import type { DesignOption, Project } from '../core/model/types'
import { formatAreaFor, formatPlotSize } from '../core/units/units'
import { presetById } from '../core/units/plots'
import { useWizard } from './wizardState'
import { parseRequirements } from '../ai/requirementParser'
import { dressDemo, projectFromDesign } from '../app/actions'

let heroCache: Project | null = null

export function Home() {
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [autos, setAutos] = useState<AutosaveEntry[]>([])
  const [prompt, setPrompt] = useState('')
  const set = useUI((s) => s.set)
  useEffect(() => {
    platform.recent.list().then(setRecent)
    platform.autosave.list().then((a) => setAutos(a.slice(0, 4)))
  }, [])

  const startWizard = () => {
    useWizard.getState().reset()
    set({ screen: 'wizard' })
  }
  const describe = () => {
    if (!prompt.trim()) return
    const w = useWizard.getState()
    w.reset()
    const r = parseRequirements(prompt, w.req)
    w.applyParsed(r, prompt)
    set({ screen: 'wizard' })
    useWizard.getState().setStep(r.plot ? 7 : 0)
  }

  return (
    <div className="home">
      <div className="home-left">
        <div className="row" style={{ gap: 10 }}>
          <BrandMark size={26} />
          <span className="wide" style={{ fontWeight: 650, fontSize: 15 }}>
            HomeForge AI
          </span>
        </div>
        <div className="home-title">
          <h1>Design. Generate. Customize. Experience your home.</h1>
          <p>Enter your plot and what you need. HomeForge draws complete floor plans, builds the house in 3D, and lets you walk through it before anything is built.</p>
        </div>

        <div className="prompt-box">
          <textarea
            placeholder="Describe the house you want, for example: a modern 10 marla double-storey house with 4 bedrooms, 2 car parking, basement, large lawn and a drawing room"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {
                e.preventDefault()
                describe()
              }
            }}
          />
          <div className="row">
            <span className="faint" style={{ fontSize: 12 }}>
              Works offline. Your description fills in the requirement wizard.
            </span>
            <button className="btn primary" disabled={!prompt.trim()} onClick={describe}>
              <Sparkles /> Plan my house
            </button>
          </div>
        </div>

        <div className="home-actions">
          <button className="home-action primary" onClick={startWizard}>
            <PencilRuler />
            <div>
              <div className="t">Create new house</div>
              <div className="d">Step-by-step: plot, floors, rooms, outdoor, style, preferences</div>
            </div>
          </button>
          <button className="home-action" onClick={() => void openProjectDialog()}>
            <FolderOpen />
            <div>
              <div className="t">Open project</div>
              <div className="d">A .homeforge file from your computer</div>
            </div>
          </button>
          <button className="home-action" onClick={() => void openDemoHouse()}>
            <CirclePlay />
            <div>
              <div className="t">Try demo house</div>
              <div className="d">A finished 10 marla home with materials, garden, walkthrough and drone view</div>
            </div>
          </button>
        </div>

        {recent.length > 0 && (
          <div>
            <div className="section-title">Recent projects</div>
            <div className="recent list">
              {recent.slice(0, 5).map((r) => (
                <div key={r.path} className="list-item" onClick={() => void openRecent(r.path)} data-tip={r.path}>
                  {r.thumbnail ? <img src={r.thumbnail} alt="" /> : <div className="swatch" style={{ width: 44, height: 32 }} />}
                  <div>
                    <div>{r.name}</div>
                    <div className="faint" style={{ fontSize: 11 }}>
                      {r.plot}, opened {new Date(r.openedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {autos.length > 0 && (
          <div>
            <div className="section-title">Recover unsaved work</div>
            <div className="list">
              {autos.map((a) => (
                <div key={a.id} className="list-item" onClick={() => void restoreAutosave(a.id)}>
                  <Clock size={15} className="muted" />
                  <span>{a.name}</span>
                  <span className="meta">{timeAgo(a.savedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="section-title">Start from a template</div>
          <div className="template-list">
            {TEMPLATES.map((t) => {
              const pre = presetById(t.preset)!
              return (
                <button key={t.id} className="template" onClick={() => void startTemplate(t.id)} data-tip={t.blurb}>
                  <PlotGlyph w={pre.widthFt} d={pre.depthFt} />
                  <div>
                    <div className="n">{t.name}</div>
                    <div className="s">
                      {pre.widthFt} × {pre.depthFt} ft
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
        <p className="disclaimer">{DISCLAIMER}</p>
      </div>
      <Hero />
    </div>
  )
}

/** The one memorable element: the product itself, a real generated house slowly orbiting. */
function Hero() {
  const ref = useRef<HTMLDivElement>(null)
  const [house, setHouse] = useState<Project | null>(heroCache)
  const [design, setDesign] = useState<DesignOption | null>(null)
  useEffect(() => {
    if (heroCache) return
    let alive = true
    const t = TEMPLATES.find((x) => x.id === '1k-luxury')!
    const req = templateRequirements(t)
    const timer = setTimeout(() => {
      generateDesignsParallel(req, plotFromPreset(t.preset), newProject().settings, () => {}, { strategies: ['luxury-open'], baseSeed: 2020, iterations: 1600 }).then(({ designs }) => {
        if (!alive || !designs[0]) return
        const p = projectFromDesign(designs[0], req, designs, t.name)
        dressDemo(p)
        p.settings.lighting = { ...p.settings.lighting, preset: 'sunset', time: 17.6 }
        heroCache = p
        setHouse(p)
        setDesign(designs[0])
      })
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el || !house) return
    const e = getEngine()
    e.mount(el)
    e.setController(null)
    e.update(house, { floorId: house.floors.find((f) => f.level === 0)!.id, showAll: true, viewMode: 'realistic', explodeGap: 0, doorsOpen: true, showFurniture: true, showStructure: true })
    e.setCameraPreset('orbit', undefined, false)
    const c = e.houseCenter()
    e.camera.position.set(c.x + 26, 13, c.z + 30)
    e.controls.target.copy(c)
    e.controls.autoRotate = true
    e.controls.autoRotateSpeed = 0.35
    e.controls.update()
    let raf = 0
    const spin = () => {
      e.controls.update()
      e.invalidate()
      raf = requestAnimationFrame(spin)
    }
    raf = requestAnimationFrame(spin)
    return () => {
      cancelAnimationFrame(raf)
      e.controls.autoRotate = false
      e.unmount(el)
    }
  }, [house])
  const d = design
  return (
    <div className="home-hero" ref={ref}>
      {!house && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#8d949b' }}>
          <div className="row">
            <div className="spinner" /> Generating a house to show you…
          </div>
        </div>
      )}
      {d && (
        <div className="caption">
          <div>
            <div className="k">Plot</div>
            <div className="v">{formatPlotSize(d.house.plot.width, d.house.plot.depth, 'ft-in')}</div>
          </div>
          <div>
            <div className="k">Covered area</div>
            <div className="v">{formatAreaFor(d.stats.coveredArea, 'ft-in')}</div>
          </div>
          <div>
            <div className="k">Bedrooms</div>
            <div className="v">{d.stats.bedrooms}</div>
          </div>
          <div>
            <div className="k">Floors</div>
            <div className="v">{d.stats.floors}</div>
          </div>
          <div>
            <div className="k">Bathrooms</div>
            <div className="v">{d.stats.bathrooms}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function PlotGlyph({ w, d }: { w: number; d: number }) {
  const s = Math.min(34 / w, 44 / d)
  const pw = w * s
  const pd = d * s
  return (
    <svg className="ph" viewBox="0 0 38 46">
      <rect x={(38 - pw) / 2} y={(46 - pd) / 2} width={pw} height={pd} fill="none" stroke="var(--text-3)" strokeWidth="1" />
      <rect x={(38 - pw) / 2 + pw * 0.12} y={(46 - pd) / 2 + pd * 0.18} width={pw * 0.76} height={pd * 0.5} fill="var(--raised-2)" stroke="var(--text-2)" strokeWidth="1" />
    </svg>
  )
}

function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(t).toLocaleDateString()
}
