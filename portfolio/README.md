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

Vue Router uses hash routing so all pages can be opened directly on simple static hosting without server rewrite rules. Unknown routes return to the portfolio. There are no animations or page-transition effects.

Project symbols are simple illustrative marks, not official brand logos. WithConverter and whatthefreefont descriptions are provisional portfolio copy and can be refined later.
