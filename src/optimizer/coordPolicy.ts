import { MAX_GREEN, MIN_GREEN } from '../sim/types';
import type { Network } from '../sim/network';
import { COORD_WEIGHTS, type CoordWeights } from './coordWeights';

export const STATE_DIM = 7;
export const HIDDEN = 24;
export const N_ACTIONS = 2;

export interface IxView {
  phase: 0 | 1;
  elapsed: number;
  yellow: boolean;
  allRed: boolean;
  qN: number;
  qE: number;
  qS: number;
  qW: number;
  pN: number;
  pE: number;
  pS: number;
  pW: number;
}

let active: CoordWeights = COORD_WEIGHTS;

export function setActiveWeights(w: CoordWeights) {
  active = w;
}

export function getActiveWeights(): CoordWeights {
  return active;
}

export function neighborIndices(net: Network, i: number): number[] {
  const start = net.sigOf ? net.sigOf[i] : i;
  if (start === undefined || start < 0) return [];
  const out: number[] = [];
  const seenN = new Set<number>([start]);
  const seenS = new Set<number>();
  const q = [start];
  while (q.length) {
    const u = q.shift()!;
    const node = net.nodes[u];
    if (!node) continue;
    const nxt: number[] = [];
    const outLids = node.allOutgoing && node.allOutgoing.length ? node.allOutgoing : node.outgoing.filter((id) => id >= 0);
    for (const lid of outLids) if (lid >= 0) nxt.push(net.links[lid].to);
    for (const lid of node.allIncoming || []) if (lid >= 0) nxt.push(net.links[lid].from);
    for (const v of nxt) {
      if (seenN.has(v)) continue;
      seenN.add(v);
      const vn = net.nodes[v];
      if (!vn) continue;
      if (vn.signalized) {
        if (vn.sigId !== i && !seenS.has(vn.sigId)) {
          seenS.add(vn.sigId);
          out.push(vn.sigId);
        }
      } else {
        q.push(v);
      }
    }
    if (out.length > 8) break;
  }
  return out;
}

export function encodeNode(ix: IxView): number[] {
  return [
    ix.qN / 15,
    ix.qE / 15,
    ix.qS / 15,
    ix.qW / 15,
    Math.min(1, ix.elapsed / MAX_GREEN),
    ix.phase,
    ix.elapsed < MIN_GREEN ? 1 : 0,
  ];
}

