// OPTION-MARK BACKTEST — the decisive test: realized capture on the actual 0DTE SPXW marks.
// For each disciplined signal, buy the ATM 0DTE contract (put for SHORT thesis, call for LONG),
// enter at the signal minute's mark, then MANAGE: exit at +TP% / -SL% / EOD. Measures the number
// Falcon actually lives on (realized), plus "saw >=30%" reachability to compare to his cards.
// Usage: node option_bt.mjs [TP] [SL]   (defaults +30 / -40). Reads signals_disc.json.
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs'; import path from 'node:path';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const TP = Number(process.argv[2] ?? 30), SL = Number(process.argv[3] ?? 40);
const sigs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'research', 'doctrine', 'signals_disc.json'), 'utf8'));
const occFor = (day, cp, strike) => `SPXW${day.slice(2).replace(/-/g, '')}${cp}${String(strike * 1000).padStart(8, '0')}`;
const etOf = (utc) => { const h = +utc.slice(11, 13) - 4, m = utc.slice(14, 16); return `${String(h).padStart(2, '0')}:${m}`; }; // EDT
const round5 = (x) => Math.round(x / 5) * 5;
const cache = {};
async function marks(occ, day) {
  if (cache[occ] !== undefined) return cache[occ];
  const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${occ}/intraday`, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!r || !r.ok) return (cache[occ] = null);
  const d = ((await r.json())?.data || []).filter(b => (b.start_time || '').slice(0, 10) === day).map(b => ({ et: etOf(b.start_time), o: +b.open, h: +b.high, l: +b.low, c: +b.close, a: +b.avg_price })).filter(b => b.c > 0).sort((x, y) => x.et.localeCompare(y.et));
  await new Promise(r => setTimeout(r, 220));
  return (cache[occ] = d.length ? d : null);
}
function manage(bars, i0, entry) {
  let peak = 0, trough = 0;
  for (let j = i0; j < bars.length; j++) {
    const favHi = (bars[j].h - entry) / entry * 100, favLo = (bars[j].l - entry) / entry * 100; // long-the-option: price up = profit
    peak = Math.max(peak, favHi); trough = Math.min(trough, favLo);
    if (favHi >= TP) return { r: 'TP', ret: TP, peak, bars: j - i0 };      // hit take-profit intrabar
    if (favLo <= -SL) return { r: 'SL', ret: -SL, peak, bars: j - i0 };    // hit stop intrabar
  }
  const close = (bars[bars.length - 1].c - entry) / entry * 100;
  return { r: 'EOD', ret: close, peak, bars: bars.length - 1 - i0 };
}
const rows = [];
for (const s of sigs) {
  const cp = s.dir === 'SHORT' ? 'P' : 'C';
  const strike = round5(s.spot);                 // ATM 0DTE
  const occ = occFor(s.day, cp, strike);
  const bars = await marks(occ, s.day);
  if (!bars) { rows.push({ ...s, occ, err: 'no marks' }); continue; }
  const i0 = bars.findIndex(b => b.et >= s.et);
  if (i0 < 0 || i0 >= bars.length - 1) { rows.push({ ...s, occ, err: 'entry past EOD' }); continue; }
  const entry = bars[i0].c;                        // enter at signal-minute close (mark)
  const o = manage(bars, i0 + 1, entry);
  rows.push({ ...s, occ, entry, ...o });
}
// report
const ok = rows.filter(r => r.ret != null);
console.log(`=== OPTION-MARK BACKTEST — ${ok.length}/${rows.length} priced · ATM 0DTE · manage +${TP}% / -${SL}% / EOD ===`);
console.log(`day         et     dir    strike  entry$  peak%   result   ret%`);
for (const r of rows) console.log(`${r.day}  ${r.et}  ${r.dir}  ${String(round5(r.spot)).padStart(4)}${r.dir === 'SHORT' ? 'P' : 'C'}  ${r.err ? '  — ' + r.err : `${String(r.entry.toFixed(2)).padStart(6)}  ${r.peak.toFixed(0).padStart(4)}%   ${r.r.padEnd(4)}    ${r.ret > 0 ? '+' : ''}${r.ret.toFixed(0)}%`}`);
if (ok.length) {
  const wins = ok.filter(r => r.ret > 0).length, avg = ok.reduce((a, c) => a + c.ret, 0) / ok.length;
  const saw30 = ok.filter(r => r.peak >= 30).length, saw20 = ok.filter(r => r.peak >= 20).length;
  console.log(`\nREALIZED: ${ok.length} trades · win ${(wins / ok.length * 100).toFixed(0)}% · avg ret ${avg > 0 ? '+' : ''}${avg.toFixed(1)}%/trade (expectancy) · total ${ok.reduce((a, c) => a + c.ret, 0).toFixed(0)}%`);
  console.log(`REACHABILITY: saw>=30% ${saw30}/${ok.length} (${(saw30 / ok.length * 100).toFixed(0)}%) · saw>=20% ${saw20}/${ok.length} (${(saw20 / ok.length * 100).toFixed(0)}%)  <- compare Falcon "saw>=30%:74%, >=20%:95%"`);
  console.log(`\nby score band:`);
  for (const [lo, hi] of [[0, 55], [55, 70], [70, 100]]) { const b = ok.filter(r => r.total >= lo && r.total < hi); if (b.length) console.log(`  ${lo}-${hi}: n=${b.length} win ${(b.filter(r => r.ret > 0).length / b.length * 100).toFixed(0)}% avg ${(b.reduce((a, c) => a + c.ret, 0) / b.length).toFixed(1)}%`); }
}
