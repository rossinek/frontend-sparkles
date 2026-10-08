<script setup>
defineProps({ kind: { type: String, required: true } })
</script>

<template>
  <svg v-if="kind === 'subtitles'" class="project-mark" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" fill-rule="evenodd" d="M1 3h22v17H9.773l-1.528 3H6l1.529-3H1zm2 2v13h18V5zm11 11H5v-2h9zm2 0h3v-2h-3z" clip-rule="evenodd" />
  </svg>
  <svg v-else-if="kind === 'converter'" class="project-mark" viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <path d="M20 34h59L64 19M80 66H21l15 15" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M79 34 64 49M21 66l15-15" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
  <span v-else class="project-mark font-mark" aria-hidden="true">Aa<span>✳</span></span>
</template>
