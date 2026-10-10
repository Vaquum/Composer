"""Run one of the matcher's checks on the current bars: read them as the server does, then run the check.

Usage: python3 checks/with_bars.py checks/similarity-windows.mjs

The bars are kept under the system temporary directory, named by the files' SHA-256, so several checks
read the HuggingFace files once.
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import bars  # noqa: E402


def main() -> None:
    check = sys.argv[1]
    sources = bars.current()
    key = hashlib.sha256('\n'.join(s.sha256 for s in sources).encode()).hexdigest()[:16]
    cached = Path(tempfile.gettempdir()) / 'composer-bars' / f'{key}.bin'
    if not cached.exists():
        cached.parent.mkdir(parents=True, exist_ok=True)
        part = cached.with_suffix('.part')
        part.write_bytes(bars.read(sources))
        part.replace(cached)
    print('bars: ' + ', '.join(s.file_name for s in sources), flush=True)
    sys.exit(subprocess.run(['node', check, str(ROOT / 'matcher.js'), str(cached)], check=False).returncode)


if __name__ == '__main__':
    main()
