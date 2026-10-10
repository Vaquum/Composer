"""Lint the GitHub workflows with actionlint, which must be installed (https://github.com/rhysd/actionlint).

Usage: python3 checks/lint_workflows.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    actionlint = shutil.which('actionlint')
    if actionlint is None:
        sys.exit('actionlint is not installed')
    workflows = sorted(str(p) for p in (ROOT / '.github' / 'workflows').glob('*.yml'))
    result = subprocess.run([actionlint, *workflows], check=False)
    if result.returncode == 0:
        print('workflows lint clean: ' + ', '.join(Path(w).name for w in workflows))
    sys.exit(result.returncode)


if __name__ == '__main__':
    main()
