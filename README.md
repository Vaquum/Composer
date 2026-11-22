# Composer

Compose bar patterns in Filang's g1 language and find the closest ones in BTCUSDT history, at
`https://composer.vaquum.fi` behind the Vaquum portal login.

Draw two to twenty bars in a chain. Every bar after the first opens exactly where the previous
one closed. You place each bar's close and shadows. A bar is green when it closes above its open
and red when below. Each joint is an exact tie in the g1 pattern, which matching compares exactly.
History is read the same way when it is
compared with a drawing: a window's first bar is read as recorded, and every later bar opens at the
close of the recorded bar just before it, with its low and high widened to include that open. A
recorded open is often a cent away from the previous close, and read as recorded that cent would
break the joint's tie. The record itself is not changed. Hold the relations that must stay true
(pins, a skeleton, colours), let the drawn bars skip bars of history (stretch), and filter on what
the next bar did. Composer
searches the 15m, 30m, 1h, 2h and 4h BTCUSDT bars in the browser and shows the closest windows,
ranked by how they look: colours first, then shape, then sizes, with a small charge for each
comparison that flips. Prices are compared exactly as the engine does, in integer cents.

Use **Rows** to switch between timeframes, matched windows, shapes one comparison away, holds and
closing paths. **Inspect** shows readings for the selected row and column. Pick where any of the
six later bars closes relative to the drawing's range to narrow the closing paths. Composer shows
estimates for cohorts with at least 30 complete windows.

The address records the drawing, search terms and closing-state picks for sharing. Existing
`/bench/` links open at `/` with their drawing or pattern intact. Use **Query** to carry the drawing
and its holds to the Filang query bench.

## Data

The bars are the Vaquum HuggingFace kline datasets `vaquum/binance_btcusdt_{15m,30m,1h,2h,4h}_klines`,
the files Limen's `HistoricalData` reads. For each one the server reads `latest.json` at the
dataset's current revision, downloads the file it names, checks its SHA-256 and row count, and
reads it as recorded: prices become exact integer cents (a price finer than a cent is refused),
and missing bars stay missing, so no window crosses a gap. It looks for newer files every hour;
if a read fails it keeps serving the bars it has, logs why, and `/healthz` shows the failure.
No data is committed to this repository.

## Run locally

```sh
pip install -r requirements.txt
python3 server.py --port 8488
```

Open [127.0.0.1:8488](http://127.0.0.1:8488). The page answers immediately. A checksummed history snapshot in `~/.cache/composer`
(or `COMPOSER_CACHE_DIR`) serves data across restarts while newer files load in the background.
On a first start the page remains usable while history loads; data endpoints report readiness.
Bars download before activity so the first matches need only the matching payload.

## Files

- `bench/` contains the page, drawing model and interface.
- `matcher.js` runs the matcher as a Web Worker.
- `bars.py` reads the kline files and encodes them for the matcher.
- `server.py` serves the page, the worker, `/bars`, `/activity` and `/healthz` on `127.0.0.1` only.
- `tests/` and `checks/` cover reading, encoding, serving, matching and browser behavior.

## Checks

```sh
npm ci
npx playwright install chromium
python3 -m unittest discover -s tests -v
python3 checks/with_bars.py checks/similarity-windows.mjs
python3 checks/with_bars.py checks/similarity-look.mjs
python3 checks/with_bars.py checks/similarity-equivalence.mjs
python3 checks/with_bars.py checks/panes.mjs
python3 checks/with_bars.py checks/bench.mjs
```

`with_bars.py` reads the current bars as the server does, once, and runs the check on them.
`python3 checks/all.py` runs all required checks sequentially, including the container build.

## Deploy

Composer runs on the Origo host as the Compose project `composer` in `/opt/composer`: it builds the
`Dockerfile` and serves on `127.0.0.1:8488` only, as a non-root user on a read-only filesystem with a named volume for its validated history snapshot. It
checks no credentials of its own: TLS and the login are the host's Caddy, deployed from
[Vaquum/Portal](https://github.com/Vaquum/Portal), whose `composer.vaquum.fi` site passes a request
on to `127.0.0.1:8488` only after the Vaquum portal login. `composer.vaquum.fi` is a DNS-only A
record for the host, and Portal's landing page has Composer's card.

Every push to `main` deploys through `.github/workflows/deploy.yml`, which first runs the checks of
`.github/workflows/check.yml` and continues only if they passed for that exact commit; then it syncs
the checkout to the host with rsync, runs `docker compose up -d --build`, and checks over SSH that
Composer answers. It reaches the host with the organisation's `TDW_IP`, `TDW_USER` and `TDW_KEY`
secrets once they are shared with this repository, as Explorer, Mill, Furnace and Crucible do, or
else with this repository's `DEPLOY_SSH_KEY` secret and `DEPLOY_HOST` and `DEPLOY_USER` variables,
as the Market State Cube Explorer does. `DEPLOY_DIR` names the directory on the host, and
`DEPLOY_KNOWN_HOSTS` the host key the host must present.


### Named candle patterns

Open **Patterns** to browse the English and Japanese names or open a link such as `/?pattern=hammer`. Choose a timeframe to count every complete window satisfying the displayed rule and inspect its most recent closes in UTC. Clicking a name under the drawing opens the same rule. Gaps reset two-bar windows. These counts use observed OHLC prices, including recorded opens, independently of the drawing's nearest matches, pins, next-bar filters and closing paths.

[patterns.js](patterns.js) defines profile v1. Every entry has a stable ID, names, a window length and an executable comparison tree. Operands are integer price levels, body or wick lengths, direction, and positive integral multiples; `prev.` refers to the preceding bar. Relations use exact price ticks, including ties. A changed rule needs a new version. Downstream clients pin and copy this file without rewriting its predicates. A G1 string expresses endpoint order; wick-to-body length ratios require measured OHLC distances.

The original names use the geometry in [Composer at 133e301](https://github.com/Vaquum/Composer/blob/133e3017ba9143f7dc255df7218ff7bfe46d9d06/index.html#L730). Profile v1 adds Hammer and Inverted hammer shapes, Spinning top, Four-price doji and the Inside/Outside bar range relations already described on the paper. A Hammer requires a nonzero body, a lower wick at least twice its length and an upper wick at most half its length. Short-wick tolerance is a Composer convention. The profile tests geometry at the close and imposes no preceding trend or subsequent reversal confirmation. Other implementations can choose different definitions, including the adaptive lookbacks in [TA-Lib Hammer](https://ta-lib.org/functions/cdlhammer) and [Limen's CDL indicators](https://github.com/Vaquum/Limen/tree/main/limen/indicators).

English and Japanese naming references include [IG Japan's candlestick lessons](https://www.ig.com/jp/ig-academy/the-basics-of-technical-analysis/candlestick-patterns), [IG Japan's basic candle forms](https://www.ig.com/jp/trading-strategies/candlestick-trading-explained-250913), [TradingView's Japanese pattern list](https://jp.tradingview.com/support/solutions/43000752737/), [Inside bar](https://jp.tradingview.com/support/solutions/43000591665/), [Outside bar](https://jp.tradingview.com/support/solutions/43000599887/), [Fujitomi’s Tsutsumi-sen reading](https://www.fujitomi.co.jp/stockfx/kojiro_rep/10339/), [CandleScanner’s Tonbo entry](https://www.candlescanner.com/candlestick-patterns/dragonfly-doji/), and [Fujitomi's four-price form](https://fujitomi.co.jp/wp-content/uploads/2017/11/ktv094.pdf).
