import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X, Play, Pause, FileDown } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { useProject, getProject } from '../state/store'
import { useUI } from '../state/ui'
import type { MaterialDef, Project } from '../core/model/types'
import { renderHouseImage } from '../render/houseImage'
import { renderPlanToCanvas } from '../render/planImage'
import { sortedFloors, floorElevations } from '../core/model/house'
import { areaSummary, designStats } from '../planner/metrics'
import { formatAreaFor, formatPlotSize } from '../core/units/units'
import { spec } from '../core/constraints/rooms'
import { bbox, area } from '../core/geometry/polygon'
import { resolveMaterial } from '../core/materials/library'
import { materialThumb } from '../render/materialThumb'
import { DISCLAIMER } from '../core/model/defaults'
import { asciiText } from '../export/contexts'
import { slugify } from '../export/drawingsExport'
import { platform } from '../storage/platform'

/**
 * PRESENTATION MODE (§49): a client-ready slideshow built from the model — cover facts,
 * exterior renders, floor plans, 3D views, interior views and the materials palette —
 * exportable as a PDF.
 */

type Slide =
  | { kind: 'cover'; key: string; title: string }
  | { kind: 'render'; key: string; title: string; view?: 'aerial' | 'street' | 'rear' | 'top'; pose?: { position: [number, number, number]; target: [number, number, number]; fov?: number }; night?: boolean; floorId?: string }
  | { kind: 'plan'; key: string; title: string; floorId: string }
  | { kind: 'materials'; key: string; title: string }

const W = 1600
const H = 900

function buildSlides(p: Project): Slide[] {
  const slides: Slide[] = [{ kind: 'cover', key: 'cover', title: p.name }]
  slides.push({ kind: 'render', key: 'aerial', title: 'Exterior', view: 'aerial' })
  slides.push({ kind: 'render', key: 'night', title: 'Exterior at night', view: 'street', night: true })
  for (const f of sortedFloors(p.floors).filter((x) => x.kind !== 'roof' && x.rooms.length)) slides.push({ kind: 'plan', key: `plan-${f.id}`, title: `${f.name} floor plan`, floorId: f.id })
  slides.push({ kind: 'render', key: 'top', title: '3D view from above', view: 'top' })
  slides.push({ kind: 'render', key: 'rear', title: 'Rear view', view: 'rear' })
  for (const c of p.cameras.slice(0, 4)) slides.push({ kind: 'render', key: `cam-${c.id}`, title: c.name, pose: { position: c.position, target: c.target, fov: c.fov } })
  // interior views of the main rooms
  const el = floorElevations(p.floors, p.settings.plinthHeight)
  const wanted = ['tv_lounge', 'drawing', 'master_bedroom', 'kitchen', 'dining', 'family', 'living']
  const rooms = p.floors
    .flatMap((f) => f.rooms.map((r) => ({ f, r })))
    .filter(({ r }) => wanted.includes(r.type))
    .sort((a, b) => wanted.indexOf(a.r.type) - wanted.indexOf(b.r.type) || area(b.r.polygon) - area(a.r.polygon))
  const seen = new Set<string>()
  for (const { f, r } of rooms) {
    if (seen.has(r.type) || seen.size >= 3) continue
    seen.add(r.type)
    const b = bbox(r.polygon)
    const y = (el.get(f.id) ?? 0) + 1.55
    slides.push({ kind: 'render', key: `int-${r.id}`, title: r.name, floorId: f.id, pose: { position: [b.x + Math.min(0.5, b.w * 0.12), y, b.y + Math.min(0.5, b.h * 0.12)], target: [b.x + b.w * 0.85, y - 0.25, b.y + b.h * 0.85], fov: 68 } })
  }
  slides.push({ kind: 'materials', key: 'materials', title: 'Materials' })
  return slides
}

function nightProject(p: Project): Project {
  return { ...p, settings: { ...p.settings, lighting: { ...p.settings.lighting, preset: 'night', time: 20.5, interiorLights: true, exteriorLights: true } } }
}

