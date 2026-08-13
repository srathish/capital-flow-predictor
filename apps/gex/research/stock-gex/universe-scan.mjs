// universe-scan.mjs — scan the ENTIRE Skylit stock universe (~378) for bullish GEX/VEX.
//   Tier 1  SKYLIT  pull aggregate GEX+VEX for every stock → a mechanical BULLISH score → rank  (free, the real signal)
//   Tier 2  SONNET  deep-synthesize the top ~15 into ranked theses                              (~$0.12)
// The broad filter IS the GEX signal here (not a UW pre-screen), so nothing liquid gets thrown out.
// RUN AFTER THE CLOSE (loop idle) — this is a bulk Skylit pull; it is paced ~1/sec and one-time.
//   node research/stock-gex/universe-scan.mjs [topSonnet=15] [--limit N]
import '../../scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.ANTHROPIC_API_KEY;
const SONNET = 'claude-sonnet-5';
const TOP = +(process.argv.find(a => /^\d+$/.test(a)) || 15);
const LIM = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? +process.argv[i + 1] : 0; })();
const BAND = 0.20, PACE_MS = 900;

// universe = symbols.json .name where !is_index
const uni = JSON.parse(fs.readFileSync(path.join(HERE, '../../scanner/data/symbols.json'), 'utf8')).symbols
  .filter(s => s && s.name && !s.is_index).map(s => s.name);
const tickers = LIM ? uni.slice(0, LIM) : uni;
console.log(`Universe: ${tickers.length} stocks${LIM ? ` (--limit ${LIM})` : ''}\n`);

await initAuth();
async function pullGV(ticker) {
  const token = await getFreshToken();
  const url = new URL('https://app.skylit.ai/api/data');
  url.searchParams.set('symbol', ticker); url.searchParams.set('max_strikes', '150'); url.searchParams.set('max_expirations', '12'); url.searchParams.set('nocache', Math.random().toString());
  const r = await fetch(url, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return { error: `HTTP ${r ? r.status : 'fetch'}` };
  const raw = await r.json(); const spot = raw.CurrentSpot; if (spot == null) return { error: 'no spot' };
  const K = raw.Strikes || [], G = raw.GammaValues || [], V = raw.VannaValues || [], nodes = [];
  for (let i = 0; i < K.length; i++) { const k = +K[i]; if (!Number.isFinite(k) || Math.abs(k - spot) / spot > BAND) continue; const g = (G[i] || []).reduce((a, b) => a + (+b || 0), 0) / 1e6, v = (V[i] || []).reduce((a, b) => a + (+b || 0), 0) / 1e6; if (g || v) nodes.push({ k, g, v }); }
  return { spot, nodes };
}
const pct = (k, spot) => (k - spot) / spot * 100;
const prox = (d, w) => Math.max(0, 1 - Math.abs(d) / w);
function analyze(spot, nodes) {
  const pos = (arr) => arr.filter(n => n.g > 0).sort((a, b) => b.g - a.g)[0] || null;
  const king = nodes.slice().sort((a, b) => Math.abs(b.g) - Math.abs(a.g))[0] || null;
  const floor = pos(nodes.filter(n => n.k < spot)), ceiling = pos(nodes.filter(n => n.k > spot));
  const bar = nodes.slice().sort((a, b) => a.g - b.g)[0]; const barney = (bar && bar.g < 0) ? bar : null;
  const vmag = nodes.slice().sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0] || null;
  // mechanical BULLISH score (broad filter; Sonnet refines the top)
  let s = 0;
  if (floor) s += floor.g * prox(pct(floor.k, spot), 8);                                   // + supportive floor below, close
  if (ceiling) s -= ceiling.g * prox(pct(ceiling.k, spot), 6) * 1.2;                        // − near ceiling cap above
  if (!ceiling || Math.abs(pct(ceiling.k, spot)) >= 6) s += 6;                              // + air pocket above
  if (vmag) s += (pct(vmag.k, spot) > 0 ? 1 : -1) * Math.min(Math.abs(vmag.v), 300) / 20;   // vanna magnet above=pull / below=drag
  if (king) s += (king.k < spot ? 1 : -1) * Math.min(Math.abs(king.g), 30) * 0.3;           // king support below / resistance above
  if (barney && barney.k > spot) s += Math.min(Math.abs(barney.g), 20) * prox(pct(barney.k, spot), 5) * 0.3;   // + squeeze fuel just above
  const fmt = (n) => n ? `${n.k}(${(n.g >= 0 ? '+' : '') + n.g.toFixed(1)}g/${(n.v >= 0 ? '+' : '') + n.v.toFixed(1)}v, ${pct(n.k, spot).toFixed(1)}%)` : '—';
  const line = `spot ${spot} · KING ${fmt(king)} · floor ${fmt(floor)} · ceiling ${fmt(ceiling)} · barney ${fmt(barney)} · vanna ${fmt(vmag)}`;
  return { score: +s.toFixed(1), line };
}

