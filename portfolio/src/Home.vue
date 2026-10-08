<script setup>
import { projects } from './projects'
import ProjectMark from './components/ProjectMark.vue'
import ArrowIcon from './components/ArrowIcon.vue'
const portraitUrl = `${import.meta.env.BASE_URL}artur-rosa.png`
</script>

<template>
  <main class="portfolio-shell" tabindex="-1">
    <section class="bio-card" aria-labelledby="bio-heading">
      <div class="bio-top"><span class="tiny-flower" aria-hidden="true">✳</span><span>A little about me</span></div>
      <div class="portrait-scene">
        <div class="portrait-circle"></div>
        <span class="portrait-spark" aria-hidden="true">✳</span>
        <img class="portrait" :src="portraitUrl" alt="Artur Rosa, wearing glasses and looking to the left" />
      </div>
      <div class="bio-copy">
        <span class="intro">I'm</span>
        <h1 id="bio-heading">Artur Rosa<span class="name-dot">.</span></h1>
        <p>Husband, father and indie maker building things for people, not for data.</p>
      </div>
      <div class="bio-bottom"><span>Independent by nature</span><span aria-hidden="true">↗</span></div>
    </section>

    <section class="work-section" aria-labelledby="work-heading">
      <header class="work-header">
        <h2 id="work-heading">Selected work<span class="heading-arrow" aria-hidden="true">↗</span></h2>
      </header>
      <div class="project-grid">
        <RouterLink :to="`/projects/${projects[0].slug}`" class="project-card subtitles-card" aria-label="Explore WithSubtitles">
          <div class="card-top"><span class="card-category">01 / Video & captions</span><ArrowIcon /></div>
          <div class="subtitle-art" aria-hidden="true">
            <div class="caption-line">Good stories.</div>
            <div class="caption-line caption-highlight">Every word.</div>
          </div>
          <ProjectMark kind="subtitles" class="caption-icon" />
          <div class="card-bottom"><div><h3>WithSubtitles</h3><p>{{ projects[0].label }}</p></div></div>
        </RouterLink>

        <nav class="social-stack" aria-label="Find me online">
          <a class="social-card x-card" href="https://x.com/rosickeyy" target="_blank" rel="noopener noreferrer" aria-label="Artur Rosa on X (opens in a new tab)">
            <svg class="social-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933ZM17.61 20.644h2.039L6.486 3.24H4.298L17.61 20.644Z" fill="currentColor" /></svg>
          </a>
          <a class="social-card website-card" href="https://arturrosa.pl" target="_blank" rel="noopener noreferrer" aria-label="Visit arturrosa.pl (opens in a new tab)">
            <svg class="social-symbol globe" viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="19" /><ellipse cx="24" cy="24" rx="8" ry="19" /><path d="M5 24h38M9 13h30M9 35h30" /></svg>
          </a>
        </nav>

        <RouterLink :to="`/projects/${projects[1].slug}`" class="project-card converter-card" aria-label="Explore WithConverter">
          <div class="card-top"><span class="card-category">02 / File conversion</span><ArrowIcon /></div>
          <div class="small-card-art"><ProjectMark kind="converter" /></div>
          <div class="card-bottom"><div><h3>WithConverter</h3><p>{{ projects[1].label }}</p></div></div>
        </RouterLink>

        <RouterLink :to="`/projects/${projects[2].slug}`" class="project-card fonts-card" aria-label="Explore whatthefreefont.com">
          <div class="card-top"><span class="card-category">03 / Typography</span><ArrowIcon /></div>
          <div class="small-card-art"><ProjectMark kind="fonts" /></div>
          <div class="card-bottom"><div><h3>whatthefreefont<span class="domain-suffix">.com</span></h3><p>{{ projects[2].label }}</p></div></div>
        </RouterLink>
      </div>
    </section>
  </main>
</template>
