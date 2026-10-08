import { readFile, writeFile, mkdir, rm, cp, access } from 'node:fs/promises'
import { resolve, basename } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, '_site')
const experiments = JSON.parse(await readFile(resolve(root, 'experiments.json'), 'utf8'))
const base = (process.env.SITE_BASE || '/frontend-sparkles/').replace(/\/?$/, '/')
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const seen = new Set()
for (const experiment of experiments) {
  if (!/^[a-z][a-z0-9-]*$/.test(experiment.slug) || seen.has(experiment.slug)) throw new Error(`Invalid or duplicate slug: ${experiment.slug}`)
  seen.add(experiment.slug)
  if (!['pnpm', 'static'].includes(experiment.type)) throw new Error(`Unknown experiment type: ${experiment.type}`)
  await access(resolve(root, experiment.slug, 'index.html'))
}
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(resolve(root, 'public'), output, { recursive: true })
for (const experiment of experiments) {
  const directory = resolve(root, experiment.slug)
  if (experiment.type === 'pnpm') {
    if (process.env.CI) {
      const install = spawnSync('pnpm', ['--dir', directory, 'install', '--frozen-lockfile'], { stdio: 'inherit' })
      if (install.status !== 0) throw new Error(`Install failed: ${experiment.slug}`)
    }
    const build = spawnSync('pnpm', ['--dir', directory, 'run', 'build', '--base', `${base}${experiment.slug}/`], { stdio: 'inherit' })
    if (build.status !== 0) throw new Error(`Build failed: ${experiment.slug}`)
    await cp(resolve(directory, 'dist'), resolve(output, experiment.slug), { recursive: true })
  } else {
    await cp(directory, resolve(output, experiment.slug), {
      recursive: true,
      filter: path => !['node_modules', '.git', '.vite', 'dist'].includes(basename(path)),
    })
  }
}
const cards = experiments.map((experiment, index) => `
<a class="experiment" href="./${escape(experiment.slug)}/">
  <div class="card-top"><span class="number">${String(index + 1).padStart(2, '0')}</span><span class="arrow" aria-hidden="true">↗</span></div>
  <h2>${escape(experiment.name)}</h2>
  <p>${escape(experiment.description)}</p>
  <div class="tags">${experiment.tags.map(tag => `<span>${escape(tag)}</span>`).join('')}</div>
</a>`).join('\n')
const template = await readFile(resolve(root, 'index.html'), 'utf8')
await writeFile(resolve(output, 'index.html'), template.replace('<!-- EXPERIMENTS -->', cards))
await writeFile(resolve(output, '.nojekyll'), '')
console.log(`Built ${experiments.length} experiment(s) in _site/`)
