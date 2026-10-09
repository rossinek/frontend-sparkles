<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { createRenderer, TIMELINE, WORK_SIZE } from './engine/renderer.js'

const canvas = ref(null)
const fileInput = ref(null)
const time = ref(0)
const playing = ref(false)
const ready = ref(false)
const status = ref('Loading photo…')
const colour = ref(false)
const detail = ref(0.5)
const shading = ref(0.5)
const dragging = ref(false)
const isSample = ref(true)
const unsupported = ref(false)

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let renderer
let worker
let frame = 0
let last = 0
let job = 0
let seed = 7

const progress = computed(() => `${(time.value / TIMELINE.duration) * 100}%`)

function scaled(bitmap, limit) {
  const ratio = Math.min(1, limit / Math.max(bitmap.width, bitmap.height))
  const surface = document.createElement('canvas')
  surface.width = Math.round(bitmap.width * ratio)
  surface.height = Math.round(bitmap.height * ratio)
  const context = surface.getContext('2d', { willReadFrequently: true })
  context.fillStyle = '#fff'
  context.fillRect(0, 0, surface.width, surface.height)
  context.drawImage(bitmap, 0, 0, surface.width, surface.height)
  return surface
}

function matteCanvas(width, height, alpha) {
  const surface = document.createElement('canvas')
  surface.width = width
  surface.height = height
  const context = surface.getContext('2d')
  const image = context.createImageData(width, height)
  for (let i = 0; i < alpha.length; i++) {
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = alpha[i]
    image.data[i * 4 + 3] = 255
  }
  context.putImageData(image, 0, 0)
  return surface
}

// Without a model the whole frame is painted, weighted towards the centre.
function fallbackMatte() {
  const surface = document.createElement('canvas')
  surface.width = surface.height = 256
  const context = surface.getContext('2d')
  const gradient = context.createRadialGradient(128, 128, 40, 128, 128, 150)
  gradient.addColorStop(0, '#fff')
  gradient.addColorStop(1, '#000')
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 256)
  return surface
}

function start(matte) {
  renderer.prepare(matte, seed)
  ready.value = true
  status.value = ''
  time.value = reducedMotion ? TIMELINE.duration : 0
  playing.value = !reducedMotion
}

async function load(source, sample = false) {
  const id = ++job
  ready.value = false
  playing.value = false
  time.value = 0
  isSample.value = sample
  status.value = 'Loading photo…'
  let bitmap
  try {
    bitmap = await createImageBitmap(source)
  } catch {
    status.value = 'That file could not be read as an image.'
    return
  }
  if (id !== job) return
  const work = scaled(bitmap, WORK_SIZE)
  canvas.value.width = work.width
  canvas.value.height = work.height
  renderer.setImage(work)
  const small = scaled(bitmap, 1024)
  bitmap.close()
  const pixels = small.getContext('2d').getImageData(0, 0, small.width, small.height).data
  status.value = 'Loading the background model…'
  worker.postMessage({ id, pixels, width: small.width, height: small.height }, [pixels.buffer])
}

function onWorkerMessage({ data }) {
  if (data.type === 'progress') {
    if (!ready.value) status.value = `Downloading the background model… ${Math.round(data.progress * 100)}%`
    return
  }
  if (data.id !== job) return
  if (data.type === 'running') status.value = 'Separating the subject…'
  else if (data.type === 'matte') start(matteCanvas(data.width, data.height, data.data))
  else if (data.type === 'error') {
    console.warn('Background removal failed, painting the whole frame instead.', data.message)
    start(fallbackMatte())
  }
}

function tick(now) {
  frame = requestAnimationFrame(tick)
  const delta = Math.min((now - last) / 1000, 0.1)
  last = now
  if (playing.value) {
    time.value = Math.min(time.value + delta, TIMELINE.duration)
    if (time.value >= TIMELINE.duration) playing.value = false
  }
  renderer.render(time.value)
}

function toggle() {
  if (!ready.value) return
  if (!playing.value && time.value >= TIMELINE.duration) time.value = 0
  playing.value = !playing.value
}

function replay() {
  if (!ready.value) return
  time.value = 0
  playing.value = true
}

