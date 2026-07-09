"""Build per-fire GEX/VEX structure features from the Skylit intraday archive.

Covers the feature families for studies 1-30 of the 77-study program:
concentration/shape, gradient/cliff, acceleration, asymmetry (GEX+VEX),
curvature, pin/open-field scores, wall identity+migration, flip distance+
migration, room consumed, staleness, revision shock, tape context
(opening range, prior-day levels, TWAP proxy, realized vol, round numbers).

Output: outputs/fires_structure.parquet — one row per fire in
research/uw/studies/outputs/repriced_fires.parquet, structure features joined.
"""
import gzip, json, os, bisect, math, sys
from datetime import datetime
import numpy as np
import pandas as pd

GEX_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ARCHIVE = os.path.join(GEX_ROOT, 'data/skylit-archive/intraday')
FIRES = os.path.join(GEX_ROOT, 'research/uw/studies/outputs/repriced_fires.parquet')
OUT = os.path.join(os.path.dirname(__file__), 'outputs/fires_structure.parquet')

def to_ms(iso):
    return int(datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp() * 1000)

DAYS = sorted(d for d in os.listdir(ARCHIVE) if os.path.isdir(os.path.join(ARCHIVE, d)))

_day_cache = {}
def load_day(day, ticker):
    """Return list of frames: dict(ts, spot, K (strike array), G (gamma), V (vanna))."""
    key = (day, ticker)
    if key in _day_cache:
        return _day_cache[key]
    p = os.path.join(ARCHIVE, day, f'{ticker}.jsonl.gz')
    frames = []
    if os.path.exists(p):
        for line in gzip.open(p).read().decode().strip().split('\n'):
            r = json.loads(line)
            st = r.get('strikes') or []
            if not st:
                continue
            K = np.array([s['strike'] for s in st], float)
            G = np.array([s.get('gamma') or 0.0 for s in st], float)
            V = np.array([s.get('vanna') or 0.0 for s in st], float)
            order = np.argsort(K)
            frames.append(dict(ts=to_ms(r['requestedTs']), spot=r['spot'],
                               K=K[order], G=G[order], V=V[order]))
        frames.sort(key=lambda f: f['ts'])
    if len(_day_cache) > 40:
        _day_cache.clear()
    _day_cache[key] = frames
    return frames

def frame_at(frames, tsms, max_age_ms=12 * 60_000):
    ts = [f['ts'] for f in frames]
    i = bisect.bisect_right(ts, tsms) - 1
    if i < 0 or tsms - ts[i] > max_age_ms:
        return None
    return frames[i]

def spot_series(frames):
    return [f['ts'] for f in frames], [f['spot'] for f in frames]

def spot_at(frames, tsms):
    ts, sp = spot_series(frames)
    i = bisect.bisect_right(ts, tsms) - 1
    return sp[i] if i >= 0 else None

def band_mass(K, A, lo, hi):
    m = (K > lo) & (K <= hi)
    return float(np.abs(A[m]).sum())

