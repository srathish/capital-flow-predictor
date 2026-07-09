"""Summarize live fire observations (observation-only forward validation).

Usage:
  python -m research.uw.live_logging.summarize_live_observations --date YYYY-MM-DD
  (or: python research/uw/live_logging/summarize_live_observations.py --date ...)

Reports counts and distributions only. Does NOT compute P&L — post-entry
option marks are not part of the observation record by design.
"""
import argparse, json, os, sys
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(os.path.dirname(HERE), 'outputs', 'live_observations')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', required=True)
    args = ap.parse_args()
    f = os.path.join(OUTDIR, f'live_fire_observations_{args.date}.csv')
    if not os.path.exists(f):
        sys.exit(f'no observation file for {args.date} ({f})')
    df = pd.read_csv(f)
    n = len(df)
    print(f'\n== live fire observations {args.date} ==')
    print(f'fires observed: {n}')
    z = df['policy_flags_eq_0_pass'].fillna(False).astype(bool) if 'policy_flags_eq_0_pass' in df else pd.Series(dtype=bool)
    print(f'zero-red-flag fires: {int(z.sum())} ({100*z.mean():.0f}%)' if n else 'zero-red-flag fires: 0')
    for col, title in [('ticker', 'by ticker'), ('fire_direction', 'by direction'),
                       ('current_time_bucket', 'by time bucket'),
                       ('red_flag_count', 'red flag distribution'),
                       ('flow_5m_agreement', 'flow agreement'),
                       ('confirmation_entry_outcome', 'confirmation outcomes')]:
        if col in df:
            print(f'\n{title}:')
            print(df[col].value_counts(dropna=False).to_string())
    if 'missing_data' in df:
        md = df['missing_data'].dropna().str.split('|').explode().value_counts()
        print('\nmissing data counts:')
        print(md.to_string() if len(md) else '  none')
    print('\npolicy pass counts (logging only — nothing is traded on these):')
    for col in ['policy_flags_eq_0_pass', 'policy_flags_le_1_pass', 'policy_full_combined_pass']:
        if col in df:
            vc = df[col].value_counts(dropna=False)
            print(f'  {col}: {vc.to_dict()}')


if __name__ == '__main__':
    main()
