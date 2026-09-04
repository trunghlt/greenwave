# GreenWave

Cinematic client-side AI traffic-light timing lab for a real OpenStreetMap pocket of Da Nang: Lê Duẩn × Lê Lợi feeding Cầu Sông Hàn (Han River Bridge). 20 signalized junctions. OSM one-way (Lê Lợi southbound). Afternoon jam lab.
Microscopic mixed traffic, OSM signalized junctions, live phase control.

## Run

From this folder install dependencies then start the Vite dev server on port 5173.

## How to play

Playback: space pause, keys 1-5 for speed, R reset. Click a junction.
Demand: afternoon (default, Hải Châu → Sơn Trà onto the bridge), morning (into Hải Châu), midday, custom. Randomize demand jitters inflows.
Modes: Fixed baseline, Adaptive advanced max-pressure, Coord graph-smoothed advanced max-pressure on the 20-node graph, Optimized CMA-ES plan (genome is 1 + NODE_COUNT×2 = 41).
Retune cycle/split/offset live. Capture baseline then compare A/B deltas.

## How the controllers work

Adaptive — advanced max-pressure: each approach pressure is queued demand on the incoming link minus a discounted (~0.6) downstream queue on the straight-through outgoing link (store-and-forward), plus a small incoming-flow term. Cars weigh 1.35, motos 0.7. The junction serves N–S or E–W when opposing pressure beats the serving phase by a margin after MIN_GREEN, or at MAX_GREEN. Yellow and all-red are unchanged.

Coord — graph-smoothed advanced max-pressure on the 20-node pocket (attention over neighbor pressures, beta=0.35). The policy only votes keep vs switch; the env still enforces min/max green, yellow, and all-red. (Shipped Q-attention weights from the old citywide map are ignored.)

Optimize now — CMA-ES over a shared cycle, per-junction N–S splits, and offsets. Seeded with naive 50/50 plus green-wave offsets. Evaluated in a headless copy of the same sim. Fitness rewards throughput and penalizes wait, p95, and stops. Runs on the main thread in short slices. Best sample is applied as coordinated fixed-time.

Sim, renderer, and optimizer are separate modules. Seeded RNG. No server, no GPU, no TensorFlow.

## Key files

- src/sim/engine.ts : vehicles, signals, demand, metrics, advanced max-pressure
- src/sim/network.ts : OSM Lê Duẩn × Lê Lợi · Cầu Sông Hàn 20-light pocket (one-way, lanes, polylines)
- src/sim/rng.ts : mulberry32
- src/optimizer/cmaes.ts : CMA-ES plus headless eval
- src/optimizer/coordPolicy.ts : graph-attention inference
- src/optimizer/coordWeights.ts : shipped policy weights
- scripts/trainCoord.ts : CPU trainer for the Coord policy
- src/render/renderer.ts : canvas 2D
- src/App.tsx : HUD, inspector, charts, playback
