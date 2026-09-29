import { useCallback, useEffect, useRef, useState } from 'react'
import type { Draft } from 'immer'
import type { EntityRef, Floor, Project, RoomType, SiteAreaKind, SiteObjectKind, Vec2, DoorStyle, WindowStyle, StairType } from '../core/model/types'
import { useProject, commit, getProject } from '../state/store'
import { useUI, type Tool } from '../state/ui'
import { CanvasContext, toScreen, toWorld, type ViewTransform } from '../render/draw/canvas'
import { drawPlan, drawDimension, drawFurniture, drawNorthArrow } from '../render/draw/plan'
import { DARK_PLAN, LIGHT_PLAN, type PlanTheme } from '../render/draw/theme'
import { bbox, isAxisRect, pointInPolygon, rectPoly, area, type Rect } from '../core/geometry/polygon'
import { projectT, segLength } from '../core/geometry/segment'
import { add, dist, norm, rotate, scale, sub } from '../core/geometry/vec'
import { snapPoint, constrainAngle, type Guide, type SnapResult } from './snapping'
import { hitTest, nearestWall, roomAt } from './hitTest'
import { addRectRoom, addPolygonRoom, moveRoomEdge, refreshFloor, splitRoom, translateRoom, type Side } from '../planner/operations'
import { uid } from '../core/model/ids'
import { formatLength, formatAreaFor } from '../core/units/units'
import { catalogItem } from '../core/furniture/catalog'
import { spec } from '../core/constraints/rooms'
import { findFaces } from '../core/geometry/planar'
import { effectiveKind, lineOverlap } from '../planner/walls'
import { risersFor, stairGeometry, localSize } from '../planner/stairs'
import { furnishRoom } from '../planner/furnish'
import { northAngle } from '../engine/lighting/sun'
import { openContextMenu, type MenuItem } from '../ui/primitives'
import { deleteSelection, duplicateSelection, rotateSelection, copySelection } from './commands'
import { applySmartLabels, guessRoomType } from '../planner/labels'
import { sortedFloors } from '../core/model/house'

type Interaction =
  | { type: 'pan'; start: Vec2; view0: ViewTransform }
  | { type: 'move-room'; id: string; start: Vec2 }
  | { type: 'room-edge'; id: string; side: Side; start: Vec2 }
  | { type: 'room-vertex'; id: string; index: number }
  | { type: 'move-wall'; id: string; start: Vec2 }
  | { type: 'move-opening'; id: string; grab: number }
  | { type: 'resize-opening'; id: string; end: 'start' | 'end' }
  | { type: 'move-item'; kind: 'furniture' | 'column' | 'stair' | 'siteObject' | 'annotation' | 'siteArea'; id: string; start: Vec2 }
  | { type: 'rotate-item'; id: string }
  | { type: 'resize-item'; id: string; corner: Vec2 }
  | { type: 'marquee'; start: Vec2; cur: Vec2 }
  | { type: 'draw-rect'; tool: Tool; start: Vec2; cur: Vec2 }
  | { type: 'plot-vertex'; index: number }

const HANDLE = 5

