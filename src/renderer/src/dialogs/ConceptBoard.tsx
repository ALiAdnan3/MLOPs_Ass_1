import { useRef, useState } from 'react'
import { Camera, ImagePlus, Trash2, Download, Box } from 'lucide-react'
import { Modal } from '../ui/primitives'
import { useProject, commit, getProject } from '../state/store'
import { useUI } from '../state/ui'
import { useAssets } from '../state/assets'
import { getEngine, hasEngine } from '../engine/Engine'
import { renderHouseImage } from '../render/houseImage'
import { uid } from '../core/model/ids'
import { platform } from '../storage/platform'
import { slugify } from '../export/drawingsExport'

/**
 * CONCEPT BOARD (§54): renders and inspiration photos for style exploration and presentation.
 * They are pictures, clearly labelled as such, and never change the editable house model.
 */

export function ConceptBoard({ onClose }: { onClose: () => void }) {
  const images = useProject((s) => s.project.conceptImages)
  const assets = useAssets((s) => s.assets)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const add = async (blob: Blob, title: string, prompt?: string) => {
    const a = await useAssets.getState().put(blob, title)
    commit(`Add concept image "${title}"`, (d) => void d.conceptImages.push({ id: uid('ci'), title, assetId: a.id, createdAt: Date.now(), prompt }))
  }
  const capture = async () => {
    setBusy(true)
    try {
      const e = hasEngine() && getEngine().container ? getEngine() : null
      if (e) {
        await e.mats.waitIdle(6000)
        await add(await e.snapshot({ width: 1920, height: Math.round((1920 * e.canvas.clientHeight) / Math.max(1, e.canvas.clientWidth)), type: 'image/jpeg', quality: 0.92 }), `3D view ${images.length + 1}`)
      } else {
        const url = await renderHouseImage(getProject(), { width: 1920, height: 1080, view: 'street' })
        await add(await (await fetch(url)).blob(), `Street render ${images.length + 1}`)
        URL.revokeObjectURL(url)
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Concept images"
      subtitle="Renders and inspiration pictures for exploring styles and presenting ideas. They are images only; the editable house model is never changed by them."
      size="xwide"
      onClose={onClose}
      footer={
        <>
          <span className="badge" style={{ marginRight: 'auto' }}>
            <Box size={12} style={{ marginRight: 5 }} /> The 3D model and plans stay the source of truth
          </span>
          <button className="btn" onClick={() => file.current?.click()}>
            <ImagePlus size={14} /> Add inspiration photo
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void capture()}>
            <Camera size={14} /> {busy ? 'Rendering…' : 'Capture current view'}
          </button>
        </>
      }
    >
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={async (e) => {
          const fs = [...(e.target.files ?? [])]
          e.target.value = ''
          for (const f of fs) await add(f, f.name.replace(/\.[a-z0-9]+$/i, ''))
        }} />
      {!images.length ? (
        <div className="empty" style={{ padding: 40 }}>
          <div>No concept images yet. Capture the 3D view as you try styles, or add photos of houses you like.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {images.map((c) => {
            const url = assets[c.assetId]?.url
            return (
              <figure key={c.id} style={{ margin: 0, border: '1px solid var(--line-soft)', borderRadius: 6, overflow: 'hidden', background: 'var(--panel-2)' }}>
                <div style={{ position: 'relative', aspectRatio: '16 / 10', background: 'var(--raised)' }}>
                  {url && <img src={url} alt={c.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                  <span className="badge" style={{ position: 'absolute', left: 8, top: 8, background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                    Concept image
                  </span>
                </div>
                <figcaption className="row" style={{ padding: '6px 8px', gap: 4 }}>
                  <input className="field" style={{ flex: 1, height: 26 }} value={c.title} aria-label="Title" onChange={(e) => commit('Rename concept image', (d) => void (d.conceptImages.find((x) => x.id === c.id)!.title = e.target.value), { coalesce: `ci-${c.id}` })} />
                  <button className="icon-btn" aria-label="Save image" data-tip="Save image" onClick={async () => {
                      const a = useAssets.getState().get(c.assetId)
                      if (!a) return
                      const ext = a.mime.includes('png') ? 'png' : 'jpg'
                      const path = await platform.saveDialog(`${slugify(c.title)}.${ext}`, [{ name: 'Image', extensions: [ext] }], await a.blob.arrayBuffer())
                      if (path) useUI.getState().toast({ kind: 'success', title: 'Image saved', body: path })
                    }}>
                    <Download />
                  </button>
                  <button className="icon-btn" aria-label="Remove" data-tip="Remove" onClick={() => commit('Remove concept image', (d) => void (d.conceptImages = d.conceptImages.filter((x) => x.id !== c.id)))}>
                    <Trash2 />
                  </button>
                </figcaption>
              </figure>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
