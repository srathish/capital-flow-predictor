"""
Policy simulator configuration — ALL thresholds live here, nothing is
hard-coded in the simulator body. Research-only (research/uw isolation
contract); nothing in the live trading path reads this.
"""

# ---------------- thresholds (from the 15-study findings) ----------------
THRESHOLDS = {
    # entry
    "confirm_wait_min": 1,             # confirmation = option up N min after fire
    # exits (live rule, validated S3)
    "trail_arm": 0.50,
    "trail_giveback": 0.15,
    # GEX (S9)
    "gex_positive_min": 0.15,          # signed/total gamma above this = positive regime
    "gex_negative_max": -0.15,
    "wall_skip_below_bps": 20,         # <20bps to target wall = no room
    "wall_sweet_lo_bps": 50,
    "wall_sweet_hi_bps": 100,
    # time of day (S10)
    "bad_window_start_hr": 13.5,
    "bad_window_end_hr": 15.0,
    "morning_end_hr": 12.0,
    # premium / liquidity / convexity (S5/S6/S12)
    "premium_band_good": (0.50, 2.00),
    "premium_band_bad": (2.00, 10.00),
    "breakeven_max_bps": 30,
    # flow (S7/S8)
    "flow_onesided_quantile": 2 / 3,   # top tercile of |f15|/total = one-sided
    "flow_extreme_quantile": 0.90,     # top decile |f15| = extreme
    # no-trade score (S15)
    "flags_max_relaxed": 1,
    "flags_max_strict": 0,
    # sizing
    "size_base": 1.0,
    "size_step": 0.25,                 # per positive stack condition
    "size_cap": 2.0,
    "size_floor": 0.5,
    # stability assessment
    "neutral_tol_pct": 1.0,        # a split counts as "neutral-or-better" above -1%
    "dd_max_frac_of_cap": 0.10,    # acceptable max drawdown vs capital deployed
    "outlier_max_share": 0.50,     # best trade or best day may not carry > 50% of P&L
    "tail_max_share_pct": 60,      # top-5% trades may not carry > 60% of gross profit
    "status_strong_min": 8,        # stability_score thresholds (of 9)
    "status_candidate_min": 6,
    "status_research_min": 4,
}

# ---------------- filter registry ----------------
# Each filter is a named pure predicate implemented in policy_simulator.py.
# A policy is: universe + entry + list of filters + sizing mode.
POLICIES = [
    {"name": "baseline_all_fires", "entry": "atfire", "filters": [], "sizing": "flat"},
    {"name": "confirmation_entry_only", "entry": "confirm", "filters": [], "sizing": "flat"},
    {"name": "skip_gex_positive", "entry": "atfire", "filters": ["not_gex_positive"], "sizing": "flat"},
    {"name": "bad_time_filter", "entry": "atfire", "filters": ["not_bad_window"], "sizing": "flat"},
    {"name": "premium_band", "entry": "atfire", "filters": ["premium_ok"], "sizing": "flat"},
    {"name": "spxw_penalty", "entry": "atfire", "filters": ["spxw_ok"], "sizing": "flat"},
    {"name": "flow_confirmation", "entry": "atfire", "filters": ["flow_agree", "flow_not_onesided"], "sizing": "flat"},
    {"name": "flow_exhaustion", "entry": "atfire", "filters": ["flow_exhaustion_ok"], "sizing": "flat"},
    {"name": "wall_distance", "entry": "atfire", "filters": ["wall_ok"], "sizing": "flat"},
    {"name": "convexity", "entry": "atfire", "filters": ["breakeven_ok"], "sizing": "flat"},
    {"name": "flags_le_1", "entry": "atfire", "filters": ["flags_relaxed"], "sizing": "flat"},
    {"name": "flags_eq_0", "entry": "atfire", "filters": ["flags_strict"], "sizing": "flat"},
    {"name": "positive_stack_sizing", "entry": "atfire", "filters": [], "sizing": "stack"},
]

FULL_POLICY = {
    "name": "FULL_COMBINED",
    "entry": "confirm",
    "filters": [
        "flow_agree", "flow_not_onesided", "flags_relaxed", "premium_ok",
        "wall_ok", "not_bad_window", "breakeven_ok", "spxw_ok",
    ],
    "sizing": "stack",
}

# ablation: remove one component at a time from FULL_COMBINED
ABLATION_COMPONENTS = [
    ("remove_flow", ["flow_agree", "flow_not_onesided"], None),
    ("remove_premium_efficiency", ["premium_ok"], None),
    ("remove_time_filter", ["not_bad_window"], None),
    ("remove_flags", ["flags_relaxed"], None),
    ("remove_convexity", ["breakeven_ok"], None),
    ("remove_wall_distance", ["wall_ok"], None),
    ("remove_confirmation_entry", [], "atfire"),
    ("remove_spxw_penalty", ["spxw_ok"], None),
    ("remove_stack_sizing", [], None),   # sizing → flat (handled specially)
]
