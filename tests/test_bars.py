"""bars.py reads the HuggingFace kline files exactly, and matcher.js decodes exactly what it encodes."""

from __future__ import annotations

import hashlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import bars  # noqa: E402

T0 = 1577836800  # 2020-01-01 00:00 UTC


def parquet(times: list[int], rows: list[tuple[float, float, float, float]], unit: str = 'ms', tz: str | None = 'UTC',
            traded: list[tuple[float, float, int, float]] | None = None) -> bytes:
    scale = {'s': 1, 'ms': 1000}[unit]
    traded = traded or [(10.0 + i, 70000.0 * (10 + i), 100 + i, 4.0) for i in range(len(rows))]
    table = pa.table({
        'datetime': pa.array([t * scale for t in times], pa.timestamp(unit, tz=tz)),
        'open': [r[0] for r in rows], 'high': [r[1] for r in rows], 'low': [r[2] for r in rows], 'close': [r[3] for r in rows],
        'volume': [x[0] for x in traded], 'liquidity_sum': [x[1] for x in traded],
        'no_of_trades': pa.array([x[2] for x in traded], pa.uint64()), 'maker_volume': [x[3] for x in traded],
    })
    out = io.BytesIO()
    pq.write_table(table, out)
    return out.getvalue()


def source(data: bytes, rows: int, seconds: int = 900, name: str = '15m') -> bars.Source:
    return bars.Source(name, seconds, 'vaquum/binance_btcusdt_15m_klines', 'a' * 40, 'f.parquet', hashlib.sha256(data).hexdigest(), rows)


class Frames(unittest.TestCase):
    def test_prices_become_exact_cents(self) -> None:
        self.assertEqual(bars._cents([7195.24, 7245.0, 0.01], 'x'), [719524, 724500, 1])
        with self.assertRaisesRegex(ValueError, 'finer than one cent'):
            bars._cents([7195.245], 'x')
        with self.assertRaisesRegex(ValueError, 'missing price'):
            bars._cents([None], 'x')

    def test_a_file_is_read_as_recorded_with_its_gaps(self) -> None:
        times = [T0, T0 + 900, T0 + 4 * 900, T0 + 5 * 900]
        rows = [(7195.24, 7245.0, 7175.46, 7225.01), (7225.0, 7236.27, 7199.11, 7209.83), (7209.83, 7210.0, 7200.0, 7200.0), (7200.0, 7200.0, 7200.0, 7200.0)]
        data = parquet(times, rows)
        f = bars.frame(source(data, 4), data)
        self.assertEqual(f.times, times)
        self.assertEqual((f.opens[0], f.highs[0], f.lows[0], f.closes[0]), (719524, 724500, 717546, 722501))
        self.assertEqual(f.closes[3], 720000)
        self.assertEqual((f.volumes[1], f.quotes[1], f.trades[1], f.makers[1]), (11.0, 770000.0, 101, 4.0))

    def test_bad_files_are_refused(self) -> None:
        good = (100.0, 101.0, 99.0, 100.5)
        cases = {
            'not a candle': (parquet([T0], [(100.0, 99.0, 98.0, 100.5)]), 1, 'not a candle'),
            'off the grid': (parquet([T0, T0 + 600], [good, good]), 2, 'off the 15m grid'),
            'out of order': (parquet([T0 + 900, T0], [good, good]), 2, 'off the 15m grid'),
            'row count': (parquet([T0], [good]), 2, 'latest.json says 2'),
            'not UTC': (parquet([T0], [good], tz=None), 1, 'UTC timestamp'),
            'no volume': (parquet([T0], [good], traded=[(0.0, 1.0, 1, 0.0)]), 1, 'no usable volume'),
            'maker beyond volume': (parquet([T0], [good], traded=[(1.0, 1.0, 1, 1.5)]), 1, 'no usable volume'),
        }
        for label, (data, rows, message) in cases.items():
            with self.subTest(label), self.assertRaisesRegex(ValueError, message):
                bars.frame(source(data, rows), data)

    def test_download_checks_the_sha256_from_latest_json(self) -> None:
        data = b'parquet bytes'
        good = source(data, 1)
        with mock.patch.object(bars, '_get', return_value=data):
            self.assertEqual(bars.download(good), data)
            with self.assertRaisesRegex(ValueError, 'does not match the SHA-256'):
                bars.download(bars.Source(**{**good.__dict__, 'sha256': '0' * 64}))

    def test_latest_reads_latest_json_at_one_revision(self) -> None:
        revision = '1' * 40
        answers = {
            'https://huggingface.co/api/datasets/vaquum/binance_btcusdt_4h_klines': json.dumps({'sha': revision}).encode(),
            f'https://huggingface.co/datasets/vaquum/binance_btcusdt_4h_klines/resolve/{revision}/latest.json':
                json.dumps({'file_name': 'btcusdt_4h_kline_20200101_to_20261009.parquet', 'sha256': 'b' * 64, 'row_count': 14843}).encode(),
        }
        with mock.patch.object(bars, '_get', side_effect=lambda url, limit: answers[url]):
            s = bars.latest('4h', 14400, 'vaquum/binance_btcusdt_4h_klines')
        self.assertEqual((s.revision, s.file_name, s.row_count), (revision, 'btcusdt_4h_kline_20200101_to_20261009.parquet', 14843))
        answers[f'https://huggingface.co/datasets/vaquum/binance_btcusdt_4h_klines/resolve/{revision}/latest.json'] = json.dumps(
            {'file_name': '../x.parquet', 'sha256': 'b' * 64, 'row_count': 1}).encode()
        with mock.patch.object(bars, '_get', side_effect=lambda url, limit: answers[url]), self.assertRaisesRegex(ValueError, 'unexpected file name'):
            bars.latest('4h', 14400, 'vaquum/binance_btcusdt_4h_klines')