export function Presentation() {
  const project = useProject((s) => s.project)
  const revision = useProject((s) => s.revision)
  const slides = useMemo(() => buildSlides(project), [project])
  const [i, setI] = useState(0)
  const [images, setImages] = useState<Record<string, string>>({})
  const [playing, setPlaying] = useState(false)
  const cache = useRef<{ rev: number; imgs: Record<string, string> }>({ rev: -1, imgs: {} })

  // render slides in order (the engine queue keeps them sequential)
  useEffect(() => {
    let live = true
    if (cache.current.rev !== revision) {
      for (const u of Object.values(cache.current.imgs)) if (u.startsWith('blob:')) URL.revokeObjectURL(u)
      cache.current = { rev: revision, imgs: {} }
      setImages({})
    }
    const p = getProject()
    const order = [...slides.slice(i), ...slides.slice(0, i)]
    ;(async () => {
      for (const s of order) {
        if (!live) return
        if (cache.current.imgs[s.key] || s.kind === 'materials') continue
        let url = ''
        try {
          if (s.kind === 'cover') url = await renderHouseImage(p, { width: 1200, height: 900, view: 'street' })
          else if (s.kind === 'render') url = await renderHouseImage(s.night ? nightProject(p) : p, { width: W, height: H, view: s.view, pose: s.pose, floorId: s.floorId })
          else if (s.kind === 'plan') {
            const f = p.floors.find((x) => x.id === s.floorId)!
            const c = renderPlanToCanvas(p, f, W, H, { theme: 'light', site: f.level === 0, dpr: 1.5, pad: 0.05 })
            url = c.toDataURL('image/png')
          }
        } catch (e) {
          console.error('slide render failed', e)
        }
        if (!url) continue
        cache.current.imgs[s.key] = url
        if (live) setImages({ ...cache.current.imgs })
      }
    })()
    return () => {
      live = false
    }
  }, [slides, revision]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') setI((x) => Math.min(slides.length - 1, x + 1))
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setI((x) => Math.max(0, x - 1))
      else if (e.key === 'Escape') useUI.getState().set({ mode: '3d' })
      else if (e.key === 'Home') setI(0)
      else if (e.key === 'End') setI(slides.length - 1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [slides.length])
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setI((x) => (x + 1) % slides.length), 5000)
    return () => clearInterval(t)
  }, [playing, slides.length])

  const s = slides[Math.min(i, slides.length - 1)]
  return (
    <div className="present" role="region" aria-label="Presentation">
      <div className="slide">
        {s.kind === 'cover' ? <Cover project={project} img={images[s.key]} /> : s.kind === 'materials' ? <Materials project={project} /> : <SlideImage url={images[s.key]} title={s.title} plan={s.kind === 'plan'} />}
      </div>
      <div className="present-foot">
        <button className="icon-btn" aria-label="Previous slide" onClick={() => setI((x) => Math.max(0, x - 1))}>
          <ChevronLeft />
        </button>
        <span className="tabular" style={{ minWidth: 60, textAlign: 'center' }}>
          {i + 1} / {slides.length}
        </span>
        <button className="icon-btn" aria-label="Next slide" onClick={() => setI((x) => Math.min(slides.length - 1, x + 1))}>
          <ChevronRight />
        </button>
        <button className="icon-btn" aria-label={playing ? 'Pause' : 'Play slideshow'} onClick={() => setPlaying((v) => !v)}>
          {playing ? <Pause /> : <Play />}
        </button>
        <div className="row" style={{ gap: 4, marginLeft: 12, overflow: 'hidden' }}>
          {slides.map((x, k) => (
            <button key={x.key} aria-label={x.title} data-tip={x.title} onClick={() => setI(k)} style={{ width: 22, height: 4, borderRadius: 2, border: 'none', padding: 0, background: k === i ? '#f0b823' : '#3a3f45', cursor: 'pointer' }} />
          ))}
        </div>
        <div className="grow" />
        <span style={{ color: '#8d949b', fontSize: 12, marginRight: 10 }}>{s.title}</span>
        <button className="btn sm" onClick={() => void exportPresentationPdf(slides, cache.current.imgs)}>
          <FileDown size={13} /> Export PDF
        </button>
        <button className="icon-btn" aria-label="Exit presentation" data-tip="Exit (Esc)" onClick={() => useUI.getState().set({ mode: '3d' })}>
          <X />
        </button>
      </div>
    </div>
  )
}

