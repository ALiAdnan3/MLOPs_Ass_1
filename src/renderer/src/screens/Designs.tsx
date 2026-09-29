import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, GitCompare, RefreshCw, TriangleAlert } from 'lucide-react'
import { useUI } from '../state/ui'
import { useWizard } from './wizardState'
import { generateDesignsParallel, type GenProgress } from '../ai/designService'
import type { DesignOption, DesignStrategy, Project } from '../core/model/types'
import { STRATEGIES, PIPELINE, type PipelineStage } from '../planner/generator'
import { newProject, DISCLAIMER } from '../core/model/defaults'
import { renderPlanToCanvas } from '../render/planImage'
import { renderHouseImage } from '../render/houseImage'
import { formatAreaFor } from '../core/units/units'
import { openProject, projectFromDesign, applyDesignToProject } from '../app/actions'
import { commit } from '../state/store'
import { Modal, Seg } from '../ui/primitives'
import { sortedFloors } from '../core/model/house'
import { autosaveNow } from '../storage/session'
import type { GenerationError } from '../planner/generator'

export function Designs() {
  const w = useWizard()
  const set = useUI((s) => s.set)
  const [designs, setDesigns] = useState<DesignOption[]>([])
  const [stages, setStages] = useState<Record<string, PipelineStage | 'done' | 'error'>>({})
  const [errors, setErrors] = useState<GenerationError[]>([])
  const [running, setRunning] = useState(false)
  const [compare, setCompare] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)
  const settings = useMemo(() => newProject().settings, [])

  const run = (seed?: number) => {
    setRunning(true)
    setDesigns([])
    setErrors([])
    setCompare([])
    setStages(Object.fromEntries(STRATEGIES.map((s) => [s.key, 'Requirements'])))
    generateDesignsParallel(w.req, w.plot, settings, (p: GenProgress) => {
      if (p.stage) setStages((st) => ({ ...st, [p.strategy]: p.stage! }))
      if (p.design) {
        setStages((st) => ({ ...st, [p.strategy]: 'done' }))
        setDesigns((ds) => [...ds.filter((d) => d.strategy !== p.strategy), p.design!].sort((a, b) => a.label.localeCompare(b.label)))
      }
      if (p.error) {
        setStages((st) => ({ ...st, [p.strategy]: 'error' }))
        setErrors((e) => [...e, p.error!])
      }
    }, { baseSeed: seed }).then(() => setRunning(false))
  }
  useEffect(() => {
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const use = async (d: DesignOption) => {
    if (w.targetExisting) {
      // editing an open project: apply the design to it (undoable, versioned)
      commit('Update requirements', (dr) => void (dr.requirements = structuredClone(w.req) as typeof dr.requirements))
      applyDesignToProject(d)
      set({ screen: 'workspace', mode: 'plan' })
      return
    }
    const p = projectFromDesign(d, w.req, designs)
    openProject(p)
    await autosaveNow('new-project')
  }

  return (
    <div className="designs">
      <div className="designs-head">
        <button className="btn ghost" onClick={() => set({ screen: 'wizard' })}>
          <ArrowLeft /> Requirements
        </button>
        <div>
          <h2>Generated designs</h2>
          <div className="muted">Every design is a complete, editable house. Pick one to open it in the editor.</div>
        </div>
        <div className="grow" />
        {compare.length === 2 && (
          <button className="btn" onClick={() => setShowCompare(true)}>
            <GitCompare /> Compare {compare.map((id) => designs.find((d) => d.id === id)?.label).join(' vs ')}
          </button>
        )}
        <button className="btn" disabled={running} onClick={() => run(Math.floor(Math.random() * 1e6))}>
          <RefreshCw /> Generate new alternatives
        </button>
      </div>
      <div className="design-grid">
        {STRATEGIES.map((s) => {
          const d = designs.find((x) => x.strategy === s.key)
          if (!d) return <PendingCard key={s.key} label={s.label} name={s.name} stage={stages[s.key]} />
          return <DesignCard key={d.id} d={d} onUse={() => void use(d)} compared={compare.includes(d.id)} onCompare={(on) => setCompare((c) => (on ? [...c.filter((x) => x !== d.id), d.id].slice(-2) : c.filter((x) => x !== d.id)))} />
        })}
        {errors.map((e, i) => (
          <div key={i} className="design-card" style={{ padding: 16 }}>
            <div className="row" style={{ color: 'var(--danger)', fontWeight: 600 }}>
              <TriangleAlert size={16} /> {e.what}
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              {e.why}
            </p>
            <p style={{ marginTop: 6 }}>{e.fix}</p>
          </div>
        ))}
      </div>
      <p className="disclaimer" style={{ padding: '0 26px 14px' }}>
        {DISCLAIMER}
      </p>
      {showCompare && compare.length === 2 && <CompareDialog a={designs.find((d) => d.id === compare[0])!} b={designs.find((d) => d.id === compare[1])!} onClose={() => setShowCompare(false)} onUse={(d) => void use(d)} />}
    </div>
  )
}

function PendingCard(props: { label: string; name: string; stage?: PipelineStage | 'done' | 'error' }) {
  const idx = props.stage && props.stage !== 'done' && props.stage !== 'error' ? PIPELINE.indexOf(props.stage) : -1
  return (
    <div className="design-card">
      <div className="views" style={{ display: 'grid', placeItems: 'center', gridTemplateColumns: '1fr' }}>
        <div className="spinner" />
      </div>
      <div className="body">
        <div className="title">
          <span className="letter">{props.label}</span>
          <h3>{props.name}</h3>
        </div>
        <div className="pipeline">
          {PIPELINE.map((st, i) => (
            <span key={st} className={i < idx ? 'done' : i === idx ? 'active' : ''}>
              {st}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function DesignCard(props: { d: DesignOption; onUse: () => void; compared: boolean; onCompare: (on: boolean) => void }) {
  const { d } = props
  const floors = sortedFloors(d.house.floors).filter((f) => f.kind !== 'roof')
  const [floorId, setFloorId] = useState(floors.find((f) => f.level === 0)?.id ?? floors[0]?.id)
  const planRef = useRef<HTMLDivElement>(null)
  const [img, setImg] = useState<string | null>(null)
  const [why, setWhy] = useState(false)
  useEffect(() => {
    const el = planRef.current
    const f = floors.find((x) => x.id === floorId)
    if (!el || !f) return
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    const c = renderPlanToCanvas({ ...d.house, settings: newProject().settings, materials: [] }, f, 330, 200, { theme, site: f.level === 0, dpr: window.devicePixelRatio || 1, labels: true })
    c.style.width = '100%'
    c.style.height = '200px'
    el.replaceChildren(c)
  }, [d, floorId, floors])
  useEffect(() => {
    let alive = true
    const p = { ...newProject(), ...d.house } as Project
    renderHouseImage(p, { width: 480, height: 400 }).then((u) => alive && setImg(u))
    return () => {
      alive = false
    }
  }, [d])
  const s = d.stats
  const u = 'ft-in'
  return (
    <div className={`design-card ${props.compared ? 'on' : ''}`}>
      <div className="views">
        <div ref={planRef} />
        {img ? <img src={img} alt={`${d.name} in 3D`} /> : <div style={{ display: 'grid', placeItems: 'center' }}><div className="spinner" /></div>}
      </div>
      <div className="body">
        <div className="title">
          <span className="letter">{d.label}</span>
          <h3>{d.name}</h3>
          <div className="grow" />
          {floors.length > 1 && <Seg value={floorId} onChange={setFloorId} options={floors.map((f) => ({ value: f.id, label: f.kind === 'basement' ? 'B' : f.level === 0 ? 'G' : String(f.level) }))} />}
        </div>
        <dl className="kv">
          <dt>Covered area</dt>
          <dd>{formatAreaFor(s.coveredArea, u)}</dd>
          <dt>Total floor area</dt>
          <dd>{formatAreaFor(s.totalFloorArea, u)}</dd>
          <dt>Garden</dt>
          <dd>{formatAreaFor(s.gardenArea, u)}</dd>
          <dt>Bedrooms / baths</dt>
          <dd>
            {s.bedrooms} / {s.bathrooms}
          </dd>
          <dt>Parking</dt>
          <dd>{s.parking} cars</dd>
        </dl>
        <div className="scores">
          {(
            [
              ['privacy', 'Privacy'],
              ['light', 'Daylight'],
              ['garden', 'Garden'],
              ['space', 'Room size']
            ] as const
          ).map(([k, l]) => (
            <div key={k} className="score">
              <div className="k">
                {l} <span className="tabular">{d.scores[k]}</span>
              </div>
              <div className="bar">
                <i style={{ width: `${d.scores[k]}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div>
          <button className="btn ghost sm" onClick={() => setWhy(!why)}>
            {why ? 'Hide' : 'Why this design?'}
          </button>
          {why && (
            <ul className="why">
              {d.explanation.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          )}
          {d.warnings.length > 0 && (
            <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
              {d.warnings.length} note{d.warnings.length > 1 ? 's' : ''}: {d.warnings[0]}
            </p>
          )}
        </div>
        <div className="row" style={{ marginTop: 'auto' }}>
          <label className="check faint" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={props.compared} onChange={(e) => props.onCompare(e.target.checked)} /> Compare
          </label>
          <div className="grow" />
          <button className="btn primary" onClick={props.onUse}>
            <Check /> Use this design
          </button>
        </div>
      </div>
    </div>
  )
}

export function CompareDialog(props: { a: DesignOption; b: DesignOption; onClose: () => void; onUse?: (d: DesignOption) => void }) {
  const { a, b } = props
  const rows: [string, (d: DesignOption) => number, (v: number) => string, 'high' | 'low' | null][] = [
    ['Bedrooms', (d) => d.stats.bedrooms, String, 'high'],
    ['Bathrooms', (d) => d.stats.bathrooms, String, 'high'],
    ['Parking', (d) => d.stats.parking, String, 'high'],
    ['Garden', (d) => d.stats.gardenArea, (v) => formatAreaFor(v, 'ft-in'), 'high'],
    ['Covered area', (d) => d.stats.coveredArea, (v) => formatAreaFor(v, 'ft-in'), null],
    ['Total floor area', (d) => d.stats.totalFloorArea, (v) => formatAreaFor(v, 'ft-in'), 'high'],
    ['Floors', (d) => d.stats.floors, String, null],
    ['Rooms', (d) => d.stats.rooms, String, null],
    ['Privacy score', (d) => d.scores.privacy, String, 'high'],
    ['Daylight score', (d) => d.scores.light, String, 'high'],
    ['Overall score', (d) => d.scores.overall, String, 'high']
  ]
  return (
    <Modal title={`Design ${a.label} vs Design ${b.label}`} subtitle={`${a.name} and ${b.name}`} onClose={props.onClose} size="xwide">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        {[a, b].map((d) => (
          <ComparePane key={d.id} d={d} />
        ))}
      </div>
      <table className="compare">
        <thead>
          <tr>
            <th />
            <th>Design {a.label}</th>
            <th>Design {b.label}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, get, fmt, better]) => {
            const va = get(a)
            const vb = get(b)
            const aw = better && va !== vb && (better === 'high' ? va > vb : va < vb)
            const bw = better && va !== vb && !aw
            return (
              <tr key={label}>
                <td>{label}</td>
                <td className={aw ? 'better' : ''}>{fmt(va)}</td>
                <td className={bw ? 'better' : ''}>{fmt(vb)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {props.onUse && (
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn" onClick={() => props.onUse!(a)}>
            Use design {a.label}
          </button>
          <button className="btn primary" onClick={() => props.onUse!(b)}>
            Use design {b.label}
          </button>
        </div>
      )}
    </Modal>
  )
}

function ComparePane({ d }: { d: DesignOption }) {
  const ref = useRef<HTMLDivElement>(null)
  const [img, setImg] = useState<string | null>(null)
  const [view, setView] = useState<'plan' | '3d'>('plan')
  useEffect(() => {
    const g = sortedFloors(d.house.floors).find((f) => f.level === 0)
    if (!ref.current || !g || view !== 'plan') return
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    const c = renderPlanToCanvas({ ...d.house, settings: newProject().settings, materials: [] }, g, 600, 380, { theme, site: true, dpr: window.devicePixelRatio || 1 })
    c.style.width = '100%'
    ref.current.replaceChildren(c)
  }, [d, view])
  useEffect(() => {
    if (view !== '3d' || img) return
    renderHouseImage({ ...newProject(), ...d.house } as Project, { width: 800, height: 500 }).then(setImg)
  }, [view, d, img])
  return (
    <div style={{ border: '1px solid var(--line-soft)', borderRadius: 6, overflow: 'hidden' }}>
      <div className="row" style={{ padding: 8 }}>
        <b>
          {d.label}. {d.name}
        </b>
        <div className="grow" />
        <Seg value={view} onChange={setView} options={[{ value: 'plan', label: '2D plan' }, { value: '3d', label: '3D' }]} />
      </div>
      {view === 'plan' ? <div ref={ref} /> : img ? <img src={img} style={{ width: '100%', display: 'block' }} /> : <div style={{ height: 300, display: 'grid', placeItems: 'center' }}><div className="spinner" /></div>}
    </div>
  )
}

export type { DesignStrategy }
