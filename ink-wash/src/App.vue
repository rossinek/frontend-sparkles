<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { createRenderer, TIMELINE, WORK_SIZE } from './engine/renderer.js'
import { attention } from './engine/attention.js'

const canvas = ref(null)
const fileInput = ref(null)
const time = ref(0)
const playing = ref(false)
const ready = ref(false)
const status = ref('Loading photo…')
const colour = ref(false)
const hatching = ref(0.5)
const focus = ref(1)
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
let looking = null

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

// Without a model the whole frame is painted, weighted towards the centre.
function fallbackMatte() {
  const size = 256
  const data = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - size / 2, y - size / 2)
      data[y * size + x] = Math.round(255 * Math.min(1, Math.max(0, (150 - distance) / 110)))
    }
  }
  return { width: size, height: size, data }
}

function start(maps) {
  renderer.prepare(maps, seed)
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
  status.value = 'Loading the models…'
  // Where the eye goes is found on the main thread while the worker runs the heavier models.
  looking = attention(small).catch(error => {
    console.warn('The attention model failed; hatching will ignore where the viewer looks.', error)
    return null
  })
  worker.postMessage({ id, pixels, width: small.width, height: small.height }, [pixels.buffer])
}

async function onWorkerMessage({ data }) {
  if (data.type === 'progress') {
    if (!ready.value) status.value = `Downloading the ${data.label}… ${Math.round(data.progress * 100)}%`
    return
  }
  if (data.id !== job) return
  if (data.type === 'status') status.value = data.text
  else if (data.type === 'maps') {
    const seen = await looking
    if (data.id === job) start({ matte: data.matte, line: data.line, depth: data.depth, attention: seen })
  } else if (data.type === 'error') {
    console.warn('Background removal failed, painting the whole frame instead.', data.message)
    start({ matte: fallbackMatte() })
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
function setHatching(event) {
  hatching.value = Number(event.target.value)
  renderer.setHatching(hatching.value)
  renderer.setSketchOnly(true)
}

function setFocus(event) {
  focus.value = Number(event.target.value)
  renderer.setFocus(focus.value)
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
  worker = new Worker(new URL('./engine/models.worker.js', import.meta.url), { type: 'module' })
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
        <span>Hatching</span>
        <input
          class="scrubber"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="hatching"
          :disabled="!ready"
          :style="{ '--progress': `${hatching * 100}%` }"
          @input="setHatching"
          @change="endSketchPreview"
          @blur="endSketchPreview"
        >
      </label>
      <label>
        <span>Focus</span>
        <input
          class="scrubber"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="focus"
          :disabled="!ready"
          :style="{ '--progress': `${focus * 100}%` }"
          @input="setFocus"
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
