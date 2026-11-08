import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GradientSky } from './lighting/GradientSky'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { captureCanvas } from '../render/encode'
import { RenderPipeline, jitterAt, discAt, type FrameSettings } from './render/Pipeline'
import type { CameraBookmark, Floor, Project, Quality, SurfaceRef, Vec2 } from '../core/model/types'
import { MaterialManager } from './materials/MaterialManager'
import { buildFloor, hasPitchedRoof, type FloorBuild } from './builders/house'
import { buildSite, type SiteBuild } from './builders/site'
import { buildPitchedRoof } from './builders/roof'
import { floorElevations, sortedFloors } from '../core/model/house'
import { sunDirection, nightFactor } from './lighting/sun'
import { surfaceAt, surfaceGeometry } from './MeshBuilder'
import { bbox, area, pointInPolygon } from '../core/geometry/polygon'
import { spec } from '../core/constraints/rooms'
import type { CameraPreset, ViewMode3D } from '../state/ui'

/**
 * The 3D engine (§9–§12, §35, §36, §50). One instance lives for the whole session and is moved
 * between the 3D, materials, interior, exterior, walkthrough, drone and presentation views, so
 * switching modes never rebuilds WebGL state. Geometry is rebuilt per floor only when that floor
 * (or something it depends on) changes, and frames render on demand.
 */

export interface EngineOptions {
  floorId: string
  showAll: boolean
  viewMode: ViewMode3D
  explodeGap: number
  doorsOpen: boolean
  showFurniture: boolean
  showStructure: boolean
  hiddenFloors?: Set<string>
}

export interface Controller {
  active: boolean
  update(dt: number): boolean
  dispose(): void
}

interface FloorEntry {
  deps: unknown[]
  build: FloorBuild
}

/**
 * Quality presets (amendment A13). Every preset refines a still view: it keeps drawing it with
 * sub-pixel camera shifts and the sun moved within its disc, averaging `samples` frames, which gives
 * supersampled edges, soft shadows and clean ambient occlusion. Low's still picture is better than
 * the old Ultra's; higher presets add resolution, sharper shadows, AO and bloom while moving, and
 * more samples.
 */
interface QualitySpec {
  /** Drawing-buffer pixels per CSS pixel (capped by the screen's own). */
  pixelRatio: number
  /** Sun shadow map size. */
  shadows: number
  /** Shadow filter radius in texels while moving (refined frames are softened by the sun's disc). */
  shadowRadius: number
  /** Texture size for library materials. */
  tex: number
  /** Night lights in the pool (shader cost grows with it). */
  lights: number
  /** Ambient occlusion while the view moves (a still view always gets it). */
  aoLive: boolean
  /** Bloom while the view moves. */
  bloomLive: boolean
  /** Samples averaged into a still view. */
  samples: number
  /** Samples per picture (cards, showcase, exports). */
  pictureSamples: number
}
export const QUALITY: Record<Quality, QualitySpec> = {
  low: { pixelRatio: 1, shadows: 2048, shadowRadius: 2.5, tex: 1024, lights: 8, aoLive: false, bloomLive: false, samples: 16, pictureSamples: 12 },
  medium: { pixelRatio: 1.25, shadows: 2048, shadowRadius: 2.5, tex: 1024, lights: 8, aoLive: false, bloomLive: true, samples: 32, pictureSamples: 16 },
  high: { pixelRatio: 1.5, shadows: 4096, shadowRadius: 3, tex: 1024, lights: 8, aoLive: true, bloomLive: true, samples: 64, pictureSamples: 24 },
  ultra: { pixelRatio: 2, shadows: 4096, shadowRadius: 3, tex: 1024, lights: 12, aoLive: true, bloomLive: true, samples: 128, pictureSamples: 40 }
}

/** Angular radius of the sun's disc for soft shadows, radians (larger than the real 0.27° for a pleasing penumbra). */
const SUN_DISC = 0.012

/** How strongly the night surround lights the scene (rooms are lit mainly by their own lights). */
const NIGHT_ENV_INTENSITY = 0.45

