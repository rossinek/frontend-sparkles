// Arrival-time fields. Each front (paper, ink) is solved once as a shortest-path
// problem through a random medium, so the animation is a pure function of time
// and can be scrubbed freely. Rows run bottom-up, matching WebGL readbacks.

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Distance to the nearest jittered feature point, in cell units (0 at a point, ~1 at cell borders).
function worley(w, h, cell, rand) {
  const gw = Math.ceil(w / cell) + 2
  const gh = Math.ceil(h / cell) + 2
  const px = new Float32Array(gw * gh)
  const py = new Float32Array(gw * gh)
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      px[j * gw + i] = (i - 1 + rand()) * cell
      py[j * gw + i] = (j - 1 + rand()) * cell
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const cj = Math.floor(y / cell) + 1
    for (let x = 0; x < w; x++) {
      const ci = Math.floor(x / cell) + 1
      let best = Infinity
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (let i = ci - 1; i <= ci + 1; i++) {
          const k = j * gw + i
          const dx = px[k] - x
          const dy = py[k] - y
          const d = dx * dx + dy * dy
          if (d < best) best = d
        }
      }
      out[y * w + x] = Math.sqrt(best) / cell
    }
  }
  return out
}

// Smooth random field in 0..1, used to vary the grain of the medium from region to region.
function valueNoise(w, h, cell, rand) {
  const gw = Math.ceil(w / cell) + 2
  const gh = Math.ceil(h / cell) + 2
  const grid = new Float32Array(gw * gh)
  for (let i = 0; i < grid.length; i++) grid[i] = rand()
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const fy = y / cell
    const j = Math.floor(fy)
    const ty = (fy - j) * (fy - j) * (3 - 2 * (fy - j))
    for (let x = 0; x < w; x++) {
      const fx = x / cell
      const i = Math.floor(fx)
      const tx = (fx - i) * (fx - i) * (3 - 2 * (fx - i))
      const k = j * gw + i
      const top = grid[k] + (grid[k + 1] - grid[k]) * tx
      const bottom = grid[k + gw] + (grid[k + gw + 1] - grid[k + gw]) * tx
      out[y * w + x] = top + (bottom - top) * ty
    }
  }
  return out
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// 16-neighbour stencil keeps fronts round instead of octagonal.
const STENCIL = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2],
].map(([dx, dy]) => [dx, dy, Math.hypot(dx, dy)])

// Each seed spreads at its own pace (cost multiplier), so fast seeds grow into large
// blots while slow ones stay small until a neighbour swallows them.
function dijkstra(w, h, cost, seeds) {
  const n = w * h
  const dist = new Float32Array(n).fill(Infinity)
  const owner = new Int16Array(n).fill(-1)
  const pace = new Float32Array(n).fill(1)
  const heap = new Int32Array(n)
  const pos = new Int32Array(n).fill(-1)
  let size = 0
  const up = i => {
    const node = heap[i]
    const key = dist[node]
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (dist[heap[parent]] <= key) break
      heap[i] = heap[parent]
      pos[heap[i]] = i
      i = parent
    }
    heap[i] = node
    pos[node] = i
  }
  const down = i => {
    const node = heap[i]
    const key = dist[node]
    for (;;) {
      let child = 2 * i + 1
      if (child >= size) break
      if (child + 1 < size && dist[heap[child + 1]] < dist[heap[child]]) child++
      if (dist[heap[child]] >= key) break
      heap[i] = heap[child]
      pos[heap[i]] = i
      i = child
    }
    heap[i] = node
    pos[node] = i
  }
  const relax = (node, value, seed) => {
    if (value >= dist[node]) return
    dist[node] = value
    owner[node] = seed
    if (pos[node] < 0) {
      heap[size] = node
      up(size++)
    } else up(pos[node])
  }
  seeds.forEach((seed, index) => {
    const x = Math.min(w - 1, Math.max(0, Math.round(seed.x)))
    const y = Math.min(h - 1, Math.max(0, Math.round(seed.y)))
    relax(y * w + x, seed.t, index)
  })
  while (size > 0) {
    const node = heap[0]
    pos[node] = -2
    const last = heap[--size]
    if (size > 0) {
      heap[0] = last
      down(0)
    }
    const x = node % w
    const y = (node - x) / w
    const base = dist[node]
    const c = cost[node]
    const seed = owner[node]
    const slow = seeds[seed].pace ?? 1
    pace[node] = slow
    for (const [dx, dy, len] of STENCIL) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const next = ny * w + nx
      if (pos[next] === -2) continue
      relax(next, base + len * 0.5 * (c + cost[next]) * slow, seed)
    }
  }
  return { dist, pace }
}

