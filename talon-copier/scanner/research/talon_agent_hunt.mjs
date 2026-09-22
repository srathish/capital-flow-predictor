// talon_agent_hunt.mjs — Talon is an LLM agent; find the endpoint that RUNS a scan / streams its output.
import '../../../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../../apps/gex/src/heatseeker/auth.js';
await initAuth();
const token = await getFreshToken();
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36' };

const html = await (await fetch('https://app.skylit.ai/', { headers: UA })).text();
let scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]).map((s) => (s.startsWith('http') ? s : 'https://app.skylit.ai' + s));
// Next.js: also grab the build manifest's chunk list so we cover lazy-loaded Talon page chunks
const buildId = (html.match(/"buildId":"([^"]+)"/) || [])[1];
if (buildId) {
  try {
    const bm = await (await fetch(`https://app.skylit.ai/_next/static/${buildId}/_buildManifest.js`, { headers: UA })).text();
    for (const m of bm.matchAll(/"(static\/chunks\/[^"']+\.js)"/g)) scripts.push('https://app.skylit.ai/_next/' + m[1]);
  } catch {}
}
scripts = [...new Set(scripts)];
console.log('bundles to scan:', scripts.length, '| buildId', buildId);

const apiPaths = new Set();
let talonCtx = [];
for (const s of scripts) {
  try {
    const js = await (await fetch(s, { headers: UA })).text();
    for (const m of js.matchAll(/["'`](\/api\/[a-zA-Z0-9_.\/-]+)["'`]/g)) apiPaths.add(m[1]);
    // capture ~120 chars around any literal "talon" to see how it builds the request
    let i = 0;
    while ((i = js.toLowerCase().indexOf('talon', i)) !== -1 && talonCtx.length < 40) {
      const seg = js.slice(Math.max(0, i - 70), i + 70);
      if (/fetch|post|url|api|stream|scan|chat|run|endpoint|\/v1\/|nexus/i.test(seg)) talonCtx.push(seg.replace(/\s+/g, ' '));
      i += 5;
    }
  } catch {}
}
const interesting = [...apiPaths].filter((p) => /talon|nexus|agent|chat|scan|stream|run|conversation|thread|message|complete|sse|univ|cover|setup/i.test(p)).sort();
console.log('\n=== candidate agent/scan endpoints ===');
console.log(interesting.join('\n') || '(none)');
console.log('\n=== "talon" request-building context (deduped) ===');
console.log([...new Set(talonCtx)].slice(0, 30).join('\n') || '(none)');
