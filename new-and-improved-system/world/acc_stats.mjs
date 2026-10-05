#!/usr/bin/env node
// v4 helper: per 13F filing (manager × period), the FULL long-equity portfolio size — count of share positions (puts excluded) and
// total value, across ALL holdings (not just the priced universe). Same filing rules as graph13f.mjs. → .cache/sec_bulk/acc_stats.json
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), B = path.join(ROOT, '.cache', 'sec_bulk');
const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const iso = (s) => { const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(s ?? ''); return m ? `${m[3]}-${MON[m[2]]}-${m[1]}` : null; };
async function* tsv(zip, file) { // wildcard member name: some SEC zips nest the TSVs in a subfolder
  const p = spawn('unzip', ['-p', zip, `*${file}`]); const rl = readline.createInterface({ input: p.stdout, crlfDelay: Infinity }); let head = null;
  for await (const line of rl) { const c = line.split('\t'); if (!head) { head = Object.fromEntries(c.map((h, i) => [h, i])); continue; } yield { c, h: head }; }
}
const out = new Map(); // `${m}|${p}` → {m, p, f, n, v}
for (const z of fs.readdirSync(path.join(B, '13f')).filter((f) => f.endsWith('.zip')).map((f) => path.join(B, '13f', f))) {
  const sub = new Map(); for await (const { c, h } of tsv(z, 'SUBMISSION.tsv')) sub.set(c[h.ACCESSION_NUMBER], { f: iso(c[h.FILING_DATE]), p: iso(c[h.PERIODOFREPORT]), m: c[h.CIK], type: c[h.SUBMISSIONTYPE] });
  for await (const { c, h } of tsv(z, 'COVERPAGE.tsv')) { const a = sub.get(c[h.ACCESSION_NUMBER]); if (a) a.amendType = c[h.AMENDMENTTYPE]; }
  const keep = new Map([...sub].filter(([, v]) => v.f && (v.type === '13F-HR' || (v.type === '13F-HR/A' && /NEW HOLDINGS/i.test(v.amendType ?? ''))))), seen = new Map();
  for await (const { c, h } of tsv(z, 'INFOTABLE.tsv')) { const a = keep.get(c[h.ACCESSION_NUMBER]); if (!a) continue; if ((c[h.PUTCALL] ?? '').toUpperCase() === 'PUT' || c[h.SSHPRNAMTTYPE] !== 'SH') continue;
    const k = `${a.m}|${a.p}`; let o = out.get(k); if (!o) out.set(k, (o = { m: a.m, p: a.p, f: a.f, n: 0, v: 0 })); if (a.f < o.f) o.f = a.f;
    const ck = `${k}|${c[h.CUSIP]}`; if (!seen.has(ck)) { seen.set(ck, 1); o.n++; } o.v += +c[h.VALUE] || 0; }
  console.error(`${path.basename(z)} · filings ${out.size}`);
}
fs.writeFileSync(path.join(B, 'acc_stats.json'), JSON.stringify([...out.values()]));
console.error(`done · ${out.size} manager-periods`);
