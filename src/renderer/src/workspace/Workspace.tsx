import { lazy, Suspense, useEffect, useState } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useUI } from '../state/ui'
import { useProject } from '../state/store'
import { TitleBar } from './TitleBar'
import { Toolbar, ToolOptions } from './Toolbar'
import { FloorStack } from './FloorStack'
import { StatusBar } from './StatusBar'
import { Inspector } from './Inspector'
import { PlanView } from '../editor/PlanView'
import { Viewport3D } from '../engine/Viewport3D'
import { ErrorBoundary } from '../app/App'
import { IconButton } from '../ui/primitives'
import { Assistant } from '../ai/Assistant'
import { DISCLAIMER } from '../core/model/defaults'
import { sortedFloors } from '../core/model/house'
import { importDroppedFiles } from '../dialogs/importFiles'

const SketchView = lazy(() => import('../modes/SketchView').then((m) => ({ default: m.SketchView })))
const Presentation = lazy(() => import('../modes/Presentation').then((m) => ({ default: m.Presentation })))

const THREE_D = new Set(['3d', 'materials', 'interior', 'exterior', 'walk', 'drone'])

export function Workspace() {
  const mode = useUI((s) => s.mode)
  const open = useUI((s) => s.inspectorOpen)
  const assistant = useUI((s) => s.assistantOpen)
  const floorId = useUI((s) => s.floorId)
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
  return (
    <>
      <TitleBar />
      <div className="workspace">
        <Toolbar />
        <main
          className="stage"
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
            {mode === 'plan' && <PlanView />}
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
          {mode !== 'present' && mode !== 'walk' && mode !== 'drone' && (
            <div className="overlay" style={{ left: 12, top: 12 }}>
              <FloorStack />
            </div>
          )}
          <ToolOptions />
          {mode !== 'present' && (
            <div className="overlay" style={{ right: 12, top: 12 }}>
              <IconButton icon={open ? <PanelRightClose /> : <PanelRightOpen />} label={open ? 'Hide panel' : 'Show panel'} onClick={() => set({ inspectorOpen: !open })} className="float-bar" />
            </div>
          )}
          {mode === 'plan' && (
            <div className="overlay faint plan-note" style={{ left: 12, bottom: 10, fontSize: 11, maxWidth: 520, pointerEvents: 'none' }}>
              {DISCLAIMER}
            </div>
          )}
          {assistant && <Assistant />}
          {drag && <div className="drop-overlay">Drop a floor-plan image, sketch or material photo</div>}
        </main>
        <Inspector />
      </div>
      <StatusBar />
    </>
  )
}
