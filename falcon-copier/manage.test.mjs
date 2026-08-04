// UNIT-TEST the new manage() logic against concrete scenarios (esp. the 7/30 failures).
// We can't re-run the LLM over full-day frames (rolling window gone), so we test the EXECUTION layer directly:
// given a sequence of (decision, price) does it hold winners, take profit at target, stop out, gate counter-trend, flatten EOD?
const ENTRY_BAR=0.5, COUNTER_TREND_BAR=0.7, EXIT_BAR=0.6, NO_NEW_ET='15:45', FLATTEN_ET='15:55', MAX_OPT_LOSS_PCT=-50;
// replicate manage() close+open (no optMark — premiums null in test; we assert on entries/exits/why)
function closeOpen(b,px,et,why){const o=b.open,sgn=o.dir==='long'?1:-1;b.closed.push({...o,exitET:et,exitPx:px,pnl:+((px-o.entryPx)*sgn).toFixed(1),why});b.open=null;}
function manage(b,dec,px,et,trend,optPct){
  if(b.open){const o=b.open,long=o.dir==='long';
    const s=dec.stop_level,t=dec.target_level;   // TRAIL: ratchet the stop protectively, follow the target
    if(s!=null&&(long?s<px:s>px)&&(o.stop_level==null||(long?s>o.stop_level:s<o.stop_level)))o.stop_level=s;
    if(t!=null&&(long?t>px:t<px))o.target_level=t;
    let why=null,reverse=false;
    if(o.stop_level!=null&&(long?px<=o.stop_level:px>=o.stop_level))why='stop hit';
    else if(o.target_level!=null&&(long?px>=o.target_level:px<=o.target_level))why='target hit';
    else if(optPct!=null&&optPct<=MAX_OPT_LOSS_PCT)why='premium stop';   // theta safety net
    else if(et>=FLATTEN_ET)why='EOD flatten';
    else{const wantsOut=dec.direction==='stand_aside'||(dec.direction&&dec.direction!==o.dir);if(wantsOut&&(dec.conviction??0)>=EXIT_BAR){why=dec.direction==='stand_aside'?'exit — thesis invalidated':'reversed (high conviction)';reverse=dec.direction!=='stand_aside';}}
    if(!why)return 'HOLD';
    closeOpen(b,px,et,why);
    if(!reverse)return why;}
  if(!b.open&&dec.direction&&dec.direction!=='stand_aside'&&et<NO_NEW_ET){
    const counter=(trend==='up'&&dec.direction==='short')||(trend==='down'&&dec.direction==='long');
    const wantPullback=dec.entry_type==='pullback'&&dec.entry_level!=null;
    const reached=!wantPullback||(dec.direction==='long'?px<=dec.entry_level:px>=dec.entry_level);
    if((dec.conviction??0)>=ENTRY_BAR&&reached){
      const initStop=(dec.stop_level!=null&&(dec.direction==='long'?dec.stop_level<px:dec.stop_level>px))?dec.stop_level:null;
      const initTarget=(dec.target_level!=null&&(dec.direction==='long'?dec.target_level>px:dec.target_level<px))?dec.target_level:null;
      b.open={dir:dec.direction,entryET:et,entryPx:px,target_level:initTarget,stop_level:initStop,counter_trend:counter};return 'OPEN '+dec.direction+(counter?' [counter-flagged]':'');}
    if((dec.conviction??0)>=ENTRY_BAR&&!reached)return 'WAIT (pullback to '+dec.entry_level+')';
    return 'skip (conv<0.5)';}
  return 'flat';}

let pass=0,fail=0;const chk=(name,got,want)=>{const ok=got===want;console.log(`  ${ok?'✓':'✗ FAIL'} ${name}: ${got}${ok?'':'  (wanted '+want+')'}`);ok?pass++:fail++;};

console.log('── SCENARIO A: the 7385C — open long, target 7400, price wobbles to 7373 (old bug: dumped it), then rips to 7400 ──');
let b={open:null,closed:[]};
chk('open long @7385 conv.55 tgt7400 stop7376', manage(b,{direction:'long',conviction:.55,target_level:7400,stop_level:7376},7385,'11:06','up'), 'OPEN long');
chk('11:12 agent gets nervous (stand_aside conv.3) @7378', manage(b,{direction:'stand_aside',conviction:.3},7378,'11:12','up'), 'HOLD');   // MUST hold (noise, not invalidated)
chk('11:15 dips to 7373 (above stop 7376? no, 7373<7376 → STOP)', manage(b,{direction:'long',conviction:.4},7373,'11:15','up'), 'stop hit');
console.log('  (7373 breached the 7376 stop → clean stop-out, NOT a random dump. If stop were 7370 it would have held.)');

