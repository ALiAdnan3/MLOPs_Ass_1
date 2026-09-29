import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { formatLength, fromMeters, inputUnit, parseLength } from '../core/units/units'
import type { UnitSystem } from '../core/model/types'

/* Buttons ------------------------------------------------------------------- */

export function IconButton(props: { icon: ReactNode; label: string; shortcut?: string; active?: boolean; disabled?: boolean; onClick?: (e: React.MouseEvent) => void; className?: string; style?: CSSProperties }) {
  return (
    <button
      className={`icon-btn ${props.active ? 'active' : ''} ${props.className ?? ''}`}
      aria-label={props.label}
      data-tip={props.label}
      data-kbd={props.shortcut}
      disabled={props.disabled}
      onClick={props.onClick}
      style={props.style}
    >
      {props.icon}
    </button>
  )
}

export function Switch(props: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button role="switch" aria-checked={props.on} aria-label={props.label} className={`switch ${props.on ? 'on' : ''}`} onClick={() => props.onChange(!props.on)} />
}

export function Seg<T extends string>(props: { value: T; options: { value: T; label: ReactNode; tip?: string }[]; onChange: (v: T) => void; full?: boolean }) {
  return (
    <div className={`seg ${props.full ? 'full' : ''}`} role="radiogroup">
      {props.options.map((o) => (
        <button key={o.value} role="radio" aria-checked={props.value === o.value} className={props.value === o.value ? 'on' : ''} data-tip={o.tip} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Slider(props: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: (v: number) => void; label?: string }) {
  const fill = ((props.value - props.min) / (props.max - props.min)) * 100
  return (
    <input
      type="range"
      aria-label={props.label}
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      value={props.value}
      style={{ ['--fill' as string]: `${fill}%` }}
      onChange={(e) => props.onChange(Number(e.target.value))}
      onPointerUp={(e) => props.onCommit?.(Number((e.target as HTMLInputElement).value))}
    />
  )
}

/* Number & length fields ----------------------------------------------------- */

/** Length input in the project's display units; accepts 14'6", 14.5, 4.2m, 420cm … */
export function LengthField(props: { value: number; units: UnitSystem; onCommit: (m: number) => void; min?: number; max?: number; prefix?: string; disabled?: boolean; tip?: string }) {
  const [text, setText] = useState(formatLength(props.value, props.units))
  const [focus, setFocus] = useState(false)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    if (!focus) setText(formatLength(props.value, props.units))
  }, [props.value, props.units, focus])
  const commit = () => {
    const v = parseLength(text, inputUnit(props.units))
    if (v === null || !Number.isFinite(v)) {
      setBad(true)
      setText(formatLength(props.value, props.units))
      setTimeout(() => setBad(false), 900)
      return
    }
    const c = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, v))
    if (Math.abs(c - props.value) > 1e-6) props.onCommit(c)
    setText(formatLength(c, props.units))
  }
  return (
    <div className={`num-field ${props.prefix ? 'prefixed' : ''}`} data-tip={props.tip}>
      {props.prefix && <span className="prefix">{props.prefix}</span>}
      <input
        className={`field ${bad ? 'invalid' : ''}`}
        value={text}
        disabled={props.disabled}
        onFocus={(e) => {
          setFocus(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          setFocus(false)
          commit()
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setText(formatLength(props.value, props.units))
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const unit = inputUnit(props.units)
            const step = unit === 'ft' ? 0.1524 : unit === 'cm' ? 0.05 : 0.05
            props.onCommit(Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, props.value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1))))
          }
          e.stopPropagation()
        }}
      />
    </div>
  )
}

export function NumberField(props: { value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; decimals?: number; prefix?: string }) {
  const [text, setText] = useState(String(props.value))
  const [focus, setFocus] = useState(false)
  useEffect(() => {
    if (!focus) setText(fmtNum(props.value, props.decimals))
  }, [props.value, focus, props.decimals])
  const commit = () => {
    const v = Number(text.replace(/[^0-9.+-eE]/g, ''))
    if (!Number.isFinite(v)) {
      setText(fmtNum(props.value, props.decimals))
      return
    }
    const c = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, v))
    if (c !== props.value) props.onCommit(c)
    setText(fmtNum(c, props.decimals))
  }
  return (
    <div className={`num-field ${props.prefix ? 'prefixed' : ''}`}>
      {props.prefix && <span className="prefix">{props.prefix}</span>}
      <input
        className="field"
        value={text}
        onFocus={(e) => {
          setFocus(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          setFocus(false)
          commit()
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const s = (props.step ?? 1) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
            props.onCommit(Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, props.value + s)))
          }
          e.stopPropagation()
        }}
      />
      {props.unit && <span className="unit">{props.unit}</span>}
    </div>
  )
}

const fmtNum = (v: number, d = 2) => (Number.isInteger(v) ? String(v) : v.toFixed(d))

export function lengthIn(units: UnitSystem, m: number) {
  return fromMeters(m, inputUnit(units))
}

