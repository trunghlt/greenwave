import { N, E, S, W, OPPOSITE, type Approach } from './types';
import { ensureRiverBridges } from './ensureBridges';
import rawMap from './mapGraph.json';

export interface PolyPt {
  x: number;
  y: number;
}

export interface Node {
  id: number;
  col: number;
  row: number;
  x: number;
  y: number;
  name: string;
  district: string;
  arterial: boolean;
  signalized: boolean;
  sigId: number;
  /** incoming link id by approach (N/E/S/W), -1 if none */
  incoming: number[];
  /** outgoing link id by approach, -1 if none */
  outgoing: number[];
  allIncoming: number[];
  allOutgoing: number[];
  streets: string[];
}

export interface Link {
  id: number;
  from: number;
  to: number;
  length: number;
  heading: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ux: number;
  uy: number;
  rx: number;
  ry: number;
  speedLimit: number;
  arterial: boolean;
  bridge: boolean;
  name: string;
  approachOfTo: Approach;
  departFrom: Approach;
  spawn: boolean;
  baseRate: number;
  polyline: PolyPt[];
  cum: number[];
  lanes: number;
  widthM: number;
  oneway: boolean;
}

type RawNode = {
  x: number;
  y: number;
  name: string;
  district: string;
  arterial: boolean;
  signalized: boolean;
  sigId: number;
  rank?: number;
  streets?: string[];
};
type RawLink = {
  from: number;
  to: number;
  poly: number[][];
  name: string;
  arterial: boolean;
  bridge?: boolean;
  speedLimit: number;
  length: number;
  spawn?: boolean;
  lanes?: number;
  widthM?: number;
  oneway?: boolean;
};

export interface ContextWay {
  name: string;
  highway: string;
  rank: number;
  bridge: boolean;
  poly: PolyPt[];
}

type RawContext = {
  poly: number[][];
  name?: string;
  highway?: string;
  rank?: number;
  bridge?: boolean;
};

const G = rawMap as {
  source: string;
  area: string;
  worldW: number;
  worldH: number;
  riverX: number;
  river: number[][];
  nodes: RawNode[];
  links: RawLink[];
  context?: RawContext[];
  signalCount: number;
  simplifications?: { notes?: string[] };
};

export const WORLD_W = G.worldW;
export const WORLD_H = G.worldH;
export const NODE_COUNT = G.signalCount;
export const MAP_SOURCE = G.source;
export const MAP_AREA = G.area;
export const RIVER_X = G.riverX;

function dirBin(ux: number, uy: number): Approach {
  const deg = (Math.atan2(uy, ux) * 180) / Math.PI;
  if (deg >= -45 && deg < 45) return E;
  if (deg >= 45 && deg < 135) return S;
  if (deg >= -135 && deg < -45) return N;
  return W;
}

function polyLen(pts: PolyPt[]): { length: number; cum: number[] } {
  const cum = [0];
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    cum.push(length);
  }
  return { length, cum };
}

export function linkSample(l: Link, s: number) {
  const poly = l.polyline;
  if (!poly || poly.length < 2) {
    return {
      x: l.x1 + l.ux * s,
      y: l.y1 + l.uy * s,
      ux: l.ux,
      uy: l.uy,
      rx: l.rx,
      ry: l.ry,
      heading: l.heading,
    };
  }
  const cum = l.cum;
  const n = cum.length - 1;
  let i = 0;
  if (s <= 0) i = 0;
  else if (s >= l.length) i = Math.max(0, n - 1);
  else {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid + 1] < s) lo = mid + 1;
      else hi = mid;
    }
    i = lo;
  }
  const x0 = poly[i].x;
  const y0 = poly[i].y;
  const x1 = poly[i + 1].x;
  const y1 = poly[i + 1].y;
  const seg = Math.max(1e-6, cum[i + 1] - cum[i]);
  const t = (s - cum[i]) / seg;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  return {
    x: x0 + dx * t,
    y: y0 + dy * t,
    ux,
    uy,
    rx: uy,
    ry: -ux,
    heading: Math.atan2(uy, ux),
  };
}

function headingAt(pts: PolyPt[], atStart: boolean): { ux: number; uy: number } {
  if (pts.length < 2) return { ux: 1, uy: 0 };
  if (atStart) {
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const L = Math.hypot(dx, dy) || 1;
    return { ux: dx / L, uy: dy / L };
  }
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  return { ux: dx / L, uy: dy / L };
}

let cached: Network | null = null;