// ── TIER 1: bulk Skylit pull + mechanical bullish rank over the whole universe ──
const rows = []; let ok = 0, err = 0, consecErr = 0;
for (let i = 0; i < tickers.length; i++) {
  const t = tickers[i];
  const d = await pullGV(t);
  if (d.error) { err++; consecErr++; if (consecErr >= 12) { console.log(`\n⚠ ${consecErr} consecutive errors — session likely died, aborting bulk pull.`); break; } }
  else { consecErr = 0; ok++; const a = analyze(d.spot, d.nodes); rows.push({ ticker: t, ...a }); }
  if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${tickers.length} pulled (${ok} ok, ${err} err)`);
  await new Promise(r => setTimeout(r, PACE_MS + Math.random() * 200));
}
rows.sort((a, b) => b.score - a.score);
console.log(`\n=== TOP 30 by mechanical BULLISH GEX+VEX score (of ${rows.length} scanned) ===`);
for (const r of rows.slice(0, 30)) console.log(`  ${String(r.score).padStart(6)}  ${r.ticker.padEnd(6)} ${r.line}`);

// ── TIER 2: Sonnet deep-synthesis on the top TOP ──
if (KEY && rows.length) {
  const top = rows.slice(0, TOP);
  const SYS = `You are a GEX/VEX swing analyst on the Skylit AGGREGATE (all-expiry) surface for multi-day stock trades. Each stock lists: KING (biggest gamma node), floor (positive-gamma support below spot), ceiling (positive-gamma resistance above), barney (negative-gamma = squeeze fuel), and the biggest vanna magnet. Values $M; % = distance from spot.
STRONG BULL = king/floor tight support just below spot + clear air pocket above (no big near ceiling) + a vanna magnet ABOVE spot pulling up (+ barney fuel just above). A near ceiling wall, or a large vanna mass BELOW spot, weakens/kills the bull case. Rank the strongest bullish GEX+VEX setups from those given; be selective and flag the weak/capped/pinned ones. For each TOP pick: **thesis** (1-2 sentences), **GEX**, **VEX**, **conviction** 0-1, **confirm/invalidate**. End with a "RANKED:" line. GEX/VEX is confirmation for a discretionary entry, not a standalone signal.`;
  const usr = top.map(r => `${r.ticker}: ${r.line}  [mech score ${r.score}]`).join('\n');
  console.log(`\n=== Sonnet deep synthesis on the top ${top.length} ===\n`);
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: SONNET, max_tokens: 8000, system: SYS, messages: [{ role: 'user', content: `Live GEX/VEX (top ${top.length} of ${rows.length} scanned by mechanical bull score):\n\n${usr}\n\nRank the strongest BULLISH setups.` }] }) });
  const j = await r.json();
  const txt = (j.content || []).map(c => c.text).filter(Boolean).join('');
  console.log(txt || `(no text — ${JSON.stringify(j.error || j.usage)})`);
  const uc = j.usage ? +((j.usage.input_tokens * 3 + j.usage.output_tokens * 15) / 1e6).toFixed(3) : 0;
  console.log(`\n[Sonnet ~$${uc} · ${rows.length} Skylit pulls · ${err} errors]`);
  fs.writeFileSync(path.join(HERE, 'universe-verdicts.json'), JSON.stringify({ generated: new Date().toISOString(), scanned: rows.length, errors: err, ranked: rows.slice(0, 40), synthesis: txt }, null, 1));
  console.log('-> universe-verdicts.json');
} else { console.log('\n(no ANTHROPIC_API_KEY or no rows — mechanical rank only)'); }