function reshuffle() {
  if (!ready.value) return
  seed += 1
  renderer.reseed(seed)
  replay()
}

function scrub(event) {
  playing.value = false
  time.value = Number(event.target.value)
}

function toggleColour() {
  colour.value = !colour.value
  renderer.setTint(colour.value ? 1 : 0)
}

// Dragging a sketch slider previews the bare drawing; releasing it returns to the animation.
function setDetail(event) {
  detail.value = Number(event.target.value)
  renderer.setDetail(detail.value)
  renderer.setSketchOnly(true)
}

function setShading(event) {
  shading.value = Number(event.target.value)
  renderer.setShading(shading.value)
  renderer.setSketchOnly(true)
}

function endSketchPreview() {
  renderer.setSketchOnly(false)
}

function pick(event) {
  const [file] = event.target.files
  if (file) load(file)
  event.target.value = ''
}

function drop(event) {
  dragging.value = false
  const file = [...event.dataTransfer.files].find(item => item.type.startsWith('image/'))
  if (file) load(file)
}

function onKey(event) {
  if (event.code !== 'Space' || event.target.closest('button, input')) return
  event.preventDefault()
  toggle()
}

onMounted(async () => {
  try {
    renderer = createRenderer(canvas.value)
  } catch (error) {
    console.error(error)
    unsupported.value = true
    status.value = 'This experiment needs WebGL2, which is not available in this browser.'
    return
  }
  worker = new Worker(new URL('./engine/matte.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = onWorkerMessage
  window.addEventListener('keydown', onKey)
  last = performance.now()
  frame = requestAnimationFrame(tick)
  const response = await fetch(`${import.meta.env.BASE_URL}sample.jpg`)
  load(await response.blob(), true)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  window.removeEventListener('keydown', onKey)
  worker?.terminate()
})
</script>

<template>
  <main
    class="app"
    :class="{ dragging }"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="drop"
  >
    <header class="top">
      <div>
        <h1>Ink Wash</h1>
        <p>A photo becomes a pencil sketch on aged paper, then fills with spreading ink.</p>
      </div>
      <button class="primary" type="button" :disabled="unsupported" @click="fileInput.click()">Use your photo</button>
      <input ref="fileInput" type="file" accept="image/*" hidden @change="pick">
    </header>

    <section class="stage">
      <div class="frame">
        <canvas ref="canvas" width="1600" height="1006" @click="toggle"></canvas>
        <p v-if="status" class="status" role="status">{{ status }}</p>
      </div>
      <p class="drop-hint">Drop the photo to paint it</p>
    </section>

    <footer class="controls">
      <button class="icon" type="button" :disabled="!ready" :aria-label="playing ? 'Pause' : 'Play'" @click="toggle">
        <svg v-if="playing" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>
      </button>
      <input
        class="scrubber"
        type="range"
        min="0"
        :max="TIMELINE.duration"
        step="0.01"
        :value="time"
        :disabled="!ready"
        :style="{ '--progress': progress }"
        aria-label="Animation position"
        @input="scrub"
      >
      <button type="button" :disabled="!ready" @click="replay">Replay</button>
      <button type="button" :disabled="!ready" @click="reshuffle">New pour</button>
      <button type="button" :disabled="!ready" :aria-pressed="colour" @click="toggleColour">Colour</button>
    </footer>

    <div class="sketch-controls">
      <label>
        <span>Sketch detail</span>
        <input
          class="scrubber"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="detail"
          :disabled="!ready"
          :style="{ '--progress': `${detail * 100}%` }"
          @input="setDetail"
          @change="endSketchPreview"
          @blur="endSketchPreview"
        >
      </label>
      <label>
        <span>Sketch shading</span>
        <input
          class="scrubber"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="shading"
          :disabled="!ready"
          :style="{ '--progress': `${shading * 100}%` }"
          @input="setShading"
          @change="endSketchPreview"
          @blur="endSketchPreview"
        >
      </label>
    </div>

    <p class="note">
      Everything runs in your browser; the photo is never uploaded.
      <template v-if="isSample">Sample photo by Toni Hukkanen (CC0).</template>
    </p>
  </main>
</template>
