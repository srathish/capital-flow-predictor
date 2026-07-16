#!/usr/bin/env python3
# MEGA dark-pool level study: mirror (real vs phantom vs random) + entry-timing (level vs confirmation).
# RESEARCH ONLY. Pure python (no numpy). BS option P&L is MODELED (identical pricer across arms).
import json, gzip, os, math, random, statistics, zlib
from datetime import datetime, timedelta

BF = "/Users/saiyeeshrathish/the final plan/apps/gex/research/velocity-capture/backfill"
SCR = os.path.dirname(os.path.abspath(__file__))
OUT = "/Users/saiyeeshrathish/the final plan/apps/gex/research/darkpool-levels"

DAYS = ["2026-06-16","2026-06-17","2026-06-18","2026-06-22","2026-06-23","2026-06-24",
        "2026-06-25","2026-06-26","2026-06-29","2026-06-30","2026-07-01","2026-07-02",
        "2026-07-06","2026-07-07","2026-07-08","2026-07-09","2026-07-10","2026-07-13",
        "2026-07-14","2026-07-15"]

# ---- Levels (mega_levels.json; 7481.3/7481.6 merged -> one level, sum notional) ----
LEVELS = [
 {"id":"L7399","spy":737.38,"spx":7399.6,"notional":4057928475,"date":"2026-06-09"},
 {"id":"L7407","spy":738.17,"spx":7407.5,"notional":1994665568,"date":"2026-06-11"},
 {"id":"L7526","spy":750.057,"spx":7526.3,"notional":8744713293,"date":"2026-06-16"},
 {"id":"L7504","spy":747.87,"spx":7504.4,"notional":5228781055,"date":"2026-06-18"},
 {"id":"L7447","spy":742.18,"spx":7447.5,"notional":1764667876,"date":"2026-06-30"},
 {"id":"L7495","spy":746.92,"spx":7495.1,"notional":1007539061,"date":"2026-06-30"},
 {"id":"L7481","spy":745.565,"spx":7481.5,"notional":1349593000+1863937750,"date":"2026-07-01"},
 {"id":"L7536","spy":751.05,"spx":7536.8,"notional":2500000000,"date":"2026-07-06"},
 {"id":"L7543","spy":751.70,"spx":7543.3,"notional":2500000000,"date":"2026-07-09"},
 {"id":"L7515","spy":748.95,"spx":7515.7,"notional":973629280,"date":"2026-07-13"},
 {"id":"L7573","spy":754.69,"spx":7573.3,"notional":1811264640,"date":"2026-07-15"},
]
def tier(n):
    if n > 4e9: return "mega_mega"
    if n >= 1.3e9: return "mega"
    return "sub"
for L in LEVELS: L["tier"]=tier(L["notional"])

daily = json.load(open(os.path.join(SCR,"mega_dp_daily.json")))["days"]
def med(xs): return statistics.median(xs)
RATIO = {}
for d,v in daily.items():
    RATIO[d] = med(v["spx"])/med(v["spy"])
IV = {d: daily[d]["iv"] for d in daily}

# ---- Load backfill spot series: list of (minutes_since_midnight_utc, ts_str_hhmm, spot) ----
def load_day(d):
    p = os.path.join(BF,d,"SPXW.jsonl.gz")
    if not os.path.exists(p): return None
    rows=[]
    with gzip.open(p,"rt") as f:
        for line in f:
            o=json.loads(line)
            ts=o["requestedTs"]; spot=o.get("spot")
            if spot is None: continue
            t=datetime.strptime(ts[:16],"%Y-%m-%dT%H:%M")
            mm=t.hour*60+t.minute
            rows.append((mm, ts[11:16], float(spot)))
    rows.sort()
    # dedupe same minute (keep first)
    seen=set(); out=[]
    for r in rows:
        if r[0] in seen: continue
        seen.add(r[0]); out.append(r)
    return out
SERIES = {d: load_day(d) for d in DAYS}
for d in DAYS:
    if not SERIES[d]: print("WARN no data", d)

