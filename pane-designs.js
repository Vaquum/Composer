// Pure presentation of the matcher's results. Each pane chooses its own layout;
// changing a layout never changes the cohort or recomputes a statistic.
const PaneDesigns = (() => {
  const variants = [
    { id: 'signal', name: 'Signal first' },
    { id: 'ledger', name: 'Comparison ledger' },
    { id: 'bars', name: 'Bar by bar' },
  ];
  const names = { vol: 'Volume', trades: 'Trades', size: 'Mean trade size', maker: 'Maker volume share', range: 'Range', body: 'Body', day: 'Close in prior-day range' };
  const groups = { vol: 'Activity', trades: 'Activity', size: 'Trade size', maker: 'Aggression', range: 'Movement', body: 'Movement', day: 'Location' };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n).toLocaleString('en-US');
  const pct = x => `${(x * 100).toFixed(1)}%`;
  const f2 = x => x.toFixed(2).replace('-', '−');
  const label = w => names[w.key];
  const value = (w, x) => w.log ? `${Math.exp(x).toFixed(2)}×` : w.key === 'maker' ? pct(x) : w.key === 'day' ? `${(x * 100).toFixed(0)}%` : f2(x);
  const unit = w => w.key === 'body' || w.key === 'range' ? ' ATR' : '';
  const displayed = (w, x) => value(w, x) + unit(w);
  const sorted = P => (P.rows || []).slice().sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const clear = w => w.set[1] > w.all[0] || w.set[2] < w.all[0];
  const detail = (key, title, content, open = false) => `<details class="pane-details" data-detail="${key}"${open ? ' open' : ''}><summary>${title}</summary>${content}</details>`;
  const legend = () => '<div class="pane-legend"><span><i class="legend-dot" aria-hidden="true"></i>Selected</span><span><i class="legend-band" aria-hidden="true"></i>95% interval</span><span><i class="legend-tick" aria-hidden="true"></i>All</span></div>';
  function track(w) {
    const lo = w.set[1], hi = w.set[2], ref = w.all[0], a = Math.min(lo, ref), b = Math.max(hi, ref);
    const pad = (b - a) * .6 || .05, mn = a - pad, mx = b + pad, at = x => (x - mn) / (mx - mn) * 100;
    return `<div class="trk" role="img" aria-label="Selected mean ${displayed(w,w.set[0])}; 95% interval ${displayed(w,lo)} to ${displayed(w,hi)}; all-window mean ${displayed(w,ref)}"><i class="bd" style="left:${at(lo)}%;width:${at(hi)-at(lo)}%"></i><i class="dt" style="left:${at(w.set[0])}%"></i><i class="tk" style="left:${at(ref)}%"></i></div>`;
  }
  const reading = (w, showBar = true) => `<div class="prow" data-reading="${w.bar}-${w.key}"><div class="pl"><span>${showBar ? 'Bar '+(w.bar+1)+' · ' : ''}${label(w)}</span><b>${displayed(w,w.set[0])}</b></div><div class="pane-reading-bottom">${track(w)}<span class="pane-baseline">All ${displayed(w,w.all[0])}</span></div></div>`;
  const difference = w => {
    if (w.key === 'maker' || w.key === 'day') { const d = (w.set[0]-w.all[0])*100; return `${d > 0 ? '+' : ''}${d.toFixed(1).replace('-','−')} pp`; }
    const ratio = w.log ? Math.exp(w.set[0]-w.all[0]) : w.all[0] > 0 ? w.set[0]/w.all[0] : null;
    return ratio === null ? '' : `${ratio.toFixed(1)}× as large`;
  };
  function table(rows) {
    return `<table class="pane-ledger"><caption class="sr-only">Selected-window means compared with all-window means</caption><thead><tr><th>Reading</th><th>Selected</th><th>All</th></tr></thead><tbody>${rows.map(w=>`<tr class="prow" data-reading="${w.bar}-${w.key}"><td>${label(w)}<small>Bar ${w.bar+1}${unit(w) ? ' · ATR' : w.log ? ' · vs prior 11' : ''}</small></td><td>${value(w,w.set[0])}</td><td>${value(w,w.all[0])}</td></tr>`).join('')}</tbody></table>`;
  }
  function left(variant, r, ctx) {
    const P = r.panes, all = sorted(P), first = all.slice(0,10);
    if (P.n < 30) return '<p class="pcap">Fewer than 30 windows: no estimate.</p>';
    if (!P.readings) return `<p class="pcap">${ctx.readings === 'failed' ? 'Activity readings unavailable: '+esc(ctx.note)+'.' : 'Reading activity…'}</p>`;
    if (!all.length) return '<p class="pcap">Not enough measured activity for these readings.</p>';
    if (variant === 'bars') {
      return legend()+Array.from({length:ctx.barCount},(_,bar)=>{
        const rows = all.filter(w=>w.bar === bar), lead = rows[0];
        return detail('bar-'+bar, `<strong>Bar ${bar+1}</strong><span class="pane-bar-summary">${lead ? `${label(lead)} <b>${displayed(lead,lead.set[0])}</b> · all ${displayed(lead,lead.all[0])}` : 'No estimate for this bar'}</span>`,rows.map(w=>reading(w,false)).join(''),bar === 0);
      }).join('')+'<p class="pane-note">Activity and trade size are relative to the prior 11 bars.</p>';
    }
    const remaining = all.length > 10 ? detail('more', `${all.length-10} more readings`, variant === 'ledger' ? table(all.slice(10)) : all.slice(10).map(w=>reading(w)).join('')) : '';
    if (variant === 'ledger') {
      const count = first.filter(clear).length;
      return '<p class="pane-order">Largest differences first</p>'+table(first)+`<p class="pane-note">${count} of ${first.length} intervals exclude the all-window mean.</p>`+remaining+detail('intervals',`95% intervals · all ${all.length} readings`,legend()+all.map(w=>reading(w)).join(''));
    }
    const lead = first[0], delta = difference(lead), rest = first.slice(1);
    return `<div class="pane-hero"><p class="pane-hero-label">Largest difference · Bar ${lead.bar+1} ${label(lead).toLowerCase()}</p><p class="pane-hero-value">${value(lead,lead.set[0])}<span class="pane-unit">${unit(lead)}</span></p><p class="pane-hero-compare">All ${displayed(lead,lead.all[0])}${delta ? ' · <strong>'+delta+'</strong>' : ''}</p>${track(lead)}</div>`+legend()+
      [...new Set(rest.map(w=>groups[w.key]))].map(group=>`<section class="pane-group"><h3>${group}${group === 'Activity' || group === 'Trade size' ? '<span class="pane-unit">vs prior 11 bars</span>' : ''}</h3>${rest.filter(w=>groups[w.key]===group).map(w=>reading(w)).join('')}</section>`).join('')+remaining;
  }
  function meter(w, direction = 'selected', reference = null) {
    if (!w) return '';
    return `<div class="pane-meter ${direction}" role="img" aria-label="${pct(w[0])}; 95% interval ${pct(w[1])} to ${pct(w[2])}${reference === null ? '' : '; all windows '+pct(reference)}"><i class="meter-fill" style="width:${w[0]*100}%"></i><i class="meter-ci" style="left:${w[1]*100}%;width:${(w[2]-w[1])*100}%"></i><i class="meter-dot" style="left:${w[0]*100}%"></i>${reference === null ? '' : `<i class="meter-reference" style="left:${reference*100}%"></i>`}</div>`;
  }
  const interval = w => w ? `<span class="pane-meta">95% interval ${pct(w[1])}–${pct(w[2])}</span>` : '';
  const rate = (label,w,direction='selected',hero=false) => w ? `<div class="prate${hero ? ' pane-hero' : ''}"><div class="pane-rate-head"><span>${label}</span><b>${pct(w[0])}</b></div>${meter(w,direction)}${interval(w)}</div>` : `<p class="pcap">${label}: no estimate.</p>`;
  function next(r, ctx) {
    if (r.filter) return `<p class="pcap">Filtered to next bars that ${esc(ctx.nextWords(r.filter))}. No rise-rate comparison.</p>`;
    const P = r.panes, w = P.next, ref = r.base.n ? r.base.up/r.base.n : null;
    if (!w) return '<p class="pcap">Fewer than 30 next bars: no estimate.</p>';
    const delta = ref === null ? '' : (w[0]-ref)*100, outside = ref !== null && (w[1]>ref || w[2]<ref);
    const tfs = `<table class="pane-timeframes"><thead><tr><th>Timeframe</th><th>Rose</th><th>Windows</th></tr></thead><tbody>${ctx.timeframes.map(({label,k})=>`<tr><td>${label}</td><td>${P.byTf[k] ? pct(P.byTf[k][0]) : '—'}</td><td>${fmt(P.tfN[k])}</td></tr>`).join('')}</tbody></table><p class="pane-note">— Fewer than 30 next bars.</p>`;
    return `<p class="pane-next-value">${pct(w[0])}</p>${ref === null ? '<p class="pane-note">All-window rate unavailable.</p>' : `<p class="pane-hero-compare">All windows ${pct(ref)} · <strong>${delta>0?'+':''}${delta.toFixed(1).replace('-','−')} pp</strong></p>`}${meter(w,'selected',ref)}${interval(w)}${ref === null ? '' : `<p class="pane-note">${outside ? 'Interval excludes the all-window rate.' : 'Interval overlaps the all-window rate.'}</p>`}${detail('timeframes','By timeframe',tfs)}`;
  }
  function right(variant,r) {
    const P=r.panes,c=P.cont;
    if (!c) return `<p class="pcap">Fewer than 30 complete ${P.after}-bar continuations: no estimate.</p>`;
    const breaks = rate("Broke the shape's high",c.aboveHigh,'up',variant === 'signal')+rate("Broke the shape's low",c.belowLow,'down')+'<p class="pane-note">A window can break both levels.</p>';
    const end = `<section class="pane-group"><h3>At bar ${P.after}</h3>${rate('Closed above the last drawn close',c.aboveClose)}</section>`;
    return variant === 'signal' ? breaks+end : `<section class="pane-group"><h3>${variant === 'bars' ? 'During the next '+P.after+' bars' : 'Crossed during those '+P.after+' bars'}</h3>${breaks}${variant === 'ledger' ? '<div class="pane-scale"><span>0% of windows</span><span>100%</span></div>' : ''}</section>`+end;
  }
  function terminal(P) {
    const c=P.cont;
    if (!c) return '';
    const q=c.fan[c.fan.length-1], low=q[1], median=q[2], high=q[3];
    const a=Math.min(0,low),b=Math.max(1,high),pad=(b-a)*.12,mn=a-pad,mx=b+pad,at=x=>(x-mn)/(mx-mn)*100;
    return `<section class="pane-group"><h3>Where bar ${P.after} closed</h3><div class="pane-terminal-value"><span>Median</span><strong>${f2(median)}<span class="pane-unit">shape heights</span></strong></div><div class="trk terminal-track" role="img" aria-label="Median close ${f2(median)} shape heights; middle 50% ${f2(low)} to ${f2(high)}. Shape low 0, high 1."><i class="bd" style="left:${at(low)}%;width:${at(high)-at(low)}%"></i><i class="dt" style="left:${at(median)}%"></i><i class="tk" style="left:${at(0)}%"></i><i class="tk" style="left:${at(1)}%"></i></div><p class="pane-note">Middle 50%: ${f2(low)}–${f2(high)}</p><p class="pane-note">Shape's low = 0 · high = 1</p>${c.sampled < c.n ? `<p class="pane-note">Fan sample: ${fmt(c.sampled)} of ${fmt(c.n)} windows. Rates use all windows.</p>` : ''}</section>`;
  }
  function caption(r,ctx) {
    const P=r.panes,n=P.n,kind=P.kind==='hold'?'windows hold your relations':P.kind==='twins'?'exact matches':'closest windows';
    const exact = (r.filter ? r.exactF : r.exact) || [], total = ctx.timeframes.reduce((n,{k})=>n+(exact[k] || 0),0);
    return `<strong>${fmt(n)} ${kind}</strong><span class="pane-meta">${P.kind==='closest' ? `${fmt(total)} exact matches · ` : ''}BTCUSDT · ${ctx.timeframes.map(t=>t.label).join(' / ') || 'No timeframes'}</span>${P.kind==='closest' ? '<span class="pane-meta">Closest windows stand in below 30 exact matches.</span>' : ''}${r.stretch ? `<span class="pane-meta">Up to ${r.stretch} bars skipped</span>` : ''}${r.filter ? `<span class="pane-meta">Next bar ${esc(ctx.nextWords(r.filter))}</span>` : ''}`;
  }
  const leftMethod = barCount => `<ul class="pane-method"><li>All means every ${barCount}-bar window on the selected timeframes. Rows compare selected-window and all-window means.</li><li>Volume, trades and mean trade size: relative to the median of the prior 11 bars; geometric means.</li><li>Body and range: prior-bar Wilder ATR(14). Maker share: share of volume. Last close: position in the prior UTC day's range.</li><li>Every reading track has its own scale. Differences are ranked in standard deviations of all windows.</li><li>95% intervals: t for means, Wilson for rates. No estimate below 30 windows.</li></ul>`;
  const rightMethod = after => `<ul class="pane-method"><li>Each window is scaled from its own low and high to your drawing. The canvas fan shows the median and middle 50% and 80% of closes.</li><li>Breaks count any crossing during the next ${after} bars. Final close compares bar ${after} with the window's last close.</li><li>The terminal band is the middle 50% of closes, not a confidence interval. Outcome rates use all complete continuations, with Wilson 95% intervals.</li></ul>`;
  return { variants, left, right, next, terminal, caption, leftMethod, rightMethod };
})();
