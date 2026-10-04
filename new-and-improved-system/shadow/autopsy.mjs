#!/usr/bin/env node
// Trade autopsy for A+ walk journals: HOW did each trade win or die? (minute bars only, cached → 0 credits)
//   MFE before exit (best move toward target, in R) · how far price closed through the level · did the target get hit LATER
//   in the hold window anyway (stop too tight vs wrong idea) · entry minute · gap into the level.
//   node shadow/autopsy.mjs AMD GOOGL ORCL PLTR MSFT
import fs from 'node:fs';
import path from 'node:path';
import { minuteBars } from './cache.js';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname);
const syms = process.argv.slice(2).length ? process.argv.slice(2) : ['AMD', 'GOOGL', 'ORCL', 'PLTR', 'MSFT'];
const hm = (t) => new Date((t - 4 * 3600) * 1000).toISOString().slice(11, 16);
const rows = [];
for (const s of syms) {
  const f = path.join(HERE, 'journal', `aplus_walk.${s}.2026-04-01_2026-10-02.json`); if (!fs.existsSync(f)) continue;
  const { trades } = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const t of trades) {
    const dir = t.dir === 'up' ? 1 : -1, risk = Math.abs(t.entry - t.stop);
    const days = fs.readdirSync(path.join(HERE, '..', '.cache', 'bars')).filter((d) => d >= t.D).sort().slice(0, 10);
    const entT = Date.parse(`${t.D}T${t.et}:00-04:00`) / 1000;
    let mfe = 0, mae = 0, hitT = null, hitStop = null, firstClose = null, closes = [];
    for (const d of days) {
      const bs = (await minuteBars(s, d)).filter((b) => b.t >= entT); if (!bs.length) continue;
      for (const b of bs) {
        const fav = dir > 0 ? b.h - t.entry : t.entry - b.l, adv = dir > 0 ? t.entry - b.l : b.h - t.entry;
        if (!hitStop) mfe = Math.max(mfe, fav / risk);
        mae = Math.max(mae, adv / risk);
        if (!hitT && fav >= Math.abs(t.target - t.entry)) hitT = d;
        if (!hitStop && adv > risk) hitStop = `${d.slice(5)} ${hm(b.t)}`;
      }
      const c = bs.at(-1).c; closes.push(+(dir * (c - t.entry) / risk).toFixed(1)); if (firstClose == null) firstClose = closes[0];
    }
    const bars0 = await minuteBars(s, t.D), open = bars0[0]?.o;
    rows.push({ s, D: t.D, et: t.et, side: dir > 0 ? 'CALL' : 'PUT', entry: t.entry, risk, ret: t.ret, win: t.ret > 0,
      gapToLevel: open ? +((dir * (open - t.entry)) / risk).toFixed(1) : null, mfe: +mfe.toFixed(1), firstStopTouch: hitStop, day1CloseR: firstClose,
      targetLater: hitT, closesR: closes.slice(0, 6).join(' '), exits: t.exits });
  }
}
console.log('R = distance in units of the 1-strike stop. gap = where the day OPENED vs the level (+ = on the right side).');
console.log('MFE = best move toward target before the stop was touched. targetLater = target reached at ANY point in the 10-day window.\n');
for (const r of rows.sort((a, b) => a.win - b.win)) console.log(`${r.win ? 'WIN ' : 'LOSS'} ${r.s.padEnd(5)} ${r.D} ${r.et} ${r.side} @${r.entry} risk $${r.risk}  ret ${r.ret == null ? '  ?' : String(Math.round(r.ret * 100)).padStart(4) + '%'} | open ${String(r.gapToLevel).padStart(5)}R  MFE ${String(r.mfe).padStart(4)}R  stop touched ${r.firstStopTouch ?? '-'}  | daily closes (R): ${r.closesR}  | target later: ${r.targetLater ?? 'never'}`);
const L = rows.filter((r) => !r.win), W = rows.filter((r) => r.win);
const avg = (a, k) => (a.reduce((x, r) => x + (r[k] ?? 0), 0) / a.length).toFixed(2);
console.log(`\nlosers ${L.length}: avg MFE ${avg(L, 'mfe')}R · stop touched within 30 min of entry: ${L.filter((r) => r.firstStopTouch && r.firstStopTouch.startsWith(r.D.slice(5)) && (Date.parse(`${r.D}T${r.firstStopTouch.slice(6)}:00Z`) - Date.parse(`${r.D}T${r.et}:00Z`)) / 60000 <= 30).length} · target hit later anyway: ${L.filter((r) => r.targetLater).length}`);
console.log(`winners ${W.length}: avg MFE ${avg(W, 'mfe')}R`);
fs.writeFileSync(path.join(HERE, 'journal', 'autopsy.json'), JSON.stringify(rows, null, 1));
