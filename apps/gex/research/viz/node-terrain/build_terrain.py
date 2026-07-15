import gzip, json, os, sqlite3, math
BASE="/Users/saiyeeshrathish/the final plan/apps/gex"
BF=f"{BASE}/research/velocity-capture/backfill"
days=sorted(os.listdir(BF))
TICKERS=["SPXW","SPY","QQQ"]
BAND=0.014
out={"days":days,"tickers":TICKERS,"data":{}}

db=sqlite3.connect(f"{BASE}/data/gexester.db")
db.row_factory=sqlite3.Row
fires={}
for r in db.execute("SELECT trading_day d, ticker t, option_type typ, strike, fire_ts_ms, close_ts_ms, entry_mark, close_mark, best_pct_gain FROM tracked_plays WHERE entry_mark>0 GROUP BY trading_day, ticker, fire_ts_ms"):
    fires.setdefault((r["d"],r["t"]),[]).append(dict(r))

def et_min(ts):  # 'YYYY-MM-DDTHH:MM:00.000Z' -> minutes since 09:30 ET
    h,m=int(ts[11:13]),int(ts[14:16]); return (h-4)*60+m-(9*60+30)

for day in days:
    for t in TICKERS:
        p=f"{BF}/{day}/{t}.jsonl.gz"
        if not os.path.exists(p): continue
        frames=[]
        for l in gzip.open(p,'rt'):
            try: frames.append(json.loads(l))
            except: pass
        if len(frames)<300: continue
        spots=[f["spot"] for f in frames]
        mid=sorted(spots)[len(spots)//2]
        lo,hi=mid*(1-BAND),mid*(1+BAND)
        # union of strikes in band with any signal
        smax={}
        for f in frames:
            for s in f["strikes"]:
                k=s["strike"]
                if lo<=k<=hi:
                    g=abs(s.get("gamma") or 0)
                    if g>smax.get(k,0): smax[k]=g
        strikes=sorted(k for k,v in smax.items() if v>0)
        if not strikes: continue
        idx={k:i for i,k in enumerate(strikes)}
        n=len(strikes); m=len(frames)
        G=[[0]*n for _ in range(m)]; V=[[0]*n for _ in range(m)]
        king=[-1]*m; ksign=[0]*m
        mins=[et_min(f["requestedTs"]) for f in frames]
        for fi,f in enumerate(frames):
            bg=0
            for s in f["strikes"]:
                k=s["strike"]
                if k in idx:
                    g=s.get("gamma") or 0; v=s.get("vanna") or 0
                    G[fi][idx[k]]=round(g/1e6); V[fi][idx[k]]=round(v/1e6)
                # king over FULL surface not just band
                g2=abs(s.get("gamma") or 0)
                if g2>bg: bg=g2; kk=k; ks=1 if (s.get("gamma") or 0)>0 else -1
            king[fi]=kk; ksign[fi]=ks
        gmax=sorted(abs(x) for row in G for x in row if x)[int(0.97*max(1,len([x for row in G for x in row if x])))-1] if any(any(row) for row in G) else 1
        vmax=sorted(abs(x) for row in V for x in row if x)
        vmax=vmax[int(0.97*len(vmax))-1] if vmax else 1
        frs=[]
        for f in fires.get((day,t),[]):
            em=None; xm=None
            # ts_ms -> ET minutes since 0930
            import datetime
            for key,var in (("fire_ts_ms","em"),("close_ts_ms","xm")):
                if f[key]:
                    dt=datetime.datetime.fromtimestamp(f[key]/1000)
                    v=(dt.hour*60+dt.minute)-(9*60+30)
                    if var=="em": em=v
                    else: xm=v
            realized=None
            if f["close_mark"] and f["entry_mark"]:
                realized=round((f["close_mark"]-f["entry_mark"])/f["entry_mark"]*100)
            frs.append({"typ":f["typ"],"k":f["strike"],"em":em,"xm":xm,"r":realized})
        out["data"][f"{day}|{t}"]={"strikes":strikes,"mins":mins,"spot":[round(s,2) for s in spots],
            "G":G,"V":V,"gmax":max(gmax,1),"vmax":max(vmax,1),"king":king,"ksign":ksign,"fires":frs,"sig":[]}

# EXTREME-PROBE system entries (operator: show ONLY this system on the map)
# Prefer Variant-B cycle legs (operator: pika-touch system only) when the study has landed
_CY=f"{BASE}/research/swing-system/swing_v2_events.jsonl"
EV=_CY if os.path.exists(_CY) else f"{BASE}/research/velocity-capture/probe_events.jsonl"
if os.path.exists(EV):
    n=0
    for l in open(EV):
        try: e=json.loads(l)
        except: continue
        key=f"{e['day']}|{e['ticker']}"
        if key in out["data"]:
            if e.get("kind")=="cycle" and e.get("variant")!="B": continue
            def m_of(t):
                if not t: return None
                t=t.split('T')[1] if 'T' in t else t; p=t.split(':'); hh,mm=int(p[0]),int(p[1]); v=(hh*60+mm)-(13*60+30)
                return v if 0<=v<=390 else None
            m=m_of(e.get("minute"))
            if m is None: continue
            _sk=e.get("strike", e.get("strike:spot@entry",""))
            _k=float(str(_sk).split(":")[-1])   # spot@entry -> marker sits on the price line
            out["data"][key]["sig"].append({"m":m,"k":_k,
                "d":"call" if e.get("implied")=="up" else "put",
                "xm":m_of(e.get("exit_minute")),
                "out":("win" if (e.get("pnl_pct") or 0)>0 else "loss"),"r":e.get("pnl_pct")})
            n+=1
    print("probe entries attached:", n)
for k in out["data"]: out["data"][k]["fires"]=[]   # probes-only view

print("built:", len(out["data"]), "ticker-days")
json.dump(out,open("terrain_data.json","w"),separators=(",",":"))
print("size:", os.path.getsize("terrain_data.json")//1024, "KB")
