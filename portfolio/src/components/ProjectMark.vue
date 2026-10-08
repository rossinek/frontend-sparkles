<script setup>
defineProps({ kind: { type: String, required: true } })
</script>

<template>
  <svg v-if="kind === 'subtitles'" class="project-mark" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" fill-rule="evenodd" d="M1 3h22v17H9.773l-1.528 3H6l1.529-3H1zm2 2v13h18V5zm11 11H5v-2h9zm2 0h3v-2h-3z" clip-rule="evenodd" />
  </svg>
  <svg v-else-if="kind === 'converter'" class="project-mark" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M2 8.75A6.75 6.75 0 0 1 15.459 8H12.25A4.25 4.25 0 0 0 8 12.25v3.209A6.75 6.75 0 0 1 2 8.75M12.25 9A3.25 3.25 0 0 0 9 12.25v6.5A3.25 3.25 0 0 0 12.25 22h6.5A3.25 3.25 0 0 0 22 18.75v-6.5A3.25 3.25 0 0 0 18.75 9z" />
  </svg>
  <span v-else class="project-mark font-mark" aria-hidden="true">Aa<span>✳</span></span>
</template>