def surface_features(fr, dirn, pfx=''):
    """Structure features from one frame. dirn: fire direction (+1/-1)."""
    K, G, V, S = fr['K'], fr['G'], fr['V'], fr['spot']
    aG = np.abs(G)
    tot = aG.sum()
    out = {}
    if tot <= 0 or len(K) < 5:
        return None
    shares = aG / tot
    # -- shape / concentration (study 1)
    out[pfx + 'top1_share'] = float(shares.max())
    out[pfx + 'top3_share'] = float(np.sort(shares)[-3:].sum())
    out[pfx + 'hhi'] = float((shares ** 2).sum())
    out[pfx + 'density_50bps'] = band_mass(K, G, S * 0.995, S * 1.005) / tot
    out[pfx + 'density_100bps'] = band_mass(K, G, S * 0.99, S * 1.01) / tot
    # shelf width: contiguous strikes around the dominant node with |g| >= 50% of max
    imax = int(np.argmax(aG))
    half = aG[imax] * 0.5
    lo = imax
    while lo > 0 and aG[lo - 1] >= half:
        lo -= 1
    hi = imax
    while hi < len(K) - 1 and aG[hi + 1] >= half:
        hi += 1
    out[pfx + 'shelf_width_bps'] = (K[hi] - K[lo]) / S * 1e4
    # -- walls above/below (nearest DOMINANT node within 2%)
    for side, m in (('up', (K > S) & (K <= S * 1.02)), ('dn', (K < S) & (K >= S * 0.98))):
        if m.any():
            idx = np.where(m)[0]
            w = idx[np.argmax(aG[idx])]
            out[pfx + f'wall_{side}_dist_bps'] = abs(K[w] - S) / S * 1e4
            out[pfx + f'wall_{side}_share'] = float(shares[w])
            th = aG[max(0, w - 1):w + 2].sum() / tot   # thickness incl neighbors
            out[pfx + f'wall_{side}_thick'] = float(th)
            out[pfx + f'wall_{side}_isolation'] = float(aG[w] / max(1e-9, aG[max(0, w - 1):w + 2].sum()))
            out[pfx + f'wall_{side}_strike'] = float(K[w])
            out[pfx + f'wall_{side}_signed'] = float(np.sign(G[w]))
        else:
            for k in ('dist_bps', 'share', 'thick', 'isolation', 'strike', 'signed'):
                out[pfx + f'wall_{side}_{k}'] = np.nan
    # -- gradient / cliff (study 2)
    up1 = band_mass(K, G, S, S * 1.005); up2 = band_mass(K, G, S * 1.005, S * 1.01)
    dn1 = band_mass(K, G, S * 0.995, S); dn2 = band_mass(K, G, S * 0.99, S * 0.995)
    out[pfx + 'grad_up'] = (up2 - up1) / tot
    out[pfx + 'grad_dn'] = (dn2 - dn1) / tot
    out[pfx + 'slope_asym'] = out[pfx + 'grad_up'] - out[pfx + 'grad_dn']
    med = np.median(aG[aG > 0]) if (aG > 0).any() else 0
    cliff = None
    order = np.argsort(np.abs(K - S))
    for i in order:
        if aG[i] >= 4 * med and abs(K[i] - S) / S > 0.001:
            cliff = abs(K[i] - S) / S * 1e4
            break
    out[pfx + 'cliff_dist_bps'] = cliff if cliff is not None else np.nan
    # -- asymmetry (study 4/5): mass within 2% each side
    upG = band_mass(K, G, S, S * 1.02); dnG = band_mass(K, G, S * 0.98, S)
    out[pfx + 'up_gex_mass'] = upG / tot
    out[pfx + 'dn_gex_mass'] = dnG / tot
    out[pfx + 'gex_asym'] = (upG - dnG) / max(1e-9, upG + dnG)
    aV = np.abs(V); totV = aV.sum()
    if totV > 0:
        upV = band_mass(K, V, S, S * 1.02); dnV = band_mass(K, V, S * 0.98, S)
        out[pfx + 'up_vex_mass'] = upV / totV
        out[pfx + 'dn_vex_mass'] = dnV / totV
        out[pfx + 'vex_asym'] = (upV - dnV) / max(1e-9, upV + dnV)
        vm = (K >= S * 0.98) & (K <= S * 1.02)
        out[pfx + 'net_vex_local'] = float(V[vm].sum() / totV)
    else:
        for k in ('up_vex_mass', 'dn_vex_mass', 'vex_asym', 'net_vex_local'):
            out[pfx + k] = np.nan
    # -- signed local structure
    lm = (K >= S * 0.99) & (K <= S * 1.01)
    out[pfx + 'net_gex_local'] = float(G[lm].sum() / tot)
    out[pfx + 'net_gex_global'] = float(G.sum() / tot)
    # -- curvature (study 6): discrete 2nd difference of |G| profile near spot (3-strike smooth)
    sm = np.convolve(aG, np.ones(3) / 3, mode='same')
    j = int(np.argmin(np.abs(K - S)))
    if 1 <= j <= len(K) - 2:
        out[pfx + 'gex_curv'] = float((sm[j + 1] - 2 * sm[j] + sm[j - 1]) / max(1e-9, tot))
        smv = np.convolve(aV, np.ones(3) / 3, mode='same')
        out[pfx + 'vex_curv'] = float((smv[j + 1] - 2 * smv[j] + smv[j - 1]) / max(1e-9, totV)) if totV > 0 else np.nan
    else:
        out[pfx + 'gex_curv'] = np.nan; out[pfx + 'vex_curv'] = np.nan
    # -- gamma flip: nearest strike where smoothed signed G crosses zero
    smg = np.convolve(G, np.ones(3) / 3, mode='same')
    flips = np.where(np.sign(smg[:-1]) * np.sign(smg[1:]) < 0)[0]
    if len(flips):
        fk = K[flips[np.argmin(np.abs(K[flips] - S))]]
        out[pfx + 'flip_dist_bps'] = (fk - S) / S * 1e4   # signed: + means flip above spot
        out[pfx + 'flip_strike'] = float(fk)
    else:
        out[pfx + 'flip_dist_bps'] = np.nan; out[pfx + 'flip_strike'] = np.nan
    # -- direction-relative (fire direction dirn)
    fwd1 = band_mass(K, G, S, S * 1.01) if dirn > 0 else band_mass(K, G, S * 0.99, S)
    bwd1 = band_mass(K, G, S * 0.99, S) if dirn > 0 else band_mass(K, G, S, S * 1.01)
    out[pfx + 'opposing_mass'] = fwd1 / tot     # mass in the way of the trade
    out[pfx + 'behind_mass'] = bwd1 / tot
    wd = out[pfx + 'wall_up_dist_bps'] if dirn > 0 else out[pfx + 'wall_dn_dist_bps']
    ws = out[pfx + 'wall_up_share'] if dirn > 0 else out[pfx + 'wall_dn_share']
    wt = out[pfx + 'wall_up_thick'] if dirn > 0 else out[pfx + 'wall_dn_thick']
    out[pfx + 'fwd_wall_dist_bps'] = wd
    out[pfx + 'fwd_wall_share'] = ws
    out[pfx + 'fwd_wall_thick'] = wt
    out[pfx + 'open_field'] = (wd / 100.0) / (1.0 + 10.0 * out[pfx + 'opposing_mass']) if wd == wd else np.nan
    # dealer acceleration (study 3): net SIGNED gex in fire direction; negative = accelerant
    fm = ((K > S) & (K <= S * 1.01)) if dirn > 0 else ((K < S) & (K >= S * 0.99))
    out[pfx + 'accel_zone_gex'] = float(G[fm].sum() / tot)   # <0 → hedging amplifies the move
    # pin risk score (study 7): components summed
    wall_range = np.nansum([out[pfx + 'wall_up_dist_bps'], out[pfx + 'wall_dn_dist_bps']])
    out[pfx + 'wall_range_bps'] = wall_range if wall_range > 0 else np.nan
    pin = 0.0
    pin += 1.0 if out[pfx + 'net_gex_local'] > 0 else 0.0
    pin += 1.0 if out[pfx + 'density_50bps'] > 0.25 else 0.0
    pin += 1.0 if (wall_range and wall_range < 60) else 0.0
    pin += 1.0 if out[pfx + 'top1_share'] > 0.18 and min(out[pfx + 'wall_up_dist_bps'] or 99, out[pfx + 'wall_dn_dist_bps'] or 99) < 25 else 0.0
    out[pfx + 'pin_score'] = pin
    return out

