import type { LightingSettings, Plot } from '../../core/model/types'

/**
 * Solar position (§35: sun direction, time of day, latitude, season). Returns altitude/azimuth
 * and the world-space direction towards the sun, honouring the plot's road-side orientation.
 */

const RAD = Math.PI / 180
const ROAD_BEARING: Record<Plot['roadSide'], number> = { N: 0, E: 90, S: 180, W: 270 }

export function declination(dayOfYear: number) {
  return 23.44 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365)
}

export function solarPosition(latitude: number, dayOfYear: number, hour: number) {
  const phi = latitude * RAD
  const dec = declination(dayOfYear) * RAD
  const H = (hour - 12) * 15 * RAD
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)))
  const cosAz = (Math.sin(dec) - Math.sin(alt) * Math.sin(phi)) / (Math.cos(alt) * Math.cos(phi) || 1e-6)
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) / RAD
  if (H > 0) az = 360 - az
  return { altitude: alt / RAD, azimuth: az }
}

export function sunriseSunset(latitude: number, dayOfYear: number) {
  const phi = latitude * RAD
  const dec = declination(dayOfYear) * RAD
  const c = -Math.tan(phi) * Math.tan(dec)
  const H0 = Math.acos(Math.max(-1, Math.min(1, c))) / RAD / 15
  return { sunrise: 12 - H0, sunset: 12 + H0 }
}

/** Plan-space unit vector (x, y-down) for a compass bearing, given the plot orientation. */
export function planBearing(plot: Pick<Plot, 'roadSide' | 'northOffset'>, bearingDeg: number) {
  const beta = ROAD_BEARING[plot.roadSide] + (plot.northOffset ?? 0)
  const a = (bearingDeg - beta + 180) * RAD
  return { x: Math.sin(a), y: -Math.cos(a) }
}

/** Angle (radians, plan) that the north arrow should point to. */
export function northAngle(plot: Pick<Plot, 'roadSide' | 'northOffset'>) {
  const n = planBearing(plot, 0)
  return Math.atan2(n.x, -n.y)
}

export function sunDirection(plot: Pick<Plot, 'roadSide' | 'northOffset'>, s: LightingSettings) {
  const { altitude, azimuth } = solarPosition(s.latitude, s.dayOfYear, s.time)
  const p = planBearing(plot, azimuth)
  const ca = Math.cos(altitude * RAD)
  return { x: p.x * ca, y: Math.sin(altitude * RAD), z: p.y * ca, altitude, azimuth }
}

export const LIGHT_PRESETS: { key: LightingSettings['preset']; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'noon', label: 'Noon' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'sunset', label: 'Sunset' },
  { key: 'night', label: 'Night' }
]

export function presetTime(preset: LightingSettings['preset'], latitude: number, dayOfYear: number) {
  const { sunset, sunrise } = sunriseSunset(latitude, dayOfYear)
  switch (preset) {
    case 'morning':
      return Math.max(sunrise + 1.2, 7.5)
    case 'noon':
      return 12.4
    case 'afternoon':
      return 15.5
    case 'sunset':
      return sunset - 0.3
    case 'night':
      return Math.min(23, sunset + 2.2)
    default:
      return 15.5
  }
}

/** 0 = full day, 1 = full night — used to blend lights, sky and exposure. */
export function nightFactor(altitudeDeg: number) {
  if (altitudeDeg >= 8) return 0
  if (altitudeDeg <= -6) return 1
  return (8 - altitudeDeg) / 14
}

export const SEASONS: { label: string; day: number }[] = [
  { label: 'Winter', day: 355 },
  { label: 'Spring', day: 80 },
  { label: 'Summer', day: 172 },
  { label: 'Autumn', day: 264 }
]
