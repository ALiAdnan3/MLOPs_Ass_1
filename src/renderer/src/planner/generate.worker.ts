/// <reference lib="webworker" />
import { DesignGenerationError, generateDesign } from './generator'
import type { DesignStrategy, Plot, ProjectSettings, Requirements } from '../core/model/types'

export interface GenJob {
  id: number
  req: Requirements
  plot: Plot
  strategy: DesignStrategy
  seed: number
  settings: Pick<ProjectSettings, 'wallThickness' | 'floorHeight' | 'plinthHeight'>
  iterations?: number
}

self.onmessage = (e: MessageEvent<GenJob>) => {
  const j = e.data
  const post = (m: unknown) => (self as unknown as Worker).postMessage(m)
  try {
    const design = generateDesign(j.req, j.plot, j.strategy, { settings: j.settings, seed: j.seed, iterations: j.iterations, onStage: (stage) => post({ id: j.id, stage }) })
    post({ id: j.id, design })
  } catch (err) {
    if (err instanceof DesignGenerationError) post({ id: j.id, error: err.info })
    else post({ id: j.id, error: { what: `Design ${j.strategy} could not be generated`, why: String((err as Error)?.message ?? err), fix: 'Try again, relax one requirement, or add a floor.' } })
  }
}
