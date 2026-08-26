// universe-scan.mjs — full Skylit universe (~378) bullish GEX/VEX, ISOLATED to ONE expiry (default Aug 21),
// with a BATCHED Sonnet tournament so the STRONG model sees every stock (real recall) AND judges on the
// SAME single-name doctrine deep-analysis uses (squeeze-primary, event-aware vanna, validity flags).
//   Tier 1  SKYLIT  pull each stock via GexProvider, isolate the target expiry → structure + mech-triage  (free)
//           + enrich with UW earnings/IV-rank (FlowProvider) so the tournament sees validity              (cheap)
//   Tier 2  SONNET  round 1: ROUND-ROBIN batches (each spans the score distribution) → up to 6 each        ($$)
//   Tier 3  SONNET  round 2: deep-synthesize the finalists → TOP 10 with theses                           ($)
// Single-expiry is the right lens for a "buy this week / sell into <expiry>" swing — the all-expiry
// aggregate blends in LEAPS that don't drive a 1-week move (and can even sign-flip vs the near expiry).
// PROVIDER CONTRACT: structure ONLY via GexProvider (Skylit); state ONLY via FlowProvider (UW). No raw API here.
// RUN AFTER CLOSE (idle loop). Paced ~1/sec; aborts on 12 consecutive errors.
//   node research/stock-gex/universe-scan.mjs [2026-08-21] [--limit N]
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GexProvider } from '../../../../talon-copier/scanner/providers/gex-skylit.mjs';
import { FlowProvider } from '../../../../talon-copier/scanner/providers/flow-uw.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.ANTHROPIC_API_KEY;
const SONNET = 'claude-sonnet-5';
const EXP = process.argv.find(a => /^\d{4}-\d\d-\d\d$/.test(a)) || '2026-08-21';
const LIM = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? +process.argv[i + 1] : 0; })();
const BAND = 0.20, PACE_MS = 850, BATCH = 40, PER_BATCH_KEEP = 6, ENRICH = 400; // ENRICH caps the UW validity pass

let spend = 0;
async function sonnet(system, user, maxTok = 8000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: SONNET, max_tokens: maxTok, system, messages: [{ role: 'user', content: user }] }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  if (j.usage) spend += (j.usage.input_tokens * 3 + j.usage.output_tokens * 15) / 1e6;
  return (j.content || []).map(c => c.text).filter(Boolean).join('');
}

// ── Tournament prompts (hoisted so --resynth can reuse F_SYS without re-running Tiers 1-2) ──
const B_SYS = `You rank INDIVIDUAL STOCKS by BULLISH GEX/VEX structure for the ${EXP} options expiry (Skylit, that single expiry). On single names the hierarchy is NOT the index one — weigh it like this:
1) SQUEEZE (PRIMARY): a "barney" = NEGATIVE gamma ABOVE spot means dealers must CHASE price up if it breaks — the most potent single-name move. Neg-gamma overhead near spot is strongly bullish (dry tinder — on the desk you'd confirm with ask-side flow, but rank it top-tier here).
2) VANNA magnet above spot (EVENT-AWARE): a positive vanna node above = melt-up pull, but only real if IV has room to compress — DISCOUNT it when the line shows a low IV rank (IVr<25 / ⤓lowvol).
3) PINNING (SECONDARY on stocks): a positive-gamma floor/king just below spot = support, + an air pocket above (no big near ceiling). Trust this LESS than on an index. A near ceiling wall or a big vanna mass below spot weakens the bull.
VALIDITY FLAGS on each line: ⚠PRE-ERN(Nd) → the map vaporizes at the print, discount heavily / demote. IVr low → the vanna magnet is dead weight. ⚠conc → the king may be ONE institutional block/collar, not a durable dealer wall.
Return ONLY the genuinely bullish names from this batch — UP TO ${PER_BATCH_KEEP}, and FEWER (even zero) if fewer qualify — as JSON: [{"ticker":"XXX","note":"<=10 words"}]. No prose.`;
const F_SYS = `You are a single-name GEX/VEX swing analyst on the Skylit ${EXP} expiry (one expiry, for a buy-this-week / sell-into-${EXP} trade). Each line: KING (biggest gamma node), floor (pos-gamma support below), ceiling (pos-gamma resistance above), barney (NEG-gamma above = squeeze fuel), biggest vanna magnet, then validity flags. $M; % = distance from spot.
Rank the TOP 10 most bullish using the SINGLE-NAME hierarchy: (1) SQUEEZE first — neg-gamma overhead is the biggest mover; (2) VANNA magnet above, but only if IV has room to compress (discount low-IVr names); (3) PINNING floor+air-pocket is secondary support, trust it less than on an index. Apply the validity flags: ⚠PRE-ERN = map expires at the print (demote unless the thesis IS the event); ⚠conc = the king may be one block/collar, not a wall. Be selective — a live squeeze or a clean floor+air-pocket+compressible-vanna beats a big-but-capped or pre-earnings name.
For each: **thesis** (1-2 sent), **GEX**, **VEX**, **conviction** 0-1, **confirm/invalidate** levels. End with "RANKED:" (10 tickers). GEX/VEX is confirmation for a discretionary entry, not a standalone signal.`;
const finalLine = (r) => `${r.ticker}: ${r.line}${r.flags ? ' · ' + r.flags : ''}`;

