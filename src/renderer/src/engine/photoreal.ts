import * as THREE from 'three'
import { WebGLPathTracer } from 'three-gpu-pathtracer'
import type { Engine } from './Engine'
import { GradientSky } from './lighting/GradientSky'

/**
 * PHOTOREAL RENDER (amendment A6). A path-traced still of the current 3D view: soft shadows, light
 * bouncing between surfaces, real reflections and glass. It traces the same model the app shows,
 * so it can never invent a different house. Runs progressively on the GPU; the live view is held
 * meanwhile and restored afterwards.
 */

/**
 * The path tracer needs float render targets and texture arrays that ANGLE's Direct3D backend
 * mishandles (surfaces come back black), so on Direct3D the app offers to switch to OpenGL.
 */
export function photorealSupport(e: Engine): { ok: boolean; backend: string } {
  const gl = e.renderer.getContext()
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
  const d3d = /direct3d|d3d1/i.test(name)
  return { ok: !d3d && !!gl.getExtension('EXT_color_buffer_float'), backend: name }
}

export interface PhotorealOptions {
  width: number
  height: number
  /** Samples per pixel: more is cleaner and slower. */
  samples: number
  bounces?: number
  /** Multiplies the sun (the live view's sun is tuned for rasterising, not path tracing). */
  sunScale?: number
  envScale?: number
  exposure?: number
  /** Clay render: every surface plain white, for reading form and light. */
  clay?: boolean
  type?: 'image/png' | 'image/jpeg'
  onProgress?: (samples: number, total: number) => void
  signal?: AbortSignal
}

/**
 * The live view draws some faces in both windings with one normal. A tracer decides front and back
 * from the winding, so the reversed copies read as back faces and render black. Turn every
 * triangle to agree with its normals (the duplicates then coincide harmlessly).
 */
function agreeWinding(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const P = src.attributes.position as THREE.BufferAttribute | undefined
  const N = src.attributes.normal as THREE.BufferAttribute | undefined
  if (!P || !N) return src
  const I = src.index
  const tris = (I ? I.count : P.count) / 3
  const vi = (t: number, k: number) => (I ? I.getX(3 * t + k) : 3 * t + k)
  const reversed: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  for (let t = 0; t < tris; t++) {
    const i0 = vi(t, 0)
    const i1 = vi(t, 1)
    const i2 = vi(t, 2)
    a.fromBufferAttribute(P, i0)
    b.fromBufferAttribute(P, i1).sub(a)
    c.fromBufferAttribute(P, i2).sub(a)
    b.cross(c)
    n.set(N.getX(i0) + N.getX(i1) + N.getX(i2), N.getY(i0) + N.getY(i1) + N.getY(i2), N.getZ(i0) + N.getZ(i1) + N.getZ(i2))
    if (b.dot(n) < 0) reversed.push(t)
  }
  if (!reversed.length) return src
  const g = src.clone()
  if (g.index) {
    const arr = g.index.array
    for (const t of reversed) {
      const x = arr[3 * t + 1]
      arr[3 * t + 1] = arr[3 * t + 2]
      arr[3 * t + 2] = x
    }
    g.index.needsUpdate = true
  } else {
    for (const attr of Object.values(g.attributes) as THREE.BufferAttribute[]) {
      const w = attr.itemSize
      const arr = attr.array
      for (const t of reversed)
        for (let k = 0; k < w; k++) {
          const x = arr[(3 * t + 1) * w + k]
          arr[(3 * t + 1) * w + k] = arr[(3 * t + 2) * w + k]
          arr[(3 * t + 2) * w + k] = x
        }
      attr.needsUpdate = true
    }
  }
  return g
}

const CLAY = new THREE.MeshStandardMaterial({ color: '#d8d8d8', roughness: 0.9 })

