"""The bars Composer searches: the Vaquum HuggingFace BTCUSDT kline files, as exact integer cents.

Each timeframe's dataset names its current file in `latest.json`; that is the file Limen's
HistoricalData reads for the same kline size. Composer reads it as recorded. Prices become exact
integer cents, and a price finer than one cent is refused, because Composer compares prices only
for exact equality, as the engine does. Missing bars stay missing: the payload says where they are,
and Composer never matches a window across one.

Payload (what matcher.js decodes): b'CBAR1', the timeframe count, then per timeframe its name,
interval in seconds, bar count, first open time and gap list as little-endian u32s, then four
varints per bar: open minus the previous close and close minus open (zigzag), then the upper and
lower shadows.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import struct
import urllib.request
from dataclasses import dataclass

HUB = 'https://huggingface.co'
# name shown in Composer, bar interval in seconds, HuggingFace dataset
TIMEFRAMES = (
    ('15m', 900, 'vaquum/binance_btcusdt_15m_klines'),
    ('30m', 1800, 'vaquum/binance_btcusdt_30m_klines'),
    ('1h', 3600, 'vaquum/binance_btcusdt_1h_klines'),
    ('2h', 7200, 'vaquum/binance_btcusdt_2h_klines'),
    ('4h', 14400, 'vaquum/binance_btcusdt_4h_klines'),
)
MAGIC = b'CBAR1'
MAX_FILE_BYTES = 256 * 1024 * 1024
TIMEOUT_SECONDS = 120


@dataclass(frozen=True)
class Source:
    """One timeframe's current kline file, pinned to the dataset revision it was read from."""

    name: str
    seconds: int
    repo: str
    revision: str
    file_name: str
    sha256: str
    row_count: int


@dataclass(frozen=True)
class Frame:
    """One timeframe's bars: open times in seconds since the epoch (UTC) and prices in cents."""

    name: str
    seconds: int
    times: list[int]
    opens: list[int]
    highs: list[int]
    lows: list[int]
    closes: list[int]


def _get(url: str, limit: int) -> bytes:
    request = urllib.request.Request(url, headers={'User-Agent': 'Vaquum-Composer'})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f'{url} is larger than {limit} bytes')
    return data


def latest(name: str, seconds: int, repo: str) -> Source:
    """The dataset's current file, read at one revision so `latest.json` and the file agree."""
    revision = json.loads(_get(f'{HUB}/api/datasets/{repo}', 1 << 22))['sha']
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError(f'{repo}: unexpected revision {revision!r}')
    meta = json.loads(_get(f'{HUB}/datasets/{repo}/resolve/{revision}/latest.json', 1 << 20))
    file_name, sha256, row_count = meta['file_name'], meta['sha256'], int(meta['row_count'])
    if not re.fullmatch(r'[A-Za-z0-9_.-]+\.parquet', file_name):
        raise ValueError(f'{repo}: unexpected file name {file_name!r}')
    if not re.fullmatch(r'[0-9a-f]{64}', sha256):
        raise ValueError(f'{repo}: latest.json has no full SHA-256')
    return Source(name, seconds, repo, revision, file_name, sha256, row_count)


def download(source: Source) -> bytes:
    data = _get(f'{HUB}/datasets/{source.repo}/resolve/{source.revision}/{source.file_name}', MAX_FILE_BYTES)
    if hashlib.sha256(data).hexdigest() != source.sha256:
        raise ValueError(f'{source.repo}/{source.file_name} does not match the SHA-256 in latest.json')
    return data


def _cents(values: list[float | None], label: str) -> list[int]:
    out = []
    for value in values:
        if value is None:
            raise ValueError(f'{label} has a missing price')
        cents = round(value * 100)
        if cents / 100 != value:
            raise ValueError(f'{label} price {value!r} is finer than one cent')
        out.append(cents)
    return out


def frame(source: Source, data: bytes) -> Frame:
    """Read one kline file as recorded and check that every bar is a candle on the timeframe's grid."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    table = pq.read_table(io.BytesIO(data), columns=['datetime', 'open', 'high', 'low', 'close'])
    label = f'{source.repo}/{source.file_name}'
    if table.num_rows != source.row_count:
        raise ValueError(f'{label} has {table.num_rows} rows, latest.json says {source.row_count}')
    stamp = table.schema.field('datetime').type
    if not pa.types.is_timestamp(stamp) or stamp.tz != 'UTC':
        raise ValueError(f'{label}: datetime must be a UTC timestamp, not {stamp}')
    per_second = {'s': 1, 'ms': 1000, 'us': 1_000_000, 'ns': 1_000_000_000}[stamp.unit]
    raw = table.column('datetime').cast(pa.int64()).to_pylist()
    if any(t is None or t % per_second for t in raw):
        raise ValueError(f'{label}: open times must be whole seconds')
    times = [t // per_second for t in raw]
    opens, highs, lows, closes = (_cents(table.column(k).to_pylist(), label) for k in ('open', 'high', 'low', 'close'))
    for i, (o, h, low, c) in enumerate(zip(opens, highs, lows, closes)):
        if not 0 < low <= min(o, c) <= max(o, c) <= h:
            raise ValueError(f'{label}: the bar opening at {times[i]} is not a candle')
        if i and ((step := times[i] - times[i - 1]) <= 0 or step % source.seconds):
            raise ValueError(f'{label}: the bar opening at {times[i]} is off the {source.name} grid')
    return Frame(source.name, source.seconds, times, opens, highs, lows, closes)


def _varint(out: bytearray, value: int) -> None:
    while value > 127:
        out.append((value & 127) | 128)
        value >>= 7
    out.append(value)


def _zigzag(out: bytearray, value: int) -> None:
    _varint(out, 2 * value if value >= 0 else -2 * value - 1)


def encode(frames: list[Frame]) -> bytes:
    out = bytearray(MAGIC)
    out.append(len(frames))
    for f in frames:
        name = f.name.encode()
        out.append(len(name))
        out += name
        # a gap is (index of the first bar after it, how many bars are missing before that bar)
        gaps = [(i, (f.times[i] - f.times[i - 1]) // f.seconds - 1)
                for i in range(1, len(f.times)) if f.times[i] - f.times[i - 1] != f.seconds]
        out += struct.pack('<IIII', f.seconds, len(f.times), f.times[0] if f.times else 0, len(gaps))
        for index, missing in gaps:
            out += struct.pack('<II', index, missing)
        previous = 0
        for o, h, low, c in zip(f.opens, f.highs, f.lows, f.closes):
            _zigzag(out, o - previous)
            _zigzag(out, c - o)
            _varint(out, h - max(o, c))
            _varint(out, min(o, c) - low)
            previous = c
    return bytes(out)


def current() -> list[Source]:
    """Every timeframe's current file, as `latest.json` names it."""
    return [latest(name, seconds, repo) for name, seconds, repo in TIMEFRAMES]


def read(sources: list[Source]) -> bytes:
    """Those files, downloaded, checked and encoded."""
    return encode([frame(source, download(source)) for source in sources])
