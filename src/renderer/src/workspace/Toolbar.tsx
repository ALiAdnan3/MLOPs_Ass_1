import { useState } from 'react'
import { MousePointer2, BrickWall, Square, DoorOpen, AppWindow, Columns3, Ruler, Type, Armchair, Trees, WavesLadder, Car, Umbrella, Hand, Split, Crosshair, Palette, Box } from 'lucide-react'
import { useUI, type Tool } from '../state/ui'
import { IconButton, Seg } from '../ui/primitives'
import { setMode } from '../app/actions'
import { CATALOG, FURNITURE_CATEGORIES } from '../core/furniture/catalog'
import { ROOM_TYPE_GROUPS, spec } from '../core/constraints/rooms'
import type { RoomType } from '../core/model/types'

export const StairIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
    <path d="M3 20h5v-5h5v-5h5V5h3" />
  </svg>
)

const PLAN_TOOLS: { tool: Tool; label: string; icon: JSX.Element; kbd?: string; beginner?: string }[] = [
  { tool: 'select', label: 'Select, move and resize', icon: <MousePointer2 />, kbd: 'M', beginner: 'Move / resize' },
  { tool: 'wall', label: 'Wall', icon: <BrickWall />, kbd: 'W' },
  { tool: 'room', label: 'Room', icon: <Square />, beginner: 'Draw room' },
  { tool: 'door', label: 'Door', icon: <DoorOpen />, beginner: 'Add door' },
  { tool: 'window', label: 'Window', icon: <AppWindow />, beginner: 'Add window' },
  { tool: 'column', label: 'Column', icon: <Columns3 /> },
  { tool: 'stair', label: 'Stair', icon: <StairIcon /> },
  { tool: 'dimension', label: 'Dimension', icon: <Ruler />, kbd: 'D' },
  { tool: 'text', label: 'Text', icon: <Type /> },
  { tool: 'furniture', label: 'Furniture', icon: <Armchair />, beginner: 'Furniture' },
  { tool: 'garden', label: 'Garden', icon: <Trees /> },
  { tool: 'pool', label: 'Pool', icon: <WavesLadder /> },
  { tool: 'garage', label: 'Garage', icon: <Car /> },
  { tool: 'patio', label: 'Patio', icon: <Umbrella /> }
]
const EXTRA_TOOLS: { tool: Tool; label: string; icon: JSX.Element }[] = [
  { tool: 'measure', label: 'Measure distance, area, wall length and ceiling height', icon: <Crosshair /> },
  { tool: 'split', label: 'Split a room', icon: <Split /> },
  { tool: 'pan', label: 'Pan (or hold Space / middle mouse)', icon: <Hand /> }
]

export function Toolbar() {
  const mode = useUI((s) => s.mode)
  const tool = useUI((s) => s.tool)
  const uiMode = useUI((s) => s.uiMode)
  const set = useUI((s) => s.set)
  if (mode !== 'plan') return <aside className="toolbar" aria-label="Tools" />
  const beginner = uiMode === 'beginner'
  const tools = beginner ? PLAN_TOOLS.filter((t) => t.beginner) : PLAN_TOOLS
  const pick = (t: Tool) => set({ tool: t, toolOption: defaultOption(t) })
  return (
    <aside className="toolbar" aria-label="Tools">
      {tools.map((t) => (
        <IconButton key={t.tool} icon={t.icon} label={beginner && t.beginner ? t.beginner : t.label} shortcut={t.kbd} active={tool === t.tool} onClick={() => pick(t.tool)} />
      ))}
      <div className="sep" />
      {!beginner && EXTRA_TOOLS.map((t) => <IconButton key={t.tool} icon={t.icon} label={t.label} active={tool === t.tool} onClick={() => pick(t.tool)} />)}
      {beginner && (
        <>
          <IconButton icon={<Palette />} label="Materials" onClick={() => setMode('materials')} />
          <IconButton icon={<Box />} label="See it in 3D" shortcut="2" onClick={() => setMode('3d')} />
        </>
      )}
    </aside>
  )
}

function defaultOption(t: Tool): string | null {
  switch (t) {
    case 'room':
      return 'bedroom'
    case 'door':
      return 'single'
    case 'window':
      return 'casement'
    case 'stair':
      return 'U'
    case 'garden':
      return 'tree'
    case 'column':
      return 'rect'
    case 'furniture':
      return 'bed-queen'
    default:
      return null
  }
}

