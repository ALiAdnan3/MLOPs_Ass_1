import * as THREE from 'three'
import type { MaterialDef } from '../../core/model/types'
import { libraryMaterial, materialSwatch } from '../../core/materials/library'
import { texturePool, type TexMaps } from './textures'
import { assetUrl } from '../../state/assets'

/**
 * Turns MaterialDefs (library recipes or uploaded images) into Three.js PBR materials.
 * Textures are generated lazily in workers; a flat swatch shows until they arrive (§50 lazy
 * loading). UVs are in world meters, so texture.repeat = 1 / material.scale gives true scale.
 */

export type RenderLook = 'realistic' | 'clay'

interface Entry {
  def: MaterialDef
  mats: Map<string, THREE.Material>
  maps?: { color: THREE.Texture; normal?: THREE.Texture; rough?: THREE.Texture }
  loading?: boolean
}

export class MaterialManager {
  private entries = new Map<string, Entry>()
  private custom = new Map<string, MaterialDef>()
  private clay: Record<string, THREE.Material> = {}
  look: RenderLook = 'realistic'
  texSize = 512
  anisotropy = 4
  onUpdate: () => void = () => {}
  clippingPlanes: THREE.Plane[] = []
  /** Texture sets still being generated / decoded. */
  pending = 0
  private idleWaiters: (() => void)[] = []

  /** Resolves once every requested texture set has arrived (or after `timeout` ms). */
  waitIdle(timeout = 5000): Promise<void> {
    if (!this.pending) return Promise.resolve()
    return new Promise((res) => {
      const t = setTimeout(res, timeout)
      this.idleWaiters.push(() => {
        clearTimeout(t)
        res()
      })
    })
  }

  private settle() {
    this.pending = Math.max(0, this.pending - 1)
    if (!this.pending) for (const w of this.idleWaiters.splice(0)) w()
  }

  setProjectMaterials(list: MaterialDef[]) {
    const next = new Map(list.map((m) => [m.id, m]))
    for (const [id, def] of next) {
      if (this.custom.get(id) !== def) this.invalidate(id)
    }
    for (const id of this.custom.keys()) if (!next.has(id)) this.invalidate(id)
    this.custom = next
  }

  resolve(id?: string): MaterialDef | undefined {
    if (!id) return undefined
    return this.custom.get(id) ?? libraryMaterial(id)
  }

  setTextureSize(size: number) {
    if (size === this.texSize) return
    this.texSize = size
    for (const id of [...this.entries.keys()]) this.invalidate(id)
  }

  invalidate(id: string) {
    const e = this.entries.get(id)
    if (!e) return
    for (const m of e.mats.values()) m.dispose()
    e.maps?.color.dispose()
    e.maps?.normal?.dispose()
    e.maps?.rough?.dispose()
    this.entries.delete(id)
  }

  /** Material for an id. `variant` separates instances that need different settings (e.g. clipping). */
  get(id: string | undefined, variant = 'house', fallbackColor = '#cccccc'): THREE.Material {
    const def = this.resolve(id)
    if (this.look === 'clay') return this.clayMaterial(def, variant)
    if (!def) return this.flat(fallbackColor, variant)
    let e = this.entries.get(def.id)
    if (!e || e.def !== def) {
      if (e) this.invalidate(def.id)
      e = { def, mats: new Map() }
      this.entries.set(def.id, e)
    }
    let m = e.mats.get(variant)
    if (!m) {
      m = this.create(def, variant)
      e.mats.set(variant, m)
      if (e.maps) this.applyMaps(m, e.maps, def)
      else this.loadMaps(e)
    }
    return m
  }

