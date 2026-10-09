# Pencil Sketch Pipeline

How the pencil sketch is made: clean model-drawn contours plus procedural hatching that knows where the viewer looks. The look was approved on the Python reference in `prototype/sketch_reference.py`; the app is a port of it.

Status: ported and running in the browser, matching the reference by eye on the test photos. The reference script stays until the browser version is approved, then it can be deleted.

## Goal

- Contours come from a line-drawing model, not from edges.
- Tone is carried by stroke density alone. No smudge or soft shading under the strokes.
- Away from the viewer's attention: long strokes, several crossing passes, density follows the tone.
- Inside the viewer's attention: short strokes, almost no crossing, and only on **one side** of a contour, never as a frame around it. Fewer strokes where the photo is light, more where it is dark.
- Everything outside the subject matte stays bare paper.

## Models

All run once per photo. Sizes are downloads.

| Model | Purpose | Size | Source | Input | Output |
| --- | --- | --- | --- | --- | --- |
| RMBG-1.4 (q8) | subject matte | 44 MB | `briaai/RMBG-1.4` | 1024×1024, `x/255 - 0.5` | matte; rescale min–max, then `smoothstep(0.3, 0.7)` to remove the faint haze the quantised model leaves in the background |
| Informative Drawings, **anime** style | contours | 17 MB | `x-Liola-x/informative-drawings-onnx`, `informative-drawings_anime_1024x1024.onnx` | `inputs`, 1024×1024, RGB `x/255`, photo squashed to a square | `outputs` 1×1×1024×1024, white paper and dark lines; `line = 1 - output` |
| Depth Anything V2 small (q8) | stroke direction away from the focus | 27 MB | `onnx-community/depth-anything-v2-small`, `onnx/model_quantized.onnx` | `pixel_values`, long side 518 rounded to a multiple of 14, ImageNet mean/std | `predicted_depth`; rescale min–max, 1 = near |
| UniSal (fp16) | where people look | 6.5 MB | `litert-community/UniSal-Saliency-LiteRT`, `unisal_fp16.tflite` | 256×256, ImageNet mean/std, NCHW | **logits**; `sigmoid`, then divide by the maximum |

The "contour" style of Informative Drawings was rejected: its lines are as bold as a felt pen and it dropped the sunglasses.

Licences: Informative Drawings MIT, Depth Anything V2 small Apache-2.0, UniSal Apache-2.0, RMBG-1.4 non-commercial.

## Maps

`unit = longSide / 1400`. Every length and blur radius below is in pixels at a 1400px long side and is multiplied by `unit`. `smooth(a, b, x)` is a smoothstep.

1. **tone** — grey photo, stretched between its 2nd and 98th percentile (range at least 0.2), inverted. 1 = dark.
2. **dark** — `tone` blurred (σ 5), then partially equalised: `0.35 * dark + 0.65 * rank(dark)`, where `rank` is the value's quantile within the image (256 levels). Every photo therefore uses all the passes.
3. **shade** — true darkness, used only inside the focus: `tone` at one third resolution, median 7×7, back up, blur σ 1.5. No equalisation, no lift.
4. **focus** — UniSal map blurred σ 10, then `smooth(0.12, 0.8)`.
5. **subject** — the matte.
6. **drawn** — `line * subject`, blurred σ 1.2.

### One-sided contour band

Shading leaves each contour towards one side only.

- `(dx, dy)` = gradient of `shade` blurred at σ 14. The scale is deliberately coarse: around a small closed shape (a digit, a spectacle frame) the gradient cancels out.
- `conf = smooth(0.3, 0.85, |grad| / p88)`, where `p88` is the 88th percentile of `|grad|` over pixels with `drawn > 0.2`.
- **shared** direction: the mean of `grad * |grad|` over those pixels, normalised. If its resultant, `|mean| / sum(|grad|²)`, is below 0.25, use `(0.6, 0.8)` instead (down and to the right).
- `n = normalise(conf * grad/|grad| + (1 - conf) * shared)`, each component blurred σ 4 before normalising.
- `band(x) = max over t in {1/14 … 14/14} of drawn(x - n(x) * 32 * t) * (1 - 0.5 * t)`, then `smooth(0.05, 0.32)`. A pixel is in the band when a contour lies just behind it.
- `nearContour = band * shade`.

