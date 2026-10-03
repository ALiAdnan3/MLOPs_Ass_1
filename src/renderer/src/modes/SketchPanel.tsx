import { useRef } from 'react'
import { PenLine, Eraser, Type, Hand, Undo2, Trash2, ScanLine, ImagePlus, Box, Map as MapIcon } from 'lucide-react'
import { useSketch, runRecognition, type SketchTool } from './sketchState'
import { useProject, commit, getProject } from '../state/store'
import { useUI } from '../state/ui'
import { applyRecognizedPlan, addRecognizedRooms } from '../ai/sketchRecognizer'
import { spec } from '../core/constraints/rooms'
import { area } from '../core/geometry/polygon'
import { formatAreaFor } from '../core/units/units'
import { pendingImport } from '../dialogs/importFiles'
import { applySmartLabels } from '../planner/labels'
import type { Floor, Project, RoomType } from '../core/model/types'
import { IconButton, Seg } from '../ui/primitives'

/** Sketch mode side panel: tools, recognition results, questions, and "create floor plan". */

const TYPES: RoomType[] = ['master_bedroom', 'bedroom', 'guest_bedroom', 'bathroom', 'kitchen', 'tv_lounge', 'drawing', 'dining', 'family', 'study', 'store', 'laundry', 'prayer', 'stair', 'corridor', 'foyer', 'garage', 'terrace', 'courtyard']

