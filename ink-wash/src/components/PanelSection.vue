<script setup>
import { ref, useId, watch } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  open: { type: Boolean, default: true },
  // A section with nothing in it yet: the header shows a plus and asks for its content.
  add: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['add'])

const expanded = ref(props.open)
// The content is clipped while it folds or unfolds. Once it is open and at rest the clip
// comes off, so tooltips inside can hang over the section's edge.
const settled = ref(props.open)
const id = useId()
let timer = 0

function toggle() {
  if (props.add) return emit('add')
  clearTimeout(timer)
  settled.value = false
  expanded.value = !expanded.value
  if (expanded.value) timer = setTimeout(() => { settled.value = true }, 320)
}

// Content that has just been added is shown, whatever the fold was before.
watch(() => props.add, value => {
  clearTimeout(timer)
  expanded.value = true
  settled.value = false
  if (!value) timer = setTimeout(() => { settled.value = true }, 320)
})
</script>

<template>
  <section class="panel-section" :class="{ expanded: expanded && !add, settled: settled && !add, adding: add, 'has-actions': $slots.actions }">
    <div class="panel-head">
      <h2>
        <button type="button" class="panel-toggle" :aria-expanded="add ? undefined : expanded" :aria-controls="id" :aria-label="add ? `Add ${title.toLowerCase()}` : undefined" :disabled="disabled" @click="toggle">
          <span>{{ title }}</span>
          <svg v-if="add" class="plus" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1v10M1 6h10" /></svg>
          <svg v-else viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5" /></svg>
        </button>
      </h2>
      <!-- Buttons cannot nest, so section actions sit over the header, just left of the chevron. -->
      <div v-if="$slots.actions" class="panel-head-actions"><slot name="actions" /></div>
    </div>
    <!-- The row goes from 0fr to 1fr, which animates to the content's own height. -->
    <div :id="id" class="panel-body" :inert="!expanded || add">
      <div class="panel-content"><slot /></div>
    </div>
  </section>
</template>
