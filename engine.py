"""Fetch the shared Filang engine's browser package that Composer runs on.

Composer serves the Filang engine to its page at /engine/, where Composer's matching is moving.
engine.json names one published Filang release and the SHA-256 of its browser package. This script downloads that
package from the release, refuses it unless the digest is the one named, and writes the two files Composer serves:
index.mjs and filang_engine.wasm.

Usage: python3 engine.py [--out engine]
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import tarfile
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
FILES = ('index.mjs', 'filang_engine.wasm')


def pinned() -> tuple[str, str]:
    lock = json.loads((ROOT / 'engine.json').read_text())
    version, digest = lock['version'], lock['browser_sha256']
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:\.post[1-9][0-9]*)?', version):
        raise SystemExit(f'engine.json names no Filang release: {version!r}')
    if not re.fullmatch(r'[a-f0-9]{64}', digest):
        raise SystemExit('engine.json names no SHA-256 for the browser package')
    return version, digest


def fetch(out: Path) -> str:
    version, digest = pinned()
    name = f'filang-browser-{version}.tar.gz'
    with urlopen(f'https://github.com/Vaquum/Filang/releases/download/v{version}/{name}', timeout=120) as response:
        data = response.read()
    got = hashlib.sha256(data).hexdigest()
    if got != digest:
        raise SystemExit(f'{name} has SHA-256 {got}, not the {digest} that engine.json names')
    contents = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for file in FILES:
            member = archive.getmember(f'browser/{file}')
            if not member.isfile():
                raise SystemExit(f'{name} holds no browser/{file}')
            source = archive.extractfile(member)
            if source is None:
                raise SystemExit(f'{name} holds no readable browser/{file}')
            contents[file] = source.read()
    out.mkdir(parents=True, exist_ok=True)
    for file, content in contents.items():
        (out / file).write_bytes(content)
    return version


def main() -> None:
    parser = argparse.ArgumentParser(description='Fetch the shared Filang engine that Composer runs on.')
    parser.add_argument('--out', type=Path, default=ROOT / 'engine')
    args = parser.parse_args()
    print(f'Filang {fetch(args.out)} is in {args.out}')


if __name__ == '__main__':
    main()
