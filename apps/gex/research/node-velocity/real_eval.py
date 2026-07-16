"""Price strategies with REAL prints; emit nodevel_events.jsonl + real-print tables."""
import json, os, random
random.seed(11)
from real_prints import ALL, CACHE, contract_for

SPREAD_RT=0.011   # operator-verified ~1.1% round trip (>1.0% floor)
STOP=0.50         # -50% stop on the long option (close-based)
HOLD=[15,30]

def load_series(day,o):
    cf=os.path.join(CACHE,f"{o}_{day}.json")
    if not os.path.exists(cf): return None
    m=json.load(open(cf))
    return {int(k):v for k,v in m.items()} if m else None

def px(series, mi, field="c"):
    if mi in series: return series[mi][field]
    for dd in (1,-1,2,-2):
        if mi+dd in series: return series[mi+dd][field]
    return None

def trade_pnl(e, h):
    """real-print net pnl% for one episode's ATM 0DTE long, hold h with -50% stop."""
    day,o,st,cp=contract_for(e)
    s=load_series(day,o)
    if not s: return None
    emi=e["entry_mi"]
    entry=px(s,emi)
    if entry is None or entry<=0.05: return None   # untradeable dust
    # stop scan (close-based) then horizon exit
    exit_px=None
    for k in range(1,h+1):
        p=px(s,emi+k)
        if p is None: continue
        if p<=entry*(1-STOP):
            exit_px=entry*(1-STOP); break
    if exit_px is None:
        exit_px=px(s,emi+h)
    if exit_px is None: return None
    # spread: entry@ask, exit@bid
    entry_fill=entry*(1+SPREAD_RT/2); exit_fill=exit_px*(1-SPREAD_RT/2)
    return exit_fill/entry_fill - 1.0

def strat_real(ev_list, h):
    pnls=[]
    for e in ev_list:
        p=trade_pnl(e,h)
        if p is not None: pnls.append(p)
    if not pnls: return dict(n=0)
    n=len(pnls); win=sum(1 for p in pnls if p>0)/n
    return dict(n=n, win=win, mean=sum(pnls)/n,
                med=sorted(pnls)[n//2], exp=sum(pnls)/n)

def tercile_cut(ev,key,frac=2/3.):
    v=sorted(e[key] for e in ev); return v[int(len(v)*frac)]

def strategies(pct):
    ev=ALL[str(pct)]
    vcut=tercile_cut(ev,"supp_vanna_vel")
    S={}
    S["ORACLE turns"]=[e for e in ev if e["is_turn"]==1]
    S["BARE (all touches)"]=ev
    S["VANNA-VEL>0"]=[e for e in ev if e["supp_vanna_vel"]>0]
    S["VANNA-VEL top-tercile"]=[e for e in ev if e["supp_vanna_vel"]>=vcut]
    S["VANNA-FLIP flag"]=[e for e in ev if e["flip"]==1]
    S["OLD (resid_gvel>0 & flip)"]=[e for e in ev if e["resid_gvel"]>0 and e["flip"]==1]
    S["PHANTOM signal (ph_vanna>0)"]=[e for e in ev if e["ph_supp_vanna_vel"] is not None and e["ph_supp_vanna_vel"]>0]
    return S

def random_real(pct,h):
    """same contracts as bare, RANDOM entry minute (isolates node-touch timing)."""
    ev=ALL[str(pct)]; pnls=[]
    for e in ev:
        day,o,st,cp=contract_for(e); s=load_series(day,o)
        if not s: continue
        mis=[m for m in s if m>=15 and m<=375-h]
        if not mis: continue
        emi=random.choice(mis); entry=px(s,emi)
        if entry is None or entry<=0.05: continue
        exit_px=None
        for k in range(1,h+1):
            p=px(s,emi+k)
            if p is not None and p<=entry*(1-STOP): exit_px=entry*(1-STOP); break
        if exit_px is None: exit_px=px(s,emi+h)
        if exit_px is None: continue
        pnls.append(exit_px*(1-SPREAD_RT/2)/(entry*(1+SPREAD_RT/2))-1)
    if not pnls: return dict(n=0)
    n=len(pnls); return dict(n=n,win=sum(1 for p in pnls if p>0)/n,mean=sum(pnls)/n,med=sorted(pnls)[n//2],exp=sum(pnls)/n)

if __name__=="__main__":
    out={}
    for pct in [0.0015,0.0025]:
        S=strategies(pct); res={}
        for name,lst in S.items():
            res[name]={h:strat_real(lst,h) for h in HOLD}
        res["RANDOM timing"]={h:random_real(pct,h) for h in HOLD}
        out[str(pct)]=res
        print("="*70); print("REAL PRINTS pct",pct)
        for h in HOLD:
            print(" -- hold %dmin (net of %.1f%% RT spread, -%d%% stop):"%(h,SPREAD_RT*100,STOP*100))
            for name in ["ORACLE turns","BARE (all touches)","VANNA-VEL>0","VANNA-VEL top-tercile","VANNA-FLIP flag","OLD (resid_gvel>0 & flip)","PHANTOM signal (ph_vanna>0)","RANDOM timing"]:
                s=res[name][h]
                if s.get("n"):
                    print("   %-30s n=%3d win%%=%.2f exp=%+.1f%% med=%+.1f%%"%(name,s["n"],s["win"],s["exp"]*100,s["med"]*100))
    json.dump(out,open("real_results.json","w"))

    # emit nodevel_events.jsonl for the tradeable node-velocity signal (vanna-vel top-tercile), 0.15%, h=15
    ev=ALL["0.0015"]; vcut=tercile_cut(ev,"supp_vanna_vel")
    sig=[e for e in ev if e["supp_vanna_vel"]>=vcut]
    recs=[]
    for e in sig:
        day,o,st,cp=contract_for(e); s=load_series(day,o)
        p=trade_pnl(e,15)
        if p is None: continue
        hh=13+(e["entry_mi"]+30)//60; mm=(e["entry_mi"]+30)%60
        recs.append(dict(day=day,ticker="SPXW",minute="%02d:%02d"%(hh,mm),
            strike="%d:%.2f"%(st,e["spot"]),kind="nv",
            implied=("up" if e["side"]=="floor" else "down"),
            exit_minute="%02d:%02d"%(13+(e["entry_mi"]+15+30)//60,(e["entry_mi"]+15+30)%60),
            outcome=("win" if p>0 else "loss"),pnl_pct=round(p*100,2)))
    with open("nodevel_events.jsonl","w") as fh:
        for r in recs: fh.write(json.dumps(r)+"\n")
    print("\nwrote nodevel_events.jsonl:",len(recs),"trades")
