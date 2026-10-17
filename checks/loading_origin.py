"""Expose the production HTTP handler with real cached payloads to the loading check."""

from __future__ import annotations

import json
import sys
import threading
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
    pages['/'] = (html.replace(b'Panes.init();', b'window.__loading={Match,Panes,App,Flow};Panes.init();'), kind)
    output_lock = threading.Lock()

    def emit(value: dict) -> None:
        with output_lock:
            print(json.dumps(value), flush=True)

    class Observed(server.handler(state, pages)):
        def _send(self, status, body, kind, extra=None):
            path = self.path.split('?', 1)[0]
            if path in ('/bars', '/activity'):
                emit({'type': 'request', 'path': path, 'status': status, 'bytes': len(body),
                      'encoding': (extra or {}).get('Content-Encoding')})
            super()._send(status, body, kind, extra)

    with ThreadingHTTPServer(('127.0.0.1', 0), Observed) as httpd:
        emit({'type': 'ready', 'port': httpd.server_address[1]})
        httpd.serve_forever()


if __name__ == '__main__':
    main()
