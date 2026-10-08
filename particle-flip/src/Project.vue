<script setup>
import ProjectMark from './components/ProjectMark.vue'
import ArrowIcon from './components/ArrowIcon.vue'
defineProps({ project: { type: Object, required: true } })
</script>

<template>
  <main class="detail-shell" tabindex="-1">
    <header class="detail-header">
      <RouterLink to="/" class="back-link"><span aria-hidden="true">←</span> Back to portfolio</RouterLink>
      <span class="detail-signature">Artur Rosa<span> / Indie maker</span></span>
    </header>
    <section class="detail-content">
      <div class="detail-art" :class="project.theme">
        <span class="detail-art-label">A little project by Artur Rosa</span>
        <ProjectMark :kind="project.mark" />
        <span class="detail-art-bottom">{{ project.category }} <span aria-hidden="true">↗</span></span>
      </div>
      <div class="detail-copy">
        <span class="eyebrow">Independent projects / {{ project.category }}</span>
        <h1 :class="{ 'long-project-name': project.theme === 'fonts' }">{{ project.name }}</h1>
        <p class="detail-tagline">{{ project.label }}</p>
        <p class="detail-description">{{ project.description }}</p>
        <a :href="project.url" class="visit-link" target="_blank" rel="noopener noreferrer">Visit {{ project.domain }}<ArrowIcon /><span class="sr-only"> (opens in a new tab)</span></a>
        <p class="demo-note">A simple portfolio preview. More of the story to come.</p>
      </div>
    </section>
    <footer class="detail-footer">Built for people, not for data.</footer>
  </main>
</template>
