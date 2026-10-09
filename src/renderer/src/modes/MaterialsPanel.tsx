import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, MousePointerClick, Trash2, Copy, Search, CircleCheck, CircleAlert, LoaderCircle } from 'lucide-react'
import { useProject, commit, getProject, undo } from '../state/store'
import { useUI } from '../state/ui'
import type { MaterialCategory, MaterialDef, SurfaceRef } from '../core/model/types'
import { LIBRARY, LIBRARY_CATEGORIES, resolveMaterial } from '../core/materials/library'
import { describeSurface, applySurfaceMaterial, surfaceForSelection, type ApplyScope } from '../planner/surfaces'
import { useMaterialThumb, thumbStyle } from '../render/materialThumb'
import { Modal, Seg, Slider, Switch } from '../ui/primitives'
import { useUpload, uploadMaterialFiles, regenerateMaps } from './materialUpload'
import { getEngine, hasEngine } from '../engine/Engine'
import { assetUrl } from '../state/assets'
import { uid } from '../core/model/ids'
import { formatLength } from '../core/units/units'

/**
 * MATERIALS mode (§13–§16): pick a surface in 3D, choose from the library or upload a photo,
 * confirm, then compare before and after.
 */

type Tab = 'library' | 'mine'

export function MaterialsPanel() {
  const project = useProject((s) => s.project)
  const surfaceUI = useUI((s) => s.surface)
  const sel = useUI((s) => s.selection)
  const surface: SurfaceRef | null = surfaceUI ?? (sel[0] ? surfaceForSelection(project, sel[0]) : null)
  const info = surface ? describeSurface(project, surface) : null
  const [tab, setTab] = useState<Tab>('library')
  const [cat, setCat] = useState<MaterialCategory>('marble')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [scope, setScope] = useState<ApplyScope>('surface')
  const [ask, setAsk] = useState<string | null>(null)
  const [compare, setCompare] = useState<{ before: string; after: string; label: string } | null>(null)
  const confirmId = useUpload((s) => s.confirmId)

  // follow the picked surface: suggest its categories and show its current material
  const surfaceKey = surface ? JSON.stringify(surface) : ''
  useEffect(() => {
    if (!info) return
    if (!info.suggest.includes(cat)) setCat(info.suggest[0])
    setScope(info.scopes[0].value)
    setPicked(info.current ?? info.fallback ?? null)
  }, [surfaceKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // a finished upload asks to be applied
  useEffect(() => {
    if (!confirmId) return
    setTab('mine')
    setPicked(confirmId)
    if (surface) setAsk(confirmId)
    useUpload.getState().set({ confirmId: null })
  }, [confirmId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const f = (e: Event) => {
      setTab('mine')
      setPicked((e as CustomEvent<string>).detail)
    }
    window.addEventListener('hf:material-focus', f)
    return () => window.removeEventListener('hf:material-focus', f)
  }, [])

  const mine = project.materials
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const src = tab === 'library' ? LIBRARY.filter((m) => (q ? true : m.category === cat)) : mine
    return q ? src.filter((m) => m.name.toLowerCase().includes(q) || m.category.includes(q)) : src
  }, [tab, cat, query, mine])
  const pickedDef = resolveMaterial(picked ?? undefined, project.materials)

  const apply = async (id: string) => {
    if (!surface || !info) return
    const def = resolveMaterial(id, getProject().materials)
    const engine = hasEngine() ? getEngine() : null
    const shotSize = () => {
      const c = engine!.canvas
      const w = 1280
      return { width: w, height: Math.round((w * Math.max(1, c.clientHeight)) / Math.max(1, c.clientWidth)), type: 'image/jpeg' as const, quality: 0.9 }
    }
    let before: Blob | null = null
    try {
      if (engine?.container) {
        engine.highlight(null, 'select')
        engine.highlight(null, 'hover')
        // an indoor surface chosen from the panel: compare from inside that room, not from the street
        const roomId = 'roomId' in surface ? surface.roomId : undefined
        if (roomId && !engine.cameraInside()) {
          engine.setCameraPreset('room', roomId, false)
          await frames(2)
          await engine.mats.waitIdle(8000, true)
        }
        before = await engine.snapshot(shotSize())
      }
    } catch {
      before = null
    }
    commit(`Apply ${def?.name ?? 'material'} to ${info.label}`, (d) => applySurfaceMaterial(d, surface, id, scope), { major: false })
    if (!engine?.container || !before) {
      useUI.getState().toast({ kind: 'success', title: `${def?.name ?? 'Material'} applied`, body: info.label })
      return
    }
    useUI.getState().set({ busy: 'Rendering the new material…' })
    try {
      await frames(2)
      await engine.mats.waitIdle(15000, true)
      await frames(2)
      const after = await engine.snapshot(shotSize())
      setCompare({ before: URL.createObjectURL(before), after: URL.createObjectURL(after), label: `${def?.name} on ${info.label}` })
    } finally {
      useUI.getState().set({ busy: null })
      engine.highlight(useUI.getState().surface, 'select')
    }
  }

  return (
    <>
      <div className="panel-scroll">
        <TargetSection info={info} surface={surface} scope={scope} setScope={setScope} />
        <UploadSection />
        <div className="section" style={{ paddingBottom: 6 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <Seg value={tab} onChange={setTab} full options={[{ value: 'library', label: 'Library' }, { value: 'mine', label: `My materials${mine.length ? ` (${mine.length})` : ''}` }]} />
          </div>
          <div className="row" style={{ marginBottom: 10, position: 'relative' }}>
            <Search size={14} className="faint" style={{ position: 'absolute', left: 8 }} />
            <input className="field" style={{ paddingLeft: 28 }} placeholder={tab === 'library' ? 'Search 90+ materials' : 'Search my materials'} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search materials" />
          </div>
          {tab === 'library' && !query && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
              {LIBRARY_CATEGORIES.map((c) => (
                <button key={c.key} className={`chip ${cat === c.key ? 'on' : ''}`} onClick={() => setCat(c.key)}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {list.length ? (
            <div className="mat-grid">
              {list.map((m) => (
                <MatTile key={m.id} m={m} on={picked === m.id} current={info?.current === m.id} onClick={() => setPicked(m.id)} onDoubleClick={() => surface && setAsk(m.id)} />
              ))}
            </div>
          ) : (
            <div className="empty" style={{ padding: '18px 8px' }}>
              <div>{tab === 'mine' ? 'Upload a photo of a tile, marble, wood or wall finish and it appears here as a material.' : 'No materials match that search.'}</div>
            </div>
          )}
        </div>
        {pickedDef && <MaterialDetail def={pickedDef} canApply={!!surface} onApply={() => setAsk(pickedDef.id)} onPick={setPicked} />}
      </div>
      {ask && surface && info && (
        <ConfirmApply
          def={resolveMaterial(ask, project.materials)}
          target={info.label}
          scopeLabel={info.scopes.find((s) => s.value === scope)?.label}
          onYes={() => {
            const id = ask
            setAsk(null)
            void apply(id)
          }}
          onCancel={() => setAsk(null)}
        />
      )}
      {compare && (
        <BeforeAfter
          {...compare}
          onKeep={() => {
            URL.revokeObjectURL(compare.before)
            URL.revokeObjectURL(compare.after)
            setCompare(null)
          }}
          onUndo={() => {
            undo()
            URL.revokeObjectURL(compare.before)
            URL.revokeObjectURL(compare.after)
            setCompare(null)
          }}
        />
      )}
    </>
  )
}

const frames = (n: number) => new Promise<void>((res) => {
  const step = (k: number) => (k <= 0 ? res() : requestAnimationFrame(() => step(k - 1)))
  step(n)
})

/* ── target ──────────────────────────────────────────────────────────────── */

function TargetSection(props: { info: ReturnType<typeof describeSurface>; surface: SurfaceRef | null; scope: ApplyScope; setScope: (s: ApplyScope) => void }) {
  const project = useProject((s) => s.project)
  const { info } = props
  const cur = resolveMaterial(info?.current ?? info?.fallback, project.materials)
  const url = useMaterialThumb(cur)
  if (!info)
    return (
      <div className="section">
        <div className="section-head">
          <h3>Materials</h3>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <MousePointerClick size={18} className="faint" style={{ flex: 'none', marginTop: 2 }} />
          <p className="muted" style={{ margin: 0 }}>
            Click a floor, wall, ceiling, stair, counter or outdoor surface in the 3D view. Its finish shows here and you can replace it.
          </p>
        </div>
      </div>
    )
  return (
    <div className="section">
      <div className="section-head">
        <h3>{info.label}</h3>
        <span className="sub">{info.detail}</span>
      </div>
      <div className="row" style={{ gap: 10, marginBottom: info.scopes.length > 1 ? 10 : 0 }}>
        <span className="swatch" style={{ width: 34, height: 34, ...thumbStyle(cur, url) }} />
        <div className="grow">
          <div>{cur?.name ?? 'Default finish'}</div>
          <div className="faint" style={{ fontSize: 11 }}>
            Current finish
          </div>
        </div>
      </div>
      {info.scopes.length > 1 && (
        <div className="prop">
          <label>Apply to</label>
          <select className="field" value={props.scope} onChange={(e) => props.setScope(e.target.value as ApplyScope)}>
            {info.scopes.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

/* ── upload ──────────────────────────────────────────────────────────────── */

function UploadSection() {
  const jobs = useUpload((s) => s.jobs)
  const seamless = useUpload((s) => s.seamless)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const stageLabel = { reading: 'Reading photo', analyzing: 'Analysing texture', maps: 'Generating PBR maps', done: 'Added', error: 'Not added' } as const
  return (
    <div className="section">
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOver(false)
          void uploadMaterialFiles([...e.dataTransfer.files])
        }}
      >
        <Upload size={18} style={{ marginBottom: 4 }} />
        <div style={{ color: 'var(--text)' }}>Upload a material photo</div>
        <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>
          Tile, marble, wood, stone or wallpaper. JPG or PNG.
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/bmp" multiple hidden onChange={(e) => {
            const f = [...(e.target.files ?? [])]
            e.target.value = ''
            if (f.length) void uploadMaterialFiles(f)
          }} />
      </div>
      <label className="row faint" style={{ fontSize: 12, marginTop: 8, gap: 8 }}>
        <Switch on={seamless} onChange={(v) => useUpload.getState().set({ seamless: v })} label="Make seamless" /> Make the texture seamless (hides repeat lines)
      </label>
      {jobs.length > 0 && (
        <div className="list" style={{ marginTop: 8 }}>
          {jobs.slice(0, 4).map((j) => (
            <div key={j.id} className="list-item" style={{ cursor: j.materialId ? 'pointer' : 'default' }} onClick={() => j.materialId && window.dispatchEvent(new CustomEvent('hf:material-focus', { detail: j.materialId }))}>
              {j.preview ? <span className="swatch" style={{ backgroundImage: `url("${j.preview}")` }} /> : <span className="swatch" />}
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.name}</div>
                <div className="faint" style={{ fontSize: 11 }}>
                  {j.error ?? stageLabel[j.stage]}
                </div>
              </div>
              {j.stage === 'done' ? <CircleCheck size={15} style={{ color: 'var(--ok)' }} /> : j.stage === 'error' ? <CircleAlert size={15} style={{ color: 'var(--danger)' }} /> : <LoaderCircle size={15} className="spin" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── grid tile ───────────────────────────────────────────────────────────── */

function MatTile(props: { m: MaterialDef; on: boolean; current: boolean; onClick: () => void; onDoubleClick: () => void }) {
  const url = useMaterialThumb(props.m)
  return (
    <button className={`mat ${props.on ? 'on' : ''}`} onClick={props.onClick} onDoubleClick={props.onDoubleClick} data-tip={props.current ? `${props.m.name} (current)` : props.m.name} aria-pressed={props.on}>
      <div className="img" style={thumbStyle(props.m, url)} />
      <div className="n">
        {props.current && <span style={{ color: 'var(--tape)' }}>● </span>}
        {props.m.name}
      </div>
    </button>
  )
}

/* ── detail + adjustments ────────────────────────────────────────────────── */

const pct = (v: number) => `${Math.round(v * 100)}%`

function MaterialDetail(props: { def: MaterialDef; canApply: boolean; onApply: () => void; onPick: (id: string) => void }) {
  const { def } = props
  const units = useProject((s) => s.project.settings.units)
  const editable = def.source !== 'library'
  const a = def.analysis
  const url = useMaterialThumb(def)
  const setProp = <K extends keyof MaterialDef>(k: K, v: MaterialDef[K], label: string) =>
    commit(label, (d) => {
      const m = d.materials.find((x) => x.id === def.id)
      if (m) (m as MaterialDef)[k] = v
    }, { coalesce: `mat-${def.id}-${String(k)}` })
  const customize = () => {
    const copy: MaterialDef = { ...structuredClone(def), id: `cus:${uid('mat')}`, source: 'custom', name: `${def.name} (custom)` }
    commit(`Customise ${def.name}`, (d) => void d.materials.push(copy))
    props.onPick(copy.id)
  }
  return (
    <div className="section">
      <div className="section-head">
        <h3>{def.name}</h3>
        <span className="sub">{LIBRARY_CATEGORIES.find((c) => c.key === def.category)?.label ?? def.category}</span>
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'stretch', marginBottom: 12 }}>
        <div className="swatch" style={{ width: 84, height: 84, borderRadius: 5, ...thumbStyle(def, url) }} />
        <div className="grow col" style={{ gap: 6, justifyContent: 'center' }}>
          <button className="btn primary" disabled={!props.canApply} onClick={props.onApply} data-tip={props.canApply ? undefined : 'Click a surface in the 3D view first'}>
            Apply to selected surface
          </button>
          {editable ? (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm grow" onClick={customize}>
                <Copy size={13} /> Duplicate
              </button>
              <button className="btn sm" aria-label="Delete material" data-tip="Delete material" onClick={() => deleteMaterial(def)}>
                <Trash2 size={13} />
              </button>
            </div>
          ) : (
            <button className="btn sm" onClick={customize}>
              Customise a copy
            </button>
          )}
        </div>
      </div>
      {a && <AnalysisCard def={def} />}
      {editable && (
        <>
          <div className="section-title" style={{ margin: '12px 0 8px' }}>
            Adjust
          </div>
          <Adjust label="Scale" value={def.scale} min={0.1} max={6} step={0.05} fmt={(v) => formatLength(v, units)} onCommit={(v) => setProp('scale', v, 'Material scale')} tip="Real-world size of one texture repeat" />
          <Adjust label="Rotation" value={def.rotation} min={0} max={180} step={5} fmt={(v) => `${Math.round(v)}°`} onCommit={(v) => setProp('rotation', v, 'Material rotation')} />
          <Adjust label="Offset X" value={def.offset.x} min={0} max={1} step={0.01} fmt={pct} onCommit={(v) => setProp('offset', { ...def.offset, x: v }, 'Material offset')} />
          <Adjust label="Offset Y" value={def.offset.y} min={0} max={1} step={0.01} fmt={pct} onCommit={(v) => setProp('offset', { ...def.offset, y: v }, 'Material offset')} />
          <Adjust label="Roughness" value={def.roughness} min={0.02} max={1} step={0.01} fmt={pct} onCommit={(v) => setProp('roughness', v, 'Material roughness')} />
          <Adjust label="Reflection" value={def.reflection} min={0} max={1} step={0.01} fmt={pct} onCommit={(v) => setProp('reflection', v, 'Material reflection')} />
          <Adjust label="Brightness" value={def.brightness} min={-0.5} max={0.5} step={0.01} fmt={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`} onCommit={(v) => setProp('brightness', v, 'Material brightness')} />
          <Adjust label="Contrast" value={def.contrast} min={-0.5} max={0.5} step={0.01} fmt={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`} onCommit={(v) => setProp('contrast', v, 'Material contrast')} />
          <Adjust label="Relief" value={def.normalStrength} min={0} max={2} step={0.05} fmt={pct} onCommit={(v) => setProp('normalStrength', v, 'Material relief')} tip="Strength of the normal map" />
          {def.procedural && def.category === 'paint' && (
            <div className="prop">
              <label>Colour</label>
              <input type="color" value={def.procedural.colors[0]} onChange={(e) => commit('Paint colour', (d) => {
                  const m = d.materials.find((x) => x.id === def.id)
                  if (m?.procedural) m.procedural.colors = [e.target.value, ...m.procedural.colors.slice(1)]
                }, { coalesce: `mat-${def.id}-color` })} />
            </div>
          )}
          <div className="prop">
            <label>Name</label>
            <input className="field" value={def.name} onChange={(e) => setProp('name', e.target.value, 'Rename material')} />
          </div>
        </>
      )}
    </div>
  )
}

function deleteMaterial(def: MaterialDef) {
  const p = getProject()
  const used = JSON.stringify({ f: p.floors, s: p.site, e: p.exterior, pl: p.plot }).includes(`"${def.id}"`)
  commit(`Delete material "${def.name}"`, (d) => {
    d.materials = d.materials.filter((m) => m.id !== def.id)
    if (!used) return
    // surfaces that wore it fall back to their design defaults
    const clear = (o: unknown) => {
      if (!o || typeof o !== 'object') return
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (v === def.id) delete (o as Record<string, unknown>)[k]
        else if (typeof v === 'object') clear(v)
      }
    }
    clear(d.floors)
    clear(d.site)
    if (d.exterior.facadeMaterial === def.id) d.exterior.facadeMaterial = 'lib:render-white'
    if (d.exterior.accentMaterial === def.id) d.exterior.accentMaterial = 'lib:stone-ledgestone'
    if (d.exterior.plinthMaterial === def.id) d.exterior.plinthMaterial = 'lib:stone-slate'
    if (d.exterior.roofMaterial === def.id) d.exterior.roofMaterial = 'lib:roof-membrane'
    if (d.exterior.windowFrameMaterial === def.id) d.exterior.windowFrameMaterial = 'lib:metal-black'
    if (d.plot.boundaryWall.material === def.id) d.plot.boundaryWall.material = undefined
  })
  useUI.getState().toast({ kind: 'info', title: `Deleted "${def.name}"`, body: used ? 'Surfaces that used it went back to their default finish.' : undefined, action: { label: 'Undo', run: () => undo() } })
}

function Adjust(props: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onCommit: (v: number) => void; tip?: string }) {
  const [v, setV] = useState(props.value)
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => setV(props.value), [props.value])
  return (
    <div className="prop" data-tip={props.tip}>
      <label>{props.label}</label>
      <div className="row grow" style={{ gap: 8 }}>
        <Slider
          value={v}
          min={props.min}
          max={props.max}
          step={props.step}
          label={props.label}
          onChange={(x) => {
            setV(x)
            clearTimeout(t.current)
            t.current = setTimeout(() => props.onCommit(x), 220)
          }}
        />
        <span className="tabular faint" style={{ width: 52, textAlign: 'right', fontSize: 12 }}>
          {props.fmt(v)}
        </span>
      </div>
    </div>
  )
}

function AnalysisCard({ def }: { def: MaterialDef }) {
  const a = def.analysis!
  const [seamless, setSeamless] = useState(true)
  const maps: { k: string; id?: string }[] = [
    { k: 'Colour', id: def.assetId },
    { k: 'Normal', id: def.maps?.normal },
    { k: 'Roughness', id: def.maps?.roughness },
    { k: 'Height', id: def.maps?.height }
  ]
  const units = useProject((s) => s.project.settings.units)
  return (
    <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line-soft)', borderRadius: 6, padding: 10 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <b>Detected {LIBRARY_CATEGORIES.find((c) => c.key === a.textureType)?.label.toLowerCase() ?? a.textureType}</b>
        <div className="grow" />
        <span className="badge" data-tip="How sure the analysis is">
          {Math.round(a.confidence * 100)}% sure
        </span>
      </div>
      <dl className="kv" style={{ marginBottom: 8 }}>
        <dt>Pattern</dt>
        <dd>{a.pattern === 'none' ? 'No repeating pattern' : a.pattern}</dd>
        {a.tileSize && (
          <>
            <dt>Unit size</dt>
            <dd>About {formatLength(a.tileSize, units)}</dd>
          </>
        )}
        <dt>Scale</dt>
        <dd>{formatLength(a.scale, units)} per repeat</dd>
        <dt>Roughness</dt>
        <dd>{pct(a.roughness)}</dd>
        <dt>Reflectivity</dt>
        <dd>{pct(a.reflectivity)}</dd>
        <dt>Colours</dt>
        <dd className="row" style={{ gap: 4 }}>
          {a.dominantColors.map((c) => (
            <span key={c} className="swatch" style={{ width: 14, height: 14, background: c }} data-tip={c} />
          ))}
        </dd>
      </dl>
      {a.notes.length > 0 && (
        <ul className="muted" style={{ margin: '0 0 8px', paddingLeft: 16, fontSize: 12 }}>
          {a.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {maps.map((m) => (
          <div key={m.k}>
            <div className="swatch" style={{ width: '100%', height: 'auto', aspectRatio: '1', backgroundImage: m.id ? `url("${assetUrl(m.id)}")` : undefined }} />
            <div className="faint" style={{ fontSize: 10, marginTop: 3, textAlign: 'center' }}>
              {m.k}
            </div>
          </div>
        ))}
      </div>
      {def.originalAssetId && (
        <label className="row faint" style={{ fontSize: 12, marginTop: 8, gap: 8 }}>
          <Switch on={seamless} onChange={(v) => {
              setSeamless(v)
              void regenerateMaps(def.id, v)
            }} label="Seamless" /> Seamless tiling
        </label>
      )}
    </div>
  )
}

/* ── confirm + before/after ──────────────────────────────────────────────── */

function ConfirmApply(props: { def?: MaterialDef; target: string; scopeLabel?: string; onYes: () => void; onCancel: () => void }) {
  const url = useMaterialThumb(props.def)
  return (
    <Modal
      title="Apply this material to the selected surface?"
      onClose={props.onCancel}
      footer={
        <>
          <button className="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button className="btn primary" autoFocus onClick={props.onYes}>
            Yes, apply
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 14 }}>
        <div className="swatch" style={{ width: 72, height: 72, borderRadius: 6, ...thumbStyle(props.def, url) }} />
        <dl className="kv grow">
          <dt>Material</dt>
          <dd>{props.def?.name}</dd>
          <dt>Surface</dt>
          <dd>{props.target}</dd>
          {props.scopeLabel && (
            <>
              <dt>Applies to</dt>
              <dd>{props.scopeLabel}</dd>
            </>
          )}
        </dl>
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>
        You will see a before and after comparison. Undo is always one click away.
      </p>
    </Modal>
  )
}

export function BeforeAfter(props: { before: string; after: string; label: string; onKeep: () => void; onUndo: () => void }) {
  const [split, setSplit] = useState(50)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef(false)
  const move = (x: number) => {
    const r = box.current!.getBoundingClientRect()
    setSplit(Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100)))
  }
  return (
    <Modal
      title="Before and after"
      subtitle={props.label}
      size="wide"
      onClose={props.onKeep}
      footer={
        <>
          <button className="btn" onClick={props.onUndo}>
            Undo change
          </button>
          <button className="btn primary" autoFocus onClick={props.onKeep}>
            Keep new material
          </button>
        </>
      }
    >
      <div
        ref={box}
        className="compare-slider"
        style={{ ['--split' as string]: `${split}%` }}
        onPointerDown={(e) => {
          drag.current = true
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          move(e.clientX)
        }}
        onPointerMove={(e) => drag.current && move(e.clientX)}
        onPointerUp={() => (drag.current = false)}
        role="slider"
        aria-label="Comparison position"
        aria-valuenow={Math.round(split)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setSplit((s) => Math.max(0, s - 5))
          if (e.key === 'ArrowRight') setSplit((s) => Math.min(100, s + 5))
        }}
      >
        <img src={props.before} alt="Before" draggable={false} />
        <img src={props.after} alt="After" className="after" draggable={false} />
        <div className="handle" />
        <span className="lbl" style={{ left: 10 }}>
          Before
        </span>
        <span className="lbl" style={{ right: 10 }}>
          After
        </span>
      </div>
    </Modal>
  )
}
