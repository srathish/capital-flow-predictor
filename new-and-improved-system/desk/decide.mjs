#!/usr/bin/env node
// STEP 3a — record YOUR call on a card:  node desk/decide.mjs <date> <SYM> take|pass [up|down] [note…]
import fs from 'node:fs';
import path from 'node:path';

const [D, symIn, choice, ...rest] = process.argv.slice(2);
if (!D || !symIn || !['take', 'pass'].includes(choice)) { console.error('usage: node desk/decide.mjs <date> <SYM> take|pass [up|down] [note…]'); process.exit(1); }
const dir = ['up', 'down'].includes(rest[0]) ? rest.shift() : null, note = rest.join(' ') || null, sym = symIn.toUpperCase();
const jf = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), 'journal', `${D}.json`);
if (!fs.existsSync(jf)) { console.error(`no desk journal for ${D}`); process.exit(1); }
const doc = JSON.parse(fs.readFileSync(jf, 'utf8'));
const hits = doc.cards.filter((c) => c.sym === sym && (!dir || c.dir === dir));
if (!hits.length) { console.error(`${sym}${dir ? ' ' + dir : ''} is not on the ${D} desk`); process.exit(1); }
for (const c of hits) c.decision = { choice, note, at: new Date().toISOString() };
fs.writeFileSync(jf, JSON.stringify(doc, null, 1));
console.log(`${D} ${sym}${dir ? ' ' + dir : ''}: ${choice}${note ? ` — ${note}` : ''} (${hits.map((c) => c.status).join(', ')})`);
