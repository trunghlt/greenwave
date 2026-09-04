# How GreenWave’s traffic lights decide (simple guide)

GreenWave is a **demo** of four ways to run the 20 lights around Lê Duẩn × Lê Lợi and Cầu Sông Hàn. This page explains them in everyday language, then points to papers if you want the deep version.

---

## The shared idea: two colors only

Every signalized junction in GreenWave is a simple **two-phase** light:

- **N–S green** — north–south traffic goes  
- **E–W green** — east–west traffic goes  

Between those greens we always insert:

- **Yellow** — 3 seconds (cars clear the box)  
- **All-red** — 1 second (everyone stopped briefly)  

So a full story is always: green → yellow → all-red → other green → yellow → all-red → repeat.

Cars and motorbikes wait in a short zone just before the stop line. We count that waiting pile as a **queue**. Heavier cars count a bit more than motorbikes.

---

## 1. Fixed (Cố định) — “run the clock”

**In one sentence:** each light follows a pre-written schedule, like a music metronome. It does **not** look at how many cars are waiting.

You set three knobs per light (or one shared cycle for the network):

| Knob | Plain meaning |
|------|----------------|
| **Cycle** | How long one full “song” lasts (e.g. ~90 seconds) |
| **Split N–S** | How much of the usable green goes north–south (the rest goes east–west) |
| **Offset** | How much this light’s clock is shifted vs the others |

**Offset** is how you build a **green wave**: if the light downstream turns green just as a platoon arrives, people roll through with fewer stops.

**Optimized mode** in the UI is still this Fixed clock — but the knobs were filled in by the search button (CMA-ES), not by hand.

**Good for:** fair A/B baselines, teaching cycle / split / offset.  
**Bad for:** sudden jams (the clock keeps playing even if one approach is empty).

**Read more**

