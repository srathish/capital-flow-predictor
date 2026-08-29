"""The FINDS board — the finder's actual output, made to be looked at. A ranked leaderboard
of the top momentum/quality/theme picks (live every cycle), each with its conviction, the
"why" (momentum %, quality, sector theme, catalysts), and which confirmation sources agree or
veto. This is the page that answers "what should I look at right now."
"""

from __future__ import annotations

import json

_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NEST · FINDS</title>
<style>
  :root{
    --ground:#080a0e; --panel:#0e1219; --panel2:#0b0e14; --line:#1a2030; --line2:#141a26;
    --ink:#eef1f6; --muted:#7a8498; --dim:#495066;
    --long:#2fd08a; --long2:#1f8f63; --short:#ff5f6d; --amber:#ffc24b; --accent:#2fd08a;
    --flow:#35d0d0; --levels:#9b8cff; --positioning:#ffb454; --filings:#6ec97a;
    --social:#ff77c8; --chart:#5b9dff; --fundamental:#4fd1a1; --catalyst:#ffd166; --macro:#ff6b6b;
  }
  *{box-sizing:border-box}
  html,body{margin:0;min-height:100%}
  body{background:radial-gradient(1200px 600px at 80% -20%,#12161f 0,var(--ground) 55%);
    color:var(--ink);font:13px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    -webkit-font-smoothing:antialiased}
  .wrap{max-width:1180px;margin:0 auto;padding:16px}
  header{display:flex;align-items:baseline;gap:8px 18px;flex-wrap:wrap;padding-bottom:12px;
    border-bottom:1px solid var(--line)}
  .brand{font-weight:700;letter-spacing:.16em}
  .brand b{color:var(--accent)}
  .tabs{display:flex;gap:3px;margin-left:4px}
  .tab{padding:3px 11px;border:1px solid var(--line);border-radius:7px;color:var(--dim);
    font-size:10.5px;letter-spacing:.1em;text-decoration:none}
  .tab.on{color:var(--ink);border-color:#26324a;background:#111726}
  .stat{color:var(--muted);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase}
  .stat b{color:var(--ink);font-variant-numeric:tabular-nums}
  .stat.push{margin-left:auto}
  .live{color:var(--long)}
  .subhead{display:flex;justify-content:space-between;align-items:baseline;margin:16px 2px 8px}
  .subhead h2{margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
  .subhead .note{color:var(--dim);font-size:11px}
  .layout{display:grid;grid-template-columns:1fr 210px;gap:16px}
  @media(max-width:820px){.layout{grid-template-columns:1fr}}
  /* pick rows */
  .board{display:flex;flex-direction:column;gap:6px}
  .pick{display:grid;grid-template-columns:24px 88px 1fr auto;align-items:center;gap:12px;
    padding:10px 14px;border:1px solid var(--line);border-radius:11px;background:var(--panel);
    transition:border-color .15s}
  .pick:hover{border-color:#26324a}
  .rk{color:var(--dim);font-variant-numeric:tabular-nums;text-align:right;font-size:12px}
  .tk{font-weight:700;font-size:17px;letter-spacing:.02em}
  .tk .sec{display:block;font-weight:400;font-size:10px;color:var(--dim);letter-spacing:.04em;
    text-transform:uppercase;margin-top:1px}
  .mid{display:flex;flex-direction:column;gap:6px;min-width:0}
  .why{display:flex;flex-wrap:wrap;gap:5px}
  .chip{font-size:10.5px;padding:1px 7px;border-radius:999px;border:1px solid var(--line2);
    color:var(--muted);white-space:nowrap}
  .chip.mom{color:var(--chart);border-color:#22314d}
  .chip.qual{color:var(--fundamental);border-color:#1f3a34}
  .chip.theme{color:var(--catalyst);border-color:#3d3720}
  .chip.cat{color:var(--amber);border-color:#3d3720}
  .conf{font-size:10px;color:var(--dim)}
  .conf .veto{color:var(--short)}
  .right{display:flex;align-items:center;gap:14px}
  .mom60{font-variant-numeric:tabular-nums;text-align:right;min-width:56px}
  .mom60 b{font-size:15px}.mom60 span{display:block;font-size:10px;color:var(--dim)}
  .up{color:var(--long)}.down{color:var(--short)}
  .convwrap{width:120px}
  .convbar{height:8px;border-radius:5px;background:#141a26;overflow:hidden}
  .convbar i{display:block;height:100%;background:linear-gradient(90deg,#2b3f5e,var(--long))}
  .convnum{display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);margin-top:3px}
  .convnum b{color:var(--ink);font-variant-numeric:tabular-nums}
  .fired{color:var(--amber);border-color:#4a3d16;background:#1a1608}
  .dir{width:8px;height:8px;border-radius:50%;box-shadow:0 0 8px currentColor}
  .dir.b{color:var(--long)}.dir.s{color:var(--short)}
  /* side rail */
  .rail .card{border:1px solid var(--line);border-radius:12px;background:var(--panel2);
    padding:12px;margin-bottom:14px}
  .rail h3{margin:0 0 8px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
  .sec-row{display:flex;align-items:center;gap:8px;padding:3px 0}
  .sec-row .nm{flex:1;color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .heatbar{width:60px;height:6px;border-radius:4px;background:#141a26;overflow:hidden}
  .heatbar i{display:block;height:100%}
  .regime{font-size:12px}
  .shorts .pick{background:#100b0d;border-color:#241318}
  .shorts .tk{font-size:15px}
  footer{margin-top:18px;color:var(--dim);font-size:10.5px;text-align:center;letter-spacing:.04em}
  .empty{padding:26px;text-align:center;color:var(--dim)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <span class="brand">NEST <b>·</b> FINDS</span>
    <div class="tabs"><a class="tab on" href="/">FINDS</a><a class="tab" href="/nexus">NEXUS</a><a class="tab" href="/pipeline">PIPELINE</a><a class="tab" href="/field">FIELD</a></div>
    <span class="stat push live" id="s-stream">LIVE</span>
    <span class="stat">SCANNING <b id="s-univ">–</b></span>
    <span class="stat">REGIME <b id="s-regime">–</b></span>
    <span class="stat">GATE <b id="s-floor">–</b></span>
    <span class="stat">UPDATED <b id="s-age">–</b></span>
  </header>

  <div class="subhead">
    <h2>Top picks — momentum · quality · theme</h2>
    <span class="note">ranked live every cycle · a ⚡ pick has crossed the alert floor</span>
  </div>

  <div class="layout">
    <div class="board" id="longs"></div>
    <div class="rail">
      <div class="card"><h3>Sector heat</h3><div id="sectors"></div></div>
      <div class="card"><h3>Shorts (weakest)</h3><div class="board shorts" id="shorts"></div></div>
      <div class="card"><h3>How to read</h3>
        <div style="color:var(--muted);font-size:11px;line-height:1.6">
          Conviction = momentum + quality + catalyst + theme (the validated direction stack).
          Flow &amp; GEX only <b style="color:var(--ink)">confirm or veto</b> — they never pick the
          name. Edge is a ~1-month swing (backtest: top decile +2.7%/mo excess, 11/12 periods).
        </div>
      </div>
    </div>
  </div>
  <footer>Advisory — the Nest places no orders. Momentum finds the stock; read the evidence, not the number.</footer>
</div>

<script>
const FAMHUE={chart:'#5b9dff',fundamental:'#4fd1a1',catalyst:'#ffd166',flow:'#35d0d0',
  levels:'#9b8cff',positioning:'#ffb454',filings:'#6ec97a',social:'#ff77c8',macro:'#ff6b6b'};
let STATE=__STATE__; const POLL=__POLL__;
function esc(s){return String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
let baseAge=0,baseAt=0;
function fmtAge(s){s=Math.max(0,Math.round(s));return s<60?s+'s':s<3600?Math.floor(s/60)+'m':Math.floor(s/3600)+'h'}
function tick(){const a=baseAge+(performance.now()-baseAt)/1000;
  document.getElementById('s-age').textContent=fmtAge(a)+' ago';
  const el=document.getElementById('s-stream'),f=a<600;el.textContent=f?'LIVE':'IDLE';
  el.style.color=f?'var(--long)':'var(--dim)'}

function pickRow(p,i){
  const pct=Math.min(100,p.conviction);
  const dirCls=p.direction==='bull'?'b':'s';
  const whyChips=(p.why||[]).map(w=>{
    let cls='chip';const lw=w.toLowerCase();
    if(lw.startsWith('momentum'))cls='chip mom';
    else if(lw==='quality')cls='chip qual';
    else if(lw.startsWith('theme'))cls='chip theme';
    else if(lw.startsWith('earnings')||lw==='fda')cls='chip cat';
    return `<span class="${cls}">${esc(w)}</span>`;
  }).join('');
  const conf=(p.confirms||[]).length?`<span class="conf">✓ ${p.confirms.join(' ')}</span>`:'';
  const veto=(p.vetoes||[]).length?`<span class="conf veto">✕ ${p.vetoes.join(' ')}</span>`:'';
  const mom=p.mom60_pct!=null?`<div class="mom60"><b class="${p.mom60_pct>=0?'up':'down'}">${p.mom60_pct>0?'+':''}${p.mom60_pct}%</b><span>3mo</span></div>`:'';
  const fired=p.gated?'<span class="chip fired">⚡ ALERT</span>':'';
  const delta=p.delta?`<span class="conf ${p.delta>0?'up':'down'}">${p.delta>0?'▲':'▼'}${Math.abs(p.delta)}</span>`:'';
  return `<div class="pick">
    <div class="rk">${i+1}</div>
    <div class="tk"><span class="dir ${dirCls}" style="display:inline-block;margin-right:6px"></span>${esc(p.ticker)}
      <span class="sec">${esc(p.sector||'')}</span></div>
    <div class="mid"><div class="why">${whyChips}${fired}</div>
      <div>${conf} ${veto} ${delta}</div></div>
    <div class="right">${mom}
      <div class="convwrap"><div class="convbar"><i style="width:${pct}%"></i></div>
        <div class="convnum"><span>conviction</span><b>${p.conviction.toFixed(0)}</b></div></div>
    </div></div>`;
}

function render(){
  const s=STATE;
  document.getElementById('s-univ').textContent=(s.universe||0)+' stocks';
  document.getElementById('s-regime').textContent=(s.regime||'neutral').toUpperCase();
  document.getElementById('s-floor').textContent=Math.round(s.floor||70);
  baseAge=0;baseAt=performance.now();tick();
  const L=s.longs||[];
  document.getElementById('longs').innerHTML=L.length?L.map(pickRow).join('')
    :'<div class="empty">scanning… the first ranked picks appear on the next cycle</div>';
  document.getElementById('shorts').innerHTML=(s.shorts||[]).slice(0,8).map(pickRow).join('')||'<div class="empty" style="padding:10px">—</div>';
  const secs=s.sectors||[];
  document.getElementById('sectors').innerHTML=secs.map(([nm,b])=>{
    const hot=b>0.55, col=hot?'var(--long)':b<0.45?'var(--short)':'var(--muted)';
    return `<div class="sec-row"><span class="nm">${esc(nm)}</span>
      <span class="heatbar"><i style="width:${Math.round(b*100)}%;background:${col}"></i></span>
      <span style="color:${col};font-size:10.5px;width:26px;text-align:right">${Math.round(b*100)}</span></div>`;
  }).join('')||'<div style="color:var(--dim);font-size:11px">—</div>';
}
async function poll(){if(!POLL)return;try{const r=await fetch(POLL,{cache:'no-store'});
  if(r.ok){STATE=await r.json();render()}}catch(e){}}
render();setInterval(tick,1000);
if(POLL)setInterval(poll,5000);
</script>
</body>
</html>"""


def render_picks(state: dict, poll_url: str | None = None) -> str:
    return (_HTML
            .replace("__STATE__", json.dumps(state))
            .replace("__POLL__", json.dumps(poll_url)))
