<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createRenderer, durationFor, OUTRO_LENGTH, WIDE, WORK_SIZE } from './engine/renderer.js'
import { effective, MAX_ROTATION, MAX_SCALE } from './engine/framing.js'
import { attention } from './engine/attention.js'
import { growMatte } from './engine/reach.js'
import PanelSection from './components/PanelSection.vue'
import KeyframePicker from './components/KeyframePicker.vue'
import { asset, chosenFile, SAMPLES } from './source.js'

const route = useRoute()
const router = useRouter()

const canvas = ref(null)
const fileInput = ref(null)
const time = ref(0)
const playing = ref(false)
const ready = ref(false)
const status = ref('Loading photo…')
const colour = ref(false)
const hatching = ref(0.5)
const focus = ref(1)
const reach = ref(0)
const background = ref(0.8)
const hasDepth = ref(false)
const dragging = ref(false)
// The final frame as the user asked for it. What is shown is `framing`, which holds these
// within what the sheet can cover; the asked-for values are kept, so they return when there
// is room again.
const rotation = ref(0)
const scaleWanted = ref(1)
const panWanted = ref([0, 0])
const aspect = ref(1600 / 1006)
const motion = ref('rhythmic')
const outro = ref(false)
const credit = ref(null) // the sample being shown, if it is one
const unsupported = ref(false)
// A video source: the effect still runs on one frame of it, the keyframe, which the user
// picks. `key` is null until they have.
const video = ref(null)
const clip = ref(null) // { url, duration, key }
const picking = ref(false)
const whole = ref(false) // show the whole video, or just a second either side of the effect
const showVideo = ref(false)
let videoRunning = false
let drawn = 0        // when the canvas was last drawn

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let renderer
let worker
let frame = 0
let last = 0
let job = 0
let seed = 7
let looking = null
// The model outputs as they arrived, kept so Reach can regrow the matte without rerunning them.
let raw = null
let grab = null
let lingering = 0

const framing = computed(() => effective({ rotation: rotation.value, scale: scaleWanted.value, pan: panWanted.value }, aspect.value, WIDE))
const effectDuration = computed(() => durationFor(framing.value, outro.value))
// With a video, the clock runs through three parts: the video up to the keyframe, the
// effect on that frame, and the video from the keyframe on.
const hasKey = computed(() => clip.value?.key != null)
const lead = computed(() => (!hasKey.value ? 0 : whole.value ? clip.value.key : Math.min(1, clip.value.key)))
const trail = computed(() => {
  if (!hasKey.value) return 0
  const rest = clip.value.duration - clip.value.key
  return whole.value ? rest : Math.min(1, rest)
})
// The effect starts a little before the keyframe, while the video is still playing: the
// first blots open over a moving picture, and it has stopped by the time they have spread.
// The paper's first dot appears 0.3 s into the effect, so this leaves 0.4 s of blots in motion.
const OVERLAP = 0.7
const effectStart = computed(() => lead.value - Math.min(OVERLAP, lead.value))
// With the outro on, the same happens at the other end: the video starts again as the outro
// begins, so the picture that spreads back over the painting is already moving.
const tailOverlap = computed(() => (hasKey.value && outro.value ? Math.min(OUTRO_LENGTH, trail.value) : 0))
const resume = computed(() => effectStart.value + effectDuration.value - tailOverlap.value) // the video plays on from here
const duration = computed(() => resume.value + trail.value)
const progress = computed(() => `${(time.value / duration.value) * 100}%`)
const effectBand = computed(() => ({
  '--fx-from': `${(effectStart.value / duration.value) * 100}%`,
  '--fx-to': `${((effectStart.value + effectDuration.value) / duration.value) * 100}%`,
}))
// The scale slider works in octaves, so each step feels the same size.
const scaleRange = computed(() => {
  const min = Math.log2(framing.value.minScale)
  const max = Math.log2(MAX_SCALE)
  const value = Math.log2(framing.value.scale)
  return { min, max, value, progress: `${((value - min) / (max - min)) * 100}%` }
})
const framed = computed(() => !framing.value.still)

// Turning the outro off, or resetting the frame, can leave the clock past the new end.
watch(duration, value => {
  if (time.value > value) time.value = value
})

watch(playing, value => {
  if (!value) stopVideo()
})

watch(framing, value => {
  renderer?.setFraming(value)
  if (time.value > duration.value) time.value = duration.value
}, { immediate: true })

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

// The maps the renderer gets: the raw ones, with the matte grown by Reach.
const reached = () => ({ ...raw, matte: growMatte(raw.matte, raw.depth, reach.value) })

