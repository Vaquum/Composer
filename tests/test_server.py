"""The server answers the page, the matcher, the bars and its health, and refreshes the bars only when the files change."""

from __future__ import annotations

import gzip
import json
import os
import sys
import threading
import tempfile
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
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

    def get(self, path: str, headers: dict[str, str] | None = None, method: str = 'GET'):
        try:
            return urllib.request.urlopen(urllib.request.Request(self.base + path, headers=headers or {}, method=method), timeout=5)
        except urllib.error.HTTPError as err:
            return err

    def test_page_matcher_and_bars(self) -> None:
        page = self.get('/')
        self.assertEqual((page.status, page.headers['Content-Type']), (200, 'text/html; charset=utf-8'))
        self.assertIn(b'<title>', page.read())
        self.assertEqual(self.get('/matcher.js').headers['Content-Type'], 'text/javascript; charset=utf-8')
        self.assertEqual(self.get('/pane-designs.js').headers['Content-Type'], 'text/javascript; charset=utf-8')
        self.assertEqual(self.get('/panes.css').headers['Content-Type'], 'text/css; charset=utf-8')
        self.assertEqual(self.get('/forecast.js').headers['Content-Type'], 'text/javascript; charset=utf-8')
        self.assertEqual(self.get('/motion.js').headers['Content-Type'], 'text/javascript; charset=utf-8')
        self.assertIn(b'TactileFlow', self.get('/motion.js').read())
        self.assertEqual(self.get('/motion.css').headers['Content-Type'], 'text/css; charset=utf-8')
        got = self.get('/bars')
        self.assertEqual(got.version, 11)
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

    def large_payloads(self, suffix: bytes = b'') -> tuple[bytes, bytes]:
        payload, activity = b'CBAR1' + b'bar-values' * 10000 + suffix, b'CACT1' + b'activity-values' * 10000 + suffix
        self.state._replace(payload, activity, sources('1'))
        return payload, activity

    def test_gzip_is_cached_and_decodes_to_the_exact_payload(self) -> None:
        expected = self.large_payloads()
        with patch.object(server.gzip, 'compress', side_effect=AssertionError('compressed during a request')):
            for path, raw in zip(('/bars', '/activity'), expected):
                response = self.get(path, {'Accept-Encoding': 'gzip'})
                encoded = response.read()
                self.assertEqual((response.status, response.headers['Content-Encoding']), (200, 'gzip'))
                self.assertEqual(response.headers['Vary'], 'Accept-Encoding')
                self.assertEqual(response.headers['Cache-Control'], 'private, no-cache')
                self.assertEqual(int(response.headers['Content-Length']), len(encoded))
                self.assertLess(len(encoded), len(raw))
                self.assertEqual(gzip.decompress(encoded), raw)
                self.assertEqual(self.get(path).read(), raw)

    def test_encoding_preferences_and_rejection(self) -> None:
        self.large_payloads()
        for accept, status, encoding in [
            ('gzip', 200, 'gzip'), ('GZip; Q=1, br;q=0.5', 200, 'gzip'),
            ('x-gzip', 200, 'gzip'), ('*', 200, 'gzip'),
            ('gzip;q=0.5, identity;q=0.2', 200, 'gzip'),
            ('gzip;q=0.5', 200, None), ('gzip;q=0, *;q=1', 200, None),
            ('gzip;q=0.3, identity;q=0.7', 200, None), ('br', 200, None),
            ('', 200, None), ('gzip;q=invalid', 200, None), ('gzip;q=NaN', 200, None),
            ('gzip;q=2', 200, None), ('*;q=0, identity;q=1', 200, None),
            ('*;q=0', 406, None), ('gzip;q=0, identity;q=0', 406, None),
            ('br, identity;q=0', 406, None),
        ]:
            with self.subTest(accept=accept):
                response = self.get('/bars', {'Accept-Encoding': accept})
                self.assertEqual((response.status, response.headers.get('Content-Encoding')), (status, encoding))
                self.assertEqual(response.headers['Vary'], 'Accept-Encoding')
                response.read()

    def test_variant_etags_head_and_conditional_get(self) -> None:
        self.large_payloads()
        for path in ('/bars', '/activity'):
            raw = self.get(path)
            raw_tag = raw.headers['ETag']
            raw.read()
            encoded = self.get(path, {'Accept-Encoding': 'gzip'})
            tag, length = encoded.headers['ETag'], encoded.headers['Content-Length']
            encoded.read()
            self.assertNotEqual(tag, raw_tag)
            self.assertFalse(tag.startswith('W/'))
            head = self.get(path, {'Accept-Encoding': 'gzip'}, method='HEAD')
            self.assertEqual((head.headers['Content-Length'], head.headers['ETag'], head.read()), (length, tag, b''))
            for condition in (tag, 'W/' + tag, '"other", W/' + tag, '*'):
                unchanged = self.get(path, {'Accept-Encoding': 'gzip', 'If-None-Match': condition})
                self.assertEqual((unchanged.status, unchanged.read()), (304, b''))
                self.assertNotIn('Content-Length', unchanged.headers)
                self.assertEqual((unchanged.headers['Content-Encoding'], unchanged.headers['ETag'], unchanged.headers['Vary']), ('gzip', tag, 'Accept-Encoding'))
            changed_variant = self.get(path, {'Accept-Encoding': 'gzip', 'If-None-Match': raw_tag})
            self.assertEqual(changed_variant.status, 200)
            changed_variant.read()

    def test_small_or_incompressible_payloads_fall_back_to_identity(self) -> None:
        for payload in (b'CBAR1small', b'CBAR1' + os.urandom(16384)):
            self.state._replace(payload, b'CACT1small', sources('1'))
            response = self.get('/bars', {'Accept-Encoding': 'gzip'})
            self.assertEqual(response.read(), payload)
            self.assertNotIn('Content-Encoding', response.headers)
            self.assertEqual(self.get('/bars', {'Accept-Encoding': 'gzip, identity;q=0'}).status, 406)

    def test_refresh_keeps_a_complete_generation_while_compressing(self) -> None:
        before = self.large_payloads()
        entered, release = threading.Event(), threading.Event()
        compress = gzip.compress

        def paused(data, **kwargs):
            entered.set()
            if not release.wait(5):
                raise TimeoutError('test did not release compression')
            return compress(data, **kwargs)

        after = tuple(data + b'next' for data in before)
        with patch.object(server.gzip, 'compress', side_effect=paused):
            worker = threading.Thread(target=self.state._replace, args=(*after, sources('2')))
            worker.start()
            try:
                self.assertTrue(entered.wait(5))
                for path, expected in zip(('/bars', '/activity'), before):
                    self.assertEqual(gzip.decompress(self.get(path, {'Accept-Encoding': 'gzip'}).read()), expected)
            finally:
                release.set()
                worker.join(5)
            self.assertFalse(worker.is_alive())
        for path, expected in zip(('/bars', '/activity'), after):
            self.assertEqual(gzip.decompress(self.get(path, {'Accept-Encoding': 'gzip'}).read()), expected)

    def test_raw_snapshot_restores_the_same_compressed_variants(self) -> None:
        self.large_payloads()
        with tempfile.TemporaryDirectory() as directory:
            self.state.cache_dir = Path(directory)
            self.state.save()
            restored = server.Bars(cache_dir=Path(directory))
            self.assertTrue(restored.restore())
            for activity in (False, True):
                self.assertEqual(restored.representation(activity, 'gzip'), self.state.representation(activity, 'gzip'))

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

    def test_snapshot_restores_without_reading_the_network(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = server.Bars(self.fake.current, self.fake.read, Path(directory))
            state.refresh()
            self.fake.fail = True
            restored = server.Bars(self.fake.current, self.fake.read, Path(directory))
            self.assertTrue(restored.restore())
            self.assertEqual(restored.current(), state.current())
            self.assertEqual(restored.current_activity(), state.current_activity())
            restored.try_refresh()
            self.assertEqual(restored.current(), state.current())
            self.assertIn('hub unreachable', restored.health()['last_failure'])

    def test_corrupt_snapshot_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = server.Bars(self.fake.current, self.fake.read, Path(directory))
            state.refresh()
            path = Path(directory) / 'history.snapshot'
            data = bytearray(path.read_bytes())
            data[-1] ^= 1
            path.write_bytes(data)
            restored = server.Bars(cache_dir=Path(directory))
            self.assertFalse(restored.restore())
            self.assertFalse(restored.health()['ready'])

    def test_cold_server_answers_the_page_while_data_is_pending(self) -> None:
        self.large_payloads()
        self.state.payload = self.state.activity = b''
        self.assertEqual(self.get('/').status, 200)
        response = self.get('/bars', {'Accept-Encoding': 'gzip'})
        self.assertEqual((response.status, response.headers['Retry-After']), (503, '1'))
        response = self.get('/healthz')
        self.assertEqual(response.status, 503)
        self.assertFalse(json.loads(response.read())['ready'])


if __name__ == '__main__':
    unittest.main()
