import type { ArchitecturalStyle, DesignOption, DesignStrategy, Plot, ProjectSettings, Requirements } from '../core/model/types'
import type { GenJob } from '../planner/generate.worker'
import { generateDesign, type GenerationError, type PipelineStage, STRATEGIES } from '../planner/generator'

/**
 * AI design generation service (§5). Each strategy runs in its own worker, in parallel, so the
 * UI stays responsive (§50) and reports real pipeline progress (§55).
 */

export interface GenProgress {
  strategy: DesignStrategy
  stage?: PipelineStage
  design?: DesignOption
  error?: GenerationError
}

let jobId = 1

export function generateDesignsParallel(
  req: Requirements,
  plot: Plot,
  settings: Pick<ProjectSettings, 'wallThickness' | 'floorHeight' | 'plinthHeight'>,
  onProgress: (p: GenProgress) => void,
  /** `styles`: a different architectural style per strategy ("show me different styles"). */
  opts: { strategies?: DesignStrategy[]; baseSeed?: number; iterations?: number; styles?: Partial<Record<DesignStrategy, ArchitecturalStyle>> } = {}
): Promise<{ designs: DesignOption[]; errors: GenerationError[] }> {
  const list = opts.strategies ?? STRATEGIES.map((s) => s.key)
  const base = opts.baseSeed ?? Math.floor(Math.random() * 1e6)
  const designs: DesignOption[] = []
  const errors: GenerationError[] = []
  const conc = Math.max(1, Math.min(list.length, (navigator.hardwareConcurrency || 4) - 1))
  let next = 0
  return new Promise((resolve) => {
    let running = 0
    let done = 0
    const launch = () => {
      while (running < conc && next < list.length) {
        const strategy = list[next]
        const seed = base + next * 977
        next++
        running++
        const style = opts.styles?.[strategy]
        runOne({ id: jobId++, req: style ? { ...req, style } : req, plot, strategy, seed, settings, iterations: opts.iterations }, (m) => onProgress({ strategy, ...m })).then((r) => {
          running--
          done++
          if (r.design) designs.push(r.design)
          if (r.error) errors.push(r.error)
          onProgress({ strategy, design: r.design, error: r.error })
          if (done === list.length) {
            const order = new Map(list.map((s, i) => [s, i]))
            designs.sort((a, b) => (order.get(a.strategy) ?? 0) - (order.get(b.strategy) ?? 0))
            resolve({ designs, errors })
          } else launch()
        })
      }
    }
    launch()
  })
}

function runOne(job: GenJob, onStage: (m: { stage: PipelineStage }) => void): Promise<{ design?: DesignOption; error?: GenerationError }> {
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('../planner/generate.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      // no worker support: run inline
      try {
        resolve({ design: generateDesign(job.req, job.plot, job.strategy, { settings: job.settings, seed: job.seed, iterations: job.iterations, onStage: (stage) => onStage({ stage }) }) })
      } catch (e) {
        resolve({ error: { what: 'Generation failed', why: String((e as Error)?.message ?? e), fix: 'Try again.' } })
      }
      return
    }
    worker.onmessage = (e) => {
      const d = e.data
      if (d.stage) return onStage({ stage: d.stage })
      worker.terminate()
      resolve(d.design ? { design: d.design } : { error: d.error })
    }
    worker.onerror = (e) => {
      worker.terminate()
      resolve({ error: { what: `Design ${job.strategy} failed`, why: e.message || 'The generator stopped unexpectedly.', fix: 'Try again, or relax one requirement.' } })
    }
    worker.postMessage(job)
  })
}
