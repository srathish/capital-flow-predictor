// talon_bundle_mine.mjs — mine app.skylit.ai JS bundles for the NEW Talon covered-universe endpoints.
import '../../../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../../apps/gex/src/heatseeker/auth.js';
await initAuth();
const token = await getFreshToken();
const H = { Authorization: `Bearer ${token}`, Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Accept: 'application/json' };
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36' };

// raw content of the empty-looking setups endpoint
const r = await fetch('https://app.skylit.ai/api/nexus/agent-setups?limit=8', { headers: H });
console.log('agent-setups body:', (await r.text()).slice(0, 200));

const html = await (await fetch('https://app.skylit.ai/', { headers: UA })).text();
let scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
// also pull Next.js build manifest chunk list if present
const buildId = (html.match(/"buildId":"([^"]+)"/) || [])[1];
scripts = scripts.map((s) => (s.startsWith('http') ? s : 'https://app.skylit.ai' + s));
console.log('buildId:', buildId, '| JS bundles:', scripts.length);

const terms = /covered.?universe|actionable|strict.?watch|supplemental|context.?watch|magnet.?ladder|ceiling.?structure|rally.?then.?fade|area.?of.?interest|optimal.?trade.?entry|invalidation|entry.?efficiency|entry.?uplift|book.?lean|risk.?posture/gi;
const apiPaths = new Set(), termHits = new Set();
let scanned = 0;
for (const s of scripts) {
  try {
    const js = await (await fetch(s, { headers: UA })).text();
    scanned++;
    for (const m of js.matchAll(/["'`](\/api\/[a-zA-Z0-9_\/-]+)["'`]/g)) apiPaths.add(m[1]);
    for (const m of js.matchAll(/["'`](\/[a-z]+\/(?:nexus|talon|agent|universe|coverage)[a-zA-Z0-9_\/-]*)["'`]/gi)) apiPaths.add(m[1]);
    for (const m of js.matchAll(terms)) termHits.add(m[0].toLowerCase().replace(/\s+/g, ' '));
  } catch {}
}
console.log(`scanned ${scanned} bundles`);
console.log('\n=== /api/ or agent/universe paths (filtered) ===');
console.log([...apiPaths].filter((p) => /nexus|talon|univ|cover|setup|scan|agent|aoi|ote/i.test(p)).sort().join('\n') || '(none matched filter)');
console.log('\n=== ALL /api/ paths (first 50) ===');
console.log([...apiPaths].filter((p) => p.startsWith('/api/')).sort().slice(0, 50).join('\n'));
console.log('\n=== new-terminology hits (proves which bundle has the feature) ===');
console.log([...termHits].sort().join(' · ') || '(none)');
