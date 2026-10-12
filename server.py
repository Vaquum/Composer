"""Composer's server: the page, its matcher, the bars it searches and what traded in them, on 127.0.0.1 only.

The host's Caddy, deployed from Vaquum/Portal, puts composer.vaquum.fi in front of this server
behind the portal login, so it checks no credentials of its own. It reads the bars from the Vaquum
HuggingFace kline files before it starts answering, and looks for newer files every hour. If a
later read fails, it keeps the bars it has, logs why, and tries again an hour later; /healthz says
which files it serves and when the last read failed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import bars

ROOT = Path(__file__).resolve().parent
PAGES = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/index.html': ('index.html', 'text/html; charset=utf-8'),
    '/matcher.js': ('matcher.js', 'text/javascript; charset=utf-8'),
    '/pane-designs.js': ('pane-designs.js', 'text/javascript; charset=utf-8'),
    '/panes.css': ('panes.css', 'text/css; charset=utf-8'),
    '/forecast.js': ('forecast.js', 'text/javascript; charset=utf-8'),
}
REFRESH_SECONDS = 3600


def log(message: str) -> None:
    print(f'{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())} {message}', file=sys.stderr, flush=True)


class Bars:
    """The payloads being served, the bars and their activity, swapped whole when newer files arrive."""

    def __init__(self, current=bars.current, read=bars.read) -> None:
        self._current, self._read = current, read
        self._lock = threading.Lock()
        self.payload = b''
        self.etag = ''
        self.activity = b''
        self.activity_etag = ''
        self.sources: list[bars.Source] = []
        self.failure = ''

    def refresh(self) -> bool:
        """Read the files again only when latest.json names different ones; True when the bars changed."""
        sources = self._current()
        if [(s.repo, s.sha256) for s in sources] == [(s.repo, s.sha256) for s in self.sources]:
            with self._lock:
                self.failure = ''
            return False
        payload, activity = self._read(sources)
        with self._lock:
            self.payload, self.activity, self.sources, self.failure = payload, activity, sources, ''
            self.etag = '"' + hashlib.sha256(payload).hexdigest()[:32] + '"'
            self.activity_etag = '"' + hashlib.sha256(activity).hexdigest()[:32] + '"'
        return True

    def current(self) -> tuple[bytes, str]:
        with self._lock:
            return self.payload, self.etag

    def current_activity(self) -> tuple[bytes, str]:
        with self._lock:
            return self.activity, self.activity_etag

    def health(self) -> dict:
        with self._lock:
            return {'files': [f'{s.repo}/{s.file_name}' for s in self.sources], 'last_failure': self.failure}

    def try_refresh(self) -> None:
        try:
            if self.refresh():
                log('serving ' + ', '.join(s.file_name for s in self.sources))
        except Exception as exc:  # noqa: BLE001 - keep the bars already served; the failure is logged and shown on /healthz
            with self._lock:
                self.failure = f'{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())} {exc!r}'
            log(f'reading newer bars failed, still serving the previous files: {exc!r}')

    def keep_fresh(self) -> None:
        while True:
            time.sleep(REFRESH_SECONDS)
            self.try_refresh()


def handler(state: Bars, pages: dict[str, tuple[bytes, str]]):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'Composer'
        sys_version = ''

        def _send(self, status: int, body: bytes, kind: str, extra: dict[str, str] | None = None) -> None:
            self.send_response(status)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(body)))
            # every request passes the portal login in front of this server; revalidate rather than reuse
            self.send_header('Cache-Control', 'private, no-cache')
            self.send_header('X-Content-Type-Options', 'nosniff')
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 - http.server's naming
            path = self.path.split('?', 1)[0]
            if path in pages:
                body, kind = pages[path]
                self._send(200, body, kind)
            elif path in ('/bars', '/activity'):
                payload, etag = state.current() if path == '/bars' else state.current_activity()
                if self.headers.get('If-None-Match') == etag:
                    self._send(304, b'', 'application/octet-stream', {'ETag': etag})
                else:
                    self._send(200, payload, 'application/octet-stream', {'ETag': etag})
            elif path == '/healthz':
                self._send(200, json.dumps(state.health()).encode(), 'application/json')
            else:
                self._send(404, b'Not found\n', 'text/plain; charset=utf-8')

        do_HEAD = do_GET  # noqa: N815 - http.server's naming

        def log_message(self, format: str, *args) -> None:  # noqa: A002 - http.server's signature
            pass

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8488)
    args = parser.parse_args()
    pages = {path: ((ROOT / name).read_bytes(), kind) for path, (name, kind) in PAGES.items()}
    state = Bars()
    state.refresh()
    log('serving ' + ', '.join(s.file_name for s in state.sources))
    threading.Thread(target=state.keep_fresh, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', args.port), handler(state, pages)).serve_forever()


if __name__ == '__main__':
    main()
