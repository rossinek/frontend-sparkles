// "Reach": grows the subject matte along the depth map, to take in objects and limbs the
// cut-out model left behind. It runs on the CPU, once, before the matte goes to the
// renderer; everything downstream just sees a larger subject.

// How far outside the subject's own depth range a pixel may lie (depth is 0…255), and how far
// from the original matte the growth may travel, as a share of the long side. Without the
// second limit a floor or table at the subject's depth floods the frame at the first notch
// of the slider; with it the subject grows outwards gradually.
//
// Both grow gently over most of the slider and then open up toward the end, so that at
// full reach every depth is accepted at any distance: the subject is the whole picture.
const tolerance = reach => 40 * reach + 215 * reach ** 10
const travel = reach => 0.3 * reach + 1.7 * reach ** 10

// Two box passes: a soft, roughly Gaussian edge.
function blur(src, w, h, radius) {
  let a = src
  let b = new Float32Array(src.length)
  const norm = 1 / (2 * radius + 1)
  for (let pass = 0; pass < 4; pass++) {
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

/**
 * @param {{ width: number, height: number, data: Uint8Array }} matte the cut-out as it came from the model
 * @param {{ width: number, height: number, data: Uint8Array } | null} depth 255 = near
 * @param {number} reach 0…1; 0 returns the matte untouched, 1 covers the whole picture
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
export function growMatte(matte, depth, reach) {
  if (!depth || reach <= 0) return matte
  const { width: w, height: h } = matte
  const n = w * h
  if (reach >= 0.999) return { width: w, height: h, data: new Uint8Array(n).fill(255) }

  // Depth at the matte's resolution.
  const near = new Uint8Array(n)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(depth.height - 1, Math.floor(((y + 0.5) * depth.height) / h))
    for (let x = 0; x < w; x++) {
      near[y * w + x] = depth.data[sy * depth.width + Math.min(depth.width - 1, Math.floor(((x + 0.5) * depth.width) / w))]
    }
  }

  // The subject's own depth range, ignoring stray pixels at either end.
  const bins = new Uint32Array(256)
  let count = 0
  for (let i = 0; i < n; i++) {
    if (matte.data[i] < 128) continue
    bins[near[i]]++
    count++
  }
  if (!count) return matte
  let low = 0
  let high = 255
  for (let seen = 0; low < 255 && seen + bins[low] < count * 0.05; low++) seen += bins[low]
  for (let seen = 0; high > 0 && seen + bins[high] < count * 0.05; high--) seen += bins[high]
  const from = low - tolerance(reach)
  const to = high + tolerance(reach)

  // Flood outwards from the subject through neighbors whose depth is in range, so
  // everything taken in is connected to it.
  const grown = new Float32Array(n)
  const steps = new Int32Array(n) // traveled from the matte, in pixels; the queue is breadth-first
  const queue = new Int32Array(n)
  const limit = Math.round(travel(reach) * Math.max(w, h))
  let head = 0
  let tail = 0
  for (let i = 0; i < n; i++) {
    if (matte.data[i] < 128) continue
    grown[i] = 1
    queue[tail++] = i
  }
  const visit = (i, step) => {
    if (grown[i] || near[i] < from || near[i] > to) return
    grown[i] = 1
    steps[i] = step
    queue[tail++] = i
  }
  while (head < tail) {
    const i = queue[head++]
    const step = steps[i] + 1
    if (step > limit) continue
    const x = i % w
    if (x > 0) visit(i - 1, step)
    if (x < w - 1) visit(i + 1, step)
    if (i >= w) visit(i - w, step)
    if (i < n - w) visit(i + w, step)
  }

  // A soft edge instead of the flood's staircase; the original matte is never reduced.
  const soft = blur(grown, w, h, Math.max(2, Math.round(Math.max(w, h) / 340)))
  const data = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, (soft[i] - 0.3) / 0.4))
    data[i] = Math.max(matte.data[i], Math.round(255 * t * t * (3 - 2 * t)))
  }
  return { width: w, height: h, data }
}
