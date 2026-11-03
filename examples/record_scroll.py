"""Record a GIF by scrolling an HTML page produced by the Render build helper."""
import argparse
import asyncio
import io
import os
import pathlib

from PIL import Image
from playwright.async_api import async_playwright


async def record(args):
    async with async_playwright() as pw:
        options = {}
        chrome = os.environ.get('CHROME_PATH')
        if not chrome and os.name == 'nt':
            candidate = pathlib.Path(r'C:\Program Files\Google\Chrome\Application\chrome.exe')
            if candidate.exists():
                chrome = str(candidate)
        if chrome:
            options['executable_path'] = chrome
        browser = await pw.chromium.launch(**options)
        page = await browser.new_page(viewport={'width': 960, 'height': 760}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(args.html.resolve().as_uri())
        await page.wait_for_function("[...document.querySelector('exploded-view').root.querySelectorAll('img.face')].every(im=>im.complete&&im.naturalWidth)")
        view = page.locator('exploded-view')
        assert await view.evaluate("el=>el.trigger==='scroll'")
        await page.mouse.move(0, 0)
        progress = [0] * 8 + [.55 * i / 34 for i in range(1, 35)] + [.55] * 10
        progress += [.55 + .45 * i / 34 for i in range(1, 35)] + [1] * 10
        frames = []
        for value in progress:
            await view.evaluate('(el,p)=>{const top=el.getBoundingClientRect().top+scrollY;scrollTo(0,top+p*(el.offsetHeight-innerHeight));}', value)
            await page.wait_for_timeout(45)
            png = await view.locator('.card').screenshot()
            image = Image.open(io.BytesIO(png)).convert('RGB')
            image.thumbnail((720, 560), Image.Resampling.LANCZOS)
            frames.append(image)
        await page.wait_for_function("document.querySelector('exploded-view').layers.every(l=>l.x===0)")
        assert not errors, errors
        await browser.close()
    palette = frames[len(frames) // 2].quantize(colors=256)
    indexed = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image in frames]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    indexed[0].save(args.output, save_all=True, append_images=indexed[1:], duration=80, loop=0, optimize=True)
    print(f'Recorded {len(frames)} real engine frames: {args.output.resolve()} ({args.output.stat().st_size:,} bytes)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    asyncio.run(record(parser.parse_args()))