def spot_at_or_after(series, mm_target, maxgap=8):
    # first sample with mm >= mm_target within maxgap
    best=None
    for (mm,ts,s) in series:
        if mm>=mm_target:
            if mm-mm_target<=maxgap: return (mm,ts,s)
            return None
    return None

# ---- Black-Scholes 0DTE ATM pricer (MODELED) ----
def norm_cdf(x): return 0.5*(1+math.erf(x/math.sqrt(2)))
EXPIRY_MM = 20*60  # 20:00 UTC = 16:00 ET
YEAR_MIN = 525600.0
def bs_price(S,K,mm_now,iv,is_call):
    T=max((EXPIRY_MM-mm_now),1)/YEAR_MIN
    if iv<=0 or T<=0:
        intr = max(0,(S-K) if is_call else (K-S)); return intr
    d1=(math.log(S/K)+(0.5*iv*iv)*T)/(iv*math.sqrt(T))
    d2=d1-iv*math.sqrt(T)
    if is_call: return S*norm_cdf(d1)-K*norm_cdf(d2)
    else: return K*norm_cdf(-d2)-S*norm_cdf(-d1)
def half_spread(prem): return max(0.20, 0.005*prem)  # index points; calibrated to ~0.4pt ATM NBBO

BAND=0.0005   # 0.05% approach band
FAR =0.0010   # 0.10% break/beyond
H=30          # forward horizon minutes
CONF_MAX=30   # minutes to wait for confirmation
PT=0.0025     # profit target 0.25% favorable spot move
TIME_STOP=30  # minutes

# ---- Approach detection given a level SPX price on a day ----
def approaches(series, Lspx):
    band=Lspx*BAND; far=Lspx*FAR
    ev=[]; armed=True; n=len(series)
    for i,(mm,ts,s) in enumerate(series):
        if armed and abs(s-Lspx)<=band:
            # side: last clearly-outside spot within prior 15 min
            side=None
            for j in range(i-1,-1,-1):
                mmj,tsj,sj=series[j]
                if mm-mmj>15: break
                if abs(sj-Lspx)>band:
                    side = +1 if sj>Lspx else -1  # +1 = from above = support
                    break
            if side is not None:
                ev.append((i,mm,ts,s,side))
            armed=False
        elif not armed and abs(s-Lspx)>far:
            armed=True
    return ev

def classify_and_drift(series, i0, mm0, s0, side, Lspx):
    far=Lspx*FAR; band=Lspx*BAND
    # BREAK: within next H min, 2 consecutive samples beyond level on far side by >far
    # support(side+1): beyond = spot < Lspx-far ; resistance(side-1): beyond = spot > Lspx+far
    n=len(series); consec=0; hold=True; brk_i=None
    for i in range(i0+1,n):
        mm,ts,s=series[i]
        if mm-mm0>H: break
        beyond = (s < Lspx-far) if side>0 else (s > Lspx+far)
        if beyond:
            consec+=1
            if consec>=2:
                hold=False; brk_i=i; break
        else:
            consec=0
    # forward 30-min drift
    tgt=spot_at_or_after(series, mm0+H)
    drift=None; bounce=None
    if tgt:
        fwd=(tgt[2]-s0)/s0
        drift=fwd
        bounce=side*fwd  # +1 support -> +fwd defended ; -1 resistance -> -fwd defended
    return hold, brk_i, bounce, drift

def active_levels(d, ratio_mode, prior_only=False):
    out=[]
    for L in LEVELS:
        if prior_only:
            if not (L["date"]<d): continue
        else:
            if not (L["date"]<=d): continue
        if ratio_mode=="fixed":
            lspx=L["spx"]
        else:
            lspx=L["spy"]*RATIO[d]
        out.append((L,lspx))
    return out