// --resynth: re-run ONLY Tier-3 from the cached verdicts (salvage a max_tokens-truncated synthesis; no Skylit/UW).
if (process.argv.includes('--resynth')) {
  const P = path.join(HERE, 'universe-verdicts.json');
  const V = JSON.parse(fs.readFileSync(P, 'utf8'));
  const finalRows = V.ranked_all.filter(r => V.finalists.includes(r.ticker));
  console.log(`Re-synthesizing Tier-3 from cache: ${finalRows.length} finalists for ${V.expiry}…\n`);
  const synth = await sonnet(F_SYS, `Finalists (${finalRows.length}) for the ${V.expiry} expiry (order = triage rank, provenance only — NOT a return signal):\n\n${finalRows.map(finalLine).join('\n')}\n\nRank the TOP 10 bullish.`, 32000);
  console.log(synth);
  V.synthesis = synth; V.resynth_at = new Date().toISOString(); V.cost_usd = +((V.cost_usd || 0) + spend).toFixed(2);
  fs.writeFileSync(P, JSON.stringify(V, null, 1));
  console.log(`\n(resynth spend $${spend.toFixed(2)}) -> universe-verdicts.json`);
  process.exit(0);
}

const uni = JSON.parse(fs.readFileSync(path.join(HERE, '../../scanner/data/symbols.json'), 'utf8')).symbols
  .filter(s => s && s.name && !s.is_index).map(s => s.name);
const tickers = LIM ? uni.slice(0, LIM) : uni;
console.log(`Universe: ${tickers.length} stocks · expiry ${EXP}\n`);

const gex = new GexProvider({ maxStrikes: 150, maxExpirations: 14 });
try { await gex.init(); } catch (e) { console.log('AUTH-FAIL (reauth the main Skylit session):', e.message); process.exit(2); }
const flow = new FlowProvider();

