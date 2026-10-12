'use strict';
// Sequence probabilities use every complete matching window; candle drawings are historical examples.
const ForecastViews = (() => {
  const states = ['U', 'I', 'D'];
  const names = { U: 'Above', I: 'Inside', D: 'Below' };
  const words = key => [...key].map(s => names[s]).join(' → ');
  const percent = x => `${(100 * x).toFixed(1).replace(/\.0$/, '')}%`;
  const count = n => n.toLocaleString('en-GB');
  function rate(k, n) {
    if (n < 30) return null;
    const z = 1.959964, p = k / n, d = 1 + z * z / n;
    const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return [p, c - h, c + h];
  }
  const label = w => w ? percent(w[0]) : '–';
  const evidence = (k, n) => `${count(k)} / ${count(n)} complete windows`;
  const interval = (k, n) => {
    const w = rate(k, n);
    return evidence(k, n) + (w ? ` · 95% interval ${percent(w[1])}–${percent(w[2])}` : ' · fewer than 30 supporting windows; no probability estimate');
  };
  function subset(c, prefix = '') {
    const sequences = c.sequences.filter(([key]) => key.startsWith(prefix));
    return { sequences, n: sequences.reduce((sum, [, n]) => sum + n, 0) };
  }
  function outcomes(c, prefix = '') {
    const set = subset(c, prefix), steps = c.fan.length;
    return { ...set, grid: Array.from({ length: steps }, (_, j) => states.map(s => set.sequences.reduce((sum, [key, n]) => sum + (key[j] === s ? n : 0), 0))) };
  }
  function crumbs(prefix) {
    return `<div class="forecast-crumbs"><button type="button" data-prefix="">Current combo</button>${[...prefix].map((s, j) => `<span aria-hidden="true">›</span><button type="button" data-prefix="${prefix.slice(0, j + 1)}">+${j + 1} ${names[s]}</button>`).join('')}</div>`;
  }
  function mini(example) {
    if (!example) return '';
    const lo = Math.min(...example.bars.map(b => b[2])), hi = Math.max(...example.bars.map(b => b[1]));
    const y = v => 3 + (hi - v) / (hi - lo || 1) * 42, x = j => (j + 0.5) * 40;
    return `<svg viewBox="0 0 ${example.bars.length * 40} 48" aria-hidden="true">${example.bars.map(([o, h, l, c], j) => `<g class="${c > o ? 'cu' : c < o ? 'cd' : 'cz'}"><rect x="${x(j) - 1}" y="${y(h)}" width="2" height="${Math.max(1, y(l) - y(h))}"/><rect x="${x(j) - 7}" y="${y(Math.max(o, c))}" width="14" height="${Math.max(1, Math.abs(y(o) - y(c)))}" rx="1"/></g>`).join('')}</svg>`;
  }
  function paths(c, prefix = '', selected = '') {
    const set = subset(c, prefix), leaders = set.sequences.slice(0, 4);
    const other = set.n - leaders.reduce((sum, [, n]) => sum + n, 0);
    const steps = c.fan.length;
    return crumbs(prefix) + `<div class="forecast-caption">${count(set.n)} complete windows · ${prefix ? 'given these choices' : 'whole-sequence odds'}</div><div class="forecast-path-head"><span>Probability</span><span class="forecast-steps">${Array.from({ length: steps }, (_, j) => `<span>+${j + 1}</span>`).join('')}</span></div>` + leaders.map(([key, n]) => `<button type="button" class="forecast-path" data-path="${key}" aria-pressed="${key === selected}" aria-label="${words(key)}: ${interval(n, set.n)}" title="${interval(n, set.n)}"><strong>${label(rate(n, set.n))}</strong><span class="forecast-mini">${mini(c.examples?.[key])}<span class="forecast-steps">${[...key].map(s => `<span>${s === 'U' ? '↑' : s === 'D' ? '↓' : '•'}</span>`).join('')}</span></span></button>`).join('') + `<div class="forecast-caption">Other sequences ${label(rate(other, set.n))} · ${count(other)} windows</div><div class="forecast-method">↑ Above · • Inside · ↓ Below the combo range<br>Candles show one historical example per sequence.</div>`;
  }
  function branches(c, prefix = '') {
    const set = outcomes(c, prefix), j = prefix.length;
    if (j === c.fan.length) return crumbs(prefix) + `<p class="forecast-caption">Complete sequence: ${label(rate(set.n, c.n))} of all windows</p><p class="forecast-method">${interval(set.n, c.n)}</p>`;
    const children = set.grid[j];
    const links = children.map((n, i) => `<path d="M2 108 C27 108 25 ${36 + i * 72} 50 ${36 + i * 72}" stroke-width="${set.n ? Math.max(.6, 10 * n / set.n) : .6}"/>`).join('');
    return crumbs(prefix) + `<div class="forecast-caption">Bar +${j + 1} · ${count(set.n)} supporting windows</div><div class="forecast-branch-list"><svg viewBox="0 0 52 216" preserveAspectRatio="none" aria-hidden="true">${links}</svg>${states.map((s, i) => `<button type="button" class="forecast-branch" data-prefix="${prefix + s}" ${!children[i] ? 'disabled' : ''} title="${interval(children[i], set.n)}"><span>${names[s]} <strong>${label(rate(children[i], set.n))}</strong></span><small>${label(rate(children[i], c.n))} overall · ${count(children[i])} windows</small></button>`).join('')}</div><div class="forecast-method">Closes versus the combo range.<br>Choose a branch to read the following bar.</div>`;
  }
  function grid(c, prefix = '') {
    const set = outcomes(c, prefix), steps = c.fan.length;
    const cells = states.map((s, i) => `<tr><th scope="row">${names[s]}</th>${Array.from({ length: steps }, (_, j) => {
      const k = set.grid[j][i], w = rate(k, set.n), chosen = j < prefix.length;
      return `<td><button type="button" class="forecast-cell" data-state="${s}" data-prefix="${prefix + s}" ${j !== prefix.length || !k ? 'disabled' : ''} aria-pressed="${chosen && prefix[j] === s}" aria-label="Bar +${j + 1} ${names[s]}: ${chosen ? (prefix[j] === s ? 'selected outcome' : 'excluded by selection') : interval(k, set.n)}" title="${chosen ? 'Already selected; use Current combo or a preceding choice to go back' : interval(k, set.n)}" style="--odds:${chosen ? (prefix[j] === s ? .24 : 0) : w ? .05 + .30 * w[0] : 0}">${chosen ? (prefix[j] === s ? '✓' : '–') : label(w)}</button></td>`;
    }).join('')}</tr>`).join('');
    return crumbs(prefix) + `<table aria-label="Future close probabilities relative to the current combo range"><thead><tr><th scope="col">Close</th>${Array.from({ length: steps }, (_, j) => `<th scope="col">+${j + 1}</th>`).join('')}</tr></thead><tbody>${cells}</tbody></table><div class="forecast-caption">${count(set.n)} supporting windows${prefix ? ` · ${label(rate(set.n, c.n))} overall` : ' · each column totals 100%'} · 95% intervals on each cell</div>`;
  }
  return { states, names, words, percent, rate, interval, subset, outcomes, crumbs, paths, branches, grid };
})();
