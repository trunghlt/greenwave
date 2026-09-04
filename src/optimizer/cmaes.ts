import { TrafficSim, greenWaveSeed, naivePlan } from '../sim/engine';
import { NODE_COUNT } from '../sim/network';
import { type TimingPlan, type ScenarioId, type CustomDemand } from '../sim/types';
import { RNG } from '../sim/rng';

export interface EvalResult {
  plan: TimingPlan;
  avgWait: number;
  p95Wait: number;
  throughput: number;
  stops: number;
  fitness: number;
}

export interface OptimizerState {
  running: boolean;
  gen: number;
  maxGen: number;
  evals: number;
  totalEvals: number;
  best: EvalResult | null;
  baseline: EvalResult | null;
  log: { gen: number; best: number; mean: number }[];
}

const N = 1 + NODE_COUNT * 2;
const CYCLE_LO = 64;
const CYCLE_HI = 110;
const SPLIT_LO = 0.24;
const SPLIT_HI = 0.76;

function clamp(x: number, a: number, b: number) {
  return x < a ? a : x > b ? b : x;
}

export const NETWORK_GENE_COUNT = N;
export const JUNCTION_GENE_COUNT = 3;

function clonePlan(p: TimingPlan): TimingPlan {
  return {
    cycle: p.cycle,
    splitNS: p.splitNS.slice(),
    offset: p.offset.slice(),
    cycles: p.cycles && p.cycles.length === NODE_COUNT ? p.cycles.slice() : undefined,
  };
}

function ensureCycles(p: TimingPlan): number[] {
  if (p.cycles && p.cycles.length === NODE_COUNT) return p.cycles.slice();
  return Array.from({ length: NODE_COUNT }, () => p.cycle);
}

/** Encode one junction's cycle / splitNS / offset into [0,1]^3. */
export function junctionPlanToX(p: TimingPlan, sigId: number): number[] {
  const cycles = ensureCycles(p);
  const cycle = clamp(cycles[sigId] ?? p.cycle, CYCLE_LO, CYCLE_HI);
  const split = clamp(p.splitNS[sigId] ?? 0.5, SPLIT_LO, SPLIT_HI);
  const off = ((((p.offset[sigId] ?? 0) % cycle) + cycle) % cycle);
  return [
    (cycle - CYCLE_LO) / (CYCLE_HI - CYCLE_LO),
    (split - SPLIT_LO) / (SPLIT_HI - SPLIT_LO),
    off / Math.max(1, cycle),
  ];
}

/** Decode [0,1]^3 onto a clone of basePlan, patching only sigId. */
export function xToJunctionPlan(x: number[], base: TimingPlan, sigId: number): TimingPlan {
  const plan = clonePlan(base);
  const cycles = ensureCycles(plan);
  const cycle = clamp(
    Math.round(CYCLE_LO + clamp(x[0], 0, 1) * (CYCLE_HI - CYCLE_LO)),
    CYCLE_LO,
    CYCLE_HI,
  );
  const split = SPLIT_LO + clamp(x[1], 0, 1) * (SPLIT_HI - SPLIT_LO);
  const offset = clamp(x[2], 0, 1) * cycle;
  cycles[sigId] = cycle;
  plan.cycles = cycles;
  plan.splitNS[sigId] = split;
  plan.offset[sigId] = offset;
  return plan;
}

export function planToX(p: TimingPlan): number[] {
  const cycle = clamp(p.cycle, CYCLE_LO, CYCLE_HI);
  const x = new Array(N);
  x[0] = (cycle - CYCLE_LO) / (CYCLE_HI - CYCLE_LO);
  for (let i = 0; i < NODE_COUNT; i++) {
    x[1 + i] = (clamp(p.splitNS[i], SPLIT_LO, SPLIT_HI) - SPLIT_LO) / (SPLIT_HI - SPLIT_LO);
    const off = ((p.offset[i] % cycle) + cycle) % cycle;
    x[1 + NODE_COUNT + i] = off / cycle;
  }
  return x;
}

