<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  src: { type: String, required: true },
  duration: { type: Number, required: true },
  initial: { type: Number, default: 0 },
  // The first choice for a new video is required; later ones can be backed out of.
  cancellable: { type: Boolean, default: false },
})
const emit = defineEmits(['confirm', 'cancel'])

const player = ref(null)
const scanner = ref(null)
const quick = ref(null)
const at = ref(props.initial)
const ratio = ref(16 / 9)
const quickShown = ref(false)

// Seeking a video to an exact frame is slow: the browser decodes from the last keyframe each
// time. So dragging is answered at once from a strip of small frames, gathered by playing a
// second copy of the video through quickly, and the exact frame follows when it is ready.
const STRIP_WIDTH = 480
const strip = [] // { time, bitmap }, in order
let scanning = true
let wanted = props.initial
let seeking = false

const stamp = seconds => {
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${String(Math.floor((seconds - whole) * 100)).padStart(2, '0')}`
}

function gather() {
  const video = scanner.value
  const surface = document.createElement('canvas')
  const grab = async (_, frame) => {
    if (!scanning) return
    surface.width = STRIP_WIDTH
    surface.height = Math.round((STRIP_WIDTH * video.videoHeight) / video.videoWidth)
    surface.getContext('2d').drawImage(video, 0, 0, surface.width, surface.height)
    const bitmap = await createImageBitmap(surface)
    if (!scanning) return bitmap.close()
    strip.push({ time: frame.mediaTime, bitmap })
    if (!video.ended) video.requestVideoFrameCallback(grab)
  }
  if (!video.requestVideoFrameCallback) return // no strip; exact seeking still works
  video.requestVideoFrameCallback(grab)
  // Fast enough to cover a long video in a few seconds; frames are skipped, which is fine here.
  video.playbackRate = Math.min(16, Math.max(2, props.duration / 4))
  video.play().catch(() => {})
}

function nearest(time) {
  let low = 0
  let high = strip.length - 1
  if (high < 0) return null
  while (low < high) {
    const mid = (low + high) >> 1
    if (strip[mid].time < time) low = mid + 1
    else high = mid
  }
  const best = low > 0 && time - strip[low - 1].time < strip[low].time - time ? strip[low - 1] : strip[low]
  return Math.abs(best.time - time) < 0.25 ? best : null
}

// Only one exact seek runs at a time, always to the latest position asked for.
function settle() {
  if (seeking) return
  seeking = true
  const target = wanted
  player.value.addEventListener('seeked', () => {
    seeking = false
    if (wanted !== target) settle()
    else quickShown.value = false
  }, { once: true })
  player.value.currentTime = target
}

function seek(event) {
  at.value = wanted = Number(event.target.value)
  const frame = nearest(wanted)
  if (frame) {
    const surface = quick.value
    if (surface.width !== frame.bitmap.width) {
      surface.width = frame.bitmap.width
      surface.height = frame.bitmap.height
    }
    surface.getContext('2d').drawImage(frame.bitmap, 0, 0)
    quickShown.value = true
  }
  settle()
}

function onMeta() {
  ratio.value = player.value.videoWidth / player.value.videoHeight
}

function onKey(event) {
  if (event.key === 'Escape' && props.cancellable) emit('cancel')
}

onMounted(() => {
  player.value.currentTime = at.value
  gather()
})

onBeforeUnmount(() => {
  scanning = false
  scanner.value?.pause()
  for (const frame of strip) frame.bitmap.close()
})
</script>

<template>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="keyframe-title" @keydown="onKey">
    <div class="modal-box">
      <h2 id="keyframe-title">Choose the frame to paint</h2>
      <p>The video stops on this frame, turns into the painting, and carries on.</p>
      <div class="modal-view" :style="{ aspectRatio: ratio }">
        <video ref="player" :src="src" muted playsinline preload="auto" @loadedmetadata="onMeta"></video>
        <canvas v-show="quickShown" ref="quick"></canvas>
        <!-- Plays through out of sight to gather the strip; it must stay rendered to give frames. -->
        <video ref="scanner" class="scanner" :src="src" muted playsinline preload="auto"></video>
      </div>
      <div class="modal-seek">
        <input
          class="scrubber"
          type="range"
          min="0"
          :max="duration"
          step="0.01"
          :value="at"
          :style="{ '--progress': `${duration ? (at / duration) * 100 : 0}%` }"
          aria-label="Frame"
          autofocus
          @input="seek"
        >
        <output>{{ stamp(at) }} / {{ stamp(duration) }}</output>
      </div>
      <div class="modal-actions">
        <button v-if="cancellable" type="button" @click="emit('cancel')">Cancel</button>
        <button class="primary" type="button" @click="emit('confirm', at)">Use this frame</button>
      </div>
    </div>
  </div>
</template>
