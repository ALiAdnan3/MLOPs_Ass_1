import { useEffect, useRef, useState } from 'react'
import { Modal } from '../ui/primitives'
import { useProject } from '../state/store'
import { useUI } from '../state/ui'
import type { DesignOption, DesignStrategy, Project, Requirements } from '../core/model/types'
import { generateDesignsParallel } from '../ai/designService'
import { applyDesignToProject } from '../app/actions'
import { renderPlanToCanvas } from '../render/planImage'
import { renderHouseImage } from '../render/houseImage'
import { sortedFloors } from '../core/model/house'
import { formatAreaFor } from '../core/units/units'
import { newProject } from '../core/model/defaults'
import { autosaveNow } from '../storage/session'
import { CompareDialog } from '../screens/Designs'

/** "Generate alternatives" for an existing house (§24): variations shown side by side. */

export const VARIATIONS: { key: string; label: string; strategy: DesignStrategy; tweak: (r: Requirements) => void }[] = [
  { key: 'garden', label: 'More garden', strategy: 'garden', tweak: (r) => void (r.preferences.greenSpace = Math.min(100, r.preferences.greenSpace + 30)) },
  { key: 'bedrooms', label: 'More bedrooms', strategy: 'family', tweak: (r) => {
      r.rooms.bedrooms += 1
      r.rooms.bathrooms += 1
    } },
  { key: 'parking', label: 'More parking', strategy: 'family', tweak: (r) => {
      r.outdoor.garage = true
      r.outdoor.cars = Math.min(4, r.outdoor.cars + 1)
    } },
  { key: 'privacy', label: 'More privacy', strategy: 'privacy', tweak: (r) => void (r.preferences.privacy = Math.min(100, r.preferences.privacy + 30)) },
  { key: 'light', label: 'More natural light', strategy: 'family', tweak: (r) => {
      r.preferences.naturalLight = 95
      r.special.largeWindows = true
      r.special.centralCourtyard = r.rooms.bedrooms >= 4
    } },
  { key: 'luxury', label: 'More luxury', strategy: 'luxury-open', tweak: (r) => {
      r.preferences.luxury = Math.min(100, r.preferences.luxury + 30)
      r.special.doubleHeightLounge = true
    } },
  { key: 'open', label: 'More open space', strategy: 'luxury-open', tweak: (r) => void (r.preferences.openSpace = 95) },
  { key: 'modern', label: 'More modern', strategy: 'family', tweak: (r) => {
      r.style = 'modern'
      r.special.largeWindows = true
    } },
  { key: 'traditional', label: 'More traditional', strategy: 'privacy', tweak: (r) => {
      r.style = 'traditional'
      r.preferences.openSpace = Math.max(10, r.preferences.openSpace - 30)
    } }
]

export function AlternativesDialog({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project)
  const [picked, setPicked] = useState<string[]>(['garden', 'privacy', 'light'])
  const [results, setResults] = useState<{ key: string; label: string; d?: DesignOption; error?: string }[]>([])
  const [running, setRunning] = useState(false)
  const [compare, setCompare] = useState<DesignOption[] | null>(null)
  const run = async () => {
    setRunning(true)
    setResults(picked.map((k) => ({ key: k, label: VARIATIONS.find((v) => v.key === k)!.label })))
    await autosaveNow('before-alternatives')
    await Promise.all(
      picked.map(async (k, i) => {
        const v = VARIATIONS.find((x) => x.key === k)!
        const req = structuredClone(project.requirements)
        v.tweak(req)
        const { designs, errors } = await generateDesignsParallel(req, project.plot, project.settings, () => {}, { strategies: [v.strategy], baseSeed: 7000 + i * 131 + Math.floor(Math.random() * 1000) })
        const d = designs[0]
        if (d) d.name = v.label
        setResults((rs) => rs.map((r) => (r.key === k ? { ...r, d, error: errors[0]?.why } : r)))
      })
    )
    setRunning(false)
  }
  return (
    <Modal title="Generate alternatives" subtitle="Variations of this house, generated from its requirements with one preference pushed further." onClose={onClose} size="xwide">
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {VARIATIONS.map((v) => (
          <button key={v.key} className={`chip ${picked.includes(v.key) ? 'on' : ''}`} onClick={() => setPicked((p) => (p.includes(v.key) ? p.filter((x) => x !== v.key) : [...p, v.key]))}>
            {v.label}
          </button>
        ))}
        <div className="grow" />
        <button className="btn primary" disabled={running || !picked.length} onClick={() => void run()}>
          {running ? 'Generating…' : `Generate ${picked.length} alternative${picked.length === 1 ? '' : 's'}`}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, results.length))}, 1fr)`, gap: 12 }}>
        {results.map((r) => (
          <AltCard key={r.key} label={r.label} d={r.d} error={r.error} project={project} onApply={(d) => {
              applyDesignToProject(d)
              onClose()
              useUI.getState().toast({ kind: 'success', title: `${r.label} applied`, body: 'Undo with Ctrl+Z, or restore the previous version.' })
            }} onCompare={(d) => {
              const cur = project.designs.find((x) => x.id === project.activeDesignId)
              if (cur) setCompare([cur, d])
            }} />
        ))}
      </div>
      {compare && <CompareDialog a={compare[0]} b={compare[1]} onClose={() => setCompare(null)} />}
    </Modal>
  )
}

function AltCard(props: { label: string; d?: DesignOption; error?: string; project: Project; onApply: (d: DesignOption) => void; onCompare: (d: DesignOption) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [img, setImg] = useState<string | null>(null)
  const { d } = props
  useEffect(() => {
    if (!d || !ref.current) return
    const g = sortedFloors(d.house.floors).find((f) => f.level === 0)!
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    const c = renderPlanToCanvas({ ...d.house, settings: props.project.settings, materials: [] }, g, 380, 240, { theme, site: true, dpr: window.devicePixelRatio || 1 })
    c.style.width = '100%'
    ref.current.replaceChildren(c)
    renderHouseImage({ ...newProject(), ...d.house } as Project, { width: 380, height: 240 }).then(setImg)
  }, [d, props.project.settings])
  const u = props.project.settings.units
  return (
    <div className="design-card">
      {!d && !props.error && (
        <div style={{ height: 240, display: 'grid', placeItems: 'center' }}>
          <div className="spinner" />
        </div>
      )}
      {d && (
        <>
          <div ref={ref} />
          {img && <img src={img} style={{ width: '100%', display: 'block' }} />}
        </>
      )}
      <div className="body">
        <h3>{props.label}</h3>
        {props.error && <p className="muted">{props.error}</p>}
        {d && (
          <>
            <dl className="kv">
              <dt>Bedrooms / baths</dt>
              <dd>
                {d.stats.bedrooms} / {d.stats.bathrooms}
              </dd>
              <dt>Covered</dt>
              <dd>{formatAreaFor(d.stats.coveredArea, u)}</dd>
              <dt>Garden</dt>
              <dd>{formatAreaFor(d.stats.gardenArea, u)}</dd>
              <dt>Parking</dt>
              <dd>{d.stats.parking}</dd>
            </dl>
            <div className="row">
              <button className="btn sm" onClick={() => props.onCompare(d)}>
                Compare with current
              </button>
              <div className="grow" />
              <button className="btn primary sm" onClick={() => props.onApply(d)}>
                Use this
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