# ---- Build all events (real) across days ----
def run_mirror(ratio_mode="fixed", prior_only=False):
    rows=[]  # dict per approach event
    for d in DAYS:
        series=SERIES[d]
        if not series: continue
        openpx=series[0][2]
        for (L,Lspx) in active_levels(d,ratio_mode,prior_only):
            # REAL
            for (i,mm,ts,s,side) in approaches(series,Lspx):
                hold,brk,bounce,drift=classify_and_drift(series,i,mm,s,side,Lspx)
                rows.append(dict(kind="real",day=d,level=L["id"],tier=L["tier"],
                    notional=L["notional"],mm=mm,ts=ts,i=i,spot=s,side=side,Lspx=Lspx,
                    hold=hold,brk=brk,bounce=bounce,drift=drift))
            # MIRROR phantom P=2*open-L
            P=2*openpx-Lspx
            if P>0:
                for (i,mm,ts,s,side) in approaches(series,P):
                    hold,brk,bounce,drift=classify_and_drift(series,i,mm,s,side,P)
                    rows.append(dict(kind="mirror",day=d,level=L["id"],tier=L["tier"],
                        notional=L["notional"],mm=mm,ts=ts,i=i,spot=s,side=side,Lspx=P,
                        hold=hold,brk=brk,bounce=bounce,drift=drift))
            # RANDOM level
            rnd=random.Random(zlib.crc32((d+L["id"]+"rl").encode()))
            reals=[x[1] for x in active_levels(d,ratio_mode,prior_only)]
            R=None
            for _ in range(20):
                u=rnd.uniform(0.003,0.008)*(1 if rnd.random()<0.5 else -1)
                cand=Lspx*(1+u)
                if all(abs(cand-rr)/rr>0.0015 for rr in reals): R=cand; break
            if R:
                for (i,mm,ts,s,side) in approaches(series,R):
                    hold,brk,bounce,drift=classify_and_drift(series,i,mm,s,side,R)
                    rows.append(dict(kind="random",day=d,level=L["id"],tier=L["tier"],
                        notional=L["notional"],mm=mm,ts=ts,i=i,spot=s,side=side,Lspx=R,
                        hold=hold,brk=brk,bounce=bounce,drift=drift))
    return rows

def summ(rows, kind, subset=None):
    r=[x for x in rows if x["kind"]==kind and (subset is None or subset(x))]
    fh=[x for x in r if x["bounce"] is not None]  # full-horizon
    hold_all=[x for x in r]
    hr = sum(1 for x in hold_all if x["hold"])/len(hold_all) if hold_all else float('nan')
    rev = sum(1 for x in fh if x["bounce"]>0)/len(fh) if fh else float('nan')
    md = statistics.mean([x["bounce"] for x in fh])*1e4 if fh else float('nan')  # bps
    return dict(touch=len(r),full=len(fh),hold_rate=hr,rev_rate=rev,bounce_bps=md)

# ---- Option P&L simulation for an entry ----
def simulate_trade(series, i_entry, side, Lspx, iv, exit_on_break=True):
    mm0,ts0,s0=series[i_entry][0],series[i_entry][1],series[i_entry][2]
    is_call = side>0  # support->call(up); resistance->put(down)
    K=round(s0/5)*5
    ent=bs_price(s0,K,mm0,iv,is_call)+half_spread(bs_price(s0,K,mm0,iv,is_call))
    far=Lspx*FAR; consec=0
    n=len(series)
    for i in range(i_entry+1,n):
        mm,ts,s=series[i]
        if mm-mm0>TIME_STOP:
            ex=bs_price(s,K,mm,iv,is_call)-half_spread(bs_price(s,K,mm,iv,is_call))
            return (ex-ent)/ent, ts, "time"
        # profit target
        fav = (s-s0)/s0 if is_call else (s0-s)/s0
        if fav>=PT:
            ex=bs_price(s,K,mm,iv,is_call)-half_spread(bs_price(s,K,mm,iv,is_call))
            return (ex-ent)/ent, ts, "target"
        # structural stop: 2 consec beyond level against trade
        beyond = (s < Lspx-far) if is_call else (s > Lspx+far)
        if exit_on_break and beyond:
            consec+=1
            if consec>=2:
                ex=bs_price(s,K,mm,iv,is_call)-half_spread(bs_price(s,K,mm,iv,is_call))
                return (ex-ent)/ent, ts, "stop"
        else:
            consec=0
    # EOD
    mm,ts,s=series[-1]
    ex=bs_price(s,K,mm,iv,is_call)-half_spread(bs_price(s,K,mm,iv,is_call))
    return (ex-ent)/ent, ts, "eod"

