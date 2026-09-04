# GreenWave algorithms

How signal control works in GreenWave today. Numbers and formulas below are taken from the live code (`src/sim/engine.ts`, `src/optimizer/coordPolicy.ts`, `src/optimizer/cmaes.ts`), not from a paper abstract.

**Pocket:** 20 OSM signalized junctions around Lê Duẩn × Lê Lợi feeding Cầu Sông Hàn. Two-phase lights only (N–S vs E–W). Mixed cars + motorbikes. Client-side TypeScript sim.

**Modes in the UI**

| UI | Internal `ControlMode` | What it is |
|----|------------------------|------------|
| Cố định / Fixed | `fixed` | Clocked plan: cycle, split, offset |
| Thích ứng / Adaptive | `adaptive` | Per-junction advanced max-pressure |
| Điều phối / Coord | `coord` | Graph-smoothed advanced max-pressure |
| Tối ưu / Optimized | `optimized` | Same runner as Fixed, but timing comes from CMA-ES |

`Optimized` is **not** a live RL controller. “Tối ưu ngay” / “Tối ưu nút này” run CMA-ES offline, then apply a timing plan and switch to `optimized` (fixed-time playback of that plan).

---

## Shared plant: queues, pressure, intergreen

### Queue measurement (`updateQueues`)

On each incoming link, vehicles in the last ~85 m before the stop bar (`STOP_PAD + 85`) with speed \(v < 4.5\) m/s count as queued. Weights: car `1.35`, moto `0.7`. Those weights roll up into approach queues \(q_N, q_E, q_S, q_W\) on the signal.

Moving vehicles on the link contribute to a “flow” term used only inside pressure (not shown as queue).

### Advanced max-pressure (shared by Adaptive and Coord)

For each approach \(a \in \{N,E,S,W\}\):

\[
\begin{aligned}
\text{demand}_a &= \sum_{\text{inlinks to } a} \big(q_{\text{link}} + 0.22 \cdot \text{flow}_{\text{link}}\big) \\
p_a &= \text{demand}_a - 0.6 \cdot q_{\text{downstream}}
\end{aligned}
\]

- Downstream link = prefer straight-through outgoing opposite the approach, else other outgoing.
- \(\gamma = 0.6\) discounts spilling into a jammed next link (Varaiya-style max-pressure idea, simplified two-phase).
- Phase pressures: \(p_{NS} = p_N + p_S\), \(p_{EW} = p_E + p_W\).

### Intergreen (all live modes)

When a controller decides to leave green:

1. **Yellow** `YELLOW = 3.0` s  
2. **All-red** `ALLRED = 1.0` s  
3. Flip phase (0 ↔ 1) and reset green timer  

Adaptive/Coord also enforce **min green** `MIN_GREEN = 8` s and **max green** `MAX_GREEN = 52` s on the live green timer.

---

## 1. Fixed (`fixed`) — and Optimized playback

### Timing genes per junction

- `cycle` — seconds (UI ~48–140; CMA search 64–110)  
- `splitNS` — fraction of *usable* green given to N–S (rest to E–W)  
- `offset` — seconds shift of the local clock vs global sim time \(t\)  

Optional `plan.cycles[i]` lets each junction keep its own cycle after single-junction CMA-ES; otherwise everyone shares `plan.cycle`.

### Usable green inside a cycle

\[
\begin{aligned}
\text{lost} &= \min(0.45 \cdot \text{cycle},\; 2\cdot(\text{YELLOW}+\text{ALLRED})) \\
g &= \max(12,\; \text{cycle} - \text{lost}) \\
g_{NS} &= \max(6,\; g \cdot \text{splitNS}) \\
g_{EW} &= \max(6,\; g - g_{NS})
\end{aligned}
\]

Lost time reserves room for two yellow + two all-red clearances per cycle.

### Phase timeline (local clock)

\[
\tau = (t + \text{offset}) \bmod \text{cycle}
\]

Slots in order:

| Slot | Interval | Lamp |
|------|----------|------|
| 0 | \([0, g_{NS})\) | N–S green |
| 1 | yellow | N–S yellow |
| 2 | all-red | all red |
| 3 | \(g_{EW}\) | E–W green |
| 4 | yellow | E–W yellow |
| 5 | all-red → end of cycle | all red |

Inspector “Thời lượng pha” shows \(g_{NS}\), yellow, all-red, \(g_{EW}\), yellow, all-red from these formulas.

### Default / seed plans

- **Naive / default Fixed:** shared cycle ~96 s, splits ~0.5, offsets 0 (poor on afternoon bridge dump — intentional baseline).  
- **`greenWaveSeed(cycle)`:** offsets ≈ \(x / 13.5\) (meters along corridor → time at ~13.5 m/s), splits biased by how many N–S vs E–W in-links. Used as CMA-ES start, not as a separate UI mode.

**What Fixed does *not* do:** read queues. It is open-loop.

---

## 2. Adaptive (`adaptive`) — advanced max-pressure

Each junction decides alone every sim step (after intergreen is finished):

1. Update queues → pressures \(p_{NS}, p_{EW}\).  
2. `serving` = pressure of current phase; `other` = pressure of the other phase.  
3. Switch to yellow if:

\[
\big(\text{elapsed} \ge 8 \;\wedge\; \text{other} > \text{serving} + 2.2\big)
\;\vee\;
\text{elapsed} \ge 52
\]

and also (`other > 0.4` **or** max-green hit) so we do not chatter on empty opposing approaches.

**Properties**

