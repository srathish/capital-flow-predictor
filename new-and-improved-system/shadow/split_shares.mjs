// Split-adjusted share counts (stock factory). Prices in .cache/wdaily(_hist) are adjusted to TODAY's share basis, but SEC
// share counts are as-reported, so shares × price understates past market caps of companies that split later. A split
// is inferred where consecutive SEC share counts jump (confirmed by a restatement of an earlier period, see below) by a standard split ratio ≥ 2 (±4%; 3:2 dropped — confused with mergers) within ≤ 400 days; every count
// filed before it is multiplied by that ratio (and by every later split), putting all counts on today's basis.
import fs from 'node:fs';
import path from 'node:path';

const STD = [2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 30, 40, 50];
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
export function sharesAdjusted(C, t, opts = {}) {
  let H; try { H = JSON.parse(fs.readFileSync(path.join(C, 'edgar', 'facts3', `${t}.json`), 'utf8')); } catch { return null; }
  // one tag per company (dei cover-page count if it has ≥ 4 filings, else the us-gaap count) so share classes never mix
  const pick = ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'].find((tag) => (H.sh?.[tag] ?? []).filter((x) => x.v > 0 && x.f).length >= 4)
    ?? ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'].find((tag) => (H.sh?.[tag] ?? []).length);
  if (!pick) return null;
  // one value per filing date: if a filing lists several values (share classes), use their sum
  const byF = new Map(); for (const x of H.sh[pick]) { if (!(x.v > 0 && x.f)) continue; const k = x.f + '|' + (x.e ?? ''); if (!byF.has(x.f)) byF.set(x.f, new Map()); byF.get(x.f).set(k, x.v); }
  const s = [...byF].map(([f, m]) => ({ f, v: [...m.values()].reduce((q, v) => q + v, 0) })).sort((p, q) => p.f.localeCompare(q.f)), splits = [];
  const near = (x, y) => x > 0 && y > 0 && Math.abs(Math.log(x / y)) < Math.log(1.25);
  for (let i = 1; i < s.length; i++) { const r = s[i].v / s[i - 1].v; if (days(s[i - 1].f, s[i].f) > 400) continue;
    // the jump must persist: next filing near the new level, previous filing near the old level (when they exist)
    if (s[i + 1] && !near(s[i + 1].v, s[i].v)) continue; if (s[i - 2] && !near(s[i - 2].v, s[i - 1].v)) continue;
    for (const q of STD) { if (Math.abs(r / q - 1) < 0.04) { splits.push({ after: s[i - 1].f, at: s[i].f, ratio: q }); break; } if (Math.abs(r * q - 1) < 0.04) { splits.push({ after: s[i - 1].f, at: s[i].f, ratio: 1 / q }); break; } } }
  if (opts.raw) return { series: s, splits };
  // confirmation: a real split makes later filings RESTATE earlier periods' share counts (×ratio) and EPS (÷ratio);
  // dilution never restates the past. Sources: facts3 CommonStockSharesOutstanding + .cache/edgar/splitconf/{T}.json
  // (weighted-average basic shares, basic EPS, shares outstanding). A restatement confirms a split when its original
  // filing is ≤ 400 days before the split's first new-basis filing and its restating filing is on/after it.
  const obs = [...(H.sh?.CommonStockSharesOutstanding ?? []).map((x) => ({ tag: 'CommonStockSharesOutstanding', s: null, e: x.e, f: x.f, v: x.v }))];
  try { obs.push(...JSON.parse(fs.readFileSync(path.join(C, 'edgar', 'splitconf', `${t}.json`), 'utf8'))); } catch { /* no extra tags */ }
  const rest = [], byE = new Map(); for (const x of obs) { if (!x.v || !x.f || !x.e) continue; const k = `${x.tag}|${x.s}|${x.e}`; (byE.get(k) ?? byE.set(k, []).get(k)).push(x); }
  for (const arr of byE.values()) { arr.sort((p, q) => p.f.localeCompare(q.f)); for (let i = 1; i < arr.length; i++) { const r = arr[i].v / arr[0].v; if (!(r > 0)) continue; rest.push({ f0: arr[0].f, f1: arr[i].f, r: arr[0].tag === 'EarningsPerShareBasic' ? 1 / r : r }); } }
  const confirmed = splits.filter((sp) => rest.some((x) => Math.abs(x.r / sp.ratio - 1) < 0.04 && x.f1 >= sp.at && x.f0 <= sp.at && days(x.f0, sp.at) <= 400));
  splits.length = 0; splits.push(...confirmed);
  const out = s.map((x) => { let m = 1; for (const sp of splits) if (x.f <= sp.after) m *= sp.ratio; return { d: x.f, v: x.v * m }; });
  return { series: out, splits };
}
export const candidates = (C, t) => sharesAdjusted(C, t, { raw: true })?.splits ?? [];
