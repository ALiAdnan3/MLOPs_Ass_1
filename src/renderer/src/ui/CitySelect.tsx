import { CITIES, plotLocation } from '../core/location'
import type { Plot } from '../core/model/types'

/** City picker for the plot (amendment A1): sets the sun's latitude and the Qibla direction. */
export function CitySelect({ plot, onChange, className = 'field' }: { plot: Pick<Plot, 'location'>; onChange: (loc: NonNullable<Plot['location']>) => void; className?: string }) {
  const cur = plotLocation(plot)
  const known = CITIES.some((c) => c.name === cur.city)
  return (
    <select
      className={className}
      aria-label="City"
      value={known ? cur.city : ''}
      onChange={(e) => {
        const c = CITIES.find((x) => x.name === e.target.value)
        if (c) onChange({ city: c.name, lat: c.lat, lon: c.lon })
      }}
    >
      {!known && <option value="">{cur.city ?? `${cur.lat.toFixed(2)}°, ${cur.lon.toFixed(2)}°`}</option>}
      {CITIES.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </select>
  )
}
