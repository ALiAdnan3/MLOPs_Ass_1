import { lazy, Suspense, useEffect, useState } from 'react'
import { PanelRightClose, PanelRightOpen, ZoomIn, ZoomOut, Scan, Grid3x3, Home, Footprints, Box, Maximize2, Columns2, Square, Plane } from 'lucide-react'
import { useUI, type ViewMode3D } from '../state/ui'
import { useProject, commit } from '../state/store'
import { TitleBar } from './TitleBar'
import { Toolbar, ToolOptions } from './Toolbar'
import { FloorStack } from './FloorStack'
import { StatusBar } from './StatusBar'
import { Inspector } from './Inspector'
import { Dock } from './Dock'
import { PlanView } from '../editor/PlanView'
import { Viewport3D } from '../engine/Viewport3D'
import { ErrorBoundary } from '../app/App'
import { IconButton, Seg } from '../ui/primitives'
import { Assistant } from '../ai/Assistant'
import { DISCLAIMER } from '../core/model/defaults'
import { sortedFloors } from '../core/model/house'
import { importDroppedFiles } from '../dialogs/importFiles'
import { getEngine, hasEngine } from '../engine/Engine'
import { setMode } from '../app/actions'

const SketchView = lazy(() => import('../modes/SketchView').then((m) => ({ default: m.SketchView })))
const Presentation = lazy(() => import('../modes/Presentation').then((m) => ({ default: m.Presentation })))

const THREE_D = new Set(['3d', 'materials', 'interior', 'exterior', 'walk', 'drone'])

export function Workspace() {
  const mode = useUI((s) => s.mode)
  const open = useUI((s) => s.inspectorOpen)
  const assistant = useUI((s) => s.assistantOpen)
  const floorId = useUI((s) => s.floorId)
  const split = useUI((s) => s.split)
  const floors = useProject((s) => s.project.floors)
  const set = useUI((s) => s.set)
  const [drag, setDrag] = useState(false)
  // keep a valid active floor
  useEffect(() => {
    if (!floors.some((f) => f.id === floorId)) {
      const g = sortedFloors(floors).find((f) => f.level === 0) ?? floors[0]
      if (g) set({ floorId: g.id })
    }
  }, [floors, floorId, set])
  const docked = mode === 'plan' || mode === '3d'
  const splitView = mode === 'plan' && split
  return (
    <>
      <TitleBar />
      <div className={`workspace ${mode === 'present' ? 'presenting' : ''}`}>
        {mode !== 'present' && <Toolbar />}
        <div className="center">
          <main
            className={`stage ${splitView ? 'split' : ''}`}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault()
                setDrag(true)
              }
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              void importDroppedFiles([...e.dataTransfer.files])
            }}
          >
            <ErrorBoundary area={mode === 'plan' ? '2D plan' : mode}>
              {mode === 'plan' && (
                <section className="pane">
                  <PlanHeader />
                  <div className="pane-body">
                    <PlanView />
                    <ToolOptions />
                    <div className="overlay faint plan-note" style={{ left: 12, bottom: 10, fontSize: 11, maxWidth: 520, pointerEvents: 'none' }}>
                      {DISCLAIMER}
                    </div>
                  </div>
                </section>
              )}
              {splitView && (
                <section className="pane">
                  <View3DHeader />
                  <div className="pane-body">
                    <Viewport3D />
                  </div>
                </section>
              )}
              {mode === 'sketch' && (
                <Suspense fallback={null}>
                  <SketchView />
                </Suspense>
              )}
              {THREE_D.has(mode) && <Viewport3D />}
              {mode === 'present' && (
                <Suspense fallback={null}>
                  <Presentation />
                </Suspense>
              )}
            </ErrorBoundary>
            {!docked && mode !== 'present' && mode !== 'walk' && mode !== 'drone' && (
              <div className="overlay" style={{ left: 12, top: 12 }}>
                <FloorStack />
              </div>
            )}
            {mode !== 'present' && (
              <div className="overlay" style={{ right: 12, top: splitView ? 52 : 12 }}>
                <IconButton icon={open ? <PanelRightClose /> : <PanelRightOpen />} label={open ? 'Hide panel' : 'Show panel'} onClick={() => set({ inspectorOpen: !open })} className="float-bar" />
              </div>
            )}
            {assistant && <Assistant />}
            {drag && <div className="drop-overlay">Drop a floor-plan image, sketch or material photo</div>}
          </main>
          {docked && <Dock />}
        </div>
        <Inspector />
      </div>
      {mode !== 'present' && <StatusBar />}
    </>
  )
}

