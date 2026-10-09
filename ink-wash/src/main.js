import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import Start from './Start.vue'
import './style.css'

// Hash routing, so both screens open directly on plain static hosting.
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'start', component: Start },
    { path: '/edit/:sample?', name: 'edit', component: () => import('./Editor.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

createApp(App).use(router).mount('#app')
