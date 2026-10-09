import { VERTEX, LUMA, BLUR, SKETCH, PROBE, HATCH, COMPOSITE } from './shaders.js'
import { buildFields, extendSheet } from './fields.js'
import { buildGuides, GUIDE_SIZE } from './guides.js'
import { effective } from './framing.js'

export const WORK_SIZE = 1600
const FIELD_SIZE = 512
// Everything is solved on a sheet this many times larger than the photo, so the planned
// frame can pull back until the photo fills 60% of the height.
export const WIDE = 1 / 0.6

// Seconds. Each front is [start, duration, easing exponent]: paper opens slowly and then
// bursts, the first wash surges in behind it, and the darks arrive last. The remaining time
// lets the slowest pixels settle.
export const TIMELINE = {
  paper: [0.3, 1.3, 1.7],
  ink: [0.85, 2.2, 2.0],
  accent: [1.55, 2.6, 2.4],
  duration: 4.7,
}

// The camera leaves for the planned frame once the paper has covered the photo, and the
// scene past the photo's edge goes on finishing afterwards. Seconds.
export const PULL = { start: TIMELINE.paper[0] + TIMELINE.paper[1], total: 6.6 }
const TAIL = PULL.total - PULL.start // seconds from the start of the move to the last moment

const together = share => ({ x: share, y: share, turn: share, zoom: share })
const easings = {
  // Starts at full speed and eases out; the higher the power, the harder the kick.
  out: power => x => 1 - (1 - x) ** power,
  // Eases in and out.
  inOut: () => x => x * x * x * (x * (6 * x - 15) + 10),
}

// Ways for the camera to reach the planned frame. Each is a list of pushes, and each push
// does its own share of the sideways travel, the vertical travel, the turn, and the zoom;
// every column adds up to 1. All of them hold a little back and spend it slowly right up to
// the last moment, so the scene never quite stands still.
// [delay after start, length, shares, easing]
export const MOTIONS = {
  // Three quick pushes on an even rhythm: the first mostly sideways with a hint of turn, the
  // later ones carrying the vertical travel and most of the rotation.
  rhythmic: [
    [0, 0.5, { x: 0.72, y: 0.08, turn: 0.1, zoom: 0.42 }, easings.out(4)],
    [0.55, 0.5, { x: 0.2, y: 0.57, turn: 0.52, zoom: 0.33 }, easings.out(4)],
    [1.1, 1.4, { x: 0.052, y: 0.2275, turn: 0.247, zoom: 0.1625 }, easings.out(4)],
    [1.1, TAIL - 1.1, { x: 0.028, y: 0.1225, turn: 0.133, zoom: 0.0875 }, easings.out(2)],
  ],
  // One slow glide that eases in and out, then a long, slow run-out.
  smooth: [
    [0, 3.4, together(0.85), easings.inOut()],
    [1.4, TAIL - 1.4, together(0.15), easings.out(2)],
  ],
  // One fast push that brakes hard, then the same slow run-out.
  rapid: [
    [0, 0.7, together(0.82), easings.out(4)],
    [0.3, TAIL - 0.3, together(0.18), easings.out(2.5)],
  ],
}

/** How long the animation runs: longer when the camera moves, so the sheet can finish. */
export const durationFor = framing => (framing.still ? TIMELINE.duration : PULL.total)

