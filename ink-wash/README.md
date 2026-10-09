# Ink Wash

Drop in a photo and watch it turn into an ink painting: a bleached cloud of paper eats the photograph, a pencil sketch of the main subject appears, and sepia ink spreads through the drawing from several points before washing lightly into the background. Built with Vue, WebGL2 shaders, and Transformers.js. Everything runs in the browser; the photo is never uploaded.

## Run Locally

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite.

Use Node.js 22.12 or later and pnpm 11.

## Production Build

```sh
pnpm build
pnpm preview
```

## Controls

- **Use your photo** or drag and drop an image onto the page.
- **Play / pause** with the button, a click on the picture, or the space bar. The scrubber seeks anywhere in the animation.
- **New pour** keeps the photo but picks new starting points and paper.
- **Colour** tints the ink with the photo's own hues instead of plain sepia.
- **Sketch detail** sets how faint an edge still becomes a pencil stroke; **Sketch shading** sets how far the hatching reaches into lighter tones (zero removes it). While either slider is dragged, the bare drawing is shown so the change is easy to judge.

## How It Works

1. **Subject matte.** `src/engine/matte.worker.js` runs [RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) through Transformers.js in a Web Worker (WASM, 8-bit quantized, about 44 MB, cached by the browser after the first visit). If the model cannot load, a soft centred matte is used instead.
2. **Sketch.** `src/engine/shaders.js` blurs the photo's luminance at three scales and takes their differences, which leaves strokes on the dark side of each edge. The matte's outline is added as a contour, and shadows get a light hatch. No model is involved.
3. **Fronts.** `src/engine/fields.js` solves three shortest-path problems on a 512px grid: paper, a first ink wash, and a later pass for the darks. Each cell stores the moment the front reaches it. The medium is cellular noise, fast inside each cell and slow across its borders, which makes the front billow like a cloud; cell size varies from region to region. Every seed spreads at its own pace, so some grow into large blots while slow ones stay small droplets. Ink is also slowed by drawn edges and by the subject's outline, so it fills the figure before leaking into the background.
4. **Composite.** One fragment shader turns "seconds since the front arrived" into the look of each pixel: wet bleached paper that ages, pencil that breaks on the paper's tooth, and ink that arrives blurred and pale, then sharpens and deepens. A darker rim follows the wet front, pigment pools where the front crawled, water seeps slightly ahead, and late backruns leave pale blooms. Ink is mixed subtractively (`paper * pigment^density`).

The fronts are eased rather than linear: paper opens with a couple of slow puffs and then bursts, the first wash surges in right behind it and creeps to a stop, and the darks keep arriving after that. Because the fronts are precomputed, the animation is a pure function of time and can be scrubbed in both directions.

Timing lives in `TIMELINE` in `src/engine/renderer.js`; the look of the paper and ink is in the `COMPOSITE` shader.

## Credits and Licences

- Sample photo: "Helsinki woman in hat" by Toni Hukkanen, [CC0 via Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Helsinki_woman_in_hat_(Unsplash).jpg).
- RMBG-1.4 by BRIA AI is released for non-commercial use only. The weights are downloaded from Hugging Face at runtime and are not part of this repository.
