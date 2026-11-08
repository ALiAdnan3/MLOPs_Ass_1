import * as THREE from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js'

/**
 * The 3D view's render pipeline (amendment A13). Every frame goes:
 *
 *   scene → HDR buffer (with depth) → ambient occlusion → accumulation → bloom → tone mapping → FXAA → screen
 *
 * While the view moves, each frame is a single sample. Once it stops, the pipeline keeps drawing
 * the same view with the camera shifted by a fraction of a pixel (and the engine moves the sun
 * within its disc), averaging the samples. A few dozen samples give supersampled edges, soft
 * area-light shadows and noise-free ambient occlusion, so a still view looks far better than any
 * single frame could, at no cost while moving.
 *
 * Ambient occlusion reads the depth of the main render and works out surface directions from it,
 * so it sees exactly what is drawn (double-sided and clipped surfaces included). GTAO's own normal
 * pass skipped double-sided faces and darkened roofs and walls with blotches.
 */

export interface FrameSettings {
  /** Ambient occlusion on this frame. */
  ao: boolean
  /** Bloom strength (0: off). */
  bloom: number
  /** Edge smoothing for a single-sample frame (refined frames are supersampled instead). */
  fxaa: boolean
}

const AccumulateShader = {
  uniforms: { tNew: { value: null as THREE.Texture | null }, tPrev: { value: null as THREE.Texture | null }, weight: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tNew;
    uniform sampler2D tPrev;
    uniform float weight;
    varying vec2 vUv;
    void main() {
      vec4 n = texture2D(tNew, vUv);
      vec4 p = texture2D(tPrev, vUv);
      gl_FragColor = mix(p, n, weight);
    }`
}

const CopyShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: AccumulateShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`
}

function hdrTarget(w: number, h: number, depth: boolean) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: depth,
    // no multisampling: on ANGLE's Direct3D backend a multisampled half-float target stalls the
    // view for ~0.5 s every second (A10); refined frames are supersampled by the jitter instead
    samples: 0
  })
  if (depth) {
    rt.depthTexture = new THREE.DepthTexture(w, h)
    rt.depthTexture.type = THREE.UnsignedIntType
  }
  return rt
}

