import { useState } from 'react'
import { Undo2, Redo2, Box, PenLine, Map as MapIcon, Palette, Sofa, Building, Footprints, Plane, Presentation, Bot, Sun, Moon } from 'lucide-react'
import { useProject, commit } from '../state/store'
import { useUI, type Mode } from '../state/ui'
import { BrandMark, IconButton, Menu, type MenuItem } from '../ui/primitives'
import { saveProject, openProjectDialog } from '../storage/session'
import { setMode } from '../app/actions'
import { copySelection, deleteSelection, duplicateSelection, pasteClipboard } from '../editor/commands'
import { platform } from '../storage/platform'
import { useWizard } from '../screens/wizardState'
import { fitViewEvent } from '../app/shortcuts'

const MODES: { key: Mode; label: string; icon: JSX.Element; kbd?: string }[] = [
  { key: 'plan', label: 'Plan', icon: <MapIcon />, kbd: '1' },
  { key: 'sketch', label: 'Sketch', icon: <PenLine /> },
  { key: '3d', label: '3D', icon: <Box />, kbd: '2' },
  { key: 'materials', label: 'Materials', icon: <Palette /> },
  { key: 'interior', label: 'Interior', icon: <Sofa /> },
  { key: 'exterior', label: 'Exterior', icon: <Building /> },
  { key: 'walk', label: 'Walk', icon: <Footprints />, kbd: '3' },
  { key: 'drone', label: 'Drone', icon: <Plane /> },
  { key: 'present', label: 'Present', icon: <Presentation /> }
]

