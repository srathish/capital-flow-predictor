// LEARNING LOOP — the disciplined after-close review. Reads the cumulative forward ledger (falcon_ledger.jsonl,
// written by autotrade) and appends a dated analysis block to REVIEW.md. It PROPOSES watchlist hypotheses; it
// NEVER changes the engine. Anti-over-correct by construction: it will not even consider a change until the
// sample gate clears (≥20 trades AND ≥10 trading days), every stat is CUMULATIVE (full ledger, not the last
// day), and the default recommendation is always NO CHANGE. Auto-spawned by autotrade at day-done; also runnable
// by hand: `node falcon-copier/review.mjs`.
import fs from 'node:fs'; import path from 'node:path';
const D = path.join(process.cwd(), 'falcon-copier');
const LED = path.join(D, 'falcon_ledger.jsonl'), REV = path.join(D, 'REVIEW.md');
const CRITERIA = ['at-node', 'strong', 'vanna', 'king-mig', 'flow', 'pivot-side', 'dp-ext'];
const MIN_TRADES = 20, MIN_DAYS = 10;                                        // the sample gate — no change is even CONSIDERED below this
const pct = (a, b) => b ? (100 * a / b).toFixed(0) + '%' : '—';
const mean = (xs) => xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : 0;
const f1 = (x) => (x >= 0 ? '+' : '') + x.toFixed(1);

const recs = fs.existsSync(LED) ? fs.readFileSync(LED, 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
// dedupe (a re-run must not double-count): key on day+sym+entryET
const seen = new Set(), R = [];
for (const r of recs) { const k = `${r.day}|${r.sym}|${r.entryET}`; if (!seen.has(k)) { seen.add(k); R.push(r); } }

// (re)write the discipline header once
const HEADER = `# Falcon-copier — LEARNING LOOP (review log)
Auto-appended after each close by \`review.mjs\` (spawned by autotrade at day-done). It reads the cumulative
forward ledger and PROPOSES; it never edits the engine.

## Discipline — the anti-over-correct rules (read before touching anything)
1. **NEVER change the engine on one day.** No change is even considered until **≥${MIN_TRADES} trades AND ≥${MIN_DAYS} trading days.**
2. A change must improve **cumulative** expectancy on the FULL ledger — not fix the most recent day.
3. **Default = NO CHANGE.** The null wins ties; the bar to add/modify/remove a rule is high.
4. **One change at a time.** After adopting one, FREEZE it and judge only on subsequent (unseen) days.
5. **No per-day threshold tuning.** No re-adding previously-culled rules to rescue a bad day (see the 460+ dead experiments).
6. This log only proposes ("watchlist hypotheses"). Live-code changes require explicit approval.

---
`;
if (!fs.existsSync(REV)) fs.writeFileSync(REV, HEADER);

const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
const nowDay = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
let out = `\n## Review — ${nowDay} (generated ${now} ET)\n`;

if (!R.length) {
  out += `- No trades in the ledger yet. Loop is armed; keep the trader running. Default: **NO CHANGE.**\n`;
} else {
  const days = [...new Set(R.map(r => r.day))];
  const rets = R.map(r => +r.ret || 0);
  const wins = R.filter(r => r.ret > 0).length;
  const grp = (key) => { const m = {}; for (const r of R) { const g = key(r); (m[g] ||= []).push(r); } return m; };
  const line = (label, arr) => `${label}: ${arr.length} trades · ${pct(arr.filter(r => r.ret > 0).length, arr.length)} win · exp ${f1(mean(arr.map(r => +r.ret || 0)))}% · Σ${f1(arr.reduce((a, c) => a + (+c.ret || 0), 0))}%`;

  out += `**Cumulative:** ${R.length} trades over ${days.length} day(s) · ${pct(wins, R.length)} win · **expectancy ${f1(mean(rets))}%/trade** · Σ${f1(rets.reduce((a, c) => a + c, 0))}%\n\n`;

  out += `**By kind:**\n`; const byK = grp(r => r.kind || '?'); for (const k of Object.keys(byK).sort()) out += `- ${line(k, byK[k])}\n`;
  out += `\n**By instrument:**\n`; const byI = grp(r => r.sym || '?'); for (const k of Object.keys(byI).sort()) out += `- ${line(k, byI[k])}\n`;
  out += `\n**By confluence level:**\n`; const byC = grp(r => `${r.pass || '?'}/7`); for (const k of Object.keys(byC).sort()) out += `- ${line(k, byC[k])}\n`;

  // per-criterion value: win% / expectancy when the criterion was PRESENT vs ABSENT (cumulative — the honest feature test)
  out += `\n**By criterion (present → vs ← absent):** does each layer actually earn its place?\n`;
  for (const c of CRITERIA) {
    const P = R.filter(r => r.crmap && r.crmap[c] === 1), A = R.filter(r => r.crmap && r.crmap[c] === 0);
    if (!P.length && !A.length) continue;
    out += `- \`${c}\`: present ${pct(P.filter(r => r.ret > 0).length, P.length)} win/exp ${f1(mean(P.map(r => +r.ret || 0)))}% (n=${P.length})  ←→  absent ${pct(A.filter(r => r.ret > 0).length, A.length)} win/exp ${f1(mean(A.map(r => +r.ret || 0)))}% (n=${A.length})\n`;
  }

  // GATE
  const enough = R.length >= MIN_TRADES && days.length >= MIN_DAYS;
  out += `\n**Sample gate:** ${R.length}/${MIN_TRADES} trades · ${days.length}/${MIN_DAYS} days → `;
  if (!enough) {
    out += `**INSUFFICIENT.** No changes considered. Keep trading and logging. Default: **NO CHANGE.**\n`;
  } else {
    out += `**cleared.** Watchlist hypotheses may be surfaced below (still require approval + forward proof before any edit).\n`;
    // surface CANDIDATE observations only — framed as hypotheses, never auto-applied
    const notes = [];
    for (const c of CRITERIA) {
      const P = R.filter(r => r.crmap && r.crmap[c] === 1), A = R.filter(r => r.crmap && r.crmap[c] === 0);
      if (P.length >= 10 && A.length >= 10) {
        const dExp = mean(P.map(r => +r.ret || 0)) - mean(A.map(r => +r.ret || 0));
        if (dExp <= -5) notes.push(`\`${c}\` looks NEGATIVE (present exp ${f1(mean(P.map(r => +r.ret || 0)))}% < absent ${f1(mean(A.map(r => +r.ret || 0)))}%, n≥10 each) — WATCH; do not act until it holds another block of days.`);
        if (dExp >= 8) notes.push(`\`${c}\` looks additive (+${dExp.toFixed(0)}% exp when present) — candidate to weight higher, WATCH only.`);
      }
    }
    const hi = R.filter(r => (r.pass || 0) >= 6), lo = R.filter(r => (r.pass || 0) === 5);
    if (hi.length >= 8 && lo.length >= 8 && mean(hi.map(r => +r.ret || 0)) - mean(lo.map(r => +r.ret || 0)) >= 10) notes.push(`≥6/7 setups outperform exactly-5/7 by ≥10% exp — candidate to RAISE the fire bar to 6. WATCH; one change at a time.`);
    out += notes.length ? notes.map(n => `- 🔬 ${n}`).join('\n') + '\n' : `- No pattern strong or stable enough to flag. Default: **NO CHANGE.**\n`;
  }
}
out += `\n---\n`;
fs.appendFileSync(REV, out);
console.log(out.trim());
