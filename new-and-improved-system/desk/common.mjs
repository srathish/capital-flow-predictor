// Shared plumbing for the desk: NYSE calendar, daily-bar store (.cache/daily, Atlas 1 credit per refresh call), features, themes.
import fs from 'node:fs';
import path from 'node:path';
import { atlasHistory } from '../feeds/skylit.js';
import { etToUnix, todayET } from '../lib/time.js';
import { dailyTrend } from '../system/stockrules.js';

export const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..');
const DAILY = path.join(ROOT, '.cache', 'daily');

// ---- calendar ----
const HOLIDAYS = new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24']);
export const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
export const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const isTD = (d) => dow(d) >= 1 && dow(d) <= 5 && !HOLIDAYS.has(d);
export const nextTD = (d) => { let x = addDays(d, 1); while (!isTD(x)) x = addDays(x, 1); return x; };
export const prevTD = (d) => { let x = addDays(d, -1); while (!isTD(x)) x = addDays(x, -1); return x; };
export const tdRange = (from, n) => { const out = []; let x = isTD(from) ? from : nextTD(from); while (out.length < n) { out.push(x); x = nextTD(x); } return out; };
const nowETmin = () => { const n = new Date(Date.now() - 4 * 3600e3); return n.getUTCHours() * 60 + n.getUTCMinutes(); };
/** The session the desk is planning for: today if it's a trading day and not past 16:00 ET, else the next trading day. */
export const sessionDate = () => { const t = todayET(); return isTD(t) && nowETmin() < 16 * 60 ? t : nextTD(t); };
/** this week's Friday if ≥2 trading days away, else next Friday; holiday Friday → Thursday (same rule as the backtests) */
export const weekly = (d) => { let f = addDays(d, (5 - dow(d) + 7) % 7); if (dow(d) >= 4) f = addDays(f, 7); while (!isTD(f)) f = addDays(f, -1); return f; };
/** "buy time": first Friday ≥ D+14 calendar days (holiday → Thursday) */
export const buyTime = (d) => { let f = addDays(d, 14); while (dow(f) !== 5) f = addDays(f, 1); while (!isTD(f)) f = addDays(f, -1); return f; };

// ---- daily bars ----
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
export function loadDaily(sym) { const f = path.join(DAILY, `${sym}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).map((b) => ({ ...b, d: ymd(b.t) })) : []; }
/** Bring a symbol's daily bars up to the last COMPLETED session before `D` (1 Atlas credit when stale; free when fresh). */
export async function refreshDaily(sym, D) {
  const want = prevTD(D), have = loadDaily(sym);
  if (have.length && have.at(-1).d >= want) return have.filter((b) => b.d < D);
  const from = have.length ? etToUnix(addDays(have.at(-1).d, -5), '09:30') : etToUnix('2025-01-02', '09:30');
  const fresh = await atlasHistory(sym, 'D', from, etToUnix(want, '16:00') + 3600).catch(() => []);
  const m = new Map(have.map((b) => [b.d, b])); for (const b of fresh) m.set(ymd(b.t), { ...b, d: ymd(b.t) });
  const all = [...m.values()].sort((a, b) => a.t - b.t).filter((b) => b.d <= want);
  fs.mkdirSync(DAILY, { recursive: true }); fs.writeFileSync(path.join(DAILY, `${sym}.json`), JSON.stringify(all.map(({ d, ...b }) => b)));
  return all.filter((b) => b.d < D);
}

// ---- features (from completed daily bars only) ----
export function features(bars, spyBars) {
  if (bars.length < 60) return null;
  const c = bars.map((b) => b.c), L = c.length, r = (n) => (L > n ? c[L - 1] / c[L - 1 - n] - 1 : null);
  const sc = spyBars.map((b) => b.c), sr = (n) => sc.at(-1) / sc.at(-1 - n) - 1;
  const tr = bars.slice(-15).map((b, k, xs) => (k ? Math.max(b.h - b.l, Math.abs(b.h - xs[k - 1].c), Math.abs(b.l - xs[k - 1].c)) : null)).filter((x) => x != null);
  const v50 = bars.slice(-50).reduce((a, b) => a + (b.v || 0), 0) / 50;
  return { px: c[L - 1], r5: r(5), r20: r(20), r12_1: L > 252 ? c[L - 22] / c[L - 253] - 1 : null, rs20: r(20) - sr(20), trend: dailyTrend(c), atr: tr.reduce((a, x) => a + x, 0) / tr.length, dollarVol: v50 * c[L - 1], last: bars.at(-1).d };
}

// ---- universe + themes ----
const ETF = new Set('ARKK DIA DRAM ETHA EWY FXI GDX GLD HYG IBIT IGV IVV IWM KRE KWEB QQQ SLV SMH SOXL SPY SQQQ TLT TQQQ USO UVXY XLB XLC XLE XLF XLI XLK XLP XLU XLV XLY GOOG'.split(' '));
export const universe = () => JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'apps/gex/research/stock-gex/universe-structures.json'), 'utf8')).rows.map((r) => r.ticker).filter((t) => !ETF.has(t)).sort();
// Sector baskets from memory (feedback_always_sector_basket_workup, 2026-05-26) — not fit to any test data.
export const THEMES = {
  space: 'ASTS LUNR RKLB SATL SPIR AMPG SIDU VOYG IRDM RDW BKSY GSAT FLY PL HAWK MDA KTOS', dcInfra: 'VRT DLR EQIX ANET NTAP IREN NBIS CRWV WULF APLD GLW',
  aiCompute: 'NVDA AMD AVGO MRVL SMCI ORCL PLTR AI SOUN BBAI', semis: 'NVDA AMD AVGO TSM ASML AMAT LRCX KLAC MU MRVL', crypto: 'COIN MSTR MARA RIOT HUT CIFR IREN CLSK BTBT WULF',
  ev: 'TSLA RIVN LCID NIO XPEV LI F GM', defense: 'LMT RTX NOC GD BA LHX HII KTOS', banks: 'JPM BAC WFC C GS MS USB', oil: 'XOM CVX COP OXY SLB HAL BP EQT',
  saas: 'CRM NOW ORCL SAP ADBE MSFT NET DDOG', cyber: 'PANW CRWD ZS NET FTNT OKTA S', pharma: 'LLY NVO JNJ MRNA BNTX REGN GILD', quantum: 'IONQ RGTI QBTS QUBT ARQQ',
  nuclear: 'OKLO NNE SMR BWXT CCJ LEU',
};
