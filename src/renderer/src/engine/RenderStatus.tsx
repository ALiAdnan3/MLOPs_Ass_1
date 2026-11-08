import { useEffect, useRef, useState } from 'react'
import { Gauge, Loader2 } from 'lucide-react'
import type { Engine } from './Engine'
import type { Quality } from '../core/model/types'
import { useUI } from '../state/ui'
import { platform } from '../storage/platform'

/**
 * The 3D view's status (amendment A13): "Preparing 3D view" until its first frame, then, once the
 * view is still, how far the picture has refined (the pipeline keeps adding samples for soft
 * shadows, smooth edges and clean shading). The pill also opens the quality presets, with what
 * each one does, so the trade-off is never a guess.
 */

const PRESETS: { q: Quality; label: string; d: string }[] = [
  { q: 'low', label: 'Low', d: 'Smooth on any computer. Still views refine to soft shadows and clean edges.' },
  { q: 'medium', label: 'Medium', d: 'Sharper, with glow from lights while moving. Refines further.' },
  { q: 'high', label: 'High', d: 'High resolution, ambient shading while moving, finer shadows.' },
  { q: 'ultra', label: 'Ultra', d: 'Maximum resolution and the most refined still pictures. Needs a strong graphics card.' }
]

export function RenderStatus({ engine }: { engine: Engine }) {
  const quality = useUI((s) => s.quality)
  const set = useUI((s) => s.set)
  const [st, setSt] = useState(engine.status())
  const [open, setOpen] = useState(false)
  const [doneFor, setDoneFor] = useState(0)
  const doneAt = useRef(0)
  useEffect(() => {
    let alive = true
    const t = window.setInterval(() => {
      if (!alive) return
      const s = engine.status()
      setSt((p) => (p.phase === s.phase && Math.abs(p.progress - s.progress) < 0.02 ? p : s))
      if (s.phase === 'done') {
        if (!doneAt.current) doneAt.current = performance.now()
        setDoneFor(performance.now() - doneAt.current)
      } else {
        doneAt.current = 0
        setDoneFor(0)
      }
    }, 150)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [engine])

  const choose = (q: Quality) => {
    set({ quality: q })
    void platform.settings.set({ quality: q })
    setOpen(false)
  }
  const label = PRESETS.find((p) => p.q === quality)?.label ?? quality
  // the finished state lingers briefly, then only the quality label stays (quiet when nothing happens)
  const showProgress = st.phase === 'refining' || (st.phase === 'done' && doneFor < 1200)

  return (
    <>
      {st.phase === 'preparing' && (
        <div className="rs-preparing" role="status">
          <Loader2 size={18} className="spin" />
          <span>Preparing 3D view…</span>
        </div>
      )}
      <div className="overlay rs-wrap">
        <button className={`rs-pill${open ? ' on' : ''}`} onClick={() => setOpen((o) => !o)} aria-label={`3D quality: ${label}. Change quality`} aria-expanded={open}>
          {showProgress ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
              <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${(st.progress * 34.6).toFixed(1)} 34.6`} transform="rotate(-90 7 7)" strokeLinecap="round" />
            </svg>
          ) : (
            <Gauge size={14} />
          )}
          <span>{st.phase === 'refining' ? `Refining ${Math.round(st.progress * 100)}%` : label}</span>
        </button>
        {open && (
          <div className="rs-menu" role="dialog" aria-label="3D quality">
            <div className="rs-head">3D quality</div>
            {PRESETS.map((p) => (
              <button key={p.q} className={`rs-opt${p.q === quality ? ' on' : ''}`} onClick={() => choose(p.q)} aria-pressed={p.q === quality}>
                <span className="rs-name">{p.label}</span>
                <span className="rs-desc">{p.d}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
