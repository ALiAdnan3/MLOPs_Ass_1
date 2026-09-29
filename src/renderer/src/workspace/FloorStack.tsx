import { Eye, EyeOff, Plus } from 'lucide-react'
import { deepClone } from '../core/clone'
import { useProject, commit } from '../state/store'
import { useUI } from '../state/ui'
import { sortedFloors } from '../core/model/house'
import { makeFloor, floorName } from '../core/model/defaults'
import { openContextMenu } from '../ui/primitives'
import type { Floor } from '../core/model/types'
import { uid } from '../core/model/ids'

/**
 * Floor selector drawn as a small building section (§25): roof on top, floors stacked, the
 * ground line under Ground and the basement below grade. Click to edit a floor; the eye hides
 * it; "All" shows every floor in 3D.
 */
export function FloorStack() {
  const floors = useProject((s) => s.project.floors)
  const floorId = useUI((s) => s.floorId)
  const showAll = useUI((s) => s.showAllFloors)
  const mode = useUI((s) => s.mode)
  const set = useUI((s) => s.set)
  const list = sortedFloors(floors).reverse()
  const is3d = mode !== 'plan' && mode !== 'sketch'
  const pick = (f: Floor) => set({ floorId: f.id, selection: [], showAllFloors: is3d ? false : showAll })
  const addFloor = (where: 'above' | 'basement') => {
    let id = ''
    commit(where === 'basement' ? 'Add basement' : 'Add floor', (d) => {
      const s = sortedFloors(d.floors as Floor[])
      if (where === 'basement') {
        if (s.some((f) => f.level < 0)) return
        const b = makeFloor('basement', -1, d.settings.floorHeight)
        id = b.id
        d.floors.push(b)
      } else {
        const roof = s.find((f) => f.kind === 'roof')
        const top = s.filter((f) => f.kind !== 'roof').pop()!
        const level = top.level + 1
        const f = makeFloor('upper', level, top.height)
        f.name = floorName('upper', level)
        id = f.id
        d.floors.push(f)
        if (roof) (d.floors.find((x) => x.id === roof.id) as Floor).level = level + 1
      }
    }, { major: true })
    if (id) set({ floorId: id })
  }
  return (
    <div className="floor-stack" aria-label="Floors">
      {is3d && (
        <button className={`floor-slab floor-all ${showAll ? 'on' : ''}`} onClick={() => set({ showAllFloors: true })} data-tip="Show every floor in 3D">
          3D all
        </button>
      )}
      {list.map((f) => (
        <div key={f.id}>
          {f.level === -1 && <div className="ground-line" aria-hidden />}
          <div
            className={`floor-slab ${f.kind === 'roof' ? 'roof' : ''} ${f.id === floorId ? 'on' : ''} ${f.visible ? '' : 'hidden-floor'}`}
            onClick={() => pick(f)}
            onContextMenu={(e) =>
              openContextMenu(e, [
                { heading: f.name },
                { label: f.visible ? 'Hide floor' : 'Show floor', onClick: () => commit(`${f.visible ? 'Hide' : 'Show'} ${f.name}`, (d) => void ((d.floors.find((x) => x.id === f.id) as Floor).visible = !f.visible)) },
                { label: 'Duplicate layout as new floor above', disabled: f.kind === 'roof', onClick: () => duplicateFloor(f.id) },
                { label: 'Add floor above', onClick: () => addFloor('above') },
                { label: 'Add basement', disabled: floors.some((x) => x.level < 0), onClick: () => addFloor('basement') },
                { separator: true },
                { label: 'Delete floor', danger: true, disabled: f.level === 0, onClick: () => commit(`Delete ${f.name}`, (d) => void (d.floors = d.floors.filter((x) => x.id !== f.id)), { major: true }) }
              ])
            }
            data-tip={`${f.name}${f.visible ? '' : ' (hidden)'}. Right-click for options`}
          >
            {f.kind === 'basement' ? 'Basement' : f.kind === 'roof' ? 'Roof' : f.name}
            <span
              className="eye"
              role="button"
              aria-label={f.visible ? `Hide ${f.name}` : `Show ${f.name}`}
              onClick={(e) => {
                e.stopPropagation()
                commit(`${f.visible ? 'Hide' : 'Show'} ${f.name}`, (d) => void ((d.floors.find((x) => x.id === f.id) as Floor).visible = !f.visible))
              }}
            >
              {f.visible ? <Eye /> : <EyeOff />}
            </span>
          </div>
        </div>
      ))}
      <button className="floor-slab floor-all" style={{ justifyContent: 'center', color: 'var(--text-3)' }} onClick={() => addFloor('above')} data-tip="Add a floor above">
        <Plus size={12} />
      </button>
    </div>
  )
}

function duplicateFloor(floorId: string) {
  commit('Duplicate floor', (d) => {
    const s = sortedFloors(d.floors as Floor[])
    const src = s.find((f) => f.id === floorId)
    if (!src) return
    const roof = s.find((f) => f.kind === 'roof')
    const top = s.filter((f) => f.kind !== 'roof').pop()!
    const level = top.level + 1
    const copy = deepClone(src) as Floor
    copy.id = uid('flr')
    copy.level = level
    copy.kind = 'upper'
    copy.name = floorName('upper', level)
    const remap = new Map<string, string>()
    for (const r of copy.rooms) {
      const nid = uid('rm')
      remap.set(r.id, nid)
      r.id = nid
    }
    for (const r of copy.rooms) if (r.parentId) r.parentId = remap.get(r.parentId)
    const wmap = new Map<string, string>()
    for (const w of copy.walls) {
      const nid = uid('wal')
      wmap.set(w.id, nid)
      w.id = nid
    }
    for (const o of copy.openings) {
      o.id = uid('opn')
      o.wallId = wmap.get(o.wallId) ?? o.wallId
    }
    for (const x of copy.furniture) x.id = uid('fur')
    for (const x of copy.columns) x.id = uid('col')
    for (const x of copy.stairs) x.id = uid('str')
    for (const x of copy.annotations) x.id = uid('ann')
    copy.rooms = copy.rooms.filter((r) => r.type !== 'garage')
    d.floors.push(copy)
    if (roof) (d.floors.find((x) => x.id === roof.id) as Floor).level = level + 1
  }, { major: true })
}
