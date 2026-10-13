# Composer

Compose bar patterns in Filang's g1 language and find the closest ones in BTCUSDT history, at
`https://composer.vaquum.fi` behind the Vaquum portal login.

Draw any number of bars, chained as BTCUSDT bars are: the market trades around the clock, so every
bar after the first opens exactly where the previous one closed. You place each bar's close and
shadows, and a bar is green when it closes above its open and red when below; each joint is an exact
tie in the g1 pattern, which matching compares exactly. Hold the relations that must stay true
(pins, a skeleton, colours), let the drawn bars skip bars of history (stretch), and filter on what
the next bar did. Composer
searches the 15m, 30m, 1h, 2h and 4h BTCUSDT bars in the browser and shows the closest windows,
ranked by how they look: colours first, then shape, then sizes, with a small charge for each
comparison that flips. Prices are compared exactly as the engine does, in integer cents.

Two panes read the windows that match. **What sets them apart** (left) reads them the way the
Market State Cube Explorer reads a cell: each drawn bar's volume, trades and trade size against
the eleven bars before it, its maker share, its range and body in ATR, and where the last bar
closed in the prior UTC day's range, against every window, the largest difference first, then
what came next. **What it became** (right) is what only a composed shape can show: the next six
bars after the matches, drawn on the canvas as a fan in the drawing's own scale, how often they
broke the shape's high and low, and the drawings one comparison away, each of which can be put on
the canvas. Every number follows Grid: 95% intervals, Wilson for rates, t for means, nothing for
fewer than 30 windows.

On the canvas, the **Paths / Branches / States** icon control replaces only the shared six-column
forecast field. Paths always keeps up to four complete six-bar closing-state sequences visible,
with their probabilities in a separate gutter. Branches conditions later columns on the earlier
closing states you choose. States shows each future close above the original matching combo's
highest wick, inside its inclusive range, or below its lowest wick; column areas total 100%.
The independent **Fan** switch places softly tinted closing-price quantiles underneath any mode.
Width changes only the root candle bodies; their centers and all forecast geometry stay fixed.

Probability counts use every complete six-bar continuation, including windows outside the fan's
sample. Hover a mark, label or control for 500 ms for its definition, denominator, conditioning and
Wilson 95% interval. Keyboard focus and touch explain immediately; leaving, scrolling or Escape
dismisses the tooltip. Fan explanations identify its sample size and normalized per-bar quantiles.
No estimate is shown for fewer than 30 supporting windows.

Loading keeps the same field and never fabricates probabilities. Updates retain and label the
previous snapshot; outcome selection waits for the new result. Sparse results clear stale odds,
and Retry preserves the drawing and mode preferences. Mode changes retain the camera and shared
column positions, including at narrow widths. Reduced motion is respected.

Each pane has its own design pill and previous/next arrows: **Signal first** highlights the
largest finding, **Comparison ledger** aligns selected and all-window values, and **Bar by bar**
organizes readings by drawn bar and continuation by time. The pill also offers direct selection.
Choices are remembered independently in this browser; changing a design never changes the cohort.
Measurement details and the remaining readings expand below the primary findings.

The reference (the ⓘ in the header) explains how to read the panels, in the pattern of the cube
explorer's System reference: a full-height pane on the left that pushes the workspace right, one
Purpose, Read and Use per topic, and Show, which highlights the part a topic is about and dims the
rest.

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

Open [127.0.0.1:8488](http://127.0.0.1:8488). The server reads the five files (about 40 MB) before
it answers.

## Files

- `index.html`: the page.
- `matcher.js`: the matcher, run by the page as a Web Worker.
- `pane-designs.js` and `panes.css`: the three pane layouts, using the matcher's live results.
- `forecast.js`: canvas sequence, conditional-branch and probability-grid presentations.
- `bars.py`: reads the kline files and encodes them for the page.
- `server.py`: serves the page, `matcher.js`, `/bars`, `/activity` (each bar's volume, quote
  volume, trades and maker volume, for the panes) and `/healthz` on `127.0.0.1` only.
- `tests/`: unit tests for reading, encoding and serving.
- `checks/`: the matcher's checks on the real bars: an independent brute force of the ranking,
  the bounded search against the unbounded one, the two-bar colour and proportion checks, and the
  panes against an independent recomputation.

## Checks

```sh
python3 -m unittest discover -s tests -v
node checks/page.mjs
node checks/pane-designs.mjs
node checks/forecast.mjs
node checks/forecast-ux.mjs
python3 checks/with_bars.py checks/similarity-windows.mjs
python3 checks/with_bars.py checks/similarity-look.mjs
python3 checks/with_bars.py checks/similarity-equivalence.mjs
python3 checks/with_bars.py checks/panes.mjs
```

`with_bars.py` reads the current bars as the server does, once, and runs the check on them.
`python3 checks/all.py` runs all required checks sequentially, including the container build.

## Deploy

Composer runs on the Origo host as the Compose project `composer` in `/opt/composer`: it builds the
`Dockerfile` and serves on `127.0.0.1:8488` only, as a non-root user on a read-only filesystem. It
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