### Stroke direction

Averaged as double angles (`cos 2θ`, `sin 2θ`) so opposite gradients agree.

- **Away from the focus**: along the gradient of depth (blurred σ 7), which wraps strokes around the form. Confidence = `|grad| / p92`, clipped to 1. Where it is low, fall back to a −45° slant weighted 0.6. Blur the double-angle field σ 22.
- **Inside the focus**: structure tensor of `line * subject` (blurred σ 2.5; tensor blurred σ 6). Tangent = `0.5 * atan2(2Jxy, Jxx - Jyy) + 90° + 50°`, so strokes come off a contour at an angle instead of doubling it. `coherence = sqrt((Jxx - Jyy)² + 4Jxy²) / (Jxx + Jyy)`. Blur `cos/sin(2 * tangent) * coherence` at σ 5.
- `pull = focus * smooth(0.15, 0.6, coherence)`; `field = away * (1 - pull) + inside * pull * 2`; `theta = 0.5 * atan2(sin, cos)`.

### Noise fields

All smooth random fields, fixed per photo:

- `wobble` — σ 22, amplitude 55 px; added across the stroke rows so they are not ruler-straight.
- `patch` — σ 40, normalised to ±1; breaks up the borders between direction patches.
- `cluster` — σ 26, mapped to 0…1; leaves gaps of bare paper in the two open passes.
- `dither` — white noise blurred σ 9; hides the steps between stroke-length levels.

## Hatching

Five passes, each tighter than the last and switching on as the driver darkens:

| Pass | Turn | Spacing | Length | Driver range |
| --- | --- | --- | --- | --- |
| 0 | 0° | 13 | 220 | 0.12 – 0.42 |
| 1 | 0° | 9 | 190 | 0.30 – 0.58 |
| 2 | +38° | 7.2 | 160 | 0.48 – 0.74 |
| 3 | −14° | 5.4 | 130 | 0.62 – 0.88 |
| 4 | +62° | 4.0 | 110 | 0.78 – 1.00 |

Per pixel, for each pass:

```
pushed   = clamp(dark + 0.14)
driver   = mix(pushed, nearContour, focus)
coverage = clamp((driver - lo) / (hi - lo))
if pass < 2: coverage *= 0.65 + 0.6 * cluster * (1 - focus) + 0.35 * focus
coverage *= subject
angle    = theta + turn * (1 - 0.85 * focus) + patch * 0.35 * (1 - focus)
k        = round(angle / 22.5°) mod 8            # snapped to 8 directions
level    = clamp(floor(focus * 3.999 + (dither - 0.5) * 3), 0, 3)
layer    = strokes(k * 22.5°, spacing, length, seed = 17 * pass + k, coverage, level, focus)
paper   *= 1 - 0.42 * layer
```

### One family of strokes

In coordinates rotated by the angle (`u` along the stroke, `v` across, `v += wobble`):

```
row      = floor(v / spacing)
segLen   = length * (0.55 + 0.9 * hash(row, seed))
along    = (u + hash(row, seed + 1) * 999) / segLen * 2^level
seg      = floor(along);  w = fract(along)
key      = seg + level * 7919
tilt     = (hash(row, key, seed + 2) - 0.5) * 0.55 * spacing
offset   = (hash(row, seed + 3) - 0.5) * 0.4 * spacing
d        = |(v / spacing - row - 0.5) * spacing - offset - (w - 0.5) * tilt|
pressure = (0.5 + 0.15 * focus) + (0.5 - 0.15 * focus) * hash(row, key, seed + 4)
taper    = smooth(0, 0.1, w) * smooth(1, 0.82, w)
exists   = smooth(0, 0.08, coverage - hash(row, key, seed + 5))
width    = 0.78 - 0.16 * focus
stroke   = exp(-(d / width)²) * pressure * taper * exists
```

Two details matter:

- **Levels halve the length.** A level-1 stroke is exactly half of a level-0 stroke, so where the level rises a long stroke breaks cleanly into shorter ones instead of tearing. Lengths run from 220 px down to about 27 px.
- **`exists` must be zero at zero coverage.** An earlier version used `smooth(-0.06, 0.06, …)`, which left about 6% of strokes alive everywhere and rained faint lines over the background.

