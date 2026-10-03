import { create } from 'zustand'
import type { EntityRef, Quality, SurfaceRef, Vec2 } from '../core/model/types'

export type Screen = 'home' | 'wizard' | 'designs' | 'workspace'
export type Mode = 'plan' | 'sketch' | '3d' | 'materials' | 'interior' | 'exterior' | 'walk' | 'drone' | 'present'
export type Tool =
  | 'select'
  | 'wall'
  | 'room'
  | 'door'
  | 'window'
  | 'column'
  | 'stair'
  | 'dimension'
  | 'text'
  | 'furniture'
  | 'garden'
  | 'pool'
  | 'garage'
  | 'patio'
  | 'measure'
  | 'split'
  | 'pan'
export type RightTab = 'properties' | 'layers' | 'validation' | 'versions' | 'estimate' | 'areas'
export type ViewMode3D = 'realistic' | 'architectural' | 'dollhouse' | 'floor' | 'exploded'
export type CameraPreset = 'orbit' | 'top' | 'front' | 'back' | 'left' | 'right' | 'street' | 'facade' | 'interior' | 'room' | 'drone' | 'first-person'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'warning' | 'error'
  title: string
  body?: string
  action?: { label: string; run: () => void }
}

export interface ErrorReport {
  what: string
  why: string
  fix: string
  retry?: () => void
}

export interface UIState {
  screen: Screen
  mode: Mode
  floorId: string | 'all'
  tool: Tool
  toolOption: string | null
  selection: EntityRef[]
  hover: EntityRef | null
  surface: SurfaceRef | null
  theme: 'dark' | 'light'
  uiMode: 'beginner' | 'advanced'
  quality: Quality
  rightTab: RightTab
  inspectorOpen: boolean
  assistantOpen: boolean
  viewMode: ViewMode3D
  camera: CameraPreset
  showAllFloors: boolean
  /** Plan mode shows the 2D plan and the live 3D model side by side. */
  split: boolean
  /** Bottom dock (floors, materials, recent projects, assistant) in plan and 3D modes. */
  dockOpen: boolean
  /** 2D plan look: textured presentation plan or clean drafting lines. */
  planStyle: 'rendered' | 'technical'
  explodeGap: number
  cursor: Vec2 | null
  toasts: Toast[]
  error: ErrorReport | null
  dialog: string | null
  dialogProps: Record<string, unknown>
  busy: string | null
  clipboard: unknown
  set: (patch: Partial<UIState>) => void
  select: (refs: EntityRef[]) => void
  toast: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
  openDialog: (name: string, props?: Record<string, unknown>) => void
  closeDialog: () => void
  showError: (e: ErrorReport) => void
}

let toastId = 1

export const useUI = create<UIState>((set, get) => ({
  screen: 'home',
  mode: 'plan',
  floorId: '',
  tool: 'select',
  toolOption: null,
  selection: [],
  hover: null,
  surface: null,
  theme: 'dark',
  uiMode: 'beginner',
  quality: 'high',
  rightTab: 'properties',
  inspectorOpen: true,
  assistantOpen: false,
  viewMode: 'realistic',
  camera: 'orbit',
  showAllFloors: true,
  split: true,
  dockOpen: true,
  planStyle: 'rendered',
  explodeGap: 0,
  cursor: null,
  toasts: [],
  error: null,
  dialog: null,
  dialogProps: {},
  busy: null,
  clipboard: null,
  set: (patch) => set(patch),
  select: (refs) => set({ selection: refs }),
  toast: (t) => {
    const id = toastId++
    set({ toasts: [...get().toasts, { ...t, id }] })
    setTimeout(() => get().dismiss(id), t.kind === 'error' ? 9000 : 4200)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
  openDialog: (name, props = {}) => set({ dialog: name, dialogProps: props }),
  closeDialog: () => set({ dialog: null, dialogProps: {} }),
  showError: (e) => set({ error: e })
}))

export const ui = () => useUI.getState()
