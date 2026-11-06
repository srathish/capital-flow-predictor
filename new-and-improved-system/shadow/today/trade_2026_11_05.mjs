// How would our king rules have traded 2026-11-05? Boards = 9 Skylit snapshots (held constant until the next one). Trades in SPY 0DTE options (UW minute prices).
// Rule (user checklist core, sparse version): at each snapshot, if the king is ≥0.25% away, buy the ATM 0DTE option toward it (SPX board mapped to SPY by the spot ratio).
// Exit: price reaches the king (±0.05%), a later snapshot puts the king on the other side, or 15:50.
import fs from 'node:fs';
import { UW_API_KEY } from '../../feeds/env.js';
const SC = '/private/tmp/claude-501/-Users-saiyeeshrathish-the-final-plan/a5088226-4255-42ad-8c1a-63d53449d7a5/scratchpad/';
const bars = JSON.parse(fs.readFileSync(SC + 'SPY_2026-11-05.json', 'utf8')), B = new Map(bars.map((b) => [b.m, b])), BO = JSON.parse(fs.readFileSync(new URL('./skylit_2026_11_05.json', import.meta.url), 'utf8'));
const et = (iso) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };
const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'), toM = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
const optCache = {}; async function opt(K, cp) { const id = `SPY261105${cp}${String(K * 1000).padStart(8, '0')}`; if (optCache[id]) return optCache[id];
  const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${id}/intraday?date=2026-11-05`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }); const j = await r.json();
  return (optCache[id] = (j.data ?? []).map((q) => ({ m: et(q.start_time), c: +q.close, h: +q.high })).sort((a, b) => a.m - b.m)); }
const snaps = Object.keys(BO).map((t) => ({ m: toM(t), spx: BO[t].find((s) => s.symbol === 'SPXW'), spy: BO[t].find((s) => s.symbol === 'SPY') }));
const kingOf = (s) => { const st = s.strikes.filter((x) => Math.abs(x.strike / s.spot - 1) <= 0.03); return st.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a)).strike; };
async function run(board) {
  const trades = []; let busy = -1;
  for (const [si, s] of snaps.entries()) { if (s.m <= busy || s.m > 870) continue; const sb = s[board], K = kingOf(sb), ratio = s.spy.spot / sb.spot, Kspy = K * ratio, p = B.get(s.m)?.o ?? s.spy.spot;
    const dist = (Kspy - p) / p; if (Math.abs(dist) < 0.0025) { trades.push({ at: hm(s.m), note: `no trade: ${board} king ${K} only ${(dist * 100).toFixed(2)}% away` }); continue; }
    const dir = Math.sign(dist), cp = dir > 0 ? 'C' : 'P', strike = Math.round(p), rows = await opt(strike, cp), en = rows.find((q) => q.m >= s.m); if (!en) continue;
    let ex = null;
    for (let m = s.m; m <= 950 && !ex; m++) { const b = B.get(m); if (!b) continue;
      if (dir < 0 ? b.l <= Kspy * 1.0005 : b.h >= Kspy * 0.9995) ex = { m, why: `reached the ${board} king ${K}` };
      const nxt = snaps.find((x) => x.m === m + 1 && x.m > s.m); if (!ex && nxt) { const K2 = kingOf(nxt[board]) * (nxt.spy.spot / nxt[board].spot); if (Math.sign(K2 - (B.get(m)?.c ?? p)) !== dir) ex = { m, why: `new ${board} king on the other side` }; }
      if (m === 950) ex = { m, why: '15:50' }; }
    const xo = rows.filter((q) => q.m <= ex.m).at(-1), peak = rows.filter((q) => q.m > en.m && q.m <= ex.m).reduce((a, q) => Math.max(a, q.h), en.c);
    trades.push({ at: hm(s.m), what: `bought SPY ${strike}${cp} @ $${en.c}`, exit: `${hm(ex.m)} @ $${xo.c} (${ex.why})`, pct: Math.round((xo.c / en.c - 1) * 100), peak: Math.round((peak / en.c - 1) * 100), king: `${board} king ${K}` }); busy = ex.m; }
  return trades;
}
for (const board of ['spx', 'spy']) { const t = await run(board); console.log(`\n=== Using the ${board.toUpperCase()} board ===`); for (const x of t) console.log(x.note ? `  ${x.at} ${x.note}` : `  ${x.at} ${x.king} → ${x.what} → sold ${x.exit} = ${x.pct >= 0 ? '+' : ''}${x.pct}% (peak while held ${x.peak >= 0 ? '+' : ''}${x.peak}%)`); }
// what the whole move was worth: 09:35 ATM put held to the close
const r0 = await opt(Math.round(B.get(575).o), 'P'), a = r0.find((q) => q.m >= 575), z = r0.filter((q) => q.m <= 955).at(-1); console.log(`\nReference: SPY ${Math.round(B.get(575).o)}P bought 09:35 @ $${a.c}, held to 15:55 @ $${z.c} = +${Math.round((z.c / a.c - 1) * 100)}%`);
