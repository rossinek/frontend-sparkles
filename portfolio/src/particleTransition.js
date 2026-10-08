import * as THREE from 'three'
import { toCanvas, getFontEmbedCSS } from 'html-to-image'

// Tiny circular billboards move through a genuinely three-dimensional particle slab.
const DURATION = 2100
const GRID_SPACING = 5 / Math.sqrt(2)
const MAX_SURFACE_PARTICLES = 100000
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
  uniform vec4 cellSize;
  uniform vec2 cornerRadius;
  varying vec2 dotUV;
  varying vec2 sourceUV;
  varying vec2 destinationUV;
  varying float separation;

  float ease(float t) { return t * t * (3.0 - 2.0 * t); }
  float phase(float a, float b) { return clamp((progress - a) / (b - a), 0.0, 1.0); }

  void main() {
    // Each column rotates about its own horizontal axis. The right edge leads.
    float local = clamp((progress - 0.04 - (1.0 - particleUV.x) * 0.12) / 0.84, 0.0, 1.0);
    float turn = ease(local);
    // The edge winds back slightly, releases, overshoots 180 degrees and rebounds.
    float windup = ease(clamp(local / 0.04, 0.0, 1.0));
    float release = clamp((local - 0.04) / 0.96, 0.0, 1.0);
    float spring = -0.02 * windup;
    if (local > 0.04) {
      spring = 1.0 - 1.02 * exp(-7.5 * release)
        * (cos(9.5 * release) + (7.5 / 9.5) * sin(9.5 * release));
    }
    // Blend out the final tiny residual without an abrupt stop.
    spring = mix(spring, 1.0, ease(clamp((local - 0.9) / 0.1, 0.0, 1.0)));
    float angle = 3.14159265 * spring;
    float settle = ease(phase(0.35, 0.91));
    float spread = ease(phase(0.0, 0.30)) * (1.0 - ease(phase(0.30, 0.88)));

    float width = mix(sourceRect.z, targetRect.z, settle);
    // Heights change column by column while the surface is bending.
    float height = mix(sourceRect.w, targetRect.w, turn);
    vec2 center = mix(sourceRect.xy, targetRect.xy, settle);
    float radius = mix(cornerRadius.x, cornerRadius.y, turn);
    vec2 planePoint = (particleUV - 0.5) * vec2(width, height);
    vec2 q = abs(planePoint) - vec2(width, height) * 0.5 + radius;
    float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;

    float spacing = min(width / grid.x, height / grid.y);
    vec2 size = mix(mix(cellSize.xy, cellSize.zw, settle) * 1.06, vec2(dotSize), spread);
    if (edge > -spacing * 0.25) size = vec2(0.0);

    // Slight scatter stays local, preserving an evenly sampled rounded slab.
    vec3 point = vec3(planePoint.x, -planePoint.y, 0.0);
    // Break up column alignment, retaining a tighter scatter around the silhouette.
    float interior = smoothstep(0.0, spacing * 3.0, -edge);
    point.x += particleNoise.x * spacing * mix(0.20, 0.95, interior) * spread;
    point.y += particleNoise.y * spacing * 0.28 * spread;
    point.z = (particleLayer * 36.0 + particleNoise.z * 24.0) * spread;

    float c = cos(angle);
    float s = sin(angle);
    mat3 rotation = mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
    point = rotation * point;
    point.x += center.x - viewport.x * 0.5;
    point.y += viewport.y * 0.5 - center.y;
    dotUV = uv;
    sourceUV = vec2(particleUV.x, 1.0 - particleUV.y) + (uv - 0.5) / grid;
    destinationUV = particleUV + (uv - 0.5) / grid;
    separation = spread;
    vec4 viewPoint = modelViewMatrix * vec4(point, 1.0);
    // Billboards face the camera: depth comes from position, not faceted cube faces.
    viewPoint.xy += position.xy * size;
    gl_Position = projectionMatrix * viewPoint;
  }
