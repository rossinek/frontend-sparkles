<script setup>
import { computed, ref } from 'vue'
import { fit, GIF_FPS, GIF_LONG } from '../export.js'

const props = defineProps({
  // { stage: 'options' | 'working' | 'done' | 'error', progress, url, name, message }
  state: { type: Object, required: true },
  size: { type: Object, required: true }, // the picture as it is painted
  video: { type: Boolean, default: false },
  whole: { type: Boolean, default: false },
  lengths: { type: Object, required: true }, // seconds: { effect, whole }
})
const emit = defineEmits(['start', 'cancel', 'close', 'download'])

const format = ref('mp4')
const height = ref(1080)
const fps = ref(30)
const all = ref(props.whole)

const FORMATS = [['mp4', 'MP4'], ['gif', 'GIF'], ['png', 'PNG']]

// What the chosen settings come to.
const summary = computed(() => {
  const { width, height: tall } = props.size
  if (format.value === 'png') return `The finished frame, ${width} × ${tall}.`
  const gif = format.value === 'gif'
  const out = gif ? fit(width, tall, { long: GIF_LONG }) : fit(width, tall, { short: height.value })
  const seconds = props.video && all.value && !gif ? props.lengths.whole : props.lengths.effect
  return `${out.width} × ${out.height} · ${gif ? GIF_FPS : fps.value} fps · ${seconds.toFixed(1)} s${gif ? ', looping' : ', no sound'}`
})

const start = () => emit('start', { format: format.value, height: height.value, fps: fps.value, whole: props.video && all.value })

function onKey(event) {
  if (event.key !== 'Escape') return
  if (props.state.stage === 'options') emit('cancel')
  else if (props.state.stage !== 'working') emit('close')
}
</script>

<template>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="export-title" @keydown="onKey">
    <div class="modal-box narrow">
      <h2 id="export-title">Export</h2>

      <template v-if="state.stage === 'options'">
        <div class="field inline">
          <span>Format</span>
          <div class="segmented" role="group" aria-label="Format">
            <button v-for="[id, label] in FORMATS" :key="id" type="button" :aria-pressed="format === id" autofocus @click="format = id">{{ label }}</button>
          </div>
        </div>
        <template v-if="format === 'mp4'">
          <div class="field inline">
            <span>Resolution</span>
            <div class="segmented" role="group" aria-label="Resolution">
              <button v-for="value in [720, 1080]" :key="value" type="button" :aria-pressed="height === value" @click="height = value">{{ value }}p</button>
            </div>
          </div>
          <div class="field inline">
            <span>Frame rate</span>
            <div class="segmented" role="group" aria-label="Frame rate">
              <button v-for="value in [30, 60]" :key="value" type="button" :aria-pressed="fps === value" @click="fps = value">{{ value }} fps</button>
            </div>
          </div>
          <div v-if="video" class="field inline">
            <span>Range</span>
            <div class="segmented" role="group" aria-label="Range">
              <button type="button" :aria-pressed="!all" @click="all = false">Effect only</button>
              <button type="button" :aria-pressed="all" @click="all = true">Whole video</button>
            </div>
          </div>
        </template>
        <p class="export-summary">{{ summary }}</p>
        <div class="modal-actions">
          <button type="button" @click="emit('cancel')">Cancel</button>
          <button class="primary" type="button" @click="start">Export</button>
        </div>
      </template>

      <template v-else-if="state.stage === 'working'">
        <p role="status">Rendering… {{ Math.round(state.progress * 100) }}%</p>
        <div class="export-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(state.progress * 100)">
          <span :style="{ width: `${state.progress * 100}%` }"></span>
        </div>
        <div class="modal-actions">
          <button type="button" autofocus @click="emit('cancel')">Cancel</button>
        </div>
      </template>

      <template v-else-if="state.stage === 'done'">
        <p role="status">Your file is ready. If the download did not start, use the button.</p>
        <div class="modal-actions">
          <button type="button" @click="emit('close')">Close</button>
          <button class="primary" type="button" autofocus @click="emit('download')">Download {{ state.name }}</button>
        </div>
      </template>

      <template v-else>
        <p role="alert">{{ state.message }}</p>
        <div class="modal-actions">
          <button type="button" autofocus @click="emit('close')">Close</button>
        </div>
      </template>
    </div>
  </div>
</template>
