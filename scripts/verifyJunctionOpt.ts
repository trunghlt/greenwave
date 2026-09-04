import {
  CMAESOptimizer,
  NETWORK_GENE_COUNT,
  JUNCTION_GENE_COUNT,
  xToJunctionPlan,
  junctionPlanToX,
  planToX,
  xToPlan,
} from '../src/optimizer/cmaes';
import { NODE_COUNT } from '../src/sim/network';
import { naivePlan } from '../src/sim/engine';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const net = new CMAESOptimizer('afternoon', { volume: 1, ewBias: 0.55, motoFrac: 0.72 }, 2026, 80, {
  scope: 'network',
});
assert(net.geneCount() === NETWORK_GENE_COUNT, `network genes ${net.geneCount()}`);
assert(NETWORK_GENE_COUNT === 1 + NODE_COUNT * 2, 'network gene formula');
assert(NETWORK_GENE_COUNT === 41, `expected 41 got ${NETWORK_GENE_COUNT}`);

const base = naivePlan();
base.cycle = 88;
base.splitNS = base.splitNS.map((_, i) => 0.3 + (i % 7) * 0.05);
base.offset = base.offset.map((_, i) => (i * 7) % 88);
base.cycles = Array.from({ length: NODE_COUNT }, (_, i) => 70 + (i % 5));

const sigId = 3;
const x = [0.5, 0.6, 0.25];
const patched = xToJunctionPlan(x, base, sigId);

for (let i = 0; i < NODE_COUNT; i++) {
  if (i === sigId) continue;
  assert(patched.splitNS[i] === base.splitNS[i], `splitNS[${i}] changed`);
  assert(patched.offset[i] === base.offset[i], `offset[${i}] changed`);
  assert(patched.cycles![i] === base.cycles![i], `cycles[${i}] changed`);
}
assert(patched.cycle === base.cycle, 'shared cycle should stay');
assert(junctionPlanToX(patched, sigId).length === JUNCTION_GENE_COUNT, 'junction genes 3');

const jOpt = new CMAESOptimizer('afternoon', { volume: 1, ewBias: 0.55, motoFrac: 0.72 }, 2026, 80, {
  scope: 'junction',
  sigId,
  basePlan: base,
});
assert(jOpt.geneCount() === 3, 'junction geneCount');
jOpt.start();
assert(jOpt.queue.length === 1 + jOpt.lambda, 'queue seeded');
const first = jOpt.queue[0];
for (let i = 0; i < NODE_COUNT; i++) {
  assert(first.splitNS[i] === base.splitNS[i], `baseline split ${i}`);
  assert(first.offset[i] === base.offset[i], `baseline offset ${i}`);
  assert(first.cycles![i] === base.cycles![i], `baseline cycle ${i}`);
}
const sample = jOpt.queue[1];
let changed = 0;
for (let i = 0; i < NODE_COUNT; i++) {
  const s = sample.splitNS[i] !== base.splitNS[i];
  const o = sample.offset[i] !== base.offset[i];
  const c = sample.cycles![i] !== base.cycles![i];
  if (i !== sigId) assert(!s && !o && !c, `sample mutated other junction ${i}`);
  if (s || o || c) changed++;
}
assert(changed <= 1, `only sigId may change, changed count=${changed}`);
assert(planToX(base).length === 41, 'planToX length');
assert(xToPlan(planToX(base)).splitNS.length === NODE_COUNT, 'xToPlan');

console.log(
  JSON.stringify({
    ok: true,
    NETWORK_GENE_COUNT,
    JUNCTION_GENE_COUNT,
    NODE_COUNT,
    patchedSig: {
      cycle: patched.cycles![sigId],
      split: patched.splitNS[sigId],
      offset: patched.offset[sigId],
    },
  }),
);
