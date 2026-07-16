// ── GEX entry verifier ───────────────────────────────────────────────────
// Given stocks we already LIKE (from screen.mjs, or a manual watchlist), pull
// their CURRENT Skylit aggregate GEX (all-expiration = swing view) and decide
// whether the node structure SUPPORTS getting in RIGHT NOW. GEX is the
// confirmation/veto layer, not the idea generator.
//
// The read (king-floor / air-pocket / ceiling-wall — the Giul single-name rules):
//   BULL thesis wants:  a strong pika FLOOR just below spot (support to launch
//     from) + CLEAR HEADROOM above (no big pika ceiling capping the move; a
//     barney above = squeeze fuel). Best case: the KING is that floor (king-floor).
//   BULL thesis vetoed by: a big pika CEILING right overhead (price pins/rejects)
//     or a barney BELOW spot (downside accelerant, no support).
//   BEAR thesis = the mirror.
//
// Usage:
//   node research/stock-gex/verify.mjs                 (verify candidates.json + pinned)
//   node research/stock-gex/verify.mjs HOOD NVDA       (manual list; infer best side)
//   node research/stock-gex/verify.mjs HOOD:bull NVDA:bear   (explicit thesis)
//
// Verdicts are a doctrine-based ADVISORY to inform a discretionary entry, not a
// validated mechanical signal. RESEARCH TOOLING — does not touch live trading code.
import '../../scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BAND = 0.20;
const NEAR = 6;   // % window that counts as "near" spot for support/resistance

// ── resolve the watchlist + thesis per name ─────────────────────────────────
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
let list;   // [{ticker, bias}]
if (args.length) {
  list = args.map(a => { const [t, b] = a.split(':'); return { ticker: t.toUpperCase(), bias: (b || 'auto').toUpperCase() }; });
} else {
  const cf = path.join(HERE, 'candidates.json');
  if (!fs.existsSync(cf)) { console.error('no candidates.json — run screen.mjs first, or pass tickers'); process.exit(1); }
  const cands = JSON.parse(fs.readFileSync(cf, 'utf8')).candidates.map(c => ({ ticker: c.ticker, bias: c.bias }));
  const pf = path.join(HERE, 'pinned.json');
  const pinned = fs.existsSync(pf) ? (JSON.parse(fs.readFileSync(pf, 'utf8')).pinned || []).map(t => ({ ticker: t, bias: 'AUTO' })) : [];
  const seen = new Set(cands.map(c => c.ticker));
  list = [...cands, ...pinned.filter(p => !seen.has(p.ticker))];
}

await initAuth();

