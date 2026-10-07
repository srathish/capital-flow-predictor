#!/usr/bin/env node
// Every open-market insider PURCHASE (Form 4/5 NONDERIV_TRANS, TRANS_CODE 'P') from the SEC Insider Transactions Data Sets
// (.cache/sec_bulk/f345/*_form345.zip, 2014q1 → latest). Free public data, 0 credits.
//   out  .cache/insider_bulk/purchases.jsonl  {issuerCik, ticker, ownerCik, owner, nOwners, rel, title, tradeDate, filed, period, doc, acc, shares, price, value}
//        .cache/insider_bulk/summary.json     rows / distinct issuers / median $ value / count >= $100k per year (by tradeDate; raw value sums are meaningless — filer typos up to $1e15)
//   Rules: price must be > 0 and shares > 0; ticker = SEC company_tickers.json by issuer CIK (primary listing), else ISSUERTRADINGSYMBOL;
//          joint filings (several reporting owners on one accession) → one row, first listed owner, nOwners = count;
//          amendments / re-filings: a row whose issuer|owner|tradeDate|shares|price was already emitted from ANOTHER accession is dropped
//          (earliest filing kept — quarters run in order); identical lines inside one accession are kept (separate lots).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..');
const F345 = path.join(ROOT, '.cache', 'sec_bulk', 'f345'), OUT = path.join(ROOT, '.cache', 'insider_bulk');
const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const iso = (s) => { const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec((s ?? '').toUpperCase()); return m ? `${m[3]}-${MON[m[2]]}-${m[1]}` : null; };
// wildcard member name: some SEC zips nest the TSVs in a subfolder
async function* tsv(zip, file) {
  const p = spawn('unzip', ['-p', zip, `*${file}`]); const rl = readline.createInterface({ input: p.stdout, crlfDelay: Infinity }); let head = null;
  for await (const line of rl) { const c = line.split('\t'); if (!head) { head = Object.fromEntries(c.map((h, i) => [h, i])); continue; } yield { c, h: head }; }
}
const cikTicker = new Map();
for (const r of Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, '.cache', 'edgar', 'company_tickers.json'), 'utf8'))))
  if (!cikTicker.has(String(r.cik_str))) cikTicker.set(String(r.cik_str), r.ticker.toUpperCase());
const ncik = (s) => String(Number(s || 0));

fs.mkdirSync(OUT, { recursive: true });
const out = fs.createWriteStream(path.join(OUT, 'purchases.jsonl'));
const seen = new Map(); // dedupe key → accession
const years = {}; let dupes = 0, noPrice = 0, total = 0;
const zips = fs.readdirSync(F345).filter((f) => /^\d{4}q\d_form345\.zip$/.test(f)).sort();
for (const zf of zips) {
  const z = path.join(F345, zf), t0 = Date.now();
  const tx = []; // purchases first (small), then join only the accessions we need
  for await (const { c, h } of tsv(z, 'NONDERIV_TRANS.tsv')) {
    if ((c[h.TRANS_CODE] ?? '').trim().toUpperCase() !== 'P') continue;
    const shares = Number(c[h.TRANS_SHARES]), price = Number(c[h.TRANS_PRICEPERSHARE]);
    if (!(price > 0) || !(shares > 0)) { noPrice++; continue; }
    tx.push({ acc: c[h.ACCESSION_NUMBER], tradeDate: iso(c[h.TRANS_DATE]), shares, price });
  }
  const need = new Set(tx.map((t) => t.acc)), sub = new Map(), own = new Map();
  for await (const { c, h } of tsv(z, 'SUBMISSION.tsv')) { const a = c[h.ACCESSION_NUMBER]; if (!need.has(a)) continue;
    sub.set(a, { cik: ncik(c[h.ISSUERCIK]), sym: ((v) => /^(NONE|N\/?A|NA|-+)?$/.test(v) ? '' : v)((c[h.ISSUERTRADINGSYMBOL] ?? '').trim().toUpperCase()), filed: iso(c[h.FILING_DATE]), period: iso(c[h.PERIOD_OF_REPORT]), doc: c[h.DOCUMENT_TYPE] }); }
  for await (const { c, h } of tsv(z, 'REPORTINGOWNER.tsv')) { const a = c[h.ACCESSION_NUMBER]; if (!need.has(a)) continue;
    const o = own.get(a); if (o) { o.n++; continue; }
    own.set(a, { ownerCik: ncik(c[h.RPTOWNERCIK]), owner: (c[h.RPTOWNERNAME] ?? '').trim(), rel: (c[h.RPTOWNER_RELATIONSHIP] ?? '').trim(), title: (c[h.RPTOWNER_TITLE] ?? '').trim() || (c[h.RPTOWNER_TXT] ?? '').trim(), n: 1 }); }
  let n = 0;
  for (const t of tx) {
    const s = sub.get(t.acc), o = own.get(t.acc); if (!s || !o) continue;
    const key = `${s.cik}|${o.ownerCik}|${t.tradeDate}|${t.shares}|${t.price}`, prev = seen.get(key);
    if (prev !== undefined && prev !== t.acc) { dupes++; continue; } seen.set(key, t.acc);
    const row = { issuerCik: s.cik, ticker: cikTicker.get(s.cik) || s.sym || null, ownerCik: o.ownerCik, owner: o.owner, nOwners: o.n, rel: o.rel, title: o.title || o.rel,
      tradeDate: t.tradeDate, filed: s.filed, period: s.period, doc: s.doc, acc: t.acc, shares: t.shares, price: t.price, value: Math.round(t.shares * t.price * 100) / 100 };
    out.write(JSON.stringify(row) + '\n'); n++; total++;
    const y = (t.tradeDate || s.filed || '????').slice(0, 4), Y = (years[y] ??= { rows: 0, issuers: new Set(), vals: [], ge100k: 0 });
    Y.rows++; Y.issuers.add(s.cik); Y.vals.push(row.value); if (row.value >= 1e5) Y.ge100k++;
  }
  console.log(`${zf}: ${n} purchases (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
await new Promise((r) => out.end(r));
const summary = { built: new Date().toISOString(), quarters: zips.map((z) => z.slice(0, 6)), rows: total, droppedDupes: dupes, droppedNoPrice: noPrice,
  byYear: Object.fromEntries(Object.entries(years).sort().map(([y, v]) => [y, { rows: v.rows, issuers: v.issuers.size, medianValueUSD: Math.round(v.vals.sort((a, b) => a - b)[v.vals.length >> 1]), ge100k: v.ge100k }])) };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary.byYear), `\nrows ${total}, dupes dropped ${dupes}, no-price dropped ${noPrice}`);
