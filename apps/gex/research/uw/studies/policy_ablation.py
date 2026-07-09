"""Ablation suite — run FULL_COMBINED, then remove one component at a time.
Shows which filters independently matter and which are redundant."""
import pandas as pd
from policy_config import FULL_POLICY, ABLATION_COMPONENTS


def run_ablation_suite(df, full_policy, apply_policy, compute_metrics, holdout_metrics) -> pd.DataFrame:
    universe_n = len(df)
    full_tr = apply_policy(df, full_policy)
    full_m = compute_metrics(full_tr, universe_n)
    base_tr = apply_policy(df, {'name': 'baseline', 'entry': 'atfire', 'filters': [], 'sizing': 'flat'})
    base_m = compute_metrics(base_tr, universe_n)

    rows = [{'policy': 'FULL_COMBINED', 'removed': '-', **full_m,
             **holdout_metrics(full_tr, df),
             'delta_vs_full': 0.0,
             'delta_vs_baseline': round(full_m['ret_on_cap_pct'] - base_m['ret_on_cap_pct'], 2)}]

    for name, remove_filters, entry_override in ABLATION_COMPONENTS:
        pol = {
            'name': name,
            'entry': entry_override or full_policy['entry'],
            'filters': [f for f in full_policy['filters'] if f not in remove_filters],
            'sizing': 'flat' if name == 'remove_stack_sizing' else full_policy['sizing'],
        }
        tr = apply_policy(df, pol)
        m = compute_metrics(tr, universe_n)
        rows.append({'policy': name, 'removed': name.replace('remove_', ''), **m,
                     **holdout_metrics(tr, df),
                     'delta_vs_full': round(m.get('ret_on_cap_pct', float('nan')) - full_m['ret_on_cap_pct'], 2),
                     'delta_vs_baseline': round(m.get('ret_on_cap_pct', float('nan')) - base_m['ret_on_cap_pct'], 2)})
    return pd.DataFrame(rows)