def window_extremes(series,i0,horizon=H):
    mm0=series[i0][0]; lo=1e18; hi=-1e18
    for i in range(i0,len(series)):
        mm,ts,s=series[i]
        if mm-mm0>horizon: break
        lo=min(lo,s); hi=max(hi,s)
    return lo,hi

def find_confirmation(series,i0,side,Lspx):
    band=Lspx*BAND; mm0=series[i0][0]; consec=0
    for i in range(i0+1,len(series)):
        mm,ts,s=series[i]
        if mm-mm0>CONF_MAX: return None
        reclaim = (s>Lspx+band) if side>0 else (s<Lspx-band)
        if reclaim:
            consec+=1
            if consec>=2: return i
        else: consec=0
    return None

def mae_after(series,i_entry,is_call, exit_i=None):
    s0=series[i_entry][2]; mm0=series[i_entry][0]; adv=0.0
    for i in range(i_entry+1,len(series)):
        mm,ts,s=series[i]
        if mm-mm0>TIME_STOP: break
        if exit_i and i>exit_i: break
        move = (s0-s)/s0 if is_call else (s-s0)/s0  # adverse positive
        adv=max(adv,move)
    return adv

# ---- Entry-timing analysis ----
def entry_timing(ratio_mode="fixed"):
    lvl=[]; conf=[]; uncond=[]; events_log=[]; conf_all=[]; lvl_paired=[]
    for d in DAYS:
        series=SERIES[d]
        if not series: continue
        iv=IV[d]
        for (L,Lspx) in active_levels(d,ratio_mode):
            for (i,mm,ts,s,side) in approaches(series,Lspx):
                hold,brk,bounce,drift=classify_and_drift(series,i,mm,s,side,Lspx)
                is_call=side>0
                lo,hi=window_extremes(series,i)
                # LEVEL entry (unconditional set: every approach)
                pnl,exts,why=simulate_trade(series,i,side,Lspx,iv,exit_on_break=True)
                eq = (hi-s)/(hi-lo) if is_call and hi>lo else ((s-lo)/(hi-lo) if hi>lo else 0.5)
                mae=mae_after(series,i,is_call)
                rec=dict(day=d,level=L["id"],tier=L["tier"],mm=mm,ts=ts,side=side,
                    is_call=is_call,hold=hold,eq=eq,mae=mae,pnl=pnl,why=why,
                    Lspx=Lspx,spot=s,exit_ts=exts,drift=drift,bounce=bounce)
                uncond.append(rec)
                events_log.append(dict(day=d,ticker="SPXW",minute=ts,
                    strike=f"{round(s/5)*5}:{round(s,1)}@entry",kind="mdp",
                    implied=("up" if is_call else "down"),exit_minute=exts,
                    outcome=("win" if pnl>0 else "loss"),pnl_pct=round(pnl*100,2)))
                # CONFIRMATION over ALL approaches (the tradeable chase): enter iff reclaim
                ci=find_confirmation(series,i,side,Lspx)
                confrec=None
                if ci is not None:
                    pnlc,extc,whyc=simulate_trade(series,ci,side,Lspx,iv,exit_on_break=True)
                    sc=series[ci][2]
                    eqc = (hi-sc)/(hi-lo) if is_call and hi>lo else ((sc-lo)/(hi-lo) if hi>lo else 0.5)
                    maec=mae_after(series,ci,is_call)
                    confrec=dict(day=d,level=L["id"],tier=L["tier"],side=side,is_call=is_call,
                        eq=eqc,mae=maec,pnl=pnlc,why=whyc,hold=hold)
                    conf_all.append(confrec)
                if hold:
                    lvl.append(rec)
                    if confrec is not None:
                        conf.append(confrec)          # confirmation on holds
                        lvl_paired.append(rec)         # level on same paired holds
    return lvl,conf,uncond,events_log,conf_all,lvl_paired

