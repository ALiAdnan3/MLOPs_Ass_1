import JSZip from 'jszip'
import type { Project } from '../core/model/types'
import { defaultSettings, COST_PRESETS, defaultRequirements } from '../core/model/defaults'
import { useAssets } from '../state/assets'

/**
 * Native project format (§65): `.homeforge` is a zip containing
 *   project.json      — the complete structured house model, designs, versions, cameras, settings
 *   assets/<id>       — uploaded material images, generated PBR maps, concept images
 *   assets.json       — asset index (names, mime types)
 *   thumbnail.png     — preview for the start screen
 */

export const FORMAT = 'homeforge'
export const FORMAT_VERSION = 1

export async function serializeProject(project: Project, opts: { thumbnail?: Blob | null; compress?: boolean } = {}): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('project.json', JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION, savedAt: Date.now(), project }))
  const used = collectAssetIds(project)
  const assets = useAssets.getState().assets
  const index: { id: string; name: string; mime: string }[] = []
  for (const id of used) {
    const a = assets[id]
    if (!a) continue
    index.push({ id, name: a.name, mime: a.mime })
    zip.file(`assets/${id}`, a.blob)
  }
  zip.file('assets.json', JSON.stringify(index))
  if (opts.thumbnail) zip.file('thumbnail.png', opts.thumbnail)
  return zip.generateAsync({ type: 'arraybuffer', compression: opts.compress === false ? 'STORE' : 'DEFLATE', compressionOptions: { level: 5 } })
}

export interface LoadedProject {
  project: Project
  assets: { id: string; name: string; mime: string; data: ArrayBuffer }[]
  thumbnail?: string
}

export class ProjectFileError extends Error {
  constructor(
    public what: string,
    public why: string,
    public fix: string
  ) {
    super(what)
  }
}

export async function deserializeProject(data: ArrayBuffer): Promise<LoadedProject> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new ProjectFileError('This file is not a HomeForge project', 'The file is not a valid .homeforge archive (it may be damaged or a different format).', 'Open a file saved by HomeForge AI, or restore from an autosave on the start screen.')
  }
  const pj = zip.file('project.json')
  if (!pj) throw new ProjectFileError('The project file is incomplete', 'project.json is missing from the archive.', 'Try an autosave or an earlier copy of the file.')
  let parsed: { format?: string; formatVersion?: number; project?: Project }
  try {
    parsed = JSON.parse(await pj.async('string'))
  } catch {
    throw new ProjectFileError('The project data is damaged', 'project.json could not be read.', 'Restore from an autosave on the start screen.')
  }
  if (!parsed.project) throw new ProjectFileError('The project data is empty', 'No house model was found in the file.', 'Open a different project.')
  if ((parsed.formatVersion ?? 1) > FORMAT_VERSION) throw new ProjectFileError('This project was saved by a newer HomeForge AI', `File format ${parsed.formatVersion} is newer than this app understands (${FORMAT_VERSION}).`, 'Update HomeForge AI to open it.')
  const project = migrate(parsed.project)
  const index: { id: string; name: string; mime: string }[] = JSON.parse((await zip.file('assets.json')?.async('string')) ?? '[]')
  const assets = []
  for (const a of index) {
    const f = zip.file(`assets/${a.id}`)
    if (f) assets.push({ ...a, data: await f.async('arraybuffer') })
  }
  const thumbFile = zip.file('thumbnail.png')
  const thumbnail = thumbFile ? `data:image/png;base64,${await thumbFile.async('base64')}` : undefined
  return { project, assets, thumbnail }
}

/** Fill fields added in later versions so old projects keep opening. */
export function migrate(p: Project): Project {
  const d = defaultSettings()
  return {
    ...p,
    schema: 1,
    requirements: { ...defaultRequirements(), ...p.requirements },
    settings: { ...d, ...p.settings, snap: { ...d.snap, ...p.settings?.snap }, layers: { ...d.layers, ...p.settings?.layers }, lighting: { ...d.lighting, ...p.settings?.lighting } },
    costRates: p.costRates ?? { ...COST_PRESETS.pakistan },
    materials: p.materials ?? [],
    cameras: p.cameras ?? [],
    designs: p.designs ?? [],
    versions: p.versions ?? [],
    conceptImages: p.conceptImages ?? [],
    site: p.site ?? { areas: [], objects: [] }
  }
}

export function collectAssetIds(p: Project): Set<string> {
  const ids = new Set<string>()
  const addMat = (m: Project['materials'][number]) => {
    if (m.assetId) ids.add(m.assetId)
    if (m.originalAssetId) ids.add(m.originalAssetId)
    if (m.maps?.normal) ids.add(m.maps.normal)
    if (m.maps?.roughness) ids.add(m.maps.roughness)
    if (m.maps?.height) ids.add(m.maps.height)
  }
  p.materials.forEach(addMat)
  for (const v of p.versions) v.materials.forEach(addMat)
  for (const c of p.conceptImages) ids.add(c.assetId)
  return ids
}