export function buildNetwork(): Network {
  if (cached) return cached;

  const nodes: Node[] = G.nodes.map((n, id) => ({
    id,
    col: Math.max(0, Math.min(4, Math.floor((n.x / Math.max(1, WORLD_W)) * 5))),
    row: Math.max(0, Math.min(3, Math.floor((n.y / Math.max(1, WORLD_H)) * 4))),
    x: n.x,
    y: n.y,
    name: n.name,
    district: n.district,
    arterial: n.arterial,
    signalized: n.signalized,
    sigId: n.signalized ? n.sigId : -1,
    incoming: [-1, -1, -1, -1],
    outgoing: [-1, -1, -1, -1],
    allIncoming: [],
    allOutgoing: [],
    streets: n.streets || [],
  }));

  const links: Link[] = [];
  for (const rl of G.links) {
    if (rl.from < 0 || rl.to < 0 || rl.from >= nodes.length || rl.to >= nodes.length) continue;
    const pts: PolyPt[] = (rl.poly || []).map((p) => ({ x: p[0], y: p[1] }));
    if (pts.length < 2) {
      pts.length = 0;
      pts.push({ x: nodes[rl.from].x, y: nodes[rl.from].y }, { x: nodes[rl.to].x, y: nodes[rl.to].y });
    }
    const { length, cum } = polyLen(pts);
    if (length < 4) continue;
    const start = headingAt(pts, true);
    const end = headingAt(pts, false);
    const ux = (pts[pts.length - 1].x - pts[0].x) / length;
    const uy = (pts[pts.length - 1].y - pts[0].y) / length;
    const nu = Math.hypot(ux, uy) || 1;
    const ux0 = ux / nu;
    const uy0 = uy / nu;
    const departFrom = dirBin(start.ux, start.uy);
    const approachOfTo = OPPOSITE[dirBin(end.ux, end.uy)] as Approach;
    const id = links.length;
    const link: Link = {
      id,
      from: rl.from,
      to: rl.to,
      length,
      heading: Math.atan2(end.uy, end.ux),
      x1: pts[0].x,
      y1: pts[0].y,
      x2: pts[pts.length - 1].x,
      y2: pts[pts.length - 1].y,
      ux: ux0,
      uy: uy0,
      rx: uy0,
      ry: -ux0,
      speedLimit: rl.speedLimit || 12,
      arterial: !!rl.arterial,
      bridge: !!rl.bridge,
      name: rl.name || '',
      approachOfTo,
      departFrom,
      spawn: !!rl.spawn,
      baseRate: 0,
      polyline: pts,
      cum,
      lanes: Math.max(1, Math.round(rl.lanes || (rl.bridge || rl.arterial ? 2 : 1))),
      widthM: rl.widthM || Math.max(3.5, (rl.lanes || (rl.bridge || rl.arterial ? 2 : 1)) * 3.5),
      oneway: !!rl.oneway,
    };
    links.push(link);
    const a = nodes[rl.from];
    const b = nodes[rl.to];
    a.allOutgoing.push(id);
    b.allIncoming.push(id);
    a.outgoing[departFrom] = id;
    b.incoming[approachOfTo] = id;
  }

  ensureRiverBridges(nodes, links, G.riverX, dirBin, polyLen, headingAt);
  const nN = nodes.length;
  const nextHop: number[][] = Array.from({ length: nN }, () => Array(nN).fill(-1));
  for (let src = 0; src < nN; src++) {
    const q = [src];
    nextHop[src][src] = src;
    const prev = Array(nN).fill(-1);
    prev[src] = src;
    let qi = 0;
    while (qi < q.length) {
      const u = q[qi++];
      for (const lid of nodes[u].allOutgoing) {
        const v = links[lid].to;
        if (prev[v] < 0) {
          prev[v] = u;
          q.push(v);
        }
      }
    }
    for (let dst = 0; dst < nN; dst++) {
      if (dst === src || prev[dst] < 0) continue;
      let cur = dst;
      while (prev[cur] !== src) cur = prev[cur];
      nextHop[src][dst] = cur;
    }
  }

  const sigOf: number[] = Array(NODE_COUNT).fill(-1);
  for (const n of nodes) {
    if (n.signalized && n.sigId >= 0 && n.sigId < NODE_COUNT) sigOf[n.sigId] = n.id;
  }

  const border: number[] = [];
  const eastBorder: number[] = [];
  const westBorder: number[] = [];
  const edge = Math.min(220, Math.max(70, Math.min(WORLD_W, WORLD_H) * 0.18));
  for (const n of nodes) {
    const near =
      n.x < edge || n.y < edge || n.x > WORLD_W - edge || n.y > WORLD_H - edge || n.allOutgoing.length <= 1;
    if (near) {
      border.push(n.id);
      if (n.x > WORLD_W * 0.62) eastBorder.push(n.id);
      if (n.x < WORLD_W * 0.38) westBorder.push(n.id);
    }
  }
  if (!eastBorder.length) {
    const byX = nodes.slice().sort((a, b) => b.x - a.x);
    for (let i = 0; i < Math.min(8, byX.length); i++) eastBorder.push(byX[i].id);
  }
  if (!westBorder.length) {
    const byX = nodes.slice().sort((a, b) => a.x - b.x);
    for (let i = 0; i < Math.min(8, byX.length); i++) westBorder.push(byX[i].id);
  }
  if (!border.length) {
    for (const n of nodes) border.push(n.id);
  }

  const river: PolyPt[] = (G.river || []).map((p) => ({ x: p[0], y: p[1] }));
  const context: ContextWay[] = (G.context || [])
    .map((c) => ({
      name: c.name || '',
      highway: c.highway || 'tertiary',
      rank: c.rank ?? 1,
      bridge: !!c.bridge,
      poly: (c.poly || []).map((p) => ({ x: p[0], y: p[1] })),
    }))
    .filter((c) => c.poly.length >= 2);

  cached = {
    nodes,
    links,
    nextHop,
    border,
    eastBorder,
    westBorder,
    sigOf,
    signalCount: NODE_COUNT,
    worldW: WORLD_W,
    worldH: WORLD_H,
    river,
    riverX: RIVER_X,
    context,
    source: G.source,
    area: G.area,
  };
  return cached;
}

export type Network = {
  nodes: Node[];
  links: Link[];
  nextHop: number[][];
  border: number[];
  eastBorder: number[];
  westBorder: number[];
  sigOf: number[];
  signalCount: number;
  worldW: number;
  worldH: number;
  river: PolyPt[];
  riverX: number;
  context: ContextWay[];
  source: string;
  area: string;
};

export const NET = buildNetwork();
