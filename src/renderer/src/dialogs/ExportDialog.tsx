import { useEffect, useMemo, useState } from 'react'
import { FileText, Box, Image as ImageIcon, Video, FolderArchive, Check } from 'lucide-react'
import { Modal, Seg, Switch } from '../ui/primitives'
import { useProject, getProject } from '../state/store'
import { useUI } from '../state/ui'
import { platform } from '../storage/platform'
import { DRAWING_KINDS, listDrawings, type DrawingKind } from '../export/sheets'
import { exportDrawings, sheetSvg, slugify, type DrawingFormat } from '../export/drawingsExport'
import { exportGltf, exportObj } from '../export/model'
import { renderHouseImage } from '../render/houseImage'
import { renderPlanToCanvas } from '../render/planImage'
import { getEngine, hasEngine } from '../engine/Engine'
import { sortedFloors } from '../core/model/house'
import { serializeProject } from '../storage/projectFile'
import { snapshotThumbnail } from '../render/thumbnail'
import type { ExportFile } from '../../../shared/api'
import { DISCLAIMER } from '../core/model/defaults'

/** EXPORT CENTER (§48): drawings, 3D model, images, walkthrough video and the project file. */

type Section = 'drawings' | 'model' | 'images' | 'video' | 'project'

const SECTIONS: { key: Section; label: string; icon: JSX.Element; hint: string }[] = [
  { key: 'drawings', label: 'Drawings', icon: <FileText />, hint: 'PDF, SVG, PNG, JPG, DXF' },
  { key: 'model', label: '3D model', icon: <Box />, hint: 'GLB, glTF, OBJ' },
  { key: 'images', label: 'Images', icon: <ImageIcon />, hint: 'Renders and plans' },
  { key: 'video', label: 'Walkthrough video', icon: <Video />, hint: 'Drone flythrough' },
  { key: 'project', label: 'Project file', icon: <FolderArchive />, hint: '.homeforge' }
]

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const preset = useUI((s) => s.dialogProps.preset as string | undefined)
  const [section, setSection] = useState<Section>(preset === 'model' ? 'model' : preset === 'image' ? 'images' : preset === 'video' ? 'video' : preset === 'project' ? 'project' : 'drawings')
  return (
    <Modal title="Export" subtitle="Everything is generated from the house model, so every file matches what you see." onClose={onClose} size="xwide">
      <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 18, minHeight: 440 }}>
        <nav className="list" aria-label="Export type">
          {SECTIONS.map((s) => (
            <button key={s.key} className={`list-item ${section === s.key ? 'on' : ''}`} style={{ alignItems: 'flex-start', textAlign: 'left' }} onClick={() => setSection(s.key)}>
              <span style={{ width: 16, height: 16, flex: 'none', marginTop: 2 }}>{s.icon}</span>
              <span>
                <span style={{ display: 'block' }}>{s.label}</span>
                <span className="faint" style={{ fontSize: 11 }}>
                  {s.hint}
                </span>
              </span>
            </button>
          ))}
        </nav>
        <div style={{ minWidth: 0 }}>
          {section === 'drawings' && <DrawingsExport preset={preset} onDone={onClose} />}
          {section === 'model' && <ModelExport onDone={onClose} />}
          {section === 'images' && <ImagesExport onDone={onClose} />}
          {section === 'video' && <VideoExport onDone={onClose} />}
          {section === 'project' && <ProjectExport onDone={onClose} />}
        </div>
      </div>
    </Modal>
  )
}

/* ── saving helpers ──────────────────────────────────────────────────────── */

async function saveFiles(files: ExportFile[], filterName: string, ext: string[]): Promise<boolean> {
  const ui = useUI.getState()
  if (!files.length) return false
  if (files.length === 1) {
    const path = await platform.saveDialog(files[0].name, [{ name: filterName, extensions: ext }], files[0].data)
    if (!path) return false
    ui.toast({ kind: 'success', title: `Exported ${files[0].name}`, body: path === files[0].name ? 'Saved to your downloads.' : path, action: path !== files[0].name ? { label: 'Show in folder', run: () => void platform.showInFolder(path) } : undefined })
    return true
  }
  const folder = await platform.chooseFolder()
  if (!folder) return false
  const written = await platform.writeFiles(folder, files)
  ui.toast({ kind: 'success', title: `Exported ${written.length} files`, body: folder, action: written[0] && folder !== 'Downloads' ? { label: 'Show in folder', run: () => void platform.showInFolder(written[0]) } : undefined })
  return true
}

