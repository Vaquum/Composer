"""The server answers the page, the matcher, the bars and its health, and refreshes the bars only when the files change."""

from __future__ import annotations

import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import bars  # noqa: E402
import server  # noqa: E402


def sources(tag: str) -> list[bars.Source]:
    return [bars.Source(name, seconds, repo, 'a' * 40, f'{name}-{tag}.parquet', tag * 64, 1) for name, seconds, repo in bars.TIMEFRAMES]


class Fake:
    def __init__(self) -> None:
        self.tag, self.reads, self.fail = '1', 0, False

    def current(self) -> list[bars.Source]:
        if self.fail:
            raise OSError('hub unreachable')
        return sources(self.tag)

    def read(self, found: list[bars.Source]) -> tuple[bytes, bytes]:
        self.reads += 1
        return b'CBAR1' + found[0].sha256[:1].encode(), b'CACT1' + found[0].sha256[:1].encode()


class Server(unittest.TestCase):
    def setUp(self) -> None:
        self.fake = Fake()
        self.state = server.Bars(self.fake.current, self.fake.read)
        self.state.refresh()
        pages = {path: ((ROOT / name).read_bytes(), kind) for path, (name, kind) in server.PAGES.items()}
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.handler(self.state, pages))
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.httpd.server_address[1]}'

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()

    def get(self, path: str, headers: dict[str, str] | None = None):
        try:
            return urllib.request.urlopen(urllib.request.Request(self.base + path, headers=headers or {}), timeout=5)
        except urllib.error.HTTPError as err:
            return err

    def test_page_matcher_and_bars(self) -> None:
        page = self.get('/')
        self.assertEqual((page.status, page.headers['Content-Type']), (200, 'text/html; charset=utf-8'))
        self.assertIn(b'<title>', page.read())
        self.assertEqual(self.get('/matcher.js').headers['Content-Type'], 'text/javascript; charset=utf-8')
        self.assertEqual(self.get('/pane-designs.js').headers['Content-Type'], 'text/javascript; charset=utf-8')
        self.assertEqual(self.get('/panes.css').headers['Content-Type'], 'text/css; charset=utf-8')
        got = self.get('/bars')
        etag = got.headers['ETag']
        self.assertEqual((got.status, got.read(), got.headers['Cache-Control']), (200, b'CBAR11', 'private, no-cache'))
        self.assertEqual(self.get('/bars', {'If-None-Match': etag}).status, 304)
        traded = self.get('/activity')
        self.assertEqual((traded.status, traded.read()), (200, b'CACT11'))
        self.assertNotEqual(traded.headers['ETag'], etag)
        self.assertEqual(self.get('/activity', {'If-None-Match': traded.headers['ETag']}).status, 304)
        self.assertEqual(self.get('/nothing').status, 404)

    def test_health_names_the_files_served(self) -> None:
        health = json.loads(self.get('/healthz').read())
        self.assertEqual(health['files'][0], 'vaquum/binance_btcusdt_15m_klines/15m-1.parquet')
        self.assertEqual(health['last_failure'], '')

    def test_bars_are_read_again_only_when_the_files_change(self) -> None:
        self.assertFalse(self.state.refresh())
        self.assertEqual(self.fake.reads, 1)
        self.fake.tag = '2'
        self.assertTrue(self.state.refresh())
        self.assertEqual((self.fake.reads, self.get('/bars').read(), self.get('/activity').read()), (2, b'CBAR12', b'CACT12'))

    def test_a_failed_refresh_keeps_the_bars_and_says_so(self) -> None:
        self.fake.fail = True
        self.state.try_refresh()
        self.assertEqual(self.get('/bars').read(), b'CBAR11')
        self.assertIn('hub unreachable', json.loads(self.get('/healthz').read())['last_failure'])


if __name__ == '__main__':
    unittest.main()
