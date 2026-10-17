// IREN GEX + VEX per strike × expiration, every expiration in the next ~year, from Skylit's public API (2 credits total).
import fs from 'node:fs';
import { mcp, spend } from '../../feeds/skylit.js';
const out = {};
for (const metric of ['gamma', 'vanna']) out[metric] = await mcp('heat_heatmap', { symbols: 'IREN', metric, layout: 'matrix', max_expirations: 40, max_strikes: 'all' });
fs.writeFileSync(new URL('./iren_board.json', import.meta.url), JSON.stringify(out));
console.log('credits this run', spend.process, '| keys', Object.keys(out.gamma), JSON.stringify(out.gamma).slice(0, 800));
