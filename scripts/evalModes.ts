import { TrafficSim } from '../src/sim/engine';
import type { ControlMode } from '../src/sim/types';

const DT = 0.25;
const SEED = 9091;
const SECONDS = 90;

function run(mode: ControlMode) {
  const sim = new TrafficSim(SEED, true);
  sim.headless = true;
  sim.setScenario('afternoon');
  sim.setMode(mode);
  sim.reset(SEED);
  sim.setMode(mode);
  const steps = Math.ceil(SECONDS / DT);
  for (let i = 0; i < steps; i++) sim.step(DT);
  const m = sim.metrics();
  return {
    mode,
    t: m.t,
    wait: m.avgWait,
    p95: m.p95Wait,
    thru: m.throughput,
    stops: m.stops,
    queued: m.queued,
    completed: m.completed,
    vehicles: m.vehicles,
  };
}

for (const mode of ['fixed', 'adaptive', 'coord'] as ControlMode[]) {
  const r = run(mode);
  console.log(JSON.stringify(r));
}
