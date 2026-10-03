import { useEffect, useMemo, useState } from 'react'
import { Plus, Send, ChevronDown, Maximize2 } from 'lucide-react'
import { useUI } from '../state/ui'
import { useProject, commit, getProject } from '../state/store'
import { LIBRARY } from '../core/materials/library'
import { useMaterialThumb, thumbStyle } from '../render/materialThumb'
import type { MaterialCategory, MaterialDef } from '../core/model/types'
import { applySurfaceMaterial, describeSurface, surfaceForSelection } from '../planner/surfaces'
import { FloorStack } from './FloorStack'
import { platform } from '../storage/platform'
import type { RecentProject } from '../../../shared/api'
import { openRecent } from '../storage/session'
import { useWizard } from '../screens/wizardState'
import { useAssistant, sendToAssistant } from '../ai/Assistant'

/**
 * Bottom dock (plan and 3D): floor selector, material strip (one click applies to the selected
 * room or surface, undoable), recent projects, and an inline assistant.
 */

export function Dock() {
  const open = useUI((s) => s.dockOpen)
  const set = useUI((s) => s.set)
  if (!open)
    return (
      <button className="dock-tab" onClick={() => set({ dockOpen: true })} aria-label="Show the dock">
        <ChevronDown style={{ transform: 'rotate(180deg)' }} /> Floors, materials, projects, assistant
      </button>
    )
  return (
    <div className="dock" role="region" aria-label="Dock">
      <DockCard title="Floor selector" className="dock-floors">
        <FloorStack />
      </DockCard>
      <MaterialStrip />
      <RecentProjects />
      <MiniAssistant />
      <button className="icon-btn dock-hide" aria-label="Hide the dock" data-tip="Hide the dock" onClick={() => set({ dockOpen: false })}>
        <ChevronDown />
      </button>
    </div>
  )
}

function DockCard(props: { title: string; className?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`dock-card ${props.className ?? ''}`}>
      <header>
        <h4>{props.title}</h4>
        {props.actions}
      </header>
      <div className="dock-body">{props.children}</div>
    </section>
  )
}

const TABS: { key: string; label: string; cats: MaterialCategory[] }[] = [
  { key: 'marble', label: 'Marble', cats: ['marble'] },
  { key: 'granite', label: 'Granite', cats: ['granite'] },
  { key: 'wood', label: 'Wood', cats: ['wood'] },
  { key: 'tiles', label: 'Tiles', cats: ['ceramic', 'porcelain'] },
  { key: 'stone', label: 'Stone', cats: ['stone', 'brick', 'concrete'] },
  { key: 'paint', label: 'Paint', cats: ['paint', 'wallpaper'] },
  { key: 'mine', label: 'Mine', cats: [] }
]

function MaterialStrip() {
  const [tab, setTab] = useState('marble')
  const mine = useProject((s) => s.project.materials)
  const sel = useUI((s) => s.selection)
  const surfaceUI = useUI((s) => s.surface)
  const project = useProject((s) => s.project)
  const surface = surfaceUI ?? (sel[0] ? surfaceForSelection(project, sel[0]) : null)
  const info = surface ? describeSurface(project, surface) : null
  const list = useMemo(() => (tab === 'mine' ? mine : LIBRARY.filter((m) => TABS.find((t) => t.key === tab)!.cats.includes(m.category))), [tab, mine])
  const apply = (m: MaterialDef) => {
    if (!surface || !info) {
      useUI.getState().toast({ kind: 'info', title: 'Select a room or surface first', body: 'Click a room in the plan or a surface in 3D, then pick a material here.' })
      return
    }
    commit(`${m.name} on ${info.label}`, (d) => applySurfaceMaterial(d, surface, m.id, 'surface'))
    useUI.getState().toast({ kind: 'success', title: `${m.name} applied`, body: `${info.label}. Ctrl+Z to undo.` })
  }
  return (
    <DockCard
      title="Material library"
      className="dock-materials"
      actions={
        <span className="dock-target">
          {info ? (
            <>
              Applies to <b>{info.label}</b>
            </>
          ) : (
            'Select a room to apply'
          )}
        </span>
      }
    >
      <div className="dock-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
        <button className="more" onClick={() => useUI.getState().set({ mode: 'materials' })}>
          All materials
        </button>
      </div>
      <div className="dock-swatches">
        {list.length ? list.slice(0, 24).map((m) => <Swatch key={m.id} m={m} current={info?.current === m.id} onClick={() => apply(m)} />) : <div className="faint" style={{ padding: 8, fontSize: 12 }}>Upload a photo in Materials to add your own.</div>}
      </div>
    </DockCard>
  )
}