/* Tooltip layer: any element with data-tip gets a tooltip -------------------- */

export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; kbd?: string; x: number; y: number; below: boolean } | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let current: HTMLElement | null = null
    const over = (e: PointerEvent) => {
      const el = (e.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null
      if (el === current) return
      current = el
      if (timer) clearTimeout(timer)
      setTip(null)
      if (!el || !el.dataset.tip) return
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect()
        const below = r.top < 60
        setTip({ text: el.dataset.tip!, kbd: el.dataset.kbd, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below })
      }, 450)
    }
    const hide = () => {
      if (timer) clearTimeout(timer)
      setTip(null)
      current = null
    }
    window.addEventListener('pointerover', over)
    window.addEventListener('pointerdown', hide)
    window.addEventListener('wheel', hide, { passive: true })
    return () => {
      window.removeEventListener('pointerover', over)
      window.removeEventListener('pointerdown', hide)
      window.removeEventListener('wheel', hide)
    }
  }, [])
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!tip || !ref.current) return setPos(null)
    const r = ref.current.getBoundingClientRect()
    let left = tip.x - r.width / 2
    left = Math.max(6, Math.min(window.innerWidth - r.width - 6, left))
    const top = tip.below ? tip.y : tip.y - r.height
    setPos({ left, top })
  }, [tip])
  if (!tip) return null
  return createPortal(
    <div ref={ref} className="tip" style={{ left: pos?.left ?? -999, top: pos?.top ?? -999 }}>
      <span>{tip.text}</span>
      {tip.kbd && <span className="kbd">{tip.kbd}</span>}
    </div>,
    document.body
  )
}

/* Menus ---------------------------------------------------------------------- */

export interface MenuItem {
  label?: string
  icon?: ReactNode
  shortcut?: string
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  heading?: string
  checked?: boolean
}

export function Menu(props: { items: MenuItem[]; x: number; y: number; onClose: () => void; minWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: props.x, top: props.y })
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ left: Math.min(props.x, window.innerWidth - r.width - 8), top: Math.min(props.y, window.innerHeight - r.height - 8) })
  }, [props.x, props.y])
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) props.onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    setTimeout(() => window.addEventListener('pointerdown', down), 0)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key)
    }
  }, [props])
  return createPortal(
    <div ref={ref} className="menu" style={{ ...pos, minWidth: props.minWidth }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {props.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : it.heading ? (
          <div key={i} className="menu-label">
            {it.heading}
          </div>
        ) : (
          <div
            key={i}
            role="menuitem"
            className={`menu-item ${it.disabled ? 'disabled' : ''} ${it.danger ? 'danger' : ''}`}
            onClick={() => {
              props.onClose()
              it.onClick?.()
            }}
          >
            {it.icon ?? <span style={{ width: 15 }}>{it.checked ? '✓' : ''}</span>}
            <span>{it.label}</span>
            {it.shortcut && <span className="kbd">{it.shortcut}</span>}
          </div>
        )
      )}
    </div>,
    document.body
  )
}

/* Context menu singleton ----------------------------------------------------- */

type CtxState = { items: MenuItem[]; x: number; y: number } | null
let setCtx: ((s: CtxState) => void) | null = null
export function openContextMenu(e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]) {
  e.preventDefault?.()
  setCtx?.({ items, x: e.clientX, y: e.clientY })
}
export function ContextMenuHost() {
  const [s, set] = useState<CtxState>(null)
  useEffect(() => {
    setCtx = set
    return () => {
      setCtx = null
    }
  }, [])
  if (!s) return null
  return <Menu items={s.items} x={s.x} y={s.y} onClose={() => set(null)} />
}

/* Modal ---------------------------------------------------------------------- */

export function Modal(props: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; size?: 'normal' | 'wide' | 'xwide'; icon?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        props.onClose()
      }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [props])
  return createPortal(
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.size === 'wide' ? 'wide' : props.size === 'xwide' ? 'xwide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          {props.icon}
          <div className="grow">
            <h2>{props.title}</h2>
            {props.subtitle && <p>{props.subtitle}</p>}
          </div>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export function Stepper(props: { value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <button aria-label="Fewer" onClick={() => props.onChange(Math.max(props.min ?? 0, props.value - 1))}>
        <svg viewBox="0 0 12 12">
          <path d="M2 6h8" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      <span>{props.value}</span>
      <button aria-label="More" onClick={() => props.onChange(Math.min(props.max ?? 99, props.value + 1))}>
        <svg viewBox="0 0 12 12">
          <path d="M2 6h8M6 2v8" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
    </div>
  )
}

export function BrandMark(props: { size?: number }) {
  const s = props.size ?? 18
  return (
    <svg className="brand-mark" width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 11.2 12 4l9 7.2" stroke="var(--text)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M5.5 10v9.5h13V10" stroke="var(--text)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M5.5 15.2h13" stroke="var(--tape)" strokeWidth="1.8" />
      <path d="M12 15.2v4.3" stroke="var(--tape)" strokeWidth="1.8" />
    </svg>
  )
}
