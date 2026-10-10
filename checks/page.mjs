// The page's own checks: its script parses, and every part the reference's Show buttons point at exists in the page
// (or is drawn by the panes once there are results, like a row of readings).
// Usage: node checks/page.mjs [INDEX_HTML]
import fs from 'node:fs';
const file = process.argv[2] && process.argv[2].endsWith('.html') ? process.argv[2] : 'index.html';
const html = fs.readFileSync(file, 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
new Function(script);
const topics = script.slice(script.indexOf('const REF_TOPICS = ['), script.indexOf('];', script.indexOf('const REF_TOPICS = [')) + 1);
const selectors = [...topics.matchAll(/selector: '([^']+)'/g)].map(m => m[1]);
const drawn = { '#lrows .prow': 'a row of readings, drawn into #lrows' };
const has = sel => {
  if (drawn[sel]) return html.includes('id="lrows"');
  // every class or id the selector names must appear in the markup
  return [...sel.matchAll(/([.#])([\w-]+)/g)].every(([, kind, name]) => (kind === '#' ? html.includes(`id="${name}"`) : new RegExp(`class="[^"]*\\b${name}\\b`).test(html)));
};
const missing = selectors.filter(s => !has(s));
const topicCount = (topics.match(/\{ id: '/g) || []).length;
const shaped = [...topics.matchAll(/purpose: /g)].length === topicCount && [...topics.matchAll(/\bread: /g)].length === topicCount && [...topics.matchAll(/\buse: /g)].length === topicCount;
console.log(`page script parses; ${topicCount} reference topics, each with purpose, read and use: ${shaped}; ${selectors.length} Show targets, ${missing.length ? 'missing: ' + missing.join(', ') : 'all present'}`);
process.exit(missing.length || !shaped || topicCount === 0 ? 1 : 0);
