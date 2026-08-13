// deep-scan.mjs — TIERED LLM stock GEX/VEX scan (cheap-broad → expensive-deep)
//   Tier 1  HAIKU   ranks the broad UW candidate pool (candidates.json) → bullish shortlist  · NO Skylit, ~$0.02
//   Tier 2  SKYLIT  pulls aggregate GEX + VEX for the shortlist ONLY (bounded — never the whole 500)
//   Tier 3  SONNET  deep synthesis over the live GEX/VEX structure → ranked bullish theses     · ~$0.10-0.40
// The whole point: LLM-touch the whole universe cheaply, but Skylit only the finalists (respects "never over-poll").
// RUN AFTER THE CLOSE (loop idle) so the Skylit pulls don't clobber the live index session.
//   node research/stock-gex/screen.mjs 60        # first: broad UW pool → candidates.json
//   node research/stock-gex/deep-scan.mjs [15]    # shortlist size (default 15)
import '../../scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('no ANTHROPIC_API_KEY in env'); process.exit(1); }
const HAIKU = 'claude-haiku-4-5-20251001', SONNET = 'claude-sonnet-5';
const N_SHORT = +(process.argv[2] || 15);   // how many the Haiku tier forwards to Skylit
const BAND = 0.20;                           // ±20% strike window for the aggregate node scan

async function claude(model, system, user, maxTok = 2200) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTok, system, messages: [{ role: 'user', content: user }] })
  });
  const j = await r.json();
  if (j.error) throw new Error(`${model}: ${j.error.message || JSON.stringify(j.error)}`);
  return { text: (j.content || []).map(c => c.text).filter(Boolean).join(''), usage: j.usage };
}
const cost = (u, inP, outP) => u ? +((u.input_tokens * inP + u.output_tokens * outP) / 1e6).toFixed(4) : 0;

// ── load the broad UW candidate pool (screen.mjs output) ──────────────────────
const cf = path.join(HERE, 'candidates.json');
if (!fs.existsSync(cf)) { console.error('run screen.mjs first: node research/stock-gex/screen.mjs 60'); process.exit(1); }
const pool = JSON.parse(fs.readFileSync(cf, 'utf8')).candidates;

// ── TIER 1: HAIKU ranks the pool for bullish swing setups on UW factors alone ──
const poolLines = pool.map(c => {
  const s = c.signals || {};
  return `${c.ticker} (${c.sector}) bias=${c.bias} score=${c.score} 52wPos=${s.range_pos_52w} netCallPrem=$${Math.round((s.net_call_premium || 0) / 1e6)}M callDayVsAvg=${s.call_day_vs_avg} impMove=${s.implied_move_pct}% ivRank=${Math.round(s.iv_rank || 0)} gexHint=${s.uw_gex_regime_hint} earnings=${s.next_earnings || '?'}`;
}).join('\n');
const HAIKU_SYS = `You are a fast options swing screener. From a universe of large-cap candidates with Unusual Whales options factors, pick the ones with the most promising BULLISH multi-day swing setup. Favor: bullish bias, a 52-week range position with room left (not already at the top), positive/large net call premium, elevated call activity vs average, a healthy implied move (enough to swing, not a lottery ticket), and a supportive UW gamma-regime hint. Down-weight names with earnings in the next few days (event risk). Return ONLY a JSON array of the top ${N_SHORT} tickers ranked best-bullish first: [{"ticker":"XXX","why":"<=8 words"}]. No prose, no markdown.`;
console.log(`\nTier 1 — Haiku ranking ${pool.length} UW candidates (no Skylit)…`);
const t1 = await claude(HAIKU, HAIKU_SYS, `Universe:\n${poolLines}\n\nReturn the top ${N_SHORT} bullish tickers as JSON.`, 1200);
let shortlist;
try { const m = t1.text.match(/\[[\s\S]*\]/); shortlist = JSON.parse(m[0]); }
catch { const T = new Set(pool.map(c => c.ticker)); shortlist = [...t1.text.matchAll(/[A-Z]{2,5}/g)].map(x => x[0]).filter(t => T.has(t)).slice(0, N_SHORT).map(ticker => ({ ticker, why: '' })); }
shortlist = shortlist.filter(x => x && x.ticker).slice(0, N_SHORT);
console.log(`  → shortlist (${shortlist.length}): ${shortlist.map(x => x.ticker).join(', ')}   [Haiku ~$${cost(t1.usage, 1, 5)}]`);

