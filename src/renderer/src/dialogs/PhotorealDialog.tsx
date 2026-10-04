import { useEffect, useRef, useState } from 'react'
import { Aperture, Download, ImagePlus, RotateCcw, Square } from 'lucide-react'
import { Modal, Seg } from '../ui/primitives'
import { useUI } from '../state/ui'
import { commit, getProject } from '../state/store'
import { getEngine, hasEngine } from '../engine/Engine'
import { photorealSupport, renderPhotoreal } from '../engine/photoreal'
import { platform, isDesktop } from '../storage/platform'
import { useAssets } from '../state/assets'
import { uid } from '../core/model/ids'

/**
 * PHOTOREAL RENDER (amendment A6): a path-traced still of the current 3D view, saved as an image
 * or kept on the concept board for the presentation.
 */

const SIZES = [1280, 1920, 2560, 3840]
const QUALITY: { key: string; label: string; samples: number; tip: string }[] = [
  { key: 'preview', label: 'Preview', samples: 32, tip: 'A few seconds; some grain' },
  { key: 'good', label: 'Good', samples: 160, tip: 'Clean enough to share' },
  { key: 'best', label: 'Best', samples: 600, tip: 'For printing; takes a few minutes' }
]

export function PhotorealDialog({ onClose }: { onClose: () => void }) {
  const engine = hasEngine() && getEngine().container ? getEngine() : null
  const support = engine ? photorealSupport(engine) : { ok: false, backend: '' }
  const aspect = engine ? engine.canvas.clientWidth / Math.max(1, engine.canvas.clientHeight) : 16 / 9
  const [width, setWidth] = useState(1920)
  const [quality, setQuality] = useState('good')
  const [style, setStyle] = useState<'real' | 'clay'>('real')
  const [progress, setProgress] = useState<{ done: number; total: number; started: number } | null>(null)
  const [result, setResult] = useState<{ blob: Blob; url: string; secs: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result])
  const height = Math.round(width / aspect / 2) * 2

  const render = async () => {
    if (!engine) return
    setError(null)
    setResult(null)
    const q = QUALITY.find((x) => x.key === quality)!
    const ac = new AbortController()
    abort.current = ac
    const started = performance.now()
    setProgress({ done: 0, total: q.samples, started })
    try {
      await engine.mats.waitIdle(8000)
      const blob = await renderPhotoreal(engine, { width, height, samples: q.samples, clay: style === 'clay', signal: ac.signal, onProgress: (done, total) => setProgress({ done, total, started }) })
      setResult({ blob, url: URL.createObjectURL(blob), secs: (performance.now() - started) / 1000 })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(`The render stopped: ${(e as Error).message}. Try a smaller size or the Preview quality.`)
    } finally {
      setProgress(null)
      abort.current = null
    }
  }

  const name = () => `${getProject().name.replace(/[^\w ]+/g, '').trim() || 'house'} photoreal ${width}x${height}.png`
  const save = async () => {
    if (!result) return
    const saved = await platform.saveDialog(name(), [{ name: 'PNG image', extensions: ['png'] }], await result.blob.arrayBuffer())
    if (saved) useUI.getState().toast({ kind: 'success', title: 'Render saved', body: saved.split(/[\\/]/).pop() })
  }
  const keep = async () => {
    if (!result) return
    const title = `Photoreal render ${getProject().conceptImages.length + 1}`
    const a = await useAssets.getState().put(result.blob, title)
    commit(`Add "${title}" to the concept board`, (d) => void d.conceptImages.push({ id: uid('ci'), title, assetId: a.id, createdAt: Date.now(), prompt: `Path-traced, ${width}×${height}, ${QUALITY.find((x) => x.key === quality)!.samples} samples` }))
    useUI.getState().toast({ kind: 'success', title: 'Added to the concept board', body: 'It appears in the presentation too.' })
  }
  const switchBackend = async () => {
    await platform.settings.set({ graphicsBackend: 'opengl' })
    await platform.relaunch()
  }

  const eta = progress && progress.done > 2 ? ((performance.now() - progress.started) / progress.done) * (progress.total - progress.done) / 1000 : null
  return (
    <Modal
      title="Photoreal render"
      subtitle="Traces real light through the current 3D view: soft shadows, light bouncing between surfaces, true reflections and glass."
      icon={<Aperture />}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <span className="faint grow" style={{ fontSize: 12 }}>
            {result ? `Rendered in ${result.secs.toFixed(0)} s.` : 'Set up the view and lighting in 3D first; the render uses exactly that camera.'}
          </span>
          {progress ? (
            <button className="btn" onClick={() => abort.current?.abort()}>
              <Square size={14} /> Stop
            </button>
          ) : (
            <>
              {result && (
                <>
                  <button className="btn" onClick={() => void keep()}>
                    <ImagePlus size={14} /> Add to concept board
                  </button>
                  <button className="btn" onClick={() => void save()}>
                    <Download size={14} /> Save image
                  </button>
                </>
              )}
              <button className="btn primary" disabled={!engine || !support.ok} onClick={() => void render()}>
                {result ? <RotateCcw size={14} /> : <Aperture size={14} />} {result ? 'Render again' : 'Render'}
              </button>
            </>
          )}
        </>
      }
    >
      {!engine ? (
        <p>Open the 3D view first; the render uses its camera and lighting.</p>
      ) : !support.ok ? (
        <div className="col" style={{ gap: 10 }}>
          <p style={{ margin: 0 }}>
            Photoreal rendering needs the OpenGL graphics backend. This computer is using Direct3D ({support.backend}), which returns black surfaces for the path tracer.
          </p>
          {isDesktop ? (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary" onClick={() => void switchBackend()}>
                Switch to OpenGL and restart
              </button>
              <span className="faint" style={{ fontSize: 12 }}>
                Your work is autosaved first. You can switch back in Settings.
              </span>
            </div>
          ) : (
            <p className="faint" style={{ margin: 0, fontSize: 12 }}>
              In a browser, set chrome://flags/#use-angle to OpenGL, then reload.
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', gap: 16 }}>
          <div className="col" style={{ gap: 12 }}>
            <div>
              <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>
                Size
              </div>
              <select className="field" value={width} disabled={!!progress} onChange={(e) => setWidth(Number(e.target.value))}>
                {SIZES.map((w) => (
                  <option key={w} value={w}>
                    {w} × {Math.round(w / aspect / 2) * 2}
                    {w === 3840 ? ' (4K)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>
                Quality
              </div>
              <Seg value={quality} onChange={(v) => !progress && setQuality(v)} options={QUALITY.map((q) => ({ value: q.key, label: q.label, tip: q.tip }))} />
            </div>
            <div>
              <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>
                Style
              </div>
              <Seg value={style} onChange={(v) => !progress && setStyle(v)} options={[{ value: 'real', label: 'Materials' }, { value: 'clay', label: 'Clay (white model)', tip: 'Shows form and light only' }]} />
            </div>
            <p className="faint" style={{ fontSize: 11, margin: 0 }}>
              The first render on this computer also prepares the GPU program, which can take a minute.
            </p>
          </div>
          <div className="photoreal-stage" style={{ aspectRatio: `${width} / ${height}` }}>
            {result ? (
              <img src={result.url} alt="Photoreal render" />
            ) : progress ? (
              <div className="photoreal-progress">
                <div className="bar">
                  <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
                <span className="tabular">
                  {progress.done} of {progress.total} samples{eta !== null ? `, about ${Math.max(1, Math.round(eta))} s left` : ', preparing'}
                </span>
              </div>
            ) : (
              <span className="faint">{error ?? 'Choose a size and quality, then Render.'}</span>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