function blur(src, w, h, radius, passes = 2) {
  let a = src
  let b = new Float32Array(src.length)
  const norm = 1 / (2 * radius + 1)
  for (let pass = 0; pass < passes * 2; pass++) {
    const horizontal = pass % 2 === 0
    const lines = horizontal ? h : w
    const len = horizontal ? w : h
    const step = horizontal ? 1 : w
    for (let l = 0; l < lines; l++) {
      const start = horizontal ? l * w : l
      let sum = 0
      for (let i = -radius; i <= radius; i++) sum += a[start + Math.min(len - 1, Math.max(0, i)) * step]
      for (let i = 0; i < len; i++) {
        b[start + i * step] = sum * norm
        sum += a[start + Math.min(len - 1, i + radius + 1) * step] - a[start + Math.max(0, i - radius) * step]
      }
    }
    ;[a, b] = [b, a]
  }
  return a
}

// Rescales so the front has covered ~everything at 1. With a margin around the frame, only
// the frame itself counts, so the timing inside it does not change.
function normalize(field, outside) {
  const sample = []
  for (let i = 0; i < field.length; i += 7) if (!outside || outside[i] === 0) sample.push(field[i])
  sample.sort((p, q) => p - q)
  const scale = 1 / (sample[Math.floor(sample.length * 0.995)] || 1)
  for (let i = 0; i < field.length; i++) field[i] *= scale
  return field
}

// Where the front crawled, pigment had time to settle: gradient magnitude relative to the median.
function slowness(field, w, h, pace) {
  const out = new Float32Array(w * h)
  const sample = []
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const g = Math.hypot(field[i + 1] - field[i - 1], field[i + w] - field[i - w]) / pace[i]
      out[i] = g
      if ((i & 15) === 0) sample.push(g)
    }
  }
  sample.sort((p, q) => p - q)
  const median = sample[sample.length >> 1] || 1e-6
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, (out[i] / median - 1.6) / 5))
  return blur(out, w, h, 1, 1)
}

// Picks well-separated points, favouring high weights.
function pickSeeds(w, h, weight, count, minDist, rand) {
  const picked = []
  for (let attempt = 0; attempt < count * 400 && picked.length < count; attempt++) {
    const x = Math.floor(rand() * w)
    const y = Math.floor(rand() * h)
    if (rand() > weight[y * w + x]) continue
    if (picked.some(p => Math.hypot(p.x - x, p.y - y) < minDist)) continue
    picked.push({ x, y })
  }
  return picked
}

/**
 * A soft continuation of the photo onto the wider sheet, so nothing past its edge is
 * a stretched edge pixel. Each quantity is spread outwards with a blur that grows with
 * distance (a normalised convolution over several scales). Subject and background are
 * continued separately, so a dark figure does not smear into the pale ground beside it.
 *
 * @param {{ width: number, height: number, matte: Float32Array, luma: Float32Array, edge: Float32Array, outside: Float32Array }} input
 *   padded maps; `outside` is 0 inside the photo
 * @returns {Float32Array} RGBA: subject tone, background tone, matte, how busy the nearby edge is
 */
export function extendSheet({ width: w, height: h, matte, luma, edge, outside }) {
  const n = w * h
  const inFrame = new Float32Array(n)
  const weightSubject = new Float32Array(n)
  const weightGround = new Float32Array(n)
  const toneSubject = new Float32Array(n)
  const toneGround = new Float32Array(n)
  const matteIn = new Float32Array(n)
  const busyIn = blur(edge, w, h, 5, 2)
  for (let i = 0; i < n; i++) {
    if (outside[i] > 0) {
      busyIn[i] = 0
      continue
    }
    inFrame[i] = 1
    weightSubject[i] = matte[i]
    weightGround[i] = 1 - matte[i]
    toneSubject[i] = luma[i] * matte[i]
    toneGround[i] = luma[i] * (1 - matte[i])
    matteIn[i] = matte[i]
  }
  const sums = Array.from({ length: 7 }, () => new Float32Array(n))
  const sources = [toneSubject, weightSubject, toneGround, weightGround, matteIn, busyIn, inFrame]
  // Fine scales carry far more weight, so each place takes the finest scale that reaches it.
  for (const radius of [1, 2, 4, 8, 16, 32, 64, 128]) {
    const weight = 1 / (radius * radius)
    sources.forEach((source, k) => {
      const spread = blur(source, w, h, radius, 2)
      const sum = sums[k]
      for (let i = 0; i < n; i++) sum[i] += spread[i] * weight
    })
  }
  const sample = []
  for (let i = 0; i < n; i += 5) if (outside[i] === 0) sample.push(busyIn[i])
  sample.sort((p, q) => p - q)
  const lively = sample[Math.floor(sample.length * 0.9)] || 1
  const out = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const ground = sums[2][i] / (sums[3][i] + 1e-9)
    out[i * 4] = sums[1][i] > 1e-7 ? sums[0][i] / sums[1][i] : ground
    out[i * 4 + 1] = sums[3][i] > 1e-7 ? ground : sums[0][i] / (sums[1][i] + 1e-9)
    out[i * 4 + 2] = sums[4][i] / (sums[6][i] + 1e-9)
    out[i * 4 + 3] = smooth(0.35, 1.0, sums[5][i] / (sums[6][i] + 1e-9) / lively)
  }
  return out
}

