import { create } from 'zustand'
import type { Plot, Requirements, Vec2 } from '../core/model/types'
import { defaultRequirements, makePlot, plotFromPreset } from '../core/model/defaults'
import type { ParsedRequirements, ParseFinding } from '../ai/requirementParser'
import { rectPoly } from '../core/geometry/polygon'

export interface WizardState {
  step: number
  req: Requirements
  plot: Plot
  plotMode: 'preset' | 'custom' | 'irregular'
  prompt: string
  findings: ParseFinding[]
  unclear: string[]
  /** Editing the requirements of an open project (apply designs to it, not a new project). */
  targetExisting: boolean
  setStep: (n: number) => void
  setReq: (fn: (r: Requirements) => void) => void
  setPlot: (fn: (p: Plot) => void) => void
  choosePreset: (id: string) => void
  setCustom: (widthM: number, depthM: number) => void
  setPolygon: (poly: Vec2[]) => void
  applyParsed: (r: ParsedRequirements, prompt: string) => void
  reset: () => void
}

export const useWizard = create<WizardState>((set, get) => ({
  step: 0,
  req: defaultRequirements(),
  plot: plotFromPreset('10-marla'),
  plotMode: 'preset',
  prompt: '',
  findings: [],
  unclear: [],
  targetExisting: false,
  setStep: (n) => set({ step: n }),
  setReq: (fn) => {
    const r = structuredClone(get().req)
    fn(r)
    set({ req: r })
  },
  setPlot: (fn) => {
    const p = structuredClone(get().plot)
    fn(p)
    set({ plot: p })
  },
  choosePreset: (id) => {
    const keep = get().plot
    const p = plotFromPreset(id)
    p.roadSide = keep.roadSide
    p.corner = keep.corner
    p.cornerSide = keep.cornerSide
    p.northOffset = keep.northOffset
    set({ plot: p, plotMode: 'preset' })
  },
  setCustom: (w, d) => {
    const keep = get().plot
    const p = makePlot(w, d)
    p.roadSide = keep.roadSide
    p.corner = keep.corner
    p.cornerSide = keep.cornerSide
    set({ plot: p, plotMode: get().plotMode === 'irregular' ? 'irregular' : 'custom' })
  },
  setPolygon: (poly) => {
    const p = structuredClone(get().plot)
    p.polygon = poly
    p.shape = 'irregular'
    set({ plot: p, plotMode: 'irregular' })
  },
  applyParsed: (r, prompt) => {
    let plot = get().plot
    if (r.plot?.presetId) plot = plotFromPreset(r.plot.presetId)
    else if (r.plot?.widthM && r.plot.depthM) plot = makePlot(r.plot.widthM, r.plot.depthM)
    set({ req: r.req, plot, findings: r.findings, unclear: r.unclear, prompt, plotMode: r.plot?.presetId ? 'preset' : r.plot ? 'custom' : get().plotMode })
  },
  reset: () => set({ step: 0, req: defaultRequirements(), plot: plotFromPreset('10-marla'), plotMode: 'preset', prompt: '', findings: [], unclear: [], targetExisting: false })
}))

export function rectPlotPolygon(w: number, d: number) {
  return rectPoly({ x: 0, y: 0, w, h: d })
}