/** A scene of plain meshes the tracer understands: instanced meshes are expanded, the sky dome and helpers left out. */
function traceScene(e: Engine, sunScale: number, clay = false) {
  const scene = new THREE.Scene()
  const owned: THREE.Material[] = []
  // normal maps need tangents the generated geometry does not carry; without them the tracer
  // tilts normals inwards and walls go black, so traced copies drop them (the GI carries the depth)
  const plain = new Map<THREE.Material, THREE.Material>()
  const flat = (m: THREE.Material): THREE.Material => {
    const sm = m as THREE.MeshStandardMaterial
    if (!sm.normalMap && !sm.bumpMap) return m
    let c = plain.get(m)
    if (!c) {
      c = sm.clone()
      ;(c as THREE.MeshStandardMaterial).normalMap = null
      ;(c as THREE.MeshStandardMaterial).bumpMap = null
      plain.set(m, c)
      owned.push(c)
    }
    return c
  }
  const fixed = new Map<THREE.BufferGeometry, THREE.BufferGeometry>()
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], world: THREE.Matrix4) => {
    let g = fixed.get(geometry)
    if (!g) {
      g = agreeWinding(geometry)
      fixed.set(geometry, g)
    }
    geometry = g
    // clay keeps glass so windows still read as windows
    const clayOf = (x: THREE.Material) => (x.transparent || (x as THREE.MeshPhysicalMaterial).transmission > 0 ? x : CLAY)
    const m = new THREE.Mesh(geometry, clay ? (Array.isArray(material) ? material.map(clayOf) : clayOf(material)) : Array.isArray(material) ? material.map(flat) : flat(material))
    m.matrixAutoUpdate = false
    m.matrix.copy(world)
    scene.add(m)
  }
  e.scene.updateMatrixWorld(true)
  e.scene.traverseVisible((o) => {
    if (o === e.sky) return
    if ((o as THREE.InstancedMesh).isInstancedMesh) {
      const im = o as THREE.InstancedMesh
      const local = new THREE.Matrix4()
      const tint = new Map<string, THREE.Material>()
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, local)
        let mat: THREE.Material | THREE.Material[] = im.material
        if (im.instanceColor && !Array.isArray(im.material) && 'color' in im.material) {
          const c = new THREE.Color()
          im.getColorAt(i, c)
          const key = c.getHexString()
          if (!tint.has(key)) {
            const m = (im.material as THREE.MeshStandardMaterial).clone()
            m.color.multiply(c)
            tint.set(key, m)
            owned.push(m)
          }
          mat = tint.get(key)!
        }
        add(im.geometry, mat, new THREE.Matrix4().multiplyMatrices(im.matrixWorld, local))
      }
      return
    }
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      // the tracer needs physically based surfaces; overlays (selection, helpers) are skipped
      if (mats.some((m) => (m as THREE.ShaderMaterial).isShaderMaterial)) return
      add(mesh.geometry, mesh.material, mesh.matrixWorld)
      return
    }
    const light = o as THREE.Light
    if (!light.isLight || light.intensity <= 0) return
    const pos = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)
    if ((o as THREE.DirectionalLight).isDirectionalLight) {
      const d = o as THREE.DirectionalLight
      const l = new THREE.DirectionalLight(d.color, d.intensity * sunScale)
      l.position.copy(pos)
      l.target.position.setFromMatrixPosition(d.target.matrixWorld)
      scene.add(l, l.target)
    } else if ((o as THREE.SpotLight).isSpotLight) {
      const s = o as THREE.SpotLight
      const l = new THREE.SpotLight(s.color, s.intensity, s.distance, s.angle, s.penumbra, s.decay)
      l.position.copy(pos)
      l.target.position.setFromMatrixPosition(s.target.matrixWorld)
      scene.add(l, l.target)
    } else if ((o as THREE.PointLight).isPointLight) {
      const p = o as THREE.PointLight
      const l = new THREE.PointLight(p.color, p.intensity, p.distance, p.decay)
      l.position.copy(pos)
      scene.add(l)
    }
  })
  scene.updateMatrixWorld(true)
  return {
    scene,
    dispose: () => {
      owned.forEach((m) => m.dispose())
      for (const [src, g] of fixed) if (g !== src) g.dispose()
    }
  }
}

/**
 * The sky as an equirectangular float texture (what the tracer samples for light): the sky cube's
 * six faces are read back and resampled on the CPU.
 */
