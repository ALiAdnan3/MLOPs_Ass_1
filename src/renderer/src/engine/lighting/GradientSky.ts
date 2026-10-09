import * as THREE from 'three'

/**
 * Art-directed sky dome: zenith → horizon gradient with a sun disc and glow, coloured by time
 * of day (clear blue, golden hour, dusk, night). Unlike the physical Sky shader it is balanced
 * for the scene's exposure, so it reads as blue sky instead of a white haze, and the same dome
 * is baked into the environment map so reflections match.
 */
export class GradientSky extends THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  constructor(radius = 1500) {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        top: { value: new THREE.Color('#3f7fca') },
        horizon: { value: new THREE.Color('#cfe1ef') },
        ground: { value: new THREE.Color('#6b655b') },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color('#fff4dc') },
        glow: { value: 0.35 },
        disc: { value: 1 }
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
          vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 ground;
        uniform vec3 sunDir; uniform vec3 sunColor; uniform float glow; uniform float disc;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h >= 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, ground, pow(clamp(-h * 4.0, 0.0, 1.0), 0.6));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (pow(s, 8.0) * glow + pow(s, 64.0) * glow * 1.5);
          col += sunColor * smoothstep(0.9993, 0.9997, s) * disc;
          gl_FragColor = vec4(col, 1.0);
        }`
    })
    super(new THREE.SphereGeometry(radius, 32, 16), mat)
    this.frustumCulled = false
    this.renderOrder = -1
  }

  /**
   * @param sun direction to the sun (world)
   * @param warm 0 = high sun, 1 = sun on the horizon
   * @param night 0 = day, 1 = full night
   */
  update(sun: THREE.Vector3, warm: number, night: number) {
    const u = this.material.uniforms
    const day = { top: new THREE.Color('#3b7bd0'), horizon: new THREE.Color('#d3e5f2') }
    const gold = { top: new THREE.Color('#3a5a95'), horizon: new THREE.Color('#f2b27a') }
    const dusk = { top: new THREE.Color('#0b1630'), horizon: new THREE.Color('#2b3a5c') }
    const top = day.top.clone().lerp(gold.top, warm).lerp(dusk.top, night)
    const hor = day.horizon.clone().lerp(gold.horizon, warm).lerp(dusk.horizon, night)
    ;(u.top.value as THREE.Color).copy(top)
    ;(u.horizon.value as THREE.Color).copy(hor)
    ;(u.ground.value as THREE.Color).copy(new THREE.Color('#6b655b').lerp(new THREE.Color('#0c1018'), night))
    ;(u.sunDir.value as THREE.Vector3).copy(sun).normalize()
    ;(u.sunColor.value as THREE.Color).copy(new THREE.Color('#fff3da').lerp(new THREE.Color('#ffb46a'), warm))
    u.glow.value = (0.25 + warm * 0.55) * (1 - night)
    u.disc.value = sun.y > -0.02 ? 1 - night : 0
  }
}