// How far each part of the camera move has come at time t, 0…1.
function pullAt(t, motion) {
  const done = { x: 0, y: 0, turn: 0, zoom: 0 }
  for (const [delay, length, shares, ease] of MOTIONS[motion]) {
    const eased = ease(Math.min(Math.max((t - PULL.start - delay) / length, 0), 1))
    for (const part in done) done[part] += shares[part] * eased
  }
  return done
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

  const state = { width: 0, height: 0, source: null, ready: false, tint: 0, seed: 1, levels: [0, 1], hatching: 0.5, focus: 1, lines: 'sketch', sketchOnly: false, planning: false, guides: 0, matteView: false, motion: 'rhythmic', framing: { rotation: 0, scale: 1, pan: [0, 0], still: true } }
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
    target('pencilWide', width, height)
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
    reseed(seed)
    drawPencil()
  }

  // One full-screen pass, so it is rerun on every slider move.
  function drawPencil() {
    const { width, height } = state
    // Drawn twice: the frame itself, and the wider sheet where strokes trail off past its edge.
    for (const [into, pad] of [['pencil', 1], ['pencilWide', WIDE]]) {
      draw(programs.hatch, into, { uLine: state.lines, uMatte: 'matte', uTone: 'guideTone', uField: 'guideField', uSide: 'guideSide', uSheet: 'sheet' }, {
        uWide: WIDE,
        uSize: [width, height],
        uUnit: Math.max(width, height) / 1400,
        uHatching: state.hatching,
        uFocus: state.focus,
        uSeed: 3.5,
        uPad: pad,
        uFade: pad > 1 ? 1 : 0,
      })
    }
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
    // Pad the maps onto the wider sheet. Outside the frame the nearest edge value is used;
    // the subject fades out over a short distance so a figure cut by the frame trails off.
    const pw = Math.round(w * WIDE)
    const ph = Math.round(h * WIDE)
    const ox = (pw - w) >> 1
    const oy = (ph - h) >> 1
    const wide = { matte: new Float32Array(pw * ph), luma: new Float32Array(pw * ph), edge: new Float32Array(pw * ph), outside: new Float32Array(pw * ph) }
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const sx = Math.min(w - 1, Math.max(0, x - ox))
        const sy = Math.min(h - 1, Math.max(0, y - oy))
        const distance = Math.hypot(x - ox - sx, y - oy - sy) / h
        const fade = 1 - Math.min(1, Math.max(0, (distance - 0.03) / 0.17))
        const from = sy * w + sx
        const to = y * pw + x
        wide.matte[to] = matte[from] * fade
        wide.luma[to] = luma[from]
        wide.edge[to] = distance > 0 ? 0 : edge[from]
        wide.outside[to] = distance
      }
    }
    const padded = { matte: new Float32Array(pw * ph), luma: wide.luma, edge: wide.edge, outside: wide.outside }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) padded.matte[(y + oy) * pw + x + ox] = matte[y * w + x]
    floatTexture('sheet', pw, ph, extendSheet({ width: pw, height: ph, ...padded }))
    const fields = buildFields({ width: pw, height: ph, ...wide, seed, frameLong: Math.max(w, h) })
    floatTexture('field', pw, ph, fields.data)
    floatTexture('field2', pw, ph, fields.second)
    state.seed = seed
    state.ready = true
  }

  function render(time) {
    const { framing } = state
    const pulledBack = !framing.still
    if (!state.width) return
    // While the frame is being planned, show where it ends up: the last moment, camera arrived.
    state.guides += ((state.planning ? 1 : 0) - state.guides) * 0.25 // eased in and out, frame by frame
    // The Reach preview shows the plain photo, so the camera stays where it starts.
    const t = state.matteView ? 0 : state.planning ? durationFor(framing) : Math.min(Math.max(time, 0), durationFor(framing))
    // The camera goes from the photo filling the viewport to the planned frame. Left where
    // it is, it keeps the slow push-in the animation always had.
    let camera = { rotation: 0, scale: 1 + 0.035 * (t / TIMELINE.duration), pan: [0, 0] }
    let pull = 0
    if (pulledBack) {
      const done = pullAt(t, state.motion)
      pull = done.zoom
      // The parts travel out of step, so a point along the way is not automatically one the
      // sheet can cover; it is held to what can be shown, as the planned frame itself is.
      camera = effective({
        rotation: framing.rotation * done.turn,
        scale: Math.exp(Math.log(framing.scale) * done.zoom),
        pan: [framing.pan[0] * done.x, framing.pan[1] * done.y],
      }, state.width / state.height, WIDE)
    }
    const angle = (camera.rotation * Math.PI) / 180
    const cos = Math.cos(angle) / camera.scale
    const sin = Math.sin(angle) / camera.scale
    draw(programs.composite, null, { uPhoto: 'photo', uSketch: 'sketch', uPencil: 'pencil', uPencilWide: 'pencilWide', uMatte: 'matte', uField: 'field', uField2: 'field2', uSheet: 'sheet', uMatteTry: state.matteView ? 'matteTry' : 'matte' }, {
      uMatteView: state.matteView ? 1 : 0,
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
      uPan: camera.pan,
      uGuides: state.guides < 0.004 ? 0 : state.guides,
      uCamX: [cos, sin],
      uCamY: [-sin, cos],
      uPad: WIDE,
      uPull: pull,
      uPullStart: pulledBack ? PULL.start : 1e6, // never, when the frame stays put
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
    /** @param {{ rotation: number, scale: number, pan: [number, number], still: boolean }} framing as returned by effective() */
    setFraming: framing => { state.framing = framing },
    setPlanning: value => { state.planning = value },
    /** Shows a matte over the photo without rebuilding anything; null goes back to the picture. */
    setMattePreview: map => {
      if (map) upload('matteTry', asCanvas(map))
      state.matteView = !!map
    },
    /** @param {keyof typeof MOTIONS} value */
    setMotion: value => { state.motion = value },
    get ready() { return state.ready },
  }
}