function skyEquirect(r: THREE.WebGLRenderer, sp: ReturnType<Engine['skyParams']>, size = 128) {
  const skyScene = new THREE.Scene()
  const sky = new GradientSky(50)
  sky.update(sp.sunDir, sp.warm, sp.night)
  skyScene.add(sky)
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.FloatType })
  new THREE.CubeCamera(0.1, 200, rt).update(r, skyScene)
  const faces: Float32Array[] = []
  for (let f = 0; f < 6; f++) {
    const buf = new Float32Array(size * size * 4)
    r.readRenderTargetPixels(rt, 0, 0, size, size, buf, f)
    faces.push(buf)
  }
  rt.dispose()
  sky.geometry.dispose()
  sky.material.dispose()
  const W = size * 4
  const H = size * 2
  const out = new Float32Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    // row 0 of the texture is the bottom (v = 0, straight down)
    const lat = ((y + 0.5) / H - 0.5) * Math.PI
    const dy = Math.sin(lat)
    const c = Math.cos(lat)
    for (let x = 0; x < W; x++) {
      // three.js equirect: u = atan2(z, x) / 2π + 0.5
      const lon = ((x + 0.5) / W - 0.5) * Math.PI * 2
      const dx = Math.cos(lon) * c
      const dz = Math.sin(lon) * c
      const ax = Math.abs(dx)
      const ay = Math.abs(dy)
      const az = Math.abs(dz)
      let f: number
      let u: number
      let v: number
      // cube camera faces +x, -x, +y, -y, +z, -z; u right, v down within each face
      if (ax >= ay && ax >= az) {
        f = dx > 0 ? 0 : 1
        u = dx > 0 ? -dz / ax : dz / ax
        v = -dy / ax
      } else if (ay >= az) {
        f = dy > 0 ? 2 : 3
        u = dx / ay
        v = dy > 0 ? dz / ay : -dz / ay
      } else {
        f = dz > 0 ? 4 : 5
        u = dz > 0 ? dx / az : -dx / az
        v = -dy / az
      }
      // render-target rows run bottom-up
      const px = Math.min(size - 1, Math.max(0, Math.floor(((u + 1) / 2) * size)))
      const py = Math.min(size - 1, Math.max(0, Math.floor(((1 - v) / 2) * size)))
      const i = (py * size + px) * 4
      const o = (y * W + x) * 4
      out[o] = faces[f][i]
      out[o + 1] = faces[f][i + 1]
      out[o + 2] = faces[f][i + 2]
      out[o + 3] = 1
    }
  }
  const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.FloatType)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.LinearSRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

/** ACES filmic as three.js applies it, then sRGB: the same look as the live view. */
function toneMap(lin: Float32Array, w: number, h: number, exposure: number): ImageData {
  const img = new ImageData(w, h)
  const d = img.data
  const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081)
  const srgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)
  const k = exposure / 0.6
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((h - 1 - y) * w + x) * 4 // render targets read bottom-up
      const a = lin[i + 3] > 0 ? 1 : 1
      const r = (lin[i] / a) * k
      const g = (lin[i + 1] / a) * k
      const b = (lin[i + 2] / a) * k
      // ACES input matrix, RRT + ODT fit, output matrix
      const ri = 0.59719 * r + 0.35458 * g + 0.04823 * b
      const gi = 0.076 * r + 0.90834 * g + 0.01566 * b
      const bi = 0.0284 * r + 0.13383 * g + 0.83777 * b
      const rf = fit(ri)
      const gf = fit(gi)
      const bf = fit(bi)
      const ro = 1.60475 * rf - 0.53108 * gf - 0.07367 * bf
      const go = -0.10208 * rf + 1.10813 * gf - 0.00605 * bf
      const bo = -0.00327 * rf - 0.07276 * gf + 1.07602 * bf
      const o = (y * w + x) * 4
      d[o] = Math.round(255 * srgb(Math.min(1, Math.max(0, ro))))
      d[o + 1] = Math.round(255 * srgb(Math.min(1, Math.max(0, go))))
      d[o + 2] = Math.round(255 * srgb(Math.min(1, Math.max(0, bo))))
      d[o + 3] = 255
    }
  return img
}