export class RenderPipeline {
  private renderer: THREE.WebGLRenderer
  private width = 1
  private height = 1
  readonly sceneRT: THREE.WebGLRenderTarget
  private aoRT: THREE.WebGLRenderTarget
  private accum: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]
  private display: THREE.WebGLRenderTarget
  private ldr: THREE.WebGLRenderTarget
  private gtao: GTAOPass
  private bloom: UnrealBloomPass
  private output = new OutputPass()
  private fxaa = new THREE.ShaderMaterial({ ...FXAAShader, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), depthTest: false, depthWrite: false })
  private accumulate = new THREE.ShaderMaterial({ ...AccumulateShader, uniforms: THREE.UniformsUtils.clone(AccumulateShader.uniforms), depthTest: false, depthWrite: false, blending: THREE.NoBlending })
  private copy = new THREE.ShaderMaterial({ ...CopyShader, uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), depthTest: false, depthWrite: false, blending: THREE.NoBlending })
  private quad = new FullScreenQuad()
  /** Samples averaged into the current picture (0: none yet). */
  samples = 0
  private noiseOffset = { value: new THREE.Vector2() }

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderer = renderer
    this.sceneRT = hdrTarget(1, 1, true)
    this.aoRT = hdrTarget(1, 1, false)
    this.accum = [hdrTarget(1, 1, false), hdrTarget(1, 1, false)]
    this.display = hdrTarget(1, 1, false)
    this.ldr = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false })
    this.gtao = new GTAOPass(scene, camera, 1, 1)
    // the main render's depth; surface directions are worked out from it (no normal pass)
    this.gtao.setGBuffer(this.sceneRT.depthTexture!)
    // tuned for rooms and facades in metres: half a metre of reach finds corners, skirting and
    // furniture feet without darkening whole walls
    this.gtao.updateGtaoMaterial({ radius: 1.0, distanceExponent: 1.6, thickness: 1.6, scale: 1.7, samples: 16, distanceFallOff: 1 })
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 })
    this.gtao.blendIntensity = 1
    // the AO noise pattern moves with each sample, so averaging samples smooths it out (it is
    // fixed to the screen otherwise and its grain stays in the refined picture)
    const gm = (this.gtao as unknown as { gtaoMaterial: THREE.ShaderMaterial }).gtaoMaterial
    gm.uniforms.noiseOffset = this.noiseOffset
    gm.fragmentShader = gm.fragmentShader
      .replace('uniform sampler2D tNoise;', 'uniform sampler2D tNoise; uniform vec2 noiseOffset;')
      .replace('vec2 noiseUv = vUv * resolution / noiseResolution;', 'vec2 noiseUv = (vUv * resolution + noiseOffset) / noiseResolution;')
    gm.needsUpdate = true
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.45, 0.92)
    this.output.renderToScreen = false
  }

  setSize(w: number, h: number) {
    w = Math.max(1, Math.floor(w))
    h = Math.max(1, Math.floor(h))
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.sceneRT.setSize(w, h)
    this.aoRT.setSize(w, h)
    for (const t of this.accum) t.setSize(w, h)
    this.display.setSize(w, h)
    this.ldr.setSize(w, h)
    this.gtao.setSize(w, h)
    this.bloom.setSize(w, h)
    ;(this.fxaa.uniforms.resolution.value as THREE.Vector2).set(1 / w, 1 / h)
    this.samples = 0
  }

  /** Let new samples outweigh the average so far (as if only `n` samples had been taken). */
  soften(n: number) {
    if (this.samples > n) this.samples = n
  }

  /** Start over: the next frame is the first sample of a new picture. */
  reset() {
    this.samples = 0
  }

  /**
   * Draw one sample and show the average so far. `jitter` shifts the camera by a fraction of a
   * pixel ([-0.5, 0.5] each way); 0 for a frame that is not part of a refinement.
   */
  render(scene: THREE.Scene, camera: THREE.Camera, s: FrameSettings, jitter: [number, number] = [0, 0]) {
    const r = this.renderer
    const cam = camera as THREE.PerspectiveCamera | THREE.OrthographicCamera
    const jittered = jitter[0] !== 0 || jitter[1] !== 0
    if (jittered) {
      // shift the projection by a sub-pixel amount (composes with any view offset already set)
      const e = cam.projectionMatrix.elements
      const dx = (2 * jitter[0]) / this.width
      const dy = (2 * jitter[1]) / this.height
      if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
        e[8] += dx
        e[9] += dy
      } else {
        e[12] += dx
        e[13] += dy
      }
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()
    }
    // 1. the scene, in linear HDR, with its depth
    r.setRenderTarget(this.sceneRT)
    r.render(scene, camera)
    let color: THREE.WebGLRenderTarget = this.sceneRT
    // 2. ambient occlusion from that depth (perspective views only)
    if (s.ao && (cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
      this.gtao.camera = cam
      this.noiseOffset.value.set(((this.samples * 7) % 16) * 1.0, ((this.samples * 11) % 16) * 1.0)
      this.gtao.render(r, this.aoRT, this.sceneRT, 0, false)
      color = this.aoRT
    }
    if (jittered) cam.updateProjectionMatrix()
    // 3. into the running average
    const prev = this.accum[0]
    const next = this.accum[1]
    if (this.samples === 0) {
      this.copy.uniforms.tDiffuse.value = color.texture
      this.pass(this.copy, next)
    } else {
      this.accumulate.uniforms.tNew.value = color.texture
      this.accumulate.uniforms.tPrev.value = prev.texture
      this.accumulate.uniforms.weight.value = 1 / (this.samples + 1)
      this.pass(this.accumulate, next)
    }
    this.accum = [next, prev]
    this.samples++
    // 4. bloom on a copy (the average itself stays clean for the next samples)
    let shown = next
    if (s.bloom > 0.001) {
      this.copy.uniforms.tDiffuse.value = next.texture
      this.pass(this.copy, this.display)
      this.bloom.strength = s.bloom
      this.bloom.render(r, null as unknown as THREE.WebGLRenderTarget, this.display, 0, false)
      shown = this.display
    }
    // 5. tone mapping and sRGB, then edge smoothing for single-sample frames
    const smooth = s.fxaa && this.samples === 1
    this.output.renderToScreen = !smooth
    this.output.render(r, this.ldr, shown, 0, false)
    if (smooth) {
      this.fxaa.uniforms.tDiffuse.value = this.ldr.texture
      this.pass(this.fxaa, null)
    }
    r.setRenderTarget(null)
  }

  private pass(m: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = m
    this.renderer.setRenderTarget(target)
    this.quad.render(this.renderer)
  }

  /**
   * Every shader the pipeline uses, created now against the target each draws into, so the GPU can
   * compile them in the background before the first frame needs them.
   */
  compileAll(): THREE.Material[] {
    const r = this.renderer
    const out: THREE.Material[] = []
    const prev = r.getRenderTarget()
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
    const add = (m: THREE.Material, target: THREE.WebGLRenderTarget | null) => {
      r.setRenderTarget(target)
      mesh.material = m
      for (const x of r.compile(mesh, cam)) out.push(x)
    }
    // OutputPass picks its defines on its first render; set them as it would, so they stay
    const o = this.output as unknown as { _outputColorSpace?: string; _toneMapping?: number; material: THREE.ShaderMaterial }
    if (o._outputColorSpace !== r.outputColorSpace || o._toneMapping !== r.toneMapping) {
      o._outputColorSpace = r.outputColorSpace
      o._toneMapping = r.toneMapping
      o.material.defines = {}
      if (THREE.ColorManagement.getTransfer(r.outputColorSpace) === THREE.SRGBTransfer) o.material.defines.SRGB_TRANSFER = ''
      const tm: Record<number, string> = { [THREE.LinearToneMapping]: 'LINEAR', [THREE.ReinhardToneMapping]: 'REINHARD', [THREE.CineonToneMapping]: 'CINEON', [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC', [THREE.AgXToneMapping]: 'AGX', [THREE.NeutralToneMapping]: 'NEUTRAL' }
      if (tm[r.toneMapping]) o.material.defines[`${tm[r.toneMapping]}_TONE_MAPPING`] = ''
      o.material.needsUpdate = true
    }
    add(o.material, null)
    add(o.material, this.ldr)
    add(this.fxaa, null)
    add(this.copy, this.accum[0])
    add(this.accumulate, this.accum[0])
    const g = this.gtao as unknown as Record<string, unknown>
    for (const k of ['gtaoMaterial', 'pdMaterial', 'blendMaterial', 'copyMaterial']) if (g[k] instanceof THREE.Material) add(g[k] as THREE.Material, this.aoRT)
    const b = this.bloom as unknown as Record<string, unknown>
    for (const v of Object.values(b)) {
      if (v instanceof THREE.Material) add(v, this.display)
      else if (Array.isArray(v)) for (const x of v) if (x instanceof THREE.Material) add(x, this.display)
    }
    r.setRenderTarget(prev)
    mesh.geometry.dispose()
    return out
  }

  dispose() {
    for (const t of [this.sceneRT, this.aoRT, ...this.accum, this.display, this.ldr]) t.dispose()
    this.gtao.dispose()
    this.bloom.dispose()
    this.output.dispose()
    this.fxaa.dispose()
    this.accumulate.dispose()
    this.copy.dispose()
    this.quad.dispose()
  }
}

/** Sub-pixel offsets for refinement samples (Halton 2,3), centred on 0. */
export function jitterAt(i: number): [number, number] {
  return [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]
}

/** A point on the unit disc for sample i (for soft shadows: the sun's position within its disc). */
export function discAt(i: number): [number, number] {
  const r = Math.sqrt(halton(i + 1, 5))
  const a = 2 * Math.PI * halton(i + 1, 7)
  return [r * Math.cos(a), r * Math.sin(a)]
}

function halton(i: number, b: number) {
  let f = 1
  let r = 0
  while (i > 0) {
    f /= b
    r += f * (i % b)
    i = Math.floor(i / b)
  }
  return r
}
