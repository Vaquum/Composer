"""Run the project's required checks sequentially, preserving each actual exit status."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
checks = [
    ['node', 'checks/page.mjs'],
    ['node', 'checks/motion-performance.mjs'],
    [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-v'],
    *[['node', f'checks/{name}.mjs'] for name in
      ('pane-designs', 'forecast', 'forecast-ux', 'drag', 'chain', 'motion-model', 'motion-browser')],
    *[[sys.executable, 'checks/with_bars.py', f'checks/{name}.mjs'] for name in
      ('similarity-windows', 'similarity-look', 'similarity-equivalence', 'panes', 'search-performance', 'loading-performance')],
    [sys.executable, 'checks/container.py'],
    [sys.executable, 'checks/lint_workflows.py'],
]
for argv in checks:
    print('Checking ' + ' '.join(argv[1:]), flush=True)
    result = subprocess.run(argv, cwd=ROOT, check=False)
    if result.returncode:
        sys.exit(result.returncode)
print('All required checks passed.', flush=True)
