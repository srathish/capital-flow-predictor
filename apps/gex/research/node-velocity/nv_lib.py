"""Node-velocity telegraph study — shared library (pure stdlib)."""
import os, json, gzip, glob, math

BACKFILL = "/Users/saiyeeshrathish/the final plan/apps/gex/research/velocity-capture/backfill"

def minute_index(ts):
    # ts like 2026-07-14T13:30:00.000Z -> minutes from 13:30 UTC
    hh = int(ts[11:13]); mm = int(ts[14:16])
    return (hh-13)*60 + (mm-30)

def load_day(date):
    """Return dict: {midx: {'spot':float,'g':{strike:gamma},'v':{strike:vanna},'ts':ts}}"""
    f = os.path.join(BACKFILL, date, "SPXW.jsonl.gz")
    if not os.path.exists(f): return None
    out = {}
    with gzip.open(f, "rt") as fh:
        for line in fh:
            line=line.strip()
            if not line: continue
            d=json.loads(line)
            mi=minute_index(d["requestedTs"])
            g={}; v={}
            for s in d["strikes"]:
                st=s["strike"]; g[st]=s["gamma"]; v[st]=s["vanna"]
            out[mi]={"spot":d["spot"],"g":g,"v":v,"ts":d["requestedTs"]}
    return out

def usable_days():
    days=[]
    for p in sorted(glob.glob(os.path.join(BACKFILL,"*"))):
        date=os.path.basename(p)
        f=os.path.join(p,"SPXW.jsonl.gz")
        if not os.path.exists(f): continue
        # count recs cheaply
        n=0
        with gzip.open(f,"rt") as fh:
            for _ in fh: n+=1
        days.append((date,n))
    return days

def zigzag(series, pct):
    """series: list of (midx, price) sorted by midx. Returns pivots list of (midx,price,kind)."""
    piv=[]
    n=len(series)
    if n<2: return piv
    ref_idx,ref_price = series[0]
    ext_idx,ext_price = series[0]
    direction=0
    for k in range(1,n):
        mi,p = series[k]
        if direction==0:
            if (p-ref_price)/ref_price >= pct:
                direction=1; ext_idx,ext_price=mi,p
            elif (ref_price-p)/ref_price >= pct:
                direction=-1; ext_idx,ext_price=mi,p
        elif direction==1:
            if p>ext_price:
                ext_idx,ext_price=mi,p
            elif (ext_price-p)/ext_price >= pct:
                piv.append((ext_idx,ext_price,'H'))
                direction=-1; ext_idx,ext_price=mi,p
        else:
            if p<ext_price:
                ext_idx,ext_price=mi,p
            elif (p-ext_price)/ext_price >= pct:
                piv.append((ext_idx,ext_price,'L'))
                direction=1; ext_idx,ext_price=mi,p
    return piv

def strongest_node(rec, spot, side, band=0.002):
    """side 'floor' -> gamma>0 strike below spot within band; 'ceil' -> above."""
    best=None; bestg=0.0
    for st,g in rec["g"].items():
        if g<=0: continue
        if side=='floor':
            if st<=spot and (spot-st)/spot<=band:
                if g>bestg: bestg=g; best=st
        else:
            if st>=spot and (st-spot)/spot<=band:
                if g>bestg: bestg=g; best=st
    return best,bestg

def nearest_strike(strikes, target):
    return min(strikes, key=lambda s: abs(s-target))

if __name__=="__main__":
    ds=usable_days()
    for d,n in ds: print(d,n)
    print("total files", len(ds))