console.log('\n── SCENARIO A2: same but stop 7370 (survives the dip), then hits 7400 target ──');
b={open:null,closed:[]};
manage(b,{direction:'long',conviction:.55,target_level:7400,stop_level:7370},7385,'11:06','up');
chk('11:12 nervous stand_aside @7378', manage(b,{direction:'stand_aside',conviction:.3},7378,'11:12','up'), 'HOLD');
chk('11:15 dip 7373 (above 7370 stop)', manage(b,{direction:'long',conviction:.4},7373,'11:15','up'), 'HOLD');
chk('later rips to 7401 → TAKE PROFIT at target', manage(b,{direction:'long',conviction:.5},7401,'13:00','up'), 'target hit');
chk('booked 1 trade', b.closed.length, 1);

console.log('\n── SCENARIO B: counter-trend is NOT hard-blocked (de-overfit / agentic) — opens at the normal bar but is FLAGGED for the diary; trend-caution lives in the agent conviction (doctrine) + the stop ──');
b={open:null,closed:[]};
chk('7370P short conv.55 on up-trend OPENS (no mechanical gate)', manage(b,{direction:'short',conviction:.55,target_level:7360,stop_level:7395},7372,'11:30','up'), 'OPEN short [counter-flagged]');
chk('counter_trend flag recorded for the diary to grade', b.open.counter_trend, true);
chk('a weak fade (conv.4) still fails the normal decisive-entry bar', (()=>{let b2={open:null,closed:[]};return manage(b2,{direction:'short',conviction:.4,target_level:7360,stop_level:7395},7372,'11:30','up');})(), 'skip (conv<0.5)');

console.log('\n── SCENARIO C: HOLD through noise — no churn ──');
b={open:null,closed:[]};
manage(b,{direction:'long',conviction:.6,target_level:7430,stop_level:7400},7413,'12:52','up');
let held=0;for(const [px,et] of [[7415,'13:00'],[7410,'13:10'],[7418,'13:20'],[7409,'13:30']]) if(manage(b,{direction:'stand_aside',conviction:.35},px,et,'up')==='HOLD')held++;
chk('held through 4 noisy wobbles (no churn)', held, 4);
chk('still 0 closed', b.closed.length, 0);

console.log('\n── SCENARIO D: EOD force-flatten ──');
b={open:null,closed:[]};manage(b,{direction:'long',conviction:.6,target_level:7500,stop_level:7400},7440,'15:30','up');
chk('no NEW entry after 15:45', (()=>{let b2={open:null,closed:[]};return manage(b2,{direction:'long',conviction:.9,target_level:7500,stop_level:7400},7440,'15:50','up');})(), 'flat');
chk('open position force-flattened at 15:55', manage(b,{direction:'long',conviction:.6},7445,'15:56','up'), 'EOD flatten');
chk('flat after EOD', b.open, null);

console.log('\n── SCENARIO E: legit reversal (high-conviction) DOES flip ──');
b={open:null,closed:[]};manage(b,{direction:'long',conviction:.6,target_level:7430,stop_level:7400},7415,'12:00','chop');
chk('reverse long→short conv.7 (chop, so allowed)', manage(b,{direction:'short',conviction:.7,target_level:7395,stop_level:7422},7412,'12:10','chop'), 'OPEN short (counter!)'.replace(' (counter!)',''));
chk('closed the long + opened short', b.closed.length===1&&b.open?.dir==='short', true);

console.log('\n── SCENARIO F: TRAILING STOP (long) — ratchet up, loosen blocked, trailed-above-entry FIRES ──');
b={open:null,closed:[]};
manage(b,{direction:'long',conviction:.6,target_level:7620,stop_level:7580},7585,'11:00','up');
chk('initial stop 7580', b.open.stop_level, 7580);
manage(b,{direction:'long',conviction:.6,target_level:7620,stop_level:7595},7600,'11:10','up');
chk('stop RAISED to 7595 (above entry 7585)', b.open.stop_level, 7595);
manage(b,{direction:'long',conviction:.6,target_level:7620,stop_level:7588},7605,'11:15','up');
chk('loosen to 7588 BLOCKED — stays 7595', b.open.stop_level, 7595);
chk('pullback to 7595 STOPS OUT at protected level (old code never fired above entry)', manage(b,{direction:'long',conviction:.5},7595,'11:20','up'), 'stop hit');
chk('booked at trailed 7595, not entry-stop 7580', b.closed[b.closed.length-1].exitPx, 7595);