// ── TIER 2: SKYLIT aggregate GEX + VEX for the shortlist ONLY ─────────────────
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
const pctOf = (k, spot) => ((k - spot) / spot * 100);
function structure(spot, nodes) {
  const pos = (arr) => arr.filter(n => n.g > 0).sort((a, b) => b.g - a.g)[0] || null;
  const king = nodes.slice().sort((a, b) => Math.abs(b.g) - Math.abs(a.g))[0] || null;
  const floor = pos(nodes.filter(n => n.k < spot)), ceiling = pos(nodes.filter(n => n.k > spot));
  const bar = nodes.slice().sort((a, b) => a.g - b.g)[0]; const barney = (bar && bar.g < 0) ? bar : null;
  const vmag = nodes.slice().sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0] || null;
  const fmt = (n) => n ? `${n.k}(${(n.g >= 0 ? '+' : '') + n.g.toFixed(1)}g/${(n.v >= 0 ? '+' : '') + n.v.toFixed(1)}v M, ${pctOf(n.k, spot).toFixed(1)}%)` : '—';
  return `spot ${spot} · KING ${fmt(king)} · floor ${fmt(floor)} · ceiling ${fmt(ceiling)} · barney ${fmt(barney)} · vanna-magnet ${fmt(vmag)}`;
}
console.log(`\nTier 2 — Skylit GEX+VEX on the ${shortlist.length} finalists…`);
const rows = [];
for (const s of shortlist) {
  const d = await pullGV(s.ticker);
  if (d.error) { console.log(`  ${s.ticker}: ${d.error}`); continue; }
  const line = structure(d.spot, d.nodes);
  const c = pool.find(p => p.ticker === s.ticker); const sig = c?.signals || {};
  rows.push({ ticker: s.ticker, structure: line, uw: `bias=${c?.bias} netCallPrem=$${Math.round((sig.net_call_premium || 0) / 1e6)}M 52wPos=${sig.range_pos_52w} impMove=${sig.implied_move_pct}% earnings=${sig.next_earnings || '?'}` });
  console.log(`  ${s.ticker.padEnd(6)} ${line}`);
  await new Promise(r => setTimeout(r, 800));   // app-cadence pacing
}

// ── TIER 3: SONNET deep synthesis over the live GEX/VEX structure ─────────────
const SONNET_SYS = `You are a GEX/VEX swing analyst working the Skylit AGGREGATE (all-expiry) surface for multi-day stock trades. For each stock you get its live structure: KING (biggest gamma node), floor (positive-gamma support below spot), ceiling (positive-gamma resistance above spot), barney (negative-gamma = squeeze/acceleration fuel), and the biggest vanna magnet (v). Values are $M; % is distance from spot.
A STRONG BULLISH setup = a king/floor giving tight support just below spot + a clear air pocket above (no big ceiling wall close overhead) + a vanna magnet ABOVE spot pulling price up (and ideally barney fuel just above). A near ceiling wall overhead, or a huge vanna mass below spot, weakens or kills the bull case. Earnings within days = event risk.
Rank the strongest bullish GEX+VEX setups from those provided. Be selective and honest — name the weak/capped ones too. For each of your TOP picks give: **thesis** (1-2 sentences), **GEX** read, **VEX** read, **conviction** 0-1, and **confirm/invalidate** levels. Finish with a single "RANKED:" line, best first. GEX/VEX is confirmation for a discretionary entry, not a standalone signal — say so if nothing is clean.`;
const sonUser = rows.map(r => `${r.ticker}: ${r.structure}\n   UW: ${r.uw}`).join('\n\n');
console.log(`\nTier 3 — Sonnet deep synthesis on ${rows.length} names…\n`);
const t3 = await claude(SONNET, SONNET_SYS, `Live GEX/VEX structures:\n\n${sonUser}\n\nRank the strongest BULLISH GEX+VEX setups.`, 8000);   // Sonnet-5 adaptive-thinking is ON here (no tool_choice), so budget must cover thinking + the written answer
console.log(t3.text);
console.log(`\n[Sonnet ~$${cost(t3.usage, 3, 15)} · total LLM ~$${(cost(t1.usage, 1, 5) + cost(t3.usage, 3, 15)).toFixed(3)} · ${rows.length} Skylit pulls]`);

fs.writeFileSync(path.join(HERE, 'deep-verdicts.json'), JSON.stringify({ generated: new Date().toISOString(), shortlist, structures: rows, synthesis: t3.text }, null, 1));
console.log('-> deep-verdicts.json');
