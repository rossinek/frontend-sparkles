<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const pageHost = ref(null)
const effectHost = ref(null)
const transitioning = ref(false)
const shadowMuted = ref(false)
let effect
let shadowFrame
let busy = false
let restoreOverflow = ''

function finish() {
  busy = false
  transitioning.value = false
  document.body.style.overflow = restoreOverflow
  nextTick(() => {
    pageHost.value?.querySelector('main')?.focus({ preventScroll: true })
    shadowFrame = requestAnimationFrame(() => { shadowMuted.value = false })
  })
}

const removeBefore = router.beforeEach(async (to, from) => {
  if (busy) return false
  const card = pageHost.value?.querySelector('main')
  if (!card || to.fullPath === from.fullPath || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  busy = true
  try {
    const { ParticleTransition } = await import('./particleTransition')
    effect ??= new ParticleTransition(effectHost.value)
    await effect.prepare(card)
    restoreOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    busy = true
    shadowMuted.value = true
    transitioning.value = true
  } catch (error) {
    busy = false
    console.warn('The 3D transition is unavailable; using direct navigation.', error)
    effect?.stop()
  }
})

const removeAfter = router.afterEach(async (_to, _from, failure) => {
  if (failure) return
  await nextTick()
  if (!transitioning.value) {
    pageHost.value?.querySelector('main')?.focus({ preventScroll: true })
    return
  }
  const card = pageHost.value?.querySelector('main')
  try {
    window.scrollTo(0, 0)
    await effect.play(card, () => { transitioning.value = false })
  } catch (error) {
    effect.stop()
    console.warn('The 3D transition could not finish; showing the destination page.', error)
  } finally {
    finish()
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(shadowFrame)
  removeBefore()
  removeAfter()
  effect?.dispose()
  if (transitioning.value) finish()
})
</script>

<template>
  <div ref="pageHost" class="page-host" :class="{ 'is-transitioning': transitioning, 'is-shadow-muted': shadowMuted }" :inert="transitioning">
    <RouterView />
  </div>
  <div ref="effectHost" class="particle-transition" aria-hidden="true"></div>
</template>
