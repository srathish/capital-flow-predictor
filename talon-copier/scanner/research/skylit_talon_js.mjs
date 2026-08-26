// skylit_talon_js.mjs — scrape app.skylit.ai JS for Talon / report / watchlist endpoints (UNAUTH, no session hit).
const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' };
const base = 'https://app.skylit.ai';
const res = await fetch(base + '/', { headers: UA });
console.log('root:', res.status, res.headers.get('content-type'));
const html = await res.text();
let scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
// Next.js build manifest chunk refs too
for (const m of html.matchAll(/"(\/_next\/static\/[^"]+\.js)"/g)) scripts.push(m[1]);
scripts = [...new Set(scripts)].map((u) => (u.startsWith('http') ? u : base + (u.startsWith('/') ? '' : '/') + u));
console.log('scripts:', scripts.length);
const apis = new Set(), ctx = new Set();
let scanned = 0;
for (const s of scripts.slice(0, 140)) {
  let js = '';
  try { const r = await fetch(s, { headers: UA }); if (!r.ok) continue; js = await r.text(); } catch { continue; }
  scanned++;
  for (const m of js.matchAll(/["'`](\/api\/[A-Za-z0-9_\-\/.{}$:]+)["'`]/g)) apis.add(m[1]);
  for (const m of js.matchAll(/["'`](\/(falcon|talon|nexus|glitch|prophet|midas|peregrine|trinity)[A-Za-z0-9_\-\/.{}$:]*)["'`]/g)) apis.add(m[1]);
  if (/talon|watchlist|agent.scan|agent.report|weekly|commentary/i.test(js)) {
    for (const m of js.matchAll(/.{0,42}(talon|weekly.?watch|agent.scan|agent.report|sector.?watch).{0,42}/gi)) ctx.add(m[0].replace(/\s+/g, ' ').trim());
  }
}
console.log('scanned', scanned, 'chunks\n');
console.log('=== endpoints mentioning talon/nexus/report/watchlist/scan/commentary/weekly ===');
console.log([...apis].filter((a) => /talon|nexus|report|watchlist|scan|agent|commentary|weekly|article/i.test(a)).sort().map((a) => '  ' + a).join('\n') || '  (none)');
console.log('\n=== all /api/ paths (sample 60) ===');
console.log([...apis].filter((a) => a.startsWith('/api/')).sort().slice(0, 60).map((a) => '  ' + a).join('\n'));
console.log('\n=== context snippets ===');
for (const c of [...ctx].slice(0, 25)) console.log('  ', c.slice(0, 95));
