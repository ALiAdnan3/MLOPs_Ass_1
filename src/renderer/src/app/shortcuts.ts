import { useEffect } from 'react'
import { useProject } from '../state/store'
import { useUI, type Tool } from '../state/ui'
import { saveProject, openProjectDialog } from '../storage/session'
import { copySelection, deleteSelection, duplicateSelection, pasteClipboard, rotateSelection } from '../editor/commands'
import { setMode } from './actions'

/** Keyboard shortcuts (§64). Ignored while typing in fields or walking with the mouse captured. */

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Ctrl + Z', action: 'Undo' },
  { keys: 'Ctrl + Y', action: 'Redo' },
  { keys: 'Ctrl + S', action: 'Save' },
  { keys: 'Ctrl + Shift + S', action: 'Save as' },
  { keys: 'Ctrl + O', action: 'Open project' },
  { keys: 'Delete', action: 'Delete selection' },
  { keys: 'Ctrl + C / Ctrl + V', action: 'Copy / paste' },
  { keys: 'Ctrl + D', action: 'Duplicate' },
  { keys: 'R', action: 'Rotate selection' },
  { keys: 'M', action: 'Move (select tool)' },
  { keys: 'W', action: 'Wall tool' },
  { keys: 'D', action: 'Dimension tool' },
  { keys: 'F', action: 'Fit view' },
  { keys: '1', action: '2D plan' },
  { keys: '2', action: '3D view' },
  { keys: '3', action: 'Walk inside' },
  { keys: 'Ctrl + K', action: 'AI assistant' },
  { keys: 'Esc', action: 'Cancel / clear selection' },
  { keys: '?', action: 'Show shortcuts' }
]

export const fitViewEvent = () => window.dispatchEvent(new CustomEvent('hf:fit'))

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState()
      const target = e.target as HTMLElement
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      if (document.pointerLockElement) return
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (ctrl && k === 's') {
        e.preventDefault()
        if (ui.screen === 'workspace') void saveProject(e.shiftKey)
        return
      }
      if (ctrl && k === 'o') {
        e.preventDefault()
        void openProjectDialog()
        return
      }
      if (typing) return
      if (ui.screen !== 'workspace') return
      const P = useProject.getState()
      if (ctrl && k === 'z' && !e.shiftKey) {
        e.preventDefault()
        P.undo()
        return
      }
      if ((ctrl && k === 'y') || (ctrl && e.shiftKey && k === 'z')) {
        e.preventDefault()
        P.redo()
        return
      }
      if (ctrl && k === 'c') return copySelection()
      if (ctrl && k === 'v') return pasteClipboard()
      if (ctrl && k === 'd') {
        e.preventDefault()
        return duplicateSelection()
      }
      if (ctrl && k === 'k') {
        e.preventDefault()
        ui.set({ assistantOpen: !ui.assistantOpen })
        return
      }
      if (ctrl) return
      const walkLike = ui.mode === 'walk' || ui.mode === 'drone'
      switch (k) {
        case 'delete':
        case 'backspace':
          if (ui.selection.length) {
            e.preventDefault()
            deleteSelection()
          }
          break
        case 'escape':
          if (ui.dialog) return
          if (ui.tool !== 'select') ui.set({ tool: 'select', toolOption: null })
          else ui.select([])
          window.dispatchEvent(new CustomEvent('hf:cancel'))
          break
        case 'r':
          if (!walkLike) rotateSelection()
          break
        case 'm':
          if (!walkLike) ui.set({ tool: 'select' })
          break
        case 'w':
          if (ui.mode === 'plan') setTool('wall')
          break
        case 'd':
          if (ui.mode === 'plan') setTool('dimension')
          break
        case 'f':
          if (!walkLike) fitViewEvent()
          break
        case '1':
          setMode('plan')
          break
        case '2':
          setMode('3d')
          break
        case '3':
          setMode('walk')
          break
        case '?':
          ui.openDialog('shortcuts')
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function setTool(tool: Tool) {
  useUI.getState().set({ tool, toolOption: null })
}
