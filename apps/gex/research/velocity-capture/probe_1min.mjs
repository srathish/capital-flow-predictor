// Probe: does Skylit's historical endpoint serve DISTINCT 1-min frames? (research only)
import '../../scripts/_env-bootstrap.js';
import { initAuth } from '../../src/heatseeker/auth.js';
import { fetchHistoricalSnapshot } from '../../src/heatseeker/client.js';

await initAuth();
for (const T of ['SPXW','SPY','QQQ']) {
  let prev=null, distinct=0, total=0;
  const rows=[];
  for (let m=0;m<12;m++){
    const ts=`2026-07-14T16:${String(m).padStart(2,'0')}:00.000Z`;
    try{
      const s=await fetchHistoricalSnapshot(T, ts, 3);
      if(!s||s.spot==null){rows.push(`  ${ts.slice(11,16)}  no data`);continue;}
      const fp=s.spot.toFixed(2)+'|'+(s.strikes||[]).slice(0,40).reduce((a,x)=>a+Math.abs(x.gamma||0),0).toFixed(0);
      total++; const isNew=fp!==prev; if(isNew)distinct++;
      rows.push(`  ${ts.slice(11,16)}Z  spot=${s.spot.toFixed(2)}  ${isNew?'DISTINCT':'same'}`);
      prev=fp;
    }catch(e){rows.push(`  ${ts.slice(11,16)}  ERR ${e.message.slice(0,50)}`);}
    await new Promise(r=>setTimeout(r,300));
  }
  console.log(`\n=== ${T} ===`); rows.forEach(r=>console.log(r));
  console.log(`  -> ${distinct}/${total} distinct at 1-min spacing`);
}
