import { OPPOSITE, type Approach } from './types';

type Pt = { x: number; y: number };
type N = {
  id: number;
  x: number;
  y: number;
  name: string;
  signalized?: boolean;
  allOutgoing: number[];
  allIncoming: number[];
  outgoing: number[];
  incoming: number[];
};
type L = {
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
  signalized?: boolean;
  approachOfTo: Approach;
  departFrom: Approach;
  spawn: boolean;
  baseRate: number;
  polyline: Pt[];
  cum: number[];
  lanes: number;
  widthM: number;
  oneway?: boolean;
};

type DirFn = (ux: number, uy: number) => Approach;
type LenFn = (pts: Pt[]) => { length: number; cum: number[] };
type HeadFn = (pts: Pt[], atStart: boolean) => { ux: number; uy: number };

export function ensureRiverBridges(
  nodes: N[],
  links: L[],
  riverX: number,
  dirBin: DirFn,
  polyLen: LenFn,
  headingAt: HeadFn,
) {
  if (links.some((l) => l.bridge || /Cầu Sông Hàn/.test(l.name))) {
    return;
  }
  const pushBridge = (from: number, to: number, name: string) => {
    const A = nodes[from];
    const B = nodes[to];
    const pts: Pt[] = [
      { x: A.x, y: A.y },
      { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 },
      { x: B.x, y: B.y },
    ];
    const { length, cum } = polyLen(pts);
    const start = headingAt(pts, true);
    const end = headingAt(pts, false);
    const ux0 = (B.x - A.x) / Math.max(1e-6, length);
    const uy0 = (B.y - A.y) / Math.max(1e-6, length);
    const departFrom = dirBin(start.ux, start.uy);
    const approachOfTo = OPPOSITE[dirBin(end.ux, end.uy)] as Approach;
    const id = links.length;
    links.push({
      id,
      from,
      to,
      length,
      heading: Math.atan2(end.uy, end.ux),
      x1: A.x,
      y1: A.y,
      x2: B.x,
      y2: B.y,
      ux: ux0,
      uy: uy0,
      rx: uy0,
      ry: -ux0,
      speedLimit: 13.5,
      arterial: true,
      bridge: true,
      name,
      approachOfTo,
      departFrom,
      spawn: false,
      baseRate: 0,
      polyline: pts,
      cum,
      lanes: 2,
      widthM: 7,
      oneway: false,
    });
    A.allOutgoing.push(id);
    B.allIncoming.push(id);
    A.outgoing[departFrom] = id;
    B.incoming[approachOfTo] = id;
  };

  const hasPair = (i: number, j: number) =>
    links.some((l) => (l.from === i && l.to === j) || (l.from === j && l.to === i));

  const named = (re: RegExp) => nodes.filter((n) => re.test(n.name));

  const stitch = (left: N[], right: N[], name: string) => {
    for (const a of left) {
      for (const b of right) {
        if (a.id === b.id || hasPair(a.id, b.id)) continue;
        pushBridge(a.id, b.id, name);
        pushBridge(b.id, a.id, name);
      }
    }
  };

  stitch(named(/Rong Tay|Rồng Tây/), named(/Rong Dong|Rồng Đông/), 'Cầu Rồng');
  stitch(
    named(/Tran Thi Ly Tay|Trần Thị Lý Tây/),
    named(/Nguyen Van Thoai . Ngo Quyen|Nguyễn Văn Thoại × Ngô Quyền/),
    'Cầu Trần Thị Lý',
  );

  const west = nodes.filter((n) => n.x < riverX - 30 && (n as N & {signalized?: boolean}).signalized);
  const east = nodes.filter((n) => n.x > riverX + 30 && n.signalized);
  for (const a of west) {
    let best: N | null = null;
    let bd = 150;
    for (const b of east) {
      const dy = Math.abs(a.y - b.y);
      const dx = Math.abs(a.x - b.x);
      if (dy < bd && dx > 280 && dx < 1100) {
        bd = dy;
        best = b;
      }
    }
    if (best && !hasPair(a.id, best.id) && bd < 145) {
      const nm = a.y < 2500 ? 'Cầu Sông Hàn' : a.y < 3800 ? 'Cầu Rồng' : 'Cầu Trần Thị Lý';
      pushBridge(a.id, best.id, nm);
      pushBridge(best.id, a.id, nm);
    }
  }
}
