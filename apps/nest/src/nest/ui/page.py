"""The field — a single self-contained page that renders the Nest's event state as a
living instrument panel. render_page(state, poll_url) bakes the state in; when poll_url is
set (live server) the page refreshes itself from it, otherwise it's a static snapshot.

Deliberately single-theme: this is a night-field/observatory, an ember map on near-black.
"""

from __future__ import annotations

import json

_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NEST × FIELD</title>
<style>
  :root{
    --ground:#08090d; --panel:#101219; --panel2:#0b0d13; --line:#1e2230;
    --ink:#e9e7e1; --muted:#7b8194; --dim:#4a4f60;
    --ember1:#ff9d3d; --ember2:#ff5230; --cool:#3b4a6b;
    --bull:#4ec988; --bear:#ff5f6d;
    --flow:#35d0d0; --levels:#9b8cff; --positioning:#ffb454; --filings:#6ec97a;
    --social:#ff77c8; --macro:#ff6b6b; --chart:#5b9dff; --fundamental:#4fd1a1;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{
    background:radial-gradient(1200px 700px at 50% -10%, #12151f 0%, var(--ground) 60%);
    color:var(--ink);
    font:13px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    -webkit-font-smoothing:antialiased;
  }
  .wrap{display:flex;flex-direction:column;min-height:100%;max-width:1400px;margin:0 auto;padding:14px}
  /* header */
  header{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 18px;
    padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--panel);}
  .brand{font-weight:600;letter-spacing:.14em}
  .brand b{background:linear-gradient(90deg,var(--ember1),var(--ember2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .stat{color:var(--muted);letter-spacing:.06em;text-transform:uppercase;font-size:11px}
  .stat b{color:var(--ink);font-variant-numeric:tabular-nums}
  .pill{padding:1px 8px;border:1px solid var(--line);border-radius:999px;font-size:11px}
  .tone-hawkish{color:var(--bear);border-color:#43242b}
  .tone-dovish{color:var(--bull);border-color:#1f3a2c}
  .tone-neutral{color:var(--muted)}
  .adv{margin-left:auto;color:var(--dim);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase}
  /* field */
  .field-wrap{position:relative;margin-top:12px;border:1px solid var(--line);border-radius:12px;
    background:linear-gradient(180deg,#0b0e16,#080a0f);overflow:hidden}
  canvas{display:block;width:100%;height:440px}
  .legend{position:absolute;left:12px;bottom:10px;display:flex;flex-wrap:wrap;gap:4px 12px;font-size:10.5px;color:var(--muted)}
  .legend span{display:inline-flex;align-items:center;gap:5px}
  .dot{width:8px;height:8px;border-radius:50%;box-shadow:0 0 8px currentColor}
  .fieldcap{position:absolute;right:12px;top:10px;font-size:10.5px;color:var(--dim);letter-spacing:.08em;text-transform:uppercase}
  /* panels */
  .grid{display:grid;grid-template-columns:1.2fr 1fr;gap:12px;margin-top:12px}
  @media(max-width:900px){.grid{grid-template-columns:1fr}canvas{height:340px}}
  .card{border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:hidden}
  .card h2{margin:0;padding:10px 14px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;
    color:var(--muted);border-bottom:1px solid var(--line);display:flex;justify-content:space-between}
  .scroll{max-height:300px;overflow:auto}
  table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
  th,td{text-align:left;padding:6px 14px;white-space:nowrap}
  th{position:sticky;top:0;background:var(--panel2);color:var(--dim);font-weight:500;font-size:10.5px;
    text-transform:uppercase;letter-spacing:.06em;z-index:1}
  tbody tr{border-top:1px solid #14171f}
  tbody tr:hover{background:#141824}
  .tk{font-weight:600}
  .bull{color:var(--bull)} .bear{color:var(--bear)}
  .fam{display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:3px;vertical-align:middle}
  .bar{height:7px;border-radius:4px;background:linear-gradient(90deg,var(--cool),var(--ember1),var(--ember2))}
  .barwrap{width:78px;background:#14161e;border-radius:4px;overflow:hidden;display:inline-block;vertical-align:middle;margin-right:8px}
  .sig-src{color:var(--muted)}
  .num{font-variant-numeric:tabular-nums;color:var(--muted)}
  .up{color:var(--bull)} .down{color:var(--bear)}
  .note{color:var(--dim);font-size:11px;max-width:280px;overflow:hidden;text-overflow:ellipsis}
  .empty{padding:22px 14px;color:var(--dim);text-align:center;font-size:12px}
  .calrow{display:flex;justify-content:space-between;padding:8px 14px;border-top:1px solid #14171f}
  .swatch{color:var(--muted)}
  footer{margin-top:14px;color:var(--dim);font-size:10.5px;text-align:center;letter-spacing:.05em}
  @media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <span class="brand">NEST <b>×</b> FIELD</span>
    <span class="stat">WATCHED <b id="s-watched">–</b></span>
    <span class="stat">SOURCES <b id="s-sources">–</b></span>
    <span class="stat">FLOOR <b id="s-floor">–</b></span>
    <span class="stat">ALERTS <b id="s-alerts">–</b></span>
    <span class="stat">REGIME <span id="s-regime" class="pill tone-neutral">–</span></span>
    <span class="stat">LLM <b>$0/d</b></span>
    <span class="adv" id="s-updated">advisory · does not trade</span>
  </header>

  <div class="field-wrap">
    <canvas id="field"></canvas>
    <div class="fieldcap">conviction field — heat = conviction, hue = dominant family</div>
    <div class="legend" id="legend"></div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>Conviction book <span id="book-n" class="swatch"></span></h2>
      <div class="scroll"><table id="book"><thead><tr>
        <th>Ticker</th><th>Conv</th><th>Dir</th><th>Families</th><th>Δ</th></tr></thead>
        <tbody></tbody></table></div>
    </div>
    <div class="card">
      <h2>Signal log <span class="swatch">live event tail</span></h2>
      <div class="scroll"><table id="signals"><thead><tr>
        <th>Src</th><th>Ticker</th><th>Dir</th><th>Str</th><th>Note</th></tr></thead>
        <tbody></tbody></table></div>
    </div>
    <div class="card">
      <h2>Source weights <span class="swatch">decay to zero = working</span></h2>
      <div class="scroll"><table id="weights"><thead><tr>
        <th>Source</th><th>Fam</th><th>Weight</th><th>Hit</th><th>n</th></tr></thead>
        <tbody></tbody></table></div>
    </div>
    <div class="card">
      <h2>Calibration <span class="swatch">5d hit by bucket</span></h2>
      <div id="calibration"></div>
      <h2 style="border-top:1px solid var(--line)">Alert feed</h2>
      <div id="calls" class="scroll" style="max-height:150px"></div>
    </div>
  </div>

  <footer id="foot">The Nest watches, remembers, and grades itself. A Call is an input to your judgment — read the stack, not the number.</footer>
</div>

<script>
const FAM = {flow:'#35d0d0',levels:'#9b8cff',positioning:'#ffb454',filings:'#6ec97a',
  social:'#ff77c8',macro:'#ff6b6b',chart:'#5b9dff',fundamental:'#4fd1a1'};
let STATE = __NEST_STATE__;
const POLL = __POLL__;

function esc(s){return String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function domFam(f){return (f&&f.length)?f.slice().sort((a,b)=>(FAM[a]?-1:1))[0]:'flow'}

function render(){
  const s=STATE, h=s.header||{};
  document.getElementById('s-watched').textContent=h.watched??'–';
  document.getElementById('s-sources').textContent=h.sources??'–';
  document.getElementById('s-floor').textContent=h.floor??'–';
  document.getElementById('s-alerts').textContent=(h.alerts_today??0)+'/'+(h.max_alerts??3);
  const rp=document.getElementById('s-regime'), rg=s.regime||{tone:'neutral'};
  rp.textContent=(rg.tone||'neutral').toUpperCase()+(rg.score?(' '+Math.round(rg.score)):'');
  rp.className='pill tone-'+(rg.tone||'neutral');
  rp.title=rg.note||'';
  document.getElementById('s-updated').textContent='updated '+(s.now||'').replace('T',' ')+' · advisory';

  // legend
  document.getElementById('legend').innerHTML=Object.entries(FAM).map(([k,v])=>
    `<span><i class="dot" style="color:${v}"></i>${k}</span>`).join('');

  // book
  const bt=document.querySelector('#book tbody');
  document.getElementById('book-n').textContent=(s.book||[]).length+' names';
  bt.innerHTML=(s.book||[]).map(b=>{
    const pct=Math.min(100,b.conviction);
    const fams=(b.families||[]).map(f=>`<i class="fam" style="background:${FAM[f]||'#666'}" title="${f}"></i>`).join('');
    return `<tr><td class="tk">${esc(b.ticker)}</td>
      <td><span class="barwrap" style="width:60px"><span class="bar" style="width:${pct}%;display:block"></span></span>${b.conviction.toFixed(0)}</td>
      <td class="${b.direction==='bull'?'bull':'bear'}">${b.direction}</td>
      <td>${fams}<span class="num">${(b.contributors||[]).slice(0,3).join(' ')}</span></td>
      <td class="${b.delta>=0?'up':'down'}">${b.delta>=0?'+':''}${b.delta.toFixed(0)}</td></tr>`;
  }).join('')||'<tr><td colspan="5" class="empty">no scores yet</td></tr>';

  // signals
  const st=document.querySelector('#signals tbody');
  st.innerHTML=(s.signals||[]).slice(0,60).map(x=>
    `<tr><td class="sig-src"><i class="fam" style="background:${FAM[x.family]||'#666'}"></i>${esc(x.source)}</td>
      <td class="tk">${esc(x.ticker)}</td>
      <td class="${x.direction==='bull'?'bull':'bear'}">${x.direction}</td>
      <td class="num">${(x.strength*100|0)}</td>
      <td class="note">${esc(x.note)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">no signals yet</td></tr>';

  // weights
  const wt=document.querySelector('#weights tbody');
  wt.innerHTML=(s.weights||[]).slice(0,40).map(w=>
    `<tr><td>${esc(w.source)}</td>
      <td><i class="fam" style="background:${FAM[w.family]||'#666'}"></i></td>
      <td><span class="barwrap"><span class="bar" style="width:${Math.min(100,w.weight*100)}%;display:block"></span></span>${w.weight.toFixed(2)}</td>
      <td class="num">${w.n?Math.round(100*w.hits/w.n)+'%':'–'}</td>
      <td class="num">${w.n}</td></tr>`).join('');

  // calibration
  document.getElementById('calibration').innerHTML=Object.entries(s.calibration||{}).map(([k,v])=>
    `<div class="calrow"><span>${k}</span>
      <span class="num">${v.hit_rate!=null?Math.round(v.hit_rate*100)+'% hit':'no history'} · n=${v.n} ${v.avg_ret!=null?'· '+(v.avg_ret>=0?'+':'')+v.avg_ret+'%':''}</span></div>`
    ).join('')||'<div class="empty">no graded calls yet — grading matures at 1d/5d/20d</div>';

  // calls
  document.getElementById('calls').innerHTML=(s.calls||[]).map(c=>
    `<div class="calrow"><span class="tk ${c.direction==='bull'?'bull':'bear'}">${esc(c.ticker)} ${c.conviction.toFixed(0)}</span>
      <span class="note">${esc(c.thesis||c.calibration_note||'')}</span></div>`
    ).join('')||'<div class="empty">no Calls yet — the gate holds until independent families converge above the floor</div>';

  layoutField();
}

/* ---------- the field canvas ---------- */
const cv=document.getElementById('field'), ctx=cv.getContext('2d');
let nodes=[], streaks=[], W=0, H=0, DPR=Math.min(2,window.devicePixelRatio||1);
function resize(){W=cv.clientWidth;H=cv.clientHeight;cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);layoutField()}
window.addEventListener('resize',resize);

function layoutField(){
  const book=(STATE.book||[]).filter(b=>b.ticker&&b.ticker[0]!=='_').slice(0,34);
  const cx=W/2, cy=H/2, maxR=Math.min(W,H)*0.44;
  // sector per family
  const fams=Object.keys(FAM); const sector={}; fams.forEach((f,i)=>sector[f]=(i/fams.length)*Math.PI*2);
  nodes=book.map((b,i)=>{
    const f=domFam(b.families), ang=sector[f]+((i%5)-2)*0.10;
    const conv=Math.max(4,b.conviction);
    const r=maxR*(1-conv/140);           // higher conviction -> closer to the hot center
    return {b,f,x:cx+Math.cos(ang)*r,y:cy+Math.sin(ang)*r,
      rad:5+conv*0.16, heat:Math.min(1,conv/90), ang, tw:Math.random()*6.28};
  });
}
function hexA(hex,a){const n=parseInt(hex.slice(1),16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`}
function emberMix(t){ // cool -> ember by heat t
  const c=[59,74,107], e=[255,90,48];
  return `rgb(${c.map((v,i)=>Math.round(v+(e[i]-v)*t)).join(',')})`;
}
let last=0, reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
function frame(t){
  const dt=(t-last)/1000||0; last=t;
  ctx.clearRect(0,0,W,H);
  // faint radial core
  const g=ctx.createRadialGradient(W/2,H/2,10,W/2,H/2,Math.min(W,H)*0.5);
  g.addColorStop(0,'rgba(255,120,50,0.05)');g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  // streaks (signal arrivals)
  streaks=streaks.filter(s=>s.life>0);
  streaks.forEach(s=>{
    s.life-=dt*0.9;
    const p=1-s.life;
    ctx.strokeStyle=hexA(FAM[s.fam]||'#888',Math.max(0,s.life)*0.7);
    ctx.lineWidth=1.2;ctx.beginPath();
    ctx.moveTo(s.x0,s.y0);
    ctx.lineTo(s.x0+(s.x1-s.x0)*p,s.y0+(s.y1-s.y0)*p);ctx.stroke();
  });
  // nodes
  nodes.forEach(n=>{
    if(!reduce) n.tw+=dt*2;
    const pulse=reduce?0:Math.sin(n.tw)*0.12;
    const rad=n.rad*(1+pulse);
    const glow=ctx.createRadialGradient(n.x,n.y,1,n.x,n.y,rad*3);
    const col=emberMix(n.heat);
    glow.addColorStop(0,hexA(FAM[n.f]||'#888',0.9));
    glow.addColorStop(0.35,col.replace('rgb','rgba').replace(')',`,${0.35+n.heat*0.4})`));
    glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(n.x,n.y,rad*3,0,6.283);ctx.fill();
    ctx.fillStyle=hexA('#ffffff',0.85);ctx.beginPath();ctx.arc(n.x,n.y,Math.max(1.5,rad*0.32),0,6.283);ctx.fill();
    if(n.b.conviction>=18){
      ctx.fillStyle=hexA('#e9e7e1',0.9);ctx.font='10px ui-monospace,monospace';
      ctx.textAlign='center';ctx.fillText(n.b.ticker,n.x,n.y-rad-4);
    }
  });
  requestAnimationFrame(frame);
}
function emitStreaks(){ // spawn a few streaks from perimeter toward hot nodes
  if(reduce||!nodes.length)return;
  const fams=Object.keys(FAM);
  for(let i=0;i<3;i++){
    const n=nodes[Math.floor(Math.random()*Math.min(nodes.length,12))];
    if(!n)continue;
    const ang=Math.random()*6.283, R=Math.min(W,H)*0.5;
    streaks.push({fam:n.f,x0:W/2+Math.cos(ang)*R,y0:H/2+Math.sin(ang)*R,x1:n.x,y1:n.y,life:1});
  }
}
setInterval(emitStreaks,1400);

async function poll(){
  if(!POLL)return;
  try{const r=await fetch(POLL,{cache:'no-store'});if(r.ok){STATE=await r.json();render();}}catch(e){}
}
resize();render();requestAnimationFrame(frame);
if(POLL){setInterval(poll,4000);}
</script>
</body>
</html>"""


def render_page(state: dict, poll_url: str | None = None) -> str:
    return (_HTML
            .replace("__NEST_STATE__", json.dumps(state))
            .replace("__POLL__", json.dumps(poll_url)))
