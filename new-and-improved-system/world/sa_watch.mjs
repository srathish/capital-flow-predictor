#!/usr/bin/env node
// Situational Awareness LP 13F watcher: refresh the filings from EDGAR (world/sa_13f.mjs) and show what CHANGED in the latest filing
// vs the previous one — new, increased, trimmed, exited (by value weight). Run around 13F deadlines (≈ Feb 14, May 15, Aug 14, Nov 14).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..');
spawnSync(process.execPath, [path.join(ROOT, 'world', 'sa_13f.mjs')], { stdio: 'ignore' });
const Q = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache', 'edgar', 'sa_13f.json'), 'utf8')); const [prev, cur] = Q.slice(-2);
const book = (q) => { const longs = q.holdings.filter((h) => !h.putCall), tot = longs.reduce((a, h) => a + h.value, 0), m = new Map();
  for (const h of longs) { const k = h.ticker ?? h.name; m.set(k, (m.get(k) ?? 0) + h.value / tot); } return m; };
const a = book(prev), b = book(cur), pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log(`# Situational Awareness LP — 13F filed ${cur.filed} (period ${cur.period}) vs ${prev.filed}\n`);
const rows = [...new Set([...a.keys(), ...b.keys()])].map((k) => ({ k, w0: a.get(k) ?? 0, w1: b.get(k) ?? 0 })).sort((x, y) => y.w1 - x.w1);
for (const [label, f] of [['NEW', (r) => !r.w0 && r.w1], ['INCREASED', (r) => r.w0 && r.w1 > r.w0 * 1.1], ['TRIMMED', (r) => r.w1 && r.w1 < r.w0 * 0.9], ['EXITED', (r) => r.w0 && !r.w1], ['UNCHANGED', (r) => r.w0 && r.w1 && r.w1 <= r.w0 * 1.1 && r.w1 >= r.w0 * 0.9]]) {
  const X = rows.filter(f); if (X.length) console.log(`**${label}:** ${X.map((r) => `${r.k} ${pct(r.w0)} → ${pct(r.w1)}`).join(' · ')}`); }
const puts = cur.holdings.filter((h) => h.putCall); if (puts.length) console.log(`\n**Options lines:** ${puts.map((h) => `${h.ticker ?? h.name} ${h.putCall}`).join(' · ')}`);
console.log('\nReminder: 13F is ~45 days stale (DESIGN staleness study: a copier still got +90% on SA positions in 2025–26, but missed ~38% of the move).');
