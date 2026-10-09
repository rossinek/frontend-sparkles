// Low-resolution guide maps for the pencil hatching: everything that needs percentiles, a
// median, or wide blurs. All of it is smooth, so a 512px grid is plenty. The strokes
// themselves are drawn at full resolution by the HATCH shader. See SKETCH-PIPELINE.md.
//
// Arrays here run top row first; vectors and angles use image coordinates (y down).

export const GUIDE_SIZE = 512

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// Three box passes approximate a Gaussian.
function blur(src, w, h, sigma) {
  if (sigma < 0.45) return Float32Array.from(src)
  const radius = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2 - 0.5))
  let a = Float32Array.from(src)
  let b = new Float32Array(src.length)
  const norm = 1 / (2 * radius + 1)
  for (let pass = 0; pass < 6; pass++) {
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

// Value at quantile q of the selected entries, from a histogram of values in 0…max.
function quantile(values, q, select) {
  let max = 1e-12
  for (let i = 0; i < values.length; i++) if ((!select || select[i]) && values[i] > max) max = values[i]
  const bins = new Uint32Array(2048)
  let count = 0
  for (let i = 0; i < values.length; i++) {
    if (select && !select[i]) continue
    bins[Math.min(2047, Math.floor((values[i] / max) * 2047))]++
    count++
  }
  if (!count) return 0
  let seen = 0
  for (let b = 0; b < 2048; b++) {
    seen += bins[b]
    if (seen >= q * count) return ((b + 0.5) / 2047) * max
  }
  return max
}

function resample(map, w, h, mode = 'linear') {
  const out = new Float32Array(w * h)
  if (!map) return out
  const sx = map.width / w
  const sy = map.height / h
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mode === 'max') {
        // Thin lines must survive the reduction, so take the strongest source pixel.
        let best = 0
        const y1 = Math.min(map.height, Math.ceil((y + 1) * sy))
        const x1 = Math.min(map.width, Math.ceil((x + 1) * sx))
        for (let j = Math.floor(y * sy); j < y1; j++) {
          for (let i = Math.floor(x * sx); i < x1; i++) if (map.data[j * map.width + i] > best) best = map.data[j * map.width + i]
        }
        out[y * w + x] = best / 255
      } else {
        const fx = Math.min(map.width - 1, Math.max(0, (x + 0.5) * sx - 0.5))
        const fy = Math.min(map.height - 1, Math.max(0, (y + 0.5) * sy - 0.5))
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const x1 = Math.min(map.width - 1, x0 + 1)
        const y1 = Math.min(map.height - 1, y0 + 1)
        const tx = fx - x0
        const ty = fy - y0
        const top = map.data[y0 * map.width + x0] * (1 - tx) + map.data[y0 * map.width + x1] * tx
        const bottom = map.data[y1 * map.width + x0] * (1 - tx) + map.data[y1 * map.width + x1] * tx
        out[y * w + x] = (top * (1 - ty) + bottom * ty) / 255
      }
    }
  }
  return out
}

// Median over a square window, on values in 0…1 quantised to 256 levels.
function median(src, w, h, size) {
  const r = size >> 1
  const out = new Float32Array(w * h)
  const bins = new Uint16Array(256)
  const half = (size * size) >> 1
  for (let y = 0; y < h; y++) {
    bins.fill(0)
    const add = (x, delta) => {
      const cx = Math.min(w - 1, Math.max(0, x))
      for (let j = -r; j <= r; j++) bins[Math.round(src[Math.min(h - 1, Math.max(0, y + j)) * w + cx] * 255)] += delta
    }
    for (let x = -r; x <= r; x++) add(x, 1)
    for (let x = 0; x < w; x++) {
      let seen = 0
      let level = 0
      while (seen + bins[level] <= half) seen += bins[level++]
      out[y * w + x] = level / 255
      add(x - r, -1)
      add(x + r + 1, 1)
    }
  }
  return out
}

