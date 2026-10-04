import { useProject, commit } from '../state/store'
import { CitySelect } from '../ui/CitySelect'
import { useUI } from '../state/ui'
import { Seg, Slider, Switch } from '../ui/primitives'
import { SEASONS, solarPosition, LIGHT_PRESETS, presetTime } from '../engine/lighting/sun'
import { platform } from '../storage/platform'
import type { Quality } from '../core/model/types'

/** 3D view settings: lighting (§35) and render quality (§2). */
export function View3DPanel() {
  const L = useProject((s) => s.project.settings.lighting)
  const plot = useProject((s) => s.project.plot)
  const quality = useUI((s) => s.quality)
  const set = useUI((s) => s.set)
  const sun = solarPosition(L.latitude, L.dayOfYear, L.time)
  const hh = Math.floor(L.time)
  const mm = Math.round((L.time - hh) * 60)
  const upd = (label: string, fn: (l: typeof L) => void) => commit(label, (d) => fn(d.settings.lighting), { coalesce: `light-${label}` })
  return (
    <>
      <div className="section">
        <div className="section-head">
          <h3>Lighting</h3>
          <span className="sub tabular">
            Sun {sun.altitude.toFixed(0)}° high, {sun.azimuth.toFixed(0)}° from north
          </span>
        </div>
        <div className="prop">
          <label>Preset</label>
          <select className="field" value={L.preset} onChange={(e) => {
              const preset = e.target.value as typeof L.preset
              commit(`Lighting: ${preset}`, (d) => {
                d.settings.lighting.preset = preset
                if (preset !== 'custom') d.settings.lighting.time = presetTime(preset, L.latitude, L.dayOfYear)
              })
            }}>
            {LIGHT_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="prop">
          <label>Time of day</label>
          <div className="row">
            <Slider value={L.time} min={5} max={23.5} step={0.25} onChange={(v) => upd('Time of day', (l) => {
                l.time = v
                l.preset = 'custom'
              })} label="Time of day" />
            <span className="tabular faint" style={{ width: 40 }}>
              {String(hh).padStart(2, '0')}:{String(mm).padStart(2, '0')}
            </span>
          </div>
        </div>
        <div className="prop">
          <label>Season</label>
          <Seg value={String(SEASONS.reduce((b, s) => (Math.abs(s.day - L.dayOfYear) < Math.abs(b.day - L.dayOfYear) ? s : b)).day)} onChange={(v) => upd('Season', (l) => void (l.dayOfYear = Number(v)))} options={SEASONS.map((s) => ({ value: String(s.day), label: s.label }))} />
        </div>
        <div className="prop">
          <label>City</label>
          <CitySelect
            plot={plot}
            onChange={(loc) =>
              commit(`Location: ${loc.city}`, (d) => {
                d.plot.location = loc
                d.settings.lighting.latitude = loc.lat
              })
            }
          />
        </div>
        <div className="prop">
          <label>Latitude</label>
          <div className="row">
            <Slider value={L.latitude} min={-60} max={65} step={0.5} onChange={(v) => upd('Latitude', (l) => void (l.latitude = v))} label="Latitude" />
            <span className="tabular faint" style={{ width: 40 }}>
              {L.latitude.toFixed(1)}°
            </span>
          </div>
        </div>
        <div className="prop">
          <label>Interior lights</label>
          <Switch on={L.interiorLights} onChange={(v) => upd('Interior lights', (l) => void (l.interiorLights = v))} />
        </div>
        <div className="prop">
          <label>Exterior lights</label>
          <Switch on={L.exteriorLights} onChange={(v) => upd('Exterior lights', (l) => void (l.exteriorLights = v))} />
        </div>
        <p className="faint" style={{ fontSize: 11 }}>
          Lahore is 31.5°, Karachi 24.9°, Islamabad 33.7°. The north direction comes from the plot’s road side.
        </p>
      </div>
      <div className="section">
        <div className="section-head">
          <h3>Render quality</h3>
        </div>
        <Seg<Quality>
          full
          value={quality}
          onChange={(q) => {
            set({ quality: q })
            void platform.settings.set({ quality: q })
          }}
          options={[
            { value: 'low', label: 'Low', tip: 'Fast on any laptop: no shadows' },
            { value: 'medium', label: 'Medium', tip: 'Soft shadows' },
            { value: 'high', label: 'High', tip: 'Sharper shadows, glow at night' },
            { value: 'ultra', label: 'Ultra', tip: 'Ambient occlusion and 4K shadows; needs a good GPU' }
          ]}
        />
      </div>
    </>
  )
}
