#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["Pillow>=10.0,<13"]
# ///
"""Build a portable, scroll-only product animation from registered transparent layers."""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import math
import re
import shutil
import sys
import tempfile
import warnings
import zipfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Pillow is required. Run with uv run, or install scripts/requirements.txt in your Python environment.")

SKILL = Path(__file__).resolve().parents[1]
ASSETS = SKILL / "assets"
VERSION = "1.0.0"
EXTENSIONS = {".png", ".webp"}


class InputError(ValueError):
    """Actionable input failure; no output should be published."""


def natural_key(path: Path):
    return [(1, int(part)) if part.isdigit() else (0, part.casefold())
            for part in re.split(r"(\d+)", path.name)]


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.casefold()).strip("-")[:60] or "layer"


def label_for(path: Path) -> str:
    text = re.sub(r"^\d+[-_ .]*", "", path.stem)
    return re.sub(r"[-_]+", " ", text).strip().capitalize() or "Layer"


def analyze(path: Path) -> dict:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as original:
                if original.format not in {"PNG", "WEBP"}:
                    raise InputError(f"{path.name}: use transparent PNG or WebP part layers.")
                if getattr(original, "n_frames", 1) != 1:
                    raise InputError(f"{path.name}: use a single still image for each layer.")
                if original.width * original.height > 40_000_000:
                    raise InputError(f"{path.name}: export a canvas below 40 million pixels.")
                fmt = original.format
                image = original.convert("RGBA")
        width, height = image.size
        alpha = image.getchannel("A")
        if alpha.getextrema()[0] == 255:
            raise InputError(f"{path.name}: no transparent background. Export with alpha.")
        mask = alpha.point(lambda value: 255 if value > 24 else 0)
        bounds = mask.getbbox()
        if not bounds:
            raise InputError(f"{path.name}: the layer is empty or too faint to display.")
        if all(alpha.getpixel(point) >= 250 for point in
               ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1))):
            raise InputError(f"{path.name}: all corners are opaque; remove the baked background and retain transparent padding.")
        scale = min(1, 300 / width, 500 / height)
        tw, th = max(1, round(width * scale)), max(1, round(height * scale))
        sample = alpha.resize((tw, th), Image.Resampling.LANCZOS)
        pixels = sample.tobytes()
        solid = [(i % tw, i // tw) for i, value in enumerate(pixels) if value > 128]
        if not solid:
            solid = [(i % tw, i // tw) for i, value in enumerate(pixels) if value > 24]
        if not solid:
            raise InputError(f"{path.name}: no visible pixels at preview scale.")
        cx = sum(x for x, _ in solid) / len(solid)
        cy = sum(y for _, y in solid) / len(solid)
        candidates = [(x, y) for x, y in solid if pixels[y * tw + x] >= 200] or solid
        px, py = min(candidates, key=lambda point: (point[0] - cx) ** 2 + (point[1] - cy) ** 2)
        ax = min(width - 1, int((px + .5) * width / tw))
        ay = min(height - 1, int((py + .5) * height / th))
        if alpha.getpixel((ax, ay)) < 18:
            radius = math.ceil(max(width / tw, height / th))
            nearby = [(x, y) for y in range(max(0, ay - radius), min(height, ay + radius + 1))
                      for x in range(max(0, ax - radius), min(width, ax + radius + 1))
                      if alpha.getpixel((x, y)) >= 18]
            if not nearby:
                raise InputError(f"{path.name}: could not place a label anchor on a visible pixel.")
            ax, ay = min(nearby, key=lambda point: (point[0] - ax) ** 2 + (point[1] - ay) ** 2)
        return {"path": path, "name": path.name, "label": label_for(path), "canvas": [width, height],
                "bounds": list(bounds), "center": [cx * width / tw, cy * height / th],
                "anchor": [ax, ay], "format": fmt,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    except InputError:
        raise
    except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise InputError(f"{path.name}: cannot read this image ({error}).") from error


def choose_motion(product: str, layers: list[dict]) -> tuple[str, str]:
    tokens = set(re.findall(r"[a-z]+", " ".join(
        [product] + [str(layer[key]) for layer in layers for key in ("name", "label")]).casefold()))
    food = set("bun brioche sauce tomato lettuce patty beef cheese avocado bacon onion frosting sponge".split())
    if tokens & set("burger hamburger sandwich cake bagel pizza taco pastry".split()) or len(tokens & food) >= 2:
        return "vertical", "Food ingredients detected; lift the layers vertically."
    if tokens & set("phone smartphone iphone tablet laptop watch camera battery oled motherboard screen display".split()):
        return "sideways", "Device parts detected; use a sideways reveal."
    height = layers[0]["canvas"][1]
    centers = [layer["center"][1] for layer in layers]
    flat = sum((layer["bounds"][2] - layer["bounds"][0]) /
               (layer["bounds"][3] - layer["bounds"][1]) > 1.6 for layer in layers) / len(layers)
    ordered = sum(b >= a - height * .025 for a, b in zip(centers, centers[1:])) / (len(layers) - 1)
    if flat >= .65 and (max(centers) - min(centers)) / height > .18 and ordered >= .75:
        return "vertical", "Wide layers stacked from top to bottom; use a vertical lift."
    return "sideways", "No clear vertical stack detected; using a sideways reveal. Override with --motion if needed."


def json_for_html(value) -> str:
    return json.dumps(value, ensure_ascii=True).replace("<", "\\u003c")


def artwork_notices(paths: list[Path], explicit: list[Path]) -> list[Path]:
    """Keep notices adjacent to input files; do not search unrelated parent folders."""
    found = set()
    for parent in {path.parent for path in paths}:
        for file in parent.iterdir():
            if file.is_file() and file.suffix.casefold() in {"", ".txt", ".md"} and file.stem.casefold() in {
                "license", "licence", "notice", "attribution", "credits", "copyright"
            }:
                found.add(file.resolve())
    for path in explicit:
        file = path.expanduser().resolve()
        if not file.is_file():
            raise InputError(f"Artwork notice does not exist: {file}")
        found.add(file)
    return sorted(found, key=lambda file: (file.name.casefold(), str(file)))


def embed(scene: dict, accent: str, theme: str, length: str, engine_url: str = "explode.js") -> str:
    return (f'<script src="{html.escape(engine_url, quote=True)}" defer></script>\n'
            f'<exploded-view trigger="scroll" mode="{scene["mode"]}" theme="{theme}" '
            f'accent="{accent}" length="{length}">\n'
            f'<script type="application/json">{json_for_html(scene)}</script>\n'
            '</exploded-view>\n')


def portable_html(scene: dict, layers: list[dict], engine: str, accent: str, theme: str, length: str) -> str:
    offline = {**scene, "base": "./", "layers": []}
    for config, layer in zip(scene["layers"], layers):
        mime = "image/png" if layer["format"] == "PNG" else "image/webp"
        data = base64.b64encode(layer["path"].read_bytes()).decode("ascii")
        offline["layers"].append({**config, "file": f"data:{mime};base64,{data}"})
    background, ink = ("#0b0b0c", "#e8e6e1") if theme == "dark" else ("#f3f1ec", "#1b1b19")
    product = html.escape(scene["product"])
    engine = engine.replace("</script", "<\\/script")
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{product} · Render</title><link rel="icon" href="data:,">
<style>html,body{{margin:0;background:{background};color:{ink};font:15px/1.6 system-ui,sans-serif}}
header,footer{{max-width:1100px;margin:auto;padding:24px}}h1{{font-size:24px;font-weight:500;margin:0 0 4px}}
p{{margin:0;opacity:.7}}a{{color:inherit}}</style>
</head><body>
<header><h1>{product}</h1><p>Scroll down to take it apart and assemble it again. Scroll up to reverse.</p></header>
<exploded-view trigger="scroll" mode="{scene['mode']}" theme="{theme}" accent="{accent}" length="{length}">
<script type="application/json">{json_for_html(offline)}</script></exploded-view>
<footer><p>Made with <a href="https://github.com/aaditya3301/render-skill">Render</a>. Engine license and attribution: LICENSE and NOTICE in the download.</p></footer>
<script>{engine}</script>
</body></html>
'''


def build(args) -> dict:
    output = args.output.expanduser().resolve()
    if output.exists():
        raise InputError(f"Output already exists: {output}. Choose a new directory; existing files are never replaced.")
    if args.input:
        directory = args.input.expanduser().resolve()
        if not directory.is_dir():
            raise InputError(f"Input directory does not exist: {directory}")
        paths = sorted((path for path in directory.iterdir() if path.suffix.casefold() in EXTENSIONS and path.is_file()), key=natural_key)
    else:
        paths = [path.expanduser().resolve() for path in args.images]
    if not 4 <= len(paths) <= 8:
        raise InputError(f"Found {len(paths)} layers. Supply 4–8 transparent PNG/WebP part layers; six is typical.")
    if len(set(paths)) != len(paths):
        raise InputError("The same image was supplied more than once. Supply each layer once.")
    layers = []
    for path in paths:
        if not path.is_file():
            raise InputError(f"Image does not exist: {path}")
        layers.append(analyze(path))
    notices = artwork_notices(paths, args.artwork_license)
    if len({tuple(layer["canvas"]) for layer in layers}) != 1:
        raise InputError("Layer canvases differ. Re-export every layer from the same artboard; do not crop or center parts separately.")
    if args.labels:
        if len(args.labels) != len(layers) or any(not label.strip() for label in args.labels):
            raise InputError("--labels must contain one non-empty label per image, in the same order.")
        for layer, label in zip(layers, args.labels):
            layer["label"] = label.strip()
    product = args.product.strip() or "Product"
    motion, reason = choose_motion(product, layers)
    if args.motion != "auto":
        motion, reason = args.motion, f"{args.motion.capitalize()} motion explicitly selected."
    mode = "iso" if motion == "vertical" else ("tilt" if args.input_mode == "auto" else args.input_mode)
    if args.axis and mode != "iso":
        raise InputError("--axis requires --input-mode iso (or vertical motion).")
    if args.axis and motion == "vertical" and list(args.axis) != [0, -1]:
        raise InputError("Vertical motion uses axis 0 -1. For another axis use --motion sideways --input-mode iso --axis X Y.")
    if args.axis and (not all(math.isfinite(v) for v in args.axis) or not any(args.axis)):
        raise InputError("Axis must contain finite values and cannot be 0 0.")
    if args.gap is not None and (not math.isfinite(args.gap) or args.gap <= 0):
        raise InputError("--gap must be a positive finite number.")
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", args.accent):
        raise InputError("--accent must be a six-digit hex color, such as #ff6a1a.")
    length = re.fullmatch(r"(\d+(?:\.\d+)?)vh", args.length)
    if not length or not 200 <= float(length[1]) <= 1200:
        raise InputError("--length must be between 200vh and 1200vh, such as 420vh.")
    width, height = layers[0]["canvas"]
    gap = args.gap if args.gap is not None else max(1, round(height * (.1467 if motion == "vertical" else .2 if mode == "iso" else .253)))
    boxes = [layer["bounds"] for layer in layers]
    bounds = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
    scene = {"product": product, "fig": "Layers", "mode": mode, "motion": motion, "trigger": "scroll",
             "base": "layers/", "canvas": [width, height], "gap": gap, "hint": "Scroll to take it apart", "layers": []}
    if mode == "iso":
        scene.update(axis=[0, -1] if motion == "vertical" else list(args.axis or [-.67, -.2]), bounds=bounds)
    else:
        scene["preset"] = "fan"
    for i, layer in enumerate(layers, 1):
        extension = ".png" if layer["format"] == "PNG" else ".webp"
        config = {"file": f'{i:02d}-{slug(layer["label"])}{extension}', "label": layer["label"], "anchor": layer["anchor"]}
        if mode == "tilt":
            config["thickness"] = 3
        scene["layers"].append(config)
    notes = []
    if height < 1200:
        notes.append("These images are low-resolution; the output preserves them without upscaling.")
    if args.input and any(not re.match(r"^\d+[-_ .]", path.name) for path in paths):
        notes.append("Directory order uses filenames. Number layers front to back or pass --images in the intended order.")
    if args.motion == "auto" and reason.startswith("No clear"):
        notes.append("Motion inference is uncertain; inspect the preview or choose --motion explicitly.")
    engine = (ASSETS / "explode.js").read_text(encoding="utf-8")
    report = {"version": VERSION, "product": product, "motion": motion, "mode": mode, "trigger": "scroll",
              "reason": reason, "canvas": [width, height], "warnings": notes,
              "layers": [{key: layer[key] for key in ("name", "label", "bounds", "center", "anchor", "sha256")} for layer in layers]}
    report["artwork_notices"] = [f"artwork/{i:02d}-{slug(file.stem)}{file.suffix.lower()}" for i, file in enumerate(notices, 1)]
    if args.artwork_credit:
        report["artwork_notices"].append("artwork/credits.txt")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".render-build-", dir=output.parent) as temporary:
        stage = Path(temporary) / "result"
        (stage / "layers").mkdir(parents=True)
        for layer, config in zip(layers, scene["layers"]):
            shutil.copyfile(layer["path"], stage / "layers" / config["file"])
        for name in ("explode.js", "LICENSE", "NOTICE"):
            shutil.copyfile(ASSETS / name, stage / name)
        if report["artwork_notices"]:
            (stage / "artwork").mkdir()
            for file, destination in zip(notices, report["artwork_notices"]):
                shutil.copyfile(file, stage / destination)
            if args.artwork_credit:
                (stage / "artwork/credits.txt").write_text("\n".join(args.artwork_credit) + "\n", encoding="utf-8")
        (stage / "scene.json").write_text(json.dumps(scene, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        (stage / "manifest.json").write_text(json.dumps(report, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        (stage / "embed.html").write_text(embed(scene, args.accent, args.theme, args.length), encoding="utf-8")
        (stage / "index.html").write_text(portable_html(scene, layers, engine, args.accent, args.theme, args.length), encoding="utf-8")
        (stage / "README.txt").write_text(
            "Open index.html directly to play the portable scroll animation.\n"
            "It embeds its engine and images; no server or API key is required to view it.\n\n"
            "For a website, copy explode.js and layers/ to your public assets, then insert embed.html.\n"
            "Adjust the script src and scene base URLs for your hosting paths.\n"
            "Keep LICENSE and NOTICE with the engine. Input artwork retains its original license.\n"
            "Any supplied/adjacent artwork notices and explicit credits are preserved in artwork/.\n"
            "scene.json is editable configuration; manifest.json records the chosen motion and input analysis.\n",
            encoding="utf-8")
        with zipfile.ZipFile(stage / "render.zip", "w", zipfile.ZIP_DEFLATED) as archive:
            for file in sorted(stage.rglob("*")):
                if file.is_file() and file.name != "render.zip":
                    archive.write(file, file.relative_to(stage).as_posix())
        stage.rename(output)
    return {**report, "output": str(output), "files": {name: str(output / name) for name in ("index.html", "embed.html", "scene.json", "render.zip")}}


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    source = result.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", type=Path, help="Directory of registered transparent PNG/WebP layers (natural filename order).")
    source.add_argument("--images", nargs="+", type=Path, help="Explicit layer paths in front-to-back order.")
    result.add_argument("--output", type=Path, required=True, help="New output directory; existing paths are never replaced.")
    result.add_argument("--product", default="Product")
    result.add_argument("--labels", nargs="+", help="One label per image, in the same order.")
    result.add_argument("--motion", choices=("auto", "vertical", "sideways"), default="auto")
    result.add_argument("--input-mode", choices=("auto", "tilt", "iso"), default="auto")
    result.add_argument("--axis", type=float, nargs=2, metavar=("X", "Y"))
    result.add_argument("--gap", type=float)
    result.add_argument("--theme", choices=("dark", "light"), default="dark")
    result.add_argument("--accent", default="#ff6a1a")
    result.add_argument("--length", default="420vh")
    result.add_argument("--artwork-license", action="append", type=Path, default=[], help="Additional artwork notice to include; repeat as needed. Adjacent LICENSE/NOTICE/CREDITS files are detected automatically.")
    result.add_argument("--artwork-credit", action="append", default=[], help="Artwork author/source attribution to include; repeat as needed.")
    result.add_argument("--version", action="version", version=VERSION)
    return result


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        print(json.dumps(build(args), indent=2, ensure_ascii=True))
        return 0
    except (InputError, OSError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