export function SketchPanel() {
  const st = useSketch()
  const units = useProject((s) => s.project.settings.units)
  const floors = useProject((s) => s.project.floors)
  const floorId = useUI((s) => s.floorId)
  const floor = floors.find((f) => f.id === floorId)
  const file = useRef<HTMLInputElement>(null)
  const tools: { k: SketchTool; label: string; icon: JSX.Element }[] = [
    { k: 'pen', label: 'Pen', icon: <PenLine /> },
    { k: 'eraser', label: 'Eraser', icon: <Eraser /> },
    { k: 'text', label: 'Label', icon: <Type /> },
    { k: 'pan', label: 'Pan', icon: <Hand /> }
  ]
  const r = st.result
  const questions = r?.rooms.filter((x) => x.confidence < 0.6 && !st.confirmed.includes(x.id)) ?? []
  const create = (then: 'plan' | '3d') => {
    if (!r || !floor) return
    const adding = st.mode === 'add' && floor.rooms.length > 0
    if (!r.rooms.length) {
      useUI.getState().toast({ kind: 'warning', title: 'No new rooms to add', body: adding ? 'Draw the new room outside the current walls; its outline can share an existing wall.' : 'Recognize a sketch with closed room outlines first.' })
      return
    }
    let warnings: string[] = []
    let count = r.rooms.length
    commit(adding ? `Add sketched room${r.rooms.length === 1 ? '' : 's'} (${floor.name})` : `Floor plan from sketch (${floor.name})`, (d) => {
      const f = d.floors.find((x) => x.id === floor.id) as Floor
      if (adding) {
        const res = addRecognizedRooms(r, f, d.settings, d.site as unknown as Project['site'])
        warnings = res.warnings
        count = res.added.length
      } else warnings = applyRecognizedPlan(r, f, d.plot, d.settings).warnings
      applySmartLabels(d as unknown as Project)
    }, { major: true })
    useUI.getState().toast({
      kind: warnings.length ? 'warning' : 'success',
      title: adding ? `${count} room${count === 1 ? '' : 's'} added to the ${floor.name.toLowerCase()} floor` : `${count} rooms created on the ${floor.name.toLowerCase()} floor`,
      body: warnings[0] ?? (adding ? 'Walls, a door, windows and furniture were added. Ctrl+Z undoes it.' : 'Walls, doors and windows are now editable.')
    })
    if (count) {
      useSketch.getState().set({ strokes: [], texts: [], result: null })
      useUI.getState().set({ mode: then, selection: [] })
    }
    void getProject
  }
  return (
    <div className="panel-scroll">
      <div className="section">
        <div className="section-head">
          <h3>Sketch mode</h3>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Draw the rooms freehand. The sketch is turned into a clean plan: walls straightened, corners closed, gaps and arcs become doors, double lines become windows.
        </p>
        <div className="row" style={{ gap: 4 }}>
          {tools.map((t) => (
            <IconButton key={t.k} icon={t.icon} label={t.label} active={st.tool === t.k} onClick={() => st.set({ tool: t.k })} />
          ))}
          <div className="grow" />
          <IconButton icon={<Undo2 />} label="Undo last mark" onClick={() => st.undo()} />
          <IconButton icon={<Trash2 />} label="Clear sketch" onClick={() => st.clear()} />
        </div>
        <div className="prop" style={{ marginTop: 10 }}>
          <label>Grid square</label>
          <Seg value={String(st.gridM)} onChange={(v) => st.set({ gridM: Number(v) })} options={[{ value: String(0.3048), label: '1 ft' }, { value: String(0.6096), label: '2 ft' }, { value: String(1.524), label: '5 ft' }, { value: '1', label: '1 m' }]} />
        </div>
        {!!floor?.rooms.length && (
          <div className="prop">
            <label>Sketch</label>
            <Seg value={st.mode} onChange={(v) => st.set({ mode: v, result: null })} options={[{ value: 'add', label: 'Add rooms', tip: 'Draw extra rooms next to the current plan' }, { value: 'replace', label: 'Redraw floor', tip: 'Replace this floor with the sketch' }]} />
          </div>
        )}
        <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => file.current?.click()}>
          <ImagePlus size={14} /> Import a sketch photo
        </button>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => {
            const f = [...(e.target.files ?? [])]
            e.target.value = ''
            if (!f.length) return
            pendingImport.files = f
            window.dispatchEvent(new CustomEvent('hf:sketch-image'))
          }} />
      </div>
      <div className="section">
        <button className="btn primary" style={{ width: '100%' }} disabled={!st.strokes.length && !st.image} onClick={() => {
            const res = runRecognition(floor)
            if (!res.rooms.length) useUI.getState().showError({ what: 'No rooms were recognized.', why: 'The outlines do not form closed shapes, or the lines are too far apart to join.', fix: 'Make sure each room outline meets its neighbours at the corners (small overshoots are fine), then try again.' })
          }}>
          <ScanLine size={14} /> Recognize sketch
        </button>
        {r && (
          <ul className="faint" style={{ fontSize: 12, paddingLeft: 16, margin: '10px 0 0' }}>
            {r.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
      {r && r.rooms.length > 0 && (
        <>
          {questions.length > 0 && (
            <div className="section">
              <div className="section-head">
                <h3>A few questions</h3>
                <span className="sub">{questions.length}</span>
              </div>
              {questions.slice(0, 4).map((q) => (
                <div key={q.id} className="issue warning" style={{ cursor: 'default' }} onMouseEnter={() => st.set({ focusRoom: q.id })}>
                  <div className="grow">
                    <div className="m">Did you mean this to be a {spec(q.type).label.toLowerCase()}?</div>
                    <div className="f">
                      {formatAreaFor(area(q.polygon), units)}, {q.reason}
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 6 }}>
                      <button className="btn sm" onClick={() => st.setRoomType(q.id, q.type, q.name)}>
                        Yes
                      </button>
                      <select className="field" value="" onChange={(e) => st.setRoomType(q.id, e.target.value as RoomType, spec(e.target.value as RoomType).label)} aria-label="Room type">
                        <option value="">No, it is a…</option>
                        {TYPES.map((t) => (
                          <option key={t} value={t}>
                            {spec(t).label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="section">
            <div className="section-head">
              <h3>Recognized rooms</h3>
            </div>
            <div className="list">
              {r.rooms.map((x) => (
                <div key={x.id} className={`list-item ${st.focusRoom === x.id ? 'on' : ''}`}>
                  <select className="field" style={{ flex: 1 }} value={x.type} onChange={(e) => st.setRoomType(x.id, e.target.value as RoomType, spec(e.target.value as RoomType).label)} aria-label={`Type of ${x.name}`}>
                    {[...new Set([x.type, ...TYPES])].map((t) => (
                      <option key={t} value={t}>
                        {spec(t).label}
                      </option>
                    ))}
                  </select>
                  <span className="meta tabular">{formatAreaFor(area(x.polygon), units)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="section">
            <div className="section-head">
              <h3>Create the plan</h3>
            </div>
            <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>
              {st.mode === 'add' && floor?.rooms.length
                ? `New rooms join the ${floor.name.toLowerCase()} floor: they get walls, a door to their neighbour, windows and furniture.`
                : `Goes on the ${floor?.name.toLowerCase() ?? 'current'} floor${floor?.rooms.length ? ', replacing its current rooms (undo brings them back)' : ''}. Walls, doors, windows, stairs and furniture are created and stay editable.`}
            </p>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn grow" onClick={() => create('plan')}>
                <MapIcon size={14} /> Create floor plan
              </button>
              <button className="btn primary grow" onClick={() => create('3d')}>
                <Box size={14} /> Generate 3D
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