function start(maps) {
  raw = maps
  hasDepth.value = !!maps.depth
  renderer.prepare(reached(), seed)
  ready.value = true
  status.value = ''
  jump(reducedMotion ? duration.value : 0)
  playing.value = !reducedMotion
}

function stopVideo() {
  video.value?.pause()
  videoRunning = false
}

function dropClip() {
  stopVideo()
  if (!clip.value) return
  URL.revokeObjectURL(clip.value.url)
  clip.value = null
  video.value.removeAttribute('src')
  video.value.load()
}

async function load(source, sample = null) {
  if (source.type?.startsWith('video/')) return loadVideo(source)
  dropClip()
  const id = ++job
  ready.value = false
  playing.value = false
  time.value = 0
  status.value = 'Loading photo…'
  let bitmap
  try {
    bitmap = await createImageBitmap(source)
  } catch {
    status.value = 'That file could not be read as an image.'
    return
  }
  if (id === job) paint(bitmap, sample)
}

// A video is only opened here; nothing is painted until a keyframe has been chosen.
async function loadVideo(file) {
  dropClip()
  const id = ++job
  ready.value = false
  playing.value = false
  time.value = 0
  credit.value = null
  status.value = 'Loading video…'
  const url = URL.createObjectURL(file)
  const player = video.value
  try {
    await new Promise((resolve, reject) => {
      player.onloadedmetadata = resolve
      player.onerror = reject
      player.src = url
    })
  } catch {
    URL.revokeObjectURL(url)
    status.value = 'That video could not be played in this browser.'
    return
  }
  if (id !== job) return URL.revokeObjectURL(url)
  clip.value = { url, duration: player.duration, key: null }
  status.value = 'Choose a frame to paint.'
  picking.value = true
}

// Moves the video to a moment and waits until that frame is really there.
async function seekTo(player, seconds) {
  if (player.readyState < 2) await new Promise(resolve => player.addEventListener('loadeddata', resolve, { once: true }))
  if (Math.abs(player.currentTime - seconds) < 0.001) return
  await new Promise(resolve => {
    player.addEventListener('seeked', resolve, { once: true })
    player.currentTime = seconds
  })
}

async function useKeyframe(seconds) {
  picking.value = false
  stopVideo()
  ready.value = false
  playing.value = false
  status.value = 'Reading the frame…'
  const id = ++job
  await seekTo(video.value, seconds)
  const bitmap = await createImageBitmap(video.value)
  if (id !== job) return
  clip.value = { ...clip.value, key: seconds }
  paint(bitmap)
}

function changeKeyframe() {
  playing.value = false
  picking.value = true
}