/**
 * @param {{ width: number, height: number, matte: Float32Array, luma: Float32Array, edge: Float32Array, seed: number }} input
 * @returns {{ width: number, height: number, data: Float32Array, second: Float32Array }}
 *   data RGBA: paper time, ink time, ink slowness, paper slowness; second RG: dark-pass time and slowness
 */
export function buildFields({ width: w, height: h, matte, luma, edge, seed, outside = null, frameLong = 0 }) {
  const rand = mulberry32(seed)
  const n = w * h
  const long = frameLong || Math.max(w, h) // lengths stay tied to the frame, not the margin

  // Subject geometry.
  let total = 0, top = 0, bottom = h, left = w, right = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = matte[y * w + x]
      if (m < 0.5) continue
      total++
      if (y > top) top = y
      if (y < bottom) bottom = y
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  const hasSubject = total > n * 0.01 && total < n * 0.97
  let head = { x: w * 0.5, y: h * 0.6 }
  if (hasSubject) {
    const from = top - (top - bottom) * 0.28
    let sx = 0, sy = 0, count = 0
    for (let y = Math.floor(from); y <= top; y++) {
      for (let x = left; x <= right; x++) {
        if (matte[y * w + x] < 0.5) continue
        sx += x; sy += y; count++
      }
    }
    if (count) head = { x: sx / count, y: sy / count }
  }

  // The medium is cellular: fast inside each cell, slow across its borders, so a front
  // puffs outward cell by cell. Cell size changes from region to region, which gives
  // broad smooth lobes in one place and fine cauliflower edges in another.
  const cells = (scale, from, to) => {
    const field = worley(w, h, long / scale, rand)
    for (let i = 0; i < n; i++) field[i] = smooth(from, to, field[i])
    return field
  }
  const range = (a, b) => a + (b - a) * rand()
  const edgePoint = () => {
    const side = Math.floor(rand() * 3)
    if (side === 0) return { x: rand() * w, y: 0 }
    return { x: side === 1 ? 0 : w - 1, y: rand() * h * 0.6 }
  }

  // Paper: two slow puffs open around the head, then a large fast billow bursts from
  // below and others sweep in from the edges, with small satellite puffs ahead of them.
  const paperCost = new Float32Array(n)
  {
    const broad = cells(4.5, 0.3, 0.8)
    const mid = cells(10, 0.3, 0.75)
    const tiny = cells(27, 0.25, 0.7)
    const grain = valueNoise(w, h, long / 3, rand)
    for (let i = 0; i < n; i++) {
      const g = smooth(0.3, 0.7, grain[i])
      paperCost[i] = 0.3 + (1 - g) * (2.8 * broad[i] + 0.5 * tiny[i]) + g * (1.5 * mid[i] + 1.4 * tiny[i])
    }
  }
  const paperSeeds = [
    { ...head, t: 0, pace: 1.6 },
    { x: head.x + range(-0.16, 0.16) * long, y: head.y - range(0.02, 0.1) * long, t: long * 0.05, pace: 1.3 },
    { x: head.x + range(-0.2, 0.2) * long, y: Math.max(0, head.y - long * range(0.3, 0.45)), t: long * 0.15, pace: 0.42 },
    { ...edgePoint(), t: long * 0.24, pace: 0.6 },
    { ...edgePoint(), t: long * 0.36, pace: 0.85 },
  ]
  for (let i = 0; i < 8; i++) {
    paperSeeds.push({ x: rand() * w, y: rand() * h, t: long * range(0.12, 0.55), pace: range(2.2, 3.6) })
  }
  const paperRun = dijkstra(w, h, paperCost, paperSeeds)
  const paper = normalize(blur(paperRun.dist, w, h, 1, 1), outside)

  // Ink: a first wash starts in the darkest parts of the subject, pools along drawn
  // edges, and only then leaks through the outline into the background. Seeds differ
  // widely in pace, and slow droplets land around them.
  const inside = new Float32Array(n)
  const darkness = new Float32Array(n)
  const deep = new Float32Array(n)
  const openness = new Float32Array(n)
  const anywhere = new Float32Array(n).fill(1)
  for (let i = 0; i < n; i++) {
    inside[i] = hasSubject ? matte[i] : 1
    const dark = 1 - luma[i]
    darkness[i] = inside[i] > 0.6 ? 0.05 + 0.95 * dark * dark : 0
    deep[i] = inside[i] > 0.6 ? dark * dark * dark : 0
    openness[i] = inside[i] < 0.2 ? 1 : 0
    // With a margin, blots may start only in the frame or just past it.
    if (outside && outside[i] > 0.1) {
      openness[i] = 0
      anywhere[i] = 0
    }
  }
  const inkCost = new Float32Array(n)
  const accentCost = new Float32Array(n)
  {
    const mid = cells(9, 0.35, 0.8)
    const fineCells = cells(26, 0.3, 0.8)
    const broad = cells(5, 0.35, 0.85)
    const grain = valueNoise(w, h, long / 3.5, rand)
    const accentCells = cells(17, 0.3, 0.8)
    for (let i = 0; i < n; i++) {
      const g = smooth(0.3, 0.7, grain[i])
      const outline = hasSubject ? 4 * inside[i] * (1 - inside[i]) : 0
      const medium = 0.4 + (1 - g) * (2.2 * broad[i] + 0.6 * fineCells[i]) + g * (1.2 * mid[i] + 1.5 * fineCells[i])
      // Beyond the frame the paper is dry: the ink slows down and stalls a little way out.
      // It dries unevenly, so the front leaves the photo ragged instead of as a rectangle.
      const dry = outside ? 1 + 2.5 * Math.pow(outside[i] / 0.33, 1.5) * (0.35 + 1.3 * broad[i]) : 1
      inkCost[i] = (medium * (1 + 5 * edge[i]) * (1.7 - 0.7 * inside[i]) + 9 * outline) * dry
      // The second, darker pass prefers shadows and hardly leaves the subject.
      accentCost[i] = (0.4 + 1.7 * accentCells[i] + 0.8 * mid[i]) * (1 + 3.5 * luma[i]) * (1 + 3 * edge[i]) * (3 - 2 * inside[i]) + 6 * outline
    }
  }
  const paces = [0.5, 0.65, 0.9, 1.3, 1.9, 2.6].sort(() => rand() - 0.5)
  const inkSeeds = [
    ...pickSeeds(w, h, darkness, 6, long * 0.1, rand).map((p, i) => ({ ...p, t: long * 0.34 * rand() ** 1.5, pace: paces[i] })),
    ...(hasSubject ? pickSeeds(w, h, openness, 5, long * 0.2, rand).map(p => ({ ...p, t: long * range(0.28, 0.6), pace: range(0.6, 1.6) })) : []),
    ...pickSeeds(w, h, anywhere, 16, long * 0.04, rand).map(p => ({ ...p, t: long * range(0.08, 0.75), pace: range(3, 5.5) })),
  ]
  if (!inkSeeds.length) inkSeeds.push({ ...head, t: 0 })
  const inkRun = dijkstra(w, h, inkCost, inkSeeds)
  const ink = normalize(blur(inkRun.dist, w, h, 1, 1), outside)

  const accentSeeds = [
    ...pickSeeds(w, h, deep, 9, long * 0.07, rand).map(p => ({ ...p, t: long * range(0, 0.5), pace: range(0.6, 2.4) })),
    ...pickSeeds(w, h, darkness, 8, long * 0.03, rand).map(p => ({ ...p, t: long * range(0.1, 0.7), pace: range(2.5, 4.5) })),
  ]
  if (!accentSeeds.length) accentSeeds.push({ ...head, t: 0 })
  const accentRun = dijkstra(w, h, accentCost, accentSeeds)
  const accent = normalize(blur(accentRun.dist, w, h, 1, 1), outside)

  const inkSlow = slowness(ink, w, h, inkRun.pace)
  const paperSlow = slowness(paper, w, h, paperRun.pace)
  const accentSlow = slowness(accent, w, h, accentRun.pace)
  const data = new Float32Array(n * 4)
  const second = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    data[i * 4] = paper[i]
    data[i * 4 + 1] = ink[i]
    data[i * 4 + 2] = inkSlow[i]
    data[i * 4 + 3] = paperSlow[i]
    second[i * 4] = accent[i]
    second[i * 4 + 1] = accentSlow[i]
  }
  return { width: w, height: h, data, second }
}
