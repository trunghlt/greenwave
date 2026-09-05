import type { ScenarioId } from './sim/types';

export const OPT_LOGBOOK_KEY = 'greenwave.optLogbook';
export const OPT_LOGBOOK_CAP = 50;

export type OptLogScope = 'junction' | 'network';
export type OptLogSource = 'manual' | 'auto';

export type OptTimingSnap = {
  cycle: number;
  splitNS: number;
  offset: number;
};

export type OptMetricsSnap = {
  avgWait: number;
  p95Wait: number;
  throughput: number;
  stops: number;
  fitness: number;
};

export type OptLogEntry = {
  id: string;
  at: string;
  simT: number;
  scope: OptLogScope;
  source: OptLogSource;
  sigId?: number;
  junctionName?: string;
  scenario: ScenarioId;
  seed: number;
  before?: OptTimingSnap;
  after?: OptTimingSnap;
  metrics: OptMetricsSnap;
  baselineMetrics?: OptMetricsSnap;
  deltas?: {
    cycle?: number;
    split?: number;
    offset?: number;
    avgWait?: number;
  };
};

export function loadOptLogbook(): OptLogEntry[] {
  try {
    const raw = localStorage.getItem(OPT_LOGBOOK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isOptLogEntry).slice(0, OPT_LOGBOOK_CAP);
  } catch {
    return [];
  }
}

export function saveOptLogbook(entries: OptLogEntry[]) {
  try {
    localStorage.setItem(OPT_LOGBOOK_KEY, JSON.stringify(entries.slice(0, OPT_LOGBOOK_CAP)));
  } catch {
    /* ignore quota / private mode */
  }
}

export function prependOptLogEntry(prev: OptLogEntry[], entry: OptLogEntry): OptLogEntry[] {
  const next = [entry, ...prev].slice(0, OPT_LOGBOOK_CAP);
  saveOptLogbook(next);
  return next;
}

export function clearOptLogbook(): OptLogEntry[] {
  saveOptLogbook([]);
  return [];
}

function isOptLogEntry(x: unknown): x is OptLogEntry {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.at === 'string' &&
    typeof e.simT === 'number' &&
    (e.scope === 'junction' || e.scope === 'network') &&
    (e.source === 'manual' || e.source === 'auto') &&
    typeof e.scenario === 'string' &&
    typeof e.seed === 'number' &&
    !!e.metrics &&
    typeof e.metrics === 'object'
  );
}

export function formatClock(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '--:--';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '--:--';
  }
}

export function pct(split: number): string {
  return `${Math.round(split * 100)}%`;
}

export function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}
