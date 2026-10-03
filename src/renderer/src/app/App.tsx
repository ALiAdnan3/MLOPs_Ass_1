import { Component, useEffect, type ReactNode } from 'react'
import { TriangleAlert, CircleCheck, Info, CircleX } from 'lucide-react'
import { useUI } from '../state/ui'
import { platform } from '../storage/platform'
import { configureAutosave, openRecent, startAutosave } from '../storage/session'
import { ContextMenuHost, Modal, PromptHost, TooltipLayer } from '../ui/primitives'
import { Dashboard } from '../screens/Dashboard'
import { Wizard } from '../screens/Wizard'
import { Designs } from '../screens/Designs'
import { Workspace } from '../workspace/Workspace'
import { DialogHost } from '../dialogs/DialogHost'
import { useShortcuts } from './shortcuts'

/** Root: theme, screens, and the global layers (tooltips, menus, toasts, errors, progress). */
export function App() {
  const screen = useUI((s) => s.screen)
  const theme = useUI((s) => s.theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    platform.setTitleBarTheme(theme)
  }, [theme])

  useEffect(() => {
    platform.settings.get().then((s) => {
      const theme = s.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : s.theme
      // ?quality=low|medium|high|ultra and ?theme=light|dark override saved settings (testing, weak GPUs)
      const q = new URLSearchParams(location.search)
      const qq = q.get('quality') as typeof s.quality | null
      const qt = q.get('theme') as 'light' | 'dark' | null
      useUI.getState().set({ theme: qt ?? theme, quality: qq ?? s.quality, uiMode: (q.get('ui') as typeof s.uiMode | null) ?? s.uiMode })
      configureAutosave(s.autosaveSeconds)
    })
    startAutosave()
    const off = platform.onOpenFile((p) => void openRecent(p))
    return off
  }, [])

  useShortcuts()

  return (
    <div className="app">
      <ErrorBoundary area="application">
        {screen === 'home' && <Dashboard />}
        {screen === 'wizard' && <Wizard />}
        {screen === 'designs' && <Designs />}
        {screen === 'workspace' && <Workspace />}
      </ErrorBoundary>
      <TooltipLayer />
      <ContextMenuHost />
      <PromptHost />
      <DialogHost />
      <Toasts />
      <ErrorDialog />
      <Busy />
    </div>
  )
}

function Toasts() {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismiss)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === 'success' ? <CircleCheck size={16} color="var(--ok)" /> : t.kind === 'error' ? <CircleX size={16} color="var(--danger)" /> : t.kind === 'warning' ? <TriangleAlert size={16} color="var(--warn)" /> : <Info size={16} color="var(--chalk)" />}
          <div className="grow">
            <div className="t-title">{t.title}</div>
            {t.body && <div className="t-body">{t.body}</div>}
          </div>
          {t.action && (
            <button
              className="btn sm"
              onClick={(e) => {
                e.stopPropagation()
                t.action!.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** §51: never fail silently — what happened, why, what to do, retry. */
function ErrorDialog() {
  const error = useUI((s) => s.error)
  const set = useUI((s) => s.set)
  if (!error) return null
  const close = () => set({ error: null })
  return (
    <Modal
      title={error.what}
      icon={<TriangleAlert size={22} color="var(--danger)" />}
      onClose={close}
      footer={
        <>
          <button className="btn ghost" onClick={close}>
            Close
          </button>
          {error.retry && (
            <button
              className="btn primary"
              onClick={() => {
                close()
                error.retry!()
              }}
            >
              Retry
            </button>
          )}
        </>
      }
    >
      <div className="error-card">
        <dl>
          <dt>What happened</dt>
          <dd>{error.what}</dd>
          <dt>Why</dt>
          <dd>{error.why}</dd>
          <dt>What you can do</dt>
          <dd>{error.fix}</dd>
        </dl>
      </div>
    </Modal>
  )
}

function Busy() {
  const busy = useUI((s) => s.busy)
  if (!busy) return null
  return (
    <div className="busy">
      <div className="busy-card">
        <div className="spinner" />
        <div>{busy}</div>
      </div>
    </div>
  )
}

export class ErrorBoundary extends Component<{ area: string; children: ReactNode; compact?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    platform.log('error', `[${this.props.area}] ${error.stack ?? error.message}`)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty" style={{ margin: 'auto', maxWidth: 520 }}>
        <TriangleAlert />
        <h3 style={{ marginBottom: 8 }}>The {this.props.area} view stopped working</h3>
        <p className="muted" style={{ marginBottom: 6 }}>
          Why: {this.state.error.message}
        </p>
        <p className="muted" style={{ marginBottom: 14 }}>
          Your house is safe; it is autosaved. Retry this view; if it keeps failing, switch to another mode or lower the 3D quality in View.
        </p>
        <button className="btn primary" onClick={() => this.setState({ error: null })}>
          Retry
        </button>
      </div>
    )
  }
}
