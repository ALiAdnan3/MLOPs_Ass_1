import { useEffect, useRef, useState } from 'react'
import { Bookmark, Camera, Sun, Sunrise, Sunset, CloudSun, MoonStar } from 'lucide-react'
import { getEngine } from './Engine'
import { useProject, getProject, commit } from '../state/store'
import { useUI, type CameraPreset, type ViewMode3D } from '../state/ui'
import type { EntityRef, SurfaceRef, LightingSettings } from '../core/model/types'
import { Seg, IconButton, Menu, type MenuItem, openContextMenu, askText } from '../ui/primitives'
import { presetTime, LIGHT_PRESETS } from './lighting/sun'
import { uid } from '../core/model/ids'
import { WalkController } from './controllers/WalkController'
import { DroneController } from './controllers/DroneController'

/** Maps a picked 3D surface to the model entity it belongs to. */
export function surfaceToEntity(s: SurfaceRef | null): EntityRef | null {
  if (!s) return null
  switch (s.kind) {
    case 'roomFloor':
    case 'roomCeiling':
      return { kind: 'room', id: s.roomId, floorId: s.floorId }
    case 'wallSide':
      return { kind: 'wall', id: s.wallId, floorId: s.floorId }
    case 'exteriorWall':
      return s.wallId ? { kind: 'wall', id: s.wallId, floorId: s.floorId } : null
    case 'stair':
      return { kind: 'stair', id: s.stairId, floorId: s.floorId }
    case 'column':
      return { kind: 'column', id: s.columnId, floorId: s.floorId }
    case 'furniture':
      return { kind: 'furniture', id: s.furnitureId, floorId: s.floorId }
    case 'siteArea':
      return { kind: 'siteArea', id: s.areaId }
    default:
      return null
  }
}

export function Viewport3D() {
  const ref = useRef<HTMLDivElement>(null)
  const mode = useUI((s) => s.mode)
  const quality = useUI((s) => s.quality)
  const engine = getEngine()

  // mount + sync
  useEffect(() => {
    const el = ref.current!
    engine.mount(el)
    const sync = () => {
      const p = getProject()
      const ui = useUI.getState()
      engine.update(p, {
        floorId: ui.floorId,
        showAll: ui.showAllFloors,
        viewMode: ui.viewMode,
        explodeGap: ui.explodeGap,
        doorsOpen: true,
        showFurniture: p.settings.layers.furniture,
        showStructure: p.settings.layers.structure
      })
    }
    sync()
    engine.setCameraPreset('orbit', undefined, false)
    const a = useProject.subscribe((s, prev) => {
      if (s.project !== prev.project) sync()
    })
    const b = useUI.subscribe((s, prev) => {
      if (s.floorId !== prev.floorId || s.showAllFloors !== prev.showAllFloors || s.viewMode !== prev.viewMode || s.explodeGap !== prev.explodeGap) sync()
      if (s.selection !== prev.selection) {
        const sel = s.selection[0]
        engine.highlight(sel ? entitySurface(sel) : null, 'select')
      }
      if (s.surface !== prev.surface) engine.highlight(s.surface, 'select')
    })
    return () => {
      a()
      b()
      engine.setController(null)
      engine.unmount(el)
    }
  }, [engine])

  useEffect(() => engine.setQuality(quality), [engine, quality])

  // controllers for walk / drone
  useEffect(() => {
    if (mode === 'walk') {
      const c = new WalkController(engine)
      engine.setController(c)
      return () => engine.setController(null)
    }
    if (mode === 'drone') {
      const c = new DroneController(engine)
      engine.setController(c)
      ;(window as unknown as { __drone?: DroneController }).__drone = c
      return () => {
        engine.setController(null)
        ;(window as unknown as { __drone?: DroneController }).__drone = undefined
      }
    }
    engine.setController(null)
    if (mode === 'interior') {
      const sel = useUI.getState().selection[0]
      engine.setCameraPreset('interior', sel?.kind === 'room' ? sel.id : undefined)
    } else if (mode === 'exterior') engine.setCameraPreset('facade')
    else engine.setCameraPreset('orbit')
  }, [engine, mode])

  // picking
  const down = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current
    down.current = null
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || e.button !== 0) return
    if (mode === 'walk' || mode === 'drone') return
    const hit = engine.pick(e.clientX, e.clientY)
    const ui = useUI.getState()
    const ent = surfaceToEntity(hit?.surface ?? null)
    if (mode === 'materials' || mode === 'exterior' || mode === 'interior') ui.set({ surface: hit?.surface ?? null, selection: ent ? [ent] : [] })
    else ui.set({ selection: ent ? [ent] : [], surface: null })
    if (ent?.floorId && ent.floorId !== ui.floorId && (mode === 'materials' || mode === 'interior')) ui.set({ floorId: ent.floorId })
  }
  const lastHover = useRef(0)
  const onPointerMove = (e: React.PointerEvent) => {
    if (mode === 'walk' || mode === 'drone' || e.buttons) return
    const now = performance.now()
    if (now - lastHover.current < 60) return
    lastHover.current = now
    const hit = engine.pick(e.clientX, e.clientY)
    engine.highlight(hit?.surface ?? null, 'hover')
  }
  const onContextMenu = (e: React.MouseEvent) => {
    if (mode === 'walk' || mode === 'drone') return
    const hit = engine.pick(e.clientX, e.clientY)
    const ent = surfaceToEntity(hit?.surface ?? null)
    if (!ent) return
    useUI.getState().set({ selection: [ent], surface: hit?.surface ?? null })
    openContextMenu(e, [
      { label: 'Apply a material here…', onClick: () => useUI.getState().set({ mode: 'materials' }) },
      ...(ent.kind === 'room' ? [{ label: 'Look inside this room', onClick: () => engine.setCameraPreset('room', ent.id) }, { label: 'Design this room…', onClick: () => useUI.getState().set({ mode: 'interior' }) }] : []),
      { label: 'Show in 2D plan', onClick: () => useUI.getState().set({ mode: 'plan', floorId: ent.floorId ?? useUI.getState().floorId }) }
    ])
  }

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerMove={onPointerMove} onContextMenu={onContextMenu} onPointerLeave={() => engine.highlight(null, 'hover')} aria-label="3D view" />
      {(mode === '3d' || mode === 'materials' || mode === 'interior' || mode === 'exterior') && <ViewBar />}
    </div>
  )
}

