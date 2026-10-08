import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import Home from './Home.vue'
import Project from './Project.vue'
import { projects } from './projects'
import './style.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Home, meta: { title: 'Artur Rosa — Indie maker' } },
    ...projects.map(project => ({
      path: `/projects/${project.slug}`,
      component: Project,
      props: { project },
      meta: { title: `${project.name} — Artur Rosa` },
    })),
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach(to => {
  document.title = to.meta.title
})

createApp(App).use(router).mount('#app')
