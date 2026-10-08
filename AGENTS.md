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

## Metadata and Social Previews

- Follow [social/README.md](./social/README.md) when creating or updating OG images. Reuse `social/particle-flip.html` as the approved experiment layout and `social/index.html` for the collection.

- The global index and every experiment must include an English title and description, a canonical published URL, Open Graph metadata, and a large-image X/Twitter card in the initial HTML. Do not rely on client-side rendering for social metadata.
- After completing an experiment, capture an actual screenshot during its defining interaction or animation. Choose the frame that best communicates what the experiment demonstrates; an idle screen is insufficient when the experiment is about motion.
- Save the screenshot as a committed JPEG or PNG OG image, use an absolute published image URL, and provide accurate image dimensions and descriptive alt text. Prefer a wide image around 1200 × 630 pixels, while allowing a wider screenshot when it better preserves the visual.
- Compose every experiment OG image from its defining screenshot with the screenshot reduced and centered in the upper section, a black strip along the bottom containing the experiment title in thin white uppercase type with wide letter spacing, and a Frontend Sparkles badge. Keep the key interaction visible. Preserve the raw screenshot separately so the artwork can be revised without recapturing it.
- The index also needs a minimal typographic OG image representing the collection, with its heading on the left and description on the right. Keep it current when the identity or wording changes.
- Keep editable OG compositions in `social/` as HTML/CSS artwork, using local fonts. Capture the compositions at 1200 × 630 pixels and save the resulting OG images to the appropriate public directories.
- Verify the OG files are included in the built site and that their URLs, titles, descriptions, dimensions, and social tags are correct before publishing. Remove any temporary animation pauses or capture-only code before committing.
