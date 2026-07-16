"""Fetch REAL 0DTE ATM option intraday prints for each episode; price trades.
entry=long call(floor)/long put(ceil) at ATM strike, entry@ask exit@bid,
round-trip spread = max(observed,1.0%) -> operator-verified ~1.1%. Stop -50%."""
import json, os, subprocess, time, gzip

SP=os.path.dirname(os.path.abspath(__file__))
CACHE=os.path.join(SP,"prints_cache"); os.makedirs(CACHE,exist_ok=True)
ALL=json.load(open(os.path.join(SP,"events.json")))
for pct,ev in ALL.items():
    for e in ev: e["drift"]={int(k):v for k,v in e["drift"].items()}

def key():
    for line in open("/Users/saiyeeshrathish/the final plan/.env"):
        if line.startswith("UNUSUAL_WHALES_API_KEY="):
            return line.split("=",1)[1].strip().strip('"').strip("'")
K=key()

def occ(date, strike, cp):
    ymd=date[2:].replace("-","")
    return f"SPXW{ymd}{cp}{int(round(strike)*1000):08d}"

def mi_of(ts):  # UTC ISO -> minute from 13:30
    hh=int(ts[11:13]); mm=int(ts[14:16]); return (hh-13)*60+(mm-30)

def fetch_contract(date, o):
    cf=os.path.join(CACHE,f"{o}_{date}.json")
    if os.path.exists(cf):
        return json.load(open(cf))
    url=f"https://api.unusualwhales.com/api/option-contract/{o}/intraday?date={date}"
    for attempt in range(3):
        out=subprocess.run(["curl","-s",url,"-H",f"Authorization: Bearer {K}",
                            "-H","User-Agent: bellwether-research/1.0"],capture_output=True,text=True).stdout
        try:
            d=json.loads(out); rows=d.get("data",[])
        except Exception:
            time.sleep(0.5); continue
        m={}
        for r in rows:
            mi=mi_of(r["start_time"])
            try:
                m[mi]={"c":float(r["close"]),"o":float(r["open"]),
                       "h":float(r["high"]),"l":float(r["low"]),"a":float(r["avg_price"])}
            except Exception: pass
        json.dump(m,open(cf,"w"))
        time.sleep(0.12)
        return m
    json.dump({},open(cf,"w")); return {}

# ATM contract per episode (dedup fetch)
def contract_for(e):
    strike=round(e["spot"]/5)*5
    cp="C" if e["side"]=="floor" else "P"
    return e["day"], occ(e["day"],strike,cp), strike, cp

if __name__=="__main__":
    ev=ALL["0.0015"]
    need={}
    for e in ev:
        day,o,st,cp=contract_for(e)
        need[(day,o)]=1
    print("unique contracts to fetch:", len(need))
    i=0
    for (day,o) in need:
        fetch_contract(day,o); i+=1
        if i%50==0: print("  fetched",i,"/",len(need))
    print("done fetching")
