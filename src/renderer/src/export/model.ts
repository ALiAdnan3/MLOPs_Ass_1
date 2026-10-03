import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { Project } from '../core/model/types'
import { getEngine } from '../engine/Engine'
import { sortedFloors } from '../core/model/house'
import type { ExportFile } from '../../../shared/api'

/**
 * 3D MODEL EXPORT (§48): GLB / glTF (with PBR textures) and OBJ + MTL, taken from the same scene
 * the 3D view renders — so the export is exactly the model on screen, built from the house model.
 */

async function prepare(p: Project) {
  const e = getEngine()
  const prev = { project: e.project, options: e.options }
  const ground = sortedFloors(p.floors).find((f) => f.level === 0) ?? p.floors[0]
  e.update(p, { floorId: ground?.id ?? '', showAll: true, viewMode: 'realistic', explodeGap: 0, doorsOpen: true, showFurniture: p.settings.layers.furniture, showStructure: true })
  await e.mats.waitIdle(15000)
  const restore = () => {
    if (prev.project) e.update(prev.project, prev.options)
  }
  const roots = [e.houseRoot, e.siteRoot, e.roofRoot].filter((r) => r.children.length)
  return { e, roots, restore }
}

const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'] as const

/** Procedural maps are DataTextures; exporters need drawable images, so bake them to canvases. */
function exportMaterials() {
  const texCache = new Map<THREE.Texture, THREE.Texture>()
  const matCache = new Map<THREE.Material, THREE.Material>()
  const tex = (t: THREE.Texture): THREE.Texture => {
    const hit = texCache.get(t)
    if (hit) return hit
    const img = t.image as { data?: ArrayLike<number>; width?: number; height?: number } | undefined
    let out = t
    if (img?.data && img.width && img.height) {
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const id = new ImageData(new Uint8ClampedArray(img.data as ArrayLike<number>), img.width, img.height)
      c.getContext('2d')!.putImageData(id, 0, 0)
      const ct = new THREE.CanvasTexture(c)
      ct.wrapS = t.wrapS
      ct.wrapT = t.wrapT
      ct.repeat.copy(t.repeat)
      ct.offset.copy(t.offset)
      ct.rotation = t.rotation
      ct.colorSpace = t.colorSpace
      ct.flipY = t.flipY
      out = ct
    }
    texCache.set(t, out)
    return out
  }
  return (m: THREE.Material): THREE.Material => {
    const hit = matCache.get(m)
    if (hit) return hit
    const c = m.clone() as THREE.Material & Record<string, unknown>
    ;(c as THREE.Material).clippingPlanes = null
    for (const k of MAP_KEYS) {
      const t = c[k] as THREE.Texture | null | undefined
      if (t && (t as THREE.Texture).isTexture) c[k] = tex(t)
    }
    matCache.set(m, c)
    return c
  }
}

/** A clean export copy: world transforms baked into a plain group, helpers and lights left out. */
function exportScene(roots: THREE.Object3D[], name: string): THREE.Group {
  const out = new THREE.Group()
  out.name = name
  const conv = exportMaterials()
  const asExport = (m: THREE.Material | THREE.Material[]) => (Array.isArray(m) ? m.map(conv) : conv(m))
  for (const r of roots) {
    r.updateMatrixWorld(true)
    r.traverse((o) => {
      if (!o.visible) return
      const m = o as THREE.Mesh
      if (!(m as THREE.Mesh).isMesh || !m.geometry) return
      let v: THREE.Object3D | null = o
      while (v) {
        if (!v.visible) return
        v = v.parent
      }
      if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) {
        const im = m as unknown as THREE.InstancedMesh
        const mat = new THREE.Matrix4()
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, mat)
          const c = new THREE.Mesh(im.geometry, asExport(im.material))
          c.name = `${im.name || 'plant'}_${i}`
          c.matrixAutoUpdate = false
          c.matrix.multiplyMatrices(im.matrixWorld, mat)
          c.matrix.decompose(c.position, c.quaternion, c.scale)
          c.matrixAutoUpdate = true
          out.add(c)
        }
        return
      }
      const c = new THREE.Mesh(m.geometry, asExport(m.material))
      c.name = m.name || m.parent?.name || 'mesh'
      m.matrixWorld.decompose(c.position, c.quaternion, c.scale)
      out.add(c)
    })
  }
  return out
}

