// Original rectangle renderer, retained only as an independent pixel reference.
export default function referenceThumbnail(r, held) {
    const w = 132, h = 80, pad = 5, bars = r.raw, n = bars.length;
    const lo = Math.min(...bars.map(b => b[2])), hi = Math.max(...bars.map(b => b[1]));
    const pitch = (w - 2 * pad) / n, bw = Math.max(1.4, pitch * 0.6), ww = Math.max(0.8, Math.min(1.4, pitch * 0.08));
    const X = i => pad + pitch * (i + 0.5), Y = v => pad + (hi - v) / (hi - lo || 1) * (h - 2 * pad - 5);
    let s = `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true">`;
    // bars the drawing skipped stay visible but faint, so the run reads as it happened
    const kept = new Set(r.picks);
    bars.forEach(([o, hh, l, c], i) => {
      const cls = (c > o ? 'cu' : c < o ? 'cd' : 'cz') + (kept.has(i) ? '' : ' skip'), t = Y(Math.max(o, c)), b = Y(Math.min(o, c));
      s += `<rect class="${cls}" x="${(X(i) - ww / 2).toFixed(2)}" y="${Y(hh).toFixed(2)}" width="${ww.toFixed(2)}" height="${Math.max(0.6, Y(l) - Y(hh)).toFixed(2)}"/><rect class="${cls}" x="${(X(i) - bw / 2).toFixed(2)}" y="${t.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(1, b - t).toFixed(2)}" rx="0.6"/>`;
    });
    for (const bi of r.broken) {
      const hd = held[bi].h;
      if (hd.color) { const b = bars[hd.bar], t = Y(Math.max(b[0], b[3])), bt = Y(Math.min(b[0], b[3])); s += `<rect class="mk" x="${(X(hd.bar) - bw / 2 - 2).toFixed(2)}" y="${(t - 2).toFixed(2)}" width="${(bw + 4).toFixed(2)}" height="${(Math.max(1, bt - t) + 4).toFixed(2)}" rx="1.5"/>`; continue; }
      const pt = ([bar, kind]) => { const [o, hh, l, c] = bars[bar]; return [X(bar), Y([o, hh, l, c, Math.min(o, c), Math.max(o, c)][kind])]; };
      const [x1, y1] = pt(hd.a), [x2, y2] = pt(hd.b);
      s += `<line class="mkl" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/><circle class="mk" cx="${x1.toFixed(2)}" cy="${y1.toFixed(2)}" r="2.4"/><circle class="mk" cx="${x2.toFixed(2)}" cy="${y2.toFixed(2)}" r="2.4"/>`;
    }
    return s + '</svg>';
  }