// Everything from a decoded picture on: the photo, or the video's keyframe.
function paint(bitmap, sample = null) {
  const id = ++job
  ready.value = false
  playing.value = false
  time.value = 0
  credit.value = sample
  const work = scaled(bitmap, WORK_SIZE)
  aspect.value = work.width / work.height
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

// Moves the clock on. Through the video parts the video plays by itself and the clock
// follows it, so the two cannot drift; through the effect the clock runs alone.
function advance(delta) {
  if (!hasKey.value) {
    time.value = Math.min(time.value + delta, duration.value)
    if (time.value >= duration.value) playing.value = false
    return
  }
  const player = video.value
  const { key } = clip.value
  const reachKey = lead.value // the video runs until here, into the start of the effect
  const effectEnd = resume.value // where the clock hands back to the video
  if (time.value < reachKey) {
    const from = key - reachKey
    if (!videoRunning) {
      player.currentTime = from + time.value
      player.play().catch(() => {})
      videoRunning = true
    } else time.value = Math.min(Math.max(player.currentTime - from, 0), reachKey)
    if (player.currentTime >= key || player.ended) {
      stopVideo()
      time.value = reachKey
    }
  } else if (time.value < effectEnd) {
    if (videoRunning) stopVideo()
    time.value = Math.min(time.value + delta, effectEnd)
    if (time.value >= effectEnd && trail.value < 0.02) playing.value = false
  } else if (trail.value < 0.02) {
    playing.value = false
  } else {
    if (!videoRunning) {
      player.currentTime = key + (time.value - effectEnd)
      player.play().catch(() => {})
      videoRunning = true
    } else time.value = Math.min(effectEnd + Math.max(player.currentTime - key, 0), duration.value)
    if (player.ended || time.value >= duration.value - 0.001) {
      stopVideo()
      time.value = duration.value
      playing.value = false
    }
  }
}

function tick(now) {
  frame = requestAnimationFrame(tick)
  const delta = Math.min((now - last) / 1000, 0.1)
  last = now
  if (playing.value) advance(delta)
  const effectTime = time.value - effectStart.value
  // While the effect overlaps the video, the moving picture is what the paper covers.
  // While the video is busy seeking it has no frame to give; the last one stays up, rather
  // than falling back to the keyframe and flickering between the two.
  const overlapping = hasKey.value && effectTime >= 0 && (time.value < lead.value || (tailOverlap.value > 0 && time.value >= resume.value))
  // On fast displays the canvas is still drawn at most 60 times a second: the picture is
  // heavy to paint, and an even 60 looks better than a 120 that keeps dropping frames.
  if (now - drawn < 15) return
  drawn = now
  if (!overlapping) renderer.setLive(null)
  else if (video.value.readyState >= 2 && !video.value.seeking) renderer.setLive(video.value)
  else renderer.holdLive()
  renderer.render(Math.min(Math.max(effectTime, 0), effectDuration.value))
  // The video lies over the canvas outside the effect, unless a setting is being previewed.
  const outside = hasKey.value && (effectTime < 0 || (effectTime >= effectDuration.value && trail.value >= 0.02 && time.value > resume.value))
  const shown = outside && !renderer.previewing
  if (shown !== showVideo.value) showVideo.value = shown
}

// While paused, the video sits on the frame the clock points at.
function park() {
  if (!hasKey.value || playing.value) return
  const effectTime = time.value - effectStart.value
  if (time.value < lead.value) video.value.currentTime = clip.value.key - (lead.value - time.value)
  else if (time.value >= resume.value) video.value.currentTime = clip.value.key + (time.value - resume.value)
}

function jump(seconds) {
  stopVideo()
  time.value = seconds
  park()
}

function toggle() {
  if (!ready.value) return
  if (!playing.value && time.value >= duration.value) jump(0)
  playing.value = !playing.value
  if (!playing.value) {
    stopVideo()
    park()
  }
}

function replay() {
  if (!ready.value) return
  jump(0)
  playing.value = true
}

function setWhole(value) {
  if (whole.value === value) return
  playing.value = false
  whole.value = value
  jump(0)
}

function reshuffle() {
  if (!ready.value) return
  seed += 1
  renderer.reseed(seed)
  replay()
}

function scrub(event) {
  playing.value = false
  jump(Number(event.target.value))
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

// Dragging Reach shows the subject it would give, on the photo; growing the matte is quick.
function setReach(event) {
  reach.value = Number(event.target.value)
  if (raw && ready.value) renderer.setMattePreview(reached().matte)
}

function endReachPreview() {
  renderer.setMattePreview(null)
}

// Regrowing the subject rebuilds everything that depends on it, so it waits for the
// slider to be let go, and the animation starts over.
function applyReach() {
  if (!raw || !ready.value) return
  renderer.prepare(reached(), seed)
  renderer.setMattePreview(null)
  jump(reducedMotion ? duration.value : effectStart.value) // straight to the effect
  playing.value = !reducedMotion
}

// Background details only changes how the wash is painted, so it shows at once, on the
// finished picture.
function setBackground(event) {
  background.value = Number(event.target.value)
  renderer.setBackground(background.value)
  renderer.setFinishedPreview(true)
}

function endFinishedPreview() {
  renderer.setFinishedPreview(false)
}

function setFocus(event) {
  focus.value = Number(event.target.value)
  renderer.setFocus(focus.value)
  renderer.setSketchOnly(true)
}

function endSketchPreview() {
  renderer.setSketchOnly(false)
}

// Planning the final frame shows it as it will end up; letting go returns to the animation.
function plan() {
  clearTimeout(lingering)
  renderer.setPlanning(true)
}

// The planned frame stays up for a moment after letting go, so it can be judged at rest.
function endPlanning() {
  clearTimeout(lingering)
  lingering = setTimeout(() => renderer.setPlanning(false), 1400)
}

function setRotation(event) {
  rotation.value = Number(event.target.value)
  plan()
}

function setScale(event) {
  scaleWanted.value = 2 ** Number(event.target.value)
  plan()
}

function setMotion(event) {
  motion.value = event.target.value
  renderer.setMotion(motion.value)
}

function setOutro(event) {
  outro.value = event.target.checked
  renderer.setOutro(outro.value)
}

function resetFrame() {
  rotation.value = 0
  scaleWanted.value = 1
  panWanted.value = [0, 0]
}

// A press on the picture is a click (play or pause) until it moves; then it drags the photo
// to where it should sit in the final frame.
function press(event) {
  if (!ready.value) return
  grab = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: framing.value.pan, moved: false }
  event.currentTarget.setPointerCapture(event.pointerId)
}

function drag(event) {
  if (!grab || event.pointerId !== grab.id) return
  const dx = event.clientX - grab.x
  const dy = event.clientY - grab.y
  if (!grab.moved && Math.hypot(dx, dy) < 4) return
  grab.moved = true
  const height = event.currentTarget.getBoundingClientRect().height
  panWanted.value = [grab.pan[0] + dx / height, grab.pan[1] - dy / height]
  plan()
}

function release(event) {
  if (!grab || event.pointerId !== grab.id) return
  const { moved } = grab
  grab = null
  if (moved) endPlanning()
  else if (event.type === 'pointerup') toggle()
}

// A replaced photo or video is no longer the sample named in the address.
function replaceWith(file) {
  router.replace({ name: 'edit' })
  chosenFile.value = file
  load(file)
}

function pick(event) {
  const [file] = event.target.files
  if (file) replaceWith(file)
  event.target.value = ''
}

function drop(event) {
  dragging.value = false
  const file = [...event.dataTransfer.files].find(item => /^(image|video)\//.test(item.type))
  if (file) replaceWith(file)
}

function onKey(event) {
  if (event.code !== 'Space' || picking.value || event.target.closest('button, input')) return
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
  // The start screen hands over either a sample (named in the address) or a file.
  const sample = SAMPLES.find(item => item.id === route.params.sample)
  if (sample) {
    const response = await fetch(asset(`samples/${sample.id}.jpg`))
    load(await response.blob(), sample)
  } else if (chosenFile.value && !route.params.sample) {
    load(chosenFile.value)
  } else {
    router.replace({ name: 'start' })
  }
})

onBeforeUnmount(() => {
  dropClip()
  cancelAnimationFrame(frame)
  clearTimeout(lingering)
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
        <h1><RouterLink :to="{ name: 'start' }">Ink Wash</RouterLink></h1>
        <p>A photo becomes a pencil sketch on aged paper, then fills with spreading ink.</p>
      </div>
    </header>

    <div class="workspace">
      <div class="viewer">
        <section class="stage">
          <div class="frame">
            <canvas
              ref="canvas"
              width="1600"
              height="1006"
              @pointerdown="press"
              @pointermove="drag"
              @pointerup="release"
              @pointercancel="release"
            ></canvas>
            <video ref="video" class="clip" :class="{ under: !showVideo }" muted playsinline preload="auto"></video>
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
            :class="{ banded: hasKey }"
            type="range"
            min="0"
            :max="duration"
            step="0.01"
            :value="time"
            :disabled="!ready"
            :style="{ '--progress': progress, ...effectBand }"
            aria-label="Animation position"
            @input="scrub"
          >
          <button class="icon" type="button" :disabled="!ready" aria-label="Replay" title="Replay" @click="replay">
            <svg class="line" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 1.45-4.59M5 3.5v4h4" /></svg>
          </button>
          <div v-if="hasKey" class="segmented" role="group" aria-label="Preview">
            <button type="button" :aria-pressed="!whole" :disabled="!ready" @click="setWhole(false)">Effect only</button>
            <button type="button" :aria-pressed="whole" :disabled="!ready" @click="setWhole(true)">Whole video</button>
          </div>
        </footer>
      </div>

      <aside class="panel" aria-label="Options">
        <button class="primary wide" type="button" :disabled="unsupported" @click="fileInput.click()">{{ clip ? 'Replace video' : 'Replace photo' }}</button>
        <button v-if="clip" class="wide" type="button" :disabled="clip.key == null && !picking" @click="changeKeyframe">Change keyframe</button>
        <input ref="fileInput" type="file" accept="image/*,video/*" hidden @change="pick">
        <PanelSection title="Fill">
          <div class="panel-actions">
            <button type="button" :disabled="!ready" @click="reshuffle">New pour</button>
            <button type="button" :disabled="!ready" :aria-pressed="colour" @click="toggleColour">Colour</button>
          </div>
          <label v-if="hasDepth" class="field">
            <span class="field-head"><span class="hint" tabindex="0" aria-describedby="tip-reach">Reach<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M8 7.2v4M8 4.7v.1" /></svg><span id="tip-reach" class="tip" role="tooltip">Grows the subject to things at a similar depth that the cut-out missed.</span></span><output>{{ Math.round(reach * 100) }}%</output></span>
            <input
              class="scrubber"
              type="range"
              min="0"
              max="1"
              step="0.01"
              :value="reach"
              :disabled="!ready"
              :style="{ '--progress': `${reach * 100}%` }"
              @input="setReach"
              @change="applyReach"
              @blur="endReachPreview"
            >
          </label>
          <label class="field">
            <span class="field-head"><span class="hint" tabindex="0" aria-describedby="tip-background-details">Background details<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M8 7.2v4M8 4.7v.1" /></svg><span id="tip-background-details" class="tip" role="tooltip">How much of the background shows in the wash behind the subject.</span></span><output>{{ Math.round(background * 100) }}%</output></span>
            <input
              class="scrubber"
              type="range"
              min="0"
              max="1"
              step="0.01"
              :value="background"
              :disabled="!ready"
              :style="{ '--progress': `${background * 100}%` }"
              @input="setBackground"
              @change="endFinishedPreview"
              @blur="endFinishedPreview"
            >
          </label>
        </PanelSection>

        <PanelSection title="Sketch">
          <label class="field">
            <span class="field-head"><span class="hint" tabindex="0" aria-describedby="tip-hatching">Hatching<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M8 7.2v4M8 4.7v.1" /></svg><span id="tip-hatching" class="tip" role="tooltip">How much pencil shading is drawn; at zero only the outlines remain.</span></span><output>{{ Math.round(hatching * 100) }}%</output></span>
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
          <label class="field">
            <span class="field-head"><span class="hint" tabindex="0" aria-describedby="tip-focus">Focus<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M8 7.2v4M8 4.7v.1" /></svg><span id="tip-focus" class="tip" role="tooltip">How strongly the shading thins out where the eye is drawn.</span></span><output>{{ Math.round(focus * 100) }}%</output></span>
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
        </PanelSection>

        <PanelSection title="Motion">
          <template #actions>
            <button v-if="ready && framed" class="icon-quiet" type="button" aria-label="Reset frame" title="Reset frame" @click="resetFrame">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 1.45-4.59M5 3.5v4h4" /></svg>
            </button>
          </template>
          <p class="section-note">Where the photo ends up once the paper has covered it and the camera moves. <strong>Drag the picture to place it.</strong></p>
          <label class="field">
            <span class="field-head"><span>Rotate</span><output>{{ rotation.toFixed(1) }}°</output></span>
            <input
              class="scrubber"
              type="range"
              :min="-MAX_ROTATION"
              :max="MAX_ROTATION"
              step="0.5"
              :value="rotation"
              :disabled="!ready"
              :style="{ '--progress': `${((rotation + MAX_ROTATION) / (2 * MAX_ROTATION)) * 100}%` }"
              @input="setRotation"
              @change="endPlanning"
              @blur="endPlanning"
            >
          </label>
          <label class="field">
            <span class="field-head"><span>Scale</span><output>{{ framing.scale.toFixed(2) }}×</output></span>
            <input
              class="scrubber"
              type="range"
              :min="scaleRange.min"
              :max="scaleRange.max"
              step="0.005"
              :value="scaleRange.value"
              :disabled="!ready"
              :style="{ '--progress': scaleRange.progress }"
              @input="setScale"
              @change="endPlanning"
              @blur="endPlanning"
            >
          </label>
          <label class="field inline">
            <span>Style</span>
            <select :value="motion" :disabled="!ready" @change="setMotion">
              <option value="rhythmic">Rhythmic</option>
              <option value="smooth">Smooth</option>
              <option value="rapid">Rapid</option>
            </select>
          </label>
          <label class="field inline">
            <span class="hint" tabindex="0" aria-describedby="tip-outro">Outro<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M8 7.2v4M8 4.7v.1" /></svg><span id="tip-outro" class="tip" role="tooltip">After the painting, the camera returns to the photo's own frame and the photo spreads back over it from the middle.</span></span>
            <input class="switch" type="checkbox" :checked="outro" :disabled="!ready" @change="setOutro">
          </label>
        </PanelSection>
      </aside>
    </div>

    <p class="note">
      Everything runs in your browser; {{ clip ? 'the video' : 'the photo' }} is never uploaded.
      <template v-if="credit">Photo by <a :href="credit.page" target="_blank" rel="noopener">{{ credit.by }}</a> on Pexels.</template>
    </p>
    <KeyframePicker
      v-if="picking && clip"
      :src="clip.url"
      :duration="clip.duration"
      :initial="clip.key ?? 0"
      :cancellable="clip.key != null"
      @confirm="useKeyframe"
      @cancel="picking = false"
    />
  </main>
</template>
