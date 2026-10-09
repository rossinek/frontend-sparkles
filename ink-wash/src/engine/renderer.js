import { VERTEX, LUMA, BLUR, SKETCH, PROBE, HATCH, COMPOSITE } from './shaders.js'
import { buildFields } from './fields.js'
import { buildGuides, GUIDE_SIZE } from './guides.js'

export const WORK_SIZE = 1600
const FIELD_SIZE = 512

// Seconds. Each front is [start, duration, easing exponent]: paper opens slowly and then
// bursts, the first wash surges in behind it, and the darks arrive last. The remaining time
// lets the slowest pixels settle.
export const TIMELINE = {
  paper: [0.3, 1.3, 1.7],
  ink: [0.85, 2.2, 2.0],
  accent: [1.55, 2.6, 2.4],
  duration: 4.7,
}

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
  return shader
}

function createProgram(gl, vertex, fragmentSource) {
  const program = gl.createProgram()
  gl.attachShader(program, vertex)
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
  const uniforms = {}
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
  for (let i = 0; i < count; i++) {
    const { name } = gl.getActiveUniform(program, i)
    uniforms[name] = gl.getUniformLocation(program, name)
  }
  return { program, uniforms }
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
  if (!gl) throw new Error('WebGL2 is not available')
  const floatTargets = !!gl.getExtension('EXT_color_buffer_float')
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
  const programs = {
    luma: createProgram(gl, vertex, LUMA),
    blur: createProgram(gl, vertex, BLUR),
    sketch: createProgram(gl, vertex, SKETCH),
    probe: createProgram(gl, vertex, PROBE),
    hatch: createProgram(gl, vertex, HATCH),
    composite: createProgram(gl, vertex, COMPOSITE),
  }
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

  const state = { width: 0, height: 0, source: null, ready: false, tint: 0, seed: 1, levels: [0, 1], hatching: 0.5, focus: 1, lines: 'sketch', sketchOnly: false }
  const textures = {}
  const targets = {}

  function texture(name, { mipmaps = false } = {}) {
    const tex = textures[name] || (textures[name] = gl.createTexture())
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
    return tex
  }

  function upload(name, source) {
    texture(name, { mipmaps: true })
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.generateMipmap(gl.TEXTURE_2D)
  }

  function target(name, width, height, { float = false, mipmaps = false } = {}) {
    const tex = texture(name, { mipmaps })
    const useFloat = float && floatTargets
    gl.texImage2D(gl.TEXTURE_2D, 0, useFloat ? gl.RGBA16F : gl.RGBA8, width, height, 0, gl.RGBA, useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null)
    const fbo = targets[name]?.fbo || gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    targets[name] = { fbo, width, height }
  }

  function draw({ program, uniforms }, into, inputs, values = {}) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, into ? targets[into].fbo : null)
    gl.viewport(0, 0, into ? targets[into].width : canvas.width, into ? targets[into].height : canvas.height)
    gl.useProgram(program)
    Object.entries(inputs).forEach(([uniform, name], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, textures[name])
      gl.uniform1i(uniforms[uniform], unit)
    })
    for (const [uniform, value] of Object.entries(values)) {
      if (uniforms[uniform] == null) continue
      if (Array.isArray(value) && value.length === 3) gl.uniform3f(uniforms[uniform], value[0], value[1], value[2])
      else if (Array.isArray(value)) gl.uniform2f(uniforms[uniform], value[0], value[1])
      else gl.uniform1f(uniforms[uniform], value)
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  function blur(from, into, sigma) {
    const { width, height } = state
    draw(programs.blur, 'scratch', { uSource: from }, { uStep: [1 / width, 0], uSigma: sigma })
    draw(programs.blur, into, { uSource: 'scratch' }, { uStep: [0, 1 / height], uSigma: sigma })
  }

  /** @param {HTMLCanvasElement | OffscreenCanvas} source photo already scaled to the working size */
  function setImage(source) {
    state.width = source.width
    state.height = source.height
    state.source = source
    state.ready = false
    upload('photo', source)
  }

  // A greyscale model output as a canvas, so it uploads and flips like the photo does.
  function asCanvas({ width, height, data }) {
    const surface = document.createElement('canvas')
    surface.width = width
    surface.height = height
    const context = surface.getContext('2d')
    const image = context.createImageData(width, height)
    for (let i = 0; i < data.length; i++) {
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = data[i]
      image.data[i * 4 + 3] = 255
    }
    context.putImageData(image, 0, 0)
    return surface
  }

  function floatTexture(name, width, height, data) {
    texture(name)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, data)
  }

  /**
   * @param {{ matte: object, line?: object, depth?: object, attention?: object }} maps model
   *   outputs as { width, height, data: Uint8 }. Only the matte is required: without the
   *   line map the edge-detection lines are used, without depth the strokes keep one slant,
   *   and without attention the whole subject is hatched from tone alone.
   */
  function prepare(maps, seed) {
    const { width, height } = state
    const scale = Math.max(width, height) / 1000
    upload('matte', asCanvas(maps.matte))
    for (const name of ['luma', 'scratch', 'fine', 'mid', 'coarse']) target(name, width, height, { float: true })
    target('sketch', width, height, { mipmaps: true })
    target('pencil', width, height)
    draw(programs.luma, 'luma', { uSource: 'photo' })
    blur('luma', 'fine', 0.9 * scale)
    blur('luma', 'mid', 1.7 * scale)
    blur('luma', 'coarse', 4.5 * scale)
    draw(programs.sketch, 'sketch', { uFine: 'fine', uMid: 'mid', uCoarse: 'coarse', uMatte: 'matte' }, { uTexel: [1 / width, 1 / height], uDetail: 0.5 })
    gl.bindTexture(gl.TEXTURE_2D, textures.sketch)
    gl.generateMipmap(gl.TEXTURE_2D)

    state.lines = maps.line ? 'line' : 'sketch'
    if (maps.line) upload('line', asCanvas(maps.line))
    const ratio = GUIDE_SIZE / Math.max(width, height)
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.round(width * ratio))
    small.height = Math.max(1, Math.round(height * ratio))
    const context = small.getContext('2d', { willReadFrequently: true })
    context.drawImage(state.source, 0, 0, small.width, small.height)
    const guides = buildGuides(context.getImageData(0, 0, small.width, small.height), maps)
    floatTexture('guideTone', guides.width, guides.height, guides.tone)
    floatTexture('guideField', guides.width, guides.height, guides.field)
    floatTexture('guideSide', guides.width, guides.height, guides.side)
    drawPencil()
    reseed(seed)
  }

  // One full-screen pass, so it is rerun on every slider move.
  function drawPencil() {
    const { width, height } = state
    draw(programs.hatch, 'pencil', { uLine: state.lines, uMatte: 'matte', uTone: 'guideTone', uField: 'guideField', uSide: 'guideSide' }, {
      uSize: [width, height],
      uUnit: Math.max(width, height) / 1400,
      uHatching: state.hatching,
      uFocus: state.focus,
      uSeed: 3.5,
    })
  }

  function reseed(seed) {
    const { width, height } = state
    const ratio = FIELD_SIZE / Math.max(width, height)
    const w = Math.round(width * ratio)
    const h = Math.round(height * ratio)
    target('probe', w, h)
    draw(programs.probe, 'probe', { uSketch: 'sketch', uMatte: 'matte' })
    const pixels = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const matte = new Float32Array(w * h)
    const luma = new Float32Array(w * h)
    const edge = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) {
      matte[i] = pixels[i * 4] / 255
      luma[i] = pixels[i * 4 + 1] / 255
      edge[i] = pixels[i * 4 + 2] / 255
    }
    const tones = []
    for (let i = 0; i < w * h; i += 3) if (matte[i] > 0.5) tones.push(luma[i])
    tones.sort((a, b) => a - b)
    if (tones.length > 50) {
      const low = tones[Math.floor(tones.length * 0.03)]
      const high = tones[Math.floor(tones.length * 0.97)]
      state.levels = [low, Math.max(high, low + 0.25)]
    } else state.levels = [0, 1]
    const fields = buildFields({ width: w, height: h, matte, luma, edge, seed })
    floatTexture('field', w, h, fields.data)
    floatTexture('field2', w, h, fields.second)
    state.seed = seed
    state.ready = true
  }

  function render(time) {
    if (!state.width) return
    const t = Math.min(Math.max(time, 0), TIMELINE.duration)
    draw(programs.composite, null, { uPhoto: 'photo', uSketch: 'sketch', uPencil: 'pencil', uMatte: 'matte', uField: 'field', uField2: 'field2' }, {
      uAspect: [state.width / state.height, 1],
      uSize: [state.width, state.height],
      uPaper: TIMELINE.paper,
      uInk: TIMELINE.ink,
      uAccent: TIMELINE.accent,
      uTint: state.tint,
      uSketchOnly: state.sketchOnly ? 1 : 0,
      uLevels: state.levels,
      uSeed: (state.seed % 97) + 0.5,
      uStage: state.ready ? 1 : 0,
      uZoom: 1 + 0.035 * (t / TIMELINE.duration),
      uTime: t,
    })
  }

  return {
    setImage,
    prepare,
    reseed,
    render,
    setTint: value => { state.tint = value },
    setHatching: value => {
      state.hatching = value
      if (state.ready) drawPencil()
    },
    setFocus: value => {
      state.focus = value
      if (state.ready) drawPencil()
    },
    setSketchOnly: value => { state.sketchOnly = value },
    get ready() { return state.ready },
  }
}
