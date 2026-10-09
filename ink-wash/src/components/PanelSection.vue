<script setup>
import { ref, useId } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  open: { type: Boolean, default: true },
})

const expanded = ref(props.open)
const id = useId()
</script>

<template>
  <section class="panel-section" :class="{ expanded, 'has-actions': $slots.actions }">
    <div class="panel-head">
      <h2>
        <button type="button" class="panel-toggle" :aria-expanded="expanded" :aria-controls="id" @click="expanded = !expanded">
          <span>{{ title }}</span>
          <svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5" /></svg>
        </button>
      </h2>
      <!-- Buttons cannot nest, so section actions sit over the header, just left of the chevron. -->
      <div v-if="$slots.actions" class="panel-head-actions"><slot name="actions" /></div>
    </div>
    <!-- The row goes from 0fr to 1fr, which animates to the content's own height. -->
    <div :id="id" class="panel-body" :inert="!expanded">
      <div class="panel-content"><slot /></div>
    </div>
  </section>
</template>