`

const fragmentShader = `
  uniform float opacity;
  uniform float progress;
  uniform sampler2D sourceTexture;
  uniform sampler2D destinationTexture;
  uniform vec3 cardBaseColor;
  varying vec2 dotUV;
  varying vec2 sourceUV;
  varying vec2 destinationUV;
  varying float separation;
  void main() {
    float radius = length(dotUV - 0.5);
    float coverage = 1.0;
    // Skip soft-dot calculations for the fully assembled, larger texture tiles.
    if (separation > 0.001) {
      float feather = max(fwidth(radius), 0.045);
      float core = 1.0 - smoothstep(0.37, 0.47, radius);
      float halo = exp(-radius * radius * 14.0) * 0.20;
      float edgeFade = 1.0 - smoothstep(0.5 - feather, 0.5, radius);
      float softDot = (core + halo * (1.0 - core)) * edgeFade;
      coverage = mix(1.0, softDot, separation);
    }
    if (coverage <= 0.0) discard;
    vec4 sourceColor = texture2D(sourceTexture, sourceUV);
    vec4 destinationColor = texture2D(destinationTexture, destinationUV);
    float depart = smoothstep(0.14, 0.46, progress);
    float arrive = smoothstep(0.22, 0.72, progress);
    // Transparent corner texels contain black RGB; composite them over the card.
    vec3 sourceRGB = mix(cardBaseColor, sourceColor.rgb, sourceColor.a);
    vec3 destinationRGB = mix(cardBaseColor, destinationColor.rgb, destinationColor.a);
    vec3 color = mix(sourceRGB, vec3(1.0), depart);
    color = mix(color, destinationRGB, arrive);
    gl_FragColor = vec4(color, opacity * coverage);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// A distant frontal light leaves a broad elliptical penumbra, not a card outline.
const shadowVertexShader = `
  varying vec2 shadowUV;
  void main() { shadowUV = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const shadowFragmentShader = `
  uniform float progress;
  uniform float opacity;
  uniform vec4 sourceRect;
  uniform vec4 targetRect;
  uniform vec2 viewport;
  varying vec2 shadowUV;
  void main() {
    float morph = smoothstep(0.35, 0.91, progress);
    vec4 card = mix(sourceRect, targetRect, morph);
    vec2 screenPoint = vec2(shadowUV.x, 1.0 - shadowUV.y) * viewport;
    float breath = 0.90 + 0.10 * sin(progress * 3.14159265);
    vec2 radius = card.zw * vec2(0.65, 0.68) * breath;
    vec2 p = (screenPoint - card.xy) / radius;
    float gaussian = exp(-2.8 * dot(p, p));
    float envelope = smoothstep(0.0, 0.25, progress)
      * (1.0 - smoothstep(0.60, 1.0, progress));
    gl_FragColor = vec4(0.0, 0.0, 0.0, gaussian * envelope * opacity * 0.24);
  }
`

const closeShadowVertexShader = vertexShader
  .replace('varying vec2 dotUV;', 'varying vec2 dotUV; varying vec2 silhouetteUV; varying vec3 silhouetteShape;')
  .replace('viewPoint.xy += position.xy * size;', `
    silhouetteUV = particleUV;
    silhouetteShape = vec3(width, height, radius);
    viewPoint.xy += vec2(0.0, -7.0);
    viewPoint.z -= 12.0;
  `)
const closeShadowFragmentShader = `
  uniform float opacity;
  uniform float progress;
  varying vec2 silhouetteUV;
  varying vec3 silhouetteShape;
  void main() {
    vec2 p = (silhouetteUV - 0.5) * silhouetteShape.xy;
    vec2 q = abs(p) - silhouetteShape.xy * 0.5 + silhouetteShape.z;
    float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - silhouetteShape.z;
    float softness = 1.0 - smoothstep(-85.0, 110.0, edge);
    float envelope = smoothstep(0.0, 0.16, progress) * (1.0 - smoothstep(0.82, 1.0, progress));
    gl_FragColor = vec4(0.0, 0.0, 0.0, softness * opacity * envelope * 0.055);
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
        dotSize: { value: 2.2 },
        cellSize: { value: new THREE.Vector4() },
        sourceTexture: { value: null },
        destinationTexture: { value: null },
        cardBaseColor: { value: new THREE.Color('#faf9f6') },
        cornerRadius: { value: new THREE.Vector2() },
      },
    })
    this.shadowMaterial = new THREE.ShaderMaterial({
      vertexShader: shadowVertexShader,
      fragmentShader: shadowFragmentShader,
      uniforms: this.material.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.shadowMaterial)
    this.shadow.frustumCulled = false
    this.shadow.renderOrder = -2
    this.scene.add(this.shadow)
    this.closeShadowMaterial = new THREE.ShaderMaterial({
      vertexShader: closeShadowVertexShader,
      fragmentShader: closeShadowFragmentShader,
      uniforms: this.material.uniforms,
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })
    const closeGeometry = new THREE.PlaneGeometry(1, 1, 100, 50)
    const count = closeGeometry.attributes.position.count
    const coordinates = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      coordinates[i * 2] = closeGeometry.attributes.uv.getX(i) * 1.40 - 0.20
      coordinates[i * 2 + 1] = closeGeometry.attributes.uv.getY(i) * 1.40 - 0.20
    }
    closeGeometry.setAttribute('particleUV', new THREE.BufferAttribute(coordinates, 2))
    closeGeometry.setAttribute('particleNoise', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    closeGeometry.setAttribute('particleLayer', new THREE.BufferAttribute(new Float32Array(count), 1))
    this.closeShadow = new THREE.Mesh(closeGeometry, this.closeShadowMaterial)
    this.closeShadow.frustumCulled = false
    this.closeShadow.renderOrder = -1
    this.scene.add(this.closeShadow)
    host.append(this.renderer.domElement)
    this.handleResize = () => this.stop()
    window.addEventListener('resize', this.handleResize)
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleResize)
  }

  async capture(card) {
    await document.fonts.ready
    this.fontCSS ??= await getFontEmbedCSS(card).catch(() => '')
    const canvas = await toCanvas(card, {
      pixelRatio: 1.5,
      fontEmbedCSS: this.fontCSS,
      backgroundColor: getComputedStyle(card).backgroundColor,
      style: { margin: '0', transform: 'none', boxShadow: 'none' },
    })
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  async prepare(card) {
    this.material.uniforms.sourceTexture.value?.dispose()
    this.material.uniforms.destinationTexture.value?.dispose()
    this.material.uniforms.destinationTexture.value = null
    this.material.uniforms.sourceTexture.value = await this.capture(card)
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
      zIndex: '1',
    })
    this.host.prepend(this.clone)
    this.host.style.display = 'block'
    this.blobSize = Math.hypot(innerWidth, innerHeight) * 1.20
    this.host.style.setProperty('--blob-size', `${this.blobSize}px`)
    const belowScreen = innerHeight + 24
    this.host.style.setProperty('--blob-first-y', `${belowScreen}px`)
    this.host.style.setProperty('--blob-second-y', `${belowScreen}px`)
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
    uniforms.cellSize.value.set(this.source.rect.width / columns, this.source.rect.height / rows,
      target.rect.width / columns, target.rect.height / rows)
    uniforms.viewport.value.set(innerWidth, innerHeight)
    this.renderer.setSize(innerWidth, innerHeight)
    this.camera.aspect = innerWidth / innerHeight
    this.cameraDistance = innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(17.5)))
    this.camera.position.set(0, 0, this.cameraDistance)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateProjectionMatrix()
  }

  async play(card, reveal) {
    if (!card) { this.stop(); return Promise.resolve() }
    // Match the destination project artwork, or the bio card on the home page.
    const colorCard = card.querySelector('.detail-art, .bio-card') ?? card
    const destinationColor = getComputedStyle(colorCard).backgroundColor
    this.host.style.setProperty('--blob-second-color', destinationColor)
    this.host.style.setProperty('--blob-first-color', `color-mix(in srgb, ${destinationColor} 65%, white)`)
    this.material.uniforms.destinationTexture.value = await this.capture(card)
    this.createParticles(measure(card))
    return new Promise(resolve => {
      this.resolve = resolve
      let start
      let revealed = false
      const frame = now => {
        start ??= now
        const t = Math.min((now - start) / DURATION, 1)
        const returnEnvelope = 1 - THREE.MathUtils.smoothstep(t, 0.55, 0.97)
        const pullback = THREE.MathUtils.smoothstep(t, 0.0, 0.18) * returnEnvelope
        const orbitReturn = THREE.MathUtils.clamp((t - 0.45) / 0.50, 0, 1)
        // Return the viewing angle first, with a small overshoot past the front.
        const springReturn = Math.exp(-5.2 * orbitReturn)
          * (Math.cos(8.5 * orbitReturn) + (5.2 / 8.5) * Math.sin(8.5 * orbitReturn))
        const orbit = THREE.MathUtils.smoothstep(t, 0.10, 0.38) * springReturn
          * (1 - THREE.MathUtils.smoothstep(t, 0.88, 0.97))
        const orbitAngle = THREE.MathUtils.degToRad(30) * orbit
        const elevationAngle = THREE.MathUtils.degToRad(10) * orbit
        const morph = THREE.MathUtils.smoothstep(t, 0.35, 0.91)
        const sourceCenter = this.material.uniforms.sourceRect.value
        const targetCenter = this.material.uniforms.targetRect.value
        const pivotX = THREE.MathUtils.lerp(sourceCenter.x, targetCenter.x, morph) - innerWidth / 2
        const pivotY = innerHeight / 2 - THREE.MathUtils.lerp(sourceCenter.y, targetCenter.y, morph)
        const distance = this.cameraDistance * (1 + 0.09 * pullback)
        const elevatedY = -pivotY * Math.cos(elevationAngle) + distance * Math.sin(elevationAngle)
        const elevatedZ = pivotY * Math.sin(elevationAngle) + distance * Math.cos(elevationAngle)
        this.camera.position.set(pivotX * (1 - Math.cos(orbitAngle)) - elevatedZ * Math.sin(orbitAngle),
          pivotY + elevatedY, elevatedZ * Math.cos(orbitAngle) - pivotX * Math.sin(orbitAngle))
        // Orbit the card's center while retaining the original off-center framing.
        this.camera.rotation.set(-elevationAngle, -orbitAngle, 0, 'YXZ')
        const startY = innerHeight + 24
        const blobRadius = this.blobSize / 2
        // Stop just beyond full coverage so easing remains visible at the edge.
        const coveredY = Math.sqrt(blobRadius * blobRadius - (innerWidth / 2) ** 2) - blobRadius - 18
        const exitY = -this.blobSize - 24
        const blobY = (enterStart, enterEnd, exitStart, exitEnd) => {
          // Fast entry decelerates as the circle covers the viewport.
          const entryTime = THREE.MathUtils.clamp((t - enterStart) / (enterEnd - enterStart), 0, 1)
          const entry = 1 - Math.pow(1 - entryTime, 3)
          const entryY = THREE.MathUtils.lerp(startY, coveredY, entry)
          // Leave gently, then accelerate off the top in reverse layer order.
          const exitTime = THREE.MathUtils.clamp((t - exitStart) / (exitEnd - exitStart), 0, 1)
          const exit = exitTime * exitTime
          return entryY + (exitY - coveredY) * exit
        }
        this.host.style.setProperty('--blob-first-y', `${blobY(0.0, 0.50, 0.72, 1.0)}px`)
        this.host.style.setProperty('--blob-second-y', `${blobY(0.14, 0.57, 0.63, 0.89)}px`)
        this.material.uniforms.progress.value = t
        this.material.uniforms.opacity.value = Math.min(t / 0.06, 1)
        this.clone.style.opacity = String(1 - Math.min(t / 0.07, 1))
        if (t > 0.99 && !revealed) { revealed = true; reveal() }
        this.renderer.domElement.style.opacity = String(1 - Math.max((t - 0.99) / 0.01, 0))
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
    this.host.style.removeProperty('--blob-first-y')
    this.host.style.removeProperty('--blob-second-y')
    this.resolve?.()
    this.resolve = null
  }

  dispose() {
    this.stop()
    window.removeEventListener('resize', this.handleResize)
    this.mesh?.geometry.dispose()
    this.shadow.geometry.dispose()
    this.shadowMaterial.dispose()
    this.closeShadow.geometry.dispose()
    this.closeShadowMaterial.dispose()
    this.material.uniforms.sourceTexture.value?.dispose()
    this.material.uniforms.destinationTexture.value?.dispose()
    this.material.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
