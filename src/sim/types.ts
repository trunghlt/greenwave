export const N = 0;
export const E = 1;
export const S = 2;
export const W = 3;
export type Approach = 0 | 1 | 2 | 3;
export const APPROACH_NAME = ['N', 'E', 'S', 'W'] as const;
export const OPPOSITE: Approach[] = [2, 3, 0, 1];

export type VehicleKind = 'car' | 'moto';
export type ControlMode = 'fixed' | 'adaptive' | 'coord' | 'optimized';
export type ScenarioId = 'rush' | 'midday' | 'afternoon' | 'custom';

export interface VehicleSpec {
  kind: VehicleKind;
  length: number;
  width: number;
  vMax: number;
  accel: number;
  decel: number;
  minGap: number;
  headway: number;
}

export const SPECS: Record<VehicleKind, VehicleSpec> = {
  moto: {
    kind: 'moto',
    length: 1.85,
    width: 0.72,
    vMax: 13.8,
    accel: 3.4,
    decel: 7.0,
    minGap: 1.5,
    headway: 0.7,
  },
  car: {
    kind: 'car',
    length: 4.5,
    width: 1.85,
    vMax: 12.2,
    accel: 2.15,
    decel: 5.4,
    minGap: 2.6,
    headway: 1.15,
  },
};

export interface TimingPlan {
  cycle: number;
  splitNS: number[];
  offset: number[];
  /** When set (length NODE_COUNT), Fixed/Optimized use per-junction cycles instead of shared `cycle`. */
  cycles?: number[];
}

export interface CustomDemand {
  volume: number;
  ewBias: number;
  motoFrac: number;
}

export interface Metrics {
  t: number;
  vehicles: number;
  motos: number;
  cars: number;
  avgWait: number;
  p95Wait: number;
  throughput: number;
  stops: number;
  queued: number;
  completed: number;
  avgSpeed: number;
}

export interface BaselineDelta {
  avgWait: number;
  p95Wait: number;
  throughput: number;
  stops: number;
}

export const LANE_OFFSET = 3.4;
export const LANE_WIDTH = 3.25;
export const JUNCTION_R = 14;
export const STOP_PAD = 13.5;

export const YELLOW = 3.0;
export const ALLRED = 1.0;
export const MIN_GREEN = 8;
export const MAX_GREEN = 52;
