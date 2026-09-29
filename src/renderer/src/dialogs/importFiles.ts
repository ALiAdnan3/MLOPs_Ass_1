import { useUI } from '../state/ui'
import { openProjectData } from '../storage/session'
import { uploadMaterialFiles } from '../modes/materialUpload'

/** Route dropped / opened files: projects open, images go to materials, plan import or sketch. */
export const pendingImport: { files: File[] } = { files: [] }

export async function importDroppedFiles(files: File[]) {
  const ui = useUI.getState()
  const proj = files.find((f) => f.name.toLowerCase().endsWith('.homeforge'))
  if (proj) {
    await openProjectData(await proj.arrayBuffer(), (proj as File & { path?: string }).path ?? null)
    return
  }
  const images = files.filter((f) => f.type.startsWith('image/'))
  if (!images.length) {
    ui.toast({ kind: 'warning', title: 'That file type is not supported', body: 'Drop a .homeforge project, or a JPG/PNG image.' })
    return
  }
  if (ui.mode === 'materials') {
    await uploadMaterialFiles(images)
    return
  }
  if (ui.mode === 'sketch') {
    pendingImport.files = images
    window.dispatchEvent(new CustomEvent('hf:sketch-image'))
    return
  }
  pendingImport.files = images
  ui.openDialog('import-plan')
}
