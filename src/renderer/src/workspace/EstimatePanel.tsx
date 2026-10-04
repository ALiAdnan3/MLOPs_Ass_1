import { useMemo, useState } from 'react'
import { useProject, commit } from '../state/store'
import { COST_PRESETS } from '../core/model/defaults'
import { measure, estimate, materialQuantities, formatMoney } from '../planner/estimate'
import { houseOf } from '../app/actions'
import type { CostRates } from '../core/model/types'
import { Seg } from '../ui/primitives'
import { PANEL, countSolarPanels, layoutSolar, placeSolarPanels, removeSolarPanels, solarEconomics, specificYield } from '../planner/solar'
import { plotLocation } from '../core/location'
import { uid } from '../core/model/ids'

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
  const { lines, total, grey, finishing } = estimate(q, r)
  const sorted = [...lines].sort((a, b) => (a.phase === b.phase ? b.amount - a.amount : a.phase === 'grey' ? -1 : 1))
  const max = Math.max(1, ...sorted.map((l) => l.amount))
  const ft2 = Math.max(1, q.builtArea * 10.764)
  const perSqft = total / ft2
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
          <div className="stat" data-tip="Frame, brickwork, slabs, roof, wiring and pipes">
            <div className="v">{formatMoney(grey, r.currency)}</div>
            <div className="k">Grey structure, {formatMoney(grey / ft2, r.currency)}/ft²</div>
          </div>
          <div className="stat" data-tip="Floors, marble, doors, windows, kitchen, bathrooms, paint, facade, garden">
            <div className="v">{formatMoney(finishing, r.currency)}</div>
            <div className="k">Finishing, {formatMoney(finishing / ft2, r.currency)}/ft²</div>
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
            {sorted.map((l, i) => {
              const pct = (l.amount / max) * 100
              const head = i === 0 || sorted[i - 1].phase !== l.phase
              return (
                <div key={l.key}>
                {head && <div className="faint" style={{ fontSize: 11, margin: i ? '8px 0 3px' : '0 0 3px' }}>{l.phase === 'grey' ? 'Grey structure' : 'Finishing'}</div>}
                <div data-tip={`${l.label}: ${formatMoney(l.amount, r.currency)} (${Math.round((l.amount / total) * 100)}% of total), quantity ${l.qty}`} style={{ display: 'grid', gridTemplateColumns: '104px 1fr', alignItems: 'center', gap: 8, padding: '1px 0', cursor: 'default' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 16 }}>
                    <div style={{ width: `${Math.max(0.5, pct * 0.62)}%`, height: 12, background: 'var(--chart-1)', borderRadius: '0 4px 4px 0' }} />
                    <span className="tabular" style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                      {formatMoney(l.amount, r.currency)}
                    </span>
                  </div>
                </div>
                </div>
              )
            })}
          </div>
        ) : (
          <table className="cost-table">
            <tbody>
              {sorted.map((l, i) => (
                <tr key={l.key}>
                  <td>
                    {(i === 0 || sorted[i - 1].phase !== l.phase) && <div className="faint" style={{ fontSize: 10.5 }}>{l.phase === 'grey' ? 'Grey structure' : 'Finishing'}</div>}
                    {l.label}
                  </td>
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
      <SolarSection />
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

const SIZES = [3, 5, 10, 15]

/** Rooftop solar planner (amendment A2): what the roof fits, what a system gives back. */
function SolarSection() {
  const project = useProject((s) => s.project)
  const h = houseOf(project)
  const fit = useMemo(() => layoutSolar(h, { moveSoft: true }), [project.floors, project.plot]) // eslint-disable-line react-hooks/exhaustive-deps
  const n = countSolarPanels(h)
  const r = project.costRates
  const lat = plotLocation(project.plot).lat
  const kwp = (n * PANEL.watt) / 1000
  const eco = solarEconomics({ ...fit, kwp, yearlyKwh: kwp * specificYield(lat) }, r)
  const place = (panels: number, label: string) => commit(label, (d) => void placeSolarPanels(d as never, uid, panels))
  const money = (v: number) => formatMoney(v, r.currency)
  return (
    <div className="section">
      <div className="section-head">
        <h3>Rooftop solar</h3>
        <span className="sub">
          roof fits {fit.panels.length} panels ({fit.kwp.toFixed(1)} kWp)
        </span>
      </div>
      {fit.floorId === null ? (
        <p className="faint" style={{ fontSize: 12 }}>
          This house has no roof level yet. Add a roof in the plan to place panels.
        </p>
      ) : (
        <>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {SIZES.map((kw) => {
              const p = Math.ceil((kw * 1000) / PANEL.watt)
              return (
                <button key={kw} className="btn sm" disabled={p > fit.panels.length} data-tip={p > fit.panels.length ? 'The roof is too small for this size' : `${p} panels of ${PANEL.watt} W`} onClick={() => place(p, `Solar: ${kw} kW`)}>
                  {kw} kW
                </button>
              )
            })}
            <button className="btn sm" disabled={!fit.panels.length} onClick={() => place(Infinity, 'Solar: fill the roof')}>
              Fill roof
            </button>
            {n > 0 && (
              <button className="btn sm ghost" onClick={() => commit('Remove solar panels', (d) => removeSolarPanels(d as never))}>
                Remove
              </button>
            )}
          </div>
          <div className="stat-grid">
            <div className="stat">
              <div className="v">{kwp.toFixed(1)} kWp</div>
              <div className="k">{n} panels on the roof</div>
            </div>
            <div className="stat">
              <div className="v">{Math.round(eco.monthlyKwh).toLocaleString('en-US')} units</div>
              <div className="k">per month, on average</div>
            </div>
            <div className="stat">
              <div className="v">{money(eco.saving)}</div>
              <div className="k">saved per year</div>
            </div>
            <div className="stat">
              <div className="v">{n ? `${eco.payback.toFixed(1)} years` : '-'}</div>
              <div className="k">payback on {money(eco.cost)}</div>
            </div>
          </div>
          <table className="cost-table" style={{ marginTop: 8 }}>
            <tbody>
              <tr>
                <td>
                  Installed cost <span className="faint">per kWp</span>
                </td>
                <td>
                  <input className="field" type="number" value={eco.perKw} onChange={(e) => commit('Solar cost per kW', (d) => void (d.costRates.solarPerKw = Number(e.target.value) || 0), { coalesce: 'solar-kw' })} />
                </td>
              </tr>
              <tr>
                <td>
                  Grid price <span className="faint">per unit (kWh)</span>
                </td>
                <td>
                  <input className="field" type="number" value={eco.tariff} onChange={(e) => commit('Grid tariff', (d) => void (d.costRates.tariffPerKwh = Number(e.target.value) || 0), { coalesce: 'tariff' })} />
                </td>
              </tr>
            </tbody>
          </table>
          <p className="faint" style={{ fontSize: 11, marginTop: 6 }}>
            {PANEL.watt} W panels tilted {Math.round(fit.tilt)}° towards the {lat >= 0 ? 'south' : 'north'}, rows {fit.rowPitch.toFixed(1)} m apart so they do not shade each other in winter. About {specificYield(lat).toLocaleString('en-US')} units per kWp a year here. Assumes every unit replaces one bought from the grid; net-metering rules change, so check with an installer.
          </p>
        </>
      )}
    </div>
  )
}
