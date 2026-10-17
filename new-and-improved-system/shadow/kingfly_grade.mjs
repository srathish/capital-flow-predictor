#!/usr/bin/env node
// King-pin butterfly FORWARD paper system — after-close grading (launchd com.srathish.kingflygrade, weekdays 21:55 ET).
// Prices each signal's king fly and control fly with real UW minute prices (as king_pin_fly.mjs), tags the prior-close UW
// ±1% gamma balance (amendment 1 filter), appends results_kingfly/forward.jsonl and rewrites forward.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../feeds/env.js';
const SH = path.dirname(fileURLToPath(import.meta.url)), R = path.join(SH, 'results_kingfly'), SF = path.join(R, 'forward_signals.jsonl'), FF = path.join(R, 'forward.jsonl');
const uw = async (p) => { await new Promise((r) => setTimeout(r, 120)); const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }); return r.ok ? r.json() : null; };
const et = (iso) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };
const sigs = fs.existsSync(SF) ? fs.readFileSync(SF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [], have = new Set(fs.existsSync(FF) ? fs.readFileSync(FF, 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return j.d + j.T; }) : []);
for (const s of sigs) { if (have.has(s.d + s.T)) continue;
  const px = async (K, m) => { const id = `${s.T}${s.d.slice(2, 4)}${s.d.slice(5, 7)}${s.d.slice(8, 10)}C${String(Math.round(K * 1000)).padStart(8, '0')}`; const j = await uw(`/option-contract/${id}/intraday?date=${s.d}`); const row = (j?.data ?? []).map((q) => ({ m: et(q.start_time), c: +q.close })).filter((q) => q.c > 0 && q.m >= m && q.m <= m + 2).sort((a, b) => a.m - b.m)[0]; return row?.c ?? null; };
  const bars = (await uw(`/stock/${s.T}/ohlc/1m?date=${s.d}&limit=1000`))?.data?.filter((b) => b.market_time === 'r').sort((a, b) => a.start_time.localeCompare(b.start_time)); const S = bars?.length ? +bars.at(-1).close : null; if (S == null) continue;
  const fly = async (K) => { const a = await px(K - 2, s.m), b = await px(K, s.m), c = await px(K + 2, s.m); if ([a, b, c].some((v) => v == null)) return null; const debit = a + 0.01 - 2 * (b - 0.01) + c + 0.01; if (!(debit > 0)) return null; const pay = Math.max(0, S - (K - 2)) - 2 * Math.max(0, S - K) + Math.max(0, S - (K + 2)); return { debit: +debit.toFixed(3), pay: +pay.toFixed(3), r: +(pay / debit - 1).toFixed(3) }; };
  const daily = (await uw(`/stock/${s.T}/ohlc/1d?timeframe=1M`))?.data?.filter((b) => b.market_time === 'r').sort((a, b) => a.date.localeCompare(b.date)) ?? [], pi = daily.findIndex((b) => b.date === s.d) - 1, prev = daily[pi];
  let a01 = null; if (prev) { const g = (await uw(`/stock/${s.T}/greek-exposure/strike?date=${prev.date}`))?.data ?? []; let A = 0, N = 0; for (const r of g) { const v = +r.call_gex + +r.put_gex; if (Math.abs(+r.strike / +prev.close - 1) <= 0.01) { A += Math.abs(v); N += v; } } a01 = A > 0 ? +(N / A).toFixed(3) : null; }
  fs.appendFileSync(FF, JSON.stringify({ ...s, close: S, a01, longGamma: a01 != null && a01 >= 0, kf: await fly(s.king), cf: await fly(s.ctrl) }) + '\n'); }
const rows = fs.existsSync(FF) ? fs.readFileSync(FF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [], mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN), pc = (v) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(0) + '%' : '—');
const line = (lab, a) => { const k = a.filter((r) => r.kf), c = a.filter((r) => r.kf && r.cf); return `| ${lab} | ${k.length} | ${pc(mean(k.map((r) => r.kf.r)))} | ${k.length ? Math.round(100 * k.filter((r) => r.kf.r > 0).length / k.length) + '%' : '—'} | ${pc(mean(c.map((r) => r.kf.r - r.cf.r)))} |`; };
fs.writeFileSync(path.join(R, 'forward.md'), ['# King-pin butterfly — forward paper ledger (rules frozen 2026-10-17)\n', 'Backtest: Mar–May +104% per fly vs control +143 pts (p 0.02), but Dec–Feb −5%; unproven. Forward days decide.\n',
  '| sample | flies | mean per fly | win | king minus control |', '|---|---|---|---|---|', line('all signals', rows), line('long-gamma days (registered filter)', rows.filter((r) => r.longGamma)), line('short-gamma days', rows.filter((r) => r.longGamma === false)),
  '\n| date | ticker | time | king | spot | close | gamma bal | king fly | control |', '|---|---|---|---|---|---|---|---|---|', ...rows.slice().reverse().map((r) => `| ${r.d} | ${r.T} | ${String(Math.floor(r.m / 60)).padStart(2, '0')}:${String(r.m % 60).padStart(2, '0')} | ${r.king} | ${r.spot} | ${r.close} | ${r.a01 ?? '—'} | ${r.kf ? pc(r.kf.r) : '—'} | ${r.cf ? pc(r.cf.r) : '—'} |`)].join('\n') + '\n');
console.log('forward flies', rows.length);
