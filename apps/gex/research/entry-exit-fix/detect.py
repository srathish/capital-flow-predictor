# Reversal-setup detector (RESEARCH ONLY, Clause 0).
# SPX gamma-RELEASED reversal. Emits events with E1/E2/E3 entry minutes on the
# SAME event, plus the day spot path + swing anchors. Writes:
#   events.json      : one row per confirmed event (all 3 entries exist)
#   contracts.json   : unique {day, occ, strike, dir} needed for option pulls
#   detect_stats.json: arm/confirm counts, gate coverage
import gzip, json, os, glob, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
BACKFILL = os.path.join(HERE, '..', 'velocity-capture', 'backfill')

# --- params (pre-registered) ---
GATE_PRIMARY = 40e6      # net near-spot gamma <= +40M
NEAR_FRAC    = 0.005     # within 0.5% of spot
DROP_PCT     = 0.0025    # >=0.25% swing
HIGH_LOOKBACK= 20        # bars to find recent swing high/low
CONFIRM_WIN  = 20        # E3 must confirm within 20 min of arm
COOLDOWN_MIN = 5
MAX_PER_DAY  = 6
OPEN_UTC     = 14*60     # 10:00 ET
ENTRY_CAP_UTC= 19*60+40  # 15:40 ET (must leave hold room; EOD flat 15:45)
EOD_UTC      = 19*60+45  # 15:45 ET

def utcmin(ts):
    # "2026-07-14T13:30:00.000Z" -> minutes since 00:00 UTC
    t = ts[11:16]
    return int(t[:2])*60 + int(t[3:5])

def occ(day, dir_, K):
    yy, mm, dd = day[2:4], day[5:7], day[8:10]
    cp = 'C' if dir_ > 0 else 'P'
    return f"SPXW{yy}{mm}{dd}{cp}{round(K*1000):08d}"

def load_day(path):
    bars = []
    with gzip.open(path, 'rt') as f:
        for line in f:
            line = line.strip()
            if not line: continue
            o = json.loads(line)
            spot = o['spot']
            lo, hi = spot*(1-NEAR_FRAC), spot*(1+NEAR_FRAC)
            g = sum(s['gamma'] for s in o['strikes'] if lo <= s['strike'] <= hi)
            bars.append({'ts': o['requestedTs'], 'm': utcmin(o['requestedTs']),
                         'spot': spot, 'ng': g})
    return bars

events = []
contracts = {}
stats = {'days':0, 'arm':0, 'confirmed':0, 'dropped_noconfirm':0,
         'gate_pass_bars':0, 'total_bars':0, 'call':0, 'put':0}

days = sorted(os.path.basename(os.path.dirname(p))
              for p in glob.glob(os.path.join(BACKFILL, '*', 'SPXW.jsonl.gz')))

