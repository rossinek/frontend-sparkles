import * as THREE from 'three'

// Tiny circular billboards move through a genuinely three-dimensional particle slab.
const DURATION = 2900
const GRID_SPACING = 5
const MAX_SURFACE_PARTICLES = 50000
const DEPTH_LAYERS = 3

const vertexShader = `
  attribute vec2 particleUV;
  attribute vec3 particleNoise;
  attribute float particleLayer;
  uniform float progress;
  uniform vec4 sourceRect;
  uniform vec4 targetRect;
  uniform vec2 viewport;
  uniform vec2 grid;
  uniform float dotSize;
  uniform vec2 cornerRadius;
  varying vec2 dotUV;

  float ease(float t) { return t * t * (3.0 - 2.0 * t); }
  float phase(float a, float b) { return clamp((progress - a) / (b - a), 0.0, 1.0); }

  void main() {
    // Each column rotates about its own horizontal axis. The right edge leads.
    float local = clamp((progress - 0.16 - (1.0 - particleUV.x) * 0.12) / 0.56, 0.0, 1.0);
    float turn = ease(local);
    // The edge winds back slightly, releases, overshoots 180 degrees and rebounds.
    float windup = ease(clamp(local / 0.16, 0.0, 1.0));
    float release = clamp((local - 0.16) / 0.84, 0.0, 1.0);
    float spring = -0.02 * windup;
    if (local > 0.16) {
      spring = 1.0 - 1.02 * exp(-7.5 * release)
        * (cos(9.5 * release) + (7.5 / 9.5) * sin(9.5 * release));
    }
    // Blend out the final tiny residual without an abrupt stop.
    spring = mix(spring, 1.0, ease(clamp((local - 0.9) / 0.1, 0.0, 1.0)));
    float angle = 3.14159265 * spring;
    float settle = ease(phase(0.86, 0.96));
    float spread = ease(phase(0.02, 0.17)) * (1.0 - ease(phase(0.85, 0.96)));

    float width = mix(sourceRect.z, targetRect.z, settle);
    // Heights change column by column while the surface is bending.
    float height = mix(sourceRect.w, targetRect.w, turn);
    vec2 center = mix(sourceRect.xy, targetRect.xy, settle);
    float radius = mix(cornerRadius.x, cornerRadius.y, turn);
    vec2 planePoint = (particleUV - 0.5) * vec2(width, height);
    vec2 q = abs(planePoint) - vec2(width, height) * 0.5 + radius;
    float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;

    float spacing = min(width / grid.x, height / grid.y);
    float size = dotSize;
    if (edge > -spacing * 0.25) size = 0.0;

    // Slight scatter stays local, preserving an evenly sampled rounded slab.
    vec3 point = vec3(planePoint.x, -planePoint.y, 0.0);
    point.xy += particleNoise.xy * spacing * 0.28 * spread;
    point.z = (particleLayer * 22.0 + particleNoise.z * 15.0) * spread;

    float c = cos(angle);
    float s = sin(angle);
    mat3 rotation = mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
    point = rotation * point;
    point.x += center.x - viewport.x * 0.5;
    point.y += viewport.y * 0.5 - center.y;
    dotUV = uv;
    vec4 viewPoint = modelViewMatrix * vec4(point, 1.0);
    // Billboards face the camera: depth comes from position, not faceted cube faces.
    viewPoint.xy += position.xy * size;
    gl_Position = projectionMatrix * viewPoint;
  }
`

