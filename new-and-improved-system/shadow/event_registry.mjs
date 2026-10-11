#!/usr/bin/env node
// Stock event factory registry (shadow/DESIGN_event_factory.md). [id, event definition, mechanism, sign for A5/A20/A60, sign for MV60]
import fs from 'node:fs';
import path from 'node:path';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname);
const E = [
  // SEC filing events (event day = filing date of the 10-Q / 10-K that reports the quarter)
  ['F01', 'quarter revenue growth YoY > 30%', 'strong demand, under-reacted', '+', '+'],
  ['F02', 'revenue growth accelerates by > 10 pts', 'inflection', '+', '+'],
  ['F03', 'gross margin up > 3 pts YoY (and positive a year ago)', 'pricing power', '+', '+'],
  ['F04', 'revenue declines YoY', 'demand loss', '-', '?'],
  ['F05', 'gross margin down > 3 pts YoY', 'pricing pressure', '-', '?'],
  ['F06', 'first profitable quarter after ≥ 4 losing quarters', 'turn to profit', '+', '+'],
  ['F07', 'first positive operating income after ≥ 4 negative', 'operating turn', '+', '+'],
  ['F08', 'record quarterly revenue (above every earlier quarter) with YoY > 15%', 'breakout fundamentals', '+', '+'],
  ['F09', 'backlog (RPO) growth YoY > 30%', 'future revenue', '+', '+'],
  ['F10', 'inventory growth exceeds revenue growth by > 20 pts', 'demand slowing', '-', '?'],
  ['F11', 'annual capex up > 50%', 'over-investment', '-', '?'],
  ['F12', 'share count up > 10% YoY (split-adjusted)', 'dilution', '-', '?'],
  ['F13', 'share count down > 3% YoY', 'buyback', '+', '-'],
  ['F14', 'revenue growth YoY > 30% AND accelerating', 'bottleneck inflection', '+', '+'],
  ['F15', 'net margin down > 5 pts YoY', 'profit squeeze', '-', '?'],
  // insiders (event day = Form 4 filing date)
  ['I01', 'first insider purchase in 12 months', 'insider sees value', '+', '+'],
  ['I02', 'cluster: ≥ 3 different insiders buy within 30 days', 'conviction', '+', '+'],
  ['I03', 'insider purchase > $1M', 'size of conviction', '+', '+'],
  ['I04', 'insider purchase after a 20% drop in 3 months', 'buying the dip', '+', '+'],
  ['I05', 'insider purchase while the stock is above its 200-day average', 'confirmation', '+', '+'],
  // guidance (event day = 8-K date)
  ['G01', 'guidance raise', 'management confidence', '+', '+'],
  ['G02', 'guidance cut', 'bad news drift', '-', '-'],
  ['G03', 'guidance raise while SPY is down over 20 days', 'strength in weakness', '+', '+'],
  ['G04', 'second guidance raise within 12 months', 'repeat raiser', '+', '+'],
  // price / volume (event day = the bar; known at its close)
  ['P01', 'new 52-week closing high', '52-week-high momentum', '+', '+'],
  ['P02', 'new 52-week high after 6 months without one', 'base breakout', '+', '+'],
  ['P03', 'gap up > 5% on > 3× average volume', 'news gap continuation', '+', '+'],
  ['P04', 'gap down > 5% on > 3× average volume', 'news gap continuation down', '-', '?'],
  ['P05', '3-day drop > 15%', 'overreaction (reversal)', '+', '?'],
  ['P06', '50-day average crosses above 200-day average', 'golden cross', '+', '+'],
  ['P07', 'close above 200-day average after ≥ 6 months below', 'trend change', '+', '+'],
  ['P08', 'up day on > 5× average volume', 'accumulation', '+', '+'],
  ['P09', 'new all-time closing high (since 2009 data start)', 'blue sky', '+', '+'],
  ['P10', 'new 52-week closing low', '52-week-low', '-', '?'],
  ['P11', 'one-day rise > 10% (no gap requirement)', 'large up move', '?', '+'],
  ['P12', '20-day return > 30%', 'short-term overextension', '?', '+'],
  // themes / industry
  ['T01', 'first-ever 10-K/10-Q mention of a concept whose members are in the top quartile of 6-month returns', 'joining a hot theme', '+', '+'],
  ['T02', 'industry (SIC3) 3-month return turns positive after ≥ 6 negative months', 'industry turn', '+', '+'],
  // combinations
  ['X01', 'F14 filed within 20 trading days of a new 52-week high', 'fundamentals + price confirm', '+', '+'],
  ['X02', 'insider cluster (I02) while above the 200-day average', 'insiders + trend', '+', '+'],
  ['X03', 'guidance raise (G01) with a gap up > 3% that day', 'raise + market agrees', '+', '+'],
  ['X04', 'gap up > 5% on volume (P03) on a 10-Q/10-K filing day', 'earnings gap (PEAD)', '+', '+'],
];
const H = []; for (const [id, def, mech, s, sm] of E) for (const o of ['A5', 'A20', 'A60', 'MV60']) H.push({ id: `${id}x${o}`, event: id, outcome: o, sign: o === 'MV60' ? sm : s, definition: def, mechanism: mech });
fs.writeFileSync(path.join(SH, 'event_registry.json'), JSON.stringify({ created: '2026-10-11', n: H.length, events: E.length, hypotheses: H }, null, 1));
console.log(`${E.length} events × 4 outcomes → ${H.length} studies`);