export function PlanView() {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<ViewTransform>({ scale: 30, ox: 100, oy: 60 })
  const inter = useRef<Interaction | null>(null)
  const cursor = useRef<Vec2 | null>(null)
  const snapRef = useRef<SnapResult | null>(null)
  const wallChain = useRef<Vec2[]>([])
  const dimDraft = useRef<{ a: Vec2; b?: Vec2 } | null>(null)
  const measure = useRef<{ a: Vec2; b?: Vec2 } | null>(null)
  const splitTarget = useRef<string | null>(null)
  const spaceDown = useRef(false)
  const raf = useRef(0)
  const [textAt, setTextAt] = useState<{ p: Vec2; s: Vec2; value: string; renameRoom?: string } | null>(null)
  const [readout, setReadout] = useState<string | null>(null)

  const floorOf = (p: Project) => p.floors.find((f) => f.id === useUI.getState().floorId) ?? p.floors[0]

  // ── drawing ───────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    raf.current = 0
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const W = c.width / dpr
    const H = c.height / dpr
    const ui = useUI.getState()
    const p = getProject()
    const floor = floorOf(p)
    const theme: PlanTheme = ui.theme === 'light' ? LIGHT_PLAN : DARK_PLAN
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = theme.paper
    ctx.fillRect(0, 0, c.width, c.height)
    drawGrid(ctx, view.current, W, H, dpr, p.settings.grid, theme, p.settings.units)
    if (!floor) return
    const dc = new CanvasContext(ctx, view.current, dpr)
    const below = sortedFloors(p.floors).find((f) => f.level === floor.level - 1)
    drawPlan(dc, p, floor, {
      theme,
      layers: p.settings.layers,
      units: p.settings.units,
      showSite: floor.level === 0,
      ghost: floor.level > 0 ? below : undefined,
      materials: p.materials,
      lite: !!inter.current && inter.current.type !== 'pan' && inter.current.type !== 'marquee'
    })
    // north arrow (bottom-right screen corner, clear of the panel toggle and floor stack)
    const na = northAngle(p.plot)
    const nw = toWorld(view.current, { x: W - 44, y: H - 52 })
    drawNorthArrow(dc, nw, 18 / view.current.scale, na, theme)

    // selection & hover
    const sel = ui.selection
    const hl = (ref: EntityRef, color: string, fillAlpha: number) => {
      if (ref.kind === 'room') {
        const r = floor.rooms.find((x) => x.id === ref.id)
        if (r) dc.polygon(r.polygon, fillAlpha ? { color, opacity: fillAlpha } : null, { color, width: 1.6 })
      } else if (ref.kind === 'wall') {
        const w = floor.walls.find((x) => x.id === ref.id)
        if (w) {
          const n = { x: -(w.b.y - w.a.y), y: w.b.x - w.a.x }
          const l = Math.hypot(n.x, n.y) || 1
          const h = Math.max(w.thickness, 0.08) / 2
          const o = { x: (n.x / l) * h, y: (n.y / l) * h }
          dc.polygon([add(w.a, o), add(w.b, o), sub(w.b, o), sub(w.a, o)], { color, opacity: fillAlpha || 0.25 }, { color, width: 1.4 })
        }
      } else if (ref.kind === 'opening') {
        const o = floor.openings.find((x) => x.id === ref.id)
        const w = o && floor.walls.find((x) => x.id === o.wallId)
        if (o && w) {
          const d = norm(sub(w.b, w.a))
          const a = add(w.a, scale(d, o.offset - o.width / 2))
          const b = add(w.a, scale(d, o.offset + o.width / 2))
          const n = { x: -d.y * (w.thickness / 2 + 0.06), y: d.x * (w.thickness / 2 + 0.06) }
          dc.polygon([add(a, n), add(b, n), sub(b, n), sub(a, n)], { color, opacity: 0.25 }, { color, width: 1.4 })
        }
      } else if (ref.kind === 'furniture') {
        const f = floor.furniture.find((x) => x.id === ref.id)
        if (f) dc.polygon(itemCorners(f.position, f.width, f.depth, f.rotation), { color, opacity: 0.15 }, { color, width: 1.4 })
      } else if (ref.kind === 'column') {
        const f = floor.columns.find((x) => x.id === ref.id)
        if (f) dc.polygon(itemCorners(f.position, f.width + 0.1, f.depth + 0.1, f.rotation), null, { color, width: 1.6 })
      } else if (ref.kind === 'stair') {
        const s = floor.stairs.find((x) => x.id === ref.id)
        if (s) dc.polygon(stairGeometry(s, floor.height).outline, { color, opacity: 0.12 }, { color, width: 1.6 })
      } else if (ref.kind === 'siteArea') {
        const a = p.site.areas.find((x) => x.id === ref.id)
        if (a) dc.polygon(a.polygon, { color, opacity: 0.12 }, { color, width: 1.6 })
      } else if (ref.kind === 'siteObject') {
        const o = p.site.objects.find((x) => x.id === ref.id)
        if (o) dc.circle(o.position, 0.7 * o.scale, null, { color, width: 1.6 })
      } else if (ref.kind === 'annotation') {
        const a = floor.annotations.find((x) => x.id === ref.id)
        if (a?.kind === 'text') dc.circle(a.position, 0.2, null, { color, width: 1.4 })
        else if (a) drawDimension(dc, a.a, a.b, a.offset, theme, p.settings.units, color)
      }
    }
    if (ui.hover && !sel.some((s) => s.id === ui.hover!.id)) hl(ui.hover, theme.hover, 0.06)
    for (const s of sel) hl(s, theme.select, s.kind === 'room' ? 0.1 : 0)

    // handles
    if (sel.length === 1) drawHandles(ctx, dpr, sel[0], floor, p, theme)

    // tool previews
    const cur = cursor.current
    const it = inter.current
    const tool = ui.tool
    const units = p.settings.units
    const S = { color: theme.select, width: 1.4 }
    const label = (pw: Vec2, text: string) => {
      const s = toScreen(view.current, pw)
      ctx.save()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.font = '600 12px "Archivo Variable", sans-serif'
      const tw = ctx.measureText(text).width
      ctx.fillStyle = theme.select
      ctx.fillRect(s.x + 10, s.y - 22, tw + 12, 20)
      ctx.fillStyle = '#1b1f24'
      ctx.fillText(text, s.x + 16, s.y - 8)
      ctx.restore()
    }
    if (it?.type === 'draw-rect') {
      const r = normRect(it.start, it.cur)
      dc.polygon(rectPoly(r), { color: theme.select, opacity: 0.12 }, S)
      label(it.cur, `${formatLength(r.w, units)} × ${formatLength(r.h, units)}  (${formatAreaFor(r.w * r.h, units)})`)
    }
    if (it?.type === 'marquee') {
      const r = normRect(it.start, it.cur)
      dc.polygon(rectPoly(r), { color: theme.hover, opacity: 0.08 }, { color: theme.hover, width: 1, dash: [4, 3] })
    }
    if (tool === 'wall' && wallChain.current.length && cur) {
      const pts = [...wallChain.current, cur]
      dc.polyline(pts, { color: theme.select, width: 3 })
      const a = wallChain.current[wallChain.current.length - 1]
      label(cur, formatLength(dist(a, cur), units))
    }
    if ((tool === 'door' || tool === 'window') && cur) {
      const nw = nearestWall(cur, floor, view.current.scale)
      if (nw) {
        const w = floor.walls.find((x) => x.id === nw.wallId)!
        const width = openingWidth(tool, ui.toolOption)
        const d = norm(sub(w.b, w.a))
        const L = segLength(w.a, w.b)
        const off = Math.min(Math.max(nw.offset, width / 2 + 0.05), L - width / 2 - 0.05)
        const a = add(w.a, scale(d, off - width / 2))
        const b = add(w.a, scale(d, off + width / 2))
        const n = { x: -d.y * (w.thickness / 2 + 0.05), y: d.x * (w.thickness / 2 + 0.05) }
        dc.polygon([add(a, n), add(b, n), sub(b, n), sub(a, n)], { color: theme.select, opacity: 0.35 }, S)
        label(cur, `${tool === 'door' ? 'Door' : 'Window'} ${formatLength(width, units)}`)
      }
    }
    if (tool === 'furniture' && cur && ui.toolOption) {
      const c = catalogItem(ui.toolOption)
      if (c) drawFurniture(dc, { id: 'ghost', type: c.key, position: cur, rotation: ghostRot.current, width: c.w, depth: c.d, height: c.h }, theme)
    }
    if (tool === 'stair' && cur) {
      const t = (ui.toolOption as StairType) || 'U'
      const s = ghostStair(cur, t, floor.height)
      dc.polygon(stairGeometry(s, floor.height).outline, { color: theme.select, opacity: 0.15 }, S)
    }
    if (tool === 'column' && cur) dc.polygon(itemCorners(cur, 0.3, 0.3, 0), { color: theme.select, opacity: 0.6 }, S)
    if (tool === 'dimension' && dimDraft.current && cur) {
      const d = dimDraft.current
      if (!d.b) {
        dc.line(d.a, cur, { color: theme.select, width: 1 })
        label(cur, formatLength(dist(d.a, cur), units))
      } else drawDimension(dc, d.a, d.b, offsetFor(d.a, d.b, cur), theme, units, theme.select)
    }
    if (tool === 'measure' && measure.current && cur) {
      const m = measure.current
      const b = m.b ?? cur
      dc.line(m.a, b, { color: theme.hover, width: 1.6, dash: [6, 3] })
      dc.circle(m.a, 3 / view.current.scale, { color: theme.hover }, null)
      label(b, formatLength(dist(m.a, b), units))
    }
    if (tool === 'split' && splitTarget.current && cur) {
      const r = floor.rooms.find((x) => x.id === splitTarget.current)
      if (r) {
        const b = bbox(r.polygon)
        const vertical = splitAxis(b, cur) === 'x'
        if (vertical) dc.line({ x: cur.x, y: b.y }, { x: cur.x, y: b.y + b.h }, { color: theme.select, width: 2, dash: [6, 4] })
        else dc.line({ x: b.x, y: cur.y }, { x: b.x + b.w, y: cur.y }, { color: theme.select, width: 2, dash: [6, 4] })
      }
    }
    // snap indicators
    const sn = snapRef.current
    if (sn && cur && tool !== 'select' && tool !== 'pan') {
      for (const g of sn.guides) dc.line(g.a, g.b, { color: theme.snap, width: 1, dash: [4, 4] })
      if (sn.kind === 'endpoint' || sn.kind === 'midpoint') dc.polygon(itemCorners(sn.p, 8 / view.current.scale, 8 / view.current.scale, Math.PI / 4), null, { color: theme.snap, width: 1.6 })
      else if (sn.kind === 'wall') dc.circle(sn.p, 4 / view.current.scale, null, { color: theme.snap, width: 1.6 })
      else dc.circle(sn.p, 2.5 / view.current.scale, { color: theme.snap }, null)
    }
    if (it && (it.type === 'move-room' || it.type === 'room-edge' || it.type === 'move-item' || it.type === 'move-wall') && snapRef.current)
      for (const g of snapRef.current.guides) dc.line(g.a, g.b, { color: theme.snap, width: 1, dash: [4, 4] })
  }, [])

  const request = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw)
  }, [draw])

  function drawHandles(ctx: CanvasRenderingContext2D, dpr: number, ref: EntityRef, floor: Floor, p: Project, theme: PlanTheme) {
    const hs = handlesFor(ref, floor, p)
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    for (const h of hs) {
      const s = toScreen(view.current, h.p)
      ctx.beginPath()
      if (h.round) ctx.arc(s.x, s.y, HANDLE, 0, Math.PI * 2)
      else ctx.rect(s.x - HANDLE, s.y - HANDLE, HANDLE * 2, HANDLE * 2)
      ctx.fillStyle = theme.paper
      ctx.fill()
      ctx.lineWidth = 1.6
      ctx.strokeStyle = theme.select
      ctx.stroke()
    }
    ctx.restore()
  }

  // ── subscriptions ─────────────────────────────────────────────────────────
  useEffect(() => {
    const a = useProject.subscribe(request)
    const b = useUI.subscribe((s, prev) => {
      if (s.floorId !== prev.floorId) fit()
      if (s.tool !== prev.tool) {
        wallChain.current = []
        dimDraft.current = null
        measure.current = null
        splitTarget.current = null
        setReadout(null)
      }
      request()
    })
    const onFit = () => fit()
    const onCancel = () => {
      commitWallChain()
      wallChain.current = []
      dimDraft.current = null
      measure.current = null
      splitTarget.current = null
      if (inter.current && inter.current.type !== 'pan') useProject.getState().cancel()
      inter.current = null
      request()
    }
    window.addEventListener('hf:fit', onFit)
    window.addEventListener('hf:cancel', onCancel)
    return () => {
      a()
      b()
      window.removeEventListener('hf:fit', onFit)
      window.removeEventListener('hf:cancel', onCancel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  // resize
  useEffect(() => {
    const el = wrap.current
    const c = canvas.current
    if (!el || !c) return
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      c.width = Math.max(1, el.clientWidth * dpr)
      c.height = Math.max(1, el.clientHeight * dpr)
      c.style.width = `${el.clientWidth}px`
      c.style.height = `${el.clientHeight}px`
      request()
    })
    ro.observe(el)
    fit()
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function fit() {
    const el = wrap.current
    if (!el) return
    const p = getProject()
    const floor = floorOf(p)
    const pts = floor?.level === 0 || !floor?.rooms.length ? p.plot.polygon : floor.rooms.flatMap((r) => r.polygon)
    const b = bbox(pts)
    const W = el.clientWidth
    const H = el.clientHeight
    const s = Math.min((W - 140) / Math.max(1, b.w), (H - 120) / Math.max(1, b.h + (floor?.level === 0 ? 4 : 0)))
    view.current = { scale: Math.max(4, Math.min(160, s)), ox: W / 2 - (b.x + b.w / 2) * s, oy: H / 2 - (b.y + b.h / 2 + (floor?.level === 0 ? 1.5 : 0)) * s }
    request()
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  const world = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect()
    return toWorld(view.current, { x: e.clientX - r.left, y: e.clientY - r.top })
  }
  const snapCtx = (exclude?: (p: Vec2) => boolean, disabled = false) => {
    const p = getProject()
    return { floor: floorOf(p), house: p, settings: p.settings, pxPerM: view.current.scale, exclude, disabled }
  }
  const ghostRot = useRef(0)

  function handlesFor(ref: EntityRef, floor: Floor, p: Project): { p: Vec2; id: string; round?: boolean }[] {
    const out: { p: Vec2; id: string; round?: boolean }[] = []
    if (ref.kind === 'room') {
      const r = floor.rooms.find((x) => x.id === ref.id)
      if (!r) return out
      if (isAxisRect(r.polygon)) {
        const b = bbox(r.polygon)
        out.push({ p: { x: b.x, y: b.y + b.h / 2 }, id: 'edge:left' }, { p: { x: b.x + b.w, y: b.y + b.h / 2 }, id: 'edge:right' }, { p: { x: b.x + b.w / 2, y: b.y }, id: 'edge:top' }, { p: { x: b.x + b.w / 2, y: b.y + b.h }, id: 'edge:bottom' })
      } else r.polygon.forEach((v, i) => out.push({ p: v, id: `vertex:${i}`, round: true }))
    } else if (ref.kind === 'opening') {
      const o = floor.openings.find((x) => x.id === ref.id)
      const w = o && floor.walls.find((x) => x.id === o.wallId)
      if (o && w) {
        const d = norm(sub(w.b, w.a))
        out.push({ p: add(w.a, scale(d, o.offset - o.width / 2)), id: 'end:start', round: true }, { p: add(w.a, scale(d, o.offset + o.width / 2)), id: 'end:end', round: true })
      }
    } else if (ref.kind === 'furniture') {
      const f = floor.furniture.find((x) => x.id === ref.id)
      if (f) {
        const cs = itemCorners(f.position, f.width, f.depth, f.rotation)
        cs.forEach((c, i) => out.push({ p: c, id: `corner:${i}` }))
        out.push({ p: add(f.position, rotate({ x: 0, y: -(f.depth / 2 + 0.45) }, f.rotation)), id: 'rotate', round: true })
      }
    } else if (ref.kind === 'plot') {
      p.plot.polygon.forEach((v, i) => out.push({ p: v, id: `plot:${i}`, round: true }))
    }
    return out
  }

  const handleAt = (w: Vec2) => {
    const ui = useUI.getState()
    if (ui.selection.length !== 1) return null
    const p = getProject()
    const floor = floorOf(p)
    if (!floor) return null
    const tol = (HANDLE + 3) / view.current.scale
    return handlesFor(ui.selection[0], floor, p).find((h) => dist(h.p, w) < tol) ?? null
  }

  // ── tool actions ──────────────────────────────────────────────────────────
  function commitWallChain(close = false) {
    const pts = wallChain.current
    if (pts.length < 2) {
      wallChain.current = []
      return
    }
    const floorId = useUI.getState().floorId
    commit('Draw walls', (d) => {
      const f = d.floors.find((x) => x.id === floorId)
      if (!f) return
      const all = close ? [...pts, pts[0]] : pts
      for (let i = 0; i < all.length - 1; i++) {
        if (dist(all[i], all[i + 1]) < 0.05) continue
        f.walls.push({ id: uid('wal'), a: { ...all[i] }, b: { ...all[i + 1] }, thickness: d.settings.wallThickness.interior * (useUI.getState().toolOption === 'exterior' ? 2 : 1), kind: 'interior', source: 'manual' })
      }
      // closed loops of walls become rooms
      const manual = f.walls.filter((w) => w.source === 'manual')
      const faces = findFaces(
        [...manual.map((w) => ({ a: w.a, b: w.b })), ...f.rooms.flatMap((r) => r.polygon.map((p, i) => ({ a: p, b: r.polygon[(i + 1) % r.polygon.length] })))],
        0.08,
        1.2
      )
      let made = 0
      for (const face of faces) {
        const c = centroidOf(face)
        if (f.rooms.some((r) => pointInPolygon(c, r.polygon))) continue
        const room = { id: uid('rm'), name: 'Room', autoName: true, type: 'custom' as RoomType, polygon: face }
        f.rooms.push(room)
        const g = guessRoomType(f as Floor, room)
        room.type = g.type
        room.name = spec(g.type).label
        made++
      }
      if (made) {
        // walls that now coincide with room edges become room walls
        refreshFloor(f as Floor, d.settings)
        f.walls = f.walls.filter((w) => w.source !== 'manual' || !f.walls.some((x) => x.source === 'rooms' && lineOverlap(x, w) > segLength(w.a, w.b) * 0.8))
        applySmartLabels(d as unknown as Project)
      }
    })
    wallChain.current = []
    request()
  }

  function placeAt(w: Vec2, tool: Tool, e: React.PointerEvent) {
    const ui = useUI.getState()
    const p = getProject()
    const floor = floorOf(p)
    if (!floor) return
    const floorId = floor.id
    const opt = ui.toolOption
    switch (tool) {
      case 'door':
      case 'window': {
        const nw = nearestWall(w, floor, view.current.scale)
        if (!nw) {
          ui.toast({ kind: 'warning', title: `Click on a wall to place a ${tool}` })
          return
        }
        const wall = floor.walls.find((x) => x.id === nw.wallId)!
        const width = openingWidth(tool, opt)
        const L = segLength(wall.a, wall.b)
        if (L < width + 0.1) {
          ui.toast({ kind: 'warning', title: 'This wall is too short', body: `It needs at least ${formatLength(width + 0.1, p.settings.units)} for this ${tool}.` })
          return
        }
        const offset = Math.min(Math.max(nw.offset, width / 2 + 0.05), L - width / 2 - 0.05)
        const style = (opt || (tool === 'door' ? 'single' : 'casement')) as DoorStyle | WindowStyle
        const id = uid('opn')
        commit(`Add ${tool}`, (d) => {
          const f = d.floors.find((x) => x.id === floorId)!
          const isDoor = tool === 'door'
          f.openings.push({
            id,
            kind: tool,
            wallId: wall.id,
            offset,
            width,
            height: isDoor ? (style === 'garage' ? 2.4 : 2.13) : style === 'full-height' ? Math.min(2.4, f.height - f.slabThickness - 0.3) : style === 'ventilator' ? 0.6 : 1.4,
            sill: isDoor ? 0 : style === 'full-height' ? 0.1 : style === 'ventilator' ? 1.8 : 0.9,
            style,
            hinge: 'start',
            swing: nw.side
          })
        })
        ui.select([{ kind: 'opening', id, floorId }])
        break
      }
      case 'column': {
        const id = uid('col')
        commit('Add column', (d) => {
          d.floors.find((x) => x.id === floorId)!.columns.push({ id, position: w, width: 0.3, depth: 0.3, rotation: 0, shape: opt === 'round' ? 'round' : 'rect', exposed: !roomAt(w, floor) })
        })
        ui.select([{ kind: 'column', id, floorId }])
        break
      }
      case 'stair': {
        const t = (opt as StairType) || 'U'
        const s = { ...ghostStair(w, t, floor.height), id: uid('str') }
        commit('Add stair', (d) => {
          d.floors.find((x) => x.id === floorId)!.stairs.push(s)
        })
        ui.select([{ kind: 'stair', id: s.id, floorId }])
        break
      }
      case 'furniture': {
        const c = catalogItem(opt ?? '')
        if (!c) {
          ui.toast({ kind: 'info', title: 'Pick an item from the furniture bar first' })
          return
        }
        const id = uid('fur')
        const snapped = snapFurnitureToWall(w, c.w, c.d, floor, ghostRot.current)
        commit(`Add ${c.name.toLowerCase()}`, (d) => {
          d.floors.find((x) => x.id === floorId)!.furniture.push({ id, type: c.key, position: snapped.p, rotation: snapped.rot, width: c.w, depth: c.d, height: c.h, elevation: c.elevation })
        })
        ui.select([{ kind: 'furniture', id, floorId }])
        break
      }
      case 'garden': {
        const kind = (opt ?? 'tree') as SiteObjectKind | SiteAreaKind
        if (['lawn', 'walkway', 'garden_bed', 'deck', 'play_area'].includes(kind)) return // drawn as rectangles
        const id = uid('obj')
        commit(`Add ${kind.replace('_', ' ')}`, (d) => {
          d.site.objects.push({ id, kind: kind as SiteObjectKind, position: w, rotation: 0, scale: 1, width: kind === 'hedge' ? 3 : kind === 'pergola' ? 3.5 : undefined, depth: kind === 'hedge' ? 0.5 : kind === 'pergola' ? 3 : undefined })
        })
        ui.select([{ kind: 'siteObject', id }])
        break
      }
      case 'text': {
        const s = toScreen(view.current, w)
        setTextAt({ p: w, s, value: '' })
        break
      }
      default:
        break
    }
    void e
  }

  function finishRect(tool: Tool, r: Rect) {
    const ui = useUI.getState()
    const p = getProject()
    const floor = floorOf(p)
    if (!floor || r.w < 0.3 || r.h < 0.3) return
    const floorId = floor.id
    if (tool === 'room' || tool === 'garage') {
      const type = (tool === 'garage' ? 'garage' : (ui.toolOption as RoomType) || 'bedroom') as RoomType
      let id = ''
      commit(tool === 'garage' ? 'Add garage' : `Add ${spec(type).label.toLowerCase()}`, (d) => {
        const f = d.floors.find((x) => x.id === floorId)! as Floor
        const room = addRectRoom(f, r, type, d.settings)
        if (type === 'garage') room.garage = { cars: Math.max(1, Math.floor(r.w / 2.8)), storage: false, workshop: false, evCharger: false }
        if (type === 'garage') room.enclosed = false
        id = room.id
        f.furniture.push(...furnishRoom(f, room, uid))
        applySmartLabels(d as unknown as Project)
      })
      ui.select([{ kind: 'room', id, floorId }])
      return
    }
    const kind: SiteAreaKind = tool === 'pool' ? 'pool' : tool === 'patio' ? 'patio' : ((ui.toolOption as SiteAreaKind) || 'lawn')
    const id = uid('sit')
    commit(`Add ${kind.replace('_', ' ')}`, (d) => {
      d.site.areas.push({ id, kind, name: kind === 'pool' ? 'Swimming pool' : kind === 'patio' ? 'Patio' : undefined, polygon: rectPoly(r), depth: kind === 'pool' ? 1.5 : undefined, material: kind === 'pool' ? 'lib:water-pool' : kind === 'patio' ? 'lib:porcelain-outdoor' : kind === 'lawn' ? 'lib:grass-lawn' : undefined })
    })
    ui.select([{ kind: 'siteArea', id }])
  }

  // ── pointer handling ──────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    const c = canvas.current!
    c.setPointerCapture(e.pointerId)
    c.focus()
    const ui = useUI.getState()
    const w = world(e)
    if (e.button === 1 || e.button === 2 || spaceDown.current || ui.tool === 'pan') {
      if (e.button === 2) return
      inter.current = { type: 'pan', start: { x: e.clientX, y: e.clientY }, view0: { ...view.current } }
      return
    }
    const tool = ui.tool
    const P = useProject.getState()
    const p = getProject()
    const floor = floorOf(p)
    if (!floor) return
    const floorId = floor.id
    const sn = snapPoint(w, snapCtx(undefined, e.altKey))
    snapRef.current = sn

    if (tool === 'select') {
      const h = handleAt(w)
      const sel = ui.selection[0]
      if (h && sel) {
        if (h.id.startsWith('edge:') && sel.kind === 'room') {
          P.begin('Resize room')
          inter.current = { type: 'room-edge', id: sel.id, side: h.id.slice(5) as Side, start: w }
          return
        }
        if (h.id.startsWith('vertex:') && sel.kind === 'room') {
          P.begin('Move corner')
          inter.current = { type: 'room-vertex', id: sel.id, index: Number(h.id.slice(7)) }
          return
        }
        if (h.id.startsWith('end:') && sel.kind === 'opening') {
          P.begin('Resize opening')
          inter.current = { type: 'resize-opening', id: sel.id, end: h.id.slice(4) as 'start' | 'end' }
          return
        }
        if (h.id === 'rotate' && sel.kind === 'furniture') {
          P.begin('Rotate furniture')
          inter.current = { type: 'rotate-item', id: sel.id }
          return
        }
        if (h.id.startsWith('corner:') && sel.kind === 'furniture') {
          P.begin('Resize furniture')
          const f = floor.furniture.find((x) => x.id === sel.id)!
          const cs = itemCorners(f.position, f.width, f.depth, f.rotation)
          inter.current = { type: 'resize-item', id: sel.id, corner: cs[(Number(h.id.slice(7)) + 2) % 4] }
          return
        }
        if (h.id.startsWith('plot:')) {
          P.begin('Edit plot boundary')
          inter.current = { type: 'plot-vertex', index: Number(h.id.slice(5)) }
          return
        }
      }
      const hit = hitTest(w, floor, p, view.current.scale, p.settings.layers, floor.level === 0)
      if (!hit) {
        if (!e.shiftKey) ui.select([])
        inter.current = { type: 'marquee', start: w, cur: w }
        return
      }
      const already = ui.selection.some((s) => s.id === hit.id)
      if (e.shiftKey) ui.select(already ? ui.selection.filter((s) => s.id !== hit.id) : [...ui.selection, hit])
      else if (!already) ui.select([hit])
      if (hit.kind === 'room') {
        P.begin('Move room')
        inter.current = { type: 'move-room', id: hit.id, start: w }
      } else if (hit.kind === 'wall') {
        P.begin('Move wall')
        inter.current = { type: 'move-wall', id: hit.id, start: w }
      } else if (hit.kind === 'opening') {
        const o = floor.openings.find((x) => x.id === hit.id)!
        const wall = floor.walls.find((x) => x.id === o.wallId)!
        P.begin('Move opening')
        inter.current = { type: 'move-opening', id: hit.id, grab: projectT(w, wall.a, wall.b) * segLength(wall.a, wall.b) - o.offset }
      } else if (hit.kind === 'furniture' || hit.kind === 'column' || hit.kind === 'stair' || hit.kind === 'siteObject' || hit.kind === 'annotation' || hit.kind === 'siteArea') {
        P.begin('Move')
        inter.current = { type: 'move-item', kind: hit.kind, id: hit.id, start: w }
      }
      return
    }
    if (['room', 'garage', 'pool', 'patio'].includes(tool) || (tool === 'garden' && ['lawn', 'walkway', 'garden_bed', 'deck', 'play_area'].includes(ui.toolOption ?? ''))) {
      inter.current = { type: 'draw-rect', tool, start: sn.p, cur: sn.p }
      return
    }
    if (tool === 'wall') {
      const pts = wallChain.current
      let q = sn.p
      if (pts.length && e.shiftKey) q = constrainAngle(pts[pts.length - 1], q)
      if (pts.length >= 3 && dist(q, pts[0]) < 10 / view.current.scale) {
        commitWallChain(true)
        return
      }
      if (e.detail === 2) {
        commitWallChain()
        return
      }
      pts.push(q)
      request()
      return
    }
    if (tool === 'dimension') {
      const d = dimDraft.current
      if (!d) dimDraft.current = { a: sn.p }
      else if (!d.b) d.b = sn.p
      else {
        const off = offsetFor(d.a, d.b, w)
        commit('Add dimension', (dd) => {
          dd.floors.find((x) => x.id === floorId)!.annotations.push({ id: uid('ann'), kind: 'dimension', a: d.a, b: d.b!, offset: off })
        })
        dimDraft.current = null
      }
      request()
      return
    }
    if (tool === 'measure') {
      const m = measure.current
      if (!m || m.b) {
        measure.current = { a: sn.p }
        const r = roomAt(sn.p, floor)
        setReadout(r ? `${r.name}: ${formatAreaFor(area(r.polygon), p.settings.units)}, ceiling ${formatLength(r.ceilingHeight ?? floor.height - floor.slabThickness, p.settings.units)}` : null)
      } else {
        m.b = sn.p
        setReadout(`Distance ${formatLength(dist(m.a, m.b), p.settings.units)}`)
      }
      request()
      return
    }
    if (tool === 'split') {
      if (!splitTarget.current) {
        const r = roomAt(w, floor)
        if (r) splitTarget.current = r.id
        else ui.toast({ kind: 'info', title: 'Click the room you want to split' })
      } else {
        const r = floor.rooms.find((x) => x.id === splitTarget.current)
        if (r) {
          const b = bbox(r.polygon)
          const axis = splitAxis(b, sn.p)
          commit(`Split ${r.name}`, (d) => {
            const f = d.floors.find((x) => x.id === floorId)! as Floor
            const nr = splitRoom(f, r.id, axis, axis === 'x' ? sn.p.x : sn.p.y, d.settings)
            if (!nr) useUI.getState().toast({ kind: 'warning', title: 'Split too close to the edge', body: 'Each part needs at least 0.5 m.' })
            applySmartLabels(d as unknown as Project)
          })
        }
        splitTarget.current = null
      }
      request()
      return
    }
    placeAt(sn.p, tool, e)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const w = world(e)
    const ui = useUI.getState()
    const it = inter.current
    const P = useProject.getState()
    const floorId = ui.floorId
    if (it?.type === 'pan') {
      view.current = { ...it.view0, ox: it.view0.ox + e.clientX - it.start.x, oy: it.view0.oy + e.clientY - it.start.y }
      request()
      return
    }
    const p = getProject()
    const floor = floorOf(p)
    const sn = snapPoint(w, snapCtx(undefined, e.altKey || (it?.type === 'move-room')))
    snapRef.current = sn
    cursor.current = ui.tool === 'wall' && wallChain.current.length && e.shiftKey ? constrainAngle(wallChain.current[wallChain.current.length - 1], sn.p) : sn.p
    useUI.setState({ cursor: sn.p })
    if (!it) {
      if (ui.tool === 'select' && floor) {
        const hit = hitTest(w, floor, p, view.current.scale, p.settings.layers, floor.level === 0)
        if ((hit?.id ?? null) !== (ui.hover?.id ?? null)) ui.set({ hover: hit })
        const h = handleAt(w)
        canvas.current!.style.cursor = h ? (h.id === 'rotate' ? 'grab' : h.id.includes('left') || h.id.includes('right') ? 'ew-resize' : h.id.includes('top') || h.id.includes('bottom') ? 'ns-resize' : 'pointer') : hit ? 'move' : 'default'
      } else canvas.current!.style.cursor = ui.tool === 'pan' ? 'grab' : 'crosshair'
      request()
      return
    }
    const settings = p.settings
    switch (it.type) {
      case 'marquee':
        it.cur = w
        break
      case 'draw-rect':
        it.cur = sn.p
        break
      case 'move-room': {
        let dx = w.x - it.start.x
        let dy = w.y - it.start.y
        // snap the room's corners to nearby corners / grid
        const base = useProject.getState().tx?.base
        const r0 = base?.floors.find((f) => f.id === floorId)?.rooms.find((r) => r.id === it.id)
        if (r0 && !e.altKey) {
          const b = bbox(r0.polygon)
          const moved = { x: b.x + dx, y: b.y + dy }
          const s2 = snapPoint(moved, snapCtx((q) => r0.polygon.some((v) => dist(v, q) < 1e-6)))
          if (s2.kind !== 'none') {
            dx += s2.p.x - moved.x
            dy += s2.p.y - moved.y
            snapRef.current = s2
          }
        }
        P.update((d) => {
          const f = d.floors.find((x) => x.id === floorId) as Floor | undefined
          if (f) translateRoom(f, it.id, dx, dy, settings)
        })
        break
      }
      case 'room-edge': {
        const vertical = it.side === 'left' || it.side === 'right'
        const base = useProject.getState().tx?.base
        const r0 = base?.floors.find((f) => f.id === floorId)?.rooms.find((r) => r.id === it.id)
        if (!r0) break
        const b = bbox(r0.polygon)
        const coord0 = it.side === 'left' ? b.x : it.side === 'right' ? b.x + b.w : it.side === 'top' ? b.y : b.y + b.h
        const target = vertical ? sn.p.x : sn.p.y
        const delta = target - coord0
        P.update((d) => {
          const f = d.floors.find((x) => x.id === floorId) as Floor | undefined
          if (f && Math.abs(delta) > 1e-4) moveRoomEdge(f, it.id, it.side, delta, settings, !e.altKey)
        })
        const nb = vertical ? b.w + (it.side === 'right' ? delta : -delta) : b.h + (it.side === 'bottom' ? delta : -delta)
        setReadout(`${vertical ? 'Width' : 'Length'} ${formatLength(nb, settings.units)}${e.altKey ? ' (neighbours unlinked)' : ''}`)
        break
      }
      case 'room-vertex': {
        P.update((d) => {
          const f = d.floors.find((x) => x.id === floorId) as Floor | undefined
          const r = f?.rooms.find((x) => x.id === it.id)
          if (!f || !r) return
          r.polygon[it.index] = sn.p
          refreshFloor(f, settings)
        })
        break
      }
      case 'move-wall': {
        const base = useProject.getState().tx?.base
        const f0 = base?.floors.find((f) => f.id === floorId)
        const w0 = f0?.walls.find((x) => x.id === it.id)
        if (!f0 || !w0) break
        const dir = norm(sub(w0.b, w0.a))
        const n = { x: -dir.y, y: dir.x }
        const raw = (sn.p.x - it.start.x) * n.x + (sn.p.y - it.start.y) * n.y
        const delta = Math.round(raw / Math.max(0.01, settings.grid)) * settings.grid
        P.update((d) => {
          const f = d.floors.find((x) => x.id === floorId) as Floor | undefined
          if (!f) return
          if (w0.source === 'manual') {
            const w = f.walls.find((x) => x.id === it.id)!
            w.a = add(w0.a, scale(n, delta))
            w.b = add(w0.b, scale(n, delta))
            return
          }
          // move the room edges lying on this wall (parametric: neighbours follow)
          const axis = Math.abs(dir.x) > Math.abs(dir.y) ? 'h' : 'v'
          const room = f0.rooms.find((r) => {
            const b = bbox(r.polygon)
            return axis === 'v' ? (Math.abs(b.x - w0.a.x) < 1e-3 || Math.abs(b.x + b.w - w0.a.x) < 1e-3) && lineOverlap(w0, { a: { x: w0.a.x, y: b.y }, b: { x: w0.a.x, y: b.y + b.h } }) > 0.1 : (Math.abs(b.y - w0.a.y) < 1e-3 || Math.abs(b.y + b.h - w0.a.y) < 1e-3) && lineOverlap(w0, { a: { x: b.x, y: w0.a.y }, b: { x: b.x + b.w, y: w0.a.y } }) > 0.1
          })
          if (!room || Math.abs(delta) < 1e-4) return
          const b = bbox(room.polygon)
          const side: Side = axis === 'v' ? (Math.abs(b.x - w0.a.x) < 1e-3 ? 'left' : 'right') : Math.abs(b.y - w0.a.y) < 1e-3 ? 'top' : 'bottom'
          const dd = axis === 'v' ? delta * Math.sign(n.x || 1) : delta * Math.sign(n.y || 1)
          moveRoomEdge(f, room.id, side, dd, settings, true)
        })
        setReadout(`Moved ${formatLength(Math.abs(delta), settings.units)}`)
        break
      }
      case 'move-opening': {
        P.update((d) => {
          const f = d.floors.find((x) => x.id === floorId) as Floor | undefined
          const o = f?.openings.find((x) => x.id === it.id)
          if (!f || !o) return
          let wall = f.walls.find((x) => x.id === o.wallId)!
          const nw = nearestWall(w, f, view.current.scale, 30)
          if (nw && nw.wallId !== wall.id && nw.d > wall.thickness) {
            wall = f.walls.find((x) => x.id === nw.wallId)!
            o.wallId = wall.id
          }
          const L = segLength(wall.a, wall.b)
          const t = projectT(w, wall.a, wall.b) * L - (o.wallId === wall.id ? it.grab : 0)
          const snapped = settings.snap.dimensions ? Math.round(t / (settings.grid / 2)) * (settings.grid / 2) : t
          o.offset = Math.min(Math.max(snapped, o.width / 2 + 0.05), L - o.width / 2 - 0.05)
        })
        break
      }
      case 'resize-opening': {
        P.update((d) => {
          const f = d.floors.find((x) => x.id === floorId) as Floor | undefined
          const o = f?.openings.find((x) => x.id === it.id)
          const wall = o && f?.walls.find((x) => x.id === o.wallId)
          if (!o || !wall) return
          const L = segLength(wall.a, wall.b)
          const t = projectT(sn.p, wall.a, wall.b) * L
          const other = it.end === 'start' ? o.offset + o.width / 2 : o.offset - o.width / 2
          let a = Math.min(t, other)
          let b = Math.max(t, other)
          a = Math.max(0.05, a)
          b = Math.min(L - 0.05, b)
          if (b - a < 0.4) return
          o.width = b - a
          o.offset = (a + b) / 2
        })
        break
      }
      case 'move-item': {
        const dx = sn.p.x - it.start.x
        const dy = sn.p.y - it.start.y
        const base = useProject.getState().tx?.base
        P.update((d) => {
          const f = d.floors.find((x) => x.id === floorId)
          const bf = base?.floors.find((x) => x.id === floorId)
          if (it.kind === 'furniture' && f && bf) {
            const o = f.furniture.find((x) => x.id === it.id)!
            const o0 = bf.furniture.find((x) => x.id === it.id)!
            const target = { x: o0.position.x + dx, y: o0.position.y + dy }
            const snapped = e.altKey ? { p: target, rot: o0.rotation } : snapFurnitureToWall(target, o0.width, o0.depth, f as Floor, o0.rotation)
            o.position = snapped.p
            o.rotation = snapped.rot
          } else if (it.kind === 'column' && f && bf) {
            const o0 = bf.columns.find((x) => x.id === it.id)!
            f.columns.find((x) => x.id === it.id)!.position = { x: o0.position.x + dx, y: o0.position.y + dy }
          } else if (it.kind === 'stair' && f && bf) {
            const o0 = bf.stairs.find((x) => x.id === it.id)!
            f.stairs.find((x) => x.id === it.id)!.position = { x: o0.position.x + dx, y: o0.position.y + dy }
          } else if (it.kind === 'annotation' && f && bf) {
            const a0 = bf.annotations.find((x) => x.id === it.id)!
            const a = f.annotations.find((x) => x.id === it.id)!
            if (a.kind === 'text' && a0.kind === 'text') a.position = { x: a0.position.x + dx, y: a0.position.y + dy }
            else if (a.kind === 'dimension' && a0.kind === 'dimension') a.offset = offsetFor(a0.a, a0.b, w)
          } else if (it.kind === 'siteObject') {
            const o0 = base?.site.objects.find((x) => x.id === it.id)
            const o = d.site.objects.find((x) => x.id === it.id)
            if (o && o0) o.position = { x: o0.position.x + dx, y: o0.position.y + dy }
          } else if (it.kind === 'siteArea') {
            const a0 = base?.site.areas.find((x) => x.id === it.id)
            const a = d.site.areas.find((x) => x.id === it.id)
            if (a && a0) a.polygon = a0.polygon.map((q) => ({ x: q.x + dx, y: q.y + dy }))
          }
        })
        break
      }
      case 'rotate-item': {
        P.update((d) => {
          const f = d.floors.find((x) => x.id === floorId)
          const o = f?.furniture.find((x) => x.id === it.id)
          if (!o) return
          let a = Math.atan2(w.x - o.position.x, -(w.y - o.position.y))
          if (!e.altKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12)
          o.rotation = (a + Math.PI * 2) % (Math.PI * 2)
        })
        break
      }
      case 'resize-item': {
        P.update((d) => {
          const f = d.floors.find((x) => x.id === floorId)
          const o = f?.furniture.find((x) => x.id === it.id)
          if (!o) return
          const local = rotate(sub(sn.p, it.corner), -o.rotation)
          const wv = Math.max(0.2, Math.abs(local.x))
          const dv = Math.max(0.2, Math.abs(local.y))
          const mid = add(it.corner, rotate({ x: (Math.sign(local.x) * wv) / 2, y: (Math.sign(local.y) * dv) / 2 }, o.rotation))
          o.width = wv
          o.depth = dv
          o.position = mid
        })
        break
      }
      case 'plot-vertex':
        P.update((d) => {
          d.plot.polygon[it.index] = sn.p
          d.plot.shape = 'irregular'
        })
        break
    }
    request()
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const it = inter.current
    inter.current = null
    const P = useProject.getState()
    if (!it) return
    if (it.type === 'marquee') {
      const r = normRect(it.start, it.cur)
      if (r.w * view.current.scale > 4 && r.h * view.current.scale > 4) {
        const p = getProject()
        const f = floorOf(p)
        const inside = (q: Vec2) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h
        const refs: EntityRef[] = [
          ...(f?.rooms.filter((x) => x.polygon.every(inside)).map((x) => ({ kind: 'room' as const, id: x.id, floorId: f.id })) ?? []),
          ...(f?.furniture.filter((x) => inside(x.position)).map((x) => ({ kind: 'furniture' as const, id: x.id, floorId: f.id })) ?? [])
        ]
        useUI.getState().select(e.shiftKey ? [...useUI.getState().selection, ...refs] : refs)
      }
    } else if (it.type === 'draw-rect') {
      finishRect(it.tool, normRect(it.start, it.cur))
    } else if (it.type !== 'pan') {
      P.end()
      if (it.type === 'move-room' || it.type === 'room-edge' || it.type === 'move-wall') {
        // relabel after structural edits
        commit('Update labels', (d) => applySmartLabels(d as unknown as Project))
      }
    }
    setReadout(null)
    request()
  }

  const onWheel = (e: React.WheelEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    const s = { x: e.clientX - r.left, y: e.clientY - r.top }
    const w = toWorld(view.current, s)
    const k = Math.exp(-e.deltaY * 0.0015)
    const scaleN = Math.max(2, Math.min(400, view.current.scale * k))
    view.current = { scale: scaleN, ox: s.x - w.x * scaleN, oy: s.y - w.y * scaleN }
    request()
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const ui = useUI.getState()
    if (ui.tool === 'wall') return commitWallChain()
    const w = world(e)
    const p = getProject()
    const f = floorOf(p)
    if (!f || ui.tool !== 'select') return
    const r = roomAt(w, f)
    if (r) {
      const b = bbox(r.polygon)
      setTextAt({ p: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, s: toScreen(view.current, { x: b.x + b.w / 2, y: b.y + b.h / 2 }), value: r.name, renameRoom: r.id })
    }
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const ui = useUI.getState()
    if (ui.tool !== 'select') {
      window.dispatchEvent(new CustomEvent('hf:cancel'))
      ui.set({ tool: 'select' })
      return
    }
    const w = world(e)
    const p = getProject()
    const f = floorOf(p)
    if (!f) return
    const hit = hitTest(w, f, p, view.current.scale, p.settings.layers, f.level === 0)
    if (hit && !ui.selection.some((s) => s.id === hit.id)) ui.select([hit])
    const items: MenuItem[] = []
    if (hit?.kind === 'room') {
      const r = f.rooms.find((x) => x.id === hit.id)!
      items.push(
        { heading: r.name },
        { label: 'Rename', onClick: () => setTextAt({ p: w, s: toScreen(view.current, w), value: r.name, renameRoom: r.id }) },
        { label: 'Split horizontally', onClick: () => commit(`Split ${r.name}`, (d) => void splitRoom(d.floors.find((x) => x.id === f.id)! as Floor, r.id, 'y', bbox(r.polygon).y + bbox(r.polygon).h / 2, d.settings)) },
        { label: 'Split vertically', onClick: () => commit(`Split ${r.name}`, (d) => void splitRoom(d.floors.find((x) => x.id === f.id)! as Floor, r.id, 'x', bbox(r.polygon).x + bbox(r.polygon).w / 2, d.settings)) },
        { label: 'Re-furnish room', onClick: () => commit(`Furnish ${r.name}`, (d) => {
            const ff = d.floors.find((x) => x.id === f.id)! as Floor
            ff.furniture = ff.furniture.filter((x) => !pointInPolygon(x.position, r.polygon))
            ff.furniture.push(...furnishRoom(ff, ff.rooms.find((x) => x.id === r.id)!, uid))
          }) },
        { label: 'Design this room…', onClick: () => useUI.getState().set({ mode: 'interior', selection: [hit] }) },
        { label: 'Apply material…', onClick: () => useUI.getState().set({ mode: 'materials', selection: [hit] }) },
        { separator: true }
      )
    }
    if (hit) {
      items.push({ label: 'Duplicate', shortcut: 'Ctrl+D', onClick: duplicateSelection }, { label: 'Copy', shortcut: 'Ctrl+C', onClick: copySelection }, { label: 'Rotate 90°', shortcut: 'R', onClick: () => rotateSelection() }, { separator: true }, { label: hit.kind === 'wall' ? 'Remove wall (open plan)' : 'Delete', shortcut: 'Del', danger: true, onClick: deleteSelection })
    } else items.push({ label: 'Fit view', shortcut: 'F', onClick: fit }, { label: 'Select all rooms', onClick: () => ui.select(f.rooms.map((r) => ({ kind: 'room' as const, id: r.id, floorId: f.id }))) })
    openContextMenu(e, items)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ') spaceDown.current = true
    if (e.key === 'Enter' && useUI.getState().tool === 'wall') commitWallChain()
    if ((e.key === 'r' || e.key === 'R') && (useUI.getState().tool === 'furniture' || useUI.getState().tool === 'stair')) {
      ghostRot.current = (ghostRot.current + Math.PI / 2) % (Math.PI * 2)
      e.stopPropagation()
      request()
    }
  }
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ' ') spaceDown.current = false
  }

  const commitText = () => {
    const t = textAt
    setTextAt(null)
    if (!t || !t.value.trim()) return
    const floorId = useUI.getState().floorId
    if (t.renameRoom) {
      commit('Rename room', (d) => {
        const r = d.floors.find((x) => x.id === floorId)?.rooms.find((x) => x.id === t.renameRoom)
        if (r) {
          r.name = t.value.trim()
          r.autoName = false
        }
      })
      return
    }
    commit('Add text', (d) => {
      d.floors.find((x) => x.id === floorId)!.annotations.push({ id: uid('ann'), kind: 'text', position: t.p, text: t.value.trim(), size: 0.25 })
    })
  }

  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0 }}>
      <canvas
        ref={canvas}
        tabIndex={0}
        style={{ outline: 'none', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          cursor.current = null
          useUI.getState().set({ hover: null })
          request()
        }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        aria-label="Floor plan editor"
      />
      {textAt && (
        <input
          autoFocus
          className="field"
          style={{ position: 'absolute', left: textAt.s.x - 90, top: textAt.s.y - 14, width: 180, zIndex: 5 }}
          value={textAt.value}
          placeholder={textAt.renameRoom ? 'Room name' : 'Text'}
          onChange={(e) => setTextAt({ ...textAt, value: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commitText()
            if (e.key === 'Escape') setTextAt(null)
          }}
        />
      )}
      {readout && (
        <div className="overlay hint" style={{ left: '50%', bottom: 12, transform: 'translateX(-50%)' }}>
          {readout}
        </div>
      )}
    </div>
  )
}

