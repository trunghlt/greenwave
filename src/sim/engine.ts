import { RNG } from './rng';
import {
  ALLRED,
  JUNCTION_R,
  MAX_GREEN,
  MIN_GREEN,
  OPPOSITE,
  SPECS,
  STOP_PAD,
  YELLOW,
  N,
  S,
  type Approach,
  type ControlMode,
  type CustomDemand,
  type Metrics,
  type ScenarioId,
  type TimingPlan,
  type VehicleKind,
} from './types';
import {
  NODE_COUNT,
  WORLD_W,
  WORLD_H,
  buildNetwork,
  linkSample,
  type Link,
  type Network,
  type Node,
} from './network';
import { coordVotes } from '../optimizer/coordPolicy';

const POOL = 1400;
const SQRT_AB_MOTO = Math.sqrt(SPECS.moto.accel * SPECS.moto.decel);
const SQRT_AB_CAR = Math.sqrt(SPECS.car.accel * SPECS.car.decel);

export interface Vehicle {
  alive: boolean;
  kind: VehicleKind;
  link: number;
  s: number;
  v: number;
  dest: number;
  wait: number;
  stops: number;
  stopped: boolean;
  spawnT: number;
  hue: number;
  lat: number;
  crossing: number;
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  cx2: number;
  cy2: number;
  cv: number;
  nextLink: number;
  color: number;
  lane: number;
}

export interface IxState {
  cycle: number;
  splitNS: number;
  offset: number;
  phase: 0 | 1;
  elapsed: number;
  yellow: boolean;
  yElapsed: number;
  allRed: boolean;
  arElapsed: number;
  qN: number;
  qE: number;
  qS: number;
  qW: number;
  pN: number;
  pE: number;
  pS: number;
  pW: number;
}

export interface Sample {
  t: number;
  avgWait: number;
  p95Wait: number;
  throughput: number;
  stops: number;
  queued: number;
}

function idmAcc(
  v: number,
  v0: number,
  vLead: number,
  gap: number,
  kind: VehicleKind,
): number {
  const spec = SPECS[kind];
  const sab = kind === 'moto' ? SQRT_AB_MOTO : SQRT_AB_CAR;
  if (gap < 0.15) gap = 0.15;
  const dv = v - vLead;
  let sStar = spec.minGap + Math.max(0, v * spec.headway + (v * dv) / (2 * sab));
  if (sStar < spec.minGap) sStar = spec.minGap;
  const ratioV = v / Math.max(0.4, v0);
  const acc = spec.accel * (1 - ratioV * ratioV * ratioV * ratioV - (sStar / gap) * (sStar / gap));
  if (acc > spec.accel) return spec.accel;
  if (acc < -spec.decel) return -spec.decel;
  return acc;
}

function defaultPlan(): TimingPlan {
  const splitNS = Array(NODE_COUNT).fill(0.5);
  const offset = Array(NODE_COUNT).fill(0);
  return { cycle: 96, splitNS, offset };
}

export class TrafficSim {
  net: Network;
  rng: RNG;
  spawnRng: RNG;
  t = 0;
  mode: ControlMode = 'fixed';
  scenario: ScenarioId = 'afternoon';
  custom: CustomDemand = { volume: 1, ewBias: 0.55, motoFrac: 0.72 };
  plan: TimingPlan;
  optPlan: TimingPlan;
  ix: IxState[];
  vehicles: Vehicle[] = [];
  free: number[] = [];
  onLink: number[][] = [];
  spawnWait: number[] = [];
  completedWait: number[] = [];
  completedStops: number[] = [];
  completedTimes: number[] = [];
  arrivalsWindow = 0;
  arrivalsAcc = 0;
  totalCompleted = 0;
  history: Sample[] = [];
  sampleAcc = 0;
  liveWaitSum = 0;
  liveWaitN = 0;
  queued = 0;
  motoFracLive = 0.72;
  seed: number;
  headless = false;
  /** Optional Coord-mode action override used by the trainer (ε-greedy). */
  coordVoteHook: ((i: number) => boolean) | null = null;