export class Engine {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera: THREE.PerspectiveCamera
  ortho: THREE.OrthographicCamera
  active: THREE.Camera
  controls: OrbitControls
  mats = new MaterialManager()
  root = new THREE.Group()
  houseRoot = new THREE.Group()
  siteRoot = new THREE.Group()
  roofRoot = new THREE.Group()
  nightLights = new THREE.Group()
  helpers = new THREE.Group()
  sun = new THREE.DirectionalLight('#fff3e0', 3)
  hemi = new THREE.HemisphereLight('#dfe9f5', '#847d71', 0.9)
  sky = new GradientSky()
  stars: THREE.Points
  project: Project | null = null
  options: EngineOptions = { floorId: '', showAll: true, viewMode: 'realistic', explodeGap: 0, doorsOpen: true, showFurniture: true, showStructure: true }
  quality: Quality = 'high'
  floors = new Map<string, FloorEntry>()
  site: { deps: unknown[]; build: SiteBuild } | null = null
  roofDeps: unknown[] = []
  controller: Controller | null = null
  container: HTMLElement | null = null
  /** Off-screen renders in progress (design cards, tiles): the visible view is not redrawn meanwhile, so it never flashes another house. */
  holds = 0
  night = 0
  private needs = true
  private interacting = 0
  private raf = 0
  private timer = new THREE.Timer()
  private ro: ResizeObserver | null = null
  private pipeline!: RenderPipeline
  /** Bloom strength for the current time of day. */
  private bloomStrength = 0.05
  /** A still view has been refined to its full number of samples (tests wait for this). */
  refined = false
  /** When the view last changed (refinement starts once it has been still a moment). */
  private changedAt = 0
  private highlightMesh: THREE.Mesh | null = null
  private selectMesh: THREE.Mesh | null = null
  private clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6)
  private envTex: THREE.Texture | null = null
  private studioEnv() {
    if (!this.envTex) {
      this.envTex = this.pmrem().fromScene(new RoomEnvironment(), 0.04).texture
    }
    return this.envTex
  }
  private skyEnv: { scene: THREE.Scene; sky: GradientSky; rt: THREE.WebGLRenderTarget | null; key: string } | null = null
  /** Bumped on every scene update (the interior probe is re-captured when the house changes). */
  private sceneRevision = 0
  /**
   * The interior light probe (A13): the room around the camera, captured into a small cube map and
   * filtered like the sky. Indoors it replaces the sky as the environment, so walls are lit by light
   * bounced off the sunlit floor and the windows' daylight, and glossy floors reflect the room
   * rather than the sky. Captured when the view comes to rest inside.
   */
  private probe: { cam: THREE.CubeCamera; rt: THREE.WebGLCubeRenderTarget; env: THREE.WebGLRenderTarget | null; key: string; active: boolean } | null = null
  private skyCache = new Map<string, THREE.WebGLRenderTarget>()
  private skyState = { warm: 0, night: 0 }

  /** Sun direction and sky tint as last applied (the photoreal renderer rebuilds the sky from them). */
  skyParams() {
    return { sunDir: (this.sky.material.uniforms.sunDir.value as THREE.Vector3).clone(), warm: this.skyState.warm, night: this.skyState.night }
  }
  private flight: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number; dur: number } | null = null
  private lastLook: string | null = null
  private explodeCurrent = 0
  onFrame: (() => void) | null = null
  contextLost = false
  /**
   * The mounted view's way of showing its current state (latest project, its options). Pictures
   * rendered in between call it afterwards, so the view never goes back to a copy of the house
   * taken before an edit made while the picture was being drawn.
   */
  viewSync: (() => void) | null = null

  constructor() {
    const canvas = document.createElement('canvas')
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    canvas.style.outline = 'none'
    canvas.tabIndex = 0
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance', logarithmicDepthBuffer: false })
    if (import.meta.env.PROD) this.renderer.debug.checkShaderErrors = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // The sun's shadow map is redrawn only when something that casts or receives shadows changes
    // (the house, the layout, the sun, a refinement sample's sun position), not as the camera
    // moves: at 4096 px it was ~20 ms of every frame while orbiting.
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.shadowMap.needsUpdate = true
    // the scene is drawn into the pipeline's HDR buffer, which needs no stencil or multisampling
    this.renderer.localClippingEnabled = true
    this.mats.clippingPlanes.push(this.clip)
    // a texture arriving changes detail, not the view: it blends into the refined picture
    this.mats.onUpdate = () => this.refresh()
    this.mats.onTexture = (t) => this.queueUpload(t)
    this.mats.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy())

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.contextLost = true
    })
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false
      this.resetBuilds()
      if (this.project) this.update(this.project, this.options)
    })

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000)
    this.camera.position.set(30, 22, 40)
    this.ortho = new THREE.OrthographicCamera(-20, 20, 20, -20, -500, 2000)
    this.active = this.camera
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.09
    this.controls.screenSpacePanning = true
    this.controls.maxPolarAngle = Math.PI * 0.495
    this.controls.minDistance = 0.5
    this.controls.maxDistance = 600
    this.controls.addEventListener('start', () => this.interacting++)
    this.controls.addEventListener('end', () => {
      setTimeout(() => (this.interacting = Math.max(0, this.interacting - 1)), 900)
    })
    this.controls.addEventListener('change', () => this.invalidate())

    this.scene.add(this.root)
    this.root.add(this.houseRoot, this.siteRoot, this.roofRoot, this.nightLights, this.helpers)
    this.scene.add(this.sky)
    this.sun.castShadow = true
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.03
    this.scene.add(this.sun, this.sun.target, this.hemi)
    this.scene.fog = new THREE.Fog('#c9d6e0', 180, 900)
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera)

    const starGeo = new THREE.BufferGeometry()
    const pts: number[] = []
    for (let i = 0; i < 1500; i++) {
      const th = Math.random() * Math.PI * 2
      const ph = Math.acos(Math.random() * 0.9)
      pts.push(Math.sin(ph) * Math.cos(th) * 1500, Math.cos(ph) * 1500, Math.sin(ph) * Math.sin(th) * 1500)
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#dfe6ff', size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }))
    this.scene.add(this.stars)

    // the studio environment (clay view only) is made on first use: baking it here cost ~0.7 s of
    // shader compiling before the first frame
    this.setQuality('high')
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  get canvas() {
    return this.renderer.domElement
  }

  mount(el: HTMLElement) {
    if (this.container === el) return
    this.container = el
    el.appendChild(this.canvas)
    this.ro?.disconnect()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(el)
    this.resize()
  }

  unmount(el: HTMLElement) {
    if (this.container !== el) return
    this.ro?.disconnect()
    this.ro = null
    if (this.canvas.parentElement === el) el.removeChild(this.canvas)
    this.container = null
  }

  resize() {
    const el = this.container
    if (!el) return
    const w = Math.max(1, el.clientWidth)
    const h = Math.max(1, el.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    const a = w / h
    const half = (this.ortho.top - this.ortho.bottom) / 2
    this.ortho.left = -half * a
    this.ortho.right = half * a
    this.ortho.updateProjectionMatrix()
    this.sizePost(w, h)
    this.invalidate()
  }

  invalidate() {
    this.needs = true
  }

  /**
   * Something changed a little (a texture arrived at full size): blend it into the picture being
   * refined instead of starting over. Textures upgrade one by one for a while after a house loads;
   * starting over at each one kept a still view from ever finishing.
   */
  refresh() {
    if (this.pipeline.samples <= 1 || this.needs) return this.invalidate()
    // the next few samples replace most of what was averaged before
    this.pipeline.soften(3)
    this.refined = false
  }

  setQuality(q: Quality) {
    this.quality = q
    const Q = QUALITY[q]
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixelRatio))
    this.renderer.shadowMap.enabled = true
    this.sun.castShadow = true
    this.sun.shadow.radius = Q.shadowRadius
    this.renderer.shadowMap.needsUpdate = true
    if (this.sun.shadow.mapSize.x !== Q.shadows) {
      this.sun.shadow.mapSize.set(Q.shadows, Q.shadows)
      this.sun.shadow.map?.dispose()
      ;(this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null
    }
    this.mats.setTextureSize(Q.tex)
    this.postWarm = null
    // the old builds must leave the scene too, or the house is drawn twice
    this.resetBuilds()
    this.pool = null
    if (this.project) this.update(this.project, this.options)
    this.resize()
    this.invalidate()
  }

  private postWarm: Promise<void> | null = null
  /**
   * The pipeline's shaders (AO, accumulation, bloom, tone mapping, FXAA) compiled on their first
   * frame, ~0.6 s with the window frozen. Compile them in the background first.
   */
  private warmPost(): Promise<void> {
    if (this.postWarm) return this.postWarm
    this.postWarm = this.programsReady(new Set(this.pipeline.compileAll()))
    return this.postWarm
  }
  /** Size the pipeline's buffers to the drawing buffer. */
  private sizePost(w: number, h: number) {
    const pr = this.renderer.getPixelRatio()
    this.pipeline.setSize(w * pr, h * pr)
    this.restart()
  }

  /** What a frame includes: a moving view gets the preset's live effects, a still one all of them. */
  private frameSettings(still: boolean): FrameSettings {
    const Q = QUALITY[this.quality]
    return {
      ao: (still || Q.aoLive) && this.options.viewMode !== 'architectural',
      bloom: still || Q.bloomLive ? this.bloomStrength : 0,
      fxaa: true
    }
  }

  /** The view changed: the refined picture starts over. */
  private restart() {
    this.pipeline.reset()
    this.refined = false
    this.changedAt = performance.now()
  }

  // ── scene sync ────────────────────────────────────────────────────────────
  update(p: Project, opts: EngineOptions) {
    this.project = p
    this.options = opts
    this.sceneRevision++
    this.renderer.shadowMap.needsUpdate = true
    const look = opts.viewMode === 'architectural' ? 'clay' : 'realistic'
    if (look !== this.lastLook) {
      this.mats.look = look
      this.lastLook = look
      this.resetBuilds()
    }
    this.mats.setProjectMaterials(p.materials)
    const floors = sortedFloors(p.floors)
    const el = floorElevations(p.floors, p.settings.plinthHeight)
    const showCeilings = !(opts.viewMode === 'dollhouse' || opts.viewMode === 'floor' || opts.viewMode === 'exploded')
    const pitched = hasPitchedRoof(p)
    const house = { plot: p.plot, floors: p.floors, site: p.site, exterior: p.exterior }
    const seen = new Set<string>()
    floors.forEach((f, i) => {
      seen.add(f.id)
      const deps = [f, floors[i - 1], floors[i + 1], p.materials, p.exterior, opts.doorsOpen, opts.showFurniture, opts.showStructure, showCeilings, pitched, p.settings.plinthHeight, look]
      const cur = this.floors.get(f.id)
      if (cur && sameDeps(cur.deps, deps)) return
      if (cur) this.putAside(f.id, cur)
      // the same floor in the same state shown a moment ago (another design's picture was taken,
      // doors were shut for an interior shot…): reuse its build instead of rebuilding
      let build = this.takeAside(f.id, deps)?.build as FloorBuild | undefined
      if (!build) {
        try {
          build = buildFloor(f, { house, mats: this.mats, custom: p.materials, doorsOpen: opts.doorsOpen, showFurniture: opts.showFurniture, showStructure: opts.showStructure, showCeilings, pitchedRoofCoversTop: pitched, plinth: p.settings.plinthHeight })
        } catch (e) {
          console.error('floor build failed', e)
          build = { group: new THREE.Group(), lights: [], colliders: [] }
        }
        this.programsDirty = true
      }
      build.group.userData.floorId = f.id
      this.houseRoot.add(build.group)
      this.floors.set(f.id, { deps, build })
    })
    for (const [id, e] of this.floors) {
      if (!seen.has(id)) {
        this.putAside(id, e)
        this.floors.delete(id)
      }
    }
    const ground = p.floors.find((f) => f.level === 0)
    const siteDeps = [p.site, p.plot, p.exterior, ground, p.materials, look, p.settings.plinthHeight, floors.length]
    if (!this.site || !sameDeps(this.site.deps, siteDeps)) {
      if (this.site) this.putAside('site', this.site)
      let build = this.takeAside('site', siteDeps)?.build as SiteBuild | undefined
      if (!build) {
        build = buildSite(house, this.mats, p.settings.plinthHeight)
        this.programsDirty = true
      }
      this.siteRoot.add(build.group)
      this.site = { deps: siteDeps, build }
    }
    const top = floors.filter((f) => f.kind !== 'roof').pop()
    const roofDeps = [p.exterior, top, p.materials, look, pitched, p.settings.plinthHeight]
    if (!sameDeps(this.roofDeps, roofDeps)) {
      this.clearGroup(this.roofRoot)
      const r = pitched ? buildPitchedRoof(house, this.mats, p.settings.plinthHeight) : null
      if (r) this.roofRoot.add(r)
      this.roofDeps = roofDeps
      this.programsDirty = true
    }
    this.applyLayout(el)
    this.applyLighting()
    this.fitShadowCamera()
    this.invalidate()
  }

  /** Floor positions (elevation + explode), visibility and dollhouse clipping. */
  private applyLayout(el?: Map<string, number>) {
    const p = this.project
    if (!p) return
    el = el ?? floorElevations(p.floors, p.settings.plinthHeight)
    const floors = sortedFloors(p.floors)
    const o = this.options
    const activeIdx = Math.max(0, floors.findIndex((f) => f.id === o.floorId))
    const activeLevel = floors[activeIdx]?.level ?? 0
    const gap = o.viewMode === 'exploded' ? Math.max(2.5, o.explodeGap || 4) : 0
    this.explodeCurrent = gap
    floors.forEach((f, i) => {
      const e = this.floors.get(f.id)
      if (!e) return
      const g = e.build.group
      g.position.y = (el!.get(f.id) ?? 0) + i * gap
      let vis = f.visible && !o.hiddenFloors?.has(f.id)
      if (o.viewMode === 'floor') vis = f.id === o.floorId
      else if (o.viewMode === 'dollhouse') vis = vis && f.level <= activeLevel
      else if (!o.showAll) vis = vis && f.level <= activeLevel
      g.visible = vis
      g.updateMatrixWorld(true)
    })
    const roofVisible = o.viewMode !== 'dollhouse' && o.viewMode !== 'floor' && (o.showAll || activeIdx === floors.length - 1)
    this.roofRoot.visible = roofVisible
    this.roofRoot.position.y = gap ? (floors.length - 1) * gap : 0
    this.siteRoot.visible = o.viewMode !== 'floor' || true
    // dollhouse: cut walls of the active floor at 1.6 m
    const active = floors[activeIdx]
    this.renderer.shadowMap.needsUpdate = true
    if (o.viewMode === 'dollhouse' && active) this.clip.constant = (el.get(active.id) ?? 0) + Math.min(1.7, active.height * 0.55)
    else this.clip.constant = 1e6
    this.invalidate()
  }

  setOptions(opts: Partial<EngineOptions>) {
    const prev = this.options
    this.options = { ...this.options, ...opts }
    if (!this.project) return
    const rebuild = opts.viewMode !== undefined && ((opts.viewMode === 'architectural') !== (prev.viewMode === 'architectural') || ['dollhouse', 'floor', 'exploded'].includes(opts.viewMode) !== ['dollhouse', 'floor', 'exploded'].includes(prev.viewMode))
    if (rebuild || opts.doorsOpen !== undefined || opts.showFurniture !== undefined || opts.showStructure !== undefined) this.update(this.project, this.options)
    else this.applyLayout()
  }

  // ── lighting ──────────────────────────────────────────────────────────────
  applyLighting() {
    const p = this.project
    if (!p) return
    const L = p.settings.lighting
    const d = sunDirection(p.plot, L)
    const night = nightFactor(d.altitude)
    this.night = night
    const center = this.houseCenter()
    const dist = 120
    const dir = new THREE.Vector3(d.x, Math.max(0.02, d.y), d.z).normalize()
    this.sun.position.copy(center).addScaledVector(dir, dist)
    this.sun.target.position.copy(center)
    this.sun.target.updateMatrixWorld()
    this.renderer.shadowMap.needsUpdate = true
    const warm = THREE.MathUtils.clamp((20 - d.altitude) / 20, 0, 1)
    this.sun.color.setHSL(0.09, 0.2 + warm * 0.6, 0.92 - warm * 0.18)
    this.sun.intensity = night >= 1 ? 0 : (1 - night) * (1.4 + Math.min(1, d.altitude / 40) * 2.4)
    this.sun.visible = this.sun.intensity > 0.01
    // the sky environment map already supplies daylight ambient; the hemisphere only fills in
    // blue-hour fill: dusk keeps a cool ambient so lawns and walls stay readable
    const dusk = Math.max(0, 1 - Math.abs(night - 0.55) / 0.45)
    this.hemi.intensity = 0.12 + (1 - night) * 0.38 + dusk * 0.32 + night * 0.08
    this.hemi.color.set(night > 0.5 ? '#3a4a6a' : '#dfe9f5')
    this.hemi.groundColor.set(night > 0.5 ? '#1a1a1e' : '#847d71')
    this.sky.update(new THREE.Vector3(d.x, d.y, d.z), warm, night)
    this.skyState = { warm, night }
    this.sky.visible = true
    this.scene.background = null
    ;(this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, night - 0.4)
    const fogColor = new THREE.Color().setHSL(0.58, 0.25, 0.8 - night * 0.72)
    ;(this.scene.fog as THREE.Fog).color = fogColor
    this.exposureBase = this.options.viewMode === 'architectural' ? 1.05 : 0.84 + night * 0.22 + dusk * 0.2
    this.updateSkyEnvironment(night)
    this.bloomStrength = 0.04 + night * 0.32
    // emissive fixtures glow at night
    const lightsOn = L.interiorLights
    const glow = 0.15 + night * 1.1
    // lit rooms read through the glass from dusk onwards (seen from outside; see applyWindowGlow)
    this.windowGlow = lightsOn ? Math.min(3.2, Math.max(0, night - 0.05) * 3.4) : 0
    // new builds bring their own glass: apply the glow to them too
    this.glowApplied = -1
    this.root.traverse((o) => {
      const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined
      for (const m of Array.isArray(mm) ? mm : mm ? [mm] : []) {
        if (m.userData?.emissiveLight) m.emissiveIntensity = lightsOn || night < 0.2 ? glow : 0.05
      }
    })
    this.placeNightLights(night)
    this.invalidate()
  }

  /**
   * Image-based lighting from the actual sky: ambient colour and reflections follow the sun and
   * time of day. Re-baked only when the sun moves; the neutral studio environment takes over
   * at night so interiors stay readable.
   */
  private lastInside = false
  private insideCheck = 0

  /** Is the camera inside a room of a visible floor? */
  cameraInside(): boolean {
    const p = this.project
    if (!p) return false
    const pos = this.active === this.camera ? this.camera.position : this.ortho.position
    for (const f of p.floors) {
      const e = this.floors.get(f.id)
      if (!e || !e.build.group.visible) continue
      const y = e.build.group.position.y
      if (pos.y < y || pos.y > y + f.height) continue
      if (f.rooms.some((r) => r.type !== 'void' && !spec(r.type).outdoor && pointInPolygon({ x: pos.x, y: pos.z }, r.polygon))) return true
    }
    return false
  }

  private exposureBase = 1
  private updateSkyEnvironment(night: number) {
    // interiors are exposed brighter, as a photographer would (by day the windows are far brighter
    // than the room; the room is what the picture is about)
    const indoors = !!(this.probe?.active && this.probe.env && this.options.viewMode !== 'architectural')
    this.renderer.toneMappingExposure = this.exposureBase * (indoors ? 1.35 - this.night * 0.2 : 1)
    if (indoors) {
      this.scene.environment = this.probe!.env!.texture
      this.scene.environmentIntensity = 1
      return
    }
    if (this.options.viewMode === 'architectural') {
      this.scene.environment = this.studioEnv()
      this.scene.environmentIntensity = 0.8
      return
    }
    if (night > 0.8) {
      // the studio environment's bright panels mirrored in glossy floors and glass as white blobs
      // at night; a soft, even surround keeps rooms readable without them
      this.scene.environment = this.nightEnvironment()
      this.scene.environmentIntensity = NIGHT_ENV_INTENSITY
      return
    }
    const su = this.sky.material.uniforms
    const sp = su.sunDir.value as THREE.Vector3
    const key = `${sp.x.toFixed(2)},${sp.y.toFixed(2)},${sp.z.toFixed(2)},${this.skyState.warm.toFixed(2)},${this.skyState.night.toFixed(2)}`
    if (!this.skyEnv) {
      const scene = new THREE.Scene()
      const sky = new GradientSky(50)
      scene.add(sky)
      this.skyEnv = { scene, sky, rt: null, key: '' }
    }
    const e = this.skyEnv
    if (!this.pmremWarm) {
      // first bake: compile the bake's shaders in the background, then bake (see warmPmrem)
      void this.warmPmrem().then(() => this.applyLighting())
      return
    }
    if (e.key !== key) {
      e.key = key
      // pictures switch between a few lighting setups (sunset cards, the evening hero, daylight
      // previews): keep the last few baked skies instead of re-baking at every switch
      let rt = this.skyCache.get(key)
      if (rt) this.skyCache.delete(key)
      else {
        e.sky.update(sp, this.skyState.warm, this.skyState.night)
        rt = this.pmrem().fromScene(e.scene, 0.02, 0.1, 200)
      }
      this.skyCache.set(key, rt)
      while (this.skyCache.size > 4) {
        const [old, oldRt] = this.skyCache.entries().next().value!
        this.skyCache.delete(old)
        oldRt.dispose()
      }
      e.rt = rt
    }
    this.scene.environment = e.rt!.texture
    this.scene.environmentIntensity = 0.85 + (1 - night) * 0.35
  }

  /**
   * Capture the interior probe at the camera if it is inside a room (and the capture is out of date).
   * Returns whether the environment changed. Outside, the sky takes over again.
   */
  private refreshProbe(): boolean {
    const inside = this.options.viewMode !== 'architectural' && this.active === this.camera && this.cameraInside()
    if (!inside) {
      if (!this.probe?.active) return false
      this.probe.active = false
      this.updateSkyEnvironment(this.night)
      return true
    }
    if (!this.pmremWarm) return false
    const pos = this.camera.position
    const key = `${Math.round(pos.x / 0.75)},${Math.round(pos.y / 0.75)},${Math.round(pos.z / 0.75)}|${this.sceneRevision}|${this.skyEnv?.key ?? ''}|${this.night.toFixed(2)}`
    if (this.probe?.active && this.probe.key === key) return false
    if (!this.probe) {
      const rt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType })
      this.probe = { cam: new THREE.CubeCamera(0.05, 200, rt), rt, env: null, key: '', active: false }
    }
    const pr = this.probe
    // the room as lit by the sun through its windows and a share of the sky (the light that comes in)
    pr.active = false
    this.updateSkyEnvironment(this.night)
    const envI = this.scene.environmentIntensity
    this.scene.environmentIntensity = envI * 0.45
    const helpers = this.helpers.visible
    this.helpers.visible = false
    const shadowPending = this.renderer.shadowMap.needsUpdate
    this.renderer.shadowMap.needsUpdate = false
    const prevTarget = this.renderer.getRenderTarget()
    pr.cam.position.copy(pos)
    pr.cam.update(this.renderer, this.scene)
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.shadowMap.needsUpdate = shadowPending
    this.helpers.visible = helpers
    this.scene.environmentIntensity = envI
    pr.env = this.pmrem().fromCubemap(pr.rt.texture, pr.env ?? undefined)
    pr.key = key
    pr.active = true
    this.updateSkyEnvironment(this.night)
    return true
  }

  private pmremGen: THREE.PMREMGenerator | null = null
  private pmrem() {
    return (this.pmremGen ??= new THREE.PMREMGenerator(this.renderer))
  }
  private pmremWarm = false
  private pmremWarming: Promise<void> | null = null
  /**
   * The environment bake's own shaders (three.js's blur and GGX filters, and the sky) compiled
   * synchronously on the first bake: ~0.6 s with the window frozen at start-up. Here they are
   * created first and compiled by the GPU in the background; the bake then runs at once.
   * Uses PMREMGenerator internals (three r186); without them it simply bakes as before.
   */
  private warmPmrem(): Promise<void> {
    if (this.pmremWarm) return Promise.resolve()
    if (this.pmremWarming) return this.pmremWarming
    const pm = this.pmrem() as unknown as { _setSize?(n: number): void; _allocateTargets?(): THREE.WebGLRenderTarget; _blurMaterial?: THREE.Material; _ggxMaterial?: THREE.Material; _pingPongRenderTarget?: THREE.WebGLRenderTarget; _lodMeshes?: THREE.Mesh[] }
    const materials = new Set<THREE.Material>()
    const prev = this.renderer.getRenderTarget()
    try {
      if (pm._setSize && pm._allocateTargets) {
        pm._setSize(256)
        const rt = pm._allocateTargets()
        // the filters, on the generator's own meshes and target (program variants depend on both)
        const lod = pm._lodMeshes?.[0]
        if (lod && pm._pingPongRenderTarget) {
          this.renderer.setRenderTarget(pm._pingPongRenderTarget)
          const flat = new THREE.OrthographicCamera()
          const orig = lod.material
          for (const m of [pm._blurMaterial, pm._ggxMaterial]) {
            if (!m) continue
            lod.material = m
            for (const x of this.renderer.compile(lod, flat)) materials.add(x)
          }
          lod.material = orig
        }
        // the bake's background box (a plain back-faced material) and the sky itself
        this.renderer.setRenderTarget(rt)
        const cube = new THREE.PerspectiveCamera(90, 1, 0.1, 200)
        const bg = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ name: 'PMREM.Background', side: THREE.BackSide, depthWrite: false, depthTest: false }))
        for (const x of this.renderer.compile(bg, cube)) materials.add(x)
        if (this.skyEnv) for (const x of this.renderer.compile(this.skyEnv.scene, cube)) materials.add(x)
        rt.dispose()
        // the interior probe's filter (a cube map in, rather than a scene)
        const pmc = pm as unknown as { compileCubemapShader?(): void; _cubemapMaterial?: THREE.Material | null }
        pmc.compileCubemapShader?.()
        if (pmc._cubemapMaterial) materials.add(pmc._cubemapMaterial)
      }
    } catch {
      /* internals changed: the first bake compiles as it used to */
    } finally {
      this.renderer.setRenderTarget(prev)
    }
    this.pmremWarming = this.programsReady(materials).then(() => {
      this.pmremWarm = true
      this.pmremWarming = null
    })
    return this.pmremWarming
  }

  private nightEnv: THREE.Texture | null = null
  /** Night ambience: warm grey, lighter overhead and darker underfoot, with no hot spots to reflect. */
  private nightEnvironment() {
    if (this.nightEnv) return this.nightEnv
    const scene = new THREE.Scene()
    const geo = new THREE.SphereGeometry(10, 32, 16)
    const pos = geo.attributes.position
    const low = new THREE.Color('#1d1a17')
    const high = new THREE.Color('#b8ae9f')
    const col = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const c = low.clone().lerp(high, Math.pow((pos.getY(i) / 10 + 1) / 2, 1.4))
      col.set([c.r, c.g, c.b], i * 3)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })))
    this.nightEnv = this.pmrem().fromScene(scene, 0.04).texture
    geo.dispose()
    return this.nightEnv
  }

  /**
   * The night lights: a fixed set, reused. Every material's shader depends on how many lights
   * there are, so adding and removing lights as the camera moved or the time changed recompiled
   * every shader each time. Unused lights stay in place with no intensity.
   */
  private pool: { points: THREE.PointLight[]; spots: THREE.SpotLight[] } | null = null
  private lightPool() {
    const n = QUALITY[this.quality].lights
    const ns = Math.ceil(n / 2)
    if (this.pool && this.pool.points.length === n && this.pool.spots.length === ns) return this.pool
    for (const c of [...this.nightLights.children]) {
      this.nightLights.remove(c)
      ;(c as THREE.Light).dispose?.()
    }
    const points = Array.from({ length: n }, () => new THREE.PointLight('#ffffff', 0, 0.01, 2))
    const spots = Array.from({ length: ns }, () => new THREE.SpotLight('#ffffff', 0, 0.01, 0.5, 0.75, 1.5))
    for (const l of points) this.nightLights.add(l)
    for (const l of spots) this.nightLights.add(l, l.target)
    this.programsDirty = true
    return (this.pool = { points, spots })
  }

  private windowGlow = 0
  private glowApplied = -1
  /**
   * Window glass glows at night so lit rooms read from the street. From inside the house the same
   * glass would shine like a floodlight, so it glows only while the camera is outside.
   */
  private applyWindowGlow() {
    const level = this.lastInside ? 0 : this.windowGlow
    if (level === this.glowApplied) return
    this.glowApplied = level
    this.root.traverse((o) => {
      const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined
      for (const m of Array.isArray(mm) ? mm : mm ? [mm] : []) if (m.userData?.windowGlow) m.emissiveIntensity = level
    })
  }

  private placeNightLights(night: number) {
    const pool = this.lightPool()
    for (const l of [...pool.points, ...pool.spots]) {
      l.intensity = 0
      l.distance = 0.01
      l.position.set(0, -500, 0)
    }
    let pi = 0
    let si = 0
    const p = this.project
    if (!p) return
    const L = p.settings.lighting
    const budget = QUALITY[this.quality].lights
    // point lights cast no shadows, so seen from outside they would shine through walls and
    // roofs; outside, lit rooms show through their glowing windows instead
    this.lastInside = this.cameraInside()
    this.applyWindowGlow()
    // basements are lit whatever the time of day (§26)
    const interior: { pos: THREE.Vector3; warm: boolean; basement: boolean; intensity: number; kelvin?: number }[] = []
    for (const e of this.floors.values()) {
      if (!e.build.group.visible) continue
      for (const l of e.build.lights) {
        if (!l.on) continue
        interior.push({ pos: l.p.clone().add(new THREE.Vector3(0, e.build.group.position.y, 0)), warm: l.warm, basement: l.basement, intensity: l.intensity, kelvin: l.kelvin })
      }
    }
    const cam = this.camera.position
    interior.sort((a, b) => a.pos.distanceToSquared(cam) - b.pos.distanceToSquared(cam))
    let used = 0
    if (L.interiorLights) {
      for (const l of interior) {
        if (used >= budget) break
        if (night < 0.25 && !l.basement) continue
        if (!this.lastInside) continue
        const color = l.kelvin ? kelvinColor(l.kelvin) : l.warm ? '#ffd9a6' : '#fff4e6'
        const pl = pool.points[pi++]
        pl.color.set(color)
        pl.intensity = (l.basement ? 5 : 3 + night * 5) * l.intensity
        pl.distance = 7
        pl.decay = 1.6
        pl.position.copy(l.pos)
        used++
      }
    }
    // garden lights are outside: from inside the house they would only shine through the walls
    if (L.exteriorLights && night > 0.3 && this.site && !this.lastInside) {
      const extColor = kelvinColor(p.exterior.lighting.temperature || 3000)
      let ext = 0
      for (const l of this.site.build.lights) {
        if (ext >= Math.ceil(budget / 2)) break
        if (l.kind === 'wash') {
          if (si >= pool.spots.length) continue
          const s = pool.spots[si++]
          s.color.set(extColor)
          s.intensity = 16 * night
          s.distance = 9
          s.angle = 0.5
          s.penumbra = 0.75
          s.decay = 1.5
          s.position.copy(l.p)
          s.target.position.copy(l.p).add(new THREE.Vector3(0, 5, -0.8))
          s.target.updateMatrixWorld()
        } else {
          // garden lamps share the pool with the rooms' lights; the rooms come first
          if (pi >= pool.points.length) continue
          const pl = pool.points[pi++]
          pl.color.set(extColor)
          pl.intensity = (l.kind === 'lamp' ? 6 : 2.5) * night
          pl.distance = l.kind === 'lamp' ? 9 : 4
          pl.decay = 1.8
          pl.position.copy(l.p)
        }
        ext++
      }
    }
  }

  private fitShadowCamera() {
    const p = this.project
    if (!p) return
    const b = bbox(p.plot.polygon)
    const r = Math.hypot(b.w, b.h) * 0.62 + 6
    const cam = this.sun.shadow.camera
    cam.left = -r
    cam.right = r
    cam.top = r
    cam.bottom = -r
    cam.near = 1
    cam.far = 300
    cam.updateProjectionMatrix()
  }

  houseCenter(): THREE.Vector3 {
    const p = this.project
    if (!p) return new THREE.Vector3()
    const g = p.floors.find((f) => f.level === 0)
    const pts = g?.rooms.filter((r) => !spec(r.type).outdoor).flatMap((r) => r.polygon) ?? p.plot.polygon
    const b = bbox(pts.length ? pts : p.plot.polygon)
    const floors = sortedFloors(p.floors).filter((f) => f.level >= 0 && f.kind !== 'roof')
    const h = floors.reduce((s, f) => s + f.height, 0)
    return new THREE.Vector3(b.x + b.w / 2, Math.max(1.5, h / 2), b.y + b.h / 2)
  }

  // ── cameras ───────────────────────────────────────────────────────────────
  flyTo(pos: THREE.Vector3, target: THREE.Vector3, dur = 0.9) {
    this.useOrtho(false)
    if (dur <= 0) {
      // an instant move also cancels any flight still under way
      this.flight = null
      this.camera.position.copy(pos)
      this.controls.target.copy(target)
      this.controls.update()
      this.invalidate()
      return
    }
    this.flight = { from: this.camera.position.clone(), to: pos.clone(), tFrom: this.controls.target.clone(), tTo: target.clone(), t: 0, dur }
  }

  useOrtho(on: boolean) {
    const want = on ? this.ortho : this.camera
    if (this.active === want) return
    this.active = want
    this.controls.object = want
    this.controls.enableRotate = !on
    this.invalidate()
  }

  setCameraPreset(preset: CameraPreset, roomId?: string, animate = true) {
    const p = this.project
    if (!p) return
    const c = this.houseCenter()
    const b = bbox(p.plot.polygon)
    const size = Math.max(b.w, b.h)
    const dur = animate ? 0.9 : 0
    const floors = sortedFloors(p.floors)
    const el = floorElevations(p.floors, p.settings.plinthHeight)
    const active = floors.find((f) => f.id === this.options.floorId) ?? floors.find((f) => f.level === 0)!
    const eye = (el.get(active?.id ?? '') ?? 0) + 1.6
    switch (preset) {
      case 'orbit':
        this.flyTo(new THREE.Vector3(c.x + size * 0.85, c.y + size * 0.55, c.z + size * 1.05), c, dur)
        break
      case 'top':
      case 'front':
      case 'back':
      case 'left':
      case 'right': {
        const half = size * 0.62
        const a = this.camera.aspect
        this.ortho.top = half
        this.ortho.bottom = -half
        this.ortho.left = -half * a
        this.ortho.right = half * a
        this.ortho.zoom = 1
        this.ortho.updateProjectionMatrix()
        const dirs: Record<string, [number, number, number]> = { top: [0, 1, 0.0001], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] }
        const d = dirs[preset]
        this.useOrtho(true)
        this.ortho.position.set(c.x + d[0] * 200, preset === 'top' ? c.y + 200 : c.y, c.z + d[2] * 200)
        this.controls.target.copy(preset === 'top' ? new THREE.Vector3(c.x, 0, c.z) : c)
        this.ortho.up.set(0, 1, 0)
        if (preset === 'top') this.ortho.up.set(0, 0, -1)
        this.ortho.lookAt(this.controls.target)
        this.controls.update()
        break
      }
      case 'street': {
        const ry = b.y + b.h + p.plot.roadWidth * 0.55 + 1.5
        this.flyTo(new THREE.Vector3(c.x + b.w * 0.35, 1.65, ry), new THREE.Vector3(c.x, c.y * 0.9, c.z), dur)
        break
      }
      case 'facade': {
        // the whole front elevation from across the road, slightly raised and a little to the side
        const f = facadePose(p, c, this.camera.aspect, this.camera.fov)
        this.flyTo(f.position, f.target, dur)
        break
      }
      case 'interior':
      case 'room': {
        const rooms = active?.rooms.filter((r) => spec(r.type).walkable && !spec(r.type).outdoor && r.type !== 'garage') ?? []
        // the named room may sit on another floor than the one on show
        const owner = roomId ? floors.find((f) => f.rooms.some((r) => r.id === roomId)) : undefined
        const room = owner?.rooms.find((r) => r.id === roomId) || rooms.sort((x, y) => area(y.polygon) - area(x.polygon))[0]
        if (!room) return
        const y = owner ? (el.get(owner.id) ?? 0) + 1.6 : eye
        const rb = bbox(room.polygon)
        const corner = new THREE.Vector3(rb.x + rb.w * 0.12, y, rb.y + rb.h * 0.12)
        const target = new THREE.Vector3(rb.x + rb.w * 0.85, y - 0.35, rb.y + rb.h * 0.85)
        this.flyTo(corner, target, dur)
        this.controls.maxPolarAngle = Math.PI
        break
      }
      default:
        break
    }
    this.controls.maxPolarAngle = preset === 'interior' || preset === 'room' ? Math.PI : Math.PI * 0.495
    this.invalidate()
  }

  getBookmark(name: string): Omit<CameraBookmark, 'id'> {
    return { name, position: this.camera.position.toArray() as [number, number, number], target: this.controls.target.toArray() as [number, number, number], fov: this.camera.fov }
  }

  goToBookmark(b: CameraBookmark) {
    this.camera.fov = b.fov
    this.camera.updateProjectionMatrix()
    this.flyTo(new THREE.Vector3(...b.position), new THREE.Vector3(...b.target))
  }

  // ── picking & highlight ───────────────────────────────────────────────────
  private ray = new THREE.Raycaster()
  pick(clientX: number, clientY: number): { surface: SurfaceRef | null; point: THREE.Vector3; object: THREE.Object3D; floorId?: string } | null {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.ray.setFromCamera(ndc, this.active)
    const targets: THREE.Object3D[] = [this.houseRoot, this.siteRoot, this.roofRoot].filter((t) => t.visible)
    const hits = this.ray.intersectObjects(targets, true).filter((h) => {
      if (!h.object.visible) return false
      let o: THREE.Object3D | null = h.object
      while (o) {
        if (!o.visible) return false
        o = o.parent
      }
      if (this.clip.constant < 1e5 && h.point.y > this.clip.constant) return false
      return true
    })
    const h = hits.find((x) => (x.object as THREE.Mesh).isMesh)
    if (!h) return null
    const mesh = h.object as THREE.Mesh
    const surface = h.faceIndex != null ? surfaceAt(mesh, h.faceIndex) : null
    let fid: string | undefined
    let o: THREE.Object3D | null = mesh
    while (o && !fid) {
      fid = o.userData?.floorId
      o = o.parent
    }
    return { surface, point: h.point, object: mesh, floorId: fid }
  }

  highlight(surface: SurfaceRef | null, kind: 'hover' | 'select' = 'hover') {
    const prev = kind === 'hover' ? this.highlightMesh : this.selectMesh
    if (prev) {
      prev.parent?.remove(prev)
      prev.geometry.dispose()
    }
    if (kind === 'hover') this.highlightMesh = null
    else this.selectMesh = null
    if (!surface) {
      this.invalidate()
      return
    }
    const geos: THREE.BufferGeometry[] = []
    let parent: THREE.Object3D = this.helpers
    const scan = (root: THREE.Object3D) =>
      root.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh || !m.userData.ranges) return
        const g = surfaceGeometry(m, surface, sameSurface)
        if (g) {
          geos.push(g)
          parent = m.parent ?? parent
        }
      })
    const floorId = 'floorId' in surface ? (surface as { floorId?: string }).floorId : undefined
    if (floorId) {
      const e = this.floors.get(floorId)
      if (e) scan(e.build.group)
    } else {
      scan(this.siteRoot)
      scan(this.roofRoot)
      for (const e of this.floors.values()) scan(e.build.group)
    }
    if (!geos.length) {
      this.invalidate()
      return
    }
    const merged = mergeGeos(geos)
    const mat = new THREE.MeshBasicMaterial({ color: kind === 'hover' ? '#4da8da' : '#f0b823', transparent: true, opacity: kind === 'hover' ? 0.22 : 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(merged, mat)
    mesh.renderOrder = 10
    mesh.raycast = () => {}
    ;(parent as THREE.Object3D).add(mesh)
    if (kind === 'hover') this.highlightMesh = mesh
    else this.selectMesh = mesh
    this.invalidate()
  }

  /** All wall/obstacle segments for walkthrough collision, for the floor at elevation y. */
  colliders(floorId: string): { a: Vec2; b: Vec2; r: number }[] {
    const e = this.floors.get(floorId)
    const out = [...(e?.build.colliders ?? [])]
    const f = this.project?.floors.find((x) => x.id === floorId)
    if (f?.level === 0 && this.site) out.push(...this.site.build.colliders)
    return out
  }

  floorGroupY(floorId: string) {
    return this.floors.get(floorId)?.build.group.position.y ?? 0
  }

  setController(c: Controller | null) {
    if (this.controller && this.controller !== c) this.controller.dispose()
    this.controller = c
    this.controls.enabled = !c
    this.invalidate()
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  private loop() {
    this.raf = requestAnimationFrame(this.loop)
    this.timer.update()
    const dt = Math.min(0.1, this.timer.getDelta())
    if (!this.contextLost) this.drainUploads()
    if (!this.container || this.contextLost || this.holds > 0) return
    let dirty = this.needs
    if (this.flight) {
      const f = this.flight
      f.t += dt / f.dur
      const k = f.t >= 1 ? 1 : 1 - Math.pow(1 - f.t, 3)
      this.camera.position.lerpVectors(f.from, f.to, k)
      this.controls.target.lerpVectors(f.tFrom, f.tTo, k)
      if (f.t >= 1) this.flight = null
      dirty = true
    }
    if (this.controller?.active) {
      if (this.controller.update(dt)) dirty = true
    } else if (this.interacting > 0 || this.flight) {
      // damping keeps the camera gliding a moment after release; only real movement redraws
      if (this.controls.update() || this.flight) dirty = true
    }
    const refining = !dirty && !this.refined
    if (!dirty && !refining) return
    // new shaders compile in the background first; the last frame stays up meanwhile
    if (this.programsDirty || this.compiling || !this.compiledFor.has(this.renderPath())) {
      void this.ready()
      return
    }
    if (dirty) {
      this.needs = false
      this.restart()
      // walking in or out of the house at night swaps interior lights on/off
      if (++this.insideCheck % 15 === 0 && this.cameraInside() !== this.lastInside) {
        if (this.night > 0.25) this.placeNightLights(this.night)
        else this.lastInside = !this.lastInside
        // stepping out: the sky lights the view again at once (stepping in waits for the capture)
        if (!this.lastInside && this.probe?.active) {
          this.probe.active = false
          this.updateSkyEnvironment(this.night)
        }
      }
      this.renderFrame()
      this.onFrame?.()
      return
    }
    // still: once it has been still a moment, add samples until the picture is complete
    if (performance.now() - this.changedAt < 140) return
    // one sample in flight at a time: queuing samples faster than the GPU drew them made the next
    // camera move wait for the whole backlog (up to a second)
    if (!this.gpuIdle()) return
    const n = this.pipeline.samples
    // the first still sample replaces the moving frame (it adds AO and bloom on the lower presets)
    if (n === 1 && !this.stillStarted) {
      this.stillStarted = true
      this.refreshProbe()
      this.pipeline.reset()
    }
    this.renderSample(this.pipeline.samples)
    this.fenceGpu()
    if (this.pipeline.samples >= QUALITY[this.quality].samples) {
      this.refined = true
      this.stillStarted = false
    }
    this.onFrame?.()
  }
  private stillStarted = false
  private fence: WebGLSync | null = null
  /** Mark the end of the work just issued; gpuIdle() says when the GPU has done it. */
  private fenceGpu() {
    const gl = this.renderer.getContext() as WebGL2RenderingContext
    if (!gl.fenceSync) return
    if (this.fence) gl.deleteSync(this.fence)
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush()
  }
  private gpuIdle() {
    if (!this.fence) return true
    const gl = this.renderer.getContext() as WebGL2RenderingContext
    if (gl.getSyncParameter(this.fence, gl.SYNC_STATUS) !== gl.SIGNALED) return false
    gl.deleteSync(this.fence)
    this.fence = null
    return true
  }
  /** The shadow map was last drawn with the sun moved within its disc (redraw it exactly for moving frames). */
  private shadowJittered = false

  /** Draw the view as it is now, as a single moving-quality frame (the refinement follows). */
  renderFrame() {
    if (this.shadowJittered) {
      this.shadowJittered = false
      this.renderer.shadowMap.needsUpdate = true
    }
    this.pipeline.reset()
    this.stillStarted = false
    this.pipeline.render(this.scene, this.active, this.frameSettings(false))
  }

  /** One refinement sample: the camera shifted by a fraction of a pixel and the sun moved within its disc. */
  private renderSample(i: number) {
    const restore = this.jitterSun(i)
    this.pipeline.render(this.scene, this.active, this.frameSettings(true), i === 0 ? [0, 0] : jitterAt(i))
    restore()
  }

  /** Move the sun to a point of its disc for sample i (soft, area-light shadows); returns the undo. */
  private jitterSun(i: number) {
    if (i === 0 || !this.sun.visible) return () => {}
    const pos = this.sun.position.clone()
    const t = this.sun.target.position
    const d = pos.clone().sub(t)
    const len = d.length()
    const u = new THREE.Vector3(0, 1, 0).cross(d).normalize()
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0)
    const v = d.clone().cross(u).normalize()
    const [a, b] = discAt(i)
    this.shadowJittered = true
    this.renderer.shadowMap.needsUpdate = true
    this.sun.position.addScaledVector(u, a * SUN_DISC * len).addScaledVector(v, b * SUN_DISC * len)
    this.sun.updateMatrixWorld()
    return () => {
      this.sun.position.copy(pos)
      this.sun.updateMatrixWorld()
    }
  }

  /**
   * Render the current view (or a given camera pose) to an image. Rendering, capture and restoring
   * the camera all happen before this returns; only the encoding is asynchronous, so nothing that
   * moves the camera in the meantime (orbit spin, the user) is undone afterwards.
   */
  snapshot(opts: { width?: number; height?: number; type?: 'image/png' | 'image/jpeg'; quality?: number; pose?: { position: THREE.Vector3; target: THREE.Vector3; fov?: number }; supersample?: number; samples?: number } = {}): Promise<Blob> {
    const size = this.renderer.getSize(new THREE.Vector2())
    const w = opts.width ?? size.x
    const h = opts.height ?? size.y
    const prevPos = this.camera.position.clone()
    const prevTarget = this.controls.target.clone()
    const prevFov = this.camera.fov
    const prevAspect = this.camera.aspect
    const prevRatio = this.renderer.getPixelRatio()
    if (opts.pose) {
      this.camera.position.copy(opts.pose.position)
      this.camera.lookAt(opts.pose.target)
      if (opts.pose.fov) this.camera.fov = opts.pose.fov
    }
    // Without resizing the canvas (each resize reallocated the GPU buffers twice per picture): draw
    // the picture's view into a centred region of the canvas as it is, crop that region and scale
    // it down. Small pictures come out supersampled 2-4x. Too small a canvas for a big picture
    // falls back to resizing.
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    const as = w / h
    const cw = as > buf.x / buf.y ? buf.x : Math.floor(buf.y * as)
    const ch = as > buf.x / buf.y ? Math.floor(buf.x / as) : buf.y
    if (!opts.supersample && cw >= w * 1.2 && ch >= h * 1.2) {
      const ox = Math.floor((buf.x - cw) / 2)
      const oy = Math.floor((buf.y - ch) / 2)
      this.camera.aspect = as
      // the picture's frustum is the full view; the canvas shows it widened to its own shape
      this.camera.setViewOffset(cw, ch, -ox, -oy, buf.x, buf.y)
      this.camera.updateProjectionMatrix()
      if (opts.pose) this.placeNightLights(this.night)
      this.renderPicture(opts.samples)
      const blob = captureCanvas(this.canvas, w, h, opts.type ?? 'image/png', opts.quality ?? 0.92, { x: ox, y: oy, width: cw, height: ch })
      this.camera.clearViewOffset()
      this.camera.position.copy(prevPos)
      this.controls.target.copy(prevTarget)
      this.camera.fov = prevFov
      this.camera.aspect = prevAspect
      this.camera.updateProjectionMatrix()
      this.controls.update()
      if (opts.pose) this.placeNightLights(this.night)
      this.invalidate()
      return blob
    }
    // drawn larger and scaled down: clean edges on walls, railings and furniture (the post-processing
    // passes have no multisampling of their own)
    const ss = opts.supersample ?? (w * h <= 1_100_000 ? 2 : w * h <= 2_600_000 ? 1.5 : 1)
    const W = Math.round(w * ss)
    const H = Math.round(h * ss)
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(W, H, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.sizePost(W, H)
    if (opts.pose) this.placeNightLights(this.night)
    this.renderPicture(opts.samples)
    // the frame is taken now; scaling down and encoding happen off the main thread
    const blob = captureCanvas(this.canvas, w, h, opts.type ?? 'image/png', opts.quality ?? 0.92)
    this.camera.position.copy(prevPos)
    this.controls.target.copy(prevTarget)
    this.camera.fov = prevFov
    this.camera.aspect = prevAspect
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(prevRatio)
    this.resize()
    this.controls.update()
    if (opts.pose) this.placeNightLights(this.night)
    this.invalidate()
    return blob
  }

  /** A finished picture: the preset's number of refinement samples, drawn at once. */
  private renderPicture(samples = QUALITY[this.quality].pictureSamples) {
    this.refreshProbe()
    this.pipeline.reset()
    const n = Math.max(1, samples)
    for (let i = 0; i < n; i++) this.renderSample(i)
    this.refined = false
  }

  // ── texture uploads ───────────────────────────────────────────────────────
  /**
   * Textures waiting to go to the GPU. three.js uploads a texture the first time something using it
   * comes into view, so turning the camera towards new walls uploaded several large textures (and
   * their mipmaps) in one frame and froze the view for half a second. Uploading each as it arrives,
   * a little per frame, means it is already there when it is first seen.
   */
  private uploads = new Set<THREE.Texture>()
  private queueUpload(t: THREE.Texture) {
    if (this.uploads.has(t)) return
    this.uploads.add(t)
    t.addEventListener('dispose', () => this.uploads.delete(t))
  }
  private drainUploads() {
    if (!this.uploads.size) return
    // budget by data, not by time: the upload call returns at once and the GPU does the work
    // (copy plus mipmaps) later, so a time budget let several large textures land in one frame
    let bytes = 0
    for (const t of this.uploads) {
      const img = t.image as { width?: number; height?: number } | undefined
      const size = (img?.width ?? 256) * (img?.height ?? 256) * 4
      if (bytes && bytes + size > 4_300_000) break
      this.uploads.delete(t)
      this.renderer.initTexture(t)
      bytes += size
    }
  }

  // ── build reuse ───────────────────────────────────────────────────────────
  /** Builds recently taken off the scene, newest last; reused when the same state comes back. */
  private aside: { id: string; deps: unknown[]; build: { group: THREE.Object3D } }[] = []
  private putAside(id: string, e: { deps: unknown[]; build: { group: THREE.Object3D } }) {
    e.build.group.parent?.remove(e.build.group)
    this.aside.push({ id, deps: e.deps, build: e.build })
    // a few houses' worth (the design cards, the showcase, the house being edited)
    while (this.aside.length > 40) this.disposeObject(this.aside.shift()!.build.group)
  }
  private takeAside(id: string, deps: unknown[]) {
    const i = this.aside.findIndex((x) => x.id === id && sameDeps(x.deps, deps))
    return i < 0 ? null : this.aside.splice(i, 1)[0]
  }
  /** Throw away every build (new quality, new look, lost context). */
  private resetBuilds() {
    this.floors.clear()
    this.site = null
    this.roofDeps = []
    this.clearGroup(this.houseRoot)
    this.clearGroup(this.siteRoot)
    this.clearGroup(this.roofRoot)
    for (const x of this.aside.splice(0)) this.disposeObject(x.build.group)
    this.programsDirty = true
  }

  // ── shader compilation ────────────────────────────────────────────────────
  /** New meshes or materials were added since the last compile. */
  private programsDirty = true
  private compiling: Promise<void> | null = null
  /** Render paths compiled for since the scene last changed (see renderPath). */
  private compiledFor = new Set<string>()

  /** Whether the next frame goes through the post-processing passes or straight to the screen. */
  /**
   * Shaders differ by the target they draw into (to the screen they would include tone mapping and
   * sRGB output). Everything is drawn into the pipeline's HDR buffer now, so there is one path.
   */
  private renderPath() {
    return 'post'
  }
  /**
   * Compile the shaders for everything in the scene in the background (KHR_parallel_shader_compile)
   * before drawing it. Compiling while drawing used to block the app for seconds on the first frames
   * of each new house. Resolves when the scene can be drawn without compiling.
   */
  ready(): Promise<void> {
    if (this.compiling) return this.compiling
    const path = this.renderPath()
    if (this.programsDirty) this.compiledFor.clear()
    if (this.compiledFor.has(path)) return Promise.resolve()
    this.programsDirty = false
    this.compiledFor.add(path)
    // Programs are created against the target this path draws into; the GPU compiles them in the
    // background. A part of the scene at a time (each floor, the site, the roof, then the rest),
    // with a frame between parts: compiling everything at once kept the GPU from presenting any
    // frame for seconds, so the whole window looked frozen.
    const parts: THREE.Object3D[] = [...this.houseRoot.children, this.siteRoot, this.roofRoot, this.scene]
    const compileAll = async () => {
      for (const part of parts) {
        const prevTarget = this.renderer.getRenderTarget()
        this.renderer.setRenderTarget(this.pipeline.sceneRT)
        const materials = this.renderer.compile(part, this.active, this.scene)
        this.renderer.setRenderTarget(prevTarget)
        await this.programsReady(materials)
        await new Promise((r) => setTimeout(r, 16))
      }
    }
    const job: Promise<void> = Promise.all([compileAll(), this.pmremWarming ?? Promise.resolve(), this.warmPost()])
      .then(
        () => undefined,
        () => undefined
      )
      .finally(() => {
        if (this.compiling === job) this.compiling = null
        this.invalidate()
      })
    this.compiling = job
    return job
  }

  /**
   * Resolves once the GPU has finished every program. Asks about one unfinished program at a time
   * (each question is a round trip to the GPU process); three.js's own compileAsync asked about all
   * of them every 10 ms, which cost seconds of main-thread time while a house loaded.
   */
  private programsReady(materials: Set<THREE.Material>): Promise<void> {
    const props = this.renderer.properties as unknown as { get(m: THREE.Material): { currentProgram?: { isReady(): boolean; program?: WebGLProgram } } }
    const list = [...materials]
    return new Promise((resolve) => {
      const tick = () => {
        while (list.length) {
          const prog = props.get(list[0]).currentProgram
          // a program replaced meanwhile (its material changed) is gone: nothing to wait for
          if (prog && prog.program && !prog.isReady()) {
            setTimeout(tick, 30)
            return
          }
          list.shift()
        }
        resolve()
      }
      tick()
    })
  }

  // ── housekeeping ──────────────────────────────────────────────────────────
  private clearGroup(g: THREE.Object3D) {
    for (const c of [...g.children]) this.disposeObject(c)
  }

  private disposeObject(o: THREE.Object3D) {
    o.parent?.remove(o)
    o.traverse((x) => {
      const m = x as THREE.Mesh
      // shared shapes (plants) outlive any one build
      if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose()
    })
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    this.controls.dispose()
    this.mats.dispose()
    this.pipeline.dispose()
    this.renderer.dispose()
  }

  /** Floors ordered bottom→top with their current world Y (for walkthrough / drone). */
  floorLevels(): { floor: Floor; y: number }[] {
    const p = this.project
    if (!p) return []
    return sortedFloors(p.floors).map((f) => ({ floor: f, y: this.floorGroupY(f.id) }))
  }
}

/** Camera that frames the whole front facade from across the road. */
export function facadePose(p: Project, c: THREE.Vector3, aspect: number, fovDeg: number) {
  const ground = p.floors.find((f) => f.level === 0)
  const pts = ground?.rooms.flatMap((r) => r.polygon) ?? p.plot.polygon
  const hb = bbox(pts.length ? pts : p.plot.polygon)
  const floors = sortedFloors(p.floors).filter((f) => f.level >= 0)
  const H = floors.reduce((s, f) => s + f.height, 0) + p.settings.plinthHeight
  const frontY = hb.y + hb.h
  const half = (fovDeg * Math.PI) / 360
  const needV = (H * 1.25) / 2 / Math.tan(half)
  const needH = (Math.max(hb.w, p.plot.width) * 1.15) / 2 / Math.tan(half) / Math.max(0.6, aspect)
  const dist = Math.max(needV, needH, p.plot.depth - frontY + p.plot.roadWidth + 4)
  const eye = Math.min(H * 0.55, 3.4 + dist * 0.12)
  return {
    position: new THREE.Vector3(c.x + hb.w * 0.18, eye, frontY + dist),
    target: new THREE.Vector3(c.x, H * 0.45, frontY - hb.h * 0.25)
  }
}

/** Approximate colour of a light source at a colour temperature (K), 2000–7000. */
export function kelvinColor(k: number): string {
  const t = Math.max(1000, Math.min(12000, k)) / 100
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332)
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function sameDeps(a: unknown[], b: unknown[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function sameSurface(a: SurfaceRef | null, b: SurfaceRef): boolean {
  if (!a || a.kind !== b.kind) return false
  switch (b.kind) {
    case 'roomFloor':
    case 'roomCeiling':
      return (a as typeof b).roomId === b.roomId
    case 'wallSide': {
      const x = a as typeof b
      return x.wallId === b.wallId && x.side === b.side && (!b.roomId || x.roomId === b.roomId)
    }
    case 'exteriorWall':
      return !b.wallId || (a as typeof b).wallId === b.wallId
    case 'stair':
      return (a as typeof b).stairId === b.stairId
    case 'column':
      return (a as typeof b).columnId === b.columnId
    case 'furniture':
      return (a as typeof b).furnitureId === b.furnitureId
    case 'siteArea':
      return (a as typeof b).areaId === b.areaId
    default:
      return true
  }
}

function mergeGeos(geos: THREE.BufferGeometry[]) {
  const pos: number[] = []
  for (const g of geos) {
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i))
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return out
}

let engine: Engine | null = null
/** The shared engine (created lazily on first 3D view). */
export function getEngine(): Engine {
  if (!engine) engine = new Engine()
  return engine
}
export function hasEngine() {
  return !!engine
}