function Swatch({ m, current, onClick }: { m: MaterialDef; current: boolean; onClick: () => void }) {
  const url = useMaterialThumb(m)
  return (
    <button className={`dock-swatch ${current ? 'on' : ''}`} onClick={onClick} data-tip={`Apply ${m.name}`}>
      <span className="img" style={thumbStyle(m, url)} />
      <span className="n">{m.name}</span>
    </button>
  )
}

function RecentProjects() {
  const [recent, setRecent] = useState<RecentProject[]>([])
  const name = useProject((s) => s.project.name)
  const filePath = useProject((s) => s.filePath)
  useEffect(() => {
    platform.recent.list().then(setRecent).catch(() => setRecent([]))
  }, [filePath])
  return (
    <DockCard title="Recent projects" className="dock-recent">
      <div className="dock-projects">
        <div className="dock-project on" data-tip="Open now">
          <span className="img current">{name.slice(0, 1)}</span>
          <span className="n">{name}</span>
          <span className="s">Open now</span>
        </div>
        {recent
          .filter((r) => r.path !== filePath)
          .slice(0, 4)
          .map((r) => (
            <button key={r.path} className="dock-project" onClick={() => void openRecent(r.path)} data-tip={r.path}>
              <span className="img" style={r.thumbnail ? { backgroundImage: `url("${r.thumbnail}")` } : undefined}>
                {!r.thumbnail && r.name.slice(0, 1)}
              </span>
              <span className="n">{r.name}</span>
              <span className="s">{r.plot ?? new Date(r.openedAt).toLocaleDateString()}</span>
            </button>
          ))}
        <button className="dock-project new" onClick={() => {
            useWizard.getState().reset()
            useUI.getState().set({ screen: 'wizard' })
          }}>
          <span className="img">
            <Plus />
          </span>
          <span className="n">New project</span>
        </button>
      </div>
    </DockCard>
  )
}

const CHIPS = ['Make this room larger', 'Add a pool', 'Change to modern style', 'Add a basement']

function MiniAssistant() {
  const msgs = useAssistant((s) => s.msgs)
  const busy = useAssistant((s) => s.busy)
  const [text, setText] = useState('')
  const last = [...msgs].reverse().find((m) => m.role === 'ai')
  const sel = useUI((s) => s.selection)
  const send = (t: string) => {
    let q = t
    // "this room" means the selected room
    if (/this room/i.test(t) && sel[0]?.kind === 'room') {
      const r = getProject().floors.flatMap((f) => f.rooms).find((x) => x.id === sel[0].id)
      if (r) q = t.replace(/this room/i, `the ${r.name}`)
    }
    setText('')
    void sendToAssistant(q)
  }
  return (
    <DockCard
      title="AI assistant"
      className="dock-assistant"
      actions={
        <button className="icon-btn" aria-label="Open the full assistant" data-tip="Open the full assistant (Ctrl+K)" onClick={() => useUI.getState().set({ assistantOpen: true })}>
          <Maximize2 />
        </button>
      }
    >
      <div className="dock-ai-reply" aria-live="polite">
        {busy ? 'Working on it…' : msgs.length > 1 ? last?.text.split('\n')[0] : 'What would you like to do?'}
      </div>
      <div className="dock-chips">
        {CHIPS.map((c) => (
          <button key={c} className="chip" disabled={busy} onClick={() => send(c)}>
            {c}
          </button>
        ))}
      </div>
      <form
        className="dock-ask"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) send(text.trim())
        }}
      >
        <input className="field" placeholder="Type your request…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Ask the assistant" />
        <button className="btn primary" aria-label="Send" disabled={busy || !text.trim()}>
          <Send size={14} />
        </button>
      </form>
    </DockCard>
  )
}