/** Floating options for the active tool. */
export function ToolOptions() {
  const tool = useUI((s) => s.tool)
  const opt = useUI((s) => s.toolOption)
  const mode = useUI((s) => s.mode)
  const set = useUI((s) => s.set)
  const [cat, setCat] = useState('beds')
  if (mode !== 'plan' || tool === 'select' || tool === 'pan') return null
  const setOpt = (v: string) => set({ toolOption: v })
  let body: JSX.Element | null = null
  let hint = ''
  switch (tool) {
    case 'room':
      hint = 'Drag a rectangle. Walls are created and joined to neighbours automatically.'
      body = (
        <select className="field" style={{ width: 190, height: 26 }} value={opt ?? 'bedroom'} onChange={(e) => setOpt(e.target.value)} aria-label="Room type">
          {ROOM_TYPE_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.types.map((t) => (
                <option key={t} value={t}>
                  {spec(t as RoomType).label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )
      break
    case 'door':
      hint = 'Hover a wall and click. The door opens towards the side of your cursor.'
      body = <Seg value={opt ?? 'single'} onChange={setOpt} options={['single', 'double', 'sliding', 'pocket', 'french', 'main', 'garage', 'opening'].map((v) => ({ value: v, label: v === 'opening' ? 'Opening' : v[0].toUpperCase() + v.slice(1) }))} />
      break
    case 'window':
      hint = 'Hover an exterior wall and click to place.'
      body = <Seg value={opt ?? 'casement'} onChange={setOpt} options={['casement', 'sliding', 'fixed', 'full-height', 'ventilator', 'arched'].map((v) => ({ value: v, label: v === 'full-height' ? 'Full height' : v[0].toUpperCase() + v.slice(1) }))} />
      break
    case 'stair':
      hint = 'Click to place; press R to turn before placing.'
      body = <Seg value={opt ?? 'U'} onChange={setOpt} options={['straight', 'L', 'U', 'spiral', 'floating', 'modern', 'traditional'].map((v) => ({ value: v, label: v === 'L' ? 'L-shaped' : v === 'U' ? 'U-shaped' : v[0].toUpperCase() + v.slice(1) }))} />
      break
    case 'column':
      hint = 'Click to place a column; it snaps to wall corners.'
      body = <Seg value={opt ?? 'rect'} onChange={setOpt} options={[{ value: 'rect', label: 'Square' }, { value: 'round', label: 'Round' }]} />
      break
    case 'garden':
      hint = ['lawn', 'walkway', 'garden_bed', 'deck', 'play_area'].includes(opt ?? '') ? 'Drag to draw the area.' : 'Click to place.'
      body = (
        <select className="field" style={{ width: 170, height: 26 }} value={opt ?? 'tree'} onChange={(e) => setOpt(e.target.value)} aria-label="Garden item">
          <optgroup label="Areas">
            <option value="lawn">Grass / lawn</option>
            <option value="walkway">Walkway</option>
            <option value="garden_bed">Planting bed</option>
            <option value="deck">Deck</option>
            <option value="play_area">Play area</option>
          </optgroup>
          <optgroup label="Objects">
            {['tree', 'palm', 'shrub', 'flowers', 'hedge', 'pergola', 'bench', 'outdoor_table', 'lounger', 'umbrella', 'bbq_grill', 'fountain', 'swing', 'slide', 'garden_light', 'lamp_post', 'planter'].map((k) => (
              <option key={k} value={k}>
                {k.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}
              </option>
            ))}
          </optgroup>
        </select>
      )
      break
    case 'furniture':
      hint = 'Click to place. Items back onto the nearest wall; R rotates.'
      body = (
        <>
          <select className="field" style={{ width: 140, height: 26 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            {FURNITURE_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <select className="field" style={{ width: 170, height: 26 }} value={opt ?? ''} onChange={(e) => setOpt(e.target.value)} aria-label="Item">
            {CATALOG.filter((c) => c.category === cat).map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </>
      )
      break
    case 'wall':
      hint = 'Click to add points, double-click or Enter to finish. Shift keeps 45° angles. Closing a loop creates a room.'
      break
    case 'dimension':
      hint = 'Click two points, then move out and click to set the offset.'
      break
    case 'text':
      hint = 'Click where the note should go.'
      break
    case 'measure':
      hint = 'Click two points to measure. Clicking inside a room shows its area and ceiling height.'
      break
    case 'split':
      hint = 'Click a room, then click where to split it.'
      break
    case 'pool':
    case 'patio':
    case 'garage':
      hint = 'Drag a rectangle.'
      break
  }
  return (
    <div className="overlay" style={{ left: '50%', top: 12, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      {body && <div className="float-bar">{body}</div>}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}
