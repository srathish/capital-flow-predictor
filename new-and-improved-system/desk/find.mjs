// STEP 1 — FIND the stock (direction comes from here, never from the map).
// Sources, each tagged with WHY it's on the list:
//   • your tickers (direction from the daily trend; mixed trend → both sides are checked)
//   • 12-1 momentum leaders (only selection rule positive in train/test/holdout, weak) — trend up AND stronger than SPY (20d)
//   • hot themes: top-2 sector baskets by 20d return → their members that are trending up and stronger than SPY
//   • insider buys: an open-market insider purchase ≥ $100k (Form 4 code P) filed in the last 20 sessions → long. The ONE selection
//     signal that survived every check (shadow/uw_signals.mjs + uw_robust.mjs: +3.2% vs same-stock random dates over 20 sessions,
//     t 2.7, positive every year 2022–26). Not gated by trend — insiders buying weakness is the point.
// Hard filter (verified): never buy a dip in a laggard (weaker than SPY over 20d) — generated longs require rs20 > 0.
// Universe ranking uses the cached daily bars (refresh weekly with --refresh-universe, ~300 credits); candidates are refreshed in Step 2.
import { loadDaily, features, universe, THEMES, refreshDaily, prevTD, tdRange, addDays } from './common.mjs';
import { UW_API_KEY } from '../feeds/env.js';

async function insiderBuys(D) { // market-wide recent open-market purchases (UW quota only)
  const out = [];
  for (let p = 0; p < 3; p++) {
    const r = await fetch(`https://api.unusualwhales.com/api/insider/transactions?transaction_codes[]=P&limit=500&page=${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
    const d = r?.ok ? ((await r.json().catch(() => null))?.data ?? []) : []; out.push(...d); if (d.length < 500 || d.at(-1).filing_date < addDays(D, -35)) break;
  }
  return out;
}

export async function findCandidates({ tickers = [], D, momentumN = 15, themes = true, insiders = true, refreshUniverse = false }) {
  const spy = await refreshDaily('SPY', D), uni = universe();
  if (refreshUniverse) for (const s of uni) await refreshDaily(s, D);
  const feat = new Map();
  for (const s of new Set([...uni, ...tickers, ...Object.values(THEMES).flatMap((v) => v.split(' '))])) {
    const b = loadDaily(s).filter((x) => x.d < D); if (!b.length) continue;
    const sp = spy.filter((x) => x.d <= b.at(-1).d); const f = features(b, sp); if (f) feat.set(s, f);
  }
  const staleDays = [...feat.values()].filter((f) => f.last < prevTD(D)).length;
  const C = new Map();
  const add = (s, dirs, why) => { const c = C.get(s) ?? { sym: s, dirs: new Set(), why: [] }; dirs.forEach((d) => c.dirs.add(d)); c.why.push(why); C.set(s, c); };
  const pc = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';

  for (const t of tickers) {
    const f = feat.get(t);
    const dirs = !f || f.trend === 'mixed' ? ['up', 'down'] : [f.trend];
    add(t, dirs, `your ticker${f ? ` (trend ${f.trend}, ${pc(f.rs20)} vs SPY 20d)` : ''}`);
  }
  const eligible = [...feat.entries()].filter(([s, f]) => uni.includes(s) && f.px >= 5 && f.dollarVol >= 2e7);
  if (momentumN > 0) {
    const mom = eligible.filter(([, f]) => f.r12_1 != null && f.trend === 'up' && f.rs20 > 0).sort((a, b) => b[1].r12_1 - a[1].r12_1).slice(0, momentumN);
    mom.forEach(([s, f], i) => add(s, ['up'], `12-1 momentum #${i + 1} (${pc(f.r12_1)} over the year ex last month, ${pc(f.rs20)} vs SPY 20d)`));
  }
  let hot = [];
  if (themes) {
    hot = Object.entries(THEMES).map(([k, v]) => { const m = v.split(' ').filter((s) => feat.has(s)); if (m.length < 4) return null;
      const fs_ = m.map((s) => feat.get(s)); return { k, m, r20: fs_.reduce((a, f) => a + f.r20, 0) / m.length, breadth: fs_.filter((f) => f.r5 > 0).length / m.length }; })
      .filter(Boolean).sort((a, b) => b.r20 - a.r20).slice(0, 2);
    hot.forEach((t, i) => t.m.forEach((s) => { const f = feat.get(s); if (f.trend === 'up' && f.rs20 > 0 && f.px >= 5) add(s, ['up'], `hot theme #${i + 1} ${t.k} (${pc(t.r20)} avg 20d, ${Math.round(t.breadth * 100)}% of names up this week) — leader ${pc(f.rs20)} vs SPY`); }));
  }
  if (insiders) {
    let back = D; for (let k = 0; k < 20; k++) back = prevTD(back); // filings in the last 20 sessions before D
    const by = {};
    for (const r of await insiderBuys(D)) { if (r.transaction_code !== 'P' || r.filing_date < back || r.filing_date >= D || !uni.includes(r.ticker)) continue; const v = Math.abs(r.amount) * +r.price; if (v < 1e5) continue; (by[r.ticker] ??= []).push({ who: r.owner_name, v, f: r.filing_date, title: r.officer_title ?? (r.is_director ? 'director' : '') }); }
    for (const [s, xs] of Object.entries(by)) { const v = xs.reduce((a, x) => a + x.v, 0), latest = xs.map((x) => x.f).sort().at(-1);
      add(s, ['up'], `insider buy: ${new Set(xs.map((x) => x.who)).size} insider(s) bought $${v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1e3) + 'k'} on the open market (latest filed ${latest}; ${xs.slice(0, 2).map((x) => `${x.who.split(' ').slice(0, 2).join(' ')}${x.title ? ' — ' + x.title : ''}`).join(', ')})`); }
  }
  return { cands: [...C.values()].map((c) => ({ ...c, dirs: [...c.dirs], feat: feat.get(c.sym) ?? null })), hotThemes: hot.map((t) => ({ theme: t.k, r20: t.r20, breadth: t.breadth })),
    note: staleDays > feat.size / 2 ? `universe daily bars are stale (last ${[...feat.values()][0]?.last}) — momentum/theme ranks use them; run with --refresh-universe weekly (~300 credits)` : null };
}