export function xToPlan(x: number[]): TimingPlan {
  const cycle = clamp(Math.round(CYCLE_LO + clamp(x[0], 0, 1) * (CYCLE_HI - CYCLE_LO)), CYCLE_LO, CYCLE_HI);
  const splitNS: number[] = [];
  const offset: number[] = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    splitNS.push(SPLIT_LO + clamp(x[1 + i], 0, 1) * (SPLIT_HI - SPLIT_LO));
    offset.push(clamp(x[1 + NODE_COUNT + i], 0, 1) * cycle);
  }
  return { cycle, splitNS, offset };
}

export function evaluatePlan(
  plan: TimingPlan,
  scenario: ScenarioId,
  custom: CustomDemand,
  seed: number,
  seconds = 60,
): EvalResult {
  const sim = new TrafficSim(seed, true);
  sim.headless = true;
  sim.setScenario(scenario);
  sim.setCustom(custom);
  sim.applyPlan(plan, false);
  sim.setMode('fixed');
  sim.reset(seed);
  sim.applyPlan(plan, false);
  const dt = 0.25;
  const steps = Math.ceil(seconds / dt);
  for (let i = 0; i < steps; i++) sim.step(dt);
  const m = sim.metrics();
  const fitness = m.throughput / (8 + m.avgWait) - m.stops * 0.15 - m.p95Wait * 0.02;
  return {
    plan: clonePlan(plan),
    avgWait: m.avgWait,
    p95Wait: m.p95Wait,
    throughput: m.throughput,
    stops: m.stops,
    fitness,
  };
}

/** Symmetric Jacobi eigensolver. A is row-major n×n, overwritten as eigenvectors. */
function jacobiEigen(A: number[], n: number): number[] {
  const d = new Array(n);
  for (let i = 0; i < n; i++) d[i] = A[i * n + i];
  const V = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  const b = d.slice();
  const z = new Array(n).fill(0);

  for (let it = 0; it < 80; it++) {
    let off = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) off += Math.abs(A[i * n + j]);
    }
    if (off < 1e-14 * n) break;
    const thresh = it < 4 ? (0.2 * off) / (n * n) : 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        const g = 100 * Math.abs(apq);
        if (it > 4 && Math.abs(d[p]) + g === Math.abs(d[p]) && Math.abs(d[q]) + g === Math.abs(d[q])) {
          A[p * n + q] = 0;
          A[q * n + p] = 0;
          continue;
        }
        if (Math.abs(apq) <= thresh) continue;
        let h = d[q] - d[p];
        let t: number;
        if (Math.abs(h) + g === Math.abs(h)) {
          t = apq / h;
        } else {
          const theta = (0.5 * h) / apq;
          t = 1 / (Math.abs(theta) + Math.sqrt(1 + theta * theta));
          if (theta < 0) t = -t;
        }
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        const tau = s / (1 + c);
        h = t * apq;
        z[p] -= h;
        z[q] += h;
        d[p] -= h;
        d[q] += h;
        A[p * n + q] = 0;
        A[q * n + p] = 0;
        for (let j = 0; j < p; j++) rot(A, n, j, p, j, q, s, tau);
        for (let j = p + 1; j < q; j++) rot(A, n, p, j, j, q, s, tau);
        for (let j = q + 1; j < n; j++) rot(A, n, p, j, q, j, s, tau);
        for (let j = 0; j < n; j++) {
          const vjp = V[j * n + p];
          const vjq = V[j * n + q];
          V[j * n + p] = vjp - s * (vjq + vjp * tau);
          V[j * n + q] = vjq + s * (vjp - vjq * tau);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      b[i] += z[i];
      d[i] = b[i];
      z[i] = 0;
    }
  }
  for (let i = 0; i < n * n; i++) A[i] = V[i];
  return d;
}

