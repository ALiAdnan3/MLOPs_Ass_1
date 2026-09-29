import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { X, Send, Undo2, RefreshCw } from 'lucide-react'
import { useUI } from '../state/ui'
import { getProject, undo } from '../state/store'
import { planEdit, applyEditPlan, type EditResult } from './nlEditor'
import { regenerateWithRequirements } from '../app/actions'
import { formatAreaFor } from '../core/units/units'
import { platform } from '../storage/platform'
import type { Requirements } from '../core/model/types'
import { BrandMark } from '../ui/primitives'

/** AI DESIGN ASSISTANT (§44): understands the house, edits it, and explains what changed. */

interface Msg {
  id: number
  role: 'user' | 'ai'
  text: string
  result?: EditResult
  undoable?: boolean
  source?: 'offline' | 'claude'
}

interface AssistantStore {
  msgs: Msg[]
  busy: boolean
  push: (m: Omit<Msg, 'id'>) => void
  patch: (id: number, p: Partial<Msg>) => void
  set: (p: Partial<AssistantStore>) => void
}

let nextId = 1
export const useAssistant = create<AssistantStore>((set, get) => ({
  msgs: [{ id: nextId++, role: 'ai', text: 'What would you like to change? Describe it in your own words, for example "make the master bedroom 2 feet wider" or "add a swimming pool".' }],
  busy: false,
  push: (m) => set({ msgs: [...get().msgs, { ...m, id: nextId++ }] }),
  patch: (id, p) => set({ msgs: get().msgs.map((m) => (m.id === id ? { ...m, ...p } : m)) }),
  set: (p) => set(p)
}))

const CHIPS = ['Make bedroom larger', 'Add basement', 'Improve layout', 'Add parking', 'Add a swimming pool', 'Change the exterior to stone', 'Increase the ceiling height', 'What does it cost?']

export async function sendToAssistant(text: string) {
  const st = useAssistant.getState()
  const t = text.trim()
  if (!t || st.busy) return
  st.push({ role: 'user', text: t })
  if (/^(undo|undo that|revert|go back)\.?$/i.test(t)) {
    undo()
    st.push({ role: 'ai', text: 'Undone. The house is back to how it was before the last change.' })
    return
  }
  st.set({ busy: true })
  try {
    const plan = await planEdit(t)
    if (!plan.operations.length) {
      st.push({ role: 'ai', text: plan.reply, source: plan.source })
      return
    }
    const r = await applyEditPlan(plan, `Assistant: ${t.length > 48 ? t.slice(0, 46) + '…' : t}`)
    const changed = r.changes.length > 0 || r.areaChanges.length > 0 || r.moved.length > 0
    st.push({ role: 'ai', text: r.message || plan.reply, result: r, undoable: changed, source: plan.source })
  } catch (e) {
    st.push({ role: 'ai', text: `Something went wrong while making that change: ${(e as Error).message}. Nothing was changed.` })
  } finally {
    st.set({ busy: false })
  }
}

export function Assistant() {
  const msgs = useAssistant((s) => s.msgs)
  const busy = useAssistant((s) => s.busy)
  const [text, setText] = useState('')
  const [claude, setClaude] = useState(false)
  const log = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [msgs.length, busy])
  useEffect(() => {
    input.current?.focus()
    platform.settings
      .get()
      .then((s) => setClaude(s.aiProvider === 'claude' && s.hasApiKey))
      .catch(() => setClaude(false))
  }, [])
  const send = (t = text) => {
    setText('')
    void sendToAssistant(t)
  }
  const u = getProject().settings.units
  return (
    <section className="assistant" aria-label="AI assistant" onKeyDown={(e) => e.key === 'Escape' && useUI.getState().set({ assistantOpen: false })}>
      <div className="assistant-head">
        <BrandMark size={16} />
        <h3 className="grow">Assistant</h3>
        <span className="badge" data-tip={claude ? 'Using Claude with the built-in rules as backup' : 'Built-in rules, works offline. Add a Claude key in Settings for free-form requests.'}>
          {claude ? 'Claude' : 'Offline'}
        </span>
        <button className="icon-btn" aria-label="Close assistant" data-tip="Close" onClick={() => useUI.getState().set({ assistantOpen: false })}>
          <X />
        </button>
      </div>
      <div className="assistant-log" ref={log} aria-live="polite">
        {msgs.map((m, i) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.text}
            {m.result && (m.result.areaChanges.length > 0 || m.result.moved.length > 0) && (
              <div className="changes">
                {m.result.areaChanges.slice(0, 6).map((a) => (
                  <div key={a.name} className="tabular">
                    {a.name}: {formatAreaFor(a.before, u)} → {formatAreaFor(a.after, u)}
                  </div>
                ))}
                {m.result.moved.length > 0 && <div>Moved: {m.result.moved.join(', ')}</div>}
              </div>
            )}
            {(m.result?.regenerate || (m.undoable && i === msgs.length - 1)) && (
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                {m.result?.regenerate && <RegenerateButton req={m.result.regenerate} />}
                {m.undoable && i === msgs.length - 1 && (
                  <button className="btn sm" onClick={() => {
                      undo()
                      useAssistant.getState().patch(m.id, { undoable: false })
                      useAssistant.getState().push({ role: 'ai', text: 'Undone.' })
                    }}>
                    <Undo2 size={13} /> Undo
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="msg ai row" style={{ gap: 8 }}>
            <span className="spinner" style={{ width: 14, height: 14 }} /> Working on it…
          </div>
        )}
      </div>
      <div className="assistant-input">
        <div className="suggestions">
          {CHIPS.map((c) => (
            <button key={c} className="chip" disabled={busy} onClick={() => send(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
          <textarea
            ref={input}
            className="field"
            rows={2}
            style={{ resize: 'none', flex: 1, height: 'auto', padding: '6px 8px' }}
            placeholder="Describe a change…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            aria-label="Message the assistant"
          />
          <button className="btn primary" aria-label="Send" disabled={busy || !text.trim()} onClick={() => send()}>
            <Send size={14} />
          </button>
        </div>
      </div>
    </section>
  )
}

function RegenerateButton({ req }: { req: Requirements }) {
  const [done, setDone] = useState(false)
  return (
    <button className="btn primary sm" disabled={done} onClick={async () => {
        setDone(true)
        await regenerateWithRequirements(req, 'Assistant: regenerate plan')
        useAssistant.getState().push({ role: 'ai', text: 'New layout generated with your changes. The previous plan is in the version history, and Ctrl+Z also brings it back.' })
      }}>
      <RefreshCw size={13} /> Regenerate
    </button>
  )
}
