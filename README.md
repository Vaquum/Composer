# Composer

Compose bar patterns in Filang's g1 language and find the closest ones in BTCUSDT history, at
`https://composer.vaquum.fi` behind the Vaquum portal login.

Draw any number of bars, hold the relations that must stay true (pins, a skeleton, colours), let
the drawn bars skip bars of history (stretch), and filter on what the next bar did. Composer
searches the 15m, 30m, 1h, 2h and 4h BTCUSDT bars in the browser and shows the closest windows,
ranked by how they look: colours first, then shape, then sizes, with a small charge for each
comparison that flips. Prices are compared exactly as the engine does, in integer cents.

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
- `bars.py`: reads the kline files and encodes them for the page.
- `server.py`: serves the page, `matcher.js`, `/bars` and `/healthz` on `127.0.0.1` only.
- `tests/`: unit tests for reading, encoding and serving.
- `checks/`: the matcher's checks on the real bars: an independent brute force of the ranking,
  the bounded search against the unbounded one, and the two-bar colour and proportion checks.

## Checks

```sh
python3 -m unittest discover -s tests -v
python3 checks/with_bars.py checks/similarity-windows.mjs
python3 checks/with_bars.py checks/similarity-look.mjs
python3 checks/with_bars.py checks/similarity-equivalence.mjs
```

`with_bars.py` reads the current bars as the server does, once, and runs the check on them.

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
secrets, as the other services on the host do, and the repository variables `DEPLOY_DIR` and
`DEPLOY_KNOWN_HOSTS`, the host key it must present.
