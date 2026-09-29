import { create } from 'zustand'
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch, setAutoFreeze } from 'immer'
import type { Project } from '../core/model/types'
import { newProject } from '../core/model/defaults'

enablePatches()
setAutoFreeze(true)

/**
 * Project store with a strong undo/redo system (§39): every change is an Immer transaction whose
 * patches are recorded, so undo/redo works for room resizing, walls, materials, furniture,
 * structure and 3D edits alike. Drags use begin/update/end so one gesture = one history entry.
 */

export interface HistoryEntry {
  label: string
  patches: Patch[]
  inverse: Patch[]
  time: number
  /** Major changes can create a version (§38). */
  major?: boolean
}

interface Tx {
  label: string
  base: Project
  patches: Patch[]
  inverse: Patch[]
}

export interface ProjectStore {
  project: Project
  filePath: string | null
  dirty: boolean
  revision: number
  savedRevision: number
  past: HistoryEntry[]
  future: HistoryEntry[]
  tx: Tx | null
  commit: (label: string, recipe: (draft: Draft<Project>) => void, opts?: { major?: boolean; coalesce?: string }) => boolean
  begin: (label: string) => void
  update: (recipe: (draft: Draft<Project>) => void) => void
  end: () => void
  cancel: () => void
  undo: () => void
  redo: () => void
  load: (p: Project, filePath?: string | null) => void
  markSaved: (filePath?: string | null) => void
}

const MAX_HISTORY = 300
let lastCoalesce: { key: string; time: number } | null = null

export const useProject = create<ProjectStore>((set, get) => ({
  project: newProject(),
  filePath: null,
  dirty: false,
  revision: 0,
  savedRevision: 0,
  past: [],
  future: [],
  tx: null,

  commit(label, recipe, opts) {
    const s = get()
    if (s.tx) s.end()
    let next: Project
    let patches: Patch[]
    let inverse: Patch[]
    try {
      ;[next, patches, inverse] = produceWithPatches(get().project, (d) => {
        recipe(d)
        d.updatedAt = Date.now()
      })
    } catch (e) {
      console.error(`[commit:${label}]`, e)
      throw e
    }
    if (patches.length <= 1 && patches.every((p) => p.path[0] === 'updatedAt')) return false
    const now = Date.now()
    const past = get().past.slice()
    // coalesce rapid repeated edits of the same field (typing in a number box)
    if (opts?.coalesce && lastCoalesce && lastCoalesce.key === opts.coalesce && now - lastCoalesce.time < 1200 && past.length) {
      const prev = past[past.length - 1]
      past[past.length - 1] = { ...prev, patches: [...prev.patches, ...patches], inverse: [...inverse, ...prev.inverse], time: now }
    } else past.push({ label, patches, inverse, time: now, major: opts?.major })
    lastCoalesce = opts?.coalesce ? { key: opts.coalesce, time: now } : null
    if (past.length > MAX_HISTORY) past.splice(0, past.length - MAX_HISTORY)
    set({ project: next, past, future: [], dirty: true, revision: s.revision + 1 })
    return true
  },

  begin(label) {
    const s = get()
    if (s.tx) s.end()
    set({ tx: { label, base: s.project, patches: [], inverse: [] } })
  },

  update(recipe) {
    const tx = get().tx
    if (!tx) return
    const [next, patches, inverse] = produceWithPatches(tx.base, (d) => {
      recipe(d)
      d.updatedAt = Date.now()
    })
    set({ project: next, tx: { ...tx, patches, inverse }, revision: get().revision + 1 })
  },

  end() {
    const tx = get().tx
    if (!tx) return
    if (!tx.patches.length) {
      set({ tx: null })
      return
    }
    const past = [...get().past, { label: tx.label, patches: tx.patches, inverse: tx.inverse, time: Date.now() }]
    if (past.length > MAX_HISTORY) past.splice(0, past.length - MAX_HISTORY)
    set({ tx: null, past, future: [], dirty: true })
  },

  cancel() {
    const tx = get().tx
    if (!tx) return
    set({ project: tx.base, tx: null, revision: get().revision + 1 })
  },

  undo() {
    const s = get()
    if (s.tx) s.cancel()
    const past = s.past.slice()
    const e = past.pop()
    if (!e) return
    const project = applyPatches(s.project, e.inverse)
    set({ project, past, future: [e, ...s.future], dirty: true, revision: s.revision + 1 })
  },

  redo() {
    const s = get()
    const [e, ...rest] = s.future
    if (!e) return
    const project = applyPatches(s.project, e.patches)
    set({ project, past: [...s.past, e], future: rest, dirty: true, revision: s.revision + 1 })
  },

  load(p, filePath = null) {
    set({ project: p, filePath, past: [], future: [], dirty: false, tx: null, revision: get().revision + 1, savedRevision: get().revision + 1 })
  },

  markSaved(filePath) {
    set({ dirty: false, savedRevision: get().revision, ...(filePath !== undefined ? { filePath } : {}) })
  }
}))

export const getProject = () => useProject.getState().project
export const commit = (label: string, recipe: (draft: Draft<Project>) => void, opts?: { major?: boolean; coalesce?: string }) => useProject.getState().commit(label, recipe, opts)
export const undo = () => useProject.getState().undo()
export const redo = () => useProject.getState().redo()
