/**
 * Campaign System morning scan — Skylit universe × UW 20-day accumulation.
 *
 * RESEARCH / REPORT ONLY. No trading, no orders, no writes outside
 * research/campaign/out/. Separate system from the 0DTE index tracker.
 *
 * Funnel (see PLAN.md):
 *   S1  378-ticker UW flow screen (1 call each: options-volume?limit=21)
 *   S2  shortlist → Skylit multi-expiry surface → monthly magnet structure
 *   S3  candidates → magnet-contract OI trend (historic) + ask-side share
 *       (flow-per-strike, sampled days)
 *   S4  quality gate: spread, premium, earnings proximity
 *
 * Output: research/campaign/out/campaign_report_<day>.md + .json
 *
 * Usage:  node research/campaign/scan.js            (~7-8 min paced)
 *         node research/campaign/scan.js --top=10   (report size)
 */
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initAuth } from '../../src/heatseeker/auth.js';
import { fetchSnapshot } from '../../src/heatseeker/client.js';
import { computeSurface } from '../../src/domain/significance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEX = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

// ---------------- paced UW fetch ----------------
let last = 0, backoff = 0;
async function uw(pathq) {
  for (;;) {
    const wait = Math.max(0, last + CFG.pacing_ms - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    let r;
    try {
      r = await fetch(`https://api.unusualwhales.com/api${pathq}`, {
        headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15_000),
      });
    } catch { return null; }
    if (r.status === 429) {
      backoff = backoff ? Math.min(backoff * 2, 120_000) : 15_000;
      console.log(`  UW 429 — backoff ${backoff / 1000}s`);
      await new Promise(rr => setTimeout(rr, backoff));
      continue;
    }
    backoff = 0;
    if (!r.ok) return null;
    try { return await r.json(); } catch { return null; }
  }
}

