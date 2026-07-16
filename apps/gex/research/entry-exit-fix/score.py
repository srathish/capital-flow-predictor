# Score the 3x3 entry x exit grid on REAL SPXW option marks (RESEARCH ONLY).
# Entry at ASK, exit at BID. Spread = max(observed ask/bid width, max(3% price, $0.10)),
# anchored to the close (avoids intra-minute VWAP-level noise). Rules trigger on the
# close (mark); fills realize at ask (buy) / bid (sell).
import json, os, glob, random, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
EOD_UTC = 19*60+45          # 15:45 ET
ENTRY_CAP = 19*60+40
OPEN_UTC = 14*60
STALL_MIN = 12
PIVOT_EPS = 0.0005
random.seed(20260715)

events = json.load(open(os.path.join(HERE, 'events.json')))
paths  = json.load(open(os.path.join(HERE, 'spotpaths.json')))

def load_opt(sym, day):
    f = os.path.join(HERE, 'optcache', f'{sym}_{day}.json')
    if not os.path.exists(f): return None
    rows = json.load(open(f))
    m = {}
    for r in rows:
        if 'start_time' in r:
            ts = r['start_time']; mi = int(ts[11:13])*60+int(ts[14:16])
        elif 'ts' in r:
            mi = (int(r['ts'])//60000) % 1440      # mark-only live schema
        else:
            continue
        try: close = float(r['close'])
        except: continue
        if close <= 0: continue
        va = r.get('volume_ask_side') or 0; vb = r.get('volume_bid_side') or 0
        pa = r.get('premium_ask_side') or 0; pb = r.get('premium_bid_side') or 0
        obs = 0.0
        if va > 0 and vb > 0 and pa > 0 and pb > 0:
            ask_raw = pa/va/100; bid_raw = pb/vb/100
            w = ask_raw - bid_raw
            if 0 < w < close: obs = w
        spread = max(0.03*close, 0.10, obs)
        m[mi] = {'close': close, 'half': spread/2}
    return m

def bar_at(m, mi, back=3):
    for k in range(mi, mi-back-1, -1):
        if k in m: return m[k]
    return None

def sim_exit(kind, om, spath, me, cost, dirn, pivot):
    """Return (exit_min, pnl_frac). Rules on close mark; fills at bid."""
    ext_close = None
    peak = -9.9; last_peak_min = me; armed = False
    banked = 0.0; units_left = 1.0; tier1 = tier2 = False
    minutes = sorted(k for k in om if k > me and k <= EOD_UTC)
    for mi in minutes:
        close = om[mi]['close']; half = om[mi]['half']
        g = (close - cost)/cost                 # mark gain
        bidfill = (close - half - cost)/cost     # realized if sell now
        if g > peak: peak = g; last_peak_min = mi
        if g >= 0.50: armed = True
        sp = spath.get(str(mi))
        if kind == 'X1':
            # structural pivot break (underlying) OR 12-min stall OR EOD
            brk = False
            if sp is not None:
                brk = (sp < pivot*(1-PIVOT_EPS)) if dirn > 0 else (sp > pivot*(1+PIVOT_EPS))
            if brk or (mi - last_peak_min >= STALL_MIN) or mi >= EOD_UTC:
                return mi, bidfill
        elif kind == 'X2':
            pnl = 0.0; done = False
            if not tier1 and g >= 0.50:
                pnl += (1/3)*bidfill; units_left -= 1/3; tier1 = True
            if not tier2 and g >= 1.00:
                pnl += (1/3)*bidfill; units_left -= 1/3; tier2 = True
            banked += pnl
            # final third trailing 40% giveback once armed
            if armed and tier1 and units_left > 0 and g <= 0.60*peak and peak >= 0.50:
                banked += units_left*bidfill; units_left = 0; done = True
            if done or mi >= EOD_UTC:
                if units_left > 0:                # EOD sweep remainder
                    banked += units_left*bidfill; units_left = 0
                return mi, banked
        elif kind == 'X3':
            if armed and g <= 0.50*peak:
                return mi, bidfill
            if mi >= EOD_UTC:
                return mi, bidfill
    # no bar hit EOD explicitly -> use last available
    if minutes:
        mi = minutes[-1]; b = om[mi]
        return mi, (b['close']-b['half']-cost)/cost
    return me, 0.0

def entry_metrics(ev, S, spath):
    """eq and knife-catch on the underlying for entry at spot S."""
    base = ev['base']; ext = ev['ext']; dirn = ev['dir']
    denom = (base - ext) if dirn > 0 else (ext - base)
    if denom == 0: eq = 0.0
    else:
        eq = ((base - S)/denom) if dirn > 0 else ((S - base)/denom)
    eq = max(0.0, min(1.0, eq))
    # knife: after entry minute, did underlying continue >=0.3% against before recovering past S?
    me = ev['e1_m']  # placeholder; caller passes correct minute via closure below
    return eq

def knife_catch(spath, me, S, dirn):
    worst = 0.0
    for mi in range(me+1, EOD_UTC+1):
        sp = spath.get(str(mi))
        if sp is None: continue
        if dirn > 0:
            if sp > S: break            # bounced above entry -> no knife
            adverse = (S - sp)/S
        else:
            if sp < S: break
            adverse = (sp - S)/S
        worst = max(worst, adverse)
    return worst >= 0.003

# ---- build scored trades ----
# keep only events fillable at all 3 entries
ENTRIES = ['e1', 'e2', 'e3']
EXITS = ['X1', 'X2', 'X3']
scored = []   # per (event, entry) with per-exit pnl
dropped = 0
for ev in events:
    om = load_opt(ev['sym'], ev['day'])
    if om is None: dropped += 1; continue
    spath = paths[ev['day']]
    ent = {}
    ok = True
    for e in ENTRIES:
        me = ev[f'{e}_m']
        b = bar_at(om, me)
        if b is None or me > ENTRY_CAP: ok = False; break
        cost = b['close'] + b['half']       # ASK fill
        ent[e] = {'me': me, 'cost': cost, 'bar': b}
    if not ok: dropped += 1; continue
    for e in ENTRIES:
        me = ent[e]['me']; cost = ent[e]['cost']; S = ev[f'{e}_spot']
        # MAE (option): early adverse (first 15 min = entry-timing relevant) and to-EOD.
        # MFE = peak available (to EOD).
        mae = 0.0; mae15 = 0.0; mfe = -9.9
        for mi in sorted(k for k in om if k > me and k <= EOD_UTC):
            g = (om[mi]['close']-cost)/cost
            mae = min(mae, g)
            if mi <= me + 15: mae15 = min(mae15, g)
            mfe = max(mfe, g)
        eq = entry_metrics(ev, S, spath)
        knife = knife_catch(spath, me, S, ev['dir'])
        row = {'day': ev['day'], 'dir': ev['dir'], 'sym': ev['sym'], 'strike': ev['strike'],
               'entry': e, 'me': me, 'S': S, 'cost': cost, 'eq': eq, 'mae': mae,
               'mae15': mae15, 'mfe': mfe,
               'knife': knife, 'le0': ev['ng_arm_le0'], 'pnl': {}}
        for x in EXITS:
            xm, pnl = sim_exit(x, om, spath, me, cost, ev['dir'], ev['ext'])
            row['pnl'][x] = {'exit_m': xm, 'pnl': pnl}
        scored.append(row)

json.dump(scored, open(os.path.join(HERE, 'scored.json'), 'w'))
print(f"events={len(events)} dropped(no fill)={dropped} scored-entries={len(scored)} (per entry variant = {len(scored)//3})")

# ---- random-timing control: same events/contracts, random gated entry minute ----
random_rows = []
for ev in events:
    om = load_opt(ev['sym'], ev['day'])
    if om is None: continue
    spath = paths[ev['day']]
    cand = [mi for mi in om if OPEN_UTC <= mi <= ENTRY_CAP]
    if not cand: continue
    me = random.choice(cand)
    b = om[me]; cost = b['close'] + b['half']
    r = {'day': ev['day'], 'le0': ev['ng_arm_le0'], 'pnl': {}}
    for x in EXITS:
        xm, pnl = sim_exit(x, om, spath, me, cost, ev['dir'], ev['ext'])
        r['pnl'][x] = pnl
    random_rows.append(r)
json.dump(random_rows, open(os.path.join(HERE, 'random.json'), 'w'))
print(f"random control rows={len(random_rows)}")
