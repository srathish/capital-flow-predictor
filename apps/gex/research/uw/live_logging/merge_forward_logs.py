"""Merge daily live observation logs into one forward-validation dataset.

Usage:
  python -m research.uw.live_logging.merge_forward_logs
Output:
  research/uw/outputs/live_observations/forward_validation_dataset.csv (+.parquet if available)

The merged file is the out-of-sample record that gets fed back into the
policy simulator once enough forward days exist.
"""
import glob, os
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(os.path.dirname(HERE), 'outputs', 'live_observations')


def main():
    files = sorted(glob.glob(os.path.join(OUTDIR, 'live_fire_observations_????-??-??.csv')))
    if not files:
        print('no daily observation files found'); return
    df = pd.concat([pd.read_csv(f) for f in files], ignore_index=True)
    df = df.drop_duplicates(subset=['timestamp', 'ticker', 'fire_source'])
    out = os.path.join(OUTDIR, 'forward_validation_dataset.csv')
    df.to_csv(out, index=False)
    print(f'merged {len(files)} day(s), {len(df)} observations → {out}')
    try:
        df.to_parquet(out.replace('.csv', '.parquet'), index=False)
    except Exception:
        print('(parquet skipped — pyarrow not available)')


if __name__ == '__main__':
    main()
