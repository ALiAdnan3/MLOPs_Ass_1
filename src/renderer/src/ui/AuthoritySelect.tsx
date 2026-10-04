import { AUTHORITIES, type Authority } from '../core/bylaws'

/** Development authority picker (amendment A4). "None" keeps the plot's own setbacks. */
export function AuthoritySelect({ value, onChange, className = 'field' }: { value?: Authority; onChange: (a: Authority | undefined) => void; className?: string }) {
  return (
    <select className={className} aria-label="Building rules" value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as Authority | undefined)}>
      <option value="">No authority rules</option>
      {(Object.keys(AUTHORITIES) as Authority[]).map((k) => (
        <option key={k} value={k}>
          {AUTHORITIES[k].name}
        </option>
      ))}
    </select>
  )
}
