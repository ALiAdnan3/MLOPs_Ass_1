import type { AreaUnit, LengthUnit, UnitSystem } from '../model/types'

/** Internal unit is the meter. */
export const FT = 0.3048
export const IN = 0.0254
export const SQFT = FT * FT

export function toMeters(value: number, unit: LengthUnit): number {
  switch (unit) {
    case 'ft':
      return value * FT
    case 'in':
      return value * IN
    case 'cm':
      return value / 100
    default:
      return value
  }
}

export function fromMeters(m: number, unit: LengthUnit): number {
  switch (unit) {
    case 'ft':
      return m / FT
    case 'in':
      return m / IN
    case 'cm':
      return m * 100
    default:
      return m
  }
}

export const ft = (v: number) => v * FT
export const inch = (v: number) => v * IN

/** Base length unit used by number inputs for a display system. */
export function inputUnit(system: UnitSystem): LengthUnit {
  return system === 'ft-in' || system === 'ft' ? 'ft' : system === 'cm' ? 'cm' : 'm'
}

/** Format a length for display, e.g. 14′ 6″, 14.5 ft, 4.42 m, 442 cm. */
export function formatLength(m: number, system: UnitSystem, opts: { precision?: number; compact?: boolean } = {}): string {
  if (!Number.isFinite(m)) return '—'
  const neg = m < 0
  const a = Math.abs(m)
  let s: string
  switch (system) {
    case 'ft-in': {
      let totalIn = Math.round((a / IN) * 2) / 2 // half-inch precision
      let feet = Math.floor(totalIn / 12)
      let inches = totalIn - feet * 12
      if (inches >= 12) {
        feet += 1
        inches -= 12
      }
      const inStr = Number.isInteger(inches) ? `${inches}` : inches.toFixed(1)
      s = opts.compact && inches === 0 ? `${feet}′` : `${feet}′ ${inStr}″`
      if (feet === 0 && !opts.compact) s = `${inStr}″`
      break
    }
    case 'ft':
      s = `${(a / FT).toFixed(opts.precision ?? 1)} ft`
      break
    case 'cm':
      s = `${(a * 100).toFixed(opts.precision ?? 0)} cm`
      break
    default:
      s = `${a.toFixed(opts.precision ?? 2)} m`
  }
  return neg ? `−${s}` : s
}

/** Parse user input like `14'6"`, `14 ft 6 in`, `14.5`, `4.2m`, `420cm`, `170 in`. Bare numbers use `fallback`. */
export function parseLength(input: string, fallback: LengthUnit): number | null {
  const t = input.trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″”]/g, '"').replace(/,/g, '')
  if (!t) return null
  // feet + inches: 14'6", 14' 6, 14ft 6in, 14 feet 6 inches
  const fi = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(\d+(?:\.\d+)?)?\s*(?:"|in|inch|inches)?$/)
  if (fi) {
    const feet = parseFloat(fi[1])
    const inches = fi[2] ? parseFloat(fi[2]) : 0
    return feet * FT + Math.sign(feet || 1) * inches * IN
  }
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|meters?|metres?|in|inch|inches|"|ft|feet|foot|')?$/)
  if (!m) return null
  const v = parseFloat(m[1])
  switch (m[2]) {
    case 'mm':
      return v / 1000
    case 'cm':
      return v / 100
    case 'm':
    case 'meter':
    case 'meters':
    case 'metre':
    case 'metres':
      return v
    case 'in':
    case 'inch':
    case 'inches':
    case '"':
      return v * IN
    case 'ft':
    case 'feet':
    case 'foot':
    case "'":
      return v * FT
    default:
      return toMeters(v, fallback)
  }
}

export function sqmToSqft(a: number) {
  return a / SQFT
}

export function formatArea(sqm: number, unit: AreaUnit, marlaSqft = 225): string {
  if (!Number.isFinite(sqm)) return '—'
  const sqft = sqm / SQFT
  switch (unit) {
    case 'sqm':
      return `${sqm.toFixed(sqm < 100 ? 1 : 0)} m²`
    case 'marla':
      return `${(sqft / marlaSqft).toFixed(2)} marla`
    case 'kanal':
      return `${(sqft / (marlaSqft * 20)).toFixed(2)} kanal`
    default:
      return `${Math.round(sqft).toLocaleString('en-US')} ft²`
  }
}

/** Area in the unit the display system implies (sq ft for imperial, m² for metric). */
export function formatAreaFor(sqm: number, system: UnitSystem): string {
  return system === 'm' || system === 'cm' ? formatArea(sqm, 'sqm') : formatArea(sqm, 'sqft')
}

/** "35 × 70 ft" style plot label. */
export function formatPlotSize(widthM: number, depthM: number, system: UnitSystem): string {
  if (system === 'm' || system === 'cm') return `${widthM.toFixed(1)} × ${depthM.toFixed(1)} m`
  const w = widthM / FT
  const d = depthM / FT
  const f = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? `${Math.round(v)}` : v.toFixed(1))
  return `${f(w)} × ${f(d)} ft`
}

export function marlaFromSqm(sqm: number, marlaSqft = 225) {
  return sqm / SQFT / marlaSqft
}

/** Round to a grid step (m). */
export function snapTo(v: number, step: number) {
  if (step <= 0) return v
  return Math.round(v / step) * step
}

/** Grid presets (§59). */
export const GRID_PRESETS_IMPERIAL: { label: string; value: number }[] = [
  { label: '1 inch', value: IN },
  { label: '3 inches', value: 3 * IN },
  { label: '6 inches', value: 6 * IN },
  { label: '1 foot', value: FT }
]
export const GRID_PRESETS_METRIC: { label: string; value: number }[] = [
  { label: '1 cm', value: 0.01 },
  { label: '5 cm', value: 0.05 },
  { label: '10 cm', value: 0.1 },
  { label: '50 cm', value: 0.5 }
]