  constructor(seed = 2026, headless = false) {
    this.seed = seed;
    this.headless = headless;
    this.net = buildNetwork();
    this.rng = new RNG(seed);
    this.spawnRng = new RNG(seed ^ 0x9e3779b9);
    this.plan = defaultPlan();
    this.optPlan = defaultPlan();
    this.ix = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      this.ix.push({
        cycle: this.plan.cycle,
        splitNS: this.plan.splitNS[i],
        offset: this.plan.offset[i],
        phase: 0,
        elapsed: 0,
        yellow: false,
        yElapsed: 0,
        allRed: false,
        arElapsed: 0,
        qN: 0,
        qE: 0,
        qS: 0,
        qW: 0,
        pN: 0,
        pE: 0,
        pS: 0,
        pW: 0,
      });
    }
    for (let i = 0; i < POOL; i++) {
      this.vehicles.push(this.blankVeh());
      this.free.push(i);
    }
    this.onLink = this.net.links.map(() => []);
    this.spawnWait = this.net.links.map(() => 0);
    this.applyScenarioRates();
    this.primeFixedPhases();
  }

  private blankVeh(): Vehicle {
    return {
      alive: false,
      kind: 'moto',
      link: 0,
      s: 0,
      v: 0,
      dest: 0,
      wait: 0,
      stops: 0,
      stopped: false,
      spawnT: 0,
      hue: 0,
      lat: 0,
      crossing: 0,
      cx0: 0,
      cy0: 0,
      cx1: 0,
      cy1: 0,
      cx2: 0,
      cy2: 0,
      cv: 0,
      nextLink: -1,
      color: 0,
      lane: 0,
    };
  }

  reset(seed?: number) {
    if (seed !== undefined) this.seed = seed;
    this.rng.seed(this.seed);
    this.spawnRng.seed(this.seed ^ 0x9e3779b9);
    this.t = 0;
    this.completedWait = [];
    this.completedStops = [];
    this.completedTimes = [];
    this.arrivalsWindow = 0;
    this.arrivalsAcc = 0;
    this.totalCompleted = 0;
    this.history = [];
    this.sampleAcc = 0;
    this.queued = 0;
    for (const v of this.vehicles) v.alive = false;
    this.free.length = 0;
    for (let i = 0; i < POOL; i++) this.free.push(i);
    for (const arr of this.onLink) arr.length = 0;
    for (let i = 0; i < this.spawnWait.length; i++) this.spawnWait[i] = 0;
    for (let i = 0; i < NODE_COUNT; i++) {
      const x = this.ix[i];
      x.phase = 0;
      x.elapsed = 0;
      x.yellow = false;
      x.yElapsed = 0;
      x.allRed = false;
      x.arElapsed = 0;
      const c = this.plan.cycles?.[i] ?? this.plan.cycle;
      x.cycle = c;
      x.splitNS = this.plan.splitNS[i];
      x.offset = ((this.plan.offset[i] % c) + c) % c;
    }
    this.applyScenarioRates();
    this.primeFixedPhases();
  }

  setMode(mode: ControlMode) {
    this.mode = mode;
    if (mode === 'optimized') {
      this.applyPlan(this.optPlan, false);
    }
  }

  setScenario(id: ScenarioId) {
    this.scenario = id;
    this.applyScenarioRates();
  }

  setCustom(c: Partial<CustomDemand>) {
    Object.assign(this.custom, c);
    if (this.scenario === 'custom') this.applyScenarioRates();
  }

  applyPlan(plan: TimingPlan, asOptimized: boolean) {
    const cycles =
      plan.cycles && plan.cycles.length === NODE_COUNT ? plan.cycles.slice() : undefined;
    this.plan = {
      cycle: plan.cycle,
      splitNS: plan.splitNS.slice(),
      offset: plan.offset.slice(),
      cycles,
    };
    if (asOptimized) {
      this.optPlan = {
        cycle: plan.cycle,
        splitNS: plan.splitNS.slice(),
        offset: plan.offset.slice(),
        cycles: cycles ? cycles.slice() : undefined,
      };
    }
    for (let i = 0; i < NODE_COUNT; i++) {
      const c = cycles ? cycles[i] : plan.cycle;
      this.ix[i].cycle = c;
      this.ix[i].splitNS = plan.splitNS[i] ?? 0.5;
      this.ix[i].offset = ((plan.offset[i] ?? 0) % c + c) % c;
    }
  }

  setIntersectionTiming(id: number, patch: { cycle?: number; splitNS?: number; offset?: number }) {
    const node = this.net.nodes[id];
    const sid = node && node.signalized ? node.sigId : id;
    if (sid < 0 || sid >= this.ix.length) return;
    const x = this.ix[sid];
    if (patch.cycle !== undefined) {
      const c = Math.max(48, Math.min(140, patch.cycle));
      if (!this.plan.cycles || this.plan.cycles.length !== NODE_COUNT) {
        this.plan.cycles = this.ix.map((ix) => ix.cycle);
      }
      x.cycle = c;
      this.plan.cycles[sid] = c;
    }
    if (patch.splitNS !== undefined) {
      x.splitNS = Math.max(0.22, Math.min(0.78, patch.splitNS));
      this.plan.splitNS[sid] = x.splitNS;
    }
    if (patch.offset !== undefined) {
      x.offset = ((patch.offset % x.cycle) + x.cycle) % x.cycle;
      this.plan.offset[sid] = x.offset;
    }
  }

  randomizeDemand() {
    this.spawnRng.seed((this.spawnRng.next() * 1e9) >>> 0 || 7);
    this.applyScenarioRates();
    for (const l of this.net.links) {
      if (!l.spawn) continue;
      l.baseRate *= 0.65 + this.spawnRng.next() * 0.8;
    }
  }

  applyScenarioRates() {
    const { links, nodes } = this.net;
    let volume = 1;
    let ewBias = 0;
    let moto = 0.7;
    if (this.scenario === 'afternoon') {
      // 16:00–18:00 reverse-commute / school+office dump onto Cầu Sông Hàn (Hải Châu → Sơn Trà)
      volume = 1.18;
      ewBias = 0.68;
      moto = 0.74;
    } else if (this.scenario === 'rush') {
      // Morning into Hải Châu (westbound off the bridge)
      volume = 1.08;
      ewBias = -0.52;
      moto = 0.74;
    } else if (this.scenario === 'midday') {
      volume = 0.72;
      ewBias = 0.08;
      moto = 0.68;
    } else {
      volume = this.custom.volume;
      ewBias = this.custom.ewBias;
      moto = this.custom.motoFrac;
    }
    this.motoFracLive = moto;

    for (let i = 0; i < this.spawnWait.length; i++) this.spawnWait[i] = 0;

    const nSpawn = links.reduce((s, l) => s + (l.spawn ? 1 : 0), 0);
    const k = 2.15 / Math.max(6, nSpawn);
    for (const l of links) {
      if (!l.spawn) {
        l.baseRate = 0;
        continue;
      }
      const from = nodes[l.from];
      const ew = l.departFrom === 1 || l.departFrom === 3;
      const lanes = Math.max(1, l.lanes || 1);
      let dirBoost = 1;
      if (ewBias > 0) {
        // Afternoon: eastbound onto Cầu Sông Hàn (Hải Châu → Sơn Trà)
        if (l.departFrom === 1) dirBoost = 1 + ewBias * 1.5;
        if (l.departFrom === 3) dirBoost = 1 - ewBias * 0.58;
        if (l.departFrom === 2) dirBoost = 1 + ewBias * 0.22;
        if (l.departFrom === 0) dirBoost = 1 - ewBias * 0.18;
        if (from.x < WORLD_W * 0.45 && l.departFrom === 1) dirBoost *= 1.3;
        if (/Lê Duẩn|Cầu Sông Hàn/.test(l.name) && l.departFrom === 1) dirBoost *= 1.22;
      } else {
        const b = -ewBias;
        // Morning: westbound into Hải Châu
        if (l.departFrom === 3) dirBoost = 1 + b * 1.4;
        if (l.departFrom === 1) dirBoost = 1 - b * 0.48;
        if (l.departFrom === 0) dirBoost = 1 + b * 0.18;
        if (l.departFrom === 2) dirBoost = 1 + b * 0.14;
        if (from.x > WORLD_W * 0.58 && l.departFrom === 3) dirBoost *= 1.28;
        if (/Cầu Sông Hàn|Lê Duẩn/.test(l.name) && l.departFrom === 3) dirBoost *= 1.15;
      }
      const art = l.arterial || from.arterial ? 1.28 : 0.62;
      let street = 1;
      if (/Lê Lợi|Ngô Gia Tự/.test(l.name)) street = 0.7;
      if (/Lê Duẩn|Cầu Sông Hàn/.test(l.name)) street = 1.12;
      l.baseRate = volume * dirBoost * art * street * k * (ew ? 1.06 : 0.78) * lanes;
    }
  }

  private primeFixedPhases() {
    for (let i = 0; i < NODE_COUNT; i++) this.syncFixed(i, 0);
  }

  private lostTime(cycle: number) {
    return Math.min(cycle * 0.45, 2 * (YELLOW + ALLRED));
  }

  private greens(x: IxState) {
    const lost = this.lostTime(x.cycle);
    const g = Math.max(12, x.cycle - lost);
    const gNS = Math.max(6, g * x.splitNS);
    const gEW = Math.max(6, g - gNS);
    return { gNS, gEW };
  }

  /** Returns 0 NS green, 1 NS yellow, 2 all-red, 3 EW green, 4 EW yellow, 5 all-red */
  private fixedSlot(x: IxState, t: number) {
    const { gNS, gEW } = this.greens(x);
    const tau = ((t + x.offset) % x.cycle + x.cycle) % x.cycle;
    const t1 = gNS;
    const t2 = t1 + YELLOW;
    const t3 = t2 + ALLRED;
    const t4 = t3 + gEW;
    const t5 = t4 + YELLOW;
    if (tau < t1) return 0;
    if (tau < t2) return 1;
    if (tau < t3) return 2;
    if (tau < t4) return 3;
    if (tau < t5) return 4;
    return 5;
  }

  private syncFixed(i: number, t: number) {
    const x = this.ix[i];
    const slot = this.fixedSlot(x, t);
    x.yellow = slot === 1 || slot === 4;
    x.allRed = slot === 2 || slot === 5;
    x.phase = slot <= 2 ? 0 : 1;
  }

  /** Map a graph node id (or already-a-sigId) onto ix[]. -1 = unsignalized / always green. */
  toSig(i: number): number {
    const n = this.net.nodes[i];
    if (n) {
      if (!n.signalized) return -1;
      return n.sigId;
    }
    if (i >= 0 && i < this.ix.length) return i;
    return -1;
  }

  nsGreen(i: number): boolean {
    const s = this.toSig(i);
    if (s < 0) return true;
    const x = this.ix[s];
    return !x.allRed && !x.yellow && x.phase === 0;
  }
  ewGreen(i: number): boolean {
    const s = this.toSig(i);
    if (s < 0) return true;
    const x = this.ix[s];
    return !x.allRed && !x.yellow && x.phase === 1;
  }
  nsYellow(i: number): boolean {
    const s = this.toSig(i);
    if (s < 0) return false;
    const x = this.ix[s];
    return x.yellow && x.phase === 0;
  }
  ewYellow(i: number): boolean {
    const s = this.toSig(i);
    if (s < 0) return false;
    const x = this.ix[s];
    return x.yellow && x.phase === 1;
  }

  approachLit(i: number, a: Approach): 'G' | 'Y' | 'R' {
    if (this.toSig(i) < 0) return 'G';
    const ns = a === N || a === S;
    if (ns) {
      if (this.nsGreen(i)) return 'G';
      if (this.nsYellow(i)) return 'Y';
      return 'R';
    }
    if (this.ewGreen(i)) return 'G';
    if (this.ewYellow(i)) return 'Y';
    return 'R';
  }

  phaseRemaining(i: number): number {
    const s = this.toSig(i);
    if (s < 0) return 0;
    const x = this.ix[s];
    if (this.mode === 'adaptive' || this.mode === 'coord') {
      if (x.yellow) return Math.max(0, YELLOW - x.yElapsed);
      if (x.allRed) return Math.max(0, ALLRED - x.arElapsed);
      return Math.max(0, MAX_GREEN - x.elapsed);
    }
    const { gNS, gEW } = this.greens(x);
    const tau = ((this.t + x.offset) % x.cycle + x.cycle) % x.cycle;
    const t1 = gNS;
    const t2 = t1 + YELLOW;
    const t3 = t2 + ALLRED;
    const t4 = t3 + gEW;
    const t5 = t4 + YELLOW;
    const ends = [t1, t2, t3, t4, t5, x.cycle];
    const slot = this.fixedSlot(x, this.t);
    return Math.max(0, ends[slot] - tau);
  }

  pressureNS(i: number): number {
    const s = this.toSig(i);
    if (s < 0) return 0;
    const x = this.ix[s];
    return x.pN + x.pS;
  }
  pressureEW(i: number): number {
    const s = this.toSig(i);
    if (s < 0) return 0;
    const x = this.ix[s];
    return x.pE + x.pW;
  }

  /** Straight-through outgoing (same heading); else that approach; else any outgoing. */
  private downstreamLink(node: Node, approach: Approach): number {
    const straight = node.outgoing[OPPOSITE[approach]];
    if (straight >= 0) return straight;
    const back = node.outgoing[approach];
    if (back >= 0) return back;
    for (let d = 0; d < 4; d++) {
      if (node.outgoing[d] >= 0) return node.outgoing[d];
    }
    if (node.allOutgoing.length) return node.allOutgoing[0];
    return -1;
  }

  private advanceIntergreen(x: IxState, dt: number): boolean {
    if (x.yellow) {
      x.yElapsed += dt;
      if (x.yElapsed >= YELLOW) {
        x.yellow = false;
        x.allRed = true;
        x.arElapsed = 0;
      }
      return true;
    }
    if (x.allRed) {
      x.arElapsed += dt;
      if (x.arElapsed >= ALLRED) {
        x.allRed = false;
        x.phase = x.phase === 0 ? 1 : 0;
        x.elapsed = 0;
      }
      return true;
    }
    return false;
  }

  private stepSignals(dt: number) {
    if (this.mode !== 'adaptive' && this.mode !== 'coord') {
      for (let i = 0; i < NODE_COUNT; i++) this.syncFixed(i, this.t);
      return;
    }
    this.updateQueues();
    if (this.mode === 'coord') {
      this.stepCoordSignals(dt);
      return;
    }
    for (let i = 0; i < NODE_COUNT; i++) {
      const x = this.ix[i];
      if (this.advanceIntergreen(x, dt)) continue;
      x.elapsed += dt;
      const pNS = x.pN + x.pS;
      const pEW = x.pE + x.pW;
      const serving = x.phase === 0 ? pNS : pEW;
      const other = x.phase === 0 ? pEW : pNS;
      const wantSwitch =
        (x.elapsed >= MIN_GREEN && other > serving + 2.2) || x.elapsed >= MAX_GREEN;
      if (wantSwitch && (other > 0.4 || x.elapsed >= MAX_GREEN)) {
        x.yellow = true;
        x.yElapsed = 0;
      }
    }
  }

  private stepCoordSignals(dt: number) {
    const votes = this.coordVoteHook ? null : coordVotes(this.net, this.ix);
    for (let i = 0; i < NODE_COUNT; i++) {
      const x = this.ix[i];
      if (this.advanceIntergreen(x, dt)) continue;
      x.elapsed += dt;
      const locked = x.elapsed < MIN_GREEN;
      let want = x.elapsed >= MAX_GREEN;
      if (!locked) {
        const vote = this.coordVoteHook ? this.coordVoteHook(i) : votes![i];
        if (vote) want = true;
      }
      if (want) {
        x.yellow = true;
        x.yElapsed = 0;
      }
    }
  }

  updateQueues() {
    const { links, nodes } = this.net;
    const nL = links.length;
    const linkQ = new Array(nL).fill(0);
    const linkFlow = new Array(nL).fill(0);
    for (const x of this.ix) {
      x.qN = x.qE = x.qS = x.qW = 0;
      x.pN = x.pE = x.pS = x.pW = 0;
    }
    let queued = 0;
    for (const l of links) {
      const arr = this.onLink[l.id];
      if (!arr.length) continue;
      const zone = l.length - STOP_PAD - 85;
      let q = 0;
      let flow = 0;
      for (const vi of arr) {
        const v = this.vehicles[vi];
        const w = v.kind === 'car' ? 1.35 : 0.7;
        if (v.s > zone && v.v < 4.5) q += w;
        else flow += w;
      }
      linkQ[l.id] = q;
      linkFlow[l.id] = flow;
      const gn = nodes[l.to];
      if (gn.signalized && gn.sigId >= 0) {
        const ix = this.ix[gn.sigId];
        if (l.approachOfTo === 0) ix.qN += q;
        else if (l.approachOfTo === 1) ix.qE += q;
        else if (l.approachOfTo === 2) ix.qS += q;
        else ix.qW += q;
      }
      queued += q;
    }
    this.queued = queued;

    const GAMMA = 0.6;
    const FLOW_W = 0.22;
    for (let i = 0; i < NODE_COUNT; i++) {
      const gid = this.net.sigOf[i];
      if (gid < 0) continue;
      const node = nodes[gid];
      const x = this.ix[i];
      const press = [0, 0, 0, 0];
      for (let a = 0; a < 4; a++) {
        let demand = 0;
        for (const inId of node.allIncoming) {
          if (inId < 0) continue;
          if (links[inId].approachOfTo !== a) continue;
          demand += linkQ[inId] + FLOW_W * linkFlow[inId];
        }
        const outId = this.downstreamLink(node, a as Approach);
        const down = outId >= 0 ? linkQ[outId] : 0;
        press[a] = demand - GAMMA * down;
      }
      x.pN = press[0];
      x.pE = press[1];
      x.pS = press[2];
      x.pW = press[3];
    }
  }

  private pickDest(fromNode: number): number {
    const bias = this.scenario === 'afternoon' || (this.scenario === 'custom' && this.custom.ewBias > 0.15);
    const reverse = this.scenario === 'rush' || (this.scenario === 'custom' && this.custom.ewBias < -0.15);
    const pool =
      bias && this.net.eastBorder.length
        ? this.net.eastBorder
        : reverse && this.net.westBorder.length
          ? this.net.westBorder
          : this.net.border;
    const use = this.spawnRng.chance(0.72) ? pool : this.net.border;
    const hop = this.net.nextHop[fromNode];
    const reachable = (d: number) => d !== fromNode && hop && hop[d] >= 0;
    for (let k = 0; k < 12; k++) {
      const d = this.spawnRng.pick(use);
      if (reachable(d)) return d;
    }
    const fb = this.net.border.find((id) => reachable(id));
    if (fb !== undefined) return fb;
    for (let i = 0; i < this.net.nodes.length; i++) if (reachable(i)) return i;
    return fromNode;
  }

  private trySpawn(dt: number) {
    const { links, nodes } = this.net;
    for (const l of links) {
      if (l.baseRate <= 0) continue;
      this.spawnWait[l.id] -= dt;
      if (this.spawnWait[l.id] > 0) continue;
      this.spawnWait[l.id] = this.spawnRng.exp(l.baseRate);
      if (this.free.length === 0) continue;
      const occ = this.onLink[l.id];
      const nLanes = Math.max(1, l.lanes || 1);
      const kind: VehicleKind = this.spawnRng.chance(this.motoFracLive) ? 'moto' : 'car';
      const spec = SPECS[kind];
      let bestLane = 0;
      let bestMinS = -1;
      for (let lane = 0; lane < nLanes; lane++) {
        let minS = 1e9;
        for (const vi of occ) {
          const ov = this.vehicles[vi];
          if ((ov.lane || 0) === lane && ov.s < minS) minS = ov.s;
        }
        if (minS > bestMinS) {
          bestMinS = minS;
          bestLane = lane;
        }
      }
      if (bestMinS < spec.length + spec.minGap + 4) continue;
      const idx = this.free.pop()!;
      const v = this.vehicles[idx];
      v.alive = true;
      v.kind = kind;
      v.link = l.id;
      v.s = spec.length * 0.5 + 0.4;
      v.v = Math.min(l.speedLimit, spec.vMax) * 0.6;
      v.dest = this.pickDest(l.to);
      v.wait = 0;
      v.stops = 0;
      v.stopped = false;
      v.spawnT = this.t;
      v.hue = this.spawnRng.range(0, 1);
      v.lat = this.spawnRng.range(-0.45, 0.45) * (kind === 'moto' ? 1.4 : 0.35);
      v.lane = bestLane;
      v.crossing = 0;
      v.nextLink = -1;
      v.color = kind === 'moto' ? this.spawnRng.int(0, 5) : this.spawnRng.int(0, 4);
      occ.push(idx);
    }
    void nodes;
  }

  private sortLink(id: number) {
    const arr = this.onLink[id];
    const vehs = this.vehicles;
    arr.sort((a, b) => vehs[b].s - vehs[a].s);
  }

  private movementAllowed(sigId: number, approach: Approach, dist: number, v: number, specDecel: number): boolean {
    const x = this.ix[sigId];
    if (!x) return true;
    const ns = approach === N || approach === S;
    const serving = ns ? x.phase === 0 : x.phase === 1;
    const green = serving && !x.allRed && !x.yellow;
    if (green) return true;
    const yellow = serving && x.yellow;
    if (!yellow) return false;
    const stopDist = (v * v) / (2 * specDecel) + 1.2;
    return stopDist > dist + 1.4;
  }

  private nextLinkId(fromNode: number, dest: number): number {
    if (fromNode === dest) return -2;
    const hop = this.net.nextHop[fromNode][dest];
    if (hop < 0 || hop === fromNode) return -2;
    const node = this.net.nodes[fromNode];
    for (const lid of node.allOutgoing) {
      if (lid >= 0 && this.net.links[lid].to === hop) return lid;
    }
    for (let d = 0; d < 4; d++) {
      const lid = node.outgoing[d];
      if (lid >= 0 && this.net.links[lid].to === hop) return lid;
    }
    return -1;
  }

  private beginCrossing(vi: number, l: Link, nextId: number) {
    const v = this.vehicles[vi];
    const nlink = this.net.links[nextId];
    const spec = SPECS[v.kind];
    const lat = LANE_LAT(v, l);
    const p0 = linkSample(l, v.s);
    const x0 = p0.x + p0.rx * lat;
    const y0 = p0.y + p0.ry * lat;
    const node = this.net.nodes[l.to];
    const nlat = LANE_LAT(v, nlink);
    const s1 = 6.2;
    const p2 = linkSample(nlink, s1);
    const x2 = p2.x + p2.rx * nlat;
    const y2 = p2.y + p2.ry * nlat;
    v.cx0 = x0;
    v.cy0 = y0;
    v.cx1 = node.x;
    v.cy1 = node.y;
    v.cx2 = x2;
    v.cy2 = y2;
    v.cv = Math.max(3.2, Math.min(v.v, 8.5));
    v.crossing = 0.02;
    v.nextLink = nextId;
    v.s = v.s;
    const arr = this.onLink[l.id];
    const k = arr.indexOf(vi);
    if (k >= 0) arr.splice(k, 1);
    void spec;
  }

  private finishCrossing(vi: number) {
    const v = this.vehicles[vi];
    const nextId = v.nextLink;
    v.crossing = 0;
    if (nextId < 0) {
      this.despawn(vi, true);
      return;
    }
    const spec = SPECS[v.kind];
    const occ = this.onLink[nextId];
    const nlink = this.net.links[nextId];
    const nLanes = Math.max(1, nlink.lanes || 1);
    v.lane = Math.max(0, Math.min(nLanes - 1, v.lane || 0));
    let minS = 1e9;
    for (const oj of occ) {
      const o = this.vehicles[oj];
      if ((o.lane || 0) === v.lane && o.s < minS) minS = o.s;
    }
    v.link = nextId;
    v.s = 6.2;
    if (minS < v.s + spec.length + spec.minGap) {
      v.s = Math.max(2.4, minS - spec.length - spec.minGap);
    }
    v.v = Math.min(v.cv, this.net.links[nextId].speedLimit);
    v.nextLink = -1;
    occ.push(vi);
  }

  private despawn(vi: number, completed: boolean) {
    const v = this.vehicles[vi];
    if (!v.alive) return;
    if (v.crossing <= 0) {
      const arr = this.onLink[v.link];
      const k = arr.indexOf(vi);
      if (k >= 0) arr.splice(k, 1);
    }
    if (completed) {
      this.totalCompleted++;
      this.arrivalsAcc++;
      this.completedWait.push(v.wait);
      this.completedStops.push(v.stops);
      this.completedTimes.push(this.t);
      if (this.completedWait.length > 160) {
        this.completedWait.shift();
        this.completedStops.shift();
        this.completedTimes.shift();
      }
    }
    v.alive = false;
    v.crossing = 0;
    this.free.push(vi);
  }

  step(dt: number) {
    if (dt <= 0) return;
    if (dt > 0.25) dt = 0.25;
    this.t += dt;
    this.stepSignals(dt);
    this.trySpawn(dt);

    const { links, nodes } = this.net;
    for (let li = 0; li < links.length; li++) this.sortLink(li);

    for (let li = 0; li < links.length; li++) {
      const l = links[li];
      const arr = this.onLink[li];
      const stopLine = l.length - STOP_PAD;
      const ixId = l.to;
      const toNode = nodes[ixId];
      const approach = l.approachOfTo;
      const sigId = toNode.signalized ? toNode.sigId : -1;
      const order = arr.slice();

      for (let k = 0; k < order.length; k++) {
        const vi = order[k];
        if (!this.vehicles[vi].alive || this.vehicles[vi].crossing > 0) continue;
        const veh = this.vehicles[vi];
        if (!veh.alive || veh.crossing > 0) continue;
        const spec = SPECS[veh.kind];
        const v0 = Math.min(spec.vMax, l.speedLimit);
        const myLane = veh.lane || 0;
        let leadVi = -1;
        let leadS = 1e9;
        for (const oj of arr) {
          if (oj === vi) continue;
          const o = this.vehicles[oj];
          if (!o.alive || o.crossing > 0 || o.link !== l.id) continue;
          if ((o.lane || 0) !== myLane) continue;
          if (o.s > veh.s && o.s < leadS) {
            leadS = o.s;
            leadVi = oj;
          }
        }
        let vLead = v0;
        let gap = stopLine - veh.s + 8;
        if (leadVi >= 0) {
          const lead = this.vehicles[leadVi];
          const leadSpec = SPECS[lead.kind];
          gap = lead.s - leadSpec.length - veh.s;
          vLead = lead.v;
        }
        let acc = idmAcc(veh.v, v0, vLead, gap, veh.kind);

        const dist = stopLine - veh.s;
        const nextId = this.nextLinkId(ixId, veh.dest);
        const allowed =
          sigId < 0 || this.movementAllowed(sigId, approach, dist, veh.v, spec.decel);
        const laneLead = leadVi < 0;

        if (dist < 55) {
          if (!allowed) {
            const vgap = Math.max(0.2, dist - 0.6);
            acc = Math.min(acc, idmAcc(veh.v, v0, 0, vgap, veh.kind));
          } else if (laneLead && dist < 10 && nextId >= 0) {
            const nocc = this.onLink[nextId];
            const nLanes = Math.max(1, this.net.links[nextId].lanes || 1);
            const nl = Math.max(0, Math.min(nLanes - 1, myLane));
            let minS = 1e9;
            for (const oj of nocc) {
              const o = this.vehicles[oj];
              if ((o.lane || 0) === nl && o.s < minS) minS = o.s;
            }
            const need = spec.length + spec.minGap + 7;
            if (minS < need) {
              const vgap = Math.max(0.2, dist - 0.4);
              acc = Math.min(acc, idmAcc(veh.v, v0, 0, vgap, veh.kind));
            }
          }
        }

        veh.v += acc * dt;
        if (veh.v < 0) veh.v = 0;
        if (veh.v > v0) veh.v = v0;
        veh.s += veh.v * dt;

        if (veh.v < 0.55) {
          veh.wait += dt;
          if (!veh.stopped && veh.s > stopLine - 90) {
            veh.stops++;
            veh.stopped = true;
          }
        } else if (veh.v > 2.2) {
          veh.stopped = false;
        }

        if (laneLead && veh.s >= stopLine - 0.35) {
          veh.s = Math.min(veh.s, stopLine + 0.2);
          if (nextId === -2) {
            this.despawn(vi, true);
            continue;
          }
          if (allowed && nextId >= 0) {
            const nocc = this.onLink[nextId];
            const nLanes = Math.max(1, this.net.links[nextId].lanes || 1);
            const nl = Math.max(0, Math.min(nLanes - 1, myLane));
            let minS = 1e9;
            for (const oj of nocc) {
              const o = this.vehicles[oj];
              if ((o.lane || 0) === nl && o.s < minS) minS = o.s;
            }
            if (minS > spec.length + spec.minGap + 6.5) {
              this.beginCrossing(vi, l, nextId);
            } else {
              veh.v = 0;
              veh.s = stopLine;
            }
          } else if (!allowed) {
            veh.v = 0;
            veh.s = Math.min(veh.s, stopLine);
          }
        }
      }
    }

    for (let vi = 0; vi < this.vehicles.length; vi++) {
      const veh = this.vehicles[vi];
      if (!veh.alive || veh.crossing <= 0) continue;
      const dx = veh.cx2 - veh.cx0;
      const dy = veh.cy2 - veh.cy0;
      const span = Math.max(12, Math.hypot(dx, dy) + JUNCTION_R * 0.4);
      veh.crossing += (veh.cv * dt) / span;
      if (veh.crossing >= 1) this.finishCrossing(vi);
    }

    this.arrivalsWindow += dt;
    this.sampleAcc += dt;
    if (this.sampleAcc >= 0.5) {
      this.sampleAcc = 0;
      const m = this.metrics();
      this.history.push({
        t: this.t,
        avgWait: m.avgWait,
        p95Wait: m.p95Wait,
        throughput: m.throughput,
        stops: m.stops,
        queued: m.queued,
      });
      if (this.history.length > 240) this.history.splice(0, this.history.length - 240);
    }
    void nodes;
  }

  metrics(): Metrics {
    let alive = 0;
    let motos = 0;
    let cars = 0;
    let speed = 0;
    let liveWait = 0;
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      alive++;
      if (v.kind === 'moto') motos++;
      else cars++;
      speed += v.v;
      liveWait += v.wait;
    }
    const waits = this.completedWait;
    const n = waits.length;
    let avgWait = 0;
    let p95 = 0;
    let stops = 0;
    if (n > 0) {
      let s = 0;
      for (const w of waits) s += w;
      avgWait = s / n;
      const sorted = waits.slice().sort((a, b) => a - b);
      p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
      let st = 0;
      for (const x of this.completedStops) st += x;
      stops = st / n;
    } else if (alive > 0) {
      avgWait = liveWait / alive;
      p95 = avgWait * 1.6;
    }
    const dur = Math.max(8, this.arrivalsWindow);
    const throughput = (this.arrivalsAcc / dur) * 3600;
    return {
      t: this.t,
      vehicles: alive,
      motos,
      cars,
      avgWait,
      p95Wait: p95,
      throughput,
      stops,
      queued: this.queued,
      completed: this.totalCompleted,
      avgSpeed: alive ? (speed / alive) * 3.6 : 0,
    };
  }

  liveCounts() {
    this.updateQueues();
    return this.ix;
  }
}

