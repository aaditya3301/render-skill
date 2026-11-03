"""Build actual outputs and exercise offline HTML, hosted embeds, ZIPs and reduced motion."""
import asyncio
import functools
import http.server
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import zipfile

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from examples.make_layers import make_layers

SCROLL = """(el, progress) => { const top=el.getBoundingClientRect().top+scrollY;
  scrollTo(0,top+progress*(el.offsetHeight-innerHeight)); }"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


async def inspect(page, url, motion, *, reduced=False):
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: requests.append(request.url))
    await page.goto(url)
    await page.wait_for_function("document.querySelector('exploded-view')?.layers?.length === 6")
    await page.wait_for_function("[...document.querySelector('exploded-view').root.querySelectorAll('img.face')].every(im=>im.complete&&im.naturalWidth)")
    el = page.locator('exploded-view')
    await el.evaluate(SCROLL, 0)
    await page.wait_for_timeout(300 if reduced else 1600)
    await page.mouse.move(300, 300)
    await page.wait_for_timeout(200)
    assert await el.evaluate("el => el.trigger === 'scroll' && el.layers.every(l=>l.x===0)")
    await el.evaluate(SCROLL, .55)
    await page.wait_for_timeout(300 if reduced else 1800)
    assert await el.evaluate("(el, motion) => el.motion===motion && el.layers.every(l=>l.x>.999)", motion)
    if motion == 'vertical':
        assert await el.evaluate("el => el.mode==='iso' && el.cam.t===0 && el.layers.every(l=>l.off[0]===0)")
    else:
        assert await el.evaluate("el => el.cam.t===1 && el.layers.some(l=>Math.abs(l.off[0])>0)")
    if not reduced:
        await el.locator('.stage').focus()
        await page.keyboard.press('ArrowRight')
        assert await el.evaluate('el => el.selected===0')
    await el.evaluate(SCROLL, 1)
    await page.wait_for_timeout(300 if reduced else 1800)
    assembled = await el.evaluate("el => ({ok:el.layers.every(l=>l.x===0&&l.el.style.transform==='')&&el.rig.style.transform==='',p:el.progress(),cam:el.cam,rig:el.rig.style.transform,x:el.layers.map(l=>l.x)})")
    assert assembled['ok'], assembled
    assert not errors and not requests, (errors, requests)
    if url.startswith('file:'):
        assert await page.evaluate("performance.getEntriesByType('resource').every(r=>!r.name.startsWith('http'))")
    print(f'PASS: {motion}, {page.viewport_size}, reduced={reduced}, {"offline" if url.startswith("file:") else "hosted"}')


async def main():
    with tempfile.TemporaryDirectory(prefix='render-browser-') as temporary:
        work = pathlib.Path(temporary)
        fixtures = make_layers(work / 'inputs')
        for kind, folder in fixtures.items():
            result = subprocess.run([sys.executable, str(ROOT / 'skills/render/scripts/render.py'), '--input', str(folder),
                                     '--output', str(work / kind), '--product', kind], capture_output=True, text=True)
            assert result.returncode == 0, result.stderr
            with zipfile.ZipFile(work / kind / 'render.zip') as archive:
                archive.extractall(work / f'{kind}-unpacked')
        # Serve a real embed from an unrelated output path, not from the development tree.
        snippet = (work / 'burger/embed.html').read_text(encoding='utf-8')
        (work / 'burger/embedded.html').write_text('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' + snippet, encoding='utf-8')
        handler = functools.partial(QuietHandler, directory=work)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            async with async_playwright() as pw:
                options = {}
                chrome = os.environ.get('CHROME_PATH')
                if not chrome and sys.platform == 'win32':
                    installed = pathlib.Path(r'C:\Program Files\Google\Chrome\Application\chrome.exe')
                    if installed.exists():
                        chrome = str(installed)
                if chrome:
                    options['executable_path'] = chrome
                browser = await pw.chromium.launch(**options)
                for kind, motion in [('phone', 'sideways'), ('burger', 'vertical')]:
                    context = await browser.new_context(viewport={'width': 1440, 'height': 900})
                    page = await context.new_page()
                    await inspect(page, (work / f'{kind}-unpacked/index.html').as_uri(), motion)
                    await context.close()
                context = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
                await inspect(await context.new_page(), (work / 'burger/index.html').as_uri(), 'vertical')
                await context.close()
                context = await browser.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
                await inspect(await context.new_page(), (work / 'phone/index.html').as_uri(), 'sideways', reduced=True)
                await context.close()
                context = await browser.new_context(viewport={'width': 1440, 'height': 900})
                await inspect(await context.new_page(), f'http://127.0.0.1:{server.server_port}/burger/embedded.html', 'vertical')
                await context.close()
                await browser.close()
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    asyncio.run(main())