for day in days:
    path = os.path.join(BACKFILL, day, 'SPXW.jsonl.gz')
    bars = load_day(path)
    if len(bars) < 60: continue
    stats['days'] += 1
    n = len(bars)
    spot = [b['spot'] for b in bars]
    mm   = [b['m'] for b in bars]
    ng   = [b['ng'] for b in bars]
    stats['total_bars'] += n
    stats['gate_pass_bars'] += sum(1 for i in range(n) if mm[i]>=OPEN_UTC and ng[i]<=GATE_PRIMARY)

    fired = 0
    last_fire_m = -999
    i = HIGH_LOOKBACK
    while i < n and fired < MAX_PER_DAY:
        m = mm[i]
        if m < OPEN_UTC or m > ENTRY_CAP_UTC:
            i += 1; continue
        if m - last_fire_m < COOLDOWN_MIN:
            i += 1; continue
        if ng[i] > GATE_PRIMARY:   # gate at arm bar
            i += 1; continue
        win = spot[max(0,i-HIGH_LOOKBACK):i+1]
        H = max(win); Lo = min(win)
        drop = (H - spot[i]) / H
        pop  = (spot[i] - Lo) / Lo
        arm_dir = 0
        if drop >= DROP_PCT: arm_dir = 1      # down-swing -> CALL reversal
        elif pop >= DROP_PCT: arm_dir = -1    # up-swing -> PUT reversal
        if arm_dir == 0:
            i += 1; continue
        arm = i
        # find E2 (first reversing close), E3 (2 consecutive), within CONFIRM_WIN
        e2 = e3 = None
        for j in range(arm+1, min(n, arm+CONFIRM_WIN+1)):
            up = spot[j] > spot[j-1]
            rev = up if arm_dir > 0 else (not up)
            prev_up = spot[j-1] > spot[j-2] if j-2 >= 0 else False
            prev_rev = prev_up if arm_dir > 0 else (not prev_up)
            if rev and e2 is None:
                e2 = j
            if rev and prev_rev and j-1 > arm:   # two consecutive reversing closes after arm
                e3 = j; break
        if e3 is None:
            stats['arm'] += 1; stats['dropped_noconfirm'] += 1
            last_fire_m = m; fired += 1     # arm consumes budget+cooldown even if unconfirmed
            i = arm+1; continue
        # realized swing extreme (trough for call / peak for put) over [arm, e3+5]
        seg = spot[arm:min(n, e3+6)]
        L = min(seg) if arm_dir > 0 else max(seg)
        base = H if arm_dir > 0 else Lo   # origin of the swing (recent high/low)
        armSpot = spot[arm]
        K = round(armSpot/5)*5
        sym = occ(day, arm_dir, K)
        ev = {
            'day': day, 'dir': arm_dir, 'sym': sym, 'strike': K,
            'armSpot': armSpot, 'H': H, 'Lo': Lo, 'base': base, 'ext': L, 'L': L,
            'arm_ts': bars[arm]['ts'], 'arm_m': mm[arm],
            'e1_m': mm[arm], 'e1_spot': spot[arm],
            'e2_m': mm[e2],  'e2_spot': spot[e2],
            'e3_m': mm[e3],  'e3_spot': spot[e3],
            'ng_arm': ng[arm],
            'ng_arm_le0': bool(ng[arm] <= 0),
        }
        events.append(ev)
        contracts[f"{day}|{sym}"] = {'day': day, 'sym': sym, 'strike': K, 'dir': arm_dir}
        stats['arm'] += 1; stats['confirmed'] += 1
        stats['call' if arm_dir>0 else 'put'] += 1
        last_fire_m = mm[arm]; fired += 1
        i = e3 + 1
    # end while
# also store per-day spot path for scoring (minute UTC -> spot)
paths = {}
for day in days:
    path = os.path.join(BACKFILL, day, 'SPXW.jsonl.gz')
    bars = load_day(path)
    paths[day] = {str(b['m']): b['spot'] for b in bars}

json.dump(events, open(os.path.join(HERE, 'events.json'), 'w'))
json.dump(list(contracts.values()), open(os.path.join(HERE, 'contracts.json'), 'w'))
json.dump(paths, open(os.path.join(HERE, 'spotpaths.json'), 'w'))
json.dump(stats, open(os.path.join(HERE, 'detect_stats.json'), 'w'), indent=2)

print("days:", stats['days'])
print("total bars:", stats['total_bars'], " gate<=40M & post-10:00 bars:", stats['gate_pass_bars'],
      f"({100*stats['gate_pass_bars']/stats['total_bars']:.0f}%)")
print("armed:", stats['arm'], " confirmed(E3):", stats['confirmed'],
      " dropped(no confirm):", stats['dropped_noconfirm'])
print("confirmed events -> CALL:", stats['call'], " PUT:", stats['put'])
print("unique contracts to pull:", len(contracts))
le0 = sum(1 for e in events if e['ng_arm_le0'])
print("confirmed events with gate<=0 (strict tier):", le0)
byday = {}
for e in events: byday[e['day']] = byday.get(e['day'],0)+1
print("days with >=1 event:", len(byday), " median events/day:",
      sorted(byday.values())[len(byday)//2] if byday else 0)