function rot(A: number[], n: number, r1: number, c1: number, r2: number, c2: number, s: number, tau: number) {
  const g = A[r1 * n + c1];
  const h = A[r2 * n + c2];
  A[r1 * n + c1] = g - s * (h + g * tau);
  A[r2 * n + c2] = h + s * (g - h * tau);
}

export type CMAESScope = 'network' | 'junction';

export interface CMAESOptions {
  scope?: CMAESScope;
  /** Signal index (0..NODE_COUNT-1) when scope === 'junction'. */
  sigId?: number;
  /** Live plan to patch; required for meaningful junction search. */
  basePlan?: TimingPlan;
}

/**
 * CMA-ES over the shared cycle + per-junction splitNS and offset (network),
 * or over one junction's cycle / splitNS / offset (junction).
 * Pump() evaluates one genome per call so the UI can slice it on the main thread.
 */
export class CMAESOptimizer {
  rng: RNG;
  gen = 0;
  maxGen = 5;
  lambda = 12;
  scenario: ScenarioId;
  custom: CustomDemand;
  seed: number;
  running = false;
  evals = 0;
  totalEvals = 0;
  baseline: EvalResult | null = null;
  log: { gen: number; best: number; mean: number }[] = [];
  best: EvalResult | null = null;
  queue: TimingPlan[] = [];
  current: EvalResult[] = [];
  cyclePref: number;
  scope: CMAESScope = 'network';
  sigId = 0;
  basePlan: TimingPlan | null = null;

  private n = N;
  private mu: number;
  private weights: number[] = [];
  private mueff = 0;
  private cc = 0;
  private cs = 0;
  private c1 = 0;
  private cmu = 0;
  private damps = 0;
  private chiN = 0;
  private m: number[] = [];
  private sigma = 0.16;
  private pc: number[] = [];
  private ps: number[] = [];
  private C: number[] = [];
  private B: number[] = [];
  private D: number[] = [];
  private eigeneval = 0;
  private sampledY: number[][] = [];
  private sampledX: number[][] = [];

  constructor(
    scenario: ScenarioId,
    custom: CustomDemand,
    seed: number,
    cycle = 80,
    opts: CMAESOptions = {},
  ) {
    this.scenario = scenario;
    this.custom = { ...custom };
    this.seed = seed;
    this.rng = new RNG(seed ^ 0x51ed);
    this.cyclePref = cycle;
    this.scope = opts.scope ?? 'network';
    this.sigId = opts.sigId ?? 0;
    this.basePlan = opts.basePlan ? clonePlan(opts.basePlan) : null;
    this.n = this.scope === 'junction' ? JUNCTION_GENE_COUNT : N;
    const n = this.n;
    this.lambda = this.scope === 'junction' ? 10 : 12;
    this.maxGen = this.scope === 'junction' ? 6 : 5;
    this.mu = Math.floor(this.lambda / 2);
    const raw = Array.from({ length: this.mu }, (_, i) => Math.log(this.mu + 0.5) - Math.log(i + 1));
    const sw = raw.reduce((a, b) => a + b, 0);
    this.weights = raw.map((w) => w / sw);
    this.mueff = 1 / this.weights.reduce((s, w) => s + w * w, 0);
    this.cc = (4 + this.mueff / n) / (n + 4 + 2 * this.mueff / n);
    this.cs = (this.mueff + 2) / (n + this.mueff + 5);
    this.c1 = 2 / ((n + 1.3) * (n + 1.3) + this.mueff);
    this.cmu = Math.min(1 - this.c1, 2 * (this.mueff - 2 + 1 / this.mueff) / ((n + 2) * (n + 2) + this.mueff));
    this.damps = 1 + 2 * Math.max(0, Math.sqrt((this.mueff - 1) / (n + 1)) - 1) + this.cs;
    this.chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
  }

  /** Gene count for the active scope (41 network / 3 junction). */
  geneCount(): number {
    return this.n;
  }