def agg(recs,key):
    xs=[r[key] for r in recs if r[key] is not None]
    return statistics.mean(xs) if xs else float('nan')
def winrate(recs):
    xs=[r["pnl"] for r in recs if r["pnl"] is not None]
    return sum(1 for x in xs if x>0)/len(xs) if xs else float('nan')
def expct(recs):
    xs=[r["pnl"] for r in recs if r["pnl"] is not None]
    return statistics.mean(xs)*100 if xs else float('nan')

# ---- Random-timing control: enter at random minutes, matched count/day, random side ----
def random_timing(n_per_day, ratio_mode="fixed", seed=0):
    recs=[]
    for d in DAYS:
        series=SERIES[d]
        if not series: continue
        iv=IV[d]; nn=n_per_day.get(d,0)
        rnd=random.Random(zlib.crc32((d+"rt"+str(seed)).encode()))
        # need a reference level for structural stop: use nearest active level to entry
        acts=active_levels(d,ratio_mode)
        idxs=[k for k in range(2,len(series)-2)]
        if not idxs: continue
        for _ in range(nn):
            i=rnd.choice(idxs); side=1 if rnd.random()<0.5 else -1
            s=series[i][2]
            if acts: Lspx=min([a[1] for a in acts], key=lambda x:abs(x-s))
            else: Lspx=s
            pnl,exts,why=simulate_trade(series,i,side,Lspx,iv,exit_on_break=True)
            recs.append(dict(day=d,pnl=pnl,side=side))
    return recs

# ================= RUN =================
print("="*70); print("RATIOS per day (median OHLC SPX/SPY):")
for d in DAYS: print(f"  {d} ratio={RATIO[d]:.4f} iv={IV[d]}")

for mode in ["fixed","perday"]:
    print("\n"+"#"*70); print(f"### MIRROR — ratio_mode={mode}")
    rows=run_mirror(mode)
    for k in ["real","mirror","random"]:
        print(f"  {k:7s}", summ(rows,k))
    print("  -- REAL by tier --")
    for t in ["mega_mega","mega","sub"]:
        print(f"    {t:10s}", summ(rows,"real",lambda x,t=t:x["tier"]==t))
    print("  -- REAL by side (support=+1/resistance=-1) --")
    for sd,nm in [(1,"support"),(-1,"resistance")]:
        print(f"    {nm:10s}", summ(rows,"real",lambda x,sd=sd:x["side"]==sd))
    print("  -- MEGA_MEGA+MEGA support vs its MIRROR support --")
    print("     real  supp>=mega", summ(rows,"real",lambda x:x["side"]==1 and x["tier"] in("mega","mega_mega")))
    print("     mirror supp>=mega", summ(rows,"mirror",lambda x:x["side"]==1 and x["tier"] in("mega","mega_mega")))

# store fixed-mode rows for bootstrap
ROWS_FIXED=run_mirror("fixed")