function gradient(src, w, h) {
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      gx[i] = (src[y * w + Math.min(w - 1, x + 1)] - src[y * w + Math.max(0, x - 1)]) * 0.5
      gy[i] = (src[Math.min(h - 1, y + 1) * w + x] - src[Math.max(0, y - 1) * w + x]) * 0.5
    }
  }
  return [gx, gy]
}

// Packs four planes into RGBA with rows flipped, so row 0 is the bottom as WebGL expects.
function pack(w, h, r, g, b, a) {
  const out = new Float32Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = y * w + x
      const to = ((h - 1 - y) * w + x) * 4
      out[to] = r[from]
      out[to + 1] = g[from]
      out[to + 2] = b ? b[from] : 0
      out[to + 3] = a ? a[from] : 0
    }
  }
  return out
}

/**
 * @param {ImageData} photo the photo already scaled so its long side is GUIDE_SIZE
 * @param {{ matte: object, line?: object, depth?: object, attention?: object }} maps model outputs, each { width, height, data: Uint8 }
 * @returns {{ width: number, height: number, tone: Float32Array, field: Float32Array, side: Float32Array }}
 *   tone  RGBA: dark, shade, focus, unused
 *   field RGBA: stroke direction as double angle — away from the focus (cos, sin), inside it (cos, sin)
 *   side  RGBA: contour coherence, shading side x, shading side y, unused
 */
