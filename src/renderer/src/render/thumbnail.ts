import { useProject } from '../state/store'
import { hasEngine, getEngine } from '../engine/Engine'
import { renderPlanToCanvas } from './planImage'

/** Small preview image for project files and the start screen. */
export async function snapshotThumbnail(): Promise<Blob | null> {
  try {
    if (hasEngine()) {
      const e = getEngine()
      if (e.project && e.container) return await e.snapshot({ width: 480, height: 300, type: 'image/png' })
    }
    const p = useProject.getState().project
    const ground = p.floors.find((f) => f.level === 0) ?? p.floors[0]
    if (!ground) return null
    const canvas = renderPlanToCanvas(p, ground, 480, 300, { theme: 'light', site: true })
    return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'))
  } catch {
    return null
  }
}
