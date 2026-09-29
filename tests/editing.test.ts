import { beforeEach, describe, expect, it } from 'vitest'
import { generateDesign } from '@/planner/generator'
import { defaultRequirements, defaultSettings, newProject, plotFromPreset } from '@/core/model/defaults'
import { useProject, getProject } from '@/state/store'
import { useUI } from '@/state/ui'
import { parseEditOffline, applyEditPlan } from '@/ai/nlEditor'
import { area, bbox } from '@/core/geometry/polygon'
import { sortedFloors } from '@/core/model/house'
import type { Project } from '@/core/model/types'

/** §23 natural-language editing: the spec's example sentences must become real model edits. */

function loadHouse(): Project {
  const req = defaultRequirements()
  req.outdoor.patio = true
  const plot = plotFromPreset('1-kanal')
  const d = generateDesign(req, plot, 'family', { settings: defaultSettings(), seed: 11, iterations: 1200 })
  const p = newProject('Test house', d.house.plot)
  p.requirements = req
  p.floors = structuredClone(d.house.floors)
  p.site = structuredClone(d.house.site)
  p.exterior = structuredClone(d.house.exterior)
  useProject.getState().load(p)
  const g = sortedFloors(p.floors).find((f) => f.level === 0)!
  useUI.getState().set({ floorId: g.id, selection: [] })
  return getProject()
}

const roomsOf = (p: Project) => p.floors.flatMap((f) => f.rooms)

describe('natural language editing (offline)', () => {
  beforeEach(() => {
    loadHouse()
  })

  it('parses the spec example sentences into operations', () => {
    const p = getProject()
    const fid = useUI.getState().floorId
    const ops = (t: string) => parseEditOffline(t, p, fid).operations
    const wider = ops('Make the master bedroom 2 feet wider.')
    expect(wider[0]).toMatchObject({ op: 'resize_room', amount: 2, unit: 'ft', axis: 'width' })
    expect(roomsOf(p).find((r) => r.id === wider[0].target)?.type).toBe('master_bedroom')
    expect(ops('Move the kitchen closer to the dining room.')[0].op).toBe('move_room_near')
    const bath = ops('Add a bathroom beside bedroom 3.')[0]
    expect(bath).toMatchObject({ op: 'add_room_beside', value: 'bathroom' })
    expect(ops('Make the garage large enough for 3 cars.')[0]).toMatchObject({ op: 'set_garage_cars', amount: 3 })
    expect(ops('Increase the ceiling height.')[0]).toMatchObject({ op: 'adjust_floor_height', amount: 1 })
    expect(ops('Make the patio larger.')[0]).toMatchObject({ op: 'scale_site_area', target: 'patio' })
    expect(ops('Add a swimming pool.')[0]).toMatchObject({ op: 'add_site_area', target: 'pool' })
    expect(ops('Change the exterior to stone.')[0]).toMatchObject({ op: 'set_exterior_material', target: 'facade', value: 'stone' })
    expect(ops('Use this marble on the living room floor.')[0]).toMatchObject({ op: 'apply_uploaded_material', value: 'floor' })
    const ext = ops('Make the front elevation more modern with large glass windows, stone cladding and vertical lighting.').map((o) => o.op)
    expect(ext).toEqual(expect.arrayContaining(['set_style', 'set_window_scale', 'set_exterior_material', 'add_exterior_lighting']))
  })

  it('makes the master bedroom 2 feet wider in the model', async () => {
    const p = getProject()
    const master = roomsOf(p).find((r) => r.type === 'master_bedroom')!
    const w0 = bbox(master.polygon).w
    const plan = parseEditOffline('Make the master bedroom 2 feet wider', p, useUI.getState().floorId)
    const r = await applyEditPlan(plan, 'test')
    const m1 = roomsOf(getProject()).find((x) => x.id === master.id)!
    expect(r.ok).toBe(true)
    expect(bbox(m1.polygon).w - w0).toBeGreaterThan(0.55)
    expect(r.areaChanges.some((a) => a.name === master.name)).toBe(true)
  })

  it('adds a swimming pool, enlarges the garage and changes the facade', async () => {
    for (const t of ['Add a swimming pool', 'Make the garage large enough for 3 cars', 'Change the exterior to stone', 'Increase the ceiling height']) {
      const plan = parseEditOffline(t, getProject(), useUI.getState().floorId)
      const r = await applyEditPlan(plan, t)
      console.log(`${t} → ${r.message.split('\n')[0]}`)
    }
    const p = getProject()
    expect(p.site.areas.some((a) => a.kind === 'pool' && area(a.polygon) > 20)).toBe(true)
    const garage = roomsOf(p).find((r) => r.type === 'garage')
    if (garage) expect(garage.garage?.cars).toBe(3)
    expect(p.exterior.facadeMaterial).toBe('lib:stone-sandstone')
    expect(sortedFloors(p.floors).find((f) => f.level === 0)!.height).toBeGreaterThan(defaultSettings().floorHeight + 0.25)
  })

  it('adds a bathroom beside a bedroom by splitting it', async () => {
    const before = roomsOf(getProject()).filter((r) => r.type === 'bathroom').length
    const bed = roomsOf(getProject()).find((r) => r.type === 'bedroom')!
    const plan = parseEditOffline(`Add a bathroom beside ${bed.name}`, getProject(), useUI.getState().floorId)
    const r = await applyEditPlan(plan, 'bath')
    console.log(r.message)
    expect(roomsOf(getProject()).filter((x) => x.type === 'bathroom').length).toBe(before + 1)
  })

  it('answers questions from the model', async () => {
    const plan = parseEditOffline('How big is the kitchen?', getProject(), useUI.getState().floorId)
    const r = await applyEditPlan(plan, 'q')
    expect(r.message).toMatch(/Kitchen is .+ ×/)
  })
})