export async function exportGltf(p: Project, binary: boolean, slug: string): Promise<ExportFile[]> {
  const { roots, restore } = await prepare(p)
  try {
    const scene = exportScene(roots, p.name)
    const exporter = new GLTFExporter()
    const res = await exporter.parseAsync(scene, { binary, onlyVisible: true, maxTextureSize: 2048 })
    if (binary) return [{ name: `${slug}.glb`, data: res as ArrayBuffer }]
    return [{ name: `${slug}.gltf`, data: JSON.stringify(res) }]
  } finally {
    restore()
  }
}

export async function exportObj(p: Project, slug: string): Promise<ExportFile[]> {
  const { roots, restore } = await prepare(p)
  try {
    const scene = exportScene(roots, p.name)
    const lines: string[] = [`# ${p.name} — exported by HomeForge AI (conceptual model, metres, Y up)`, `mtllib ${slug}.mtl`]
    const mtl: string[] = [`# Materials for ${p.name}`]
    const matNames = new Map<THREE.Material, string>()
    const nameFor = (m: THREE.Material) => {
      let n = matNames.get(m)
      if (!n) {
        n = `${(m.name || 'material').replace(/[^A-Za-z0-9_-]/g, '_')}_${matNames.size}`
        matNames.set(m, n)
        const s = m as THREE.MeshStandardMaterial
        const c = s.color ?? new THREE.Color('#cccccc')
        const map = s.map?.image as { data?: unknown } | undefined
        const tint = s.map && !map?.data ? c : c
        mtl.push(`newmtl ${n}`, `Kd ${tint.r.toFixed(4)} ${tint.g.toFixed(4)} ${tint.b.toFixed(4)}`, `Ka 0 0 0`, `Ks ${(0.5 * (1 - (s.roughness ?? 1))).toFixed(3)} ${(0.5 * (1 - (s.roughness ?? 1))).toFixed(3)} ${(0.5 * (1 - (s.roughness ?? 1))).toFixed(3)}`, `Ns ${Math.round(10 + (1 - (s.roughness ?? 1)) * 200)}`, `d ${(s.transparent ? s.opacity : 1).toFixed(3)}`, `illum 2`, '')
      }
      return n
    }
    let vOff = 1
    let tOff = 1
    let nOff = 1
    const v = new THREE.Vector3()
    const nrm = new THREE.Vector3()
    const nm = new THREE.Matrix3()
    scene.children.forEach((o, idx) => {
      const m = o as THREE.Mesh
      const g = m.geometry as THREE.BufferGeometry
      const pos = g.getAttribute('position')
      if (!pos) return
      m.updateMatrix()
      nm.getNormalMatrix(m.matrix)
      const uv = g.getAttribute('uv')
      const nor = g.getAttribute('normal')
      lines.push(`o ${m.name.replace(/\s+/g, '_')}_${idx}`)
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrix)
        lines.push(`v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}`)
      }
      if (uv) for (let i = 0; i < uv.count; i++) lines.push(`vt ${uv.getX(i).toFixed(4)} ${uv.getY(i).toFixed(4)}`)
      if (nor)
        for (let i = 0; i < nor.count; i++) {
          nrm.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize()
          lines.push(`vn ${nrm.x.toFixed(4)} ${nrm.y.toFixed(4)} ${nrm.z.toFixed(4)}`)
        }
      const index = g.getIndex()
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      const groups = g.groups.length ? g.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }]
      for (const gr of groups) {
        const mat = mats[gr.materialIndex ?? 0] ?? mats[0]
        lines.push(`usemtl ${nameFor(mat)}`)
        for (let i = gr.start; i < gr.start + gr.count; i += 3) {
          const ids = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k))
          lines.push(
            'f ' +
              ids
                .map((id) => {
                  const a = id + vOff
                  const t = uv ? id + tOff : ''
                  const n = nor ? id + nOff : ''
                  return nor ? `${a}/${t}/${n}` : uv ? `${a}/${t}` : `${a}`
                })
                .join(' ')
          )
        }
      }
      vOff += pos.count
      if (uv) tOff += uv.count
      if (nor) nOff += nor.count
    })
    return [
      { name: `${slug}.obj`, data: lines.join('\n') + '\n' },
      { name: `${slug}.mtl`, data: mtl.join('\n') + '\n' }
    ]
  } finally {
    restore()
  }
}
