import { describe, expect, it } from 'vitest'
import { generateDesign, STRATEGIES } from '@/planner/generator'
import { defaultRequirements, defaultSettings, newProject, plotFromPreset } from '@/core/model/defaults'
import { useProject, getProject } from '@/state/store'
import { useUI } from '@/state/ui'
import { parseEditOffline, applyEditPlan } from '@/ai/nlEditor'
import { sortedFloors } from '@/core/model/house'
import { uid } from '@/core/model/ids'

/** Generated designs have no trees; existing ones can be cleared from the assistant (user request 2026-11-10). */

const isTree = (k: string) => k === 'tree' || k === 'palm'

describe('trees', () => {
  it('are not placed in generated designs, on any plot or strategy', () => {
    const req = defaultRequirements()
    req.outdoor.frontLawn = true
    req.outdoor.backLawn = true
    req.outdoor.garden = true
    for (const preset of ['5-marla', '10-marla', '1-kanal']) {
      for (const s of STRATEGIES) {
        const d = generateDesign(req, plotFromPreset(preset), s.key, { settings: defaultSettings(), seed: 5, iterations: 600 })
        expect(d.house.site.objects.filter((o) => isTree(o.kind))).toEqual([])
      }
    }
  })

  it('are removed by "remove the trees" in the assistant, leaving shrubs', async () => {
    const d = generateDesign(defaultRequirements(), plotFromPreset('10-marla'), 'family', { settings: defaultSettings(), seed: 3, iterations: 600 })
    const p = newProject('Trees', d.house.plot)
    p.floors = structuredClone(d.house.floors)
    p.site = structuredClone(d.house.site)
    p.exterior = structuredClone(d.house.exterior)
    // a design from before the change still has its trees
    p.site.objects.push({ id: uid('obj'), kind: 'tree', position: { x: 2, y: 2 }, rotation: 0, scale: 1 }, { id: uid('obj'), kind: 'palm', position: { x: 4, y: 2 }, rotation: 0, scale: 1 }, { id: uid('obj'), kind: 'shrub', position: { x: 6, y: 2 }, rotation: 0, scale: 1 })
    useProject.getState().load(p)
    useUI.getState().set({ floorId: sortedFloors(p.floors).find((f) => f.level === 0)!.id, selection: [] })
    const plan = parseEditOffline('Remove the trees', getProject(), useUI.getState().floorId)
    expect(plan.operations.map((o) => o.op)).toEqual(['remove_trees'])
    const r = await applyEditPlan(plan, 'test')
    expect(r.ok).toBe(true)
    const left = getProject().site.objects
    expect(left.filter((o) => isTree(o.kind))).toEqual([])
    expect(left.some((o) => o.kind === 'shrub')).toBe(true)
  })
})