// Isolate the target expiry from the provider's per-expiry decomposition (values → $M, ±BAND of spot).
// Uses GexProvider._normalize under the hood — one source of truth for the Skylit schema.
async function pullExp(ticker) {
  const profile = await gex.getProfile(ticker); // throws 'AUTH' on 401/403 → caught by the loop
  if (!profile) return { error: 'no data' };
  const spot = profile.spot;
  if (!(profile.expirations || []).includes(EXP)) return { error: `no ${EXP}` };
  const nodes = [];
  for (const s of profile.strikes) {
    const k = s.strike;
    if (!Number.isFinite(k) || Math.abs(k - spot) / spot > BAND) continue;
    const g = (s.perExpiry?.[EXP] || 0) / 1e6, v = (s.perExpiryVanna?.[EXP] || 0) / 1e6;
    if (g || v) nodes.push({ k, g, v });
  }
  return { spot, nodes };
}
const pct = (k, spot) => (k - spot) / spot * 100, prox = (d, w) => Math.max(0, 1 - Math.abs(d) / w);
function analyze(spot, nodes) {
  const pos = (arr) => arr.filter(n => n.g > 0).sort((a, b) => b.g - a.g)[0] || null;
  const king = nodes.slice().sort((a, b) => Math.abs(b.g) - Math.abs(a.g))[0] || null;
  const floor = pos(nodes.filter(n => n.k < spot)), ceiling = pos(nodes.filter(n => n.k > spot));
  const bar = nodes.slice().sort((a, b) => a.g - b.g)[0]; const barney = (bar && bar.g < 0) ? bar : null;
  const vmag = nodes.slice().sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0] || null;
  const totAbs = nodes.reduce((a, n) => a + Math.abs(n.g), 0) || 1;
  const conc = Math.round(Math.max(0, ...nodes.map(n => Math.abs(n.g))) / totAbs * 100); // biggest node % of |gamma|
  // ── NET-GEX REGIME (priority-1 layer, per the desk read): sum of near-spot gamma. POSITIVE = dealers LONG
  //    gamma → mean-reversion, SUPPRESSES breakouts (dealers sell rips/buy dips); NEGATIVE = dealers SHORT
  //    gamma → AMPLIFIES moves (trend/acceleration in whichever way price is already going). Sets the context
  //    BEFORE the node read, exactly like reading the heatmap top-down.
  const netGex = nodes.reduce((a, n) => a + n.g, 0);
  const regime = Math.max(-1, Math.min(1, netGex / totAbs)); // −1 (fully short-γ / amplify) … +1 (fully long-γ / suppress)
  const regimeTag = regime > 0.15 ? 'suppress' : regime < -0.15 ? 'amplify' : 'neutral';
  // ── PIN: spot magnetized to a DOMINANT +γ king (Talon's "Pika") within ~1 gate of spot = a MEAN-REVERSION
  //    magnet, NOT a launchpad. Talon defers to the chart here ("$11 is the magnet, not a breakout"); we must
  //    not let a positive-gamma pin masquerade as a bullish squeeze via the floor/king support terms.
  const kingPct = king ? pct(king.k, spot) : 999;
  const pinned = !!(king && king.g > 0 && Math.abs(kingPct) <= 2.5 && conc >= 30);
  // MECH SCORE = cheap TRIAGE only (surfacing rank for the tournament — NOT a return predictor). Single-name
  // lean: SQUEEZE (barney above spot) primary; PINNING (floor) secondary AND CAPPED so a mega-gamma ETF floor
  // (e.g. TLT +153g) can't run away with the raw score — it's node QUALITY we want, not raw size.
  let s = 0;
  if (floor) s += Math.min(Math.abs(floor.g), 20) * prox(pct(floor.k, spot), 8) * 0.6;       // pinning: secondary (CAPPED)
  if (ceiling) s -= Math.min(Math.abs(ceiling.g), 20) * prox(pct(ceiling.k, spot), 6) * 1.2;  // near ceiling wall caps (CAPPED)
  if (!ceiling || Math.abs(pct(ceiling.k, spot)) >= 6) s += 4;                               // air pocket above
  if (vmag) s += (pct(vmag.k, spot) > 0 ? 1 : -1) * Math.min(Math.abs(vmag.v), 200) / 12;    // vanna magnet above
  if (king) s += (king.k < spot ? 1 : -1) * Math.min(Math.abs(king.g), 20) * 0.3;
  if (barney && barney.k > spot) s += Math.min(Math.abs(barney.g), 15) * prox(pct(barney.k, spot), 6) * 1.0; // SQUEEZE: primary
  // ── REGIME MULTIPLIER: an AMPLIFY regime (net −GEX) fuels a bullish breakout (up to ×1.5); a SUPPRESS regime
  //    (net +GEX, dealers cap rips) dampens it (down to ×0.5). Scale only the bullish (positive) score so a
  //    weak/negative setup isn't "rescued" by suppression.
  if (s > 0) s *= (1 - 0.5 * regime);
  // ── PIN DISCOUNT: spot sitting on the +γ king = mean-reversion magnet, not a breakout → demote hard (defer-to-chart).
  if (pinned && s > 0) s *= 0.35;
  const fmt = (n) => n ? `${n.k}(${(n.g >= 0 ? '+' : '') + n.g.toFixed(2)}g/${(n.v >= 0 ? '+' : '') + n.v.toFixed(1)}v, ${pct(n.k, spot).toFixed(1)}%)` : '—';
  return { score: +s.toFixed(2), conc, regime: +regime.toFixed(2), pinned, line: `spot ${spot} · net-GEX ${regime >= 0 ? '+' : ''}${regime.toFixed(2)}(${regimeTag})${pinned ? ' ⚑PIN(mean-revert)' : ''} · KING ${fmt(king)} · floor ${fmt(floor)} · ceiling ${fmt(ceiling)} · barney↑squeeze ${fmt(barney)} · vanna ${fmt(vmag)}` };
}