  start() {
    this.running = true;
    this.gen = 0;
    this.evals = 0;
    this.log = [];
    this.best = null;
    this.baseline = null;
    this.current = [];
    this.queue = [];
    this.sampledY = [];
    this.sampledX = [];

    const n = this.n;
    if (this.scope === 'junction') {
      const base = this.basePlan ?? naivePlan();
      this.basePlan = clonePlan(base);
      this.m = junctionPlanToX(base, this.sigId);
      this.sigma = 0.22;
    } else {
      const gw = greenWaveSeed(this.cyclePref);
      this.m = planToX(gw);
      this.sigma = 0.16;
    }
    this.pc = new Array(n).fill(0);
    this.ps = new Array(n).fill(0);
    this.C = new Array(n * n).fill(0);
    this.B = new Array(n * n).fill(0);
    this.D = new Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      this.C[i * n + i] = 1;
      this.B[i * n + i] = 1;
    }
    this.eigeneval = 0;

    if (this.scope === 'junction') {
      this.queue.push(clonePlan(this.basePlan!));
    } else {
      const naive = naivePlan();
      naive.cycle = this.cyclePref;
      this.queue.push(naive);
    }
    this.enqueueSamples();
    this.totalEvals = 1 + this.lambda * this.maxGen;
  }

  private enqueueSamples() {
    const n = this.n;
    this.sampledY = [];
    this.sampledX = [];
    for (let k = 0; k < this.lambda; k++) {
      const z = Array.from({ length: n }, () => this.rng.gaussian());
      const y = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = 0; j < n; j++) s += this.B[i * n + j] * this.D[j] * z[j];
        y[i] = s;
      }
      const x = this.m.map((mi, i) => mi + this.sigma * y[i]);
      for (let i = 0; i < n; i++) x[i] = clamp(x[i], -0.15, 1.15);
      const yAdj = x.map((xi, i) => (xi - this.m[i]) / Math.max(1e-12, this.sigma));
      this.sampledY.push(yAdj);
      this.sampledX.push(x);
      if (this.scope === 'junction') {
        this.queue.push(xToJunctionPlan(x, this.basePlan!, this.sigId));
      } else {
        this.queue.push(xToPlan(x));
      }
    }
  }

  private decompose() {
    const n = this.n;
    const A = this.C.slice();
    const eig = jacobiEigen(A, n);
    for (let i = 0; i < n; i++) {
      this.D[i] = Math.sqrt(Math.max(1e-16, eig[i]));
      for (let j = 0; j < n; j++) this.B[j * n + i] = A[j * n + i];
    }
  }

  private updateDistribution() {
    const n = this.n;
    const ranked = this.current
      .map((ev, idx) => ({ ev, idx }))
      .sort((a, b) => b.ev.fitness - a.ev.fitness);
    const meanFit = this.current.reduce((s, e) => s + e.fitness, 0) / this.current.length;
    this.log.push({ gen: this.gen, best: ranked[0].ev.fitness, mean: meanFit });
    if (!this.best || ranked[0].ev.fitness > this.best.fitness) this.best = ranked[0].ev;

    const yW = new Array(n).fill(0);
    for (let k = 0; k < this.mu; k++) {
      const y = this.sampledY[ranked[k].idx];
      const w = this.weights[k];
      for (let i = 0; i < n; i++) yW[i] += w * y[i];
    }
    for (let i = 0; i < n; i++) this.m[i] += this.sigma * yW[i];
    for (let i = 0; i < n; i++) this.m[i] = clamp(this.m[i], 0, 1);

    const tmp = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += this.B[j * n + i] * yW[j];
      tmp[i] = s / Math.max(1e-12, this.D[i]);
    }
    const cInv = Math.sqrt(this.cs * (2 - this.cs) * this.mueff);
    let psN = 0;
    for (let i = 0; i < n; i++) {
      let inv = 0;
      for (let j = 0; j < n; j++) inv += this.B[i * n + j] * tmp[j];
      this.ps[i] = (1 - this.cs) * this.ps[i] + cInv * inv;
      psN += this.ps[i] * this.ps[i];
    }
    psN = Math.sqrt(psN);
    const hsig =
      psN / Math.sqrt(1 - Math.pow(1 - this.cs, 2 * (this.gen + 1))) / this.chiN <
      1.4 + 2 / (n + 1)
        ? 1
        : 0;
    const cInv2 = Math.sqrt(this.cc * (2 - this.cc) * this.mueff);
    for (let i = 0; i < n; i++) {
      this.pc[i] = (1 - this.cc) * this.pc[i] + hsig * cInv2 * yW[i];
    }

    const c = this.C;
    const one = 1 - this.c1 - this.cmu;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let v = one * c[i * n + j] + this.c1 * this.pc[i] * this.pc[j];
        for (let k = 0; k < this.mu; k++) {
          const yi = this.sampledY[ranked[k].idx][i];
          const yj = this.sampledY[ranked[k].idx][j];
          v += this.cmu * this.weights[k] * yi * yj;
        }
        c[i * n + j] = v;
        c[j * n + i] = v;
      }
    }
    this.sigma *= Math.exp((this.cs / this.damps) * (psN / this.chiN - 1));
    this.sigma = clamp(this.sigma, 0.02, 0.55);
    this.decompose();
    this.gen++;
  }

  pump(): {
    done: boolean;
    progress: number;
    best: EvalResult | null;
    message: string;
    msgKey: string;
    msgParams?: Record<string, string | number>;
  } {
    if (!this.running) {
      return { done: true, progress: 1, best: this.best, message: 'Idle', msgKey: 'opt.idle' };
    }
    if (this.queue.length) {
      const plan = this.queue.shift()!;
      const ev = evaluatePlan(plan, this.scenario, this.custom, this.seed, 55);
      this.evals++;
      if (!this.baseline) this.baseline = ev;
      if (!this.best || ev.fitness > this.best.fitness) this.best = ev;
      if (this.evals > 1) this.current.push(ev);
      const progress = Math.min(0.99, this.evals / Math.max(1, this.totalEvals));
      const params = { evals: this.evals, total: this.totalEvals, gen: this.gen, max: this.maxGen };
      return {
        done: false,
        progress,
        best: this.best,
        message:
          this.evals === 1
            ? this.scope === 'junction'
              ? 'CMA-ES baseline (current plan)…'
              : 'CMA-ES baseline (naive 50/50)…'
            : `CMA-ES sample ${this.evals}/${this.totalEvals} · gen ${this.gen}/${this.maxGen}`,
        msgKey:
          this.evals === 1
            ? this.scope === 'junction'
              ? 'opt.junction.baseline'
              : 'opt.baseline'
            : 'opt.sample',
        msgParams: params,
      };
    }

    if (this.current.length >= this.lambda && this.gen < this.maxGen) {
      this.updateDistribution();
      this.current = [];
      if (this.gen >= this.maxGen) {
        this.running = false;
        return {
          done: true,
          progress: 1,
          best: this.best,
          message: `CMA-ES converged · gen ${this.gen}`,
          msgKey: 'opt.converged',
          msgParams: { gen: this.gen },
        };
      }
      this.enqueueSamples();
      return {
        done: false,
        progress: Math.min(0.99, this.evals / Math.max(1, this.totalEvals)),
        best: this.best,
        message: `CMA-ES generation ${this.gen}/${this.maxGen}`,
        msgKey: 'opt.generation',
        msgParams: { gen: this.gen, max: this.maxGen },
      };
    }

    this.running = false;
    return {
      done: true,
      progress: 1,
      best: this.best,
      message: `CMA-ES done · gen ${this.gen}`,
      msgKey: 'opt.done',
      msgParams: { gen: this.gen },
    };
  }

  snapshot(): OptimizerState {
    return {
      running: this.running,
      gen: this.gen,
      maxGen: this.maxGen,
      evals: this.evals,
      totalEvals: this.totalEvals,
      best: this.best,
      baseline: this.baseline,
      log: this.log,
    };
  }
}
