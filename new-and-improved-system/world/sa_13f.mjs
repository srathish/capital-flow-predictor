#!/usr/bin/env node
// Situational Awareness LP (CIK 0002045724) 13F holdings, point-in-time (by FILING date), for the DESIGN v1.1 copy-the-fund baseline.
// Parses each 13F-HR information table from EDGAR (free). Output: .cache/edgar/sa_13f.json [{filed, period, holdings:[{name, cusip, value, shares, putCall, ticker}]}]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache', 'edgar');
const UA = { 'User-Agent': 'research saieagle@gmail.com' }, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u, json = true) => { await sleep(250); const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return json ? r.json() : r.text(); };
const norm = (s) => s.toUpperCase().replace(/[.,]/g, '').replace(/\b(INC|CORP|CORPORATION|LTD|PLC|HOLDINGS?|CO|CLASS [A-Z]|COM|NEW|LIMITED|GROUP|TECHNOLOGIES|TECHNOLOGY)\b/g, '').replace(/\s+/g, ' ').trim();
const tick = Object.values(JSON.parse(fs.readFileSync(path.join(C, 'company_tickers.json'), 'utf8'))).map((v) => ({ t: v.ticker, n: norm(v.title) }));
const toTicker = (name) => { const n = norm(name); return tick.find((x) => x.n === n)?.t ?? tick.find((x) => x.n.startsWith(n) || n.startsWith(x.n))?.t ?? null; };

const sub = await get('https://data.sec.gov/submissions/CIK0002045724.json'), R = sub.filings.recent, out = [];
for (let i = 0; i < R.form.length; i++) {
  if (R.form[i] !== '13F-HR') continue;
  const acc = R.accessionNumber[i].replace(/-/g, ''), base = `https://www.sec.gov/Archives/edgar/data/2045724/${acc}`;
  const idx = await get(`${base}/index.json`); const f = idx.directory.item.map((x) => x.name).find((n) => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
  if (!f) continue; const xml = await get(`${base}/${f}`, false);
  const H = [...xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/g)].map((m) => { const g = (t) => (m[1].match(new RegExp(`<(?:\\w+:)?${t}>([^<]*)<`)) ?? [])[1] ?? null;
    return { name: g('nameOfIssuer'), cusip: g('cusip'), value: +g('value'), shares: +g('sshPrnamt'), putCall: g('putCall'), ticker: toTicker(g('nameOfIssuer') ?? '') }; });
  out.push({ filed: R.filingDate[i], period: R.reportDate[i], holdings: H });
}
out.sort((a, b) => a.filed.localeCompare(b.filed));
fs.writeFileSync(path.join(C, 'sa_13f.json'), JSON.stringify(out, null, 1));
for (const q of out) { const longs = q.holdings.filter((h) => !h.putCall).sort((a, b) => b.value - a.value), tot = longs.reduce((a, h) => a + h.value, 0);
  console.log(`${q.filed} (period ${q.period}) · ${q.holdings.length} lines · long ${longs.length}, puts/calls ${q.holdings.length - longs.length}\n  top: ${longs.slice(0, 12).map((h) => `${h.ticker ?? '?' + h.name.slice(0, 12)} ${(h.value / tot * 100).toFixed(0)}%`).join(' · ')}`); }
