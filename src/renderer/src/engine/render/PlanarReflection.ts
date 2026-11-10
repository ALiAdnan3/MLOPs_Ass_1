import * as THREE from 'three'

/**
 * Planar floor reflections (amendment A13). Polished marble and tile floors are the main mirrors
 * in these houses, and they are flat: the room mirrored in the floor's plane, rendered from a
 * mirrored camera, is exactly what such a floor reflects (screen-space reflections would smear
 * and lose whatever is off screen). Floor materials blend it in by their glossiness: crisp on
 * polished stone, blurred through the texture's mip levels on honed tile, none on matte finishes.
 *
 * One shader addition serves every house material: it only acts on upward-facing surfaces lying
 * in the reflection plane, so walls, furniture and tables are untouched and no material needs a
 * variant of its own.
 */

/** Shared by every house material's shader. */
export const planarUniforms = {
  planarMap: { value: null as THREE.Texture | null },
  planarMatrix: { value: new THREE.Matrix4() },
  planarY: { value: -1e6 },
  /** 0: off (low presets, outdoors, moving on High); 1: full. */
  planarStrength: { value: 0 }
}

/** A 1x1 stand-in bound while the reflection itself is drawn (a texture may not be read while it is being written). */
const DUMMY = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
  t.needsUpdate = true
  return t
})()

const VERT_DECL = 'varying vec3 vPlanarWorld;'
const VERT_MAIN = /* glsl */ `
  {
    vec4 pw4 = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      pw4 = instanceMatrix * pw4;
    #endif
    vPlanarWorld = ( modelMatrix * pw4 ).xyz;
  }`
const FRAG_DECL = /* glsl */ `
  varying vec3 vPlanarWorld;
  uniform sampler2D planarMap;
  uniform mat4 planarMatrix;
  uniform float planarY;
  uniform float planarStrength;`
const FRAG_MAIN = /* glsl */ `
  #if defined( RE_IndirectSpecular )
  if ( planarStrength > 0.0 ) {
    vec3 nW = inverseTransformDirection( normal, viewMatrix );
    if ( nW.y > 0.8 && abs( vPlanarWorld.y - planarY ) < 0.03 ) {
      vec4 rc = planarMatrix * vec4( vPlanarWorld, 1.0 );
      // the normal map's tilt ripples the reflection a little, as it does on real stone
      vec2 ruv = rc.xy / rc.w + nW.xz * 0.035;
      float edge = smoothstep( 0.0, 0.03, ruv.x ) * smoothstep( 1.0, 0.97, ruv.x ) * smoothstep( 0.0, 0.03, ruv.y ) * smoothstep( 1.0, 0.97, ruv.y );
      float rough = material.roughness;
      vec3 refl = textureLod( planarMap, ruv, clamp( rough * rough * 16.0, 0.0, 6.0 ) ).rgb;
      float w = planarStrength * edge * ( 1.0 - smoothstep( 0.3, 0.7, rough ) );
      radiance = mix( radiance, refl, w );
    }
  }
  #endif`

/** Give a house material the floor-reflection lookup (once; the program is shared by all of them). */
export function addPlanar(m: THREE.Material) {
  const s = m as THREE.MeshStandardMaterial
  if (!s.isMeshStandardMaterial || s.userData.planar) return
  s.userData.planar = true
  const prev = s.onBeforeCompile
  s.onBeforeCompile = (shader, r) => {
    prev?.call(s, shader, r)
    Object.assign(shader.uniforms, planarUniforms)
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERT_DECL}`).replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_DECL}`).replace('#include <lights_fragment_end>', `${FRAG_MAIN}\n#include <lights_fragment_end>`)
  }
  const key = s.customProgramCacheKey.bind(s)
  s.customProgramCacheKey = () => `${key()}|planar1`
}

/** Renders the mirrored view of a horizontal plane for the floors to reflect. */
export class PlanarReflection {
  readonly rt: THREE.WebGLRenderTarget
  private cam = new THREE.PerspectiveCamera()
  private w = 1
  private h = 1

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, samples: 0 })
  }

  /** Half the view's resolution: the reflection is softened by the floor anyway. */
  setSize(w: number, h: number) {
    const W = Math.max(1, Math.floor(w / 2))
    const H = Math.max(1, Math.floor(h / 2))
    if (W === this.w && H === this.h) return
    this.w = W
    this.h = H
    this.rt.setSize(W, H)
  }

  /** Draw the scene mirrored in the plane y = planeY, seen from `camera`, and point the floors at it. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, planeY: number) {
    const cam = this.cam
    camera.updateMatrixWorld()
    // mirrored position, view direction and up (from three.js's Reflector)
    const p = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)
    if (p.y <= planeY + 0.01) return false
    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld)
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(p)
    const mirror = (v: THREE.Vector3) => v.set(v.x, 2 * planeY - v.y, v.z)
    cam.position.copy(mirror(p.clone()))
    cam.up.set(0, 1, 0).applyMatrix4(rot)
    cam.up.y = -cam.up.y
    cam.lookAt(mirror(look))
    cam.near = camera.near
    cam.far = camera.far
    cam.updateMatrixWorld()
    cam.projectionMatrix.copy(camera.projectionMatrix)
    cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse)
    // world to reflection-texture coordinates (before the oblique clip below)
    planarUniforms.planarMatrix.value
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(cam.projectionMatrix)
      .multiply(cam.matrixWorldInverse)
    // oblique near plane: nothing below the floor is drawn into the reflection
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY).applyMatrix4(cam.matrixWorldInverse)
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
    const e = cam.projectionMatrix.elements
    const q = new THREE.Vector4((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14])
    clip.multiplyScalar(2 / clip.dot(q))
    e[2] = clip.x
    e[6] = clip.y
    e[10] = clip.z + 1 - 0.003
    e[14] = clip.w
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()

    const strength = planarUniforms.planarStrength.value
    planarUniforms.planarStrength.value = 0
    planarUniforms.planarMap.value = DUMMY
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(this.rt)
    renderer.clear()
    renderer.render(scene, cam)
    renderer.setRenderTarget(prev)
    planarUniforms.planarMap.value = this.rt.texture
    planarUniforms.planarStrength.value = strength
    planarUniforms.planarY.value = planeY
    return true
  }

  dispose() {
    this.rt.dispose()
  }
}
