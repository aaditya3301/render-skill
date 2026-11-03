"""Install a copy of the skill into a temporary project, then build from that copy."""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from examples.make_layers import make_layers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default=str(ROOT), help='Local repository or published GitHub owner/repo.')
    args = parser.parse_args()
    npx = shutil.which('npx.cmd' if os.name == 'nt' else 'npx')
    if not npx:
        raise SystemExit('Install Node.js 22.20+ to test the npx installer.')
    with tempfile.TemporaryDirectory(prefix='render-install-') as temporary:
        project = pathlib.Path(temporary)
        environment = {**os.environ, 'DISABLE_TELEMETRY': '1', 'DO_NOT_TRACK': '1'}
        result = subprocess.run([npx, '--yes', 'skills', 'add', args.source, '--skill', 'render',
                                 '--agent', 'codex', '--copy', '--yes'], cwd=project, env=environment,
                                capture_output=True, text=True, encoding='utf-8', timeout=180)
        if result.returncode:
            raise SystemExit(result.stdout + result.stderr)
        installed = [file.parent for file in project.rglob('SKILL.md') if file.parent.name == 'render']
        assert installed, result.stdout
        skill = installed[0]
        assert skill.resolve().is_relative_to(project.resolve()), 'Installer did not create a self-contained project copy'
        for file in ('assets/explode.js', 'assets/LICENSE', 'assets/NOTICE', 'references/usage.md'):
            assert (skill / file).is_file(), file
        layers = make_layers(project / 'inputs')
        run = subprocess.run([sys.executable, str(skill / 'scripts/render.py'), '--input', str(layers['burger']),
                              '--output', str(project / 'animation'), '--product', 'Burger'],
                             cwd=project, capture_output=True, text=True, encoding='utf-8')
        assert run.returncode == 0, run.stderr
        report = json.loads(run.stdout)
        assert report['motion'] == 'vertical' and report['trigger'] == 'scroll'
        assert (project / 'animation/render.zip').is_file()
        print(f'PASS: installed {args.source} as a self-contained Codex skill and built a scroll animation from the installed copy')


if __name__ == '__main__':
    main()