- Fully reactive; no offsets, no shared cycle while Adaptive is on.  
- Cycle/split/offset sliders still exist (they define the Fixed plan underneath) but **do not drive lamps** until you leave Adaptive.  
- No coordination: a junction cannot “see” neighbors except via the \(\gamma\) downstream queue on its own out-link.

---

## 3. Coord (`coord`) — graph-smoothed advanced max-pressure

Same intergreen, min/max green, and pressure field as Adaptive. The **switch vote** is different.

### Neighbor graph

`neighborIndices(net, i)` walks the road graph from signal \(i\), skipping unsignalized nodes, collecting up to 8 nearby signal ids.

### Attention over neighbor pressures (`graphMpVotes`, \(\beta = 0.35\))

For junction \(i\) with neighbors \(j\):

\[
\text{score}_{ij} = p_{NS}(i)\,p_{NS}(j) + p_{EW}(i)\,p_{EW}(j)
\]

Softmax with temperature scale `0.08` → attention weights \(\alpha_{ij}\). Aggregates:

\[
a_{NS} = \sum_j \alpha_{ij}\, p_{NS}(j),\quad
a_{EW} = \sum_j \alpha_{ij}\, p_{EW}(j)
\]

Smoothed pressures:

\[
\begin{aligned}
s_{NS} &= (1-\beta)\,p_{NS}(i) + \beta\, a_{NS} \\
s_{EW} &= (1-\beta)\,p_{EW}(i) + \beta\, a_{EW}
\end{aligned}
\]

Vote **switch** if `elapsed ≥ MIN_GREEN` and opposing smoothed pressure beats serving by `+2.2` (same margin as Adaptive). Max-green still forces a switch.

### Note on “graph-RL” / Q-attention

`coordPolicy.ts` still contains a Q-attention network (`kind: 'qattn'`) and training helpers. **Live Coord does not use trained Q weights** unless they are marked trained and dimension-matched. On the current 20-light pocket, `coordVotes` falls through to `graphMpVotes`. The UI correctly describes Coord as graph-smoothed max-pressure, not a shipped MARL policy.

---

## 4. CMA-ES Optimize (`src/optimizer/cmaes.ts`)

Offline search. Each candidate is evaluated in a **headless** `TrafficSim` copy: apply plan → `fixed` mode → simulate 60 s at \(\Delta t = 0.25\) s → read metrics.

### Fitness (network-wide)

\[
\text{fitness} = \frac{\text{throughput}}{8 + \text{avgWait}} - 0.15\cdot\text{stops} - 0.02\cdot\text{p95Wait}
\]

Higher is better. Junction-scoped search uses the **same** network fitness (one light is tuned for corridor effect).

### Network scope (“Tối ưu ngay”)

- Genes: \(1 + 20\times 2 = 41\)  
  - 1 shared cycle ∈ [64, 110]  
  - 20 × `splitNS` ∈ [0.24, 0.76]  
  - 20 × `offset` / cycle ∈ [0, 1]  
- Population \(\lambda = 12\), \(\mu = 6\), max generations `5`  
- Initial \(\sigma \approx 0.16\), CMA covariance adaptation (Jacobi eigendecomposition of \(C\))  
- Start mean from current plan / green-wave seed  

Result: one coordinated Fixed plan → mode `optimized`.

### Junction scope (“Tối ưu nút này”)

Requires a selected signalized junction `sigId`.

- Genes: **3** — that light’s cycle, splitNS, offset  
- Clones the **live** plan; only `sigId` entries change (`plan.cycles[sigId]`, `splitNS[sigId]`, `offset[sigId]`)  
- \(\lambda = 10\), maxGen `6`, slightly larger initial \(\sigma\)  
- Other 19 junctions stay byte-identical to the base plan  

### What CMA-ES is / is not

- **Is:** derivative-free continuous optimizer over timing parameters; good demo of “search a green wave.”  
- **Is not:** online adaptive control, nor a guarantee of global optimality (short eval horizon, small budget, two-phase abstraction).

---

## How to compare fairly in the app

1. Demand **Chiều / Afternoon**, Fixed mode.  
2. **Ghi mốc / Capture baseline** after the jam develops.  
3. Switch Adaptive or Coord, or run network / single-junction Optimize.  
4. Read A/B deltas (wait, throughput, stops, p95) vs the captured baseline.  

Same seed + same demand ⇒ reproducible headless evals inside CMA-ES; live UI noise still varies with discrete vehicle IDs.

---

## Limits (honest)

- Two phases only (no protected lefts, no pedestrian phases).  
- IDM-lite car-following; not SUMO/VISSIM fidelity.  
- Pressure uses a short stop-bar queue, not full link density.  
- Coord attention is heuristic (\(\beta=0.35\)), not calibrated on Da Nang detector data.  
- CMA-ES fitness is a hand-tuned scalar — change weights and the “best” plan moves.  
- Demo-grade vs full max-pressure with saturation flows, or CoLight-style trained graph RL.

---

## Code map

| Piece | File |
|-------|------|
| Fixed slots, Adaptive switch, queues/pressure | `src/sim/engine.ts` |
| Constants YELLOW/ALLRED/MIN/MAX green | `src/sim/types.ts` |
| Graph-smoothed MP + optional Q-attn | `src/optimizer/coordPolicy.ts` |
| CMA-ES network + junction | `src/optimizer/cmaes.ts` |
| Pocket topology | `src/sim/mapGraph.json`, `scripts/clipPocket.py` |

*Generated for GreenWave · Lê Duẩn × Lê Lợi · Cầu Sông Hàn · 20 đèn.*
