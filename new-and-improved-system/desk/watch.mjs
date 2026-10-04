#!/usr/bin/env node
// STEP 2b — the session watcher. Never sends orders; Mac notifications + journal only.
//   09:35  re-verify today's A+ cards on the LIVE map (levels move — the backtest used the 09:35 map) → drop/refresh plans
//   09:35–15:30  1-min bars from UW (no Skylit credits): SKIP if the day slid into the level, else alert on the retest that holds
//   open positions from earlier sessions: alert on TARGET / T2 / breakeven touch and on the daily-close stop at 15:55
//   node desk/watch.mjs [--date YYYY-MM-DD] [--poll 60]          (skips cards you marked "pass")
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { verify } from './verify.mjs';
import { sessionDate } from './common.mjs';
import { retestHolds, slidIn } from '../system/aplus.js';
import { UW_API_KEY } from '../feeds/env.js';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : d; };
const D = opt('date', sessionDate()), POLL = +opt('poll', 60) * 1000;
const J = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), 'journal'), jf = path.join(J, `${D}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etMin = () => { const n = new Date(Date.now() - 4 * 3600e3); return n.getUTCHours() * 60 + n.getUTCMinutes(); };
const hm = (t) => new Date((t - 4 * 3600) * 1000).toISOString().slice(11, 16);
const say = (msg) => { console.log(`${new Date().toISOString().slice(11, 19)}Z ${msg}`); execFile('osascript', ['-e', `display notification ${JSON.stringify(msg)} with title "Desk"`], () => {}); };
async function bars1m(sym) {
  const r = await fetch(`https://api.unusualwhales.com/api/stock/${sym}/ohlc/1m?date=${D}&limit=1000`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
  const j = r?.ok ? await r.json().catch(() => null) : null;
  return (j?.data ?? []).filter((b) => b.market_time === 'r').map((b) => ({ t: Math.floor(Date.parse(b.start_time) / 1000), o: +b.open, h: +b.high, l: +b.low, c: +b.close })).sort((a, b) => a.t - b.t);
}
const save = (doc) => fs.writeFileSync(jf, JSON.stringify(doc, null, 1));

if (!fs.existsSync(jf)) { console.error(`no desk journal for ${D} — run: node desk/run.mjs …`); process.exit(1); }
const doc = JSON.parse(fs.readFileSync(jf, 'utf8'));
// open positions carried from earlier sessions (triggered, not exited, hold window still running)
const carried = fs.readdirSync(J).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f) && f < `${D}.json`).flatMap((f) => {
  const d = JSON.parse(fs.readFileSync(path.join(J, f), 'utf8')); return d.cards.filter((c) => c.trigger && !c.exited && c.plan.holdEnd >= D).map((c) => ({ c, file: f, doc: d }));
});
while (etMin() < 9 * 60 + 35) await sleep(20_000);

// 1) re-verify on the live 09:35 map
const live = doc.cards.filter((c) => c.status === 'A+' && c.decision !== 'pass');
if (live.length) {
  const fresh = await verify(live.map((c) => ({ sym: c.sym, dirs: [c.dir], why: c.find, feat: null })), { D, contracts: true });
  for (const c of live) {
    const f = fresh.find((x) => x.sym === c.sym && x.dir === c.dir);
    if (f?.status === 'A+') { c.plan = f.plan; c.contract = f.contract ?? c.contract; c.reverified = '09:35'; }
    else { c.status = 'DROPPED 09:35'; c.reason = f?.reason ?? 'no map'; say(`${c.sym}: dropped at 09:35 — ${c.reason}`); }
  }
  save(doc);
}
const watch = doc.cards.filter((c) => c.status === 'A+' && c.decision !== 'pass' && !c.trigger);
say(`watching ${watch.length} setup(s): ${watch.map((c) => `${c.sym} ${c.dir === 'up' ? 'C' : 'P'}@${c.plan.entry}`).join(', ') || 'none'} · ${carried.length} open from earlier`);

// 2) poll
while (etMin() <= 16 * 60) {
  for (const c of watch.filter((x) => !x.trigger && !x.skipped)) {
    const bs = await bars1m(c.sym); if (!bs.length) continue;
    const a = { dir: c.dir, entry: c.plan.entry }, atr = c.atr ?? 0, zone = c.plan.zone ?? c.spot * 0.0015;
    if (slidIn(a, bs[0].o, atr)) { c.skipped = `slide-in: opened ${bs[0].o} vs level ${c.plan.entry}`; say(`${c.sym} SKIP — ${c.skipped}`); save(doc); continue; }
    for (let bi = 0; bi < bs.length; bi++) {
      if (hm(bs[bi].t) < '09:35' || hm(bs[bi].t) > '15:30') continue;
      if (retestHolds(a, bs, bi, zone)) { c.trigger = { t: bs[bi].t, at: hm(bs[bi].t), px: bs[bi].c };
        say(`ENTRY ${c.sym} ${c.dir === 'up' ? 'CALL' : 'PUT'} — retest held at ${c.plan.entry} (${c.trigger.at}, ${bs[bi].c}) · ${c.contract?.occ ?? ''} mid $${c.contract?.mid ?? '?'} · target ${c.plan.target} · close-stop ${c.plan.stopClose}`); save(doc); break; }
    }
  }
  const openNow = [...carried, ...doc.cards.filter((c) => c.trigger && !c.exited).map((c) => ({ c, doc, file: `${D}.json` }))];
  for (const { c, doc: d, file } of openNow) {
    const bs = (await bars1m(c.sym)).filter((b) => b.t > (c.lastSeen ?? c.trigger.t)); if (!bs.length) continue;
    const up = c.dir === 'up', hit = (lvl) => bs.some((b) => (up ? b.h >= lvl : b.l <= lvl));
    if (!c.half && hit(c.plan.target)) { c.half = true; say(`${c.sym} TARGET ${c.plan.target} hit — take half, stop → entry ${c.plan.entry}`); }
    if (c.half && c.plan.t2 && hit(c.plan.t2)) { c.exited = 'T2'; say(`${c.sym} T2 ${c.plan.t2} hit — exit the rest`); }
    else if (c.half && bs.some((b) => (up ? b.l <= c.plan.entry - (c.plan.zone ?? 0) : b.h >= c.plan.entry + (c.plan.zone ?? 0)))) { c.exited = 'breakeven'; say(`${c.sym} back to entry ${c.plan.entry} — exit the rest (breakeven)`); }
    c.lastSeen = bs.at(-1).t;
    if (!c.exited && etMin() >= 15 * 60 + 55) {
      const last = bs.at(-1).c;
      if (!c.half && (up ? last < c.plan.stopClose : last > c.plan.stopClose)) { c.exited = 'stop(close)'; say(`${c.sym} closing ${up ? 'below' : 'above'} ${c.plan.stopClose} — daily-close stop: exit`); }
      else if (D >= c.plan.holdEnd) { c.exited = 'time'; say(`${c.sym} hold window ends today — exit at the close`); }
    }
    fs.writeFileSync(path.join(J, file), JSON.stringify(d, null, 1));
  }
  save(doc);
  if (etMin() >= 16 * 60) break;
  await sleep(POLL);
}
say('session over — run node desk/score.mjs after the close');