function PlanHeader() {
  const floorId = useUI((s) => s.floorId)
  const split = useUI((s) => s.split)
  const planStyle = useUI((s) => s.planStyle)
  const floors = useProject((s) => s.project.floors)
  const grid = useProject((s) => s.project.settings.snap.grid)
  const set = useUI((s) => s.set)
  const zoom = (k: number) => window.dispatchEvent(new CustomEvent('hf:zoom', { detail: k }))
  return (
    <header className="pane-head">
      <span className="pane-title">2D Floor Plan</span>
      <select className="field pane-select" value={floorId} onChange={(e) => set({ floorId: e.target.value, selection: [] })} aria-label="Floor">
        {sortedFloors(floors).map((f) => (
          <option key={f.id} value={f.id}>
            {f.name} floor
          </option>
        ))}
      </select>
      <span className="pane-sep" />
      <IconButton icon={<ZoomOut />} label="Zoom out" onClick={() => zoom(1 / 1.25)} />
      <IconButton icon={<ZoomIn />} label="Zoom in" onClick={() => zoom(1.25)} />
      <IconButton icon={<Scan />} label="Fit to view" shortcut="F" onClick={() => window.dispatchEvent(new CustomEvent('hf:fit'))} />
      <IconButton icon={<Grid3x3 />} label={grid ? 'Grid snapping on' : 'Grid snapping off'} active={grid} onClick={() => commit(grid ? 'Grid snapping off' : 'Grid snapping on', (d) => void (d.settings.snap.grid = !d.settings.snap.grid))} />
      <div className="grow" />
      <Seg value={planStyle} onChange={(v) => set({ planStyle: v })} options={[{ value: 'rendered', label: 'Rendered', tip: 'Textured presentation plan' }, { value: 'technical', label: 'Technical', tip: 'Clean drafting lines' }]} />
      <IconButton icon={split ? <Square /> : <Columns2 />} label={split ? 'Plan only' : 'Plan and 3D side by side'} onClick={() => set({ split: !split })} />
    </header>
  )
}

const VIEW_MODES: { value: ViewMode3D; label: string }[] = [
  { value: 'realistic', label: 'Realistic' },
  { value: 'architectural', label: 'Architectural' },
  { value: 'dollhouse', label: 'Dollhouse (cut-away)' },
  { value: 'floor', label: 'This floor only' },
  { value: 'exploded', label: 'Exploded floors' }
]

function View3DHeader() {
  const viewMode = useUI((s) => s.viewMode)
  const set = useUI((s) => s.set)
  const cam = (p: Parameters<ReturnType<typeof getEngine>['setCameraPreset']>[0]) => hasEngine() && getEngine().setCameraPreset(p)
  return (
    <header className="pane-head">
      <span className="pane-title">3D View</span>
      <select className="field pane-select" value={viewMode} onChange={(e) => set({ viewMode: e.target.value as ViewMode3D, explodeGap: e.target.value === 'exploded' ? 4 : 0 })} aria-label="3D view mode">
        {VIEW_MODES.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
      <div className="grow" />
      <IconButton icon={<Home />} label="Overview" onClick={() => cam('orbit')} />
      <IconButton icon={<Scan />} label="Top view" onClick={() => cam('top')} />
      <IconButton icon={<Plane />} label="Drone flythrough" onClick={() => setMode('drone')} />
      <IconButton icon={<Footprints />} label="Walk inside" shortcut="3" onClick={() => setMode('walk')} />
      <IconButton icon={<Box />} label="Open in full 3D" shortcut="2" onClick={() => setMode('3d')} />
      <IconButton icon={<Maximize2 />} label="Full screen 3D" onClick={() => {
          setMode('3d')
          useUI.getState().set({ inspectorOpen: false, dockOpen: false })
        }} />
    </header>
  )
}
