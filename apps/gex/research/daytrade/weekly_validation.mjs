// weekly_validation.mjs — STEP 0: does the node-retest+regime+direction play work on WEEKLY options with REAL fills?
// Map: /v1/historical (nodes). Direction: aggregate_score (dated). Regime: SPX SMA20/50. Fills: MCP contract_history vwap.
import '/Users/saiyeeshrathish/the final plan/apps/gex/scripts/_env-bootstrap.js';
import fs from 'node:fs';
const SK = process.env.SKYLIT_API_KEY;
const H = { Authorization: `Bearer ${SK}`, Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dstr = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const sma = (a, i, n) => i + 1 < n ? null : a.slice(i - n + 1, i + 1).reduce((x, y) => x + y, 0) / n;
let rlRemain = 120, lastCall = 0;
async function gate() { const w = 560 - (Date.now() - lastCall); if (w > 0) await sleep(w); lastCall = Date.now(); }
async function rest(host, p) { for (let a = 0; a < 4; a++) { await gate(); const r = await fetch(`https://${host}.skylit.ai${p}`, { headers: H }); if (r.status === 429) { await sleep(3000); continue; } return r.json().catch(() => null); } return null; }
async function mcp(name, args) {
  for (let a = 0; a < 4; a++) {
    await gate();
    const r = await fetch('https://mcp.skylit.ai/mcp', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    if (r.status === 429) { await sleep(3000); continue; }
    const t = await r.text(); const l = t.split('\n').find((x) => x.startsWith('data:')); if (!l) return null;
    const j = JSON.parse(l.slice(5)); const txt = j.result?.content?.[0]?.text;
    let out; try { out = txt ? JSON.parse(txt) : (j.result || j.error); } catch { out = txt || j.error; }
    if (typeof out === 'string' && /rate.?limit/i.test(out)) { await sleep(3000); continue; }
    if (out?.meta?.rateLimitRemaining != null) rlRemain = out.meta.rateLimitRemaining;
    return out;
  }
  return null;
}

const BASKET = ['AAPL', 'NVDA', 'TSLA', 'AMD', 'META', 'MSFT', 'AMZN', 'GOOGL', 'MU', 'PLTR', 'COIN', 'NFLX'];
const STRONG = ['king', 'gatekeeper'], REJECT = ['king', 'gatekeeper', 'barney'];
const ENTRY_PROX = 0.04, GATE_RATIO = 0.7, ATR_MULT = 1.0, SLIP = 0.03;
const stepOf = (p) => p < 50 ? 1 : p < 100 ? 2.5 : 5;
const occ = (tk, exp, ty, K) => `${tk}__${exp.slice(2).replace(/-/g, '')}${ty === 'call' ? 'C' : 'P'}${String(Math.round(K * 1000)).padStart(8, '0')}`;

const NOW = Math.floor(Date.now() / 1000);
// SPX regime
const spx = await rest('atlas-api', `/v1/history?symbol=SPX&resolution=D&from=${NOW - 300 * 86400}&to=${NOW}`);
const regime = {}; spx.t.forEach((t, i) => { const s20 = sma(spx.c, i, 20), s50 = sma(spx.c, i, 50); let r = 'neutral'; if (s20 && s50) { if (spx.c[i] > s20 && s20 > s50) r = 'bull'; else if (spx.c[i] < s20 && s20 < s50) r = 'bear'; } regime[dstr(t)] = r; });
const regAt = (d) => { const ks = Object.keys(regime).filter((x) => x <= d).sort(); return ks.length ? regime[ks[ks.length - 1]] : 'neutral'; };

const rows = [];
for (const tk of BASKET) {
  const dq = await rest('atlas-api', `/v1/history?symbol=${tk}&resolution=D&from=${NOW - 140 * 86400}&to=${NOW}`);
  if (dq?.s !== 'ok' || !dq.t?.length) { console.log(`\n${tk}: no atlas daily, skip`); continue; }
  const bars = dq.t.map((t, i) => ({ d: dstr(t), o: dq.o[i], h: dq.h[i], l: dq.l[i], c: dq.c[i] }));
  const atr = bars.map((b, i) => { if (i < 14) return null; let s = 0; for (let k = i - 13; k <= i; k++) s += Math.max(bars[k].h - bars[k].l, Math.abs(bars[k].h - bars[k - 1].c), Math.abs(bars[k].l - bars[k - 1].c)); return s / 14; });
  // group into ISO weeks
  const weeks = {}; bars.forEach((b, i) => { const dt = new Date(b.d + 'T00:00:00Z'); const monday = new Date(dt); monday.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); const wk = monday.toISOString().slice(0, 10); (weeks[wk] ||= []).push(i); });
  const wkKeys = Object.keys(weeks).sort().slice(-16); // last ~16 weeks
  process.stdout.write(`\n${tk}: `);
  for (const wk of wkKeys) {
    const idxs = weeks[wk]; if (idxs.length < 3) continue;
    const monIdx = idxs[0], monDate = bars[monIdx].d;
    const reg = regAt(monDate);
    // nearest weekly expiration
    const exl = await mcp('expirations', { ticker: tk, date: monDate }); await sleep(180);
    const cands = (exl?.data || []).filter((e) => e.dte >= 2 && e.dte <= 10).sort((a, b) => Math.abs(a.dte - 5) - Math.abs(b.dte - 5));
    const exp = cands[0]?.expiration; if (!exp) { process.stdout.write('e'); continue; }
    // map board
    const bq = await rest('api', `/v1/historical?symbols=${tk}&at=${monDate}T13:35:00Z&metric=gamma&maxStrikes=all&expirations=${exp}`); await sleep(180);
    const bd = bq?.data?.symbols?.[0]; if (!bd?.strikes?.length) { process.stdout.write('m'); continue; }
    const spot = bd.spot; const nodes = bd.strikes.filter((x) => REJECT.includes(x.nodeType)).map((x) => ({ ...x, av: Math.abs(x.value) }));
    const ent = nodes.filter((x) => STRONG.includes(x.nodeType));
    let setup = null;
    const supB = ent.filter((x) => x.strike < spot).sort((a, b) => b.strike - a.strike)[0];
    const tgtA = ent.filter((x) => x.strike > spot).sort((a, b) => a.strike - b.strike)[0];
    if (reg === 'bull' && supB && tgtA && (spot - supB.strike) / spot <= ENTRY_PROX) {
      const gates = nodes.filter((x) => x.strike > supB.strike && x.strike < tgtA.strike && x.av >= tgtA.av * GATE_RATIO);
      if (!gates.length) setup = { dir: 'bull', ty: 'call', entry: supB.strike, target: tgtA.strike };
    }
    if (!setup && reg === 'bear') { const resA = ent.filter((x) => x.strike > spot).sort((a, b) => a.strike - b.strike)[0]; const tgtBl = ent.filter((x) => x.strike < spot).sort((a, b) => b.strike - a.strike)[0]; if (resA && tgtBl && (resA.strike - spot) / spot <= ENTRY_PROX) { const gates = nodes.filter((x) => x.strike < resA.strike && x.strike > tgtBl.strike && x.av >= tgtBl.av * GATE_RATIO); if (!gates.length) setup = { dir: 'bear', ty: 'put', entry: resA.strike, target: tgtBl.strike }; } }
    if (!setup) { process.stdout.write('.'); continue; }
    // direction (Skylit aggregate_score)
    const ag = await mcp('aggregate_score', { ticker: tk, date: monDate, timeframes: '1d,7d' }); await sleep(180);
    const comp = ag?.data?.byTimeframe?.['1d']?.composite ?? 0;
    const dirAgree = setup.dir === 'bull' ? comp >= 0 : comp <= 0;
    // entry: retest of entry node within the week
    let eI = -1; for (const i of idxs) { if (setup.dir === 'bull' ? bars[i].l <= setup.entry : bars[i].h >= setup.entry) { eI = i; break; } }
    if (eI < 0) { rows.push({ tk, wk, ...setup, reg, comp, dirAgree, triggered: false }); process.stdout.write('_'); continue; }
    const a = atr[eI] || (bars[eI].c * 0.03);
    const stop = setup.dir === 'bull' ? setup.entry - ATR_MULT * a : setup.entry + ATR_MULT * a;
    // exit within week
    let xI = -1, res = 'eod'; const endI = idxs[idxs.length - 1];
    for (let j = eI; j <= endI; j++) { if (setup.dir === 'bull') { if (bars[j].h >= setup.target) { xI = j; res = 'win'; break; } if (bars[j].c <= stop) { xI = j; res = 'loss'; break; } } else { if (bars[j].l <= setup.target) { xI = j; res = 'win'; break; } if (bars[j].c >= stop) { xI = j; res = 'loss'; break; } } }
    if (xI < 0) { xI = endI; res = 'eod'; }
    // real option fills
    const refPx = bars[eI].c, step = stepOf(refPx); let K = Math.round(refPx / step) * step;
    let hist = null;
    for (const dk of [0, step, -step, 2 * step]) { const sym = occ(tk, exp, setup.ty, K + dk); const h = await mcp('contract_history', { symbol: sym, start_date: bars[eI].d, end_date: bars[xI].d }); await sleep(160); if (Array.isArray(h?.data) && h.data.length) { hist = h.data; K = K + dk; break; } }
    if (!hist) { rows.push({ tk, wk, ...setup, reg, comp, dirAgree, triggered: true, res, fill: false }); process.stdout.write('c'); continue; }
    const row = (d) => hist.find((r) => r.date === d) || hist.reduce((best, r) => Math.abs(new Date(r.date) - new Date(d)) < Math.abs(new Date(best.date) - new Date(d)) ? r : best);
    const eRow = row(bars[eI].d), xRow = row(bars[xI].d);
    const eP = +eRow.vwap || +eRow.lastPrice, xP = +xRow.vwap || +xRow.lastPrice;
    if (!(eP > 0.02)) { process.stdout.write('c'); continue; }
    const cost = eP * (1 + SLIP), proc = Math.max(0, xP) * (1 - SLIP), pnl = (proc - cost) / cost;
    rows.push({ tk, wk, ...setup, reg, comp, dirAgree, triggered: true, res, fill: true, K, eP, xP, pnl, holdD: xI - eI });
    process.stdout.write(res === 'win' ? '#' : res === 'loss' ? '-' : 'o');
  }
}
fs.writeFileSync('/private/tmp/claude-501/-Users-saiyeeshrathish-the-final-plan/a5088226-4255-42ad-8c1a-63d53449d7a5/scratchpad/weekly_rows.json', JSON.stringify(rows, null, 1));

const traded = rows.filter((x) => x.fill);
const agg = (f) => { const r = traded.filter(f); if (!r.length) return 'n=0'; const wr = r.filter((x) => x.pnl > 0).length / r.length * 100; const avg = r.reduce((a, x) => a + x.pnl, 0) / r.length * 100; return `n=${String(r.length).padStart(3)}  win ${wr.toFixed(0).padStart(2)}%  avg ${(avg>=0?'+':'')}${avg.toFixed(1)}%/trade`; };
console.log('\n\n===== WEEKLY OPTIONS — REAL contract_history FILLS (12 names, ~16wk, 3% slip) =====');
console.log(`setups: ${rows.length}  triggered: ${rows.filter(x=>x.triggered).length}  filled trades: ${traded.length}`);
console.log(`result mix: win ${traded.filter(x=>x.res==='win').length} / loss ${traded.filter(x=>x.res==='loss').length} / eod ${traded.filter(x=>x.res==='eod').length}`);
console.log('\nALL filled            ', agg(() => true));
console.log('DIR-AGREE (aggregate) ', agg((x) => x.dirAgree));
console.log('DIR-DISAGREE          ', agg((x) => !x.dirAgree));
console.log('\navg hold (days):', (traded.reduce((a, x) => a + x.holdD, 0) / traded.length).toFixed(1));
console.log('\n$1000 compounded (dir-agree only), fixed-fraction:');
const da = traded.filter((x) => x.dirAgree).sort((a, b) => a.wk < b.wk ? -1 : 1);
for (const f of [0.05, 0.10, 0.20]) { let bank = 1000, peak = 1000, dd = 0; for (const t of da) { bank *= (1 + f * t.pnl); peak = Math.max(peak, bank); dd = Math.max(dd, (peak - bank) / peak); } console.log(`  f=${(f*100).toFixed(0)}%: $1000 -> $${bank.toLocaleString(undefined,{maximumFractionDigits:0})} (maxDD ${(dd*100).toFixed(0)}%)`); }
const acc = await rest('api', '/v1/account'); console.log('\ncredits left:', acc?.data?.creditsBalance, '| rateLimitRemaining seen:', rlRemain);
