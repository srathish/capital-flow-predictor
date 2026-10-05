#!/usr/bin/env node
// v3 STEP 1 (DESIGN_v3 §Graph): build the smart-money graph from SEC bulk data (.cache/sec_bulk). Free, 0 Skylit credits.
//   pass 1  stream every 13F INFOTABLE + Form 345 file → graph stats (managers, securities, insiders, issuers, edges) and
//           CUSIP → issuer-name counts; map CUSIPs to the priced world universe by normalized issuer name (unmatched reported)
//   pass 2  extract every 13F long position in mapped stocks → .cache/sec_bulk/positions.jsonl
//           {m: manager CIK, f: filing date, p: period, t: ticker, sh: shares, v: value, call: 0|1}
//   Rules: original 13F-HR filings + "NEW HOLDINGS" amendments (dated by their own filing date); restatements ignored; puts excluded;
//          share amounts only (PRN principal amounts excluded); multiple lines per manager × CUSIP summed.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { worldUniverse } from './collect.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), B = path.join(ROOT, '.cache', 'sec_bulk');
const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const iso = (s) => { const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(s ?? ''); return m ? `${m[3]}-${MON[m[2]]}-${m[1]}` : null; };
// wildcard member name: some SEC zips nest the TSVs in a subfolder (01JUN2025-31AUG2025_form13f/…)
async function* tsv(zip, file) {
  const p = spawn('unzip', ['-p', zip, `*${file}`]); const rl = readline.createInterface({ input: p.stdout, crlfDelay: Infinity }); let head = null;
  for await (const line of rl) { const c = line.split('\t'); if (!head) { head = Object.fromEntries(c.map((h, i) => [h, i])); continue; } yield { c, h: head }; }
}
const norm = (s) => (s ?? '').toUpperCase().replace(/&/g, ' AND ').replace(/[.,'"()]/g, ' ').replace(/\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|HOLDINGS?|HLDGS?|GROUP|GRP|THE|NEW|CL|CLASS|A|B|C|COM|SA|NV|AG|SE|LP|LLC|ADR|SPONSORED|SPON|SHS|ORD|DEL|TECHNOLOGIES|TECHNOLOGY|TECH)\b/g, ' ').replace(/\s+/g, ' ').trim();
const zips13 = fs.readdirSync(path.join(B, '13f')).filter((f) => f.endsWith('.zip')).map((f) => path.join(B, '13f', f));
const zips345 = fs.readdirSync(path.join(B, 'f345')).filter((f) => f.endsWith('.zip')).map((f) => path.join(B, 'f345', f));

// ---- pass 1: graph stats + CUSIP names ----
const managers = new Set(), securities = new Set(), insiders = new Set(), issuers = new Set(), cusipName = new Map(); let holdEdges = 0, insEdges = 0;
const accMeta = new Map(); // accession → {f, p, m, type}
for (const z of zips13) {
  const sub = new Map(); for await (const { c, h } of tsv(z, 'SUBMISSION.tsv')) sub.set(c[h.ACCESSION_NUMBER], { f: iso(c[h.FILING_DATE]), p: iso(c[h.PERIODOFREPORT]), m: c[h.CIK], type: c[h.SUBMISSIONTYPE] });
  for await (const { c, h } of tsv(z, 'COVERPAGE.tsv')) { const a = sub.get(c[h.ACCESSION_NUMBER]); if (!a) continue; a.amend = c[h.ISAMENDMENT] === 'Y'; a.amendType = c[h.AMENDMENTTYPE]; a.name = c[h.FILINGMANAGER_NAME]; }
  for (const [k, v] of sub) { const keep = v.type === '13F-HR' || (v.type === '13F-HR/A' && /NEW HOLDINGS/i.test(v.amendType ?? '')); if (keep && v.f) accMeta.set(k, v); managers.add(v.m); }
  for await (const { c, h } of tsv(z, 'INFOTABLE.tsv')) { const cu = c[h.CUSIP]; securities.add(cu); holdEdges++;
    let m = cusipName.get(cu); if (!m) cusipName.set(cu, (m = new Map())); const nm = c[h.NAMEOFISSUER]; m.set(nm, (m.get(nm) ?? 0) + 1); }
  console.error(`pass1 ${path.basename(z)} · managers ${managers.size} · securities ${securities.size} · holding edges ${holdEdges}`);
}
for (const z of zips345) {
  for await (const { c, h } of tsv(z, 'SUBMISSION.tsv')) issuers.add(c[h.ISSUERCIK]);
  for await (const { c, h } of tsv(z, 'REPORTINGOWNER.tsv')) insiders.add(c[h.RPTOWNERCIK]);
  for await (const { c } of tsv(z, 'NONDERIV_TRANS.tsv')) insEdges++;
  console.error(`pass1 ${path.basename(z)} · insiders ${insiders.size} · issuers ${issuers.size} · insider edges ${insEdges}`);
}
// CUSIP → ticker (world universe, by normalized issuer name)
const U = worldUniverse(), byName = new Map(); for (const u of U) { const n = norm(u.name); if (n && !byName.has(n)) byName.set(n, u.t); }
const cusip2t = new Map(); for (const [cu, names] of cusipName) { const top = [...names.entries()].sort((a, b) => b[1] - a[1])[0][0], n = norm(top); let t = byName.get(n);
  if (!t) for (const [k, v] of byName) if (k.length >= 5 && (n.startsWith(k + ' ') || k.startsWith(n + ' ') || n === k)) { t = v; break; } if (t) cusip2t.set(cu, t); }
const mappedTickers = new Set(cusip2t.values());
const stats = { managers: managers.size, securities: securities.size, insiders: insiders.size, issuers: issuers.size, nodes: managers.size + securities.size + insiders.size + issuers.size,
  holdingEdges: holdEdges, insiderEdges: insEdges, edges: holdEdges + insEdges, mappedCusips: cusip2t.size, universe: U.length, universeMapped: mappedTickers.size };
fs.writeFileSync(path.join(B, 'graph_stats.json'), JSON.stringify(stats, null, 1)); fs.writeFileSync(path.join(B, 'cusip2t.json'), JSON.stringify(Object.fromEntries(cusip2t)));
console.error('GRAPH', JSON.stringify(stats));

// ---- pass 2: positions in mapped stocks ----
const out = fs.createWriteStream(path.join(B, 'positions.jsonl')); let pos = 0;
for (const z of zips13) {
  const agg = new Map();
  for await (const { c, h } of tsv(z, 'INFOTABLE.tsv')) { const a = accMeta.get(c[h.ACCESSION_NUMBER]); if (!a) continue; const t = cusip2t.get(c[h.CUSIP]); if (!t) continue;
    const pc = (c[h.PUTCALL] ?? '').toUpperCase(); if (pc === 'PUT' || c[h.SSHPRNAMTTYPE] !== 'SH') continue;
    const k = `${c[h.ACCESSION_NUMBER]}|${t}|${pc === 'CALL' ? 1 : 0}`; const o = agg.get(k) ?? { m: a.m, f: a.f, p: a.p, t, sh: 0, v: 0, call: pc === 'CALL' ? 1 : 0 }; o.sh += +c[h.SSHPRNAMT] || 0; o.v += +c[h.VALUE] || 0; agg.set(k, o); }
  for (const o of agg.values()) { out.write(JSON.stringify(o) + '\n'); pos++; }
  console.error(`pass2 ${path.basename(z)} · positions so far ${pos}`);
}
out.end(); console.error(`done · ${pos} positions in ${mappedTickers.size} universe stocks`);