### Final graphite

```
contour  = clamp(line * 1.6) ^ 0.85 * smooth(0.25, 0.6, blur(subject, σ 2))
graphite = 1 - (1 - 0.9 * contour) * paper
graphite *= 0.7 + 0.3 * tooth          # the app's COMPOSITE shader already does this part
```

## Sliders

Two controls replace "Sketch detail" and "Sketch shading".

- **Hatching** (0…1, default 0.5): overall amount. Scales the driver before the pass ranges, `driver *= 2 * hatching`; 0 leaves contours only.
- **Focus** (0…1, default 1): how much the viewer's attention changes the hatching. Implemented as `focus = focus * slider` everywhere above, which gives exactly the requested behaviour:
  - 0 — attention is ignored; the whole subject is hatched from tone alone.
  - 1 — as approved.
  - 0.5 — halfway: the attended area is partly hatched as usual and partly with the short one-sided strokes.

Dragging either keeps the existing bare-drawing preview.

## Browser Port

Split by what each side is good at.

- **Worker (`src/engine/models.worker.js`).** Matte, lines, and depth through Transformers.js. Each tries WebGPU first and falls back to WASM. On WebGPU the matte uses `fp16` (88 MB; the quantised model misbehaves there) and depth uses `fp16` (50 MB); on WASM both use the quantised files. The line model's repository has no config and keeps its files in the root, which `subfolder: ''` and `model_file_name` handle. Only the matte is required: without lines the edge-detection lines are used, without depth the strokes keep one slant, without attention `focus = 0`.
- **Main thread (`src/engine/attention.js`).** UniSal through LiteRT.js on its WASM backend. LiteRT.js calls `importScripts`, which module workers do not have, so it cannot live in the worker. Its runtime is loaded from jsDelivr rather than bundled (37 MB).
- **CPU, low resolution (`src/engine/guides.js`).** Everything that needs percentiles, a median, or wide blurs, on a 512px grid: `dark`, `shade`, `focus`, both direction fields, coherence, and the shading side `n`. Uploaded as three float textures. The median runs directly on the grid (7×7 there covers about the same area as the reference's window).
- **GPU, full resolution (`HATCH` in `src/engine/shaders.js`).** The contour band (14 taps of the line texture along `-n`) and the strokes. Each pixel evaluates only its own snapped direction, so a pass is one stroke evaluation, not eight. Rendered into its own `pencil` texture (R: all graphite, G: contours alone) and again whenever a slider moves.
- **Composite.** Reads the pencil texture; ink reinforces the contours only. The `sketch` texture keeps its smoothed luminance and edge strength for the ink fronts, and its edge-detection lines for the background and as the fallback.

Differences from the reference:

- The hash is sine-free (float32 `sin` of large arguments bands), so individual strokes differ while their statistics match.
- The noise fields are shader value noise tuned to the reference's amplitudes: wobble about ±1.5 px, patch turn about ±0.8, cluster spread over 0…1. The reference's length dither turned out to be negligible (about ±0.03 of a level) and is kept that small.
- The band's line taps are not blurred separately; the 1024px line texture stretched over the photo is already soft.

Measured in headless Chrome on an M-series Mac, warm: matte 0.3 s, lines 0.9 s, depth 0.2 s, attention 0.3 s on WebGPU; 7.6 s, 15.4 s, 5.7 s on WASM for the first three. First visit with downloads: about 11 s on WebGPU.

## Known Weak Spots

- Dark hair inside the focus comes out too empty: it only gets strokes beside contours. Large dark masses should probably fill in regardless.
- The edge of the attention blob can show on large even surfaces such as a T-shirt.
- The shared light direction is arbitrary on photos without clear lighting.
- RMBG sometimes keeps a piece of background (the corner behind the shoulder in the selfie test).
- A light face gets very few strokes; this is a consequence of multiplying by `shade`.

## Reference Timings

Native CPU, Python: lines 1.7 s, matte 0.5 s, depth 0.1–0.2 s, attention 0.1 s, hatching 6–10 s in NumPy.