def realized_vol(frames, tsms, back_ms):
    ts, sp = spot_series(frames)
    lo, hi = tsms - back_ms, tsms
    xs = [s for t, s in zip(ts, sp) if lo <= t <= hi]
    if len(xs) < 3:
        return np.nan
    r = np.diff(np.log(xs))
    return float(np.sqrt((r ** 2).sum()) * 1e4)   # bps realized move

def main():
    df = pd.read_parquet(FIRES)
    rows = []
    for n, (_, r) in enumerate(df.iterrows()):
        day, tic, tsms, dirn = r['day'], r['ticker'], int(r['fireTsMs']), int(r['dir'])
        frames = load_day(day, tic)
        if not frames:
            rows.append({}); continue
        fr = frame_at(frames, tsms)
        if fr is None:
            rows.append({}); continue
        out = surface_features(fr, dirn) or {}
        out['frame_age_min'] = (tsms - fr['ts']) / 60_000
        s_now = spot_at(frames, tsms)
        out['stale_move_bps'] = abs(s_now - fr['spot']) / fr['spot'] * 1e4 if s_now else np.nan

        # migration & revision: compare with frames 30m back and day open
        for lbl, back in (('m30', 30 * 60_000),):
            fb = frame_at(frames, tsms - back)
            if fb is not None:
                old = surface_features(fb, dirn, pfx='_') or {}
                for k_new, k_old, name in (
                        ('wall_up_strike', '_wall_up_strike', 'wall_up_mig_bps'),
                        ('wall_dn_strike', '_wall_dn_strike', 'wall_dn_mig_bps'),
                        ('flip_strike', '_flip_strike', 'flip_mig_bps')):
                    a, b = out.get(k_new), old.get(k_old)
                    if a == a and b == b and a is not None and b is not None:
                        out[f'{lbl}_{name}'] = (a - b) / fr['spot'] * 1e4
                px_move = (fr['spot'] - fb['spot']) / fb['spot'] * 1e4
                out[f'{lbl}_px_move_bps'] = px_move
                fwd_mig = out.get(f'{lbl}_wall_up_mig_bps') if dirn > 0 else out.get(f'{lbl}_wall_dn_mig_bps')
                if fwd_mig is not None and fwd_mig == fwd_mig:
                    out[f'{lbl}_fwd_wall_mig_bps'] = fwd_mig * dirn   # + = wall moving away in fire dir
                    out[f'{lbl}_wall_with_price'] = 1.0 if (fwd_mig * dirn > 2 and px_move * dirn > 0) else 0.0
        # revision shock vs previous frame
        idx = [f['ts'] for f in frames].index(fr['ts'])
        if idx > 0:
            fp = frames[idx - 1]
            out['rev_gex_pct'] = (np.abs(fr['G']).sum() - np.abs(fp['G']).sum()) / max(1e-9, np.abs(fp['G']).sum())
            old = surface_features(fp, dirn, pfx='_') or {}
            a, b = out.get('wall_up_strike'), old.get('_wall_up_strike')
            if a == a and b == b:
                out['rev_wall_up_shift_bps'] = (a - b) / fr['spot'] * 1e4
        # room consumed (study 19): day open frame
        f0 = frames[0]
        out['open_spot'] = f0['spot']
        o0 = surface_features(f0, dirn, pfx='_') or {}
        w0 = o0.get('_wall_up_strike') if dirn > 0 else o0.get('_wall_dn_strike')
        if w0 == w0 and w0 is not None:
            room_open = (w0 - f0['spot']) * dirn
            moved = (fr['spot'] - f0['spot']) * dirn
            if room_open > 0:
                out['room_consumed_pct'] = float(np.clip(moved / room_open, -2, 2))
        # implied-move consumed (study 20): entry_iv from fires row
        iv, hrf = r.get('entry_iv'), r.get('hr')
        if iv == iv and iv and hrf == hrf:
            t_day = max(0.5, 16 - float(hrf)) / 6.5 / 252
            implied_bps = float(iv) * math.sqrt(t_day) * 1e4
            realized_from_open = abs(fr['spot'] - f0['spot']) / f0['spot'] * 1e4
            out['implied_remaining_bps'] = implied_bps
            out['move_vs_implied'] = realized_from_open / max(1.0, implied_bps)
        # tape context: opening range, prior-day levels, TWAP proxy, RV
        ts_all, sp_all = spot_series(frames)
        or_end = frames[0]['ts'] + 30 * 60_000
        or_spots = [s for t, s in zip(ts_all, sp_all) if t <= or_end]
        pre = [s for t, s in zip(ts_all, sp_all) if t <= tsms]
        if or_spots:
            out['orh'], out['orl'] = max(or_spots), min(or_spots)
            out['fire_in_or'] = 1.0 if out['orl'] <= fr['spot'] <= out['orh'] else 0.0
            out['or_break_dir'] = 1.0 if fr['spot'] > out['orh'] else (-1.0 if fr['spot'] < out['orl'] else 0.0)
        if pre:
            out['twap'] = float(np.mean(pre))
            out['spot_vs_twap_bps'] = (fr['spot'] - out['twap']) / out['twap'] * 1e4
        di = DAYS.index(day)
        if di > 0:
            pf = load_day(DAYS[di - 1], tic)
            if pf:
                _, psp = spot_series(pf)
                out['pdh'], out['pdl'] = max(psp), min(psp)
        out['rv_before_bps'] = realized_vol(frames, tsms, 15 * 60_000)
        # rv after fire: 10m forward
        after = [s for t, s in zip(ts_all, sp_all) if tsms < t <= tsms + 10 * 60_000]
        if len(after) >= 2 and s_now:
            rr = np.diff(np.log([s_now] + after))
            out['rv_after_bps'] = float(np.sqrt((rr ** 2).sum()) * 1e4)
            if out.get('rv_before_bps', np.nan) == out.get('rv_before_bps'):
                out['rv_expansion'] = out['rv_after_bps'] / max(0.5, out['rv_before_bps'])
        # wall vs levels confluence (studies 21-23): forward wall near key levels?
        wk = out.get('wall_up_strike') if dirn > 0 else out.get('wall_dn_strike')
        if wk == wk and wk is not None:
            S = fr['spot']
            def near(level, tol_bps=12):
                return level == level and level is not None and abs(wk - level) / S * 1e4 <= tol_bps
            conf = 0
            conf += 1 if near(out.get('twap')) else 0
            conf += 1 if near(out.get('orh')) or near(out.get('orl')) else 0
            conf += 1 if near(out.get('pdh')) or near(out.get('pdl')) else 0
            rn = 5.0 if tic in ('SPY', 'QQQ') else 25.0
            conf += 1 if abs(wk - round(wk / rn) * rn) / S * 1e4 <= 5 else 0
            out['wall_confluence'] = conf
        rows.append(out)
        if n % 200 == 0:
            print(f'{n}/{len(df)}', flush=True)
    feat = pd.DataFrame(rows, index=df.index)
    full = pd.concat([df, feat], axis=1)
    full.to_parquet(OUT)
    fcols = [c for c in feat.columns]
    print(f'wrote {OUT}: {len(full)} fires x {len(fcols)} structure features')
    print('coverage:', {c: f"{100 * feat[c].notna().mean():.0f}%" for c in
                        ['top1_share', 'fwd_wall_dist_bps', 'flip_dist_bps', 'm30_fwd_wall_mig_bps',
                         'room_consumed_pct', 'wall_confluence', 'rv_expansion', 'move_vs_implied']})

if __name__ == '__main__':
    main()
