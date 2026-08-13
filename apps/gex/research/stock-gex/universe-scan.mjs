// universe-scan.mjs — full Skylit universe (~378) bullish GEX/VEX, ISOLATED to ONE expiry (default Aug 21),
// with a BATCHED Sonnet tournament so the STRONG model sees every stock (no weak-filter drop → real recall).
//   Tier 1  SKYLIT  pull each stock, isolate the target expiry's gamma/vanna → structure + mech-score  (free)
//   Tier 2  SONNET  round 1: ~10 batches of 40, each ranked → top 6 → finalists                        ($$)
//   Tier 3  SONNET  round 2: deep-synthesize the finalists → TOP 10 with theses                        ($)
// Single-expiry is the right lens for a "buy this week / sell into <expiry>" swing — the all-expiry
// aggregate blends in LEAPS that don't drive a 1-week move (and can even sign-flip vs the near expiry).
// RUN AFTER CLOSE (idle loop). Paced ~1/sec; aborts on 12 consecutive errors.
//   node research/stock-gex/universe-scan.mjs [2026-08-21] [--limit N]
import '../../scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.ANTHROPIC_API_KEY;
const SONNET = 'claude-sonnet-5';
const EXP = process.argv.find(a => /^\d{4}-\d\d-\d\d$/.test(a)) || '2026-08-21';
const LIM = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? +process.argv[i + 1] : 0; })();
const BAND = 0.20, PACE_MS = 850, BATCH = 40, PER_BATCH_KEEP = 6;

let spend = 0;
async function sonnet(system, user, maxTok = 8000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: SONNET, max_tokens: maxTok, system, messages: [{ role: 'user', content: user }] }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  if (j.usage) spend += (j.usage.input_tokens * 3 + j.usage.output_tokens * 15) / 1e6;
  return (j.content || []).map(c => c.text).filter(Boolean).join('');
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

const uni = JSON.parse(fs.readFileSync(path.join(HERE, '../../scanner/data/symbols.json'), 'utf8')).symbols
  .filter(s => s && s.name && !s.is_index).map(s => s.name);
const tickers = LIM ? uni.slice(0, LIM) : uni;
console.log(`Universe: ${tickers.length} stocks · expiry ${EXP}\n`);

await initAuth();
async function pullExp(ticker) {
  const token = await getFreshToken();
  const url = new URL('https://app.skylit.ai/api/data');
  url.searchParams.set('symbol', ticker); url.searchParams.set('max_strikes', '150'); url.searchParams.set('max_expirations', '12'); url.searchParams.set('nocache', Math.random().toString());
  const r = await fetch(url, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return { error: `HTTP ${r ? r.status : 'fetch'}` };
  const raw = await r.json(); const spot = raw.CurrentSpot; if (spot == null) return { error: 'no spot' };
  const ei = (raw.Expirations || []).indexOf(EXP); if (ei < 0) return { error: `no ${EXP}` };
  const K = raw.Strikes || [], G = raw.GammaValues || [], V = raw.VannaValues || [], nodes = [];
  for (let i = 0; i < K.length; i++) { const k = +K[i]; if (!Number.isFinite(k) || Math.abs(k - spot) / spot > BAND) continue; const g = (+G[i]?.[ei] || 0) / 1e6, v = (+V[i]?.[ei] || 0) / 1e6; if (g || v) nodes.push({ k, g, v }); }
  return { spot, nodes };
}
const pct = (k, spot) => (k - spot) / spot * 100, prox = (d, w) => Math.max(0, 1 - Math.abs(d) / w);
function analyze(spot, nodes) {
  const pos = (arr) => arr.filter(n => n.g > 0).sort((a, b) => b.g - a.g)[0] || null;
  const king = nodes.slice().sort((a, b) => Math.abs(b.g) - Math.abs(a.g))[0] || null;
  const floor = pos(nodes.filter(n => n.k < spot)), ceiling = pos(nodes.filter(n => n.k > spot));
  const bar = nodes.slice().sort((a, b) => a.g - b.g)[0]; const barney = (bar && bar.g < 0) ? bar : null;
  const vmag = nodes.slice().sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0] || null;
  let s = 0;
  if (floor) s += floor.g * prox(pct(floor.k, spot), 8);
  if (ceiling) s -= ceiling.g * prox(pct(ceiling.k, spot), 6) * 1.2;
  if (!ceiling || Math.abs(pct(ceiling.k, spot)) >= 6) s += 4;
  if (vmag) s += (pct(vmag.k, spot) > 0 ? 1 : -1) * Math.min(Math.abs(vmag.v), 200) / 12;
  if (king) s += (king.k < spot ? 1 : -1) * Math.min(Math.abs(king.g), 20) * 0.3;
  if (barney && barney.k > spot) s += Math.min(Math.abs(barney.g), 15) * prox(pct(barney.k, spot), 5) * 0.3;
  const fmt = (n) => n ? `${n.k}(${(n.g >= 0 ? '+' : '') + n.g.toFixed(2)}g/${(n.v >= 0 ? '+' : '') + n.v.toFixed(1)}v, ${pct(n.k, spot).toFixed(1)}%)` : '—';
  return { score: +s.toFixed(2), line: `spot ${spot} · KING ${fmt(king)} · floor ${fmt(floor)} · ceiling ${fmt(ceiling)} · barney ${fmt(barney)} · vanna ${fmt(vmag)}` };
}