function LANE_LAT(v: Vehicle, l?: Link) {
  const jitter = v.lat;
  const n = Math.max(1, l?.lanes || 1);
  if (n <= 1) return (v.kind === 'moto' ? 3.05 : 3.45) + jitter;
  const pitch = 3.25;
  const right = 2.2;
  const lane = Math.max(0, Math.min(n - 1, v.lane || 0));
  return right + lane * pitch + jitter * 0.4;
}

export function vehiclePos(sim: TrafficSim, v: Vehicle) {
  if (v.crossing > 0) {
    const t = Math.min(1, v.crossing);
    const u = 1 - t;
    const x = u * u * v.cx0 + 2 * u * t * v.cx1 + t * t * v.cx2;
    const y = u * u * v.cy0 + 2 * u * t * v.cy1 + t * t * v.cy2;
    const dx = 2 * (u * (v.cx1 - v.cx0) + t * (v.cx2 - v.cx1));
    const dy = 2 * (u * (v.cy1 - v.cy0) + t * (v.cy2 - v.cy1));
    return { x, y, h: Math.atan2(dy, dx), lat: 0 };
  }
  const l = sim.net.links[v.link];
  const lat = LANE_LAT(v, l);
  const p = linkSample(l, v.s);
  return {
    x: p.x + p.rx * lat,
    y: p.y + p.ry * lat,
    h: p.heading,
    lat,
  };
}

export function naivePlan(): TimingPlan {
  return defaultPlan();
}

export function greenWaveSeed(cycle = 80): TimingPlan {
  const splitNS = Array(NODE_COUNT).fill(0.42);
  const offset = Array(NODE_COUNT).fill(0);
  const net = buildNetwork();
  for (let i = 0; i < NODE_COUNT; i++) {
    const gid = net.sigOf[i];
    const n = gid >= 0 ? net.nodes[gid] : null;
    if (!n) continue;
    offset[i] = ((n.x / 13.5) % cycle + cycle) % cycle;
    let ns = 0;
    let ew = 0;
    for (const lid of n.allIncoming) {
      const a = net.links[lid].approachOfTo;
      if (a === N || a === S) ns++;
      else ew++;
    }
    if (ns + ew > 0) splitNS[i] = Math.max(0.28, Math.min(0.72, 0.32 + (ns / (ns + ew)) * 0.36));
  }
  return { cycle, splitNS, offset };
}

export { LANE_LAT };