function SlideImage({ url, title, plan }: { url?: string; title: string; plan: boolean }) {
  return (
    <>
      {url ? (
        <img src={url} alt={title} style={{ background: plan ? '#fff' : undefined }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#8d949b' }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="spinner" /> Rendering {title.toLowerCase()}…
          </div>
        </div>
      )}
      <div className="slide-title" style={{ color: plan ? '#1b1f24' : '#fff', textShadow: plan ? 'none' : '0 1px 12px rgba(0,0,0,0.5)' }}>
        {title}
      </div>
    </>
  )
}

function facts(p: Project) {
  const h = { plot: p.plot, floors: p.floors, site: p.site, exterior: p.exterior }
  const a = areaSummary(h)
  const st = designStats(h)
  const u = p.settings.units
  const style = p.exterior.style.replace('_', ' ')
  return [
    ['Plot size', `${formatPlotSize(p.plot.width, p.plot.depth, u)} (${formatAreaFor(a.plotArea, u)})`],
    ['Covered area', formatAreaFor(a.coveredArea, u)],
    ['Total floor area', formatAreaFor(a.totalFloorArea, u)],
    ['Floors', String(st.floors)],
    ['Bedrooms', String(st.bedrooms)],
    ['Bathrooms', String(st.bathrooms)],
    ['Parking', `${st.parking} car${st.parking === 1 ? '' : 's'}`],
    ['Design style', style[0].toUpperCase() + style.slice(1)]
  ] as const
}

function Cover({ project, img }: { project: Project; img?: string }) {
  return (
    <div className="cover">
      {img ? <img src={img} alt="Street view of the house" /> : <div style={{ display: 'grid', placeItems: 'center', color: '#8d949b' }}>Rendering…</div>}
      <div className="facts">
        <h1>{project.name}</h1>
        <dl>
          {facts(project).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p style={{ color: '#6e767f', fontSize: 11, lineHeight: 1.5, margin: 0 }}>{DISCLAIMER}</p>
      </div>
    </div>
  )
}

function usedMaterials(p: Project): { m: MaterialDef; where: string[] }[] {
  const map = new Map<string, Set<string>>()
  const add = (id: string | undefined, where: string) => {
    if (!id) return
    if (!map.has(id)) map.set(id, new Set())
    map.get(id)!.add(where)
  }
  add(p.exterior.facadeMaterial, 'Facade')
  if (p.exterior.accent !== 'none') add(p.exterior.accentMaterial, 'Cladding')
  add(p.exterior.plinthMaterial, 'Plinth')
  if (p.exterior.roofType !== 'flat') add(p.exterior.roofMaterial, 'Roof')
  for (const f of p.floors)
    for (const r of f.rooms) {
      if (r.type === 'void') continue
      const sp = spec(r.type)
      add(r.floorMaterial ?? sp.floorFinish, `${r.name} floor`)
      if (r.wallMaterial) add(r.wallMaterial, `${r.name} walls`)
    }
  for (const f of p.floors) for (const s of f.stairs) add(s.material ?? 'lib:marble-botticino', 'Stairs')
  return [...map.entries()]
    .map(([id, w]) => ({ m: resolveMaterial(id, p.materials)!, where: [...w] }))
    .filter((x) => x.m)
    .sort((a, b) => b.where.length - a.where.length)
    .slice(0, 12)
}

function Materials({ project }: { project: Project }) {
  const list = usedMaterials(project)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  useEffect(() => {
    let live = true
    for (const { m } of list) materialThumb(m, 192).then((u) => live && setThumbs((t) => ({ ...t, [m.id]: u })))
    return () => {
      live = false
    }
  }, [project.materials, project.floors, project.exterior]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '96px 64px 40px', overflow: 'auto' }}>
      <div className="slide-title">Materials</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 22 }}>
        {list.map(({ m, where }) => (
          <div key={m.id}>
            <div style={{ aspectRatio: '1', borderRadius: 6, backgroundColor: '#2a2e33', backgroundImage: thumbs[m.id] ? `url("${thumbs[m.id]}")` : undefined, backgroundSize: 'cover' }} />
            <div style={{ marginTop: 8, fontWeight: 600 }}>{m.name}</div>
            <div style={{ color: '#8d949b', fontSize: 12 }}>{where.slice(0, 3).join(', ') + (where.length > 3 ? ` and ${where.length - 3} more` : '')}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

async function exportPresentationPdf(slides: Slide[], imgs: Record<string, string>) {
  const ui = useUI.getState()
  const p = getProject()
  ui.set({ busy: 'Building the presentation PDF…' })
  try {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [338.7, 190.5] })
    const PW = 338.7
    const PH = 190.5
    const toData = async (u: string) => {
      if (u.startsWith('data:')) return u
      const b = await (await fetch(u)).blob()
      return await new Promise<string>((res) => {
        const r = new FileReader()
        r.onload = () => res(r.result as string)
        r.readAsDataURL(b)
      })
    }
    let first = true
    for (const s of slides) {
      if (!first) doc.addPage([PW, PH], 'landscape')
      first = false
      doc.setFillColor('#0e0f11')
      doc.rect(0, 0, PW, PH, 'F')
      if (s.kind === 'cover') {
        const u = imgs[s.key]
        if (u) doc.addImage(await toData(u), 'JPEG', 0, 0, PW * 0.58, PH)
        doc.setTextColor('#f1f2f3')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(26)
        doc.text(asciiText(p.name), PW * 0.62, 38, { maxWidth: PW * 0.34 })
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(11)
        let y = 64
        for (const [k, v] of facts(p)) {
          doc.setTextColor('#8d949b')
          doc.text(k, PW * 0.62, y)
          doc.setTextColor('#f1f2f3')
          doc.text(asciiText(v), PW * 0.76, y)
          y += 9
        }
        doc.setFontSize(7)
        doc.setTextColor('#6e767f')
        doc.text(asciiText(DISCLAIMER), PW * 0.62, PH - 22, { maxWidth: PW * 0.34 })
        continue
      }
      if (s.kind === 'materials') {
        doc.setTextColor('#f1f2f3')
        doc.setFontSize(18)
        doc.text('Materials', 14, 18)
        const list = usedMaterials(p)
        const cols = 6
        const cw = (PW - 28 - (cols - 1) * 6) / cols
        for (let k = 0; k < list.length; k++) {
          const { m, where } = list[k]
          const x = 14 + (k % cols) * (cw + 6)
          const y = 28 + Math.floor(k / cols) * (cw + 22)
          const t = await materialThumb(m, 192)
          if (t) doc.addImage(t, 'JPEG', x, y, cw, cw)
          doc.setFontSize(9)
          doc.setTextColor('#f1f2f3')
          doc.text(asciiText(m.name), x, y + cw + 6, { maxWidth: cw })
          doc.setFontSize(7)
          doc.setTextColor('#8d949b')
          doc.text(asciiText(where.slice(0, 2).join(', ')), x, y + cw + 11, { maxWidth: cw })
        }
        continue
      }
      const u = imgs[s.key]
      if (u) {
        const data = await toData(u)
        const fmt = data.startsWith('data:image/png') ? 'PNG' : 'JPEG'
        if (s.kind === 'plan') {
          doc.setFillColor('#ffffff')
          doc.rect(0, 0, PW, PH, 'F')
        }
        doc.addImage(data, fmt, 0, 0, PW, PH)
      }
      doc.setFontSize(16)
      doc.setTextColor(s.kind === 'plan' ? '#1b1f24' : '#ffffff')
      doc.text(asciiText(s.title), 12, 16)
    }
    const data = doc.output('arraybuffer')
    const path = await platform.saveDialog(`${slugify(p.name)}-presentation.pdf`, [{ name: 'PDF', extensions: ['pdf'] }], data)
    if (path) ui.toast({ kind: 'success', title: 'Presentation exported', body: path, action: path.includes('/') || path.includes('\\') ? { label: 'Show in folder', run: () => void platform.showInFolder(path) } : undefined })
  } catch (e) {
    ui.showError({ what: 'The presentation PDF could not be created.', why: (e as Error).message, fix: 'Wait until every slide has finished rendering, then export again.' })
  } finally {
    ui.set({ busy: null })
  }
}
