import type { Plot, Vec2 } from './model/types'
import { planBearing } from '../engine/lighting/sun'

/**
 * WHERE THE PLOT IS (amendment A1). The city sets the sun's latitude and the Qibla direction,
 * which the planner uses to seat WCs side-on to the Qibla and validation uses to warn when
 * one faces it or has its back to it.
 */

export interface PlotLocation {
  city?: string
  lat: number
  lon: number
}

export const CITIES: { name: string; lat: number; lon: number }[] = [
  { name: 'Lahore', lat: 31.5204, lon: 74.3587 },
  { name: 'Karachi', lat: 24.8607, lon: 67.0011 },
  { name: 'Islamabad', lat: 33.6844, lon: 73.0479 },
  { name: 'Rawalpindi', lat: 33.5651, lon: 73.0169 },
  { name: 'Faisalabad', lat: 31.4504, lon: 73.135 },
  { name: 'Multan', lat: 30.1575, lon: 71.5249 },
  { name: 'Peshawar', lat: 34.0151, lon: 71.5249 },
  { name: 'Quetta', lat: 30.1798, lon: 66.975 },
  { name: 'Hyderabad', lat: 25.396, lon: 68.3578 },
  { name: 'Gujranwala', lat: 32.1877, lon: 74.1945 },
  { name: 'Sialkot', lat: 32.4945, lon: 74.5229 },
  { name: 'Bahawalpur', lat: 29.3956, lon: 71.6836 },
  { name: 'Sargodha', lat: 32.0836, lon: 72.6711 },
  { name: 'Abbottabad', lat: 34.1688, lon: 73.2215 },
  { name: 'Dubai', lat: 25.2048, lon: 55.2708 },
  { name: 'London', lat: 51.5072, lon: -0.1276 },
  { name: 'New York', lat: 40.7128, lon: -74.006 }
]

export const DEFAULT_LOCATION: PlotLocation = { city: 'Lahore', lat: 31.5204, lon: 74.3587 }

const KAABA = { lat: 21.4225, lon: 39.8262 }
const RAD = Math.PI / 180

export function plotLocation(plot: Pick<Plot, 'location'>): PlotLocation {
  return plot.location ?? DEFAULT_LOCATION
}

/** Great-circle initial bearing to the Kaaba, degrees clockwise from true north. */
export function qiblaBearing(lat: number, lon: number): number {
  const p1 = lat * RAD
  const p2 = KAABA.lat * RAD
  const dl = (KAABA.lon - lon) * RAD
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360
}

/** Unit vector in plan space (x right, y towards the road) pointing at the Qibla. */
export function qiblaVector(plot: Pick<Plot, 'location' | 'roadSide' | 'northOffset'>): Vec2 {
  const l = plotLocation(plot)
  return planBearing(plot, qiblaBearing(l.lat, l.lon))
}

/** Plan angle (radians, same convention as the north arrow) of the Qibla needle. */
export function qiblaAngle(plot: Pick<Plot, 'location' | 'roadSide' | 'northOffset'>): number {
  const v = qiblaVector(plot)
  return Math.atan2(v.x, -v.y)
}

/** Plan direction a seated person faces for an item with this rotation (items face plan +y at 0). */
export function facingOf(rotation: number): Vec2 {
  return { x: -Math.sin(rotation), y: Math.cos(rotation) }
}

/** 'faces' / 'back' when within 45° of facing or turning away from the Qibla, else null. */
export function qiblaConflict(rotation: number, qibla: Vec2): 'faces' | 'back' | null {
  const f = facingOf(rotation)
  const c = f.x * qibla.x + f.y * qibla.y
  if (c > Math.SQRT1_2) return 'faces'
  if (c < -Math.SQRT1_2) return 'back'
  return null
}
