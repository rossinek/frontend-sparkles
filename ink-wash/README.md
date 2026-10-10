# Ink Wash

Drop in a photo and watch it turn into an ink painting: a bleached cloud of paper eats the photograph, a pencil sketch of the main subject appears, and sepia ink spreads through the drawing from several points before washing lightly into the background. Built with Vue, WebGL2 shaders, Transformers.js, and LiteRT.js. Everything runs in the browser; the photo is never uploaded.

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

- The **start screen** picks the photo: drop or choose your own, or try one of the samples. The title in the editor leads back to it.
- **Replace photo** or drag and drop an image or video onto the editor to swap it.
- With a **video**, the effect still runs on a single frame. A dialog asks for that keyframe as soon as the video is loaded, and **Change keyframe** reopens it. The video plays up to the keyframe, stops for the effect, and carries on. The effect starts early enough that its first blots spend 0.4 s opening over a picture that is still moving. With Outro on, the video likewise starts again as the outro begins, so what spreads back over the painting is already in motion. **Effect only** (the default) and **Whole video** switch the preview between one second either side of the effect and the full clip; on the timeline the effect is the taller band.
- **Play / pause** with the button, a click on the picture, or the space bar. The scrubber seeks anywhere in the animation.
- **New pour** keeps the photo but picks new starting points and paper.
- **Color** tints the ink with the photo's own hues instead of plain sepia.
- **Reach** grows the subject along the depth map to take in objects and limbs the cut-out missed. At zero the cut-out is used as it is; at 100% the subject is the whole picture. It applies when you let go of the slider and restarts the animation; it is hidden when the depth model did not load.
- **Background details** sets how much of the background shows in the wash behind the subject. It starts at 80%. At 100% nothing is changed; below that the background is simplified with a median filter before it is painted, and its strokes are found again on the simplified picture: small things go first, the borders between large areas stay where they are, and at zero only a plain wash is left. The background is whatever the cut-out and Reach left out.
- **Hatching** sets how much pencil hatching there is; at zero only the contours remain.
- **Rotate**, **Scale**, and dragging the picture plan the final frame: where the photo ends up once the camera has moved. Scale runs from 0.6×, where the photo sits small on a wide sheet of paper, to 2×. While you plan, the finished frame is shown with the photo's outline and thirds drawn over it, and it stays up for a moment after you let go. **Reset frame** puts the camera back.
- **Style** picks how the camera gets there: *Rhythmic* (three quick pushes, sideways first, then down and round), *Smooth* (one slow glide), or *Rapid* (one fast push). All three keep drifting slowly until the last moment.
- **Text** adds one block of lettering in the Cherish script. It is edited on the picture itself: click it to pick it up, which shows the final frame, then drag it anywhere including the margin, use its handles to scale and turn it, or double-click to type (Enter breaks the line). A click away, Escape, or playing puts it down, and so the panel needs no edit mode; its text controls pick the text up as well. The panel sets alignment, line height, dark or light ink with an intensity, and size, which applies to the selected characters when some are selected. The lettering arrives half a second after the strong ink, eroded at first, and fills out in about 1.2 s.
- **Outro**, when on, adds an ending: the camera snaps back to the photo's own frame while the photo spreads back over the painting from the middle, and as the camera lands long blots creep in from the edges. The photo comes back muted and sepia and regains its color as it goes. It takes about a second and a half.
- **Focus** sets how much the viewer's attention changes the hatching. At zero the whole subject is hatched from tone alone; at full strength the places people look at get short strokes on one side of each contour and stay otherwise clean. While either slider is dragged, the bare drawing is shown so the change is easy to judge.

## How It Works