// ── TIER 1: bulk pull, isolate expiry, structure every stock ──
const rows = []; let ok = 0, err = 0, ce = 0, noexp = 0;
for (let i = 0; i < tickers.length; i++) {
  const d = await pullExp(tickers[i]);
  if (d.error) { err++; ce++; if (/no 20/.test(d.error)) noexp++; if (ce >= 12) { console.log(`\n⚠ ${ce} consecutive errors — aborting.`); break; } }
  else { ce = 0; ok++; rows.push({ ticker: tickers[i], ...analyze(d.spot, d.nodes) }); }
  if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${tickers.length} (${ok} ok, ${err} err${noexp ? `, ${noexp} no-${EXP}` : ''})`);
  await new Promise(r => setTimeout(r, PACE_MS + Math.random() * 150));
}
rows.sort((a, b) => b.score - a.score);
fs.writeFileSync(path.join(HERE, 'universe-structures.json'), JSON.stringify({ generated: new Date().toISOString(), expiry: EXP, scanned: rows.length, rows }, null, 1));
console.log(`\n${rows.length} stocks structured for ${EXP} (${err} errors). Cached → universe-structures.json`);

if (!KEY || !rows.length) { console.log('(no ANTHROPIC_API_KEY / no rows — mechanical cache only)'); process.exit(0); }

// ── TIER 2: batched Sonnet round 1 — every stock ranked by the strong model ──
const batches = chunk(rows, BATCH);
console.log(`\nRound 1 — Sonnet ranks ${batches.length} batches of ~${BATCH} (every stock seen)…`);
const B_SYS = `You rank stocks by BULLISH GEX/VEX structure for the ${EXP} options expiry (Skylit, that single expiry). BULL = a positive-gamma floor/king just below spot (support) + air pocket above (no big near ceiling wall) + a vanna magnet ABOVE spot (upward pull). A near ceiling wall or a big vanna mass below spot weakens it. Return ONLY the ${PER_BATCH_KEEP} most bullish from this batch as JSON: [{"ticker":"XXX","note":"<=10 words"}]. No prose.`;
let finalists = [];
for (let b = 0; b < batches.length; b++) {
  const u = batches[b].map(r => `${r.ticker}: ${r.line}`).join('\n');
  let picks = [];
  try { const t = await sonnet(B_SYS, `Batch ${b + 1}/${batches.length}:\n${u}`, 6000); picks = JSON.parse(t.match(/\[[\s\S]*\]/)[0]); }
  catch { const T = new Set(batches[b].map(r => r.ticker)); picks = batches[b].slice(0, PER_BATCH_KEEP).map(r => ({ ticker: r.ticker, note: 'mech-fallback' })); }
  finalists.push(...picks.filter(p => p && p.ticker).slice(0, PER_BATCH_KEEP));
  process.stdout.write(`  batch ${b + 1}: ${picks.map(p => p.ticker).slice(0, PER_BATCH_KEEP).join(',')}\n`);
}
const fset = [...new Set(finalists.map(f => f.ticker))];
const finalRows = rows.filter(r => fset.includes(r.ticker));
console.log(`\n${finalRows.length} finalists → Round 2 final synthesis…\n`);

// ── TIER 3: final deep synthesis → TOP 10 ──
const F_SYS = `You are a GEX/VEX swing analyst on the Skylit ${EXP} expiry (single expiry, for a buy-this-week / sell-into-${EXP} trade). Each stock: KING (biggest gamma node), floor (pos-gamma support below spot), ceiling (pos-gamma resistance above), barney (neg-gamma = squeeze fuel), biggest vanna magnet. $M; % = distance from spot.
These are the strongest-structured names from the WHOLE universe. Rank the TOP 10 most bullish. For each: **thesis** (1-2 sent), **GEX**, **VEX**, **conviction** 0-1, **confirm/invalidate** levels. Be selective — a clean floor+air-pocket+vanna-above beats a big-but-capped name. End with "RANKED:" (10 tickers). GEX/VEX is confirmation for a discretionary entry, not a standalone signal.`;
const fu = finalRows.map(r => `${r.ticker}: ${r.line} [mech ${r.score}]`).join('\n');
const synth = await sonnet(F_SYS, `Finalists (${finalRows.length}) for the ${EXP} expiry:\n\n${fu}\n\nRank the TOP 10 bullish.`, 9000);
console.log(synth);
console.log(`\n═══ TOTAL Sonnet spend: $${spend.toFixed(2)} · ${rows.length} stocks scanned for ${EXP} · ${err} errors ═══`);
fs.writeFileSync(path.join(HERE, 'universe-verdicts.json'), JSON.stringify({ generated: new Date().toISOString(), expiry: EXP, scanned: rows.length, cost_usd: +spend.toFixed(2), finalists: fset, ranked_all: rows, synthesis: synth }, null, 1));
console.log('-> universe-verdicts.json');
