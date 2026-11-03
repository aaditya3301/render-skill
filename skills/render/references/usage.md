# Build and integrate a Render animation

## Runtime

The helper requires Python 3.10+ and Pillow 10–12. `uv run scripts/render.py ...`
reads the script's dependency metadata and installs Pillow into an isolated cache.
The generated animation itself has no dependencies and makes no API calls.

Without uv, create a local environment and install `scripts/requirements.txt`:

```sh
python -m venv .render-venv
# macOS/Linux:
.render-venv/bin/python -m pip install -r /path/to/render/scripts/requirements.txt
# Windows:
.render-venv/Scripts/python.exe -m pip install -r C:/path/to/render/scripts/requirements.txt
```

Use that environment's Python to run the helper. Paths with spaces must be quoted.

## Input

Supply 4–8 still PNG/WebP images with actual alpha and the same canvas dimensions.
The parts should share a camera, lighting and assembled registration. Retain the
export padding. Layer order is front-to-back, or top-to-bottom for a burger.
Use filenames such as `01-top-bun.png` through `06-bottom-bun.png`.

```sh
python /path/to/render/scripts/render.py --input ./layers --output ./animation --product "Burger"
```

If files are spread across upload directories or the user specifies their order:

```sh
python /path/to/render/scripts/render.py --images /uploads/a.png /uploads/b.png /uploads/c.png /uploads/d.png --labels "Top bun" "Tomato" "Patty" "Bottom bun" --output ./animation --product "Burger"
```

Output must be a **new** directory. No overwrite option is provided. Keep original
image licenses when distributing user artwork; the engine's MIT license does not
relicense input images. Layer bytes are copied unchanged. Low-resolution inputs
produce a warning, not invented detail.

Adjacent LICENSE, LICENCE, NOTICE, ATTRIBUTION, CREDITS or COPYRIGHT text/Markdown files
are detected automatically and copied to `artwork/` in the result and ZIP. Add notices
outside the image directory with `--artwork-license /path/to/notice.txt` and authors or
source URLs with `--artwork-credit "Artwork by Author, https://example.com/source"`.
Both options may be repeated. This preserves supplied notices; it does not determine
whether you have permission to distribute someone else's artwork.

## Motion

| Option | Meaning |
| --- | --- |
| `--motion auto` | Default. Ingredient/part names, then visible alpha layout choose the direction. Unknowns fall back to sideways with a warning. |
| `--motion vertical` | Fixed-camera vertical separation, suitable for burgers/sandwiches/cakes. |
| `--motion sideways` | Sideways reveal; overrides any food/stack inference. |
| `--input-mode tilt` | Straight-on layers with a CSS camera turn. Default for sideways motion. |
| `--input-mode iso` | Already-rendered perspective artwork; slides without inventing a new camera. |
| `--axis X Y` | Explicit slide direction for iso sideways mode. Vertical motion always uses `0 -1`. |
| `--gap N` | Positive spread in canvas pixels per layer. Defaults adapt to direction and input height. |
| `--length 420vh` | Pinned section height, 200vh–1200vh. A longer section makes scrubbing slower. |
| `--theme dark` or `light` | Card/page theme. |
| `--accent '#ff6a1a'` | Six-digit accent color; quote the `#` on the command line. |

Vertical motion always uses the fixed-camera input mode. Input mode cannot be
reliably inferred from product type alone: an isometric phone still needs iso.
There is intentionally no hover trigger in this helper.

## Results

| File | Use |
| --- | --- |
| `index.html` | Portable scroll animation with all images and JavaScript embedded. Open directly from disk or serve it. |
| `embed.html` | A script tag and custom element with inline scene data. Paste into a website. |
| `explode.js`, `layers/` | Assets for the website embed. |
| `scene.json` | Editable configuration for a hosted `src` embed. |
| `manifest.json` | Motion choice, reason, warnings, anchors and source checksums. |
| `render.zip` | Everything above, with engine license/attribution and viewing instructions. |

The helper prints a JSON result with absolute output paths; errors go to stderr
as JSON and return exit code 2. It validates before creating the output and builds
in a temporary directory before publishing the result.

`index.html` is the portable snapshot. If you edit `scene.json`, use a hosted embed
with `src` or rebuild the snapshot; the snapshot does not fetch that JSON file.

## Website integration

Copy `explode.js`, `layers/`, `LICENSE`, and `NOTICE` to a public asset folder such
as `/product-animation/`. Set the script URL in `embed.html` to
`/product-animation/explode.js` and its JSON `base` to `/product-animation/layers/`.
Paste that snippet in the desired page section. Use this custom element as-is in
plain HTML or within a framework that supports custom elements.

For the separate JSON version, copy `scene.json` too, set its `base` relative to
the **embedding page URL** (not relative to the JSON file), and use:

```html
<script src="/product-animation/explode.js" defer></script>
<exploded-view src="/product-animation/scene.json" trigger="scroll" length="420vh"></exploded-view>
```

Keep ancestor containers from trapping `position: sticky` with unintended overflow.
Layer files should be same-origin or CORS-enabled if pointer highlighting is needed.
The portable file does not need pointer highlighting to open/close with scrolling.

Test an assembled view near progress 0, a separated view near .55, and reassembly
near 1. The component respects reduced motion and supports keyboard selection.