// ── TIER 1: pull, isolate expiry, structure every stock ──
const rows = []; let ok = 0, err = 0, ce = 0, noexp = 0;
for (let i = 0; i < tickers.length; i++) {
  let d;
  try { d = await pullExp(tickers[i]); }
  catch (e) { if (e.message === 'AUTH') { console.log('\n⚠ Skylit AUTH — reauth the main session and re-run.'); break; } d = { error: e.message }; }
  if (d.error) { err++; ce++; if (d.error === `no ${EXP}`) noexp++; if (ce >= 12) { console.log(`\n⚠ ${ce} consecutive errors — aborting.`); break; } }
  else { ce = 0; ok++; rows.push({ ticker: tickers[i], ...analyze(d.spot, d.nodes) }); }
  if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${tickers.length} (${ok} ok, ${err} err${noexp ? `, ${noexp} no-${EXP}` : ''})`);
  await new Promise(r => setTimeout(r, PACE_MS + Math.random() * 150));
}
rows.sort((a, b) => b.score - a.score);

// ── ENRICH with UW validity raw material (earnings proximity / IV rank) so the tournament judges on the
//    SAME doctrine as deep-analysis: pre-earnings maps vaporize at the print, a vanna magnet is dead
//    weight at low IV rank. The ⚠conc flag is free (Tier-1) → applies to all. Bounded to ENRICH by cost. ──
const today = new Date().toISOString().slice(0, 10);
if (flow.available) console.log(`\nEnriching ${Math.min(ENRICH, rows.length)} names with UW earnings/IV-rank…`);
else console.log('\n(no UW key — validity flags limited to concentration)');
for (let i = 0; i < rows.length; i++) {
  const r = rows[i], f = [];
  if (i < ENRICH && flow.available) {
    const st = await flow.getStockState(r.ticker, today).catch(() => ({}));
    const ernDte = st.next_earnings ? Math.round((Date.parse(st.next_earnings) - Date.now()) / 864e5) : null;
    if (ernDte != null && ernDte <= 6) f.push(`⚠PRE-ERN(${ernDte}d)`); else if (ernDte != null) f.push(`ern${ernDte}d`);
    if (st.iv_rank != null) f.push(`IVr${Math.round(st.iv_rank)}${st.iv_rank < 25 ? '⤓lowvol' : ''}`);
    await new Promise(res => setTimeout(res, 110));
    if ((i + 1) % 40 === 0) console.log(`  enrich …${i + 1}/${Math.min(ENRICH, rows.length)}`);
  }
  if (r.conc >= 45) f.push(`⚠conc${r.conc}%`);
  if (r.pinned) f.push('⚑pin');
  r.flags = f.join(' ');
}

fs.writeFileSync(path.join(HERE, 'universe-structures.json'), JSON.stringify({ generated: new Date().toISOString(), expiry: EXP, scanned: rows.length, rows }, null, 1));
console.log(`\n${rows.length} stocks structured for ${EXP} (${err} errors). Cached → universe-structures.json`);
if (!KEY || !rows.length) { console.log('(no ANTHROPIC_API_KEY / no rows — mechanical cache only)'); process.exit(0); }

// ── TIER 2: ROUND-ROBIN batches — each batch spans the FULL score distribution, so no stratum is starved.
// Interleave the score-sorted rows (batch[i % NB]); else batch 1 = 40 strongest but advances only
// PER_BATCH_KEEP, dropping ~34 of the best while the weakest batch promotes its top 6. ──
const NB = Math.max(1, Math.ceil(rows.length / BATCH));
const batches = Array.from({ length: NB }, () => []);
rows.forEach((r, i) => batches[i % NB].push(r));
console.log(`\nRound 1 — Sonnet ranks ${NB} round-robin batches of ~${Math.ceil(rows.length / NB)} (every stock seen, each batch a cross-section)…`);
let finalists = [];
for (let b = 0; b < batches.length; b++) {
  const u = batches[b].map(finalLine).join('\n');
  let picks = [];
  try { const t = await sonnet(B_SYS, `Batch ${b + 1}/${batches.length}:\n${u}`, 6000); picks = JSON.parse(t.match(/\[[\s\S]*\]/)[0]); }
  catch { picks = batches[b].slice(0, PER_BATCH_KEEP).map(r => ({ ticker: r.ticker, note: 'mech-fallback' })); }
  finalists.push(...picks.filter(p => p && p.ticker).slice(0, PER_BATCH_KEEP));
  process.stdout.write(`  batch ${b + 1}: ${picks.map(p => p.ticker).slice(0, PER_BATCH_KEEP).join(',') || '(none)'}\n`);
}
const fset = [...new Set(finalists.map(f => f.ticker))];
const finalRows = rows.filter(r => fset.includes(r.ticker));
console.log(`\n${finalRows.length} finalists → Round 2 final synthesis…\n`);

// ── TIER 3: final deep synthesis → TOP 10 (16k budget — Sonnet-5 thinking + 10 theses overran 9k) ──
try {
  const fu = finalRows.map(finalLine).join('\n');
  const synth = await sonnet(F_SYS, `Finalists (${finalRows.length}) for the ${EXP} expiry (order = triage rank, provenance only — NOT a return signal):\n\n${fu}\n\nRank the TOP 10 bullish.`, 32000);
  console.log(synth);
  console.log(`\n═══ TOTAL Sonnet spend: $${spend.toFixed(2)} · ${rows.length} stocks scanned for ${EXP} · ${err} errors ═══`);
  fs.writeFileSync(path.join(HERE, 'universe-verdicts.json'), JSON.stringify({ generated: new Date().toISOString(), expiry: EXP, scanned: rows.length, cost_usd: +spend.toFixed(2), finalists: fset, ranked_all: rows, synthesis: synth }, null, 1));
  console.log('-> universe-verdicts.json');
} catch (e) {
  console.log(`\n⚠ Sonnet synthesis skipped (${(e.message || '').slice(0, 70)}).`);
  console.log('   Mech-ranked structures (with net-GEX regime) are cached in universe-structures.json — rank the top-N from there, no API needed.');
  process.exit(0);
}