1. **Models.** Four small networks run once per photo. Three run in a Web Worker through Transformers.js (`src/engine/models.worker.js`): [RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) cuts out the subject, [Informative Drawings](https://github.com/carolineec/informative-drawings) draws its contours, and [Depth Anything V2](https://huggingface.co/onnx-community/depth-anything-v2-small) estimates depth. The fourth, [UniSal](https://github.com/rdroste/unisal), predicts where people look and runs through LiteRT.js on the main thread (`src/engine/attention.js`). With WebGPU the three worker models take about two seconds together; without it they fall back to WASM and take closer to thirty. Only the matte is required: each other map has a fallback, down to the original edge-detection lines.
   `src/engine/reach.js` can then grow the matte: starting from the cut-out, it floods into neighboring pixels whose depth lies within a tolerance of the subject's own depth range, up to a distance that also grows with the slider, and softens the new edge. The models are not run again; only what depends on the matte is rebuilt.
2. **Sketch.** `src/engine/guides.js` turns the model outputs into low-resolution guide maps (tone, stroke direction, which side of a contour is in shadow), and the `HATCH` shader in `src/engine/shaders.js` draws the pencil at full resolution: the model's contours plus five passes of procedural strokes whose density follows the tone. Where the viewer looks, strokes get shorter and stay on the darker side of contours. `SKETCH-PIPELINE.md` has the full recipe.
3. **Fronts.** `src/engine/fields.js` solves three shortest-path problems on a 512px grid: paper, a first ink wash, and a later pass for the darks. Each cell stores the moment the front reaches it. The medium is cellular noise, fast inside each cell and slow across its borders, which makes the front billow like a cloud; cell size varies from region to region. Every seed spreads at its own pace, so some grow into large blots while slow ones stay small droplets. Ink is also slowed by drawn edges and by the subject's outline, so it fills the figure before leaking into the background.
4. **Composite.** One fragment shader turns "seconds since the front arrived" into the look of each pixel: wet bleached paper that ages, pencil that breaks on the paper's tooth, and ink that arrives blurred and pale, then sharpens and deepens. A darker rim follows the wet front, pigment pools where the front crawled, water seeps slightly ahead, and late backruns leave pale blooms. Ink is mixed subtractively (`paper * pigment^density`).

The fronts are eased rather than linear: paper opens with a couple of slow puffs and then bursts, the first wash surges in right behind it and creeps to a stop, and the darks keep arriving after that. Because the fronts are precomputed, the animation is a pure function of time and can be scrubbed in both directions.

### Beyond the Photo

Everything is solved on a sheet 1.67 times the size of the photo, so the camera can leave it. Past the photo's edge there is no picture to draw from, so `extendSheet` in `src/engine/fields.js` spreads its tones outwards with a blur that grows with distance, subject and background separately. Detail and pencil let go a little before the edge, sooner where contours crowd it; pale ink runs further than dark ink and thins to nothing with no outline; and a few separate blots land on the bare paper and run together where they touch.

`src/engine/framing.js` holds the planned frame to one rule: the sheet, scaled, turned and moved with the photo, must cover the whole viewport. That is why turning the photo raises the smallest scale, and why it cannot be moved at all at 0.6×. The scale and position you asked for are remembered, so they come back when there is room again. The camera leaves once the paper has covered the photo; `MOTIONS` in `src/engine/renderer.js` describes each way of getting there as a short list of pushes.

The two screens are hash routes (`src/main.js`): `#/` is the start screen and `#/edit/<sample>` the editor, so both open directly on static hosting. An uploaded file cannot survive a reload, so `#/edit` without one returns to the start. The after picture in `public/example` is a frame saved from the editor.

A video is played by a plain `<video>` element laid over the canvas; no decoding library is involved. The keyframe is grabbed from it with `createImageBitmap` and then treated exactly like a photo. During the video parts of the timeline the clock follows the video's own time, so the two cannot drift.

The lettering is edited with [Fabric.js](https://fabricjs.com/), loaded on first use, on a layer over the canvas. Fabric's own drawing of the text is kept invisible: its canvas is handed to the shader as a texture, so what you edit is the painted result, and only the handles and caret come from Fabric. The texture is laid out in the final frame and mapped back onto the sheet, which is why the text travels with the camera.

Timing lives in `TIMELINE` in `src/engine/renderer.js`; the look of the paper and ink is in the `COMPOSITE` shader.

## Credits and Licenses

- Sample photos and the before/after example are from [Pexels](https://www.pexels.com/license/), by odobesku, Olly, Ricky Kwong, Fabio Le Saint, silverkblack, Arina Krasnikova, and Vie Studio; each is linked from the start screen. `src/source.js` lists them.
- The social preview shows "Helsinki woman in hat" by Toni Hukkanen, [CC0 via Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Helsinki_woman_in_hat_(Unsplash).jpg).
- RMBG-1.4 by BRIA AI is released for non-commercial use only.
- Informative Drawings (MIT; ONNX conversion by x-Liola-x), Depth Anything V2 small (Apache-2.0), and UniSal (Apache-2.0; LiteRT conversion by litert-community).
- Cherish by The Cherish Project Authors, SIL Open Font License; served from `public/fonts` with its license.
- All model weights are downloaded from Hugging Face at runtime and are not part of this repository: about 160 MB with WebGPU, about 95 MB without. The LiteRT.js runtime is loaded from jsDelivr.
