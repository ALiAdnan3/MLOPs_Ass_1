import type { DesignStrategy, Plot, Requirements } from '../../core/model/types'
import { largestInscribedRect, type Rect } from '../../core/geometry/polygon'
import { ft } from '../../core/units/units'

/** CONSTRAINT ENGINE — site: setbacks, yards, car porch, buildable envelope (§6, §28). */

export interface Envelope {
  plotRect: Rect
  maxRect: Rect
  garageW: number
  garageD: number
  cars: number
  frontYard: number
  backReserve: number
  warnings: string[]
  /** Side kept open for ventilation on party-wall plots. */
  ventSide?: 'left' | 'right'
}

export const CAR_BAY = 2.9
export const PORCH_DEPTH = 5.5

export function planEnvelope(plot: Plot, req: Requirements, strategy: DesignStrategy): Envelope {
  const warnings: string[] = []
  const plotRect: Rect = plot.shape === 'irregular' ? largestInscribedRect(plot.polygon, 0.2) : { x: 0, y: 0, w: plot.width, h: plot.depth }
  const sb = { ...plot.setbacks }
  if (plot.corner) {
    if (plot.cornerSide === 'left') sb.left = Math.max(sb.left, ft(5))
    else sb.right = Math.max(sb.right, ft(5))
  }
  // party walls on both sides: keep a 3 ft ventilation strip on one side so side rooms get windows
  let ventSide: 'left' | 'right' | undefined
  if (sb.left < 0.5 && sb.right < 0.5 && plotRect.w >= ft(29) && strategy !== 'room-space' && req.preferences.naturalLight >= 35) {
    ventSide = strategy === 'privacy' ? 'left' : 'right'
    sb[ventSide] = ft(3)
  }
  let cars = req.outdoor.garage ? Math.max(1, Math.min(4, req.outdoor.cars)) : 0
  const garageD = cars ? PORCH_DEPTH : 0
  const maxGarageW = plotRect.w - sb.left - sb.right - (req.outdoor.frontLawn && plotRect.w > ft(30) ? 1.2 : 0)
  while (cars > 1 && cars * CAR_BAY + 0.3 > maxGarageW) cars--
  if (req.outdoor.garage && cars < req.outdoor.cars) warnings.push(`The plot frontage fits ${cars} car${cars > 1 ? 's' : ''} side by side, not ${req.outdoor.cars}`)
  const garageW = cars ? Math.min(cars * CAR_BAY + 0.3, maxGarageW) : 0
  const lawnF = req.outdoor.frontLawn ? (strategy === 'garden' ? 1.35 : 1) : 0
  const frontYard = Math.max(sb.front, garageD, lawnF && plotRect.h > ft(80) ? ft(20) * lawnF : 0)
  const green = req.preferences.greenSpace / 100
  let backReserve = sb.rear
  let wish = 0
  if (req.outdoor.patio) wish += 3.0
  if (req.outdoor.pool) wish += 6.0
  if (req.outdoor.backLawn || req.outdoor.garden) wish += 2.5 + 3 * green
  if (req.outdoor.playArea || req.outdoor.bbq || req.outdoor.outdoorKitchen) wish += 1.5
  if (strategy === 'garden') wish *= 1.35
  if (strategy === 'room-space') wish *= 0.6
  // never let yards eat more than ~45 % of the depth that remains after the front yard
  const availDepth = plotRect.h - frontYard
  backReserve = Math.max(sb.rear, Math.min(wish, availDepth * (strategy === 'garden' ? 0.45 : 0.36)))
  const maxRect: Rect = {
    x: plotRect.x + sb.left,
    y: plotRect.y + backReserve,
    w: plotRect.w - sb.left - sb.right,
    h: plotRect.h - frontYard - backReserve
  }
  if (maxRect.h < 6) {
    // under an authority's rules only the optional garden depth may go, never the legal rear space
    const need = Math.min(6 - maxRect.h, plot.authority ? Math.max(0, backReserve - plot.setbacks.rear) : Infinity)
    if (need > 0) {
      maxRect.y -= need
      maxRect.h += need
      warnings.push('Back yard reduced to keep a usable house depth')
    }
  }
  return { plotRect, maxRect, garageW, garageD, cars, frontYard, backReserve: maxRect.y - plotRect.y, warnings, ventSide }
}

/** Choose the house footprint inside the envelope for a required floor area. */
export function chooseFootprint(env: Envelope, requiredArea: number, strategy: DesignStrategy): Rect {
  const M = env.maxRect
  const factor = strategy === 'garden' ? 1.0 : strategy === 'room-space' ? 1.35 : strategy === 'luxury-open' ? 1.12 : 1.06
  let area = Math.min(requiredArea * factor, M.w * M.h)
  if (strategy === 'room-space') area = M.w * M.h
  let w: number
  if (M.w <= 14.5) w = M.w
  else {
    w = Math.min(M.w, Math.max(12, Math.sqrt(area * 1.15)))
    w = Math.min(w, 26)
  }
  let d = Math.min(M.h, Math.max(6.5, area / w))
  if (d * w < area * 0.98 && w < M.w) w = Math.min(M.w, area / d)
  d = Math.min(M.h, Math.max(6.5, area / w))
  const x = M.x + (M.w - w) / 2
  const y = M.y + M.h - d // abut the front yard so the car porch meets the house
  return { x: round2(x), y: round2(y), w: round2(w), h: round2(d) }
}

const round2 = (v: number) => Math.round(v * 100) / 100
