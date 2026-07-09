"""Hypothesis registry + generator.

Two sources of studies:
  1. AUTO-GENERATED conditioning hypotheses over the structure-feature set.
     Prior (from FOUNDATIONAL_FINDINGS F2): scalar re-slices tend to reject;
     structural/temporal features survive. The generator tags each feature's
     family so the ledger shows whether the surviving edges are structural,
     as theory predicts.
  2. A curated feature family map so every generated study carries its
     doctrine/family context.

The generator is bounded (fixed feature list) — it cannot spawn unbounded
work. Every hypothesis flows through harness.evaluate_feature (the one
evidence bar) and gets a forced verdict.
"""
from harness import evaluate_feature, load_fires

# Feature family map. 'structural' = map shape/geometry; 'temporal' = how the
# map is changing; 'tape' = price/tape context; 'scalar' = raw GEX/VEX level
# (kept as CONTROLS — we expect these to reject, per F2).
FEATURE_FAMILIES = {
    # structural (map shape)
    'top1_share': 'structural', 'top3_share': 'structural', 'hhi': 'structural',
    'density_50bps': 'structural', 'density_100bps': 'structural',
    'shelf_width_bps': 'structural', 'wall_up_thick': 'structural',
    'wall_dn_thick': 'structural', 'wall_up_isolation': 'structural',
    'wall_dn_isolation': 'structural', 'fwd_wall_thick': 'structural',
    'fwd_wall_share': 'structural', 'fwd_wall_dist_bps': 'structural',
    'wall_range_bps': 'structural', 'open_field': 'structural',
    'cliff_dist_bps': 'structural', 'pin_score': 'structural',
    'wall_confluence': 'structural',
    # asymmetry (structural, directional mass)
    'gex_asym': 'structural', 'vex_asym': 'structural',
    'up_gex_mass': 'structural', 'dn_gex_mass': 'structural',
    'up_vex_mass': 'structural', 'dn_vex_mass': 'structural',
    'opposing_mass': 'structural', 'behind_mass': 'structural',
    # temporal (how the map is changing)
    'rev_gex_pct': 'temporal', 'm30_px_move_bps': 'temporal',
    'm30_fwd_wall_mig_bps': 'temporal', 'stale_move_bps': 'temporal',
    'room_consumed_pct': 'temporal', 'rv_expansion': 'temporal',
    'rv_before_bps': 'temporal', 'rv_after_bps': 'temporal',
    # tape context
    'spot_vs_twap_bps': 'tape', 'move_vs_implied': 'tape',
    'fire_in_or': 'tape', 'or_break_dir': 'tape',
    # scalar controls (expected to reject)
    'net_gex_local': 'scalar', 'net_gex_global': 'scalar',
    'net_vex_local': 'scalar', 'flip_dist_bps': 'scalar',
    'gex_curv': 'scalar', 'vex_curv': 'scalar', 'accel_zone_gex': 'scalar',
    'vixd15': 'scalar',
}


def generate(fs, rng, only_families=None):
    """Evaluate every registered feature through the evidence bar."""
    results = []
    for feat, fam in FEATURE_FAMILIES.items():
        if only_families and fam not in only_families:
            continue
        if feat not in fs.columns:
            results.append(dict(feature=feat, family=fam, verdict='not_testable',
                                reason='feature absent from dataset'))
            continue
        results.append(evaluate_feature(fs, feat, rng, family=fam))
    return results


# Explicit doctrine-derived studies that need archive features not yet in the
# parquet. Registered honestly as pending so the ledger records the intent.
PENDING_DOCTRINE_STUDIES = [
    dict(id='node_growth_intent', title='Node growth = intent (Ch 9)',
         status='queued_needs_feature',
         note='target-node magnitude rising over prior 15-30m; needs archive '
              'extraction (not in fires_structure.parquet). Sharper form of '
              'the s7 fresh-vs-delivered signal.'),
    dict(id='airpocket_fuel_entry', title='Air-pocket + fuel on entry (Ch 8)',
         status='queued_needs_feature',
         note='air-pocket-ahead + rising-node fuel at fire; barney-fuel EXIT '
              'uses this, entry side untested.'),
]
