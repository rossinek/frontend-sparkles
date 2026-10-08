# Social Preview Artwork

This directory contains the editable HTML/CSS compositions for the approved Open Graph images. Keep future previews visually consistent with these files rather than designing a new layout for each experiment.

## Reference Files

- `index.html`: the collection's typographic preview, with the heading on the left and description on the right.
- `particle-flip.html`: the reference layout for every experiment preview.
- `../particle-flip/public/og-scene.jpg`: the original, unlabelled screenshot captured during the Particle Flip transition.
- `../particle-flip/public/og.jpg`: the final experiment image, including its title and badge.
- `../public/og.jpg`: the final collection image.

Keep the raw screenshot and editable composition alongside the final image. The final JPEG is a browser capture of the composition, not a replacement for its source.

## Experiment Layout

The canvas is exactly **1200 × 630 pixels**, with no page margin or scrollbars.

| Element | Approved styling |
| --- | --- |
| Background | `#141618` |
| Screenshot | Contained in a 1020 × 450 area, 90px from the left and 20px from the top; preserve its aspect ratio and center it |
| Title strip | Solid black, full width, 140px high, aligned to the bottom |
| Title | Local Manrope, 46px, weight 300, white, uppercase, 28px letter spacing, line height 1.2; centered in the strip with 64px horizontal padding |
| Collection badge | Top-right, 38px from the top and 40px from the right; “Frontend Sparkles” with the SVG asterisk |
| Badge text | Manrope, 28px, weight 600, `#f6f6ee` |
| Badge surface | `#202322`, 1px border `#50574f`, pill shape, 18px vertical and 26px horizontal padding |
| Badge icon | 30 × 30px, `#cbdebc` |

The screenshot is the focus. Do not stretch it, cover the defining effect with the title, or replace it with an unrelated illustration. For unusually long experiment names, reduce the title size only as much as necessary to keep it on one line, retaining the thin uppercase style and generous letter spacing.

## Preparing Another Experiment

1. Finish the experiment, then capture its defining interaction. For animation, choose a frame with clearly visible motion, depth, or transformation. An idle page is not an appropriate preview of an animation experiment.
2. Save the unlabelled screenshot as `<experiment>/public/og-scene.jpg` for a pnpm experiment. For static experiments, keep the equivalent assets within the experiment directory and use their actual published paths.
3. Copy `social/particle-flip.html` to `social/<experiment-slug>.html`. Update the title, screenshot path, and image alt text. Preserve the approved layout and badge. Reuse the local Manrope font; do not depend on a remote font request.
4. Serve the repository locally and open the composition in a browser. Wait until the font and screenshot have loaded. Capture the composition's exact 1200 × 630 area and save it as `<experiment>/public/og.jpg` for a pnpm experiment.
5. Inspect the final image at full size and as a small preview. Confirm that the title is legible, the screenshot communicates the experiment, and nothing is clipped or stretched.
6. Add metadata to the experiment's initial HTML: title, description, canonical URL, Open Graph tags, and `twitter:card=summary_large_image`. Use absolute published URLs for the page and image, set image dimensions to 1200 × 630, and describe the image with alt text.
7. Remove any temporary animation pauses or capture-only changes. Run `pnpm build` from the repository root and confirm that the final image exists at the path referenced by the built metadata. Commit the composition, raw screenshot, final image, and metadata together after approval.

The index uses its separate `social/index.html` composition. Keep its headline, description, author line, collection name, and address readable at thumbnail size; do not add experiment cards to this image. Export it to `public/og.jpg` at the same 1200 × 630 size.