export function randn(rng: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function initWeights(rng: () => number, scale = 0.18): CoordWeights {
  const S = STATE_DIM;
  const H = HIDDEN;
  const fill = (n: number, s: number) => Array.from({ length: n }, () => randn(rng) * s);
  return {
    kind: 'qattn',
    H,
    S,
    Ws: fill(H * S, scale / Math.sqrt(S)),
    bs: new Array(H).fill(0),
    Wn: fill(H * S, scale / Math.sqrt(S)),
    bn: new Array(H).fill(0),
    Wo: fill(H * (2 * H), scale / Math.sqrt(2 * H)),
    bo: new Array(H).fill(0),
    Wq: fill(N_ACTIONS * H, scale / Math.sqrt(H)),
    bq: new Array(N_ACTIONS).fill(0),
    beta: 0.35,
    trained: false,
    note: 'random init',
  };
}

function tanh(x: number) {
  if (x > 8) return 1;
  if (x < -8) return -1;
  const e = Math.exp(-2 * x);
  return (1 - e) / (1 + e);
}

function matvec(W: number[], b: number[], x: number[], rows: number, cols: number, y: number[]) {
  for (let r = 0; r < rows; r++) {
    let s = b[r];
    const off = r * cols;
    for (let c = 0; c < cols; c++) s += W[off + c] * x[c];
    y[r] = s;
  }
}

export interface ForwardCache {
  S: number[][];
  h: number[][];
  m: number[][];
  Q: number[][];
  votes: boolean[];
}

/** One graph-attention layer, then Q(keep, switch) per junction. */
export function forwardAll(net: Network, ix: IxView[], w: CoordWeights): ForwardCache {
  const Sdim = w.S || STATE_DIM;
  const H = w.H || HIDDEN;
  const S: number[][] = [];
  const h: number[][] = [];
  const m: number[][] = [];
  for (let i = 0; i < ix.length; i++) {
    const s = encodeNode(ix[i]);
    S.push(s);
    const hi = new Array(H);
    const mi = new Array(H);
    matvec(w.Ws, w.bs, s, H, Sdim, hi);
    matvec(w.Wn, w.bn, s, H, Sdim, mi);
    for (let k = 0; k < H; k++) {
      hi[k] = tanh(hi[k]);
      mi[k] = tanh(mi[k]);
    }
    h.push(hi);
    m.push(mi);
  }

  const invSqrt = 1 / Math.sqrt(H);
  const Q: number[][] = [];
  const votes: boolean[] = [];
  const concat = new Array(2 * H);
  const zPre = new Array(H);
  const z = new Array(H);
  const qv = new Array(N_ACTIONS);

  for (let i = 0; i < ix.length; i++) {
    const neigh = neighborIndices(net, i);
    const agg = new Array(H).fill(0);
    if (neigh.length) {
      const scores = new Array(neigh.length);
      let maxS = -1e9;
      for (let n = 0; n < neigh.length; n++) {
        const mj = m[neigh[n]];
        let dot = 0;
        const hi = h[i];
        for (let k = 0; k < H; k++) dot += hi[k] * mj[k];
        scores[n] = dot * invSqrt;
        if (scores[n] > maxS) maxS = scores[n];
      }
      let den = 0;
      for (let n = 0; n < neigh.length; n++) {
        scores[n] = Math.exp(scores[n] - maxS);
        den += scores[n];
      }
      const inv = 1 / Math.max(1e-9, den);
      for (let n = 0; n < neigh.length; n++) {
        const a = scores[n] * inv;
        const mj = m[neigh[n]];
        for (let k = 0; k < H; k++) agg[k] += a * mj[k];
      }
    }
    const hi = h[i];
    for (let k = 0; k < H; k++) {
      concat[k] = hi[k];
      concat[H + k] = agg[k];
    }
    matvec(w.Wo, w.bo, concat, H, 2 * H, zPre);
    for (let k = 0; k < H; k++) z[k] = tanh(zPre[k]);
    matvec(w.Wq, w.bq, z, N_ACTIONS, H, qv);
    Q.push([qv[0], qv[1]]);
    votes.push(qv[1] > qv[0]);
  }
  return { S, h, m, Q, votes };
}

/** Graph-smoothed advanced max-pressure: attention over neighbor pressures. */
export function graphMpVotes(net: Network, ix: IxView[], beta = 0.35): boolean[] {
  const pNS = new Array(ix.length);
  const pEW = new Array(ix.length);
  for (let i = 0; i < ix.length; i++) {
    pNS[i] = ix[i].pN + ix[i].pS;
    pEW[i] = ix[i].pE + ix[i].pW;
  }
  const votes: boolean[] = [];
  for (let i = 0; i < ix.length; i++) {
    const x = ix[i];
    if (x.yellow || x.allRed) {
      votes.push(false);
      continue;
    }
    const neigh = neighborIndices(net, i);
    let sNS = pNS[i];
    let sEW = pEW[i];
    if (neigh.length) {
      const scores = new Array(neigh.length);
      let maxS = -1e9;
      for (let n = 0; n < neigh.length; n++) {
        const j = neigh[n];
        scores[n] = pNS[i] * pNS[j] + pEW[i] * pEW[j];
        if (scores[n] > maxS) maxS = scores[n];
      }
      let den = 0;
      for (let n = 0; n < neigh.length; n++) {
        scores[n] = Math.exp((scores[n] - maxS) * 0.08);
        den += scores[n];
      }
      const inv = 1 / Math.max(1e-9, den);
      let aNS = 0;
      let aEW = 0;
      for (let n = 0; n < neigh.length; n++) {
        const a = scores[n] * inv;
        aNS += a * pNS[neigh[n]];
        aEW += a * pEW[neigh[n]];
      }
      sNS = (1 - beta) * pNS[i] + beta * aNS;
      sEW = (1 - beta) * pEW[i] + beta * aEW;
    }
    const serving = x.phase === 0 ? sNS : sEW;
    const other = x.phase === 0 ? sEW : sNS;
    votes.push(x.elapsed >= MIN_GREEN && other > serving + 2.2);
  }
  return votes;
}

export function coordVotes(net: Network, ix: IxView[]): boolean[] {
  const w = active;
  const expect = (w.H || 24) * (w.S || 7);
  const mismatch = !w.Ws || w.Ws.length !== expect;
  if (w.kind === 'qattn' && w.Ws.length && w.trained && !mismatch) {
    return forwardAll(net, ix, w).votes;
  }
  return graphMpVotes(net, ix, w.beta ?? 0.35);
}

/** Manual backprop of MSE(Q, target) for a single junction. Neighbour states are constants. */
export function trainQStep(
  w: CoordWeights,
  net: Network,
  ix: IxView[],
  i: number,
  target: number[],
  lr: number,
  clip = 2.5,
): number {
  const H = w.H;
  const Sdim = w.S;
  const cache = forwardAll(net, ix, w);
  const Q = cache.Q[i];
  const err0 = Q[0] - target[0];
  const err1 = Q[1] - target[1];
  const loss = 0.5 * (err0 * err0 + err1 * err1);
  const dQ = [err0, err1];

  const neigh = neighborIndices(net, i);
  const hi = cache.h[i];
  const s_i = cache.S[i];
  const invSqrt = 1 / Math.sqrt(H);

  const scores: number[] = [];
  const alpha: number[] = [];
  const agg = new Array(H).fill(0);
  if (neigh.length) {
    let maxS = -1e9;
    for (let n = 0; n < neigh.length; n++) {
      const mj = cache.m[neigh[n]];
      let dot = 0;
      for (let k = 0; k < H; k++) dot += hi[k] * mj[k];
      const sc = dot * invSqrt;
      scores.push(sc);
      if (sc > maxS) maxS = sc;
    }
    let den = 0;
    const ex: number[] = [];
    for (let n = 0; n < neigh.length; n++) {
      const e = Math.exp(scores[n] - maxS);
      ex.push(e);
      den += e;
    }
    const inv = 1 / Math.max(1e-9, den);
    for (let n = 0; n < neigh.length; n++) {
      const a = ex[n] * inv;
      alpha.push(a);
      const mj = cache.m[neigh[n]];
      for (let k = 0; k < H; k++) agg[k] += a * mj[k];
    }
  }

  const concat = new Array(2 * H);
  for (let k = 0; k < H; k++) {
    concat[k] = hi[k];
    concat[H + k] = agg[k];
  }
  const zPre = new Array(H);
  matvec(w.Wo, w.bo, concat, H, 2 * H, zPre);
  const z = zPre.map(tanh);
  const dtanh = (t: number) => 1 - t * t;

  const dZ = new Array(H).fill(0);
  for (let a = 0; a < N_ACTIONS; a++) {
    const g = dQ[a];
    w.bq[a] -= lr * Math.max(-clip, Math.min(clip, g));
    for (let k = 0; k < H; k++) {
      const gg = g * z[k];
      w.Wq[a * H + k] -= lr * Math.max(-clip, Math.min(clip, gg));
      dZ[k] += g * w.Wq[a * H + k];
    }
  }
  const dConcat = new Array(2 * H).fill(0);
  for (let k = 0; k < H; k++) {
    const gz = dZ[k] * dtanh(z[k]);
    w.bo[k] -= lr * Math.max(-clip, Math.min(clip, gz));
    for (let c = 0; c < 2 * H; c++) {
      const gg = gz * concat[c];
      w.Wo[k * (2 * H) + c] -= lr * Math.max(-clip, Math.min(clip, gg));
      dConcat[c] += gz * w.Wo[k * (2 * H) + c];
    }
  }
  const dH = dConcat.slice(0, H);
  const dAgg = dConcat.slice(H);

  if (neigh.length) {
    const dScore = new Array(neigh.length).fill(0);
    for (let n = 0; n < neigh.length; n++) {
      const mj = cache.m[neigh[n]];
      let dot = 0;
      for (let k = 0; k < H; k++) dot += dAgg[k] * mj[k];
      dScore[n] += dot;
      const a = alpha[n];
      for (let k = 0; k < H; k++) {
        const dm = a * dAgg[k];
        const mval = mj[k];
        const gpre = dm * (1 - mval * mval);
        const sj = cache.S[neigh[n]];
        w.bn[k] -= lr * 0.25 * Math.max(-clip, Math.min(clip, gpre));
        for (let c = 0; c < Sdim; c++) {
          w.Wn[k * Sdim + c] -= lr * 0.25 * Math.max(-clip, Math.min(clip, gpre * sj[c]));
        }
        dH[k] += a * dAgg[k] * 0;
      }
    }
    let meanDs = 0;
    for (let n = 0; n < neigh.length; n++) meanDs += alpha[n] * dScore[n];
    for (let n = 0; n < neigh.length; n++) {
      const ds = alpha[n] * (dScore[n] - meanDs);
      const mj = cache.m[neigh[n]];
      for (let k = 0; k < H; k++) dH[k] += ds * invSqrt * mj[k];
    }
  }

  for (let k = 0; k < H; k++) {
    const gpre = dH[k] * (1 - hi[k] * hi[k]);
    w.bs[k] -= lr * Math.max(-clip, Math.min(clip, gpre));
    for (let c = 0; c < Sdim; c++) {
      w.Ws[k * Sdim + c] -= lr * Math.max(-clip, Math.min(clip, gpre * s_i[c]));
    }
  }
  return loss;
}

export function cloneWeights(w: CoordWeights): CoordWeights {
  return {
    kind: w.kind,
    H: w.H,
    S: w.S,
    Ws: w.Ws.slice(),
    bs: w.bs.slice(),
    Wn: w.Wn.slice(),
    bn: w.bn.slice(),
    Wo: w.Wo.slice(),
    bo: w.bo.slice(),
    Wq: w.Wq.slice(),
    bq: w.bq.slice(),
    beta: w.beta,
    trained: w.trained,
    note: w.note,
    eval: w.eval ? { ...w.eval } : undefined,
  };
}

export function serializeWeights(w: CoordWeights, digits = 5): string {
  const rnd = (arr: number[]) => arr.map((x) => Number(x.toFixed(digits)));
  const obj = {
    kind: w.kind,
    H: w.H,
    S: w.S,
    Ws: rnd(w.Ws),
    bs: rnd(w.bs),
    Wn: rnd(w.Wn),
    bn: rnd(w.bn),
    Wo: rnd(w.Wo),
    bo: rnd(w.bo),
    Wq: rnd(w.Wq),
    bq: rnd(w.bq),
    beta: w.beta,
    trained: w.trained,
    note: w.note,
    eval: w.eval,
  };
  return (
    `/** Shipped graph-attention policy weights. Regenerated by scripts/trainCoord.ts. */\n` +
    `import type { CoordWeights } from './coordWeights';\n\n` +
    `export const COORD_WEIGHTS: CoordWeights = ${JSON.stringify(obj, null, 2)};\n`
  );
}