class Payload(unittest.TestCase):
    def test_the_matcher_decodes_what_bars_encodes(self) -> None:
        node = shutil.which('node')
        if node is None:
            self.fail('node is needed to check that matcher.js decodes what bars.py encodes')
        frames = [
            bars.Frame('15m', 900, [T0, T0 + 900, T0 + 3600, T0 + 4500], [719524, 722500, 720983, 1], [724500, 723627, 721000, 3],
                       [717546, 719911, 720000, 1], [722501, 720983, 720000, 2]),
            bars.Frame('4h', 14400, [T0 + 14400 * k for k in (0, 1, 2, 5)], [100, 103, 103, 90], [110, 104, 108, 120], [95, 100, 101, 80], [103, 103, 105, 119]),
        ]
        with tempfile.NamedTemporaryFile(suffix='.bin') as tmp:
            tmp.write(bars.encode(frames))
            tmp.flush()
            out = subprocess.run([node, str(ROOT / 'tests' / 'decode.mjs'), str(ROOT / 'matcher.js'), tmp.name],
                                 capture_output=True, text=True, check=True).stdout
        decoded = json.loads(out)
        self.assertEqual(len(decoded), 2)
        for f, d in zip(frames, decoded):
            self.assertEqual((d['name'], d['sec'], d['ts']), (f.name, f.seconds, f.times))
            self.assertEqual((d['O'], d['H'], d['L'], d['C']), (f.opens, f.highs, f.lows, f.closes))
        # a bar after missing bars starts a new run, so no window crosses the gap
        self.assertEqual(decoded[0]['run'], [1, 2, 1, 2])
        self.assertEqual(decoded[1]['run'], [1, 2, 3, 1])


class Activity(unittest.TestCase):
    def test_the_matcher_decodes_what_traded_within_its_precision(self) -> None:
        node = shutil.which('node')
        if node is None:
            self.fail('node is needed to check that matcher.js decodes what bars.py encodes')
        frames = [
            bars.Frame('15m', 900, [T0, T0 + 900, T0 + 1800], [1, 1, 1], [2, 2, 2], [1, 1, 1], [2, 2, 2],
                       [3.98538, 1234.5, 40371.4], [292226.0, 9.1e7, 1.086850286e9], [224, 51234, 1754730], [0.5, 600.1, 37252.4]),
            bars.Frame('4h', 14400, [T0], [1], [2], [1], [2], [5.887], [400000.0], [300], [5.887]),
        ]
        with tempfile.NamedTemporaryFile(suffix='.act') as tmp:
            tmp.write(bars.encode_activity(frames))
            tmp.flush()
            out = subprocess.run([node, str(ROOT / 'tests' / 'decode.mjs'), str(ROOT / 'matcher.js'), '--activity', tmp.name],
                                 capture_output=True, text=True, check=True).stdout
        decoded = json.loads(out)
        for f, d in zip(frames, decoded):
            self.assertEqual((d['name'], d['n']), (f.name, len(f.times)))
            for key, want in (('vol', f.volumes), ('quote', f.quotes), ('trades', f.trades)):
                for got, w in zip(d[key], want):
                    self.assertLess(abs(got / w - 1), 3e-4, (key, got, w))
            for got, v, m in zip(d['maker'], f.volumes, f.makers):
                self.assertLess(abs(got - m / v), 1 / 65535)

    def test_activity_must_cover_every_bar(self) -> None:
        with self.assertRaisesRegex(ValueError, 'does not cover every bar'):
            bars.encode_activity([bars.Frame('15m', 900, [T0], [1], [2], [1], [2])])


if __name__ == '__main__':
    unittest.main()