  private flatCache = new Map<string, THREE.Material>()
  flat(color: string, variant = 'house', opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const key = `${color}|${variant}|${JSON.stringify(opts)}`
    let m = this.flatCache.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts })
      if (variant === 'house') (m as THREE.MeshStandardMaterial).clippingPlanes = this.clippingPlanes
      this.flatCache.set(key, m)
    }
    return m
  }

  private clayMaterial(def: MaterialDef | undefined, variant: string) {
    const kind = def?.category === 'glass' ? 'glass' : def?.procedural?.kind === 'water' ? 'water' : def?.category === 'ground' && def.procedural?.kind === 'grass' ? 'grass' : 'solid'
    const key = `${kind}|${variant}`
    if (!this.clay[key]) {
      const m =
        kind === 'glass'
          ? new THREE.MeshStandardMaterial({ color: '#cfe2ea', transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide })
          : kind === 'water'
            ? new THREE.MeshStandardMaterial({ color: '#bcd9e4', roughness: 0.2 })
            : kind === 'grass'
              ? new THREE.MeshStandardMaterial({ color: '#e3e6df', roughness: 1 })
              : new THREE.MeshStandardMaterial({ color: '#f1f1ef', roughness: 0.92 })
      if (variant === 'house') m.clippingPlanes = this.clippingPlanes
      this.clay[key] = m
    }
    return this.clay[key]
  }

  private create(def: MaterialDef, variant: string): THREE.Material {
    const swatch = new THREE.Color(materialSwatch(def))
    const isGlass = def.category === 'glass'
    const isWater = def.procedural?.kind === 'water'
    let m: THREE.MeshStandardMaterial
    if (isGlass || isWater) {
      m = new THREE.MeshPhysicalMaterial({
        color: swatch,
        roughness: def.roughness,
        metalness: 0,
        transparent: true,
        opacity: def.opacity ?? 0.3,
        envMapIntensity: 1.2,
        side: THREE.DoubleSide,
        depthWrite: false,
        clearcoat: isWater ? 1 : 0.6,
        clearcoatRoughness: 0.05
      })
    } else if (def.reflection >= 0.45) {
      m = new THREE.MeshPhysicalMaterial({ color: swatch, roughness: def.roughness, metalness: def.metalness, clearcoat: def.reflection * 0.8, clearcoatRoughness: 0.08, envMapIntensity: 0.6 + def.reflection })
    } else {
      m = new THREE.MeshStandardMaterial({ color: swatch, roughness: def.roughness, metalness: def.metalness, envMapIntensity: 0.4 + def.reflection })
    }
    m.name = def.id
    if (variant === 'house') m.clippingPlanes = this.clippingPlanes
    if (variant === 'double') m.side = THREE.DoubleSide
    return m
  }

  private applyMaps(m: THREE.Material, maps: NonNullable<Entry['maps']>, def: MaterialDef) {
    const s = m as THREE.MeshStandardMaterial
    s.map = maps.color
    s.normalMap = maps.normal ?? null
    s.normalScale = new THREE.Vector2(def.normalStrength, def.normalStrength)
    s.roughnessMap = maps.rough ?? null
    s.color = new THREE.Color('#ffffff')
    if (def.color && def.color.toLowerCase() !== '#ffffff') s.color = new THREE.Color(def.color)
    s.needsUpdate = true
  }

  private configure(t: THREE.Texture, def: MaterialDef, srgb: boolean) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(1 / Math.max(0.01, def.scale), 1 / Math.max(0.01, def.scale))
    t.rotation = (def.rotation * Math.PI) / 180
    t.offset.set(def.offset.x, def.offset.y)
    t.anisotropy = this.anisotropy
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
  }

  private dataTex(data: Uint8ClampedArray, size: number, def: MaterialDef, srgb: boolean) {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
    this.configure(t, def, srgb)
    return t
  }

  private loadMaps(e: Entry) {
    if (e.loading) return
    const def = e.def
    if (!def.assetId && !def.procedural) return
    e.loading = true
    this.pending++
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      this.settle()
    }
    const done = (maps: Entry['maps']) => {
      finish()
      if (this.entries.get(def.id) !== e) return
      e.maps = maps
      for (const m of e.mats.values()) this.applyMaps(m, maps!, def)
      this.onUpdate()
    }
    if (def.assetId) {
      const url = assetUrl(def.assetId)
      if (!url) return finish()
      const loader = new THREE.TextureLoader()
      loader.load(url, (img) => {
        const tex = adjustImage(img, def)
        this.configure(tex, def, true)
        const load = (id?: string) =>
          new Promise<THREE.Texture | undefined>((res) => {
            const u = assetUrl(id)
            if (!u) return res(undefined)
            loader.load(u, (t) => {
              this.configure(t, def, false)
              res(t)
            }, undefined, () => res(undefined))
          })
        Promise.all([load(def.maps?.normal), load(def.maps?.roughness)]).then(([normal, rough]) => done({ color: tex, normal, rough }))
      }, undefined, () => {
        e.loading = false
        finish()
      })
      return
    }
    if (!def.procedural) return finish()
    const size = def.category === 'paint' ? Math.min(256, this.texSize) : this.texSize
    texturePool
      .generate({ kind: def.procedural.kind, colors: def.procedural.colors, params: def.procedural.params, seed: def.procedural.seed, size, scale: def.scale }, def.roughness, def.normalStrength, def.brightness, def.contrast)
      .then((maps: TexMaps) =>
        done({
          color: this.dataTex(maps.color, maps.size, def, true),
          normal: this.dataTex(maps.normal, maps.size, def, false),
          rough: this.dataTex(maps.rough, maps.size, def, false)
        })
      )
      .catch(() => {
        e.loading = false
        finish()
      })
  }

  dispose() {
    for (const id of [...this.entries.keys()]) this.invalidate(id)
    for (const m of this.flatCache.values()) m.dispose()
    this.flatCache.clear()
  }
}

/** Brightness / contrast adjustments for uploaded photos, baked through a 2D canvas filter. */
function adjustImage(tex: THREE.Texture, def: MaterialDef): THREE.Texture {
  if (!def.brightness && !def.contrast) return tex
  const img = tex.image as HTMLImageElement
  const c = document.createElement('canvas')
  c.width = img.naturalWidth || img.width
  c.height = img.naturalHeight || img.height
  const g = c.getContext('2d')!
  g.filter = `brightness(${(1 + def.brightness).toFixed(3)}) contrast(${(1 + def.contrast).toFixed(3)})`
  g.drawImage(img, 0, 0)
  tex.dispose()
  return new THREE.CanvasTexture(c)
}
