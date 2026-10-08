# Project Guidelines

This repository is a playground for frontend experiments and mini-projects.

- Write all documents, text, and pages created or edited in this repository in English, including documentation and user-facing content.
- Keep each experiment or mini-project in its own directory.
- Build each mini-project as either a static HTML file or a small pnpm project.
- Always use pnpm for package management. Do not use npm or yarn.
- Use Vue whenever a mini-project requires interactivity.
- Independently commit each approved change while working on projects. Use clear English commit messages.

Keep experiments small and self-contained. Add project-specific instructions or setup notes to the relevant mini-project directory when needed.

## Experiment Index and Publishing

- Register every new experiment in `experiments.json` with a unique directory slug, English name and description, tags, and a type of `pnpm` or `static`.
- Use technical tags naming technologies actually used by the experiment. Avoid broad subject labels or names that imply an unused library.
- Link every new experiment in the root README as well. The global dark index is generated from `experiments.json`; do not hardcode experiment cards in `index.html`.
- Each experiment must have an `index.html`. pnpm experiments must provide a `build` script, a committed lockfile, and output static files to `dist/`. Vite experiments must accept the `--base` build option for their published subdirectory.
- Keep all asset URLs compatible with subdirectory hosting. Verify fonts, images, routing, and transitions in the production build.
- Run `pnpm build` from the repository root to assemble the index and all registered experiments in `_site/`. Never commit build output.
- `.github/workflows/pages.yml` publishes the assembled site to GitHub Pages on pushes to `main`. Keep experiments independent; static demos are copied and pnpm demos are built individually.
