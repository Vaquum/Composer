"""Serve the production handler with the real cached payloads to the bench check.

The bench is served as it is. The page at / is given a probe, so the check can put a drawing and its holds on the
page and read what the page then asks the matcher and what it is answered.
"""

from __future__ import annotations

import json
import sys
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402


def main() -> None:
    state = server.Bars()
    state._replace(Path(sys.argv[1]).read_bytes(), Path(sys.argv[2]).read_bytes(), [])
    pages = {path: ((ROOT / name).read_bytes(), kind) for path, (name, kind) in server.PAGES.items()}
    html, kind = pages['/']
    if html.count(b'Panes.init();') != 1:
        sys.exit('the page no longer starts with a single Panes.init(): the probe has nowhere to go')
    pages['/'] = (html.replace(b'Panes.init();', b'window.__page={S,Match,Panes,refresh};Panes.init();'), kind)
    with ThreadingHTTPServer(('127.0.0.1', 0), server.handler(state, pages)) as httpd:
        print(json.dumps({'type': 'ready', 'port': httpd.server_address[1]}), flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
