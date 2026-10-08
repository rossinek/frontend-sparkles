# Portfolio

A small Vue portfolio for Artur Rosa, inspired by a colorful card-based layout. This is the starting point for a future page-transition experiment.

## Run Locally

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite.

Use Node.js 22.12 or later and pnpm 11. The pnpm configuration allows the esbuild installation script required by Vite.

## Production Build

```sh
pnpm build
pnpm preview
```

## Structure

- `src/Home.vue`: portrait, biography, project cards, and external social links.
- `src/Project.vue`: shared layout for the three project pages.
- `src/projects.js`: project names, descriptions, and links.
- `src/style.css`: responsive layout and styling.
- `public/artur-rosa.png`: supplied portrait; the near-monochrome filter is applied in CSS.

Vue Router uses hash routing so all pages can be opened directly on simple static hosting without server rewrite rules. Unknown routes return to the portfolio. A Three.js prototype turns the white page shell into a rounded slab of fine white circular particles, rotates the right edge first, then lets the left edge catch up before revealing the next page. The slab adjusts its height to the destination during the turn. Clickable cards have subtle hover effects. Reduced-motion preferences and unavailable WebGL use direct navigation.

The transition is implemented in `src/particleTransition.js`. Its duration, particle spacing, and depth layers are defined at the top of that file. Vertex shaders animate the dots on the GPU. The edge rotation winds back, releases, overshoots 180 degrees, and rebounds; delayed columns let the left edge catch up. This is a visual spring approximation rather than a physics simulation.

The outgoing and incoming cards are captured locally with html-to-image and mapped onto the particles. Their content separates into dots, fades to white during the turn, and reforms as the destination card. DM Sans and Manrope are served locally from `public/fonts`, with their Open Font License files alongside them, so card captures do not depend on external font requests.

Two large circles rise from the bottom behind the particle scene with a short delay between them. The second circle matches the destination project artwork (or the bio card when returning home), and the first uses a lighter tint of that color. They cover the viewport during the turn and leave through the top during reconstruction, with the second circle leaving first. The card's regular shadow fades in after the transition.

WithSubtitles uses `nrk:media-subtitles` and WithConverter uses `fluent:shapes-24-filled` from Iconify, embedded locally as SVG. The typography symbol is a simple illustrative mark, not an official brand logo. WithConverter and whatthefreefont descriptions are provisional portfolio copy and can be refined later.