- [FHWA Signal Timing Manual — basics of cycle, split, and offset](https://ops.fhwa.dot.gov/publications/fhwahop08024/chapter4.htm)  
- [Green wave (Wikipedia)](https://en.wikipedia.org/wiki/Green_wave) — arterial coordination idea  

---

## 2. Adaptive (Thích ứng) — “serve the longer line”

**In one sentence:** each light watches **its own** queues and gives green to the busier direction, with a few safety rules.

Roughly:

1. Measure waiting cars on each approach.  
2. Also peek a little at the road **leaving** the junction — if the next segment is already packed, don’t feed it as hard.  
3. If the **other** direction has clearly more “pressure” than the one you’re serving, and you’ve already given at least **8 seconds** of green → switch (yellow, then all-red, then the other green).  
4. Never hold green longer than **52 seconds**.

That “pressure” idea is a simplified **max-pressure** controller: reward serving a long queue, but subtract a penalty if you’re pushing into a jammed downstream link.

**Analogy:** a fair bartender who pours for the longer queue, but won’t keep pouring into a glass that’s already overflowing.

**Good for:** reacting to the afternoon dump onto the bridge without hand-tuning offsets.  
**Bad for:** perfect green waves (neighbors don’t plan together — they only feel each other through jammed links).

**Read more**

- Varaiya, P. (2013). *Max pressure control of a network of signalized intersections*. Transportation Research Part C.  
  - DOI: [10.1016/j.trc.2013.08.014](https://doi.org/10.1016/j.trc.2013.08.014)  
  - Open overview / related chapter listing: [Complex Networks and Dynamic Systems chapter](https://link.springer.com/chapter/10.1007/978-1-4614-6243-9_2)  
- Short HEARTs abstract on practical MP and “self-organizing” offsets: [Adaptive Max Pressure Control (PDF)](https://transp-or.epfl.ch/heart/2014/abstracts/285.pdf)  

GreenWave’s version is **demo-grade**: two phases only, simple queue estimates, fixed γ = 0.6 downstream discount — not a full city deployment.

---

## 3. Coord (Điều phối) — “Adaptive, but ask the neighbors”

**In one sentence:** same pressure idea as Adaptive, but each light also **listens to nearby lights** before it decides to switch.

How the “listening” works (plainly):

1. Find up to 8 neighboring signals on the map graph.  
2. See which neighbors are stressed in the **same** directions as you (N–S with N–S, E–W with E–W).  
3. Blend **65% your own pressure** with **35% a weighted average of those neighbors** (β = 0.35).  
4. Switch when the other blended pressure clearly beats the one you’re serving (same +2.2 margin and 8–52 s green limits as Adaptive).

**Analogy:** Adaptive is one shopkeeper watching their own door. Coord is shopkeepers who also glance at the next doors so they don’t all flip at random.

**Important:** the UI used to flirt with “graph RL.” What ships today is this **graph-smoothed max-pressure**, not a trained neural policy on Da Nang data. There is leftover Q-attention code in the repo, but live Coord falls back to the smoothed rule above.

**Good for:** slightly calmer corridor behavior than pure Adaptive.  
**Bad for:** claiming state-of-the-art MARL (CoLight, etc.) — we didn’t ship that.

**Read more**

- Same Varaiya max-pressure papers as above (Coord still starts from MP).  
- For true graph multi-agent RL on signals (what we *don’t* run live):  
  Wei et al., *Colight: Learning Network-level Cooperation for Traffic Signal Control* — [arXiv:1905.05717](https://arxiv.org/abs/1905.05717)  

---

## 4. Optimize (CMA-ES) — “try many schedules, keep the best”

**In one sentence:** the computer proposes many Fixed schedules, **replays** a short simulation of each, scores them, and keeps improving — then you drive with the winning Fixed plan.

It does **not** steer lights second-by-second while you watch. It **searches offline**, then loads the result into Optimized / Fixed playback.

### Score (what “best” means here)

Prefer high **throughput**, punish long **average wait**, bad **p95 wait**, and many **stops**. Exactly:

`throughput / (8 + avgWait) − 0.15×stops − 0.02×p95Wait`

Change those weights and the “winner” can change.

### Two buttons

| Button | What it searches | What stays fixed |
|--------|------------------|------------------|
| **Tối ưu ngay** (network) | One shared cycle + split & offset for **all 20** lights (41 numbers) | — |
| **Tối ưu nút này** (one junction) | Cycle, split, offset for **the light you clicked** (3 numbers) | The other 19 lights’ plan |

Each try: clone the sim → run ~60 seconds of Fixed traffic → read the score. CMA-ES is the search engine that decides the next tries (it learns which directions in “knob space” were promising).

**Analogy:** a coach who isn’t watching the live game, but runs many quick scrimmages with different playbooks and picks the playbook with the best score.

**Good for:** discovering a decent green-wave-ish Fixed plan for this pocket.  
**Bad for:** guaranteeing the global optimum (short replay, small search budget, toy car-following).

**Read more**

- Hansen, N. *The CMA Evolution Strategy: A Tutorial* — [arXiv:1604.00772](https://arxiv.org/pdf/1604.00772) (canonical CMA-ES explanation)  
- CMA-ES for arterial timing (related idea, not our code): ES-Band — [ACM short paper](https://doi.org/10.1145/3356470.3365532)  
- Evolution strategies as an alternative to RL: Salimans et al. — [arXiv:1703.03864](https://arxiv.org/abs/1703.03864)  

---

## Quick chooser

| If you want… | Use… |
|--------------|------|
| A stable baseline to beat | **Fixed**, then Capture baseline |
| Lights that react to queues | **Adaptive** |
| Adaptive + a bit of neighbor awareness | **Coord** |
| A searched Fixed “green wave” plan | **Optimize now** (network) |
| Nudge only Lê Duẩn × Lê Lợi (etc.) | Click the light → **Optimize this junction** |

Fair test: Afternoon demand → Fixed → Capture baseline → switch mode or Optimize → read the A/B cards.

---

## What this is *not*

- Not a full Viet Nam traffic code / turn-pocket / pedestrian model  
- Not SUMO or VISSIM accuracy  
- Not calibrated on real Da Nang detector feeds  
- Not published SOTA RL (see CoLight link above if that’s what you meant)

---

## References (all in one place)

1. **Signal timing basics (cycle / split / offset)** — FHWA Signal Timing Manual, Ch. 4: https://ops.fhwa.dot.gov/publications/fhwahop08024/chapter4.htm  
2. **Green wave (concept)** — https://en.wikipedia.org/wiki/Green_wave  
3. **Max-pressure control** — Varaiya (2013), *Transportation Research Part C*: https://doi.org/10.1016/j.trc.2013.08.014  
4. **Max-pressure practice / self-organizing offsets** — HEARTs abstract PDF: https://transp-or.epfl.ch/heart/2014/abstracts/285.pdf  
5. **CMA-ES tutorial** — Hansen: https://arxiv.org/pdf/1604.00772  
6. **CMA-ES for arterial green bands (related work)** — ES-Band: https://doi.org/10.1145/3356470.3365532  
7. **Graph RL for signals (not what Coord runs today)** — CoLight: https://arxiv.org/abs/1905.05717  

## Code (if you want the exact numbers)

| Topic | File |
|-------|------|
| Fixed clock, Adaptive switch, queues/pressure | `src/sim/engine.ts` |
| Yellow / all-red / min–max green constants | `src/sim/types.ts` |
| Coord neighbor smoothing | `src/optimizer/coordPolicy.ts` |
| CMA-ES network + single junction | `src/optimizer/cmaes.ts` |

*GreenWave · Lê Duẩn × Lê Lợi · Cầu Sông Hàn · 20 lights · demo, not a city ATC system.*
