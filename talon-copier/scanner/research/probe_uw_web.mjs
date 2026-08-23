// probe_uw_web.mjs — scrape unusualwhales.com/terminal JS for the internal endpoint it calls (unauth).
const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36' };
const base = 'https://unusualwhales.com';
const res = await fetch(base + '/terminal', { headers: UA });
console.log('terminal page →', res.status, res.headers.get('content-type'));
const html = await res.text();
console.log('bytes:', html.length);
let scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
scripts = [...new Set(scripts)].map((u) => (u.startsWith('http') ? u : (u.startsWith('/') ? base + u : base + '/' + u)));
console.log('scripts referenced:', scripts.length);
const apis = new Set(), ctx = new Set();
let scanned = 0;
for (const s of scripts.slice(0, 90)) {
  let js = '';
  try { const r = await fetch(s, { headers: UA }); if (!r.ok) continue; js = await r.text(); } catch { continue; }
  scanned++;
  for (const m of js.matchAll(/["'`](\/api\/[A-Za-z0-9_\-\/.{}]+)["'`]/g)) apis.add(m[1]);
  for (const m of js.matchAll(/https?:\/\/[a-z0-9.\-]*unusualwhales\.com\/[A-Za-z0-9_\-\/.]+/g)) apis.add(m[0]);
  if (/terminal/i.test(js)) for (const m of js.matchAll(/.{0,45}terminal.{0,45}/gi)) ctx.add(m[0].replace(/\s+/g, ' ').trim());
}
console.log('scanned', scanned, 'chunks');
console.log('\n=== endpoints/urls mentioning "terminal" ===');
console.log([...apis].filter((a) => /terminal/i.test(a)).sort().map((a) => '  ' + a).join('\n') || '  (none)');
console.log('\n=== all /api/ paths found (sample) ===');
console.log([...apis].filter((a) => a.includes('/api/')).sort().slice(0, 40).map((a) => '  ' + a).join('\n') || '  (none)');
console.log('\n=== "terminal" context snippets ===');
for (const c of [...ctx].slice(0, 20)) console.log('  ', c.slice(0, 90));