# ---- Entry timing (fixed primary) ----
print("\n"+"#"*70); print("### ENTRY TIMING (fixed ratio primary)")
lvl,conf,uncond,elog,conf_all,lvl_paired=entry_timing("fixed")
print(f"HOLD approaches (conditional level-entry n): {len(lvl)}")
print(f"ALL approaches (unconditional n): {len(uncond)}")
print("\nCONDITIONAL (holds only) — level vs confirmation:")
print(f"  LEVEL-entry  (all holds)  : eq={agg(lvl,'eq'):.3f}  MAE={agg(lvl,'mae')*1e4:.1f}bps  win={winrate(lvl):.3f}  exp={expct(lvl):+.2f}%  n={len(lvl)}")
print(f"  LEVEL-entry  (paired only): eq={agg(lvl_paired,'eq'):.3f}  MAE={agg(lvl_paired,'mae')*1e4:.1f}bps  win={winrate(lvl_paired):.3f}  exp={expct(lvl_paired):+.2f}%  n={len(lvl_paired)}")
print(f"  CONFIRM-entry(paired holds): eq={agg(conf,'eq'):.3f}  MAE={agg(conf,'mae')*1e4:.1f}bps  win={winrate(conf):.3f}  exp={expct(conf):+.2f}%  n={len(conf)}")
print("\nHEAD-TO-HEAD over ALL approaches (the real A/B: chase vs enter-at-level):")
print(f"  LEVEL-all     : eq={agg(uncond,'eq'):.3f}  MAE={agg(uncond,'mae')*1e4:.1f}bps  win={winrate(uncond):.3f}  exp={expct(uncond):+.2f}%  n={len(uncond)}")
print(f"  CONFIRM-all   : eq={agg(conf_all,'eq'):.3f}  MAE={agg(conf_all,'mae')*1e4:.1f}bps  win={winrate(conf_all):.3f}  exp={expct(conf_all):+.2f}%  n={len(conf_all)}")
cah=[c for c in conf_all if c['hold']]; cab=[c for c in conf_all if not c['hold']]
print(f"    confirm on HOLDs : win={winrate(cah):.3f} exp={expct(cah):+.2f}% n={len(cah)}")
print(f"    confirm on BREAKs: win={winrate(cab):.3f} exp={expct(cab):+.2f}% n={len(cab)}")
print("\nlevel-vs-confirm MEGA_MEGA+MEGA only (holds):")
lm=[x for x in lvl if x['tier'] in('mega','mega_mega')]; cm=[x for x in conf if x['tier'] in('mega','mega_mega')]
print(f"  LEVEL  : eq={agg(lm,'eq'):.3f} MAE={agg(lm,'mae')*1e4:.1f}bps win={winrate(lm):.3f} exp={expct(lm):+.2f}% n={len(lm)}")
print(f"  CONFIRM: eq={agg(cm,'eq'):.3f} MAE={agg(cm,'mae')*1e4:.1f}bps win={winrate(cm):.3f} exp={expct(cm):+.2f}% n={len(cm)}")
print("\nUNCONDITIONAL (every approach, structural stop):")
print(f"  LEVEL-all   : eq={agg(uncond,'eq'):.3f}  MAE={agg(uncond,'mae')*1e4:.1f}bps  win={winrate(uncond):.3f}  exp={expct(uncond):+.2f}%  n={len(uncond)}")
holds=[u for u in uncond if u["hold"]]; breaks=[u for u in uncond if not u["hold"]]
print(f"    of which HOLD  : win={winrate(holds):.3f} exp={expct(holds):+.2f}% n={len(holds)}")
print(f"    of which BREAK : win={winrate(breaks):.3f} exp={expct(breaks):+.2f}% n={len(breaks)}")
print("  by tier (unconditional):")
for t in ["mega_mega","mega","sub"]:
    sub=[u for u in uncond if u["tier"]==t]
    print(f"    {t:10s} win={winrate(sub):.3f} exp={expct(sub):+.2f}% n={len(sub)}")
print("  by side (unconditional):")
for sd,nm in [(1,"support/call"),(-1,"resistance/put")]:
    sub=[u for u in uncond if u["side"]==sd]
    print(f"    {nm:14s} win={winrate(sub):.3f} exp={expct(sub):+.2f}% n={len(sub)}")

# random-timing matched to unconditional approach count per day
npd={}
for u in uncond: npd[u["day"]]=npd.get(u["day"],0)+1
rt_w=[]; rt_e=[]
for sd in range(30):
    rt=random_timing(npd,"fixed",seed=sd)
    rt_w.append(sum(1 for x in rt if x['pnl']>0)/len(rt)); rt_e.append(statistics.mean([x['pnl'] for x in rt])*100)
print(f"\nRANDOM-TIMING (avg of 30 seeds, matched n≈{len(rt)}): win={statistics.mean(rt_w):.3f} exp={statistics.mean(rt_e):+.2f}% (exp range {min(rt_e):+.1f}..{max(rt_e):+.1f})")

