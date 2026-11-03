import pathlib
import re
import unittest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / 'skills/render'


class SkillPackageTests(unittest.TestCase):
    def test_installed_skill_has_all_required_resources(self):
        text = (SKILL / 'SKILL.md').read_text(encoding='utf-8')
        metadata = yaml.safe_load(text.split('---', 2)[1])
        self.assertEqual(metadata['name'], 'render')
        self.assertTrue(metadata['description'].strip())
        for name in ['scripts/render.py', 'scripts/requirements.txt', 'references/usage.md',
                     'assets/explode.js', 'assets/LICENSE', 'assets/NOTICE', 'agents/openai.yaml']:
            self.assertTrue((SKILL / name).is_file(), name)
        for target in re.findall(r'\]\(([^)]+)\)', text):
            if not target.startswith('http'):
                self.assertTrue((SKILL / target).exists(), target)
        interface = yaml.safe_load((SKILL / 'agents/openai.yaml').read_text())['interface']
        self.assertIn('$render', interface['default_prompt'])
        self.assertEqual((ROOT / 'LICENSE').read_bytes(), (SKILL / 'assets/LICENSE').read_bytes())


if __name__ == '__main__':
    unittest.main()
