import { useEffect, useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { Modal, LengthField } from '../ui/primitives'
import { useProject, commit } from '../state/store'
import { useUI } from '../state/ui'
import { pendingImport } from './importFiles'
import { segmentsFromImage, recognize, applyRecognizedPlan, type RecognizedPlan, type TextMark } from '../ai/sketchRecognizer'
import { claudeVisionAvailable, readPlanWithClaude, textsFromReading } from '../ai/readPlan'
import { FT } from '../core/units/units'
import { spec } from '../core/constraints/rooms'
import { area, bbox } from '../core/geometry/polygon'
import { formatAreaFor } from '../core/units/units'
import { sortedFloors } from '../core/model/house'
import { applySmartLabels } from '../planner/labels'
import type { Floor, Project, RoomType } from '../core/model/types'

/**
 * IMAGE → FLOOR PLAN (§21): a photo or scan of an existing plan becomes editable geometry.
 * Detect walls → rooms → doors → windows → scale → editable plan → 3D. Every stage is shown,
 * and the result is previewed over the image before anything changes in the project.
 */

const STAGES = ['Detect walls', 'Detect rooms', 'Detect doors', 'Detect windows', 'Set the scale', 'Create editable plan']
const STAGES_CLAUDE = ['Read names and sizes (Claude)', ...STAGES]
const TYPES: RoomType[] = ['master_bedroom', 'bedroom', 'bathroom', 'kitchen', 'tv_lounge', 'drawing', 'dining', 'store', 'stair', 'corridor', 'foyer', 'garage', 'study', 'laundry', 'terrace']

export function ImportPlanDialog({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project)
  const floors = sortedFloors(project.floors).filter((f) => f.kind !== 'roof')
  const [floorId, setFloorId] = useState(useUI.getState().floorId || floors[0]?.id)
  const [img, setImg] = useState<{ url: string; data: ImageData; w: number; h: number; name: string } | null>(null)
  const [stage, setStage] = useState(-1)
  const [plan, setPlan] = useState<RecognizedPlan | null>(null)
  const [pxBox, setPxBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const bw = project.plot.width - project.plot.setbacks.left - project.plot.setbacks.right
  const [widthM, setWidthM] = useState(bw)
  const [error, setError] = useState<string | null>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  // amendment A5: optional Claude reading of the writing on the drawing
  const [visionOk, setVisionOk] = useState(false)
  const [useVision, setUseVision] = useState(true)
  const [visionNote, setVisionNote] = useState<string | null>(null)
  useEffect(() => void claudeVisionAvailable().then(setVisionOk), [])
  const vision = visionOk && useVision
  const stages = vision ? STAGES_CLAUDE : STAGES
  const off = vision ? 1 : 0
  const input = useRef<HTMLInputElement>(null)

  const load = async (f: File) => {
    try {
      const bmp = await createImageBitmap(f)
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas')
      c.width = Math.round(bmp.width * k)
      c.height = Math.round(bmp.height * k)
      const g = c.getContext('2d')!
      g.fillStyle = '#fff'
      g.fillRect(0, 0, c.width, c.height)
      g.drawImage(bmp, 0, 0, c.width, c.height)
      setImg({ url: c.toDataURL('image/jpeg', 0.9), data: g.getImageData(0, 0, c.width, c.height), w: c.width, h: c.height, name: f.name })
      setPlan(null)
      setStage(-1)
      setError(null)
    } catch {
      setError(`"${f.name}" could not be opened as an image. Use a JPG or PNG scan or photo of the plan.`)
    }
  }
  useEffect(() => {
    const f = pendingImport.files[0]
    pendingImport.files = []
    if (f) void load(f)
  }, [])

  const detect = async () => {
    if (!img) return
    setError(null)
    setPlan(null)
    const step = async (i: number) => {
      setStage(i)
      await new Promise((r) => setTimeout(r, 140))
    }
    setVisionNote(null)
    let reading: Awaited<ReturnType<typeof readPlanWithClaude>> | null = null
    let width = widthM
    if (vision) {
      await step(0)
      reading = await readPlanWithClaude(img.url)
      if (!reading.ok) setVisionNote(`${reading.error} Continuing without it.`)
      else {
        const r = reading.result
        if (r.overallWidthFt && r.overallWidthFt > 8 && r.overallWidthFt < 500) {
          width = r.overallWidthFt * FT
          setWidthM(width)
        }
        setVisionNote(`Claude read ${r.rooms.length} room name${r.rooms.length === 1 ? '' : 's'} and ${r.dimensions.length} size${r.dimensions.length === 1 ? '' : 's'}${r.overallWidthFt ? `, overall width ${r.overallWidthFt} ft` : ''}.`)
      }
    }
    await step(off)
    const im = segmentsFromImage(img.data)
    if (im.segs.length < 4) {
      setError('Too few wall lines were found. Use a sharper, straight-on scan with dark wall lines on a light background.')
      setStage(-1)
      return
    }
    const all = im.segs.flatMap((s) => [s.a, s.b])
    const b = bbox(all)
    setPxBox(b)
    const mpp = width / Math.max(1, b.w)
    const T = (p: { x: number; y: number }) => ({ x: (p.x - b.x) * mpp, y: (p.y - b.y) * mpp })
    const texts: TextMark[] = reading?.ok ? textsFromReading(reading.result, (fx, fy) => T({ x: fx * img.w, y: fy * img.h })) : []
    const segs = im.segs.map((s) => ({ a: T(s.a), b: T(s.b) }))
    const thin = im.thin.map((s) => ({ a: T(s.a), b: T(s.b) })).filter((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 0.5)
    await step(1 + off)
    const res = recognize(segs, { tol: Math.max(0.18, im.wallPx * mpp * 1.6), windowMarks: thin, texts })
    await step(2 + off)
    await step(3 + off)
    await step(4 + off)
    setPlan(res)
    setStage(5 + off)
    if (!res.rooms.length) setError('Walls were found, but they do not close into rooms. The plan may be too faint or cropped; try a cleaner scan.')
  }

  // overlay: recognized walls and rooms drawn over the image
  useEffect(() => {
    const c = overlay.current
    if (!c || !img) return
    c.width = img.w
    c.height = img.h
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    if (!plan || !pxBox) return
    // written dimensions may have rescaled the plan: map back through that scale too
    const mpp = (widthM / Math.max(1, pxBox.w)) * plan.scale
    const P = (p: { x: number; y: number }) => ({ x: p.x / mpp + pxBox.x, y: p.y / mpp + pxBox.y })
    for (const r of plan.rooms) {
      g.beginPath()
      r.polygon.forEach((p, i) => {
        const q = P(p)
        if (i) g.lineTo(q.x, q.y)
        else g.moveTo(q.x, q.y)
      })
      g.closePath()
      g.fillStyle = spec(r.type).tint + 'aa'
      g.fill()
      const b = bbox(r.polygon.map(P))
      g.fillStyle = '#1b1f24'
      g.font = `600 ${Math.max(12, img.w / 70)}px 'Archivo Variable', sans-serif`
      g.textAlign = 'center'
      g.fillText(r.confidence < 0.6 ? `${r.name}?` : r.name, b.x + b.w / 2, b.y + b.h / 2)
    }
    g.strokeStyle = '#1f7fb5'
    g.lineWidth = Math.max(2, img.w / 300)
    for (const w of plan.walls) {
      const a = P(w.a)
      const b2 = P(w.b)
      g.beginPath()
      g.moveTo(a.x, a.y)
      g.lineTo(b2.x, b2.y)
      g.stroke()
    }
    for (const o of plan.openings) {
      const c2 = P(o.at)
      g.fillStyle = o.kind === 'door' ? '#d99a00' : '#4b8db3'
      g.beginPath()
      g.arc(c2.x, c2.y, Math.max(4, img.w / 180), 0, Math.PI * 2)
      g.fill()
    }
  }, [plan, img, pxBox, widthM])

  const setType = (id: string, t: RoomType) => setPlan((p) => (p ? { ...p, rooms: p.rooms.map((r) => (r.id === id ? { ...r, type: t, name: spec(t).label, confidence: 1, reason: 'set by you' } : r)) } : p))

  const create = (then: 'plan' | '3d') => {
    if (!plan || !floorId) return
    const floor = project.floors.find((f) => f.id === floorId)!
    let warnings: string[] = []
    commit(`Floor plan from image (${floor.name})`, (d) => {
      warnings = applyRecognizedPlan(plan, d.floors.find((x) => x.id === floorId) as Floor, d.plot, d.settings).warnings
      applySmartLabels(d as unknown as Project)
    }, { major: true })
    useUI.getState().set({ floorId, mode: then, selection: [] })
    useUI.getState().toast({ kind: warnings.length ? 'warning' : 'success', title: `${plan.rooms.length} rooms created from ${img?.name ?? 'the image'}`, body: warnings[0] ?? 'Everything is editable now: drag walls, resize rooms, move doors.' })
    onClose()
  }

  const u = project.settings.units
  return (
    <Modal
      title="Import a floor plan image"
      subtitle="A scan or photo of an existing plan becomes an editable floor plan and a 3D model."
      size="xwide"
      onClose={onClose}
      footer={
        <>
          <span className="faint grow" style={{ fontSize: 12 }}>
            {vision ? 'Claude reads the room names and sizes written on the image; check them before creating the plan.' : 'Set the overall width so the plan comes in at the right size. With a Claude key, the names and sizes written on the image can be read too.'}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={!plan?.rooms.length} onClick={() => create('plan')}>
            Create editable plan
          </button>
          <button className="btn primary" disabled={!plan?.rooms.length} onClick={() => create('3d')}>
            Create and view in 3D
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 16 }}>
        <div>
          {img ? (
            <div style={{ position: 'relative', background: '#fff', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--line)' }}>
              <img src={img.url} alt={img.name} style={{ width: '100%', display: 'block', opacity: plan ? 0.55 : 1 }} />
              <canvas ref={overlay} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
            </div>
          ) : (
            <div className="dropzone" style={{ padding: 48 }} role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
                e.preventDefault()
                const f = e.dataTransfer.files[0]
                if (f) void load(f)
              }}>
              <ImagePlus size={22} />
              <div style={{ color: 'var(--text)', marginTop: 6 }}>Choose or drop a floor plan image</div>
              <div className="faint" style={{ fontSize: 12 }}>floorplan.png, a scan, or a straight-on photo</div>
            </div>
          )}
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void load(f)
            }} />
          {error && (
            <p style={{ color: 'var(--danger)', fontSize: 13 }} role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="col" style={{ gap: 12 }}>
          <div className="pipeline" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            {stages.map((s, i) => (
              <span key={s} className={i < stage || (i === stage && stage === stages.length - 1) ? 'done' : i === stage ? 'active' : ''}>
                {i < stage || (plan && i <= stages.length - 2) ? '✓ ' : ''}
                {s}
              </span>
            ))}
          </div>
          {visionOk && (
            <label className="side-check" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={useVision} onChange={(e) => setUseVision(e.target.checked)} />
              Read room names and sizes with Claude (sends this image to Claude)
            </label>
          )}
          {visionNote && <p className="faint" style={{ fontSize: 12, margin: 0 }}>{visionNote}</p>}
          <div className="prop">
            <label>House width</label>
            <LengthField value={widthM} units={u} min={3} max={200} onCommit={(v) => setWidthM(v)} tip="Overall width of the drawn house, outside to outside" />
          </div>
          <div className="prop">
            <label>Put it on</label>
            <select className="field" value={floorId} onChange={(e) => setFloorId(e.target.value)}>
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} floor{f.rooms.length ? ' (replaces rooms)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {img && (
              <button className="btn" onClick={() => input.current?.click()}>
                Other image
              </button>
            )}
            <button className="btn primary grow" disabled={!img} onClick={() => void detect()}>
              {plan ? 'Detect again' : 'Detect plan'}
            </button>
          </div>
          {plan && (
            <>
              <ul className="faint" style={{ fontSize: 12, margin: 0, paddingLeft: 16 }}>
                {plan.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <div className="list" style={{ maxHeight: 220, overflowY: 'auto' }}>
                {plan.rooms.map((r) => (
                  <div key={r.id} className="list-item" style={{ gap: 6 }}>
                    <select className="field" style={{ flex: 1 }} value={r.type} onChange={(e) => setType(r.id, e.target.value as RoomType)} aria-label="Room type">
                      {[...new Set([r.type, ...TYPES])].map((t) => (
                        <option key={t} value={t}>
                          {spec(t).label}
                          {t === r.type && r.confidence < 0.6 ? '?' : ''}
                        </option>
                      ))}
                    </select>
                    <span className="meta tabular">{formatAreaFor(area(r.polygon), u)}</span>
                  </div>
                ))}
              </div>
              {plan.rooms.some((r) => r.confidence < 0.6) && <p className="faint" style={{ fontSize: 12, margin: 0 }}>Rooms marked “?” were guessed from their size. Check their types above.</p>}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