# spot-based directional win (model-free): did implied direction realize at +30min drift>0
sp_lvl=sum(1 for x in lvl if x["bounce"] is not None and x["bounce"]>0)/max(1,sum(1 for x in lvl if x["bounce"] is not None))
print(f"\nModel-free directional check (holds, bounce30>0 rate): {sp_lvl:.3f}")

# ---- Walk-forward halves (unconditional expectancy & mirror reversal) ----
H1=set(DAYS[:10]); H2=set(DAYS[10:])
print("\n"+"#"*70); print("### WALK-FORWARD HALVES (fixed)")
for nm,dd in [("H1 "+DAYS[0]+".."+DAYS[9],H1),("H2 "+DAYS[10]+".."+DAYS[19],H2)]:
    rr=[x for x in ROWS_FIXED if x["day"] in dd]
    real=summ(rr,"real"); mir=summ(rr,"mirror")
    uu=[u for u in uncond if u["day"] in dd]
    print(f"  {nm}: real hold={real['hold_rate']:.3f} rev={real['rev_rate']:.3f} bps={real['bounce_bps']:+.1f} (n={real['full']}) | "
          f"mirror hold={mir['hold_rate']:.3f} rev={mir['rev_rate']:.3f} | uncond exp={expct(uu):+.2f}% win={winrate(uu):.3f} n={len(uu)}")

# ---- Day-block bootstrap: real-minus-mirror reversal & bounce; uncond expectancy CI ----
def bootstrap(rows, uncond, nboot=2000):
    days=DAYS[:]
    by={d:{"real":[],"mirror":[],"unc":[]} for d in days}
    for x in rows:
        if x["kind"]=="real" and x["bounce"] is not None: by[x["day"]]["real"].append(x)
        if x["kind"]=="mirror" and x["bounce"] is not None: by[x["day"]]["mirror"].append(x)
    for u in uncond:
        if u["pnl"] is not None: by[u["day"]]["unc"].append(u)
    drev=[]; dbp=[]; uexp=[]
    rnd=random.Random(42)
    for _ in range(nboot):
        samp=[rnd.choice(days) for _ in days]
        r=[]; m=[]; un=[]
        for d in samp:
            r+=by[d]["real"]; m+=by[d]["mirror"]; un+=by[d]["unc"]
        if r and m:
            rr=sum(1 for x in r if x["bounce"]>0)/len(r)
            mr=sum(1 for x in m if x["bounce"]>0)/len(m)
            drev.append(rr-mr)
            dbp.append((statistics.mean([x["bounce"] for x in r])-statistics.mean([x["bounce"] for x in m]))*1e4)
        if un: uexp.append(statistics.mean([x["pnl"] for x in un])*100)
    def ci(a):
        a=sorted(a); n=len(a); return a[int(0.05*n)],statistics.mean(a),a[int(0.95*n)-1]
    print("\n"+"#"*70); print("### DAY-BLOCK BOOTSTRAP (2000x, fixed)")
    lo,me,hi=ci(drev); print(f"  real-minus-mirror REVERSAL diff: mean {me:+.3f} CI90 ({lo:+.3f},{hi:+.3f})")
    lo,me,hi=ci(dbp);  print(f"  real-minus-mirror BOUNCE bps diff: mean {me:+.2f} CI90 ({lo:+.2f},{hi:+.2f})")
    lo,me,hi=ci(uexp); print(f"  UNCONDITIONAL expectancy %/trade : mean {me:+.2f} CI90 ({lo:+.2f},{hi:+.2f})")
bootstrap(ROWS_FIXED, uncond)

