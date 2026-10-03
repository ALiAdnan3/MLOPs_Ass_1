import { useCallback, useEffect, useRef, useState } from 'react'
import { useSketch } from './sketchState'
import { useProject } from '../state/store'
import { useUI } from '../state/ui'
import type { Vec2 } from '../core/model/types'
import { bbox, centroid } from '../core/geometry/polygon'
import { spec } from '../core/constraints/rooms'
import { pendingImport } from '../dialogs/importFiles'

/**
 * SKETCH MODE surface (§19, §20): draw with mouse, pen (pressure) or touch on a scaled grid
 * over your plot; label rooms by typing; import a photo of a paper sketch. The recognized
 * plan is overlaid in chalk blue so you can check it before it becomes the floor plan.
 */

interface View {
  scale: number
  ox: number
  oy: number
}

const INK_DARK = '#e6e8ea'
const INK_LIGHT = '#1b1f24'

export function SketchView() {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const plot = useProject((s) => s.project.plot)
  const floorId = useUI((s) => s.floorId)
  const floor = useProject((s) => s.project.floors.find((f) => f.id === floorId))
  const theme = useUI((s) => s.theme)
  const st = useSketch()
  const [view, setView] = useState<View>({ scale: 20, ox: 40, oy: 40 })
  const [size, setSize] = useState({ w: 800, h: 600 })
  const live = useRef<{ pts: Vec2[]; pressure: number[] } | null>(null)
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const [textAt, setTextAt] = useState<{ world: Vec2; screen: Vec2 } | null>(null)
  const [textVal, setTextVal] = useState('')
  const [ask, setAsk] = useState<{ id: string; screen: Vec2 } | null>(null)
  const dark = theme === 'dark'

  const fit = useCallback(() => {
    const b = bbox(plot.polygon)
    const pad = 60
    const scale = Math.min((size.w - pad * 2) / Math.max(1, b.w), (size.h - pad * 2) / Math.max(1, b.h))
    setView({ scale, ox: size.w / 2 - (b.x + b.w / 2) * scale, oy: size.h / 2 - (b.y + b.h / 2) * scale })
  }, [plot, size])

  useEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => fit(), [fit])
  useEffect(() => {
    const f = () => fit()
    window.addEventListener('hf:fit', f)
    return () => window.removeEventListener('hf:fit', f)
  }, [fit])

  // imported sketch photos (drag-drop or the panel's import button)
  useEffect(() => {
    const load = async () => {
      const file = pendingImport.files[0]
      pendingImport.files = []
      if (!file) return
      const bmp = await createImageBitmap(file)
      const maxPx = 1600
      const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas')
      c.width = Math.round(bmp.width * k)
      c.height = Math.round(bmp.height * k)
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
      // place the photo over the buildable area
      const bw = plot.width - plot.setbacks.left - plot.setbacks.right
      const bd = plot.depth - plot.setbacks.front - plot.setbacks.rear
      const mpp = Math.min(bw / c.width, bd / c.height)
      useSketch.getState().set({ image: { url: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height, x: plot.setbacks.left, y: plot.setbacks.rear, mpp, data }, result: null })
      useUI.getState().toast({ kind: 'info', title: 'Sketch photo placed on the plot', body: 'Add room names with the Label tool if you like, then choose Recognize sketch.' })
    }
    const f = () => void load()
    window.addEventListener('hf:sketch-image', f)
    if (pendingImport.files.length) void load()
    return () => window.removeEventListener('hf:sketch-image', f)
  }, [plot])

  // background image element
  const imgEl = useRef<HTMLImageElement | null>(null)
  const [, force] = useState(0)
  useEffect(() => {
    if (!st.image) {
      imgEl.current = null
      return
    }
    const im = new Image()
    im.onload = () => force((n) => n + 1)
    im.src = st.image.url
    imgEl.current = im
  }, [st.image])

  const toW = (p: Vec2): Vec2 => ({ x: (p.x - view.ox) / view.scale, y: (p.y - view.oy) / view.scale })
  const toS = (p: Vec2): Vec2 => ({ x: p.x * view.scale + view.ox, y: p.y * view.scale + view.oy })

  // ── draw ──
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = size.w * dpr
    c.height = size.h * dpr
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = dark ? '#1f2226' : '#fbfaf7'
    g.fillRect(0, 0, size.w, size.h)
    const S = (p: Vec2) => toS(p)
    // grid
    const step = st.gridM * view.scale
    if (step > 5) {
      const b = bbox(plot.polygon)
      g.lineWidth = 1
      const x0 = Math.floor(b.x / st.gridM) * st.gridM
      const y0 = Math.floor(b.y / st.gridM) * st.gridM
      for (let x = x0, i = 0; x <= b.x + b.w + 1e-6; x += st.gridM, i++) {
        const major = Math.round(x / st.gridM) % 5 === 0
        g.strokeStyle = dark ? (major ? '#353a40' : '#2a2e33') : major ? '#dcd9d0' : '#ecebe5'
        const a = S({ x, y: b.y })
        const e = S({ x, y: b.y + b.h })
        g.beginPath()
        g.moveTo(Math.round(a.x) + 0.5, a.y)
        g.lineTo(Math.round(e.x) + 0.5, e.y)
        g.stroke()
        void i
      }
      for (let y = y0; y <= b.y + b.h + 1e-6; y += st.gridM) {
        const major = Math.round(y / st.gridM) % 5 === 0
        g.strokeStyle = dark ? (major ? '#353a40' : '#2a2e33') : major ? '#dcd9d0' : '#ecebe5'
        const a = S({ x: b.x, y })
        const e = S({ x: b.x + b.w, y })
        g.beginPath()
        g.moveTo(a.x, Math.round(a.y) + 0.5)
        g.lineTo(e.x, Math.round(e.y) + 0.5)
        g.stroke()
      }
    }
    // plot + setbacks + road
    const poly = (pts: Vec2[], stroke: string, w: number, dash: number[] = []) => {
      g.beginPath()
      pts.forEach((p, i) => {
        const q = S(p)
        if (i) g.lineTo(q.x, q.y)
        else g.moveTo(q.x, q.y)
      })
      g.closePath()
      g.setLineDash(dash)
      g.strokeStyle = stroke
      g.lineWidth = w
      g.stroke()
      g.setLineDash([])
    }
    poly(plot.polygon, dark ? '#b8962f' : '#b07f00', 1.4, [10, 4, 2, 4])
    const pb = bbox(plot.polygon)
    const sb = plot.setbacks
    poly(
      [
        { x: pb.x + sb.left, y: pb.y + sb.rear },
        { x: pb.x + pb.w - sb.right, y: pb.y + sb.rear },
        { x: pb.x + pb.w - sb.right, y: pb.y + pb.h - sb.front },
        { x: pb.x + sb.left, y: pb.y + pb.h - sb.front }
      ],
      dark ? '#5a5f66' : '#b9b5ab',
      1,
      [4, 4]
    )
    const road = S({ x: pb.x + pb.w / 2, y: pb.y + pb.h + 1.2 })
    g.fillStyle = dark ? '#6e767f' : '#8a939c'
    g.font = "500 11px 'Archivo Variable', sans-serif"
    g.textAlign = 'center'
    g.fillText('Road side', road.x, road.y)
    // the existing plan of this floor, faint, so new rooms can be drawn against it
    if (floor?.rooms.length && st.mode === 'add') {
      for (const r of floor.rooms) {
        if (r.type === 'void') continue
        g.beginPath()
        r.polygon.forEach((p, i) => {
          const q = S(p)
          if (i) g.lineTo(q.x, q.y)
          else g.moveTo(q.x, q.y)
        })
        g.closePath()
        g.fillStyle = dark ? 'rgba(230,232,234,0.05)' : 'rgba(27,31,36,0.04)'
        g.fill()
        g.strokeStyle = dark ? 'rgba(230,232,234,0.35)' : 'rgba(27,31,36,0.35)'
        g.lineWidth = 2
        g.stroke()
        const c = S(centroid(r.polygon))
        g.fillStyle = dark ? 'rgba(230,232,234,0.45)' : 'rgba(27,31,36,0.45)'
        g.font = "500 11px 'Archivo Variable', sans-serif"
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(r.name, c.x, c.y)
      }
    }
    // imported sketch photo
    if (st.image && imgEl.current?.complete) {
      const tl = S({ x: st.image.x, y: st.image.y })
      g.globalAlpha = st.result ? 0.35 : 0.8
      g.drawImage(imgEl.current, tl.x, tl.y, st.image.w * st.image.mpp * view.scale, st.image.h * st.image.mpp * view.scale)
      g.globalAlpha = 1
    }
    // recognized plan overlay
    if (st.result) {
      for (const r of st.result.rooms) {
        g.beginPath()
        r.polygon.forEach((p, i) => {
          const q = S(p)
          if (i) g.lineTo(q.x, q.y)
          else g.moveTo(q.x, q.y)
        })
        g.closePath()
        g.fillStyle = spec(r.type).tint + (dark ? '38' : '99')
        g.fill()
      }
      g.strokeStyle = dark ? '#4da8da' : '#1f7fb5'
      g.lineWidth = 3
      g.lineCap = 'round'
      for (const w of st.result.walls) {
        const a = S(w.a)
        const b = S(w.b)
        g.beginPath()
        g.moveTo(a.x, a.y)
        g.lineTo(b.x, b.y)
        g.stroke()
      }
      for (const o of st.result.openings) {
        const c = S(o.at)
        const half = (o.width / 2) * view.scale
        g.strokeStyle = o.kind === 'door' ? (dark ? '#1f2226' : '#fbfaf7') : dark ? '#9fd3ef' : '#4b8db3'
        g.lineWidth = o.kind === 'door' ? 5 : 4
        g.beginPath()
        if (o.horizontal) {
          g.moveTo(c.x - half, c.y)
          g.lineTo(c.x + half, c.y)
        } else {
          g.moveTo(c.x, c.y - half)
          g.lineTo(c.x, c.y + half)
        }
        g.stroke()
      }
      for (const r of st.result.rooms) {
        const c = S(centroid(r.polygon))
        g.fillStyle = dark ? '#e6e8ea' : '#1b1f24'
        g.font = "600 12px 'Archivo Variable', sans-serif"
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(r.name, c.x, c.y - 8)
        if (r.confidence < 0.6 && !st.confirmed.includes(r.id)) {
          g.fillStyle = dark ? '#f0b823' : '#d99a00'
          g.beginPath()
          g.arc(c.x, c.y + 12, 9, 0, Math.PI * 2)
          g.fill()
          g.fillStyle = '#1b1f24'
          g.font = "700 12px 'Archivo Variable', sans-serif"
          g.fillText('?', c.x, c.y + 12.5)
        }
      }
    }
    // ink
    const ink = dark ? INK_DARK : INK_LIGHT
    const drawStroke = (pts: Vec2[], pressure?: number[]) => {
      if (pts.length < 2) return
      g.strokeStyle = ink
      g.lineCap = 'round'
      g.lineJoin = 'round'
      g.globalAlpha = st.result ? 0.35 : 0.95
      for (let i = 1; i < pts.length; i++) {
        const a = S(pts[i - 1])
        const b = S(pts[i])
        g.lineWidth = 1.2 + (pressure?.[i] ?? 0.5) * 2.4
        g.beginPath()
        g.moveTo(a.x, a.y)
        g.lineTo(b.x, b.y)
        g.stroke()
      }
      g.globalAlpha = 1
    }
    for (const s of st.strokes) drawStroke(s.pts)
    if (live.current) drawStroke(live.current.pts, live.current.pressure)
    for (const t of st.texts) {
      const p = S(t.p)
      g.fillStyle = ink
      g.globalAlpha = st.result ? 0.5 : 1
      g.font = "italic 500 14px 'Archivo Variable', sans-serif"
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(t.text, p.x, p.y)
      g.globalAlpha = 1
    }
  })

  // ── input ──
  const onDown = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    const sp = { x: e.clientX - r.left, y: e.clientY - r.top }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    if (e.button === 1 || st.tool === 'pan' || (e.button === 0 && e.altKey)) {
      pan.current = { x: sp.x, y: sp.y, ox: view.ox, oy: view.oy }
      return
    }
    if (e.button !== 0) return
    const w = toW(sp)
    if (st.result) {
      const hit = st.result.rooms.find((room) => {
        const b = bbox(room.polygon)
        return w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h
      })
      if (hit && st.tool !== 'eraser') {
        setAsk({ id: hit.id, screen: sp })
        useSketch.getState().set({ focusRoom: hit.id })
        return
      }
    }
    if (st.tool === 'text') {
      // keep focus off the canvas so the label field that appears keeps it
      e.preventDefault()
      setTextAt({ world: w, screen: sp })
      setTextVal('')
      return
    }
    if (st.tool === 'eraser') {
      erase(w)
      live.current = { pts: [w], pressure: [] }
      return
    }
    live.current = { pts: [w], pressure: [e.pressure || 0.5] }
  }
  const erase = (w: Vec2) => {
    const s = useSketch.getState()
    const r = 0.35
    const strokes = s.strokes.filter((k) => !k.pts.some((p) => Math.hypot(p.x - w.x, p.y - w.y) < r))
    const texts = s.texts.filter((t) => Math.hypot(t.p.x - w.x, t.p.y - w.y) > r * 2)
    if (strokes.length !== s.strokes.length || texts.length !== s.texts.length) s.set({ strokes, texts, result: null })
  }
  const onMove = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    const sp = { x: e.clientX - r.left, y: e.clientY - r.top }
    if (pan.current) {
      setView((v) => ({ ...v, ox: pan.current!.ox + sp.x - pan.current!.x, oy: pan.current!.oy + sp.y - pan.current!.y }))
      return
    }
    if (!live.current) return
    const w = toW(sp)
    if (st.tool === 'eraser') {
      erase(w)
      return
    }
    const last = live.current.pts[live.current.pts.length - 1]
    if (Math.hypot((w.x - last.x) * view.scale, (w.y - last.y) * view.scale) < 2) return
    // coalesced events give smoother tablet strokes
    const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? []
    if (evs.length > 1)
      for (const ce of evs) {
        const q = toW({ x: ce.clientX - r.left, y: ce.clientY - r.top })
        live.current.pts.push(q)
        live.current.pressure.push(ce.pressure || 0.5)
      }
    else {
      live.current.pts.push(w)
      live.current.pressure.push(e.pressure || 0.5)
    }
    force((n) => n + 1)
  }
  const onUp = () => {
    pan.current = null
    const l = live.current
    live.current = null
    if (!l || st.tool === 'eraser') return
    if (l.pts.length >= 2) useSketch.getState().addStroke({ pts: l.pts })
  }
  const onWheel = (e: React.WheelEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    const sp = { x: e.clientX - r.left, y: e.clientY - r.top }
    const k = Math.exp(-e.deltaY * 0.0015)
    setView((v) => {
      const scale = Math.max(4, Math.min(400, v.scale * k))
      const wx = (sp.x - v.ox) / v.scale
      const wy = (sp.y - v.oy) / v.scale
      return { scale, ox: sp.x - wx * scale, oy: sp.y - wy * scale }
    })
  }

  // test hook (?e2e): plan metres → page pixels for scripted drawing
  useEffect(() => {
    const hf = (window as unknown as { __hf?: Record<string, unknown> }).__hf
    if (!hf) return
    hf.sketchToScreen = (p: Vec2) => {
      const r = wrap.current!.getBoundingClientRect()
      return { x: r.left + p.x * view.scale + view.ox, y: r.top + p.y * view.scale + view.oy }
    }
  }, [view])

  const askRoom = ask ? st.result?.rooms.find((r) => r.id === ask.id) : undefined
  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: st.tool === 'pan' ? 'grab' : st.tool === 'text' ? 'text' : st.tool === 'eraser' ? 'cell' : 'crosshair' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} aria-label="Sketch canvas">
      <canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block' }} />
      {!st.strokes.length && !st.image && !st.texts.length && !(floor?.rooms.length && st.mode === 'add') && (
        <div className="overlay faint" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none', maxWidth: 380 }}>
          <div style={{ fontSize: 15, color: 'var(--text-2)', marginBottom: 6 }}>Draw your house inside the plot</div>
          Draw room outlines with the pen; leave a gap or draw an arc for a door. Use the Label tool to type room names like “Bedroom” or “Kitchen 10x12”. Or drop a photo of a paper sketch here.
        </div>
      )}
      {!!floor?.rooms.length && st.mode === 'add' && !st.result && (
        <div className="overlay float-bar" style={{ top: 12, left: '50%', transform: 'translateX(-50%)', padding: '6px 12px', fontSize: 12, color: 'var(--text-2)', pointerEvents: 'none' }}>
          Draw new rooms against the {floor.name.toLowerCase()} floor plan. Lines snap to its walls.
        </div>
      )}
      {textAt && (
        <input
          autoFocus
          ref={(el) => {
            if (el) setTimeout(() => el.focus(), 0)
          }}
          className="field"
          style={{ position: 'absolute', left: textAt.screen.x - 70, top: textAt.screen.y - 14, width: 140, zIndex: 5 }}
          placeholder="Bedroom, Kitchen 10x12…"
          value={textVal}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setTextVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && textVal.trim()) {
              useSketch.getState().addText({ p: textAt.world, text: textVal.trim() })
              setTextAt(null)
            }
            if (e.key === 'Escape') setTextAt(null)
          }}
          onBlur={() => {
            if (textVal.trim()) useSketch.getState().addText({ p: textAt.world, text: textVal.trim() })
            setTextAt(null)
          }}
        />
      )}
      {ask && askRoom && (
        <div className="menu" style={{ position: 'absolute', left: Math.min(ask.screen.x, size.w - 250), top: Math.min(ask.screen.y + 8, size.h - 150), width: 240, padding: 10, zIndex: 6 }} onPointerDown={(e) => e.stopPropagation()}>
          <div style={{ marginBottom: 8 }}>{askRoom.confidence < 0.6 && !st.confirmed.includes(askRoom.id) ? `Did you mean this to be a ${spec(askRoom.type).label.toLowerCase()}?` : `${askRoom.name}`}</div>
          <div className="faint" style={{ fontSize: 11, marginBottom: 8 }}>
            {askRoom.reason}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm primary" onClick={() => {
                useSketch.getState().setRoomType(askRoom.id, askRoom.type, askRoom.name)
                setAsk(null)
              }}>
              Yes
            </button>
            <select className="field" style={{ flex: 1 }} value="" onChange={(e) => {
                const t = e.target.value as typeof askRoom.type
                useSketch.getState().setRoomType(askRoom.id, t, spec(t).label)
                setAsk(null)
              }} aria-label="Choose room type">
              <option value="">No, it is a…</option>
              {(['bedroom', 'master_bedroom', 'bathroom', 'kitchen', 'tv_lounge', 'drawing', 'dining', 'store', 'stair', 'corridor', 'garage', 'study', 'laundry', 'prayer', 'terrace'] as const).map((t) => (
                <option key={t} value={t}>
                  {spec(t).label}
                </option>
              ))}
            </select>
          </div>
          <button className="btn sm" style={{ marginTop: 6, width: '100%' }} onClick={() => setAsk(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  )
}
