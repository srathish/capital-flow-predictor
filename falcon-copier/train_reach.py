# Train the VALIDATED reach/pin models on ALL 19 days and save them for live use.
# These are the only things that generalize OOS (reach-up 0.90, reach-down 0.80). Direction is NOT saved
# because it does not generalize (proven 5x). Live scoring: score_reach.py + live_reach.mjs.
import pandas as pd, pickle, json
from sklearn.ensemble import GradientBoostingClassifier

df = pd.read_csv('falcon-copier/features.csv')
targets = ['y_dir','y_maxUp','y_maxDn','y_reachKing','y_reachUp','y_reachDn','y_pin']
feats = [c for c in df.columns if c not in (['day','et']+targets)]
models = {}
for tgt in ['y_reachUp','y_reachDn','y_pin','y_reachKing']:
    m = GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=0)
    m.fit(df[feats], df[tgt]); models[tgt] = m
    print(f"trained {tgt}: {df[tgt].mean():.2f} base rate, {len(df)} rows")
pickle.dump({'models': models, 'feats': feats}, open('falcon-copier/reach_models.pkl','wb'))
json.dump(feats, open('falcon-copier/reach_feats.json','w'))
print(f"saved {len(models)} models + {len(feats)} feature names -> reach_models.pkl")
