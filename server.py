"""Composer's server: the page, its matcher, the bars it searches and what traded in them, on 127.0.0.1 only.

The host's Caddy, deployed from Vaquum/Portal, puts composer.vaquum.fi in front of this server
behind the portal login, so it checks no credentials of its own. It restores a validated local
snapshot before answering and reads newer Vaquum HuggingFace files in the background every hour. If a
later read fails, it keeps the bars it has, logs why, and tries again an hour later; /healthz says
which files it serves and when the last read failed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import sys
import tempfile
import threading
import time
from dataclasses import asdict
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
    '/motion.js': ('motion.js', 'text/javascript; charset=utf-8'),
    '/motion.css': ('motion.css', 'text/css; charset=utf-8'),
    '/forecast.js': ('forecast.js', 'text/javascript; charset=utf-8'),
    '/context.js': ('context.js', 'text/javascript; charset=utf-8'),
}
REFRESH_SECONDS = 3600


def log(message: str) -> None:
    print(f'{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())} {message}', file=sys.stderr, flush=True)


class Bars:
    """The payloads being served, the bars and their activity, swapped whole when newer files arrive."""

    def __init__(self, current=bars.current, read=bars.read, cache_dir: Path | None = None) -> None:
        self._current, self._read = current, read
        self._lock = threading.Lock()
        self.payload = b''
        self.etag = ''
        self.activity = b''
        self.activity_etag = ''
        self.sources: list[bars.Source] = []
        self.failure = ''
        self.cache_dir = cache_dir

    def restore(self) -> bool:
        """Load one atomic, checksummed snapshot without contacting the source."""
        if self.cache_dir is None:
            return False
        try:
            path = self.cache_dir / 'history.snapshot'
            if path.stat().st_size > 128 * 1024 * 1024:
                raise ValueError('snapshot too large')
            data = path.read_bytes()
            if data[:6] != b'CSNAP1':
                raise ValueError('unexpected snapshot format')
            size = struct.unpack_from('<I', data, 6)[0]
            if size > 65536:
                raise ValueError('snapshot metadata too large')
            meta = json.loads(data[10:10 + size])
            payload = data[10 + size:10 + size + meta['bars_bytes']]
            activity = data[10 + size + meta['bars_bytes']:]
            if (not payload.startswith(bars.MAGIC) or not activity.startswith(bars.ACTIVITY_MAGIC)
                    or hashlib.sha256(payload).hexdigest() != meta['bars_sha256']
                    or hashlib.sha256(activity).hexdigest() != meta['activity_sha256']):
                raise ValueError('snapshot checksum mismatch')
            sources = [bars.Source(**source) for source in meta['sources']]
            if [(s.name, s.seconds, s.repo) for s in sources] != list(bars.TIMEFRAMES):
                raise ValueError('snapshot timeframes differ')
            self._replace(payload, activity, sources)
            return True
        except FileNotFoundError:
            return False
        except (OSError, ValueError, KeyError, TypeError, struct.error) as exc:
            log(f'ignoring invalid history snapshot: {exc}')
            return False

    def _replace(self, payload: bytes, activity: bytes, sources: list[bars.Source]) -> None:
        with self._lock:
            self.payload, self.activity, self.sources, self.failure = payload, activity, sources, ''
            self.etag = '"' + hashlib.sha256(payload).hexdigest()[:32] + '"'
            self.activity_etag = '"' + hashlib.sha256(activity).hexdigest()[:32] + '"'

    def save(self) -> None:
        if self.cache_dir is None:
            return
        payload, activity = self.payload, self.activity
        meta = json.dumps({'sources': [asdict(s) for s in self.sources], 'bars_bytes': len(payload),
                           'bars_sha256': hashlib.sha256(payload).hexdigest(),
                           'activity_sha256': hashlib.sha256(activity).hexdigest()}).encode()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.cache_dir, delete=False) as cache:
                path = Path(cache.name)
                cache.write(b'CSNAP1' + struct.pack('<I', len(meta)) + meta + payload + activity)
                cache.flush()
                os.fsync(cache.fileno())
            path.replace(self.cache_dir / 'history.snapshot')
        finally:
            if path is not None:
                path.unlink(missing_ok=True)

    def refresh(self) -> bool:
        """Read the files again only when latest.json names different ones; True when the bars changed."""
        sources = self._current()
        if [(s.repo, s.sha256) for s in sources] == [(s.repo, s.sha256) for s in self.sources]:
            with self._lock:
                self.failure = ''
            return False
        payload, activity = self._read(sources)
        self._replace(payload, activity, sources)
        try:
            self.save()
        except OSError as exc:
            log(f'could not persist history snapshot: {exc}')
        return True

    def current(self) -> tuple[bytes, str]:
        with self._lock:
            return self.payload, self.etag

    def current_activity(self) -> tuple[bytes, str]:
        with self._lock:
            return self.activity, self.activity_etag

    def health(self) -> dict:
        with self._lock:
            return {'ready': bool(self.payload), 'files': [f'{s.repo}/{s.file_name}' for s in self.sources], 'last_failure': self.failure}

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
            self.try_refresh()
            time.sleep(REFRESH_SECONDS if self.payload else 5)


def handler(state: Bars, pages: dict[str, tuple[bytes, str]]):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'Composer'
        sys_version = ''
        # HTTP/1.0 makes Chromium bypass the cache even with valid ETags.
        protocol_version = 'HTTP/1.1'

        def _send(self, status: int, body: bytes, kind: str, extra: dict[str, str] | None = None) -> None:
            self.send_response(status)
            self.send_header('Content-Type', kind)
            if status != 304:
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
                if not payload:
                    self._send(503, b'History is loading\n', 'text/plain; charset=utf-8', {'Retry-After': '1'})
                elif self.headers.get('If-None-Match') == etag:
                    self._send(304, b'', 'application/octet-stream', {'ETag': etag})
                else:
                    self._send(200, payload, 'application/octet-stream', {'ETag': etag})
            elif path == '/healthz':
                health = state.health()
                self._send(200 if health['ready'] else 503, json.dumps(health).encode(), 'application/json')
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
    state = Bars(cache_dir=Path(os.environ.get('COMPOSER_CACHE_DIR', str(Path.home() / '.cache' / 'composer'))))
    restored = state.restore()
    log('serving cached history' if restored else 'history is loading in the background')
    threading.Thread(target=state.keep_fresh, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', args.port), handler(state, pages)).serve_forever()


if __name__ == '__main__':
    main()