# ---- paired level-minus-confirm expectancy bootstrap (holds w/ confirmation) ----
def boot_pair(lvl_p, conf_p, nboot=2000):
    byL={d:[] for d in DAYS}; byC={d:[] for d in DAYS}
    for r in lvl_p: byL[r["day"]].append(r["pnl"])
    for r in conf_p: byC[r["day"]].append(r["pnl"])
    diffs=[]; rnd=random.Random(7)
    for _ in range(nboot):
        samp=[rnd.choice(DAYS) for _ in DAYS]
        lp=[]; cp=[]
        for d in samp: lp+=byL[d]; cp+=byC[d]
        if lp and cp: diffs.append((statistics.mean(lp)-statistics.mean(cp))*100)
    diffs.sort(); n=len(diffs)
    print(f"  paired LEVEL-minus-CONFIRM expectancy diff: mean {statistics.mean(diffs):+.2f}% "
          f"CI90 ({diffs[int(0.05*n)]:+.2f},{diffs[int(0.95*n)-1]:+.2f})")
print("### ENTRY-TIMING EDGE BOOTSTRAP")
boot_pair(lvl_paired, conf)

# ---- Is the level-vs-confirm edge specific to DP levels? Repeat on PHANTOM levels ----
def entry_timing_phantom():
    plvl=[]; pconf=[]
    for d in DAYS:
        series=SERIES[d]
        if not series: continue
        iv=IV[d]; openpx=series[0][2]
        for (L,Lspx) in active_levels(d,"fixed"):
            P=2*openpx-Lspx
            if P<=0: continue
            for (i,mm,ts,s,side) in approaches(series,P):
                hold,brk,bounce,drift=classify_and_drift(series,i,mm,s,side,P)
                if not hold: continue
                is_call=side>0; lo,hi=window_extremes(series,i)
                pnl,exts,why=simulate_trade(series,i,side,P,iv,exit_on_break=True)
                eq=(hi-s)/(hi-lo) if is_call and hi>lo else ((s-lo)/(hi-lo) if hi>lo else 0.5)
                ci=find_confirmation(series,i,side,P)
                if ci is None: continue
                pnlc,extc,whyc=simulate_trade(series,ci,side,P,iv,exit_on_break=True)
                sc=series[ci][2]; eqc=(hi-sc)/(hi-lo) if is_call and hi>lo else ((sc-lo)/(hi-lo) if hi>lo else 0.5)
                plvl.append(dict(eq=eq,pnl=pnl,mae=mae_after(series,i,is_call)))
                pconf.append(dict(eq=eqc,pnl=pnlc,mae=mae_after(series,ci,is_call)))
    return plvl,pconf
plvl,pconf=entry_timing_phantom()
print("\n### CONTROL: level-vs-confirm on PHANTOM holds (is the edge DP-specific or generic execution?)")
print(f"  PHANTOM LEVEL-entry  : eq={agg(plvl,'eq'):.3f} MAE={agg(plvl,'mae')*1e4:.1f}bps win={winrate(plvl):.3f} exp={expct(plvl):+.2f}% n={len(plvl)}")
print(f"  PHANTOM CONFIRM-entry: eq={agg(pconf,'eq'):.3f} MAE={agg(pconf,'mae')*1e4:.1f}bps win={winrate(pconf):.3f} exp={expct(pconf):+.2f}% n={len(pconf)}")

# ---- look-ahead-safe (prior-day levels only) mirror ----
print("\n"+"#"*70); print("### LOOK-AHEAD-SAFE (prior-day levels only, fixed)")
rows_la=run_mirror("fixed",prior_only=True)
for k in ["real","mirror"]:
    print(f"  {k:7s}", summ(rows_la,k))

# ---- write event log ----
with open(os.path.join(OUT,"mega_dp_events.jsonl"),"w") as f:
    for e in elog: f.write(json.dumps(e)+"\n")
print(f"\nwrote {len(elog)} events to mega_dp_events.jsonl")

# ---- reproduce motivating fact ----
print("\n"+"#"*70); print("### MOTIVATING FACT (L7526, fixed 7526.3)")
for d in ["2026-07-14","2026-07-15"]:
    s=SERIES[d]; lo=min(x[2] for x in s);
    below=sum(1 for x in s if x[2]<7526.3)
    print(f"  {d}: low={lo:.1f} (low-7526.3={lo-7526.3:+.1f}) minutes_below={below}")