function loadUniverse() {
  const p = path.join(GEX, 'scanner', 'data', 'symbols.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const syms = j.symbols || j;
  return syms.map(s => (typeof s === 'string' ? s : s.name || s.symbol)).filter(Boolean)
    .filter(s => !['SPXW', 'SPX', 'VIX', 'VIXW'].includes(s));
}

// ---------------- Stage 1: flow screen ----------------
async function stage1(universe) {
  console.log(`S1 flow screen: ${universe.length} tickers (1 UW call each)...`);
  const out = [];
  let done = 0;
  for (const t of universe) {
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${universe.length}`);
    const j = await uw(`/stock/${t}/options-volume?limit=${CFG.stage1.lookback_days + 1}`);
    const rows = j?.data;
    if (!rows?.length) continue;
    // exclude today's partial row for a stable formation window
    const hist = rows.filter(r => r.date !== TODAY).slice(0, CFG.stage1.lookback_days);
    if (hist.length < CFG.stage1.lookback_days - 2) continue;
    const net = hist.map(r => Number(r.net_call_premium) || 0);
    const sum20 = net.reduce((a, b) => a + b, 0);
    const sum7 = net.slice(0, 7).reduce((a, b) => a + b, 0);
    const posDays = net.filter(x => x > 0).length;
    const callPrem = hist.map(r => Number(r.call_premium) || 0).reduce((a, b) => a + b, 0);
    // Soft sanity minimums only; selection is RANK-based (top shortlist_max
    // by flowScore) so the funnel width doesn't depend on hand-tuned absolute
    // dollar cuts that only mega-caps can clear. Absolute doctrine thresholds
    // ($50M-class) get tested properly in the cohort backtest.
    if (sum20 <= 0 || sum7 < CFG.stage1.min_net_call_premium_7d) continue;
    if (posDays < CFG.stage1.min_positive_days) continue;
    out.push({ ticker: t, sum20, sum7, posDays, callPrem,
               persistence: posDays / hist.length,
               meetsDoctrine: sum20 >= CFG.stage1.min_net_call_premium_20d,
               flowScore: (sum20 / 1e6) * (posDays / hist.length) });
  }
  out.sort((a, b) => b.flowScore - a.flowScore);
  const short = out.slice(0, CFG.stage1.shortlist_max);
  console.log(`S1 → ${out.length} pass, shortlist ${short.length}`);
  return short;
}

// ---------------- Stage 2: map structure ----------------
function daysTo(expiry) {
  return Math.round((Date.parse(expiry) - Date.parse(TODAY)) / 86400_000);
}
async function stage2(shortlist) {
  console.log(`S2 map structure: ${shortlist.length} Skylit pulls...`);
  const out = [];
  for (const s of shortlist) {
    let snap;
    // 40 = Skylit's full ceiling — pull the entire chain (monthlies + LEAPS) so
    // the King node is found regardless of expiry, not truncated at ~5 weeks.
    try { snap = await fetchSnapshot(s.ticker, 40); } catch { continue; }
    if (!snap?.spot || !snap.allExpirations?.length) continue;
    const spot = snap.spot;
    let best = null;
    for (const exp of snap.allExpirations) {
      const dte = daysTo(exp.expiration);
      if (dte < CFG.stage2.expiry_min_days || dte > CFG.stage2.expiry_max_days) continue;
      const surf = computeSurface(exp.strikes, spot);
      // magnet = strongest positive-gamma node ABOVE spot in the campaign band
      const magnets = surf.nodes.filter(n =>
        n.sign === 'pika' && n.strike > spot * (1 + CFG.stage2.magnet_min_dist_pct) &&
        n.strike <= spot * (1 + CFG.stage2.magnet_max_dist_pct) &&
        n.relativeSignificance >= CFG.stage2.magnet_min_relsig);
      if (!magnets.length) continue;
      const magnet = magnets.reduce((a, b) => (a.relativeSignificance > b.relativeSignificance ? a : b));
      // gatekeepers between spot and magnet
      const gks = surf.nodes.filter(n =>
        n.strike > spot && n.strike < magnet.strike &&
        n.relativeSignificance >= 0.03 && n.strike !== magnet.strike).length;
      if (gks > CFG.stage2.max_gatekeepers) continue;
      const distPct = (magnet.strike - spot) / spot;
      const king = surf.nodes.find(n => n.isKing);
      const mapScore = magnet.relativeSignificance * 100 * (1 - gks * 0.25) *
        (magnet.strike === king?.strike ? 1.5 : 1);
      const cand = { expiry: exp.expiration, dte, magnetStrike: magnet.strike,
                     magnetGamma: magnet.gamma, magnetRelSig: magnet.relativeSignificance,
                     distPct, gatekeepers: gks, kingIsMagnet: magnet.strike === king?.strike,
                     mapScore };
      if (!best || cand.mapScore > best.mapScore) best = cand;
    }
    if (best) out.push({ ...s, spot, ...best });
  }
  out.sort((a, b) => b.flowScore * b.mapScore - a.flowScore * a.mapScore);
  const cands = out.slice(0, CFG.stage2.candidates_max);
  console.log(`S2 → ${cands.length} candidates with monthly magnets`);
  return cands;
}

// ---------------- Stage 3: strike-level confirmation ----------------
function occSymbol(t, expiry, K) {
  const [y, m, d] = expiry.split('-');
  return `${t}${y.slice(2)}${m}${d}C${Math.round(K * 1000).toString().padStart(8, '0')}`;
}
function bdaysAgo(n) {
  const d = new Date(`${TODAY}T12:00:00Z`);
  let left = n;
  while (left > 0) { d.setUTCDate(d.getUTCDate() - 1); if (![0, 6].includes(d.getUTCDay())) left--; }
  return d.toISOString().slice(0, 10);
}
async function stage3(cands) {
  console.log(`S3 accumulation confirmation: ${cands.length} candidates...`);
  const out = [];
  for (const c of cands) {
    const occ = occSymbol(c.ticker, c.expiry, c.magnetStrike);
    // 3a: contract OI/volume trend over the formation window (one call)
    const h = await uw(`/option-contract/${occ}/historic?limit=25`);
    const rows = (h?.chains || h?.data || []).filter(r => r.date !== TODAY);
    let oiNow = null, oiThen = null, vol20 = 0;
    if (rows.length >= 5) {
      rows.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
      oiNow = Number(rows[0]?.open_interest) || null;
      oiThen = Number(rows[Math.min(rows.length - 1, CFG.stage1.lookback_days - 1)]?.open_interest) || null;
      vol20 = rows.slice(0, CFG.stage1.lookback_days).reduce((a, r) => a + (Number(r.volume) || 0), 0);
    }
    const oiGrowthPct = oiNow != null && oiThen ? (oiNow - oiThen) / oiThen * 100 : null;
    // 3b: ask-side share at the magnet strike over sampled recent days
    let ask = 0, bid = 0;
    for (let i = 1; i <= CFG.stage3.flow_sample_days; i++) {
      const day = bdaysAgo(i);
      const fj = await uw(`/stock/${c.ticker}/flow-per-strike?date=${day}`);
      const frows = Array.isArray(fj) ? fj : fj?.data || [];
      for (const fr of frows) {
        if (Math.abs(Number(fr.strike) - c.magnetStrike) > 1e-6) continue;
        ask += Number(fr.call_volume_ask_side) || 0;
        bid += Number(fr.call_volume_bid_side) || 0;
      }
    }
    const askShare = ask + bid > 0 ? ask / (ask + bid) : null;
    const oiPass = oiGrowthPct != null && oiGrowthPct >= CFG.stage3.oi_growth_min_pct;
    const askPass = askShare != null && askShare >= CFG.stage3.askside_share_min;
    out.push({ ...c, occ, oiNow, oiThen, oiGrowthPct, vol20, askShare,
               confirmed: Boolean(oiPass && askPass),
               confirmNote: `oi ${oiThen ?? '?'}→${oiNow ?? '?'} (${oiGrowthPct?.toFixed(0) ?? '?'}%) ` +
                            `askShare ${(askShare != null ? (askShare * 100).toFixed(0) + '%' : '?')}` });
  }
  console.log(`S3 → ${out.filter(x => x.confirmed).length} confirmed campaigns`);
  return out;
}

// ---------------- Stage 4: quality gate ----------------
async function stage4(cands) {
  console.log('S4 quality gate...');
  for (const c of cands) {
    const q = await uw(`/option-contract/${c.occ}/flow?limit=1`);
    const row = Array.isArray(q?.data) ? q.data[0] : null;
    const bidP = Number(row?.nbbo_bid) || null, askP = Number(row?.nbbo_ask) || null;
    const mid = bidP != null && askP != null ? (bidP + askP) / 2 : Number(row?.price) || null;
    c.mid = mid; c.spreadPct = bidP != null && askP != null && mid ? (askP - bidP) / mid * 100 : null;
    const ej = await uw(`/earnings/${c.ticker}`);
    const next = (ej?.data || []).map(e => e.report_date || e.date).filter(d => d && d >= TODAY).sort()[0] ?? null;
    c.nextEarnings = next;
    c.earningsInWindow = next != null && daysTo(next) <= c.dte + CFG.stage4.earnings_buffer_days;
    const fails = [];
    if (c.spreadPct == null || c.spreadPct > CFG.stage4.max_spread_pct_of_mid) fails.push('spread');
    if (c.mid == null || c.mid < CFG.stage4.min_premium) fails.push('premium');
    c.qualityFails = fails;
    c.finalScore = (c.confirmed ? 1 : 0.3) * c.flowScore * c.mapScore * (fails.length ? 0.3 : 1);
  }
  return cands.sort((a, b) => b.finalScore - a.finalScore);
}

// ---------------- report ----------------
function money(v) { return v == null ? '—' : `$${(v / 1e6).toFixed(0)}M`; }
function report(ranked, topN) {
  const L = [];
  L.push(`# Campaign Report — ${TODAY}`);
  L.push(`\nSkylit universe × UW 20-day accumulation. RESEARCH/OBSERVATION ONLY — unvalidated v1; see PLAN.md. Earnings-in-window is flagged, not auto-rejected (per doctrine, event days can be the best days — but know the date).\n`);
  L.push('| # | ticker | spot | magnet (expiry) | dist | map | 20d net calls | persist | OI trend | ask% | spread | earnings | status |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  ranked.slice(0, topN).forEach((c, i) => {
    L.push(`| ${i + 1} | **${c.ticker}** | $${c.spot.toFixed(2)} | $${c.magnetStrike} (${c.expiry}, ${c.dte}d) | ` +
      `+${(c.distPct * 100).toFixed(1)}% | ${(c.magnetRelSig * 100).toFixed(1)}%σ gk${c.gatekeepers}${c.kingIsMagnet ? ' 👑' : ''} | ` +
      `${money(c.sum20)} | ${c.posDays}/20 | ${c.oiGrowthPct != null ? c.oiGrowthPct.toFixed(0) + '%' : '—'} | ` +
      `${c.askShare != null ? (c.askShare * 100).toFixed(0) + '%' : '—'} | ` +
      `${c.spreadPct != null ? c.spreadPct.toFixed(1) + '%' : '—'} | ${c.nextEarnings ?? '—'}${c.earningsInWindow ? ' ⚠' : ''} | ` +
      `${c.confirmed ? '✅ CONFIRMED' : '◻ structure-only'}${c.qualityFails.length ? ' ⛔' + c.qualityFails.join(',') : ''} |`);
  });
  L.push(`\n### Contract candidates (top confirmed)\n`);
  for (const c of ranked.filter(x => x.confirmed && !x.qualityFails.length).slice(0, 5)) {
    L.push(`- **${c.ticker}** ${c.expiry} $${c.magnetStrike}C (\`${c.occ}\`) @ ~$${c.mid?.toFixed(2) ?? '?'} — ` +
      `magnet ${(c.magnetRelSig * 100).toFixed(1)}% of surface, ${c.confirmNote}, 20d contract volume ${c.vol20.toLocaleString()}`);
  }
  return L.join('\n');
}

async function main() {
  const topN = Number((process.argv.find(a => a.startsWith('--top=')) || '').split('=')[1] || 15);
  if (!KEY) { console.error('no UW key'); process.exit(1); }
  const authOk = await initAuth();
  if (!authOk) { console.error('Skylit auth failed'); process.exit(1); }
  const t0 = Date.now();
  const universe = loadUniverse();
  const s1 = await stage1(universe);
  const s2 = await stage2(s1);
  const s3 = await stage3(s2);
  const ranked = await stage4(s3);
  const md = report(ranked, topN);
  const mdPath = path.join(OUT, `campaign_report_${TODAY}.md`);
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(path.join(OUT, `campaign_report_${TODAY}.json`),
    JSON.stringify(ranked.map(({ ...c }) => c), null, 2));
  console.log(`\ndone in ${((Date.now() - t0) / 60000).toFixed(1)} min → ${mdPath}\n`);
  console.log(md.split('\n').slice(0, 30).join('\n'));
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