const fragmentShader = `
  uniform float opacity;
  varying vec2 dotUV;
  void main() {
    float radius = length(dotUV - 0.5);
    float feather = max(fwidth(radius), 0.035);
    float coverage = 1.0 - smoothstep(0.5 - feather, 0.5, radius);
    if (coverage <= 0.0) discard;
    gl_FragColor = vec4(vec3(1.0), opacity * coverage);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function measure(card) {
  const rect = card.getBoundingClientRect()
  return {
    center: new THREE.Vector4(rect.left + rect.width / 2, rect.top + rect.height / 2, rect.width, rect.height),
    radius: parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0,
    rect,
  }
}

export class ParticleTransition {
  constructor(host) {
    this.host = host
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
    this.renderer.setClearColor(0x000000, 0)
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 20000)
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: {
        progress: { value: 0 },
        opacity: { value: 0 },
        sourceRect: { value: new THREE.Vector4() },
        targetRect: { value: new THREE.Vector4() },
        viewport: { value: new THREE.Vector2() },
        grid: { value: new THREE.Vector2() },
        dotSize: { value: 1.8 },
        cornerRadius: { value: new THREE.Vector2() },
      },
    })
    host.append(this.renderer.domElement)
    this.handleResize = () => this.stop()
    window.addEventListener('resize', this.handleResize)
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleResize)
  }

  prepare(card) {
    this.source = measure(card)
    this.clone?.remove()
    this.clone = card.cloneNode(true)
    this.clone.inert = true
    this.clone.setAttribute('aria-hidden', 'true')
    const { rect } = this.source
    Object.assign(this.clone.style, {
      position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, margin: '0',
      pointerEvents: 'none', transform: 'none',
    })
    this.host.prepend(this.clone)
    this.host.style.display = 'block'
    this.renderer.domElement.style.opacity = '1'
    this.renderer.clear()
  }

  createParticles(target) {
    this.mesh?.geometry.dispose()
    if (this.mesh) this.scene.remove(this.mesh)
    const width = Math.max(this.source.rect.width, target.rect.width)
    const height = Math.max(this.source.rect.height, target.rect.height)
    const spacing = Math.max(GRID_SPACING, Math.sqrt(width * height / MAX_SURFACE_PARTICLES))
    const columns = Math.ceil(width / spacing)
    const rows = Math.ceil(height / spacing)
    const count = columns * rows * DEPTH_LAYERS
    const uv = new Float32Array(count * 2)
    const noise = new Float32Array(count * 3)
    const layer = new Float32Array(count)
    let i = 0
    for (let z = 0; z < DEPTH_LAYERS; z++) {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++, i++) {
          uv[i * 2] = (x + 0.5) / columns
          uv[i * 2 + 1] = (y + 0.5) / rows
          noise[i * 3] = Math.random() * 2 - 1
          noise[i * 3 + 1] = Math.random() * 2 - 1
          noise[i * 3 + 2] = Math.random() * 2 - 1
          layer[i] = z - 1
        }
      }
    }
    const billboard = new THREE.PlaneGeometry(1, 1)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = billboard.index
    geometry.attributes.position = billboard.attributes.position
    geometry.attributes.uv = billboard.attributes.uv
    geometry.setAttribute('particleUV', new THREE.InstancedBufferAttribute(uv, 2))
    geometry.setAttribute('particleNoise', new THREE.InstancedBufferAttribute(noise, 3))
    geometry.setAttribute('particleLayer', new THREE.InstancedBufferAttribute(layer, 1))
    geometry.instanceCount = count
    billboard.dispose()
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
    const uniforms = this.material.uniforms
    uniforms.sourceRect.value.copy(this.source.center)
    uniforms.targetRect.value.copy(target.center)
    uniforms.cornerRadius.value.set(this.source.radius, target.radius)
    uniforms.grid.value.set(columns, rows)
    uniforms.viewport.value.set(innerWidth, innerHeight)
    this.renderer.setSize(innerWidth, innerHeight)
    this.camera.aspect = innerWidth / innerHeight
    this.camera.position.z = innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(17.5)))
    this.camera.updateProjectionMatrix()
  }

  play(card, reveal) {
    if (!card) { this.stop(); return Promise.resolve() }
    this.createParticles(measure(card))
    return new Promise(resolve => {
      this.resolve = resolve
      let start
      let revealed = false
      const frame = now => {
        start ??= now
        const t = Math.min((now - start) / DURATION, 1)
        this.material.uniforms.progress.value = t
        this.material.uniforms.opacity.value = Math.min(t / 0.06, 1)
        this.clone.style.opacity = String(1 - Math.min(t / 0.12, 1))
        if (t > 0.92 && !revealed) { revealed = true; reveal() }
        this.renderer.domElement.style.opacity = String(1 - Math.max((t - 0.92) / 0.08, 0))
        this.renderer.render(this.scene, this.camera)
        if (t < 1) this.raf = requestAnimationFrame(frame)
        else this.stop()
      }
      this.raf = requestAnimationFrame(frame)
    })
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.clone?.remove()
    this.host.style.display = 'none'
    this.resolve?.()
    this.resolve = null
  }

  dispose() {
    this.stop()
    window.removeEventListener('resize', this.handleResize)
    this.mesh?.geometry.dispose()
    this.material.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
