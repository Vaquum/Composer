"""The server answers the page, the matcher, the bars and its health, and refreshes the bars only when the files change."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import struct
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
# The server serves the Filang engine's two files from the folder this names. These tests do not run the engine, so
# they serve stand-ins of their own: the folder is named before the server reads it.
ENGINE = tempfile.TemporaryDirectory()
(Path(ENGINE.name) / 'index.mjs').write_text('const ABI = 1;\n' + 'export const filler = 0;\n' * 400)
(Path(ENGINE.name) / 'filang_engine.wasm').write_bytes(b'\0asm\x01\0\0\0' + bytes(4096))
os.environ['COMPOSER_ENGINE_DIR'] = ENGINE.name
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
        self.assertIn(b'<script type="module" src="/bench/bench.js">', page.read())
        self.assertEqual(self.get('/matcher.js').headers['Content-Type'], 'text/javascript; charset=utf-8')
        self.assertEqual(self.get('/bench/bench.js').headers['Content-Type'], 'text/javascript; charset=utf-8')
        self.assertEqual(self.get('/bench/composer.css').headers['Content-Type'], 'text/css; charset=utf-8')
        self.assertEqual(self.get('/motion.js').status, 404)
        self.assertEqual(self.get('/panes.css').status, 404)
        self.assertEqual(self.get('/patterns.js').status, 404)
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

    def test_counters_must_belong_to_the_downloaded_bars(self) -> None:
        self.state._replace(b'CBAR1old', b'CACT1old', sources('1'), b'CCNT1old')
        tag = self.get('/bars').headers['ETag']
        self.assertEqual(self.get('/counters', {'X-Composer-Bars': tag}).read(), b'CCNT1old')
        self.state._replace(b'CBAR1new', b'CACT1new', sources('2'), b'CCNT1new')
        self.assertEqual(self.get('/counters', {'X-Composer-Bars': tag}).status, 409)
        new_tag = self.get('/bars').headers['ETag']
        self.assertEqual(self.get('/counters', {'X-Composer-Bars': new_tag}).read(), b'CCNT1new')

    def test_the_engine_is_served_compressed_and_revalidated(self) -> None:
        wasm = self.get('/engine/filang_engine.wasm')
        self.assertEqual((wasm.status, wasm.headers['Content-Type']), (200, 'application/wasm'))
        raw = wasm.read()
        self.assertTrue(raw.startswith(b'\0asm'))
        self.assertEqual(self.get('/engine/index.mjs').headers['Content-Type'], 'text/javascript; charset=utf-8')
        self.assertEqual(self.get('/engine/worker.mjs').status, 404)
        packed = self.get('/engine/filang_engine.wasm', {'Accept-Encoding': 'gzip'})
        self.assertEqual((packed.headers['Content-Encoding'], packed.headers['Vary']), ('gzip', 'Accept-Encoding'))
        body = packed.read()
        self.assertLess(len(body), len(raw))
        self.assertEqual(gzip.decompress(body), raw)
        # each form has its own validator, and a page that has not changed is not sent again
        self.assertNotEqual(packed.headers['ETag'], wasm.headers['ETag'])
        again = self.get('/engine/filang_engine.wasm', {'Accept-Encoding': 'gzip', 'If-None-Match': packed.headers['ETag']})
        self.assertEqual((again.status, again.read()), (304, b''))
        self.assertEqual(self.get('/bench/bench.js', {'If-None-Match': self.get('/bench/bench.js').headers['ETag']}).status, 304)

    def test_static_assets_respect_encoding_preferences(self) -> None:
        for path in ('/', '/bench/bench.js', '/engine/filang_engine.wasm'):
            with self.subTest(path=path):
                raw = self.get(path, {'Accept-Encoding': 'identity'})
                body, tag = raw.read(), raw.headers['ETag']
                rejected = self.get(path, {'Accept-Encoding': 'gzip;q=0, identity'})
                self.assertEqual((rejected.status, rejected.headers.get('Content-Encoding'), rejected.read()), (200, None, body))
                self.assertEqual(rejected.headers['ETag'], tag)
                self.assertEqual(self.get(path, {'Accept-Encoding': 'gzip;q=0, identity', 'If-None-Match': tag}).status, 304)
                packed = self.get(path, {'Accept-Encoding': 'x-gzip'})
                self.assertEqual((packed.headers['Content-Encoding'], gzip.decompress(packed.read())), ('gzip', body))
                for method in ('GET', 'HEAD'):
                    refused = self.get(path, {'Accept-Encoding': 'gzip;q=0, identity;q=0'}, method=method)
                    self.assertEqual((refused.status, refused.headers['Vary']), (406, 'Accept-Encoding'))

    def test_page_aliases_keep_the_query(self) -> None:
        query = '?drawing=%7B%22bars%22%3A%5B%5D%7D&pattern=hammer'
        for path in ('/bench', '/bench/', '/bench/index.html', '/index.html'):
            with self.subTest(path=path), self.get(path + query) as page:
                self.assertEqual((page.status, page.url), (200, self.base + '/' + query))

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

    def test_counters_are_served_beside_the_activity(self) -> None:
        # a reader that has no counters leaves them pending, and the page waits as it does for the bars
        response = self.get('/counters')
        self.assertEqual((response.status, response.headers['Retry-After']), (503, '1'))
        counters = b'CCNT1' + b'counter-values' * 10000
        self.state._replace(b'CBAR1bars', b'CACT1activity', sources('1'), counters)
        raw = self.get('/counters')
        tag = raw.headers['ETag']
        self.assertEqual((raw.status, raw.read(), raw.headers['Cache-Control']), (200, counters, 'private, no-cache'))
        self.assertNotIn(tag, (self.get('/bars').headers['ETag'], self.get('/activity').headers['ETag']))
        self.assertEqual(self.get('/counters', {'If-None-Match': tag}).status, 304)
        encoded = self.get('/counters', {'Accept-Encoding': 'gzip'})
        self.assertEqual((encoded.headers['Content-Encoding'], gzip.decompress(encoded.read())), ('gzip', counters))
        self.assertEqual(self.state.current_counters(), (counters, tag))
        # the other two payloads are what they were
        self.assertEqual((self.get('/bars').read(), self.get('/activity').read()), (b'CBAR1bars', b'CACT1activity'))

    def test_a_reader_with_counters_has_them_served_and_kept_in_the_snapshot(self) -> None:
        def read(found: list[bars.Source]) -> tuple[bytes, bytes, bytes]:
            self.fake.reads += 1
            return b'CBAR1x', b'CACT1x', b'CCNT1' + found[0].sha256[:1].encode()

        with tempfile.TemporaryDirectory() as directory:
            state = server.Bars(self.fake.current, read, Path(directory))
            self.assertTrue(state.refresh())
            self.assertEqual(state.current_counters()[0], b'CCNT11')
            restored = server.Bars(self.fake.current, read, Path(directory))
            self.assertTrue(restored.restore())
            self.assertEqual((restored.current(), restored.current_activity(), restored.current_counters()),
                             (state.current(), state.current_activity(), state.current_counters()))
            for counters in (False, True):
                self.assertEqual(restored.representation(True, 'gzip', counters), state.representation(True, 'gzip', counters))
            # the snapshot is whole: nothing is read again until the files change
            reads = self.fake.reads
            self.assertFalse(restored.refresh())
            self.assertEqual(self.fake.reads, reads)
            # counters that do not match their checksum make the snapshot invalid
            path = Path(directory) / 'history.snapshot'
            data = bytearray(path.read_bytes())
            data[-1] ^= 1
            path.write_bytes(data)
            self.assertFalse(server.Bars(cache_dir=Path(directory)).restore())

    def test_a_snapshot_from_before_the_counters_restores_and_is_read_once_more(self) -> None:
        def read(found: list[bars.Source]) -> tuple[bytes, bytes, bytes]:
            self.fake.reads += 1
            return b'CBAR1new', b'CACT1new', b'CCNT1new'

        payload, activity = b'CBAR1old', b'CACT1old'
        meta = json.dumps({'sources': [s.__dict__ for s in sources('1')], 'bars_bytes': len(payload),
                           'bars_sha256': hashlib.sha256(payload).hexdigest(), 'activity_sha256': hashlib.sha256(activity).hexdigest()}).encode()
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'history.snapshot').write_bytes(b'CSNAP1' + struct.pack('<I', len(meta)) + meta + payload + activity)
            state = server.Bars(self.fake.current, read, Path(directory))
            self.assertTrue(state.restore())
            # the bars and the activity are served at once, as they were; the counters are owed
            self.assertEqual((state.current()[0], state.current_activity()[0], state.current_counters()[0]), (payload, activity, b''))
            reads = self.fake.reads
            self.assertTrue(state.refresh())   # the same files, read once more for their counters
            self.assertEqual((self.fake.reads, state.current_counters()[0]), (reads + 1, b'CCNT1new'))
            self.assertFalse(state.refresh())
            self.assertEqual(self.fake.reads, reads + 1)
            again = server.Bars(self.fake.current, read, Path(directory))
            self.assertTrue(again.restore())
            self.assertEqual(again.current_counters()[0], b'CCNT1new')
            self.assertFalse(again.refresh())

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
