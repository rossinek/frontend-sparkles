<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { asset, chosenFile, EXAMPLE, SAMPLES } from './source.js'

const router = useRouter()
const fileInput = ref(null)
const over = ref(false)
const problem = ref('')

function use(file) {
  if (!file) return
  if (!/^(image|video)\//.test(file.type)) {
    problem.value = 'That file is not a photo or a video.'
    return
  }
  chosenFile.value = file
  router.push({ name: 'edit' })
}

function pick(event) {
  use(event.target.files[0])
  event.target.value = ''
}

function drop(event) {
  over.value = false
  use(event.dataTransfer.files[0])
}
</script>

<template>
  <main class="start" @dragover.prevent="over = true" @dragleave.prevent="over = false" @drop.prevent="drop">
    <section class="start-intro">
      <h1>Ink Wash</h1>
      <p class="lead">Turn a photo into a pencil sketch that fills with spreading ink.</p>
      <ul class="facts">
        <li><strong>Free</strong> No account, no limits.</li>
        <li><strong>Private</strong> Runs in your browser; your photo never leaves your device.</li>
      </ul>
      <figure class="example">
        <div class="prints">
          <div class="print before">
            <img :src="asset('example/before.jpg')" alt="A woman in a black hat on a city street, her hair blown by the wind" width="1200" height="800">
            <span>Before</span>
          </div>
          <div class="print after">
            <img :src="asset('example/after.jpg')" alt="The same photo as a sepia ink painting over a pencil sketch" width="1200" height="800">
            <span>After</span>
            <p class="credit">Photo by <a :href="EXAMPLE.page" target="_blank" rel="noopener">{{ EXAMPLE.by }}</a>.</p>
          </div>
        </div>
      </figure>
    </section>

    <section class="start-source">
      <button class="dropzone" :class="{ over }" type="button" @click="fileInput.click()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
        <strong>Drop a photo or video here</strong>
        <span>or click to choose one</span>
      </button>
      <input ref="fileInput" type="file" accept="image/*,video/*" hidden @change="pick">
      <p v-if="problem" class="problem" role="alert">{{ problem }}</p>

      <h2>Try one of these</h2>
      <ul class="samples">
        <li v-for="sample in SAMPLES" :key="sample.id">
          <RouterLink :to="{ name: 'edit', params: { sample: sample.id } }" class="sample">
            <img :src="asset(`samples/${sample.id}-thumb.jpg`)" :alt="sample.alt" :class="{ portrait: sample.portrait }" loading="lazy">
          </RouterLink>
          <a :href="sample.page" target="_blank" rel="noopener">by {{ sample.by }}</a>
        </li>
      </ul>
      <p class="fine">The first run downloads about 160 MB of models, then they are cached.</p>
    </section>
  </main>
</template>