export function TitleBar() {
  const name = useProject((s) => s.project.name)
  const dirty = useProject((s) => s.dirty)
  const canUndo = useProject((s) => s.past.length > 0)
  const canRedo = useProject((s) => s.future.length > 0)
  const undoLabel = useProject((s) => s.past.at(-1)?.label)
  const redoLabel = useProject((s) => s.future[0]?.label)
  const mode = useUI((s) => s.mode)
  const theme = useUI((s) => s.theme)
  const uiMode = useUI((s) => s.uiMode)
  const quality = useUI((s) => s.quality)
  const assistantOpen = useUI((s) => s.assistantOpen)
  const set = useUI((s) => s.set)
  const openDialog = useUI((s) => s.openDialog)
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const P = useProject.getState

  const menus: Record<string, MenuItem[]> = {
    Project: [
      { label: 'New house…', onClick: () => {
          useWizard.getState().reset()
          set({ screen: 'wizard' })
        } },
      { label: 'Open…', shortcut: 'Ctrl+O', onClick: () => void openProjectDialog() },
      { label: 'Save', shortcut: 'Ctrl+S', onClick: () => void saveProject() },
      { label: 'Save as…', shortcut: 'Ctrl+Shift+S', onClick: () => void saveProject(true) },
      { separator: true },
      { label: 'Import floor plan image…', onClick: () => openDialog('import-plan') },
      { label: 'Generate alternatives…', onClick: () => openDialog('alternatives') },
      { label: 'Concept images…', onClick: () => openDialog('concepts') },
      { label: 'Regenerate from requirements…', onClick: () => openDialog('requirements') },
      { separator: true },
      { label: 'Project settings…', onClick: () => openDialog('settings') },
      { label: 'Close project', onClick: () => set({ screen: 'home' }) }
    ],
    Edit: [
      { label: `Undo${undoLabel ? ` ${undoLabel.toLowerCase()}` : ''}`, shortcut: 'Ctrl+Z', disabled: !canUndo, onClick: () => P().undo() },
      { label: `Redo${redoLabel ? ` ${redoLabel.toLowerCase()}` : ''}`, shortcut: 'Ctrl+Y', disabled: !canRedo, onClick: () => P().redo() },
      { separator: true },
      { label: 'Copy', shortcut: 'Ctrl+C', onClick: copySelection },
      { label: 'Paste', shortcut: 'Ctrl+V', onClick: () => pasteClipboard() },
      { label: 'Duplicate', shortcut: 'Ctrl+D', onClick: duplicateSelection },
      { label: 'Delete', shortcut: 'Del', onClick: deleteSelection },
      { separator: true },
      { label: 'History…', onClick: () => openDialog('history') },
      { label: 'Check design', onClick: () => set({ rightTab: 'validation', inspectorOpen: true }) },
      { label: 'Save a version…', onClick: () => set({ rightTab: 'versions', inspectorOpen: true }) }
    ],
    View: [
      { label: '2D plan', shortcut: '1', onClick: () => setMode('plan') },
      { label: '3D view', shortcut: '2', onClick: () => setMode('3d') },
      { label: 'Walk inside', shortcut: '3', onClick: () => setMode('walk') },
      { label: 'Fit view', shortcut: 'F', onClick: fitViewEvent },
      { separator: true },
      { heading: '3D quality' },
      ...(['low', 'medium', 'high', 'ultra'] as const).map((q) => ({ label: q[0].toUpperCase() + q.slice(1), checked: quality === q, onClick: () => {
          set({ quality: q })
          void platform.settings.set({ quality: q })
        } })),
      { separator: true },
      { label: theme === 'dark' ? 'Light theme' : 'Dark theme', onClick: () => {
          const t = theme === 'dark' ? 'light' : 'dark'
          set({ theme: t })
          void platform.settings.set({ theme: t })
        } },
      { label: uiMode === 'beginner' ? 'Switch to advanced mode' : 'Switch to beginner mode', onClick: () => {
          const m = uiMode === 'beginner' ? 'advanced' : 'beginner'
          set({ uiMode: m })
          void platform.settings.set({ uiMode: m })
        } },
      { label: 'Layers', onClick: () => set({ rightTab: 'layers', inspectorOpen: true }) },
      { label: 'Keyboard shortcuts', shortcut: '?', onClick: () => openDialog('shortcuts') }
    ],
    Export: [
      { label: 'Export everything…', onClick: () => openDialog('export') },
      { separator: true },
      { label: 'Floor plan PDF', onClick: () => openDialog('export', { preset: 'plan-pdf' }) },
      { label: 'Drawings (plan, elevations, sections…)', onClick: () => openDialog('export', { preset: 'drawings' }) },
      { label: '3D model (GLB / GLTF / OBJ)', onClick: () => openDialog('export', { preset: 'model' }) },
      { label: 'Image of the current view', onClick: () => openDialog('export', { preset: 'image' }) },
      { label: 'Walkthrough video', onClick: () => setMode('drone') },
      { label: 'House presentation', onClick: () => setMode('present') },
      { label: 'Project file (.homeforge)', onClick: () => void saveProject(true) }
    ]
  }

  return (
    <header className="titlebar">
      <div className="brand" onClick={() => set({ screen: 'home' })} data-tip="Start screen">
        <BrandMark />
        HomeForge AI
      </div>
      <nav className="menubar">
        {Object.keys(menus).map((k) => (
          <button
            key={k}
            className={menu?.key === k ? 'open' : ''}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setMenu(menu?.key === k ? null : { key: k, x: r.left, y: r.bottom + 4 })
            }}
            onMouseEnter={(e) => {
              if (menu && menu.key !== k) {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setMenu({ key: k, x: r.left, y: r.bottom + 4 })
              }
            }}
          >
            {k}
          </button>
        ))}
      </nav>
      <input
        className="project-name"
        value={name}
        aria-label="Project name"
        onChange={(e) => commit('Rename project', (d) => void (d.name = e.target.value), { coalesce: 'project-name' })}
      />
      <div className="modes" role="tablist" aria-label="Modes">
        {MODES.map((m) => (
          <button key={m.key} role="tab" aria-selected={mode === m.key} className={mode === m.key ? 'on' : ''} onClick={() => setMode(m.key)} data-tip={m.label} data-kbd={m.kbd}>
            {m.icon}
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <div className="drag" />
      <IconButton icon={<Undo2 />} label={canUndo ? `Undo ${undoLabel?.toLowerCase() ?? ''}` : 'Nothing to undo'} shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => P().undo()} />
      <IconButton icon={<Redo2 />} label={canRedo ? `Redo ${redoLabel?.toLowerCase() ?? ''}` : 'Nothing to redo'} shortcut="Ctrl+Y" disabled={!canRedo} onClick={() => P().redo()} />
      <IconButton icon={<Bot />} label="AI assistant" shortcut="Ctrl+K" active={assistantOpen} onClick={() => set({ assistantOpen: !assistantOpen })} />
      <IconButton icon={theme === 'dark' ? <Sun /> : <Moon />} label={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })} />
      <div className={`save-state ${dirty ? 'dirty' : ''}`} data-tip={dirty ? 'Changes are autosaved; press Ctrl+S to save to a file' : 'All changes saved'}>
        <span className="dot" />
        {dirty ? 'Unsaved' : 'Saved'}
      </div>
      {menu && <Menu items={menus[menu.key]} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </header>
  )
}
