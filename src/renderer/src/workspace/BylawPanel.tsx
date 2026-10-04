import { useMemo, useState } from 'react'
import { CircleCheck, TriangleAlert, Sparkles } from 'lucide-react'
import { useProject, commit, getProject } from '../state/store'
import { houseOf, applyDesignToProject } from '../app/actions'
import { generateDesignsParallel } from '../ai/designService'
import { useUI } from '../state/ui'
import { AUTHORITIES, bandFor, checkBylaws, marlaOf, setbacksFor } from '../core/bylaws'
import { AuthoritySelect } from '../ui/AuthoritySelect'

/** Building rules (amendment A4): pick the authority, see every limit against this design. */
export function BylawPanel() {
  const project = useProject((s) => s.project)
  const a = project.plot.authority
  const checks = useMemo(
    () => (a ? checkBylaws(houseOf(project), a, { plinth: project.settings.plinthHeight, parapet: project.exterior.parapetHeight }) : []),
    [a, project.floors, project.plot, project.exterior, project.settings.plinthHeight] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const fails = checks.filter((c) => !c.ok).length
  const [busy, setBusy] = useState(false)
  // same requirements, laid out again inside this authority's limits; the best design that passes is applied
  const redesign = async () => {
    if (!a) return
    setBusy(true)
    useUI.getState().set({ busy: 'Redesigning within the rules…' })
    try {
      const p = getProject()
      const { designs, errors } = await generateDesignsParallel(p.requirements, p.plot, p.settings, () => {}, {})
      if (!designs.length) {
        useUI.getState().showError({ what: 'No design fits these rules', why: errors[0]?.why ?? 'The rooms asked for do not fit inside the open spaces this authority requires.', fix: 'Ask for fewer or smaller rooms, or add a floor where the rules allow it.' })
        return
      }
      const failsOf = (d: (typeof designs)[number]) => checkBylaws(d.house, a, { plinth: p.settings.plinthHeight, parapet: d.house.exterior.parapetHeight }).filter((c) => !c.ok).length
      const best = [...designs].sort((x, y) => failsOf(x) - failsOf(y) || y.scores.overall - x.scores.overall)[0]
      commit('Designs within the rules', (d) => void (d.designs = designs as typeof d.designs))
      applyDesignToProject(best)
      const left = failsOf(best)
      useUI.getState().toast({ kind: left ? 'info' : 'success', title: left ? `${best.label}: ${left} rule${left === 1 ? '' : 's'} still to check` : `${best.label}: ${best.name} meets every rule`, body: 'The other designs are in the design list. Undo with Ctrl+Z.' })
    } finally {
      setBusy(false)
      useUI.getState().set({ busy: null })
    }
  }
  return (
    <div className="section">
      <div className="section-head">
        <h3>Building rules</h3>
        {a && <span className="sub">{fails ? `${fails} to fix` : 'all met'}</span>}
      </div>
      <AuthoritySelect
        value={a}
        onChange={(v) =>
          commit(v ? `Rules: ${AUTHORITIES[v].name}` : 'No authority rules', (d) => {
            d.plot.authority = v
            if (v) d.plot.setbacks = setbacksFor(v, d.plot)
          })
        }
      />
      {a ? (
        <>
          <p className="faint" style={{ fontSize: 11, margin: '6px 0 8px' }}>
            {Math.round(marlaOf(project.plot) * 10) / 10} marla plot, {bandFor(a, project.plot).storeys} storeys allowed. From the {AUTHORITIES[a].source}. Rules change: confirm with the authority before submitting a plan. New designs keep these open spaces automatically.
          </p>
          {fails > 0 && (
            <button className="btn primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy} onClick={() => void redesign()}>
              <Sparkles size={14} /> Redesign to meet these rules
            </button>
          )}
          {checks.map((c) => (
            <div key={c.key} className={`issue ${c.ok ? 'info' : 'warning'}`} style={{ cursor: 'default' }}>
              {c.ok ? <CircleCheck /> : <TriangleAlert />}
              <div>
                <div className="m">{c.label}</div>
                <div className="f">
                  {c.actual}, {c.limit}
                </div>
              </div>
            </div>
          ))}
        </>
      ) : (
        <p className="faint" style={{ fontSize: 11, marginTop: 6 }}>
          Choose LDA or DHA Lahore to check open spaces, coverage, storeys and height against their published residential rules.
        </p>
      )}
    </div>
  )
}