function failed(what: string, e: unknown, retry?: () => void) {
  useUI.getState().showError({
    what,
    why: e instanceof Error ? e.message : String(e),
    fix: 'Try again. If the project is very large, export fewer sheets at a time or lower the resolution.',
    retry
  })
}

async function busy<T>(label: string, fn: () => Promise<T>): Promise<T> {
  useUI.getState().set({ busy: label })
  await new Promise((r) => setTimeout(r, 30))
  try {
    return await fn()
  } finally {
    useUI.getState().set({ busy: null })
  }
}

/* ── drawings ────────────────────────────────────────────────────────────── */

function DrawingsExport({ preset, onDone }: { preset?: string; onDone: () => void }) {
  const project = useProject((s) => s.project)
  const [kinds, setKinds] = useState<DrawingKind[]>(preset === 'plan-pdf' ? ['floor-plan'] : ['site-plan', 'floor-plan', 'dimension-plan', 'elevation', 'section', 'roof-plan'])
  const [format, setFormat] = useState<DrawingFormat>('pdf')
  const [color, setColor] = useState(true)
  const [dpi, setDpi] = useState(200)
  const specs = useMemo(() => listDrawings(project, kinds), [project, kinds])
  const [previewIdx, setPreviewIdx] = useState(0)
  const [preview, setPreview] = useState('')
  useEffect(() => {
    const d = specs[Math.min(previewIdx, specs.length - 1)]
    if (!d) return setPreview('')
    const t = setTimeout(() => {
      try {
        setPreview('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sheetSvg(project, d, color)))
      } catch (e) {
        console.error(e)
        setPreview('')
      }
    }, 60)
    return () => clearTimeout(t)
  }, [specs, previewIdx, project, color])
  const run = async () => {
    try {
      const files = await busy(`Drawing ${specs.length} sheet${specs.length === 1 ? '' : 's'}…`, () => exportDrawings(getProject(), specs, format, { color, dpi }))
      const ext = format === 'jpg' ? ['jpg', 'jpeg'] : [format]
      if (await saveFiles(files, format.toUpperCase(), ext)) onDone()
    } catch (e) {
      failed('The drawings could not be exported.', e, () => void run())
    }
  }
  return (
    <div className="col" style={{ gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {DRAWING_KINDS.map((k) => (
          <label key={k.kind} className="check">
            <input type="checkbox" checked={kinds.includes(k.kind)} onChange={(e) => setKinds((ks) => (e.target.checked ? [...ks, k.kind] : ks.filter((x) => x !== k.kind)))} /> {k.label}
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <Seg<DrawingFormat>
          value={format}
          onChange={setFormat}
          options={[
            { value: 'pdf', label: 'PDF set', tip: 'All sheets in one A3 PDF' },
            { value: 'svg', label: 'SVG', tip: 'One vector file per sheet' },
            { value: 'png', label: 'PNG' },
            { value: 'jpg', label: 'JPG' },
            { value: 'dxf', label: 'DXF', tip: 'CAD drawings in metres' }
          ]}
        />
        {format !== 'dxf' && (
          <label className="row" style={{ gap: 8 }}>
            <Switch on={color} onChange={setColor} label="Colour fills" /> Colour fills
          </label>
        )}
        {(format === 'png' || format === 'jpg') && <Seg value={String(dpi)} onChange={(v) => setDpi(Number(v))} options={[{ value: '150', label: '150 dpi' }, { value: '200', label: '200 dpi' }, { value: '300', label: '300 dpi' }]} />}
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 0', minWidth: 0, maxWidth: 600, background: '#fff', borderRadius: 4, border: '1px solid var(--line)', aspectRatio: '420 / 297', overflow: 'hidden' }}>
          {preview ? <img src={preview} alt="Sheet preview" style={{ width: '100%', height: '100%', display: 'block' }} /> : <div className="faint" style={{ padding: 20 }}>Choose at least one drawing.</div>}
        </div>
        <div className="list" style={{ flex: '0 0 230px', maxHeight: 420, overflowY: 'auto' }}>
          {specs.map((d, i) => (
            <button key={d.id} className={`list-item ${i === previewIdx ? 'on' : ''}`} onClick={() => setPreviewIdx(i)} style={{ textAlign: 'left' }}>
              <span className="tabular faint" style={{ width: 44, flex: 'none' }}>
                {d.number}
              </span>
              <span style={{ fontSize: 12 }}>{d.title}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>
        {format === 'dxf' ? 'DXF files open in AutoCAD, LibreCAD and most CAD programs. Units are metres; each drawing is on its own layers.' : 'Sheets are A3 landscape with a title block, scale bar and the conceptual-design note.'}
      </p>
      <div className="row">
        <div className="grow" />
        <button className="btn primary" disabled={!specs.length} onClick={() => void run()}>
          Export {specs.length} {format === 'pdf' ? `sheet${specs.length === 1 ? '' : 's'} as PDF` : `${format.toUpperCase()} file${specs.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}

/* ── 3D model ────────────────────────────────────────────────────────────── */

function ModelExport({ onDone }: { onDone: () => void }) {
  const [fmt, setFmt] = useState<'glb' | 'gltf' | 'obj'>('glb')
  const run = async () => {
    const p = getProject()
    const slug = slugify(p.name)
    try {
      const files = await busy('Building the 3D model file…', () => (fmt === 'obj' ? exportObj(p, slug) : exportGltf(p, fmt === 'glb', slug)))
      if (await saveFiles(files, fmt.toUpperCase(), [fmt])) onDone()
    } catch (e) {
      failed('The 3D model could not be exported.', e, () => void run())
    }
  }
  const info = {
    glb: 'One file with geometry, PBR materials and textures. Opens in Blender, SketchUp (with importer), Windows 3D Viewer and web viewers.',
    gltf: 'The same model as JSON with embedded textures, handy for web projects.',
    obj: 'Geometry with an MTL material file. Works almost everywhere; textures are replaced by material colours.'
  }[fmt]
  return (
    <div className="col" style={{ gap: 14 }}>
      <Seg value={fmt} onChange={setFmt} options={[{ value: 'glb', label: 'GLB' }, { value: 'gltf', label: 'glTF' }, { value: 'obj', label: 'OBJ + MTL' }]} />
      <p className="muted" style={{ margin: 0 }}>
        {info}
      </p>
      <dl className="kv">
        <dt>Includes</dt>
        <dd>Every floor, stairs, doors, windows, furniture, roof, site and landscaping</dd>
        <dt>Units</dt>
        <dd>Metres, Y up</dd>
      </dl>
      <div className="row">
        <div className="grow" />
        <button className="btn primary" onClick={() => void run()}>
          Export {fmt.toUpperCase()}
        </button>
      </div>
    </div>
  )
}

/* ── images ──────────────────────────────────────────────────────────────── */

type Shot = 'current' | 'aerial' | 'street' | 'top' | 'plans'

function ImagesExport({ onDone }: { onDone: () => void }) {
  const [shots, setShots] = useState<Shot[]>(['aerial', 'street', 'plans'])
  const [res, setRes] = useState('1920x1080')
  const [fmt, setFmt] = useState<'png' | 'jpg'>('png')
  const mounted = hasEngine() && !!getEngine().container
  const run = async () => {
    const p = getProject()
    const [w, h] = res.split('x').map(Number)
    const type = fmt === 'png' ? 'image/png' : 'image/jpeg'
    const slug = slugify(p.name)
    try {
      const files = await busy('Rendering images…', async () => {
        const out: ExportFile[] = []
        const fromUrl = async (u: string) => (await fetch(u)).arrayBuffer()
        if (shots.includes('current') && mounted) {
          const e = getEngine()
          await e.mats.waitIdle(15000, true)
          const b = await e.snapshot({ width: w, height: h, type, quality: 0.92 })
          out.push({ name: `${slug}-view.${fmt}`, data: await b.arrayBuffer() })
        }
        for (const v of ['aerial', 'street', 'top'] as const) {
          if (!shots.includes(v)) continue
          const u = await renderHouseImage(p, { width: w, height: h, view: v, type })
          out.push({ name: `${slug}-${v}.${fmt}`, data: await fromUrl(u) })
          URL.revokeObjectURL(u)
        }
        if (shots.includes('plans'))
          for (const f of sortedFloors(p.floors).filter((x) => x.rooms.length)) {
            const c = renderPlanToCanvas(p, f, w, h, { theme: 'print', site: f.level === 0, labels: true, dpr: 1 })
            const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), type, 0.92))
            out.push({ name: `${slug}-${slugify(f.name)}-plan.${fmt}`, data: await b.arrayBuffer() })
          }
        return out
      })
      if (await saveFiles(files, fmt.toUpperCase(), fmt === 'jpg' ? ['jpg', 'jpeg'] : ['png'])) onDone()
    } catch (e) {
      failed('The images could not be rendered.', e, () => void run())
    }
  }
  const opts: { k: Shot; label: string; disabled?: boolean }[] = [
    { k: 'current', label: 'Current 3D view', disabled: !mounted },
    { k: 'aerial', label: 'Aerial view' },
    { k: 'street', label: 'Street view' },
    { k: 'top', label: 'Top view' },
    { k: 'plans', label: 'Floor plan of every floor' }
  ]
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="col" style={{ gap: 6 }}>
        {opts.map((o) => (
          <label key={o.k} className="check" style={{ opacity: o.disabled ? 0.5 : 1 }}>
            <input type="checkbox" disabled={o.disabled} checked={shots.includes(o.k) && !o.disabled} onChange={(e) => setShots((s) => (e.target.checked ? [...s, o.k] : s.filter((x) => x !== o.k)))} /> {o.label}
            {o.disabled && <span className="faint"> (open the 3D view first)</span>}
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 12 }}>
        <Seg value={res} onChange={setRes} options={[{ value: '1920x1080', label: 'Full HD' }, { value: '2560x1440', label: '1440p' }, { value: '3840x2160', label: '4K' }]} />
        <Seg value={fmt} onChange={setFmt} options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }]} />
      </div>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>
        Renders use the current lighting and time of day. Set the sun on the 3D toolbar before exporting.
      </p>
      <div className="row">
        <div className="grow" />
        <button className="btn primary" disabled={!shots.length} onClick={() => void run()}>
          Export images
        </button>
      </div>
    </div>
  )
}

/* ── video ───────────────────────────────────────────────────────────────── */

function VideoExport({ onDone }: { onDone: () => void }) {
  return (
    <div className="col" style={{ gap: 14 }}>
      <p className="muted" style={{ margin: 0 }}>
        The walkthrough video is recorded from the drone flythrough: it flies around the house, through the entrance, room by room and up the stairs. Choose the route, speed and height in Drone mode, then record.
      </p>
      <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
        <li>WebM video at 30 frames per second</li>
        <li>Uses the current lighting, so evening and night tours work too</li>
        <li>Keep the window visible while it records</li>
      </ul>
      <div className="row">
        <div className="grow" />
        <button className="btn primary" onClick={() => {
            useUI.getState().set({ mode: 'drone' })
            onDone()
            useUI.getState().toast({ kind: 'info', title: 'Drone mode is open', body: 'Pick a route in the right panel and choose "Record walkthrough video".' })
          }}>
          Open drone mode
        </button>
      </div>
    </div>
  )
}

/* ── project ─────────────────────────────────────────────────────────────── */

function ProjectExport({ onDone }: { onDone: () => void }) {
  const run = async () => {
    const p = getProject()
    try {
      const data = await busy('Packing the project…', async () => serializeProject(p, { thumbnail: await snapshotThumbnail().catch(() => null) }))
      if (await saveFiles([{ name: `${slugify(p.name)}.homeforge`, data }], 'HomeForge project', ['homeforge'])) onDone()
    } catch (e) {
      failed('The project file could not be written.', e, () => void run())
    }
  }
  return (
    <div className="col" style={{ gap: 14 }}>
      <p className="muted" style={{ margin: 0 }}>
        A complete copy of the project: plot, requirements, every floor, materials and uploaded photos, cameras, design options and version history.
      </p>
      <div className="row" style={{ gap: 6 }}>
        <Check size={14} style={{ color: 'var(--ok)' }} /> <span className="faint">Opens on any computer with HomeForge AI</span>
      </div>
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>
        {DISCLAIMER}
      </p>
      <div className="row">
        <div className="grow" />
        <button className="btn primary" onClick={() => void run()}>
          Export project copy
        </button>
      </div>
    </div>
  )
}