async function pullAgg(ticker) {
  const token = await getFreshToken();
  const url = new URL('https://app.skylit.ai/api/data');
  url.searchParams.set('symbol', ticker);
  url.searchParams.set('max_strikes', '150');
  url.searchParams.set('max_expirations', '12');
  url.searchParams.set('nocache', Math.random().toString());
  const r = await fetch(url, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { error: `HTTP ${r.status}` };
  const raw = await r.json();
  const spot = raw.CurrentSpot;
  if (spot == null) return { error: 'no spot' };
  const K = raw.Strikes || [], G = raw.GammaValues || [];
  const nodes = [];
  for (let i = 0; i < K.length; i++) {
    const k = +K[i];
    if (!Number.isFinite(k) || Math.abs(k - spot) / spot > BAND) continue;
    const g = (G[i] || []).reduce((a, b) => a + (+b || 0), 0) / 1e6;   // aggregate gamma, $M
    if (g) nodes.push({ k, g });
  }
  return { spot, nodes };
}

const prox = (distPct) => Math.max(0, 1 - distPct / NEAR);            // 1 at spot → 0 at NEAR%
const strongestOf = (arr) => arr.slice().sort((a, b) => Math.abs(b.g) - Math.abs(a.g))[0] || null;

// Grade a directional thesis against the node structure. Returns 0-100 + reasons.
function grade(spot, nodes, side) {   // side: 'BULL' | 'BEAR'
  const king = strongestOf(nodes);
  const pika = nodes.filter(n => n.g > 0), barney = nodes.filter(n => n.g < 0);
  const below = (arr) => strongestOf(arr.filter(n => n.k < spot));
  const above = (arr) => strongestOf(arr.filter(n => n.k > spot));

  // for BULL: support=pika below, block=pika above, accel=barney above, undercut=barney below
  // for BEAR: mirror (support=pika above, block=pika below, accel=barney below, undercut=barney above)
  const support = side === 'BULL' ? below(pika) : above(pika);
  const block = side === 'BULL' ? above(pika) : below(pika);
  const accel = side === 'BULL' ? above(barney) : below(barney);
  const undercut = side === 'BULL' ? below(barney) : above(barney);
  const kAbs = king ? Math.abs(king.g) : 1;
  const dist = (n) => n ? Math.abs(n.k - spot) / spot * 100 : 99;
  const magRel = (n) => n ? Math.abs(n.g) / kAbs : 0;

  const supScore = support ? prox(dist(support)) * Math.sqrt(magRel(support)) : 0;   // 0-1
  const blockScore = block ? prox(dist(block)) * Math.sqrt(magRel(block)) : 0;        // 0-1 (bad)
  const undercutBad = undercut && support ? (Math.abs(undercut.g) > Math.abs(support.g) && dist(undercut) < dist(support)) : false;
  const kingFloor = king && support && king.k === support.k;                          // king IS the support
  const accelGood = accel ? prox(dist(accel)) * magRel(accel) : 0;                    // barney in front = fuel

  let score = 100 * (0.45 * supScore + 0.35 * (1 - blockScore) + 0.10 * (kingFloor ? 1 : 0) + 0.10 * accelGood);
  if (undercutBad) score *= 0.55;   // accelerant against the thesis, no real support

  // PIN: a dominant pika sitting AT spot holds price there — no directional edge
  // either way. Veto a directional entry (wait for a break), don't confirm one.
  const pinned = king && king.g > 0 && dist(king) < 0.5;

  const reasons = [];
  if (pinned) { score = Math.min(score, 48); reasons.push(`⚠ PINNED at king ${king.k}(${king.g.toFixed(1)}M) — wait for a break`); }
  if (support) reasons.push(`${side === 'BULL' ? 'floor' : 'ceiling'} ${support.k}(${support.g.toFixed(1)}M) ${dist(support).toFixed(1)}% ${side === 'BULL' ? 'below' : 'above'}${kingFloor ? ' =KING' : ''}`);
  else reasons.push(`no ${side === 'BULL' ? 'support below' : 'resistance above'}`);
  if (block && prox(dist(block)) > 0.15) reasons.push(`${side === 'BULL' ? 'ceiling' : 'floor'} ${block.k}(${block.g.toFixed(1)}M) ${dist(block).toFixed(1)}% ${side === 'BULL' ? 'above' : 'below'} = ${blockScore > 0.4 ? 'CAP' : 'minor block'}`);
  else reasons.push('clear headroom');
  if (accelGood > 0.15) reasons.push(`barney ${accel.k}(${accel.g.toFixed(1)}M) = ${side === 'BULL' ? 'squeeze fuel up' : 'air pocket down'}`);
  if (undercutBad) reasons.push(`⚠ barney ${undercut.k}(${undercut.g.toFixed(1)}M) accelerant against you`);
  return { score: Math.round(score), reasons, support, block, king, kingFloor };
}

function verdict(score) { return score >= 62 ? 'ENTER' : score >= 42 ? 'WAIT' : 'AVOID'; }

const out = [];
console.log(`GEX entry check — ${list.length} names (aggregate/swing surface):\n`);
for (const { ticker, bias } of list) {
  try {
    const s = await pullAgg(ticker);
    if (s.error) { console.log(`  ${ticker.padEnd(6)} ERR ${s.error}`); continue; }
    // pick side: explicit bias, else the better-supported direction
    let side = bias === 'BULL' || bias === 'BEAR' ? bias : null;
    let g;
    if (side) g = grade(s.spot, s.nodes, side);
    else { const b = grade(s.spot, s.nodes, 'BULL'), r = grade(s.spot, s.nodes, 'BEAR'); side = b.score >= r.score ? 'BULL' : 'BEAR'; g = side === 'BULL' ? b : r; }
    const v = verdict(g.score);
    out.push({ ticker, side, grade: g.score, verdict: v, spot: s.spot, reasons: g.reasons });
    const tag = v === 'ENTER' ? '✅ ENTER' : v === 'WAIT' ? '🟡 WAIT ' : '⛔ AVOID';
    console.log(`  ${ticker.padEnd(6)} ${side.padEnd(4)} ${tag}  grade ${String(g.score).padStart(3)}  spot ${s.spot}`);
    console.log(`         ${g.reasons.join(' · ')}`);
  } catch (e) { console.log(`  ${ticker.padEnd(6)} EXC ${e.message}`); }
  await new Promise(r => setTimeout(r, 300));
}
out.sort((a, b) => (a.verdict === b.verdict ? b.grade - a.grade : ({ ENTER: 0, WAIT: 1, AVOID: 2 }[a.verdict] - { ENTER: 0, WAIT: 1, AVOID: 2 }[b.verdict])));
fs.writeFileSync(path.join(HERE, 'verdicts.json'), JSON.stringify({ generated: new Date().toISOString(), verdicts: out }, null, 2));
const enter = out.filter(o => o.verdict === 'ENTER');
console.log(`\n${enter.length} ENTER · ${out.filter(o => o.verdict === 'WAIT').length} WAIT · ${out.filter(o => o.verdict === 'AVOID').length} AVOID`);
if (enter.length) console.log('GEX-confirmed entries: ' + enter.map(e => `${e.ticker}(${e.side} ${e.grade})`).join(', '));
console.log('-> verdicts.json  (advisory — informs a discretionary entry, not a validated signal)');
