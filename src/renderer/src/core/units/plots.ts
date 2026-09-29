import { FT } from './units'

/**
 * Common Pakistani plot sizes (§3). Dimensions are typical society layouts at 225 ft²/marla.
 * Width = frontage (road side), depth = distance to the rear boundary.
 */
export interface PlotPreset {
  id: string
  label: string
  marla: number
  widthFt: number
  depthFt: number
  /** Typical by-law style setbacks (ft) used as generator defaults. */
  setbacksFt: { front: number; rear: number; left: number; right: number }
}

export const PLOT_PRESETS: PlotPreset[] = [
  { id: '3-marla', label: '3 Marla', marla: 3, widthFt: 20, depthFt: 34, setbacksFt: { front: 4, rear: 3, left: 0, right: 0 } },
  { id: '5-marla', label: '5 Marla', marla: 5, widthFt: 25, depthFt: 45, setbacksFt: { front: 5, rear: 4, left: 0, right: 0 } },
  { id: '7-marla', label: '7 Marla', marla: 7, widthFt: 35, depthFt: 45, setbacksFt: { front: 6, rear: 5, left: 0, right: 0 } },
  { id: '8-marla', label: '8 Marla', marla: 8, widthFt: 30, depthFt: 60, setbacksFt: { front: 7, rear: 5, left: 0, right: 0 } },
  { id: '10-marla', label: '10 Marla', marla: 10, widthFt: 35, depthFt: 65, setbacksFt: { front: 8, rear: 5, left: 0, right: 0 } },
  { id: '12-marla', label: '12 Marla', marla: 12, widthFt: 40, depthFt: 67.5, setbacksFt: { front: 10, rear: 6, left: 0, right: 0 } },
  { id: '15-marla', label: '15 Marla', marla: 15, widthFt: 45, depthFt: 75, setbacksFt: { front: 12, rear: 6, left: 3, right: 3 } },
  { id: '1-kanal', label: '1 Kanal', marla: 20, widthFt: 50, depthFt: 90, setbacksFt: { front: 15, rear: 7, left: 5, right: 5 } },
  { id: '2-kanal', label: '2 Kanal', marla: 40, widthFt: 75, depthFt: 120, setbacksFt: { front: 20, rear: 10, left: 8, right: 8 } },
  { id: '4-kanal', label: '4 Kanal', marla: 80, widthFt: 120, depthFt: 150, setbacksFt: { front: 25, rear: 15, left: 12, right: 12 } }
]

export function presetById(id?: string) {
  return PLOT_PRESETS.find((p) => p.id === id)
}

/** Default setbacks for a custom plot, interpolated from the nearest preset by area. */
export function setbacksForArea(sqm: number) {
  const sqft = sqm / (FT * FT)
  let best = PLOT_PRESETS[0]
  for (const p of PLOT_PRESETS) if (p.widthFt * p.depthFt <= sqft * 1.05) best = p
  const s = best.setbacksFt
  return { front: s.front * FT, rear: s.rear * FT, left: s.left * FT, right: s.right * FT }
}

/** Size class drives default room sizes. */
export type SizeClass = 'compact' | 'standard' | 'large' | 'estate'
export function sizeClassForArea(sqm: number): SizeClass {
  const sqft = sqm / (FT * FT)
  if (sqft <= 1300) return 'compact'
  if (sqft <= 3000) return 'standard'
  if (sqft <= 6000) return 'large'
  return 'estate'
}
