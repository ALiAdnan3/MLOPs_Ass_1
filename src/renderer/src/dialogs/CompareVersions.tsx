import { useEffect, useRef } from 'react'
import { useUI } from '../state/ui'
import { useProject } from '../state/store'
import { Modal } from '../ui/primitives'
import { designStats } from '../planner/metrics'
import { formatAreaFor } from '../core/units/units'
import { renderPlanToCanvas } from '../render/planImage'
import { sortedFloors } from '../core/model/house'
import type { Version } from '../core/model/types'
import { restoreVersion } from '../app/actions'

/** Compare two saved versions side by side (§38). */
export function CompareVersionsDialog() {
  const dialog = useUI((s) => s.dialog)
  const props = useUI((s) => s.dialogProps) as { a?: string; b?: string }
  const close = useUI((s) => s.closeDialog)
  const project = useProject((s) => s.project)
  if (dialog !== 'compare-versions') return null
  const a = project.versions.find((v) => v.id === props.a)
  const b = project.versions.find((v) => v.id === props.b)
  if (!a || !b) return null
  const sa = designStats(a.house)
  const sb = designStats(b.house)
  const u = project.settings.units
  const rows: [string, number, number, (v: number) => string][] = [
    ['Bedrooms', sa.bedrooms, sb.bedrooms, String],
    ['Bathrooms', sa.bathrooms, sb.bathrooms, String],
    ['Parking', sa.parking, sb.parking, String],
    ['Covered area', sa.coveredArea, sb.coveredArea, (v) => formatAreaFor(v, u)],
    ['Total floor area', sa.totalFloorArea, sb.totalFloorArea, (v) => formatAreaFor(v, u)],
    ['Garden', sa.gardenArea, sb.gardenArea, (v) => formatAreaFor(v, u)],
    ['Floors', sa.floors, sb.floors, String],
    ['Rooms', sa.rooms, sb.rooms, String]
  ]
  return (
    <Modal title={`Version ${a.number} vs version ${b.number}`} onClose={close} size="xwide">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <VersionPlan v={a} />
        <VersionPlan v={b} />
      </div>
      <table className="compare">
        <thead>
          <tr>
            <th />
            <th>
              Version {a.number}: {a.name}
            </th>
            <th>
              Version {b.number}: {b.name}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([l, x, y, f]) => (
            <tr key={l}>
              <td>{l}</td>
              <td className={x !== y ? 'better' : ''}>{f(x)}</td>
              <td className={x !== y ? 'better' : ''}>{f(y)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn" onClick={() => (restoreVersion(a.id), close())}>
          Restore version {a.number}
        </button>
        <button className="btn" onClick={() => (restoreVersion(b.id), close())}>
          Restore version {b.number}
        </button>
      </div>
    </Modal>
  )
}

function VersionPlan({ v }: { v: Version }) {
  const ref = useRef<HTMLDivElement>(null)
  const settings = useProject((s) => s.project.settings)
  useEffect(() => {
    const g = sortedFloors(v.house.floors).find((f) => f.level === 0)
    if (!ref.current || !g) return
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    const c = renderPlanToCanvas({ ...v.house, settings, materials: v.materials }, g, 600, 380, { theme, site: true, dpr: window.devicePixelRatio || 1 })
    c.style.width = '100%'
    ref.current.replaceChildren(c)
  }, [v, settings])
  return <div ref={ref} style={{ border: '1px solid var(--line-soft)', borderRadius: 6, overflow: 'hidden' }} />
}