console.log('\n── SCENARIO G: TRAILING (bearish/long-put) — stop ratchets DOWN, loosen-up blocked ──');
b={open:null,closed:[]};
manage(b,{direction:'short',conviction:.7,target_level:7550,stop_level:7620},7600,'11:00','chop');
chk('initial short stop 7620', b.open.stop_level, 7620);
manage(b,{direction:'short',conviction:.7,target_level:7550,stop_level:7605},7590,'11:10','chop');
chk('short stop LOWERED to 7605 (ratchet down)', b.open.stop_level, 7605);
chk('loosen up to 7615 BLOCKED', (()=>{manage(b,{direction:'short',conviction:.7,target_level:7550,stop_level:7615},7585,'11:15','chop');return b.open.stop_level;})(), 7605);

console.log('\n── SCENARIO H: PREMIUM/THETA STOP — sideways price NEVER hits the stop, but the option bleeds → cut it (the -70% fix) ──');
b={open:null,closed:[]};
manage(b,{direction:'long',conviction:.6,target_level:7620,stop_level:7580},7600,'13:00','up');
chk('holding: price 7601 (above 7580 stop), option -20% → HOLD', manage(b,{direction:'long',conviction:.5},7601,'13:05','up',-20), 'HOLD');
chk('price STILL 7601 (stop never hit) but option -55% → PREMIUM STOP fires', manage(b,{direction:'long',conviction:.5},7601,'13:10','up',-55), 'premium stop');

console.log('\n── SCENARIO I: RESTING/PULLBACK ENTRY — waits for the dip, fills at the level; market fills now ──');
b={open:null,closed:[]};
chk('pullback long @7585, price 7592 → WAITS (no chase)', manage(b,{direction:'long',conviction:.6,entry_type:'pullback',entry_level:7585,target_level:7620,stop_level:7580},7592,'11:00','up'), 'WAIT (pullback to 7585)');
chk('still flat while waiting', b.open, null);
chk('price dips to 7584 → FILLS at the deflection', manage(b,{direction:'long',conviction:.6,entry_type:'pullback',entry_level:7585,target_level:7620,stop_level:7580},7584,'11:05','up'), 'OPEN long');
b={open:null,closed:[]};
chk('market entry fills immediately (no wait)', manage(b,{direction:'long',conviction:.6,entry_type:'market',target_level:7620,stop_level:7580},7592,'11:00','up'), 'OPEN long');

console.log('\n── SCENARIO J: FAST/SLOW SPLIT — fast loop fires stop/target off the live price (no LLM), and the mutex stops fast+slow from double-closing ──');
// replica of fastStops() breach decision (agent.mjs) — identical to the slow-loop check, just driven by the 10s spot instead of the 90s tick
function fastCheck(o,spot){if(!o)return null;const long=o.dir==='long';
  if(o.stop_level!=null&&(long?spot<=o.stop_level:spot>=o.stop_level))return 'stop hit (fast)';
  if(o.target_level!=null&&(long?spot>=o.target_level:spot<=o.target_level))return 'target hit (fast)';
  return null;}
// replica of the MUTEX closeOpen (agent.mjs) — _closing set SYNCHRONOUSLY before the await, so a racing caller bails at the guard
async function closeOpenMx(b,px,et,why){if(b._closing||!b.open)return;b._closing=true;
  try{const o=b.open,sgn=o.dir==='long'?1:-1;await Promise.resolve();b.closed.push({...o,exitET:et,exitPx:px,pnl:+((px-o.entryPx)*sgn).toFixed(1),why});b.open=null;}finally{b._closing=false;}}
b={open:null,closed:[]};manage(b,{direction:'long',conviction:.6,target_level:7620,stop_level:7580},7600,'13:00','up');
chk('long: spot 7600 between stop/target → HOLD (no fast exit)', fastCheck(b.open,7600), null);
chk('long: spot ticks to 7579 (< 7580 stop) → FAST stop fires', fastCheck(b.open,7579), 'stop hit (fast)');
chk('long: spot rips to 7621 (> 7620 target) → FAST target fires', fastCheck(b.open,7621), 'target hit (fast)');
let bs={open:null,closed:[]};manage(bs,{direction:'short',conviction:.7,target_level:7550,stop_level:7620},7600,'11:00','chop');
chk('short: spot 7621 (>= 7620 stop) → FAST stop fires', fastCheck(bs.open,7621), 'stop hit (fast)');
chk('short: spot 7549 (<= 7550 target) → FAST target fires', fastCheck(bs.open,7549), 'target hit (fast)');
b={open:null,closed:[]};manage(b,{direction:'long',conviction:.6,target_level:7620,stop_level:7580},7600,'13:00','up');
await Promise.all([closeOpenMx(b,7580,'13:05','stop hit (fast)'),closeOpenMx(b,7580,'13:05','stop hit')]);   // fast + slow both breach at the same instant
chk('MUTEX: concurrent fast+slow close → exactly 1 booked (no double-close)', b.closed.length, 1);
chk('flat after the race', b.open, null);
chk('the trade that won the race booked the fast reason', b.closed[0].why, 'stop hit (fast)');

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
