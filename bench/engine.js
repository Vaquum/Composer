// The worker (matcher.js) receives the bars, then the activity for the readings.
// It answers only its latest query, so queries run one at a time here. `clear()` drops unsent queries.

async function loadPayload(path) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(path);
    if (response.status === 503 && attempt < 180) { await new Promise((resolve) => setTimeout(resolve, 1000)); continue; }
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    return response.arrayBuffer();
  }
}

export function createEngine({ onState }) {
  const state = { ready: false, readings: 'loading', failed: '', bars: 0, from: 0, to: 0, note: '' };
  const waiting = []; let flight = null; let id = 0; let worker = null; const named = new Map();
  const tell = () => onState({ ...state });
  const pump = () => {
    if (flight || !waiting.length || !state.ready || state.failed) return;
    flight = waiting.shift(); flight.id = ++id;
    worker.postMessage({ type: 'query', id: flight.id, q: flight.q });
  };
  function start() {
    // The bench is still being set up while this runs, and what it does on a change of state reads the engine it
    // has not been handed yet. So a failure here is told once the caller has it; every other change arrives later.
    try { worker = new Worker('/matcher.js'); } catch (err) { state.failed = 'This browser cannot run the matcher in the background.'; queueMicrotask(tell); return; }
    worker.onerror = (e) => { state.failed = `The matcher stopped: ${e.message || 'unknown error'}.`; tell(); };
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { Object.assign(state, { ready: true, bars: m.bars, from: m.from, to: m.to }); tell(); pump(); return; }
      if (m.type === 'error') { state.failed = `The BTCUSDT klines could not be read: ${m.message}`; tell(); return; }
      if (m.type === 'readings') { state.readings = 'ready'; tell(); return; }
      if (m.type === 'readings-error') { state.readings = 'failed'; state.note = m.message; tell(); return; }
      if (m.type === 'named-pattern') { const w = named.get(m.id); if (w) { named.delete(m.id); w(m); } return; }
      if (m.type === 'progress') { if (flight && m.id === flight.id && flight.onProgress) flight.onProgress(m.f); return; }
      if (m.type === 'result' && flight && m.id === flight.id) { const f = flight; flight = null; f.resolve(m); pump(); }
    };
    loadPayload('/bars').then((buffer) => {
      const b = new Uint8Array(buffer);
      if (!(b.length > 5 && String.fromCharCode(b[0], b[1], b[2], b[3], b[4]) === 'CBAR1')) throw new Error('the server sent something other than bars');
      worker.postMessage({ type: 'bars', buffer }, [buffer]);
      loadPayload('/activity').then((a) => worker.postMessage({ type: 'activity', buffer: a }, [a]))
        .catch((err) => { state.readings = 'failed'; state.note = err.message; tell(); });
    }).catch((err) => { state.failed = `The BTCUSDT klines could not be loaded (${err.message}).`; tell(); });
  }
  start();
  return {
    state,
    /** Ask the matcher. Resolves with its result, or with null when the question was dropped before it was sent. */
    query(q, { onProgress = null, group = '', first = false } = {}) {
      return new Promise((resolve) => {
        const item = { q, resolve, onProgress, group };
        // `first` is the drawing's own question: it replaces whatever is in flight, as the worker itself would.
        if (first && flight && state.ready) { flight.resolve(null); flight = null; waiting.unshift(item); } else if (first) waiting.unshift(item); else waiting.push(item);
        pump();
      });
    },
    /** Drop every question not yet sent (all of them, or one group's). The one in flight still answers. */
    clear(group) { for (let i = waiting.length - 1; i >= 0; i--) if (!group || waiting[i].group === group) waiting.splice(i, 1)[0].resolve(null); },
    busy: () => !!flight || waiting.length > 0,
    /** Count a catalogue pattern on one timeframe, with its most recent examples. */
    named(pattern, timeframe) {
      return new Promise((resolve) => {
        if (!state.ready) { resolve({ error: 'The history is still loading.' }); return; }
        const n = ++id; named.set(n, resolve);
        worker.postMessage({ type: 'named-pattern', id: n, pattern, timeframe, catalogURL: new URL('/patterns.js', location.href).href });
      });
    },
  };
}
