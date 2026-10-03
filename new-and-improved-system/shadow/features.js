// Extra Skylit layers for the stock swing system — each one cached on disk, each one a doctrine rule (defined BEFORE testing):
//   vexBias      — VEX for swings: vanna mass above spot vs below on the weekly board ("VEX lit higher" = upside pull)
//   rollingMap   — day-over-day gamma board: floor rolling up = bullish, ceiling rolling down = bearish (Academy Ch.7)
//   earningsIn   — Tempest past/next earnings dates: is there an earnings release inside the holding window? (don't trade the event)
//   flowLean     — Flowseeker aggregate_score 1d composite on that date (supporting check, never a trigger)
import fs from 'node:fs';
import path from 'node:path';
import { heatmapAt, aggregateScore } from '../feeds/skylit.js';
import { normalizeBoard } from '../map/board.js';
import { hierarchy } from '../map/hierarchy.js';
import { etToUnix, iso } from '../lib/time.js';
import { SKYLIT_API_KEY } from '../feeds/env.js';

const CACHE = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..', '.cache', 'stock');
const rd = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined);
const wr = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); return v; };

export async function board(sym, date, exp, metric = 'gamma') {
  const f = path.join(CACHE, sym, metric === 'gamma' ? `${date}_${exp}.json` : `${date}_${exp}_${metric}.json`);
  const hit = rd(f); if (hit !== undefined) return hit;
  let out = null;
  try { out = (await heatmapAt([sym], iso(etToUnix(date, '09:35')), { metric, expirations: exp }))[0] ?? null; } catch (e) { out = { error: String(e.message).slice(0, 160) }; }
  return wr(f, out);
}

/** 'up' | 'down' | 'flat' from the vanna board: |vanna| mass within ±5% above vs below spot. */
export async function vexBias(sym, date, exp) {
  const raw = await board(sym, date, exp, 'vanna');
  if (!raw || raw.error || !raw.strikes?.length) return { bias: null };
  const spot = raw.spot; let up = 0, dn = 0;
  for (const s of raw.strikes) { if (!s.value || Math.abs(s.strike - spot) / spot > 0.05) continue; if (s.strike > spot) up += Math.abs(s.value); else if (s.strike < spot) dn += Math.abs(s.value); }
  const bias = up > 1.2 * dn ? 'up' : dn > 1.2 * up ? 'down' : 'flat';
  const top = raw.strikes.filter((s) => s.value).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  return { bias, up, dn, topVanna: top ? { strike: top.strike, value: top.value } : null };
}

/** Compare today's 09:35 gamma board with the previous session's (same expiry). */
export async function rollingMap(sym, prevDate, date, exp) {
  if (!prevDate) return { floor: 'unknown', ceiling: 'unknown' };
  const [a, b] = [await board(sym, prevDate, exp), await board(sym, date, exp)];
  if (!a?.strikes?.length || !b?.strikes?.length) return { floor: 'unknown', ceiling: 'unknown' };
  const ha = hierarchy(normalizeBoard({ ...a, symbol: sym })), hb = hierarchy(normalizeBoard({ ...b, symbol: sym }));
  const dir = (x, y) => (x == null || y == null ? 'unknown' : y > x ? 'up' : y < x ? 'down' : 'flat');
  return { floor: dir(ha.floor?.strike, hb.floor?.strike), ceiling: dir(ha.ceiling?.strike, hb.ceiling?.strike) };
}

/** All known earnings dates for a symbol (Tempest events: past list + next). */
export async function earningsDates(sym) {
  const f = path.join(CACHE, sym, `earnings.json`);
  const hit = rd(f); if (hit !== undefined) return hit;
  const r = await fetch(`https://api.skylit.ai/v1/vol/events?symbols=${sym}`, { headers: { Authorization: `Bearer ${SKYLIT_API_KEY}`, Accept: 'application/json' } });
  const j = await r.json().catch(() => null);
  const ev = j?.data?.symbols?.[0]?.events;
  const dates = [...(ev?.past || []).map((p) => p.date), ev?.next_date].filter(Boolean);
  return wr(f, dates);
}
/** earnings on any day in [d0, d1] — or the day after d1 if it reports after the close of d1 (conservative: include d1+1). */
export function earningsIn(dates, d0, d1) {
  const end = new Date(d1 + 'T12:00:00Z'); end.setUTCDate(end.getUTCDate() + 1);
  const e = end.toISOString().slice(0, 10);
  return dates.find((x) => x >= d0 && x <= e) ?? null;
}

/** Flowseeker 1d composite on a date (cached). */
export async function flowLean(sym, date) {
  const f = path.join(CACHE, sym, `flow_${date}.json`);
  let j = rd(f);
  if (j === undefined) { try { j = await aggregateScore(sym, '1d', date); } catch (e) { j = { error: String(e.message).slice(0, 120) }; } wr(f, j); }
  const c = j?.data?.byTimeframe?.['1d']?.composite;
  return { composite: c ?? null, lean: c == null ? null : c > 1 ? 'up' : c < -1 ? 'down' : 'flat' };
}
