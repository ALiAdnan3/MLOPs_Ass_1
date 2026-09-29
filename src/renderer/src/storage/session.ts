import { useProject } from '../state/store'
import { useUI } from '../state/ui'
import { useAssets } from '../state/assets'
import { platform } from './platform'
import { deserializeProject, ProjectFileError, serializeProject } from './projectFile'
import type { Project } from '../core/model/types'
import { formatPlotSize } from '../core/units/units'
import { sortedFloors } from '../core/model/house'
import { snapshotThumbnail } from '../render/thumbnail'

/**
 * Project session: open, save, save-as, continuous autosave (§37), autosave before expensive
 * operations (§51) and crash recovery.
 */

let timer: ReturnType<typeof setTimeout> | null = null
let lastAutosaveRevision = -1
let autosaveSeconds = 20

export function configureAutosave(seconds: number) {
  autosaveSeconds = Math.max(5, seconds)
}

export function startAutosave() {
  useProject.subscribe((s, prev) => {
    if (s.revision === prev.revision || s.tx) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void autosaveNow(), autosaveSeconds * 1000)
  })
  platform.onBeforeClose(async () => {
    if (useProject.getState().dirty) await autosaveNow()
  })
}

export async function autosaveNow(reason?: string) {
  const s = useProject.getState()
  if (s.revision === lastAutosaveRevision) return
  try {
    const data = await serializeProject(s.project, { compress: false })
    await platform.autosave.write(s.project.id, s.project.name, data)
    lastAutosaveRevision = s.revision
    // projects that already have a file keep that file up to date as well
    if (s.filePath && platform.platform !== 'web' && !reason) {
      const full = await serializeProject(s.project, { thumbnail: await snapshotThumbnail() })
      await platform.writeFile(s.filePath, full)
      useProject.getState().markSaved()
    }
  } catch (e) {
    platform.log('warn', `autosave failed: ${String(e)}`)
  }
}

export function openProjectObject(p: Project, filePath: string | null = null) {
  useProject.getState().load(p, filePath)
  const floors = sortedFloors(p.floors)
  const ground = floors.find((f) => f.level === 0) ?? floors[0]
  useUI.getState().set({ screen: 'workspace', floorId: ground?.id ?? '', selection: [], mode: 'plan', tool: 'select' })
}

export async function openProjectData(data: ArrayBuffer, filePath: string | null) {
  const ui = useUI.getState()
  try {
    ui.set({ busy: 'Opening project…' })
    const loaded = await deserializeProject(data)
    useAssets.getState().replaceAll(loaded.assets)
    openProjectObject(loaded.project, filePath)
    if (filePath && platform.platform !== 'web') {
      await platform.recent.add({ path: filePath, name: loaded.project.name, openedAt: Date.now(), thumbnail: loaded.thumbnail, plot: formatPlotSize(loaded.project.plot.width, loaded.project.plot.depth, loaded.project.settings.units) })
    }
    ui.toast({ kind: 'success', title: `Opened ${loaded.project.name}` })
  } catch (e) {
    if (e instanceof ProjectFileError) ui.showError({ what: e.what, why: e.why, fix: e.fix })
    else ui.showError({ what: 'The project could not be opened', why: String((e as Error)?.message ?? e), fix: 'Check the file, or restore an autosave from the start screen.' })
  } finally {
    ui.set({ busy: null })
  }
}

export async function openProjectDialog() {
  const r = await platform.openProjectDialog()
  if (r) await openProjectData(r.data, r.path)
}

export async function openRecent(path: string) {
  try {
    const r = await platform.readFile(path)
    await openProjectData(r.data, r.path)
  } catch (e) {
    useUI.getState().showError({ what: 'That project is no longer available', why: String((e as Error)?.message ?? e), fix: 'It may have been moved or deleted. Use Open project to find it.' })
    await platform.recent.remove(path)
  }
}

export async function saveProject(saveAs = false): Promise<boolean> {
  const s = useProject.getState()
  const ui = useUI.getState()
  try {
    const thumb = await snapshotThumbnail()
    const data = await serializeProject(s.project, { thumbnail: thumb })
    let path = s.filePath
    if (!path || saveAs || platform.platform === 'web') {
      const name = `${s.project.name.replace(/[^\w\- ]+/g, '').trim() || 'house'}.homeforge`
      path = await platform.saveDialog(name, [{ name: 'HomeForge project', extensions: ['homeforge'] }], data)
      if (!path) return false
    } else await platform.writeFile(path, data)
    useProject.getState().markSaved(path)
    const thumbUrl = thumb ? await blobToDataUrl(thumb) : undefined
    await platform.recent.add({ path, name: s.project.name, openedAt: Date.now(), thumbnail: thumbUrl, plot: formatPlotSize(s.project.plot.width, s.project.plot.depth, s.project.settings.units) })
    ui.toast({ kind: 'success', title: 'Project saved', body: path.split(/[\\/]/).pop() })
    return true
  } catch (e) {
    ui.showError({ what: 'The project was not saved', why: String((e as Error)?.message ?? e), fix: 'Check that the folder is writable and there is free disk space, then save again.', retry: () => void saveProject(saveAs) })
    return false
  }
}

export async function restoreAutosave(id: string) {
  const data = await platform.autosave.read(id)
  if (!data) {
    useUI.getState().showError({ what: 'That autosave is gone', why: 'The autosave file could not be found.', fix: 'Pick another autosave or open a saved project.' })
    return
  }
  await openProjectData(data, null)
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.readAsDataURL(b)
  })
}
