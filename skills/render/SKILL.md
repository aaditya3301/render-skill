---
name: render
description: Turn 4–8 transparent product-layer PNG or WebP images into a smooth scroll-driven exploded-view animation, an HTML preview, and a website embed. Use for uploaded ingredient or component layers, or to integrate their animation into an existing website.
license: MIT
---

# Render

Use the bundled engine and build helper to turn registered product layers into one
scroll-controlled animation. Keep opening and closing scroll-driven; product detection
changes the direction, not the trigger.

## Build from uploaded layers

1. Locate the actual uploaded files in the host's workspace or attachments. Use numbered
   filenames as the front-to-back order, or preserve an order the user specifies. Six
   images is typical; the supported range is 4–8. Keep transparent canvas padding: it
   records how the parts assemble. Do not independently crop or centre the ingredients.
   Check supplied artwork notices/credits. Adjacent LICENSE, NOTICE and CREDITS files
   are copied automatically; use `--artwork-license` for additional notice files and
   `--artwork-credit` for author/source attribution provided separately.
2. Inspect the images enough to understand the product and camera. Use `--product` when
   it is known. Straight-on device layers normally use `--input-mode tilt`; parts already
   drawn or photographed in perspective use `--input-mode iso`. Burgers and similar
   food stacks use a fixed camera and vertical motion. An explicit user choice wins.
3. Run `scripts/render.mjs` **relative to this skill's directory**, not the user's project.
   The helper needs Node.js 22.20+ and its local image decoder. Install the dependencies
   in the skill directory once, then run the helper from any working directory:

   ```sh
   npm install --prefix /path/to/render --omit=dev --workspaces=false
   node /path/to/render/scripts/render.mjs --input /path/to/layers --output /path/to/new-animation --product "Burger"
   ```

   For attachments in separate directories, pass `--images file1.png file2.png ...`
   instead of `--input`. Explicit `--images` order is preserved; directory inputs are
   sorted naturally by filename. For options and website integration, read
   [references/usage.md](references/usage.md).
4. Read the JSON report. The helper validates transparency, canvas sizes and layer count,
   places anchors on visible pixels, selects motion from names and alpha layout, then
   writes a new output directory. It refuses to replace existing output. If filenames
   are vague, use what you can see to set `--product` or `--motion vertical|sideways`.
   Do not describe its local motion heuristic as an AI vision service.
5. Check the generated result using the host's browser or preview tools when available.
   Verify assembly at the start/end, separation near the middle, and the mobile layout.
   Hovering must not open the product. The output `index.html` embeds its images,
   engine and CSS, so it also works when opened directly from disk. Report any verification you
   could not perform without presenting it as tested.
6. Return links to `index.html`, `embed.html`, and `render.zip`, plus the selected direction.
   This produces one animation from the layer set, not a separate animation per image.

## Input and output boundaries

- Accept transparent **part/ingredient layers** on matching canvases. Ordinary product
  photos are not separable layers. Mismatched exports need registration information or
  new exports; padding differently sized crops does not recover their original offsets.
- Preserve input artwork. The helper analyzes alpha and copies the files; it does not
  generate missing parts, remove backgrounds, repaint, crop or rescale them.
- Use the supplied engine rather than recreating motion with CSS transitions. Preserve
  its reduced-motion handling, keyboard navigation, responsive fit, spring continuity,
  `assets/LICENSE`, and `assets/NOTICE`.
- For an existing website, integrate the generated embed into the requested section and
  copy `explode.js`, `explode.css`, and its layers into the appropriate public asset directory.
  Keep the CSS beside the engine script. Adjust the
  relative URLs and check that ancestor overflow does not break sticky positioning.
  Preserve the surrounding site design unless the user asks for a redesign.
- Work locally. Generating an animation does not authorize uploading the user's images,
  publishing their website, or committing generated output into their repository.