/** The tracer's accumulated result, as linear floats. */
function readTarget(r: THREE.WebGLRenderer, t: THREE.WebGLRenderTarget): Float32Array {
  const { width: w, height: h } = t
  if (t.texture.type === THREE.HalfFloatType) {
    const half = new Uint16Array(w * h * 4)
    r.readRenderTargetPixels(t, 0, 0, w, h, half)
    const out = new Float32Array(half.length)
    for (let i = 0; i < half.length; i++) out[i] = THREE.DataUtils.fromHalfFloat(half[i])
    return out
  }
  const out = new Float32Array(w * h * 4)
  r.readRenderTargetPixels(t, 0, 0, w, h, out)
  return out
}

export async function renderPhotoreal(e: Engine, o: PhotorealOptions): Promise<Blob> {
  const r = e.renderer
  const prevRatio = r.getPixelRatio()
  const prevAspect = e.camera.aspect
  const prevExposure = r.toneMappingExposure
  e.holds++
  // everything from here is undone in `finally`, whatever fails
  let env: THREE.DataTexture | null = null
  let dispose: () => void = () => undefined
  let pt: WebGLPathTracer | null = null
  try {
    e.highlight(null, 'select')
    e.highlight(null, 'hover')
    // the sky lights the scene and fills the background: the same gradient the live view uses
    const sp = e.skyParams()
    env = skyEquirect(r, sp)
    const built = traceScene(e, o.sunScale ?? 1, o.clay)
    dispose = built.dispose
    const scene = built.scene
    scene.environment = env
    scene.background = env
    scene.environmentIntensity = (0.35 + (1 - sp.night) * 0.65) * (o.envScale ?? 1)
    if (o.exposure !== undefined) r.toneMappingExposure = o.exposure
    pt = new WebGLPathTracer(r)
    r.setPixelRatio(1)
    r.setSize(o.width, o.height, false)
    e.camera.aspect = o.width / o.height
    e.camera.updateProjectionMatrix()
    // read the float result directly: independent of canvas blending support on this GPU
    pt.renderToCanvas = false
    pt.rasterizeScene = false
    pt.synchronizeRenderSize = true
    pt.dynamicLowRes = false
    pt.renderScale = 1
    pt.minSamples = 0
    pt.renderDelay = 0
    pt.fadeDuration = 0
    pt.bounces = o.bounces ?? 6
    pt.transmissiveBounces = 6
    pt.filterGlossyFactor = 0.4
    pt.multipleImportanceSampling = true
    pt.tiles.set(o.width * o.height > 2.5e6 ? 3 : 2, o.width * o.height > 2.5e6 ? 3 : 2)
    // one BVH build per render; synchronous is fine for a still
    pt.setScene(scene, e.camera)
    let t = performance.now()
    while (pt.samples < o.samples) {
      if (o.signal?.aborted) throw new DOMException('Render cancelled', 'AbortError')
      pt.renderSample()
      if (performance.now() - t > 40) {
        o.onProgress?.(Math.floor(pt.samples), o.samples)
        await new Promise((res) => requestAnimationFrame(() => res(null)))
        t = performance.now()
      }
    }
    o.onProgress?.(o.samples, o.samples)
    const lin = readTarget(r, pt.target)
    const c = document.createElement('canvas')
    c.width = pt.target.width
    c.height = pt.target.height
    c.getContext('2d')!.putImageData(toneMap(lin, c.width, c.height, r.toneMappingExposure), 0, 0)
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('The render could not be saved'))), o.type ?? 'image/png', 0.95))
  } finally {
    pt?.dispose()
    env?.dispose()
    dispose()
    r.toneMappingExposure = prevExposure
    r.setPixelRatio(prevRatio)
    e.camera.aspect = prevAspect
    e.camera.updateProjectionMatrix()
    e.resize()
    e.holds--
    e.invalidate()
  }
}

