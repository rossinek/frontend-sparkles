<script setup>
defineProps({ kind: { type: String, required: true } })
</script>

<template>
  <svg v-if="kind === 'subtitles'" class="project-mark" viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <rect x="10" y="19" width="80" height="62" rx="18" fill="currentColor" />
    <path d="M39 34 62 48 39 62Z" fill="var(--mark-cutout, #f8c7a7)" />
    <path d="M28 70h20m7 0h17" stroke="var(--mark-cutout, #f8c7a7)" stroke-width="5" stroke-linecap="round" />
  </svg>
  <svg v-else-if="kind === 'converter'" class="project-mark" viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <path d="M20 34h59L64 19M80 66H21l15 15" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M79 34 64 49M21 66l15-15" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
  <span v-else class="project-mark font-mark" aria-hidden="true">Aa<span>✳</span></span>
</template>
