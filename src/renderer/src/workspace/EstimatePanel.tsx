import { useMemo, useState } from 'react'
import { useProject, commit } from '../state/store'
import { COST_PRESETS } from '../core/model/defaults'
import { measure, estimate, materialQuantities, formatMoney } from '../planner/estimate'
import { houseOf } from '../app/actions'
import type { CostRates } from '../core/model/types'
import { Seg } from '../ui/primitives'

const RATE_LABELS: { k: keyof CostRates; label: string; per: string }[] = [
  { k: 'structure', label: 'Grey structure', per: 'per m²' },
  { k: 'flooring', label: 'Flooring', per: 'per m²' },
  { k: 'marble', label: 'Marble', per: 'per m²' },
  { k: 'wallFinish', label: 'Wall tiles / cladding', per: 'per m²' },
  { k: 'paint', label: 'Paint', per: 'per m²' },
  { k: 'exterior', label: 'Exterior finish', per: 'per m²' },
  { k: 'roofing', label: 'Roofing', per: 'per m²' },
  { k: 'landscaping', label: 'Landscaping', per: 'per m²' },
  { k: 'electrical', label: 'Electrical', per: 'per m² built' },
  { k: 'plumbing', label: 'Plumbing', per: 'per m² built' },
  { k: 'door', label: 'Door', per: 'each' },
  { k: 'window', label: 'Window', per: 'each' },
  { k: 'kitchen', label: 'Kitchen', per: 'each' },
  { k: 'bathroom', label: 'Bathroom', per: 'each' }
]

/**
 * Cost estimation (§46) and material quantities (§47). The chart follows the dataviz rules:
 * one series in one hue (no legend), bars ≤ 12px with a rounded data end and a 2px gap,
 * values at the tips in text ink, hover tooltips, and the table below as the table view.
 */
export function EstimatePanel() {
  const project = useProject((s) => s.project)
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [showRates, setShowRates] = useState(false)
  const q = useMemo(() => measure(houseOf(project), project.materials), [project.floors, project.site, project.exterior, project.materials]) // eslint-disable-line react-hooks/exhaustive-deps
  const r = project.costRates
  const { lines, total } = estimate(q, r)
  const sorted = [...lines].sort((a, b) => b.amount - a.amount)
  const max = Math.max(1, ...sorted.map((l) => l.amount))
  const perSqft = total / Math.max(1, q.builtArea * 10.764)
  return (
    <>
      <div className="section">
        <div className="section-head">
          <h3>Approximate cost</h3>
        </div>
        <div className="prop">
          <label>Region</label>
          <select className="field" value={r.region} onChange={(e) => commit('Cost region', (d) => void (d.costRates = { ...COST_PRESETS[e.target.value as CostRates['region']] }))}>
            <option value="pakistan">Pakistan (PKR)</option>
            <option value="uae">UAE (AED)</option>
            <option value="uk">United Kingdom (GBP)</option>
            <option value="usa">United States (USD)</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="stat-grid" style={{ marginTop: 8 }}>
          <div className="stat">
            <div className="v">{formatMoney(total, r.currency)}</div>
            <div className="k">Estimated total</div>
          </div>
          <div className="stat">
            <div className="v">{formatMoney(perSqft, r.currency)}</div>
            <div className="k">Per ft² built</div>
          </div>
        </div>
        <p className="faint" style={{ fontSize: 11, marginTop: 8 }}>
          Approximate, for budgeting only. Not a bill of quantities. Local rates vary widely; edit them below.
        </p>
      </div>
      <div className="section">
        <div className="section-head">
          <h3>Cost by category</h3>
          <div className="actions">
            <Seg value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
          </div>
        </div>
        {view === 'chart' ? (
          <div role="img" aria-label="Cost by category, largest first">
            {sorted.map((l) => {
              const pct = (l.amount / max) * 100
              return (
                <div key={l.key} data-tip={`${l.label}: ${formatMoney(l.amount, r.currency)} (${Math.round((l.amount / total) * 100)}% of total), quantity ${l.qty}`} style={{ display: 'grid', gridTemplateColumns: '104px 1fr', alignItems: 'center', gap: 8, padding: '1px 0', cursor: 'default' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 16 }}>
                    <div style={{ width: `${Math.max(0.5, pct * 0.62)}%`, height: 12, background: 'var(--chart-1)', borderRadius: '0 4px 4px 0' }} />
                    <span className="tabular" style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                      {formatMoney(l.amount, r.currency)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <table className="cost-table">
            <tbody>
              {sorted.map((l) => (
                <tr key={l.key}>
                  <td>{l.label}</td>
                  <td className="faint">{l.qty}</td>
                  <td>{formatMoney(l.amount, r.currency)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Total</b>
                </td>
                <td />
                <td>
                  <b>{formatMoney(total, r.currency)}</b>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
      <div className="section">
        <div className="section-head" style={{ cursor: 'pointer' }} onClick={() => setShowRates(!showRates)}>
          <h3>Unit rates ({r.currency})</h3>
          <span className="sub">{showRates ? 'Hide' : 'Edit'}</span>
        </div>
        {showRates && (
          <table className="cost-table">
            <tbody>
              {RATE_LABELS.map((x) => (
                <tr key={x.k}>
                  <td>
                    {x.label} <span className="faint">{x.per}</span>
                  </td>
                  <td>
                    <input
                      className="field"
                      type="number"
                      value={r[x.k] as number}
                      onChange={(e) =>
                        commit('Edit unit rate', (d) => {
                          ;(d.costRates[x.k] as number) = Number(e.target.value) || 0
                          d.costRates.region = 'custom'
                        }, { coalesce: `rate-${x.k}` })
                      }
                    />
                  </td>
                </tr>
              ))}
              <tr>
                <td>Currency</td>
                <td>
                  <input className="field" value={r.currency} onChange={(e) => commit('Currency', (d) => void (d.costRates.currency = e.target.value), { coalesce: 'currency' })} />
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
      <div className="section">
        <div className="section-head">
          <h3>Material quantities</h3>
        </div>
        <table className="cost-table">
          <tbody>
            {materialQuantities(q).map((m) => (
              <tr key={m.item}>
                <td>{m.item}</td>
                <td>
                  <span className="tabular">{m.amount.toLocaleString('en-US')}</span> <span className="faint">{m.unit}</span>
                </td>
              </tr>
            ))}
            <tr>
              <td>Wall area (interior faces)</td>
              <td className="tabular">{Math.round(q.wallArea * 10.764).toLocaleString('en-US')} ft²</td>
            </tr>
            <tr>
              <td>Paint area</td>
              <td className="tabular">{Math.round(q.paintArea * 10.764).toLocaleString('en-US')} ft²</td>
            </tr>
            <tr>
              <td>Roof area</td>
              <td className="tabular">{Math.round(q.roofArea * 10.764).toLocaleString('en-US')} ft²</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