// ── pure helpers ───────────────────────────────────────────────────────────
function normRect(a: Vec2, b: Vec2): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

export function itemCorners(c: Vec2, w: number, d: number, rot: number): Vec2[] {
  return [
    { x: -w / 2, y: -d / 2 },
    { x: w / 2, y: -d / 2 },
    { x: w / 2, y: d / 2 },
    { x: -w / 2, y: d / 2 }
  ].map((p) => add(rotate(p, rot), c))
}

function centroidOf(poly: Vec2[]) {
  const b = bbox(poly)
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

function offsetFor(a: Vec2, b: Vec2, p: Vec2) {
  const d = norm(sub(b, a))
  const n = { x: -d.y, y: d.x }
  return (p.x - a.x) * n.x + (p.y - a.y) * n.y
}

function splitAxis(b: Rect, p: Vec2): 'x' | 'y' {
  const dx = Math.min(p.x - b.x, b.x + b.w - p.x) / b.w
  const dy = Math.min(p.y - b.y, b.y + b.h - p.y) / b.h
  return dx > dy ? 'x' : 'y'
}

export function openingWidth(tool: Tool | 'door' | 'window', opt: string | null) {
  if (tool === 'door') return opt === 'double' || opt === 'french' ? 1.5 : opt === 'main' ? 1.35 : opt === 'sliding' ? 1.8 : opt === 'garage' ? 2.6 : opt === 'opening' ? 1.2 : 0.9
  return opt === 'full-height' ? 2.4 : opt === 'ventilator' ? 0.6 : opt === 'sliding' ? 1.8 : 1.5
}

function ghostStair(p: Vec2, type: StairType, height: number) {
  const risers = risersFor(height)
  const sz = localSize({ type, width: 1.0, risers, tread: 0.27 })
  return { id: 'ghost', type, position: { x: p.x - sz.w / 2, y: p.y - sz.run / 2 }, rotation: 0, width: 1.0, risers, tread: 0.27, turn: 'right' as const, railing: 'metal' as const }
}

/** Place furniture against the nearest wall, backing onto it (object snapping). */
function snapFurnitureToWall(p: Vec2, w: number, d: number, floor: Floor | Draft<Floor>, rot: number): { p: Vec2; rot: number } {
  let best: { p: Vec2; rot: number; dist: number } | null = null
  for (const wall of floor.walls) {
    if (effectiveKind(wall as never) === 'virtual') continue
    const L = segLength(wall.a, wall.b)
    const t = projectT(p, wall.a, wall.b)
    if (t < 0 || t > 1) continue
    const dir = norm(sub(wall.b, wall.a))
    const n = { x: -dir.y, y: dir.x }
    const s = (p.x - wall.a.x) * n.x + (p.y - wall.a.y) * n.y
    const side = Math.sign(s) || 1
    const dd = Math.abs(s) - wall.thickness / 2 - d / 2
    if (dd > 0.35 || dd < -d) continue
    const along = add(wall.a, scale(dir, t * L))
    const pos = add(along, scale(n, side * (wall.thickness / 2 + d / 2 + 0.01)))
    // front faces away from the wall: local +y along the normal (side)
    const r = Math.atan2(-(n.x * side), n.y * side)
    if (!best || Math.abs(dd) < best.dist) best = { p: pos, rot: r, dist: Math.abs(dd) }
    void w
  }
  return best ? { p: best.p, rot: best.rot } : { p, rot }
}

function drawGrid(ctx: CanvasRenderingContext2D, v: ViewTransform, W: number, H: number, dpr: number, grid: number, t: PlanTheme, units: string) {
  const major = units === 'm' || units === 'cm' ? 1 : 1.524
  const drawLines = (step: number, color: string) => {
    const px = step * v.scale
    if (px < 7) return
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    const x0 = Math.floor(-v.ox / v.scale / step) * step
    for (let x = x0; x * v.scale + v.ox < W; x += step) {
      const sx = Math.round((x * v.scale + v.ox) * dpr) + 0.5
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, H * dpr)
    }
    const y0 = Math.floor(-v.oy / v.scale / step) * step
    for (let y = y0; y * v.scale + v.oy < H; y += step) {
      const sy = Math.round((y * v.scale + v.oy) * dpr) + 0.5
      ctx.moveTo(0, sy)
      ctx.lineTo(W * dpr, sy)
    }
    ctx.stroke()
  }
  drawLines(grid, t.grid)
  drawLines(major, t.gridMajor)
  void dist
}