function entitySurface(e: EntityRef): SurfaceRef | null {
  switch (e.kind) {
    case 'room':
      return { kind: 'roomFloor', floorId: e.floorId!, roomId: e.id }
    case 'furniture':
      return { kind: 'furniture', floorId: e.floorId!, furnitureId: e.id }
    case 'stair':
      return { kind: 'stair', floorId: e.floorId!, stairId: e.id }
    case 'column':
      return { kind: 'column', floorId: e.floorId!, columnId: e.id }
    case 'siteArea':
      return { kind: 'siteArea', areaId: e.id }
    case 'wall':
      return { kind: 'exteriorWall', floorId: e.floorId, wallId: e.id }
    default:
      return null
  }
}

const CAMS: { key: CameraPreset; label: string }[] = [
  { key: 'orbit', label: 'Orbit' },
  { key: 'top', label: 'Top' },
  { key: 'front', label: 'Front' },
  { key: 'back', label: 'Back' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
  { key: 'street', label: 'Street' },
  { key: 'facade', label: 'Front facade' },
  { key: 'interior', label: 'Interior' }
]

function ViewBar() {
  const viewMode = useUI((s) => s.viewMode)
  const set = useUI((s) => s.set)
  const lighting = useProject((s) => s.project.settings.lighting)
  const cameras = useProject((s) => s.project.cameras)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const engine = getEngine()
  const setLight = (preset: LightingSettings['preset']) => {
    const p = getProject()
    const time = presetTime(preset, p.settings.lighting.latitude, p.settings.lighting.dayOfYear)
    commit(`Lighting: ${preset}`, (d) => {
      d.settings.lighting.preset = preset
      d.settings.lighting.time = time
    })
  }
  const icons: Record<string, JSX.Element> = { morning: <Sunrise />, noon: <Sun />, afternoon: <CloudSun />, sunset: <Sunset />, night: <MoonStar /> }
  const camItems: MenuItem[] = [
    ...CAMS.map((c) => ({ label: c.label, onClick: () => engine.setCameraPreset(c.key) })),
    { separator: true },
    { heading: 'Bookmarks' },
    ...cameras.map((b) => ({ label: b.name, onClick: () => engine.goToBookmark(b) })),
    { label: 'Save current view as bookmark…', onClick: () => {
        const pose = engine.getBookmark('')
        void askText('Save this view', `View ${cameras.length + 1}`, { label: 'Bookmark name', confirm: 'Save bookmark' }).then((name) => {
          if (!name) return
          const bm = { id: uid('cam'), ...pose, name }
          commit('Save camera bookmark', (d) => void d.cameras.push(bm))
          useUI.getState().toast({ kind: 'success', title: `Saved "${name}"`, body: 'Find it under Cameras; the drone can fly through your bookmarks.' })
        })
      } }
  ]
  return (
    <>
      <div className="overlay float-bar" style={{ top: 12, left: '50%', transform: 'translateX(-50%)' }}>
        <Seg<ViewMode3D>
          value={viewMode}
          onChange={(v) => set({ viewMode: v, explodeGap: v === 'exploded' ? 4 : 0, showAllFloors: v === 'exploded' ? true : useUI.getState().showAllFloors })}
          options={[
            { value: 'realistic', label: 'Realistic', tip: 'Materials, sunlight and shadows' },
            { value: 'architectural', label: 'Architectural', tip: 'Clean white model' },
            { value: 'dollhouse', label: 'Dollhouse', tip: 'Cut away to see the rooms' },
            { value: 'floor', label: 'Floor', tip: 'Only the selected floor' },
            { value: 'exploded', label: 'Exploded', tip: 'Floors separated vertically' }
          ]}
        />
        <div className="sep" />
        {LIGHT_PRESETS.map((l) => (
          <IconButton key={l.key} icon={icons[l.key]} label={l.label} active={lighting.preset === l.key} onClick={() => setLight(l.key)} />
        ))}
        <div className="sep" />
        <IconButton icon={<Camera />} label="Cameras and bookmarks" onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom + 6 })
          }} />
        <IconButton icon={<Bookmark />} label="Save this view as a bookmark" onClick={() => camItems[camItems.length - 1].onClick?.()} />
      </div>
      {menu && <Menu items={camItems} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </>
  )
}
