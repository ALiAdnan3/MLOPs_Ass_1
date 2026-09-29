import type { DesignOption, HouseState, Plot, Project, Requirements, Version } from '../core/model/types'
import { newProject, makePlot, plotFromPreset } from '../core/model/defaults'
import { uid } from '../core/model/ids'
import { commit, useProject, getProject } from '../state/store'
import { useUI, type Mode } from '../state/ui'
import { useAssets } from '../state/assets'
import { sortedFloors } from '../core/model/house'
import { generateDesignsParallel } from '../ai/designService'
import { TEMPLATES, templateRequirements } from '../planner/templates'
import { autosaveNow } from '../storage/session'
import { spec } from '../core/constraints/rooms'
import { wallsOfRoom } from '../planner/walls'
import { area } from '../core/geometry/polygon'
import { designStats } from '../planner/metrics'
import { presetById } from '../core/units/plots'

/** High-level user actions shared by menus, buttons, shortcuts and the AI assistant. */

export function houseOf(p: Project): HouseState {
  return { plot: p.plot, floors: p.floors, site: p.site, exterior: p.exterior }
}

export function projectFromDesign(d: DesignOption, req: Requirements, all: DesignOption[] = [d], name?: string): Project {
  const p = newProject(name ?? defaultName(d.house.plot), d.house.plot)
  p.requirements = req
  p.floors = structuredClone(d.house.floors)
  p.site = structuredClone(d.house.site)
  p.exterior = structuredClone(d.house.exterior)
  p.designs = all
  p.activeDesignId = d.id
  p.versions = [{ id: uid('ver'), number: 1, name: `Original design: ${d.name}`, createdAt: Date.now(), house: structuredClone(d.house), materials: [] }]
  return p
}

function defaultName(plot: Plot) {
  const pre = presetById(plot.presetId)
  return pre ? `${pre.label} House` : 'My Dream House'
}

export function openProject(p: Project, filePath: string | null = null) {
  useAssets.getState().clear()
  useProject.getState().load(p, filePath)
  const g = sortedFloors(p.floors).find((f) => f.level === 0) ?? p.floors[0]
  useUI.getState().set({ screen: 'workspace', floorId: g?.id ?? '', selection: [], mode: 'plan', tool: 'select', rightTab: 'properties' })
}

/** Replace the current house with a design (keeps project name, materials, cameras). */
export function applyDesignToProject(d: DesignOption) {
  const before = getProject()
  commit(`Apply ${d.name}`, (draft) => {
    draft.plot = structuredClone(d.house.plot) as typeof draft.plot
    draft.floors = structuredClone(d.house.floors) as typeof draft.floors
    draft.site = structuredClone(d.house.site) as typeof draft.site
    draft.exterior = structuredClone(d.house.exterior) as typeof draft.exterior
    draft.activeDesignId = d.id
    if (!draft.designs.some((x) => x.id === d.id)) draft.designs.push(d as typeof draft.designs[number])
  }, { major: true })
  const g = sortedFloors(getProject().floors).find((f) => f.level === 0)
  useUI.getState().set({ floorId: g?.id ?? '', selection: [] })
  void before
  maybeAutoVersion(`Applied ${d.name}`)
}

export function createVersion(name: string) {
  const p = getProject()
  const v: Version = { id: uid('ver'), number: (p.versions.at(-1)?.number ?? 0) + 1, name, createdAt: Date.now(), house: structuredClone(houseOf(p)), materials: structuredClone(p.materials) }
  commit(`Save version ${v.number}`, (d) => {
    d.versions.push(v as (typeof d.versions)[number])
  })
  useUI.getState().toast({ kind: 'success', title: `Version ${v.number} saved`, body: name })
  return v
}

export function maybeAutoVersion(name: string) {
  if (getProject().settings.autoVersion) createVersion(name)
}

