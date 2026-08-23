// terminal_deep.mjs — fetch the Terminal page's own JS chunk to see what endpoints it calls,
// and test whether our API key can hit the AI-chat backend behind it.
import { loadEnvKeysFrom, resolveFromRoot } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const key = process.env.UNUSUAL_WHALES_API_KEY;
const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36' };
const base = 'https://unusualwhales.com';
const candidates = [
  '/_next/static/chunks/pages/terminal-0662ae458d9633eb.js',
  '/_next/static/chunks/terminal-0662ae458d9633eb.js',
];
let js = '';
for (const c of candidates) {
  const r = await fetch(base + c, { headers: UA });
  console.log('chunk', c.split('/').pop(), '→', r.status);
  if (r.ok) { js = await r.text(); break; }
}
console.log('chunk bytes:', js.length);
if (js) {
  const apis = new Set();
  for (const m of js.matchAll(/["'`](\/api\/[A-Za-z0-9_\-\/.{}$]+)["'`]/g)) apis.add(m[1]);
  for (const m of js.matchAll(/https?:\/\/[a-z0-9.\-]*unusualwhales\.com\/[A-Za-z0-9_\-\/.]+/g)) apis.add(m[0]);
  console.log('\n=== endpoints the Terminal chunk references ===');
  console.log([...apis].sort().map((a) => '  ' + a).join('\n') || '  (none)');
  const cmds = [...js.matchAll(/(?:command|cmd|slug|keyword|trigger)["']?\s*:\s*["']([a-z_\-]{2,20})["']/gi)].map((m) => m[1]);
  if (cmds.length) console.log('\npossible command tokens:', [...new Set(cmds)].slice(0, 40).join(' '));
}
console.log('\n=== can our API key hit the AI/chat backend? ===');
for (const e of ['/api/ai/uw_chat/suggested_prompts', '/api/ai/uw_chat/header_badge', '/api/ai/chat', '/api/ai/query', '/api/ai/uw_chat']) {
  try {
    const r = await fetch('https://api.unusualwhales.com' + e, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    const t = await r.text();
    console.log(`  ${e.padEnd(34)} → ${r.status}  ${t.slice(0, 70).replace(/\s+/g, ' ')}`);
  } catch (err) { console.log(`  ${e} → ERR ${err.message}`); }
}
