# Node Terrain viewer — 1-min GEX/VEX price-vs-nodes map

The operator-designated visual model for the trading system: price path overlaid on the
dealer-gamma terrain (amber pika / violet barney bands), King track, live fires, GEX/VEX
toggle, per-minute hover. Published artifact (stable URL, updates in place when
republished from the original conversation):
https://claude.ai/code/artifact/919fa611-527e-4113-b581-754befe3c995

Rebuild with fresh days (reads research/velocity-capture/backfill/* + data/gexester.db fires):
    cd apps/gex/research/viz/node-terrain
    python3 build_terrain.py          # writes terrain_data.json (run from this dir; adjust BASE if needed)
    python3 -c "open('node-terrain.html','w').write(open('terrain_template.html').read().replace('__DATA__', open('terrain_data.json').read()))"
Then publish node-terrain.html as the artifact (same file path keeps the URL).

Data: 1-min backfill via research/velocity-capture/backfill_1min.mjs (Skylit historical
serves true 1-min frames — verified 2026-07-14). Live 1-min capture: capture.mjs.