export function buildGuides(photo, maps) {
  const { width: w, height: h } = photo
  const n = w * h
  const unit = Math.max(w, h) / 1400 // the reference measures everything at a 1400px long side

  const gray = new Float32Array(n)
  for (let i = 0; i < n; i++) gray[i] = (0.299 * photo.data[i * 4] + 0.587 * photo.data[i * 4 + 1] + 0.114 * photo.data[i * 4 + 2]) / 255
  const lo = quantile(gray, 0.02)
  const hi = quantile(gray, 0.98)
  const tone = new Float32Array(n)
  for (let i = 0; i < n; i++) tone[i] = 1 - Math.min(1, Math.max(0, (gray[i] - lo) / Math.max(hi - lo, 0.2)))

  // dark: broad tone, partly equalised so every photo uses all the passes.
  const dark = blur(tone, w, h, 5 * unit)
  const bins = new Uint32Array(256)
  for (let i = 0; i < n; i++) bins[Math.min(255, Math.floor(dark[i] * 255))]++
  const rank = new Float32Array(256)
  let seen = 0
  for (let b = 0; b < 256; b++) {
    rank[b] = (seen + bins[b] * 0.5) / n
    seen += bins[b]
  }
  for (let i = 0; i < n; i++) dark[i] = 0.35 * dark[i] + 0.65 * rank[Math.min(255, Math.floor(dark[i] * 255))]

  // shade: true darkness. The median drops texture and thin lines but keeps shadow edges.
  const shade = median(tone, w, h, 7)

  const matte = resample(maps.matte, w, h)
  const subject = new Float32Array(n)
  for (let i = 0; i < n; i++) subject[i] = smooth(0.3, 0.7, matte[i])

  const focus = maps.attention ? blur(resample(maps.attention, w, h), w, h, 10 * unit) : new Float32Array(n)
  for (let i = 0; i < n; i++) focus[i] = smooth(0.12, 0.8, focus[i])

  const line = resample(maps.line, w, h, 'max')
  const drawn = new Float32Array(n)
  for (let i = 0; i < n; i++) drawn[i] = line[i] * subject[i]

  // Shading side: towards the darker side of a broad step in brightness, otherwise one
  // shared direction, as if the scene were lit from a single side.
  const [sx, sy] = gradient(blur(shade, w, h, 14 * unit), w, h)
  const slope = new Float32Array(n)
  const onLine = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    slope[i] = Math.hypot(sx[i], sy[i])
    onLine[i] = drawn[i] > 0.2 ? 1 : 0
  }
  const steep = quantile(slope, 0.88, onLine) + 1e-9
  let mx = 0, my = 0, energy = 0
  for (let i = 0; i < n; i++) {
    if (!onLine[i]) continue
    mx += sx[i] * slope[i]
    my += sy[i] * slope[i]
    energy += slope[i] * slope[i]
  }
  const resultant = Math.hypot(mx, my) / (energy + 1e-9)
  const shared = resultant > 0.25 ? [mx / Math.hypot(mx, my), my / Math.hypot(mx, my)] : [0.6, 0.8]
  let nx = new Float32Array(n)
  let ny = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const conf = smooth(0.3, 0.85, slope[i] / steep)
    nx[i] = (conf * sx[i]) / (slope[i] + 1e-9) + (1 - conf) * shared[0]
    ny[i] = (conf * sy[i]) / (slope[i] + 1e-9) + (1 - conf) * shared[1]
  }
  nx = blur(nx, w, h, 4 * unit)
  ny = blur(ny, w, h, 4 * unit)
  for (let i = 0; i < n; i++) {
    const length = Math.hypot(nx[i], ny[i]) + 1e-9
    nx[i] /= length
    ny[i] /= length
  }

  // Direction away from the focus: wrap the form (depth gradient), a writing slant where flat.
  const awayCos = new Float32Array(n)
  const awaySin = new Float32Array(n)
  const slant = -Math.PI / 4
  if (maps.depth) {
    const [dx, dy] = gradient(blur(resample(maps.depth, w, h), w, h, 7 * unit), w, h)
    const mag = new Float32Array(n)
    for (let i = 0; i < n; i++) mag[i] = Math.hypot(dx[i], dy[i])
    const strong = quantile(mag, 0.92) + 1e-9
    for (let i = 0; i < n; i++) {
      const conf = Math.min(1, mag[i] / strong)
      const form = Math.atan2(dy[i], dx[i])
      awayCos[i] = conf * Math.cos(2 * form) + (1 - conf) * 0.6 * Math.cos(2 * slant)
      awaySin[i] = conf * Math.sin(2 * form) + (1 - conf) * 0.6 * Math.sin(2 * slant)
    }
  } else {
    awayCos.fill(Math.cos(2 * slant))
    awaySin.fill(Math.sin(2 * slant))
  }

  // Direction inside the focus: off the contours at an angle (structure tensor of the lines).
  const [lx, ly] = gradient(blur(drawn, w, h, 2.5 * unit), w, h)
  const xx = new Float32Array(n)
  const yy = new Float32Array(n)
  const xy = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    xx[i] = lx[i] * lx[i]
    yy[i] = ly[i] * ly[i]
    xy[i] = lx[i] * ly[i]
  }
  const jxx = blur(xx, w, h, 6 * unit)
  const jyy = blur(yy, w, h, 6 * unit)
  const jxy = blur(xy, w, h, 6 * unit)
  const coherence = new Float32Array(n)
  const insideCos = new Float32Array(n)
  const insideSin = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const tangent = 0.5 * Math.atan2(2 * jxy[i], jxx[i] - jyy[i]) + Math.PI / 2 + (50 * Math.PI) / 180
    coherence[i] = Math.sqrt((jxx[i] - jyy[i]) ** 2 + 4 * jxy[i] ** 2) / (jxx[i] + jyy[i] + 1e-12)
    insideCos[i] = Math.cos(2 * tangent) * coherence[i]
    insideSin[i] = Math.sin(2 * tangent) * coherence[i]
  }

  return {
    width: w,
    height: h,
    tone: pack(w, h, dark, shade, focus),
    field: pack(w, h, blur(awayCos, w, h, 22 * unit), blur(awaySin, w, h, 22 * unit), blur(insideCos, w, h, 5 * unit), blur(insideSin, w, h, 5 * unit)),
    side: pack(w, h, coherence, nx, ny),
  }
}
