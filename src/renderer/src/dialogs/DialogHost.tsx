import { lazy, Suspense, useEffect, useState } from 'react'
import { useUI } from '../state/ui'
import { useProject, commit } from '../state/store'
import { Modal, Seg, Switch } from '../ui/primitives'
import { SHORTCUTS } from '../app/shortcuts'
import { platform, isDesktop } from '../storage/platform'
import type { AppSettings } from '../../../shared/api'
import { LengthField } from '../ui/primitives'
import { configureAutosave } from '../storage/session'
import { useWizard } from '../screens/wizardState'

const ExportDialog = lazy(() => import('./ExportDialog').then((m) => ({ default: m.ExportDialog })))
const ImportPlanDialog = lazy(() => import('./ImportPlan').then((m) => ({ default: m.ImportPlanDialog })))
const AlternativesDialog = lazy(() => import('./Alternatives').then((m) => ({ default: m.AlternativesDialog })))
const ConceptBoard = lazy(() => import('./ConceptBoard').then((m) => ({ default: m.ConceptBoard })))
const PhotorealDialog = lazy(() => import('./PhotorealDialog').then((m) => ({ default: m.PhotorealDialog })))

export function DialogHost() {
  const dialog = useUI((s) => s.dialog)
  const close = useUI((s) => s.closeDialog)
  if (!dialog) return null
  return (
    <Suspense fallback={null}>
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={close} />}
      {dialog === 'settings' && <SettingsDialog onClose={close} />}
      {dialog === 'history' && <HistoryDialog onClose={close} />}
      {dialog === 'requirements' && <RequirementsRedirect onClose={close} />}
      {dialog === 'export' && <ExportDialog onClose={close} />}
      {dialog === 'import-plan' && <ImportPlanDialog onClose={close} />}
      {dialog === 'alternatives' && <AlternativesDialog onClose={close} />}
      {dialog === 'concepts' && <ConceptBoard onClose={close} />}
      {dialog === 'photoreal' && <PhotorealDialog onClose={close} />}
    </Suspense>
  )
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <table className="compare">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys}>
              <td>{s.action}</td>
              <td>
                <span className="kbd">{s.keys}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="faint" style={{ marginTop: 12, fontSize: 12 }}>
        In Walk mode: W A S D or arrows to move, mouse to look, Shift to run, Page Up/Down for eye height.
      </p>
    </Modal>
  )
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useProject((x) => x.project.settings)
  const [app, setApp] = useState<AppSettings | null>(null)
  const [key, setKey] = useState('')
  const set = useUI((x) => x.set)
  useEffect(() => {
    platform.settings.get().then(setApp)
  }, [])
  const upd = (label: string, fn: (d: typeof s) => void) => commit(label, (d) => fn(d.settings))
  return (
    <Modal title="Settings" onClose={onClose} size="wide" footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <div className="section-title">This project</div>
          <div className="prop">
            <label>Units</label>
            <Seg value={s.units} onChange={(v) => upd('Units', (d) => void (d.units = v))} options={[{ value: 'ft-in', label: 'ft-in' }, { value: 'ft', label: 'ft' }, { value: 'm', label: 'm' }, { value: 'cm', label: 'cm' }]} />
          </div>
          <div className="prop">
            <label>Marla size</label>
            <Seg value={String(s.marlaSqft)} onChange={(v) => upd('Marla size', (d) => void (d.marlaSqft = Number(v)))} options={[{ value: '225', label: '225 ft²' }, { value: '272.25', label: '272.25 ft²' }]} />
          </div>
          <div className="prop">
            <label>Exterior walls</label>
            <LengthField value={s.wallThickness.exterior} units={s.units} min={0.1} max={0.6} onCommit={(v) => upd('Default exterior wall', (d) => void (d.wallThickness.exterior = v))} />
          </div>
          <div className="prop">
            <label>Interior walls</label>
            <LengthField value={s.wallThickness.interior} units={s.units} min={0.05} max={0.4} onCommit={(v) => upd('Default interior wall', (d) => void (d.wallThickness.interior = v))} />
          </div>
          <div className="prop">
            <label>Floor height</label>
            <LengthField value={s.floorHeight} units={s.units} min={2.4} max={6} onCommit={(v) => upd('Default floor height', (d) => void (d.floorHeight = v))} />
          </div>
          <div className="prop">
            <label>Plinth height</label>
            <LengthField value={s.plinthHeight} units={s.units} min={0} max={1.5} onCommit={(v) => upd('Plinth height', (d) => void (d.plinthHeight = v))} />
          </div>
          <div className="prop">
            <label>Auto versions</label>
            <Switch on={s.autoVersion} onChange={(v) => upd('Auto versions', (d) => void (d.autoVersion = v))} />
          </div>
        </div>
        <div>
          <div className="section-title">Application</div>
          {app && (
            <>
              <div className="prop">
                <label>Theme</label>
                <Seg value={app.theme} onChange={async (v) => {
                    setApp(await platform.settings.set({ theme: v }))
                    set({ theme: v === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : v })
                  }} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} />
              </div>
              <div className="prop">
                <label>Interface</label>
                <Seg value={app.uiMode} onChange={async (v) => {
                    setApp(await platform.settings.set({ uiMode: v }))
                    set({ uiMode: v })
                  }} options={[{ value: 'beginner', label: 'Beginner' }, { value: 'advanced', label: 'Advanced' }]} />
              </div>
              <div className="prop">
                <label>Autosave every</label>
                <Seg value={String(app.autosaveSeconds)} onChange={async (v) => {
                    setApp(await platform.settings.set({ autosaveSeconds: Number(v) }))
                    configureAutosave(Number(v))
                  }} options={['10', '20', '60', '120'].map((x) => ({ value: x, label: `${x}s` }))} />
              </div>
              {isDesktop && (
                <div className="prop">
                  <label>Graphics</label>
                  <div className="col" style={{ gap: 4, alignItems: 'stretch' }}>
                    <Seg value={app.graphicsBackend ?? 'auto'} onChange={async (v) => setApp(await platform.settings.set({ graphicsBackend: v }))} options={[{ value: 'auto', label: 'Automatic', tip: 'Direct3D on Windows' }, { value: 'opengl', label: 'OpenGL', tip: 'Needed for photoreal renders on Windows' }, { value: 'vulkan', label: 'Vulkan' }]} />
                    <button className="link-btn" style={{ alignSelf: 'flex-start', marginTop: 0 }} onClick={() => void platform.relaunch()}>
                      Restart to apply
                    </button>
                  </div>
                </div>
              )}
              <div className="section-title" style={{ marginTop: 18 }}>
                AI assistant
              </div>
              <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                The built-in assistant works offline. Optionally connect Claude for richer understanding of free-form requests. Your key is encrypted on this computer and only sent to Anthropic.
              </p>
              <div className="prop">
                <label>Assistant</label>
                <Seg value={app.aiProvider} onChange={async (v) => setApp(await platform.settings.set({ aiProvider: v }))} options={[{ value: 'offline', label: 'Offline' }, { value: 'claude', label: 'Claude' }]} />
              </div>
              {isDesktop ? (
                <div className="prop">
                  <label>Claude API key</label>
                  <div className="row">
                    <input className="field" type="password" placeholder={app.hasApiKey ? 'A key is saved' : 'sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} />
                    <button className="btn" disabled={!key} onClick={async () => {
                        setApp(await platform.settings.setApiKey(key))
                        setKey('')
                        useUI.getState().toast({ kind: 'success', title: 'Claude key saved' })
                      }}>
                      Save
                    </button>
                    {app.hasApiKey && (
                      <button className="btn ghost" onClick={async () => setApp(await platform.settings.setApiKey(null))}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="faint" style={{ fontSize: 12 }}>
                  Claude can be connected in the desktop app.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function HistoryDialog({ onClose }: { onClose: () => void }) {
  const past = useProject((s) => s.past)
  const future = useProject((s) => s.future)
  const P = useProject.getState
  return (
    <Modal title="History" subtitle="Click a step to undo back to it. Every edit is undoable." onClose={onClose}>
      <div className="list">
        {future
          .slice()
          .reverse()
          .map((e, i) => (
            <div key={`f${i}`} className="list-item faint" onClick={() => {
                for (let k = 0; k < future.length - i; k++) P().redo()
              }}>
              {e.label}
              <span className="meta">undone</span>
            </div>
          ))}
        {past
          .slice()
          .reverse()
          .map((e, i) => (
            <div key={`p${i}`} className={`list-item ${i === 0 ? 'on' : ''}`} onClick={() => {
                for (let k = 0; k < i; k++) P().undo()
              }}>
              {e.label}
              <span className="meta">{new Date(e.time).toLocaleTimeString()}</span>
            </div>
          ))}
        {!past.length && !future.length && <div className="empty">No edits yet.</div>}
      </div>
    </Modal>
  )
}

/** Edit the requirements of the current project in the wizard, then regenerate. */
function RequirementsRedirect({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const p = useProject.getState().project
    const w = useWizard.getState()
    w.reset()
    useWizard.setState({ req: structuredClone(p.requirements), plot: structuredClone(p.plot), plotMode: p.plot.shape === 'irregular' ? 'irregular' : p.plot.presetId ? 'preset' : 'custom', step: 2, targetExisting: true })
    onClose()
    useUI.getState().set({ screen: 'wizard' })
  }, [onClose])
  return null
}