export function restoreVersion(id: string) {
  const v = getProject().versions.find((x) => x.id === id)
  if (!v) return
  commit(`Restore version ${v.number}`, (d) => {
    d.plot = structuredClone(v.house.plot) as typeof d.plot
    d.floors = structuredClone(v.house.floors) as typeof d.floors
    d.site = structuredClone(v.house.site) as typeof d.site
    d.exterior = structuredClone(v.house.exterior) as typeof d.exterior
    const keep = new Map(d.materials.map((m) => [m.id, m]))
    for (const m of v.materials) if (!keep.has(m.id)) d.materials.push(structuredClone(m) as (typeof d.materials)[number])
  }, { major: true })
  const g = sortedFloors(getProject().floors).find((f) => f.level === 0)
  useUI.getState().set({ floorId: g?.id ?? '', selection: [] })
  useUI.getState().toast({ kind: 'success', title: `Restored version ${v.number}`, body: v.name })
}

export function duplicateVersion(id: string) {
  const v = getProject().versions.find((x) => x.id === id)
  if (!v) return
  const copy: Version = { ...structuredClone(v), id: uid('ver'), number: (getProject().versions.at(-1)?.number ?? 0) + 1, name: `${v.name} (copy)`, createdAt: Date.now() }
  commit(`Duplicate version ${v.number}`, (d) => {
    d.versions.push(copy as (typeof d.versions)[number])
  })
}

export function setMode(mode: Mode) {
  const ui = useUI.getState()
  if (ui.mode === mode) return
  ui.set({ mode, tool: 'select' })
}

export async function startTemplate(templateId: string) {
  const t = TEMPLATES.find((x) => x.id === templateId)
  if (!t) return
  const ui = useUI.getState()
  ui.set({ busy: `Generating ${t.name}…` })
  try {
    const req = templateRequirements(t)
    const plot = plotFromPreset(t.preset)
    const settings = newProject().settings
    const { designs, errors } = await generateDesignsParallel(req, plot, settings, () => {}, { strategies: [t.strategy], baseSeed: t.seed })
    if (!designs.length) throw new Error(errors[0]?.why ?? 'No design produced')
    openProject(projectFromDesign(designs[0], req, designs, t.name))
    ui.toast({ kind: 'success', title: `${t.name} is ready`, body: 'Everything in this template is editable.' })
  } catch (e) {
    ui.showError({ what: `The ${t.name} template could not be generated`, why: String((e as Error)?.message ?? e), fix: 'Try again, or start from the requirement wizard.', retry: () => void startTemplate(templateId) })
  } finally {
    ui.set({ busy: null })
  }
}

/** The first-run demo (§63): a finished 10 marla house with materials, furniture, garden and garage. */
export async function openDemoHouse() {
  const ui = useUI.getState()
  ui.set({ busy: 'Preparing the demo house…' })
  try {
    const t = TEMPLATES.find((x) => x.id === '10m-luxury')!
    const req = templateRequirements(t)
    req.outdoor.patio = true
    req.outdoor.backLawn = true
    req.outdoor.garden = true
    const plot = plotFromPreset('10-marla')
    const settings = newProject().settings
    const { designs } = await generateDesignsParallel(req, plot, settings, () => {}, { strategies: ['luxury-open'], baseSeed: 4242 })
    if (!designs.length) throw new Error('Demo generation failed')
    const p = projectFromDesign(designs[0], req, designs, '10 Marla Demo House')
    dressDemo(p)
    openProject(p)
    ui.set({ mode: '3d' })
    ui.toast({ kind: 'info', title: 'Welcome to the demo house', body: 'Try Walk inside (3) or Drone view. Everything is editable.' })
  } catch (e) {
    ui.showError({ what: 'The demo house could not be prepared', why: String((e as Error)?.message ?? e), fix: 'Try again, or create a new house with the wizard.', retry: () => void openDemoHouse() })
  } finally {
    ui.set({ busy: null })
  }
}

