/** Seeded mulberry32 + helpers. Deterministic across the sim, optimizer evals, and demand. */
export class RNG {
  private s: number;

  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }

  seed(seed: number) {
    this.s = seed >>> 0 || 1;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }

  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1 - 1e-9));
  }

  pick<T>(arr: T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  chance(p: number) {
    return this.next() < p;
  }

  /** Exponential inter-arrival with rate λ (events per second). */
  exp(lambda: number) {
    if (lambda <= 0) return 1e9;
    const u = Math.max(1e-12, this.next());
    return -Math.log(u) / lambda;
  }

  /** Standard normal via Box–Muller. */
  gaussian() {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  clone() {
    const r = new RNG(1);
    r.s = this.s;
    return r;
  }
}
