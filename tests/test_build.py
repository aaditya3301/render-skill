import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from examples.make_layers import make_layers

SCRIPT = ROOT / 'skills/render/scripts/render.py'


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='render-test-')
        self.addCleanup(self.temporary.cleanup)
        self.work = pathlib.Path(self.temporary.name)
        self.layers = make_layers(self.work / 'inputs')

    def run_cli(self, kind='burger', extra=(), output='animation', images=None, success=True):
        source = ['--images', *map(str, images)] if images else ['--input', str(self.layers[kind])]
        result = subprocess.run([sys.executable, str(SCRIPT), *source, '--output', str(self.work / output), *extra],
                                capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(result.returncode, 0 if success else 2, result.stderr)
        return json.loads(result.stdout if success else result.stderr)

    def test_burger_pack_is_portable_and_preserves_artwork(self):
        report = self.run_cli()
        self.assertEqual((report['motion'], report['mode'], report['trigger']), ('vertical', 'iso', 'scroll'))
        output = self.work / 'animation'
        scene = json.loads((output / 'scene.json').read_text())
        self.assertEqual(scene['axis'], [0, -1])
        for source, layer in zip(sorted(self.layers['burger'].glob('*.png')), scene['layers']):
            self.assertEqual(source.read_bytes(), (output / 'layers' / layer['file']).read_bytes())
            with Image.open(source) as image:
                self.assertGreaterEqual(image.getchannel('A').getpixel(tuple(layer['anchor'])), 18)
        snapshot = (output / 'index.html').read_text(encoding='utf-8')
        self.assertEqual(snapshot.count('"file": "data:image/png;base64,'), 6)
        self.assertIn('trigger="scroll"', snapshot)
        self.assertIn('customElements.define', snapshot)
        with zipfile.ZipFile(output / 'render.zip') as archive:
            self.assertIsNone(archive.testzip())
            self.assertIn('NOTICE', archive.namelist())
            self.assertIn('LICENSE', archive.namelist())
            self.assertNotIn('render.zip', archive.namelist())
            self.assertTrue(all(not name.startswith('/') and '..' not in pathlib.PurePosixPath(name).parts for name in archive.namelist()))

    def test_phone_uses_sideways_tilt(self):
        report = self.run_cli('phone', extra=['--product', 'Phone'])
        self.assertEqual((report['motion'], report['mode']), ('sideways', 'tilt'))

    def test_generic_ingredient_names_still_use_alpha_layout(self):
        generic = self.work / 'generic'
        generic.mkdir()
        for i, source in enumerate(sorted(self.layers['burger'].glob('*.png')), 1):
            (generic / f'{i:02d}-part.png').write_bytes(source.read_bytes())
        self.layers['generic'] = generic
        report = self.run_cli('generic')
        self.assertEqual(report['motion'], 'vertical')
        self.assertIn('stacked', report['reason'])

    def test_override_iso_axis_and_explicit_attachment_order(self):
        images = list(reversed(sorted(self.layers['burger'].glob('*.png'))))
        report = self.run_cli(images=images, extra=['--motion', 'sideways', '--input-mode', 'iso', '--axis', '1', '0'])
        scene = json.loads((self.work / 'animation/scene.json').read_text())
        self.assertEqual(scene['axis'], [1, 0])
        self.assertEqual([layer['name'] for layer in report['layers']], [p.name for p in images])

    def test_ambiguous_layout_reports_fallback(self):
        report = self.run_cli('phone', extra=['--labels', *(['Part'] * 6)])
        # Source names are still informative; remove them for the genuinely ambiguous case.
        generic = self.work / 'unknown'
        generic.mkdir()
        for i, source in enumerate(sorted(self.layers['phone'].glob('*.png')), 1):
            (generic / f'{i:02d}-part.png').write_bytes(source.read_bytes())
        self.layers['unknown'] = generic
        report = self.run_cli('unknown', output='unknown-result')
        self.assertEqual(report['motion'], 'sideways')
        self.assertTrue(any('uncertain' in note for note in report['warnings']))

    def test_existing_output_is_not_changed(self):
        output = self.work / 'animation'
        output.mkdir()
        sentinel = output / 'user-work.txt'
        sentinel.write_text('keep me')
        error = self.run_cli(success=False)
        self.assertIn('already exists', error['error'])
        self.assertEqual(sentinel.read_text(), 'keep me')

    def test_artwork_license_and_supplied_credits_survive_the_zip(self):
        license_file = self.layers['burger'] / 'LICENSE'
        license_file.write_text('Original artwork license')
        extra = self.work / 'other-license.txt'
        extra.write_text('Additional artwork notice')
        report = self.run_cli(extra=['--artwork-license', str(extra), '--artwork-credit', 'Artwork by Example Author'])
        with zipfile.ZipFile(self.work / 'animation/render.zip') as archive:
            content = [archive.read(name).decode() for name in report['artwork_notices']]
            self.assertIn('Original artwork license', content)
            self.assertIn('Additional artwork notice', content)
            self.assertIn('Artwork by Example Author', [text.strip() for text in content])

    def test_invalid_images_leave_no_output(self):
        first = sorted(self.layers['burger'].glob('*.png'))[0]
        cases = [('opaque', Image.new('RGBA', (600, 600), 'red'), 'transparent'),
                 ('empty', Image.new('RGBA', (600, 600)), 'empty'),
                 ('mismatch', Image.new('RGBA', (500, 600)), 'canvases')]
        for name, image, expected in cases:
            with self.subTest(name=name):
                if name == 'mismatch':
                    image.paste((255, 0, 0, 255), (200, 250, 300, 350))
                image.save(first)
                error = self.run_cli(success=False)
                self.assertIn(expected, error['error'])
                self.assertFalse((self.work / 'animation').exists())

    def test_bad_count_corrupt_data_and_duplicate_inputs(self):
        images = sorted(self.layers['burger'].glob('*.png'))
        self.assertIn('4–8', self.run_cli(images=images[:2], success=False)['error'])
        self.assertIn('more than once', self.run_cli(images=[images[0]] * 6, success=False)['error'])
        images[0].write_bytes(b'not a png')
        self.assertIn('cannot read', self.run_cli(success=False)['error'])
        self.assertFalse((self.work / 'animation').exists())

    def test_invalid_motion_options(self):
        cases = [['--gap', 'nan'], ['--axis', '0', '0', '--motion', 'sideways', '--input-mode', 'iso'],
                 ['--axis', '1', '0'], ['--accent', 'red'], ['--length', '90vh'],
                 ['--labels', 'Only one label']]
        for options in cases:
            with self.subTest(options=options):
                self.run_cli(extra=options, success=False)
                self.assertFalse((self.work / 'animation').exists())

    def test_webp_and_html_text_are_preserved_safely(self):
        for path in self.layers['burger'].glob('*.png'):
            with Image.open(path) as image:
                image.save(path.with_suffix('.webp'), lossless=True)
        images = sorted(self.layers['burger'].glob('*.webp'))
        title = '</script><script>window.INJECTED=1</script>'
        report = self.run_cli(images=images, extra=['--product', title])
        self.assertEqual(report['product'], title)
        snapshot = (self.work / 'animation/index.html').read_text(encoding='utf-8')
        self.assertNotIn(title, snapshot)
        self.assertIn('data:image/webp;base64,', snapshot)
        self.assertIn('\\u003c/script>', snapshot)

    def test_natural_directory_order(self):
        folder = self.work / 'numbered'
        folder.mkdir()
        for number, source in zip([11, 2, 10, 1, 4, 3], sorted(self.layers['phone'].glob('*.png'))):
            (folder / f'{number}-part.png').write_bytes(source.read_bytes())
        self.layers['numbered'] = folder
        report = self.run_cli('numbered')
        self.assertEqual([layer['name'] for layer in report['layers']], ['1-part.png', '2-part.png', '3-part.png', '4-part.png', '10-part.png', '11-part.png'])


if __name__ == '__main__':
    unittest.main()