/** Apply the §72 material story: marble living floors, stone TV wall, wood stairs, painted walls. */
export function dressDemo(p: Project) {
  for (const f of p.floors) {
    for (const r of f.rooms) {
      if (['tv_lounge', 'living', 'drawing', 'dining', 'foyer'].includes(r.type)) r.floorMaterial = 'lib:marble-calacatta'
      if (r.type === 'master_bedroom') {
        r.floorMaterial = 'lib:wood-herringbone'
        r.ceilingType = 'cove'
        r.curtains = { enabled: true, color: '#cdbfa8' }
      }
      if (r.type === 'bedroom') r.curtains = { enabled: true, color: '#b8c4cc' }
      if (r.type === 'tv_lounge' || r.type === 'family') {
        r.ceilingType = 'false-ceiling'
        // TV wall → stone: the longest solid wall side of the lounge
        const ws = wallsOfRoom(f, r).filter((x) => spec(r.type) && x.t1 - x.t0 > 2)
        ws.sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0))
        const w = ws.find((x) => x.wall.kind === 'interior') ?? ws[0]
        if (w) {
          const wall = f.walls.find((x) => x.id === w.wall.id)!
          wall.sideMaterials = { ...wall.sideMaterials, [w.side]: 'lib:stone-ledgestone' }
        }
      }
    }
    for (const s of f.stairs) {
      s.material = 'lib:wood-oak'
      s.railing = 'glass'
    }
  }
  const biggest = p.floors.flatMap((f) => f.rooms).sort((a, b) => area(b.polygon) - area(a.polygon))[0]
  void biggest
}

export async function regenerateWithRequirements(req: Requirements, label = 'Regenerate plan') {
  const p = getProject()
  const ui = useUI.getState()
  await autosaveNow('before-regenerate')
  ui.set({ busy: 'Regenerating the plan…' })
  try {
    const strategy = p.designs.find((d) => d.id === p.activeDesignId)?.strategy ?? 'family'
    const { designs, errors } = await generateDesignsParallel(req, p.plot, p.settings, () => {}, { strategies: [strategy], baseSeed: Math.floor(Math.random() * 1e6) })
    if (!designs.length) throw new Error(errors[0]?.why ?? 'No design')
    const d = designs[0]
    const oldMats = new Map(p.floors.flatMap((f) => f.rooms).map((r) => [r.type, { floorMaterial: r.floorMaterial, wallMaterial: r.wallMaterial }]))
    commit(label, (draft) => {
      draft.requirements = req as typeof draft.requirements
      draft.floors = structuredClone(d.house.floors) as typeof draft.floors
      draft.site = structuredClone(d.house.site) as typeof draft.site
      draft.exterior = { ...structuredClone(d.house.exterior), facadeMaterial: draft.exterior.facadeMaterial, accentMaterial: draft.exterior.accentMaterial } as typeof draft.exterior
      draft.plot = structuredClone(d.house.plot) as typeof draft.plot
      // keep chosen finishes per room type
      for (const f of draft.floors) for (const r of f.rooms) {
        const m = oldMats.get(r.type)
        if (m?.floorMaterial) r.floorMaterial = m.floorMaterial
        if (m?.wallMaterial) r.wallMaterial = m.wallMaterial
      }
      draft.designs.push(d as (typeof draft.designs)[number])
      draft.activeDesignId = d.id
    }, { major: true })
    const g = sortedFloors(getProject().floors).find((f) => f.level === 0)
    ui.set({ floorId: g?.id ?? '', selection: [] })
    maybeAutoVersion(label)
    return d
  } catch (e) {
    ui.showError({ what: 'The plan could not be regenerated', why: String((e as Error)?.message ?? e), fix: 'Your previous plan is unchanged. Relax a requirement and try again.' })
    return null
  } finally {
    ui.set({ busy: null })
  }
}

export function newBlankProject(plot?: Plot) {
  const p = newProject('My Dream House', plot ?? makePlot(35 * 0.3048, 70 * 0.3048))
  openProject(p)
}

export function statsOf(p: Project) {
  return designStats(houseOf(p))
}
