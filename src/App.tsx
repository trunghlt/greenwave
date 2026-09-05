import { useEffect, useMemo, useRef, useState } from 'react';
import { TrafficSim } from './sim/engine';
import { Renderer } from './render/renderer';
import { CMAESOptimizer, type EvalResult } from './optimizer/cmaes';
import {
  type ControlMode,
  type CustomDemand,
  type Metrics,
  type ScenarioId,
} from './sim/types';
import { NODE_COUNT } from './sim/network';
import { Tutorial } from './Tutorial';
import { useI18n, type MsgKey, type OptMsg } from './i18n';
import { Tip } from './Tooltip';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const DT = 1 / 20;

/** Auto network CMA-ES when jam persists (sim-clock). */
const AUTO_OPT_STORAGE_KEY = 'greenwave.autoOptJam';
const AUTO_OPT_WAIT_THRESH = 90; // metrics.avgWait (seconds)
const AUTO_OPT_QUEUE_THRESH = 400; // metrics.queued (pressure)
const AUTO_OPT_HOLD_S = 10; // consecutive sim-seconds of jam
const AUTO_OPT_COOLDOWN_S = 180; // sim-seconds after start/finish

function loadAutoOptJam(): boolean {
  try {
    return localStorage.getItem(AUTO_OPT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveAutoOptJam(on: boolean) {
  try {
    localStorage.setItem(AUTO_OPT_STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

const MODE_LABEL: Record<ControlMode, MsgKey> = {
  fixed: 'mode.fixed',
  adaptive: 'mode.adaptive',
  coord: 'mode.coord',
  optimized: 'mode.optimized',
};

const MODE_HINT: Record<ControlMode, MsgKey> = {
  fixed: 'mode.fixed.hint',
  adaptive: 'mode.adaptive.hint',
  coord: 'mode.coord.hint',
  optimized: 'mode.optimized.hint',
};

const MODE_TIP: Record<ControlMode, MsgKey> = {
  fixed: 'tip.mode.fixed',
  adaptive: 'tip.mode.adaptive',
  coord: 'tip.mode.coord',
  optimized: 'tip.mode.optimized',
};

const SCEN_TIP: Record<ScenarioId, MsgKey> = {
  afternoon: 'tip.scen.afternoon',
  rush: 'tip.scen.morning',
  midday: 'tip.scen.midday',
  custom: 'tip.scen.custom',
};

const SCENARIOS: [ScenarioId, MsgKey, MsgKey][] = [
  ['afternoon', 'scen.afternoon', 'scen.afternoon.sub'],
  ['rush', 'scen.morning', 'scen.morning.sub'],
  ['midday', 'scen.midday', 'scen.midday.sub'],
  ['custom', 'scen.custom', 'scen.custom.sub'],
];

const emptyMetrics = (): Metrics => ({
  t: 0,
  vehicles: 0,
  motos: 0,
  cars: 0,
  avgWait: 0,
  p95Wait: 0,
  throughput: 0,
  stops: 0,
  queued: 0,
  completed: 0,
  avgSpeed: 0,
});

export function App() {
  const { lang, setLang, t } = useI18n();
  const simRef = useRef<TrafficSim | null>(null);
  if (!simRef.current) simRef.current = new TrafficSim(2026);
  const sim = simRef.current as TrafficSim;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer>();
  const optRef = useRef<CMAESOptimizer | null>(null);
  const optScopeRef = useRef<'network' | 'junction'>('network');

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [mode, setMode] = useState<ControlMode>('fixed');
  const [scenario, setScenario] = useState<ScenarioId>('afternoon');
  const [custom, setCustom] = useState<CustomDemand>({ volume: 1, ewBias: 0.55, motoFrac: 0.72 });
  const [selected, setSelected] = useState(-1);
  const [hover, setHover] = useState(-1);
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [baseline, setBaseline] = useState<Metrics | null>(null);
  const [congestion, setCongestion] = useState(true);
  const [optProg, setOptProg] = useState(0);
  const [optMsg, setOptMsg] = useState<OptMsg>({ key: 'opt.ready' });
  const [optRunning, setOptRunning] = useState(false);
  const [optBest, setOptBest] = useState<EvalResult | null>(null);
  const [autoOptJam, setAutoOptJam] = useState(loadAutoOptJam);
  const [autoOptReason, setAutoOptReason] = useState<string | null>(null);
  const [autoCooldownLeft, setAutoCooldownLeft] = useState(0);
  const [tick, setTick] = useState(0);
  const [seed, setSeed] = useState(2026);
  const [showTutorial, setShowTutorial] = useState(false);

  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const selectedRef = useRef(selected);
  const hoverRef = useRef(hover);
  const congestionRef = useRef(congestion);
  const optRunningRef = useRef(optRunning);
  const jamSinceRef = useRef<number | null>(null);
  const cooldownUntilRef = useRef(0);
  playingRef.current = playing;
  speedRef.current = speed;
  selectedRef.current = selected;
  hoverRef.current = hover;
  congestionRef.current = congestion;
  optRunningRef.current = optRunning;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;
    renderer.resize();
    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      renderer.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY > 0 ? 0.9 : 1.12);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    let acc = 0;
    let last = performance.now();
    let uiAcc = 0;
    let raf = 0;
    const params = new URLSearchParams(window.location.search);
    const shotMode = params.has('shot');
    const selectQ = params.get('select');
    if (selectQ !== null) {
      const want = Number(selectQ);
      const s0 = simRef.current!;
      let pick = -1;
      if (Number.isFinite(want) && want >= 0) {
        for (const n of s0.net.nodes) {
          if (n.signalized && (n.sigId === want || n.id === want)) {
            pick = n.id;
            break;
          }
        }
      }
      if (pick < 0) {
        const first = s0.net.nodes.find((n) => n.signalized);
        if (first) pick = first.id;
      }
      if (pick >= 0) {
        setSelected(pick);
        selectedRef.current = pick;
      }
    }
    if (shotMode) {
      const s = simRef.current!;
      for (let i = 0; i < 90; i++) s.step(DT);
      const stage = canvas.parentElement as HTMLElement | null;
      if (stage) {
        if (stage.clientWidth < 200) stage.style.width = '980px';
        if (stage.clientHeight < 200) stage.style.height = '780px';
      }
      renderer.resize();
      renderer.fit();
      const sel = selectedRef.current;
      renderer.render(s, sel, -1, true);
      return () => {
        window.removeEventListener('resize', onResize);
        canvas.removeEventListener('wheel', onWheel);
      };
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const real = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = simRef.current!;
      if (playingRef.current) {
        acc += real * speedRef.current;
        let steps = 0;
        while (acc >= DT && steps < 24) {
          s.step(DT);
          acc -= DT;
          steps++;
        }
        if (acc > 1) acc = 0;
      }
      renderer.render(s, selectedRef.current, hoverRef.current, congestionRef.current);

      const opt = optRef.current;
      if (opt && opt.running) {
        const t0 = performance.now();
        while (performance.now() - t0 < 28) {
          const r = opt.pump();
          setOptProg(r.progress);
          setOptMsg({ key: r.msgKey as MsgKey, params: r.msgParams });
          if (r.best) setOptBest(r.best);
          if (r.done) {
            setOptRunning(false);
            cooldownUntilRef.current = Math.max(
              cooldownUntilRef.current,
              s.t + AUTO_OPT_COOLDOWN_S,
            );
            if (r.best) {
              s.applyPlan(r.best.plan, true);
              s.setMode('optimized');
              setMode('optimized');
              setOptMsg({
                key: optScopeRef.current === 'junction' ? 'opt.junction.applied' : 'opt.applied',
                params: {
                  wait: r.best.avgWait.toFixed(1),
                  thr: Math.round(r.best.throughput),
                },
              });
            }
            break;
          }
        }
      }

      uiAcc += real;
      if (uiAcc > 0.25) {
        uiAcc = 0;
        s.updateQueues();
        setMetrics(s.metrics());
        setTick((n) => n + 1);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if (e.key === '1') setSpeed(0.25);
      if (e.key === '2') setSpeed(1);
      if (e.key === '3') setSpeed(2);
      if (e.key === '4') setSpeed(4);
      if (e.key === '5') setSpeed(8);
      if (e.key === 'r' || e.key === 'R') reset();
      if (e.key === '=' || e.key === '+') {
        const r = rendererRef.current;
        if (r) r.zoomAt(r.w / 2, r.h / 2, 1.2);
      }
      if (e.key === '-' || e.key === '_') {
        const r = rendererRef.current;
        if (r) r.zoomAt(r.w / 2, r.h / 2, 1 / 1.2);
      }
      if (e.key === '0') rendererRef.current?.fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const applyMode = (m: ControlMode) => {
    setMode(m);
    sim.setMode(m);
  };

  const applyScenario = (id: ScenarioId) => {
    setScenario(id);
    sim.setScenario(id);
    if (id === 'custom') sim.setCustom(custom);
  };

  const reset = (nextSeed?: number) => {
    const s = nextSeed ?? seed;
    setSeed(s);
    sim.reset(s);
    sim.setScenario(scenario);
    sim.setCustom(custom);
    sim.setMode(mode);
    setMetrics(emptyMetrics());
  };

  const captureBaseline = () => {
    sim.updateQueues();
    setBaseline({ ...sim.metrics() });
  };

  const startOptimize = (opts?: { auto?: boolean; reason?: string }) => {
    if (optRunningRef.current) return;
    optRunningRef.current = true;
    if (!baseline) captureBaseline();
    const opt = new CMAESOptimizer(scenario, custom, seed, sim.plan.cycle, { scope: 'network' });
    optRef.current = opt;
    optScopeRef.current = 'network';
    opt.start();
    setOptRunning(true);
    setOptProg(0);
    setOptMsg({ key: opts?.auto ? 'opt.auto.jam' : 'opt.seeding' });
    setOptBest(null);
    if (opts?.auto) {
      const tNow = sim.t;
      cooldownUntilRef.current = Math.max(cooldownUntilRef.current, tNow + AUTO_OPT_COOLDOWN_S);
      jamSinceRef.current = null;
      if (opts.reason) setAutoOptReason(opts.reason);
    }
  };

  const startOptimizeJunction = () => {
    const n = selected >= 0 ? sim.net.nodes[selected] : null;
    if (!n || !n.signalized || n.sigId < 0) return;
    if (!baseline) captureBaseline();
    const basePlan = {
      cycle: sim.plan.cycle,
      splitNS: sim.plan.splitNS.slice(),
      offset: sim.plan.offset.slice(),
      cycles:
        sim.plan.cycles && sim.plan.cycles.length === NODE_COUNT
          ? sim.plan.cycles.slice()
          : sim.ix.map((x) => x.cycle),
    };
    const opt = new CMAESOptimizer(scenario, custom, seed, sim.plan.cycle, {
      scope: 'junction',
      sigId: n.sigId,
      basePlan,
    });
    optRef.current = opt;
    optScopeRef.current = 'junction';
    opt.start();
    setOptRunning(true);
    setOptProg(0);
    setOptMsg({ key: 'opt.seeding' });
    setOptBest(null);
  };

  useEffect(() => {
    if (!autoOptJam) {
      jamSinceRef.current = null;
      setAutoCooldownLeft(0);
      return;
    }
    const tNow = metrics.t;
    const cdLeft = Math.max(0, Math.ceil(cooldownUntilRef.current - tNow));
    setAutoCooldownLeft(cdLeft);

    if (optRunningRef.current) {
      jamSinceRef.current = null;
      return;
    }
    if (tNow < cooldownUntilRef.current) {
      jamSinceRef.current = null;
      return;
    }

    const waitJam = metrics.avgWait >= AUTO_OPT_WAIT_THRESH;
    const queueJam = metrics.queued >= AUTO_OPT_QUEUE_THRESH;
    if (!waitJam && !queueJam) {
      jamSinceRef.current = null;
      return;
    }

    if (jamSinceRef.current === null) {
      jamSinceRef.current = tNow;
      return;
    }
    if (tNow - jamSinceRef.current < AUTO_OPT_HOLD_S) return;

    const reasonParts: string[] = [];
    if (waitJam) reasonParts.push(`avgWait ${metrics.avgWait.toFixed(0)}s`);
    if (queueJam) reasonParts.push(`queued ${metrics.queued.toFixed(0)}`);
    const reason = reasonParts.join(' · ');
    jamSinceRef.current = null;
    startOptimize({ auto: true, reason });
  }, [autoOptJam, metrics.t, metrics.avgWait, metrics.queued]);

  const setAutoOptJamPersist = (on: boolean) => {
    setAutoOptJam(on);
    saveAutoOptJam(on);
    if (!on) jamSinceRef.current = null;
  };

  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const zoomBy = (factor: number) => {
    const r = rendererRef.current;
    if (!r) return;
    r.zoomAt(r.w / 2, r.h / 2, factor);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag && e.buttons) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) {
        rendererRef.current?.pan(dx, dy);
        drag.x = e.clientX;
        drag.y = e.clientY;
        canvasRef.current?.style.setProperty('cursor', 'grabbing');
        return;
      }
    }
    onCanvasMove(e);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    canvasRef.current?.style.removeProperty('cursor');
    if (!drag?.moved) onCanvasClick(e);
  };

  const onPointerLeave = () => {
    if (!dragRef.current) setHover(-1);
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const w = r.worldFromScreen(e.clientX - rect.left, e.clientY - rect.top);
    let best = -1;
    let bestD = 55;
    for (const n of sim.net.nodes) {
      if (!n.signalized) continue;
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    setSelected(best);
  };

  const onCanvasMove = (e: React.MouseEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const w = r.worldFromScreen(e.clientX - rect.left, e.clientY - rect.top);
    let best = -1;
    let bestD = 48;
    for (const n of sim.net.nodes) {
      if (!n.signalized) continue;
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    setHover(best);
  };

  const node = selected >= 0 ? sim.net.nodes[selected] : null;
  const ix = node && node.signalized ? sim.ix[node.sigId] : null;
  const canOptJunction = !!(node && node.signalized && node.sigId >= 0);
  const delta = (cur: number, base: number | undefined, invert = false) => {
    if (base === undefined || !baseline) return { cls: 'flat', txt: t('ab.none') };
    const d = cur - base;
    const better = invert ? d > 0.4 : d < -0.4;
    const worse = invert ? d < -0.4 : d > 0.4;
    const cls = better ? 'down' : worse ? 'up' : 'flat';
    const sign = d > 0 ? '+' : '';
    return { cls, txt: t('ab.delta', { sign, d: d.toFixed(1) }) };
  };

  const clock = formatSimClock(metrics.t);
  const waitDelta = delta(metrics.avgWait, baseline?.avgWait);
  const thrDelta = delta(metrics.throughput, baseline?.throughput, true);

  const phaseWord = ix
    ? ix.yellow
      ? t('ix.yellow')
      : ix.allRed
        ? t('ix.allRed')
        : t('ix.green')
    : '';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="mark" />
          <div>
            <h1>
              GREEN<span>WAVE</span>
            </h1>
            <small>{t('brand.sub')}</small>
          </div>
        </div>
        <div className="chiprow">
          <span className="chip">
            t <b>{clock}</b>
          </span>
          <Tip tipKey="tip.chip.avgWait">
            <span className={`chip ${metrics.avgWait > 45 ? 'bad' : metrics.avgWait > 22 ? 'warn' : 'good'}`}>
              {t('chip.avgWait')} <b>{metrics.avgWait.toFixed(1)}s</b>
            </span>
          </Tip>
          <Tip tipKey="tip.chip.p95">
            <span className="chip">
              {t('chip.p95')} <b>{metrics.p95Wait.toFixed(1)}s</b>
            </span>
          </Tip>
          <Tip tipKey="tip.chip.throughput">
            <span className="chip good">
              {t('chip.throughput')} <b>{Math.round(metrics.throughput)}</b> {t('unit.vehH')}
            </span>
          </Tip>
          <Tip tipKey="tip.chip.live">
            <span className="chip">
              {t('chip.live')} <b>{metrics.vehicles}</b> · {metrics.motos} {t('chip.moto')} / {metrics.cars}{' '}
              {t('chip.car')}
            </span>
          </Tip>
        </div>
        <div className="top-actions">
          <Tip tipKey="tip.nav.lang">
            <div className="lang-toggle" role="group" aria-label={t('nav.lang')}>
              <button type="button" className={lang === 'vi' ? 'on' : ''} onClick={() => setLang('vi')}>
                VI
              </button>
              <span className="sep" aria-hidden="true">
                |
              </span>
              <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
                EN
              </button>
            </div>
          </Tip>
          <Tip tipKey="tip.nav.tutorial">
            <button type="button" className="btn ghost-link" onClick={() => setShowTutorial(true)}>
              {t('nav.tutorial')}
            </button>
          </Tip>
          <Tip tipKey="tip.ab.capture">
            <button className="btn secondary" onClick={captureBaseline}>
              {t('nav.baseline')}
            </button>
          </Tip>
        </div>
      </header>

      <div className="workspace">
        <aside className="rail">
          <div className="card">
            <h3>{t('mode.title')}</h3>
            <div className="seg">
              {(['fixed', 'adaptive', 'coord', 'optimized'] as ControlMode[]).map((m) => (
                <Tip key={m} tipKey={MODE_TIP[m]} params={{ n: NODE_COUNT }} fill>
                  <button className={mode === m ? 'active' : ''} onClick={() => applyMode(m)}>
                    {t(MODE_LABEL[m])}
                  </button>
                </Tip>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              {t(MODE_HINT[mode], { n: NODE_COUNT })}
            </p>
          </div>

          <div className="card">
            <h3>{t('scen.title')}</h3>
            <div className="row">
              {SCENARIOS.map(([id, label, sub]) => (
                <Tip key={id} tipKey={SCEN_TIP[id]} fill className="scen-tip">
                  <button
                    className={`scenario ${scenario === id ? 'active' : ''}`}
                    onClick={() => applyScenario(id)}
                  >
                    {t(label)}
                    <small>{t(sub)}</small>
                  </button>
                </Tip>
              ))}
            </div>
            {scenario === 'custom' && (
              <div style={{ marginTop: 8 }}>
                <Slider
                  label={t('scen.volume')}
                  value={custom.volume}
                  min={0.3}
                  max={1.8}
                  step={0.05}
                  fmt={(v) => `${v.toFixed(2)}×`}
                  onChange={(volume) => {
                    const next = { ...custom, volume };
                    setCustom(next);
                    sim.setCustom(next);
                  }}
                />
                <Slider
                  label={t('scen.ew')}
                  value={custom.ewBias}
                  min={-0.8}
                  max={0.8}
                  step={0.05}
                  fmt={(v) => (v >= 0 ? `E+${v.toFixed(2)}` : `N+${(-v).toFixed(2)}`)}
                  onChange={(ewBias) => {
                    const next = { ...custom, ewBias };
                    setCustom(next);
                    sim.setCustom(next);
                  }}
                />
                <Slider
                  label={t('scen.moto')}
                  value={custom.motoFrac}
                  min={0.4}
                  max={0.9}
                  step={0.02}
                  fmt={(v) => `${Math.round(v * 100)}%`}
                  onChange={(motoFrac) => {
                    const next = { ...custom, motoFrac };
                    setCustom(next);
                    sim.setCustom(next);
                  }}
                />
              </div>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <Tip tipKey="tip.scen.random" fill className="flex1">
                <button
                  className="btn secondary"
                  onClick={() => {
                    sim.randomizeDemand();
                  }}
                >
                  {t('scen.random')}
                </button>
              </Tip>
              <Tip tipKey="tip.scen.seed" fill className="flex1">
                <button
                  className="btn secondary"
                  onClick={() => {
                    const s = (Math.random() * 1e9) >>> 0;
                    reset(s);
                  }}
                >
                  {t('scen.seed')}
                </button>
              </Tip>
            </div>
          </div>

          <div className="card">
            <h3>{t('play.title')}</h3>
            <div className="playbar">
              <Tip tipKey="tip.play.toggle">
                <button
                  className="play"
                  aria-label={playing ? t('play.pause') : t('play.play')}
                  onClick={() => setPlaying((p) => !p)}
                >
                  {playing ? '❚❚' : '▶'}
                </button>
              </Tip>
              <Tip tipKey="tip.play.speed" fill className="speed-tip">
                <div className="speed">
                  {SPEEDS.map((sp) => (
                    <button key={sp} className={speed === sp ? 'on' : ''} onClick={() => setSpeed(sp)}>
                      {sp}×
                    </button>
                  ))}
                </div>
              </Tip>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <Tip tipKey="tip.play.reset" fill>
                <button className="btn secondary" onClick={() => reset()}>
                  {t('play.reset')}
                </button>
              </Tip>
            </div>
            <Tip tipKey="tip.play.congestion" fill>
              <div className="toggleline">
                {t('play.congestion')}
                <div className={`toggle ${congestion ? 'on' : ''}`} onClick={() => setCongestion((c) => !c)}>
                  <i />
                </div>
              </div>
            </Tip>
          </div>

          <div className="card">
            <h3>{t('opt.title')}</h3>
            <Tip tipKey="tip.opt.now" fill>
              <button
                className="btn"
                disabled={optRunning}
                onClick={() => startOptimize()}
                style={{ width: '100%' }}
              >
                {optRunning ? t('opt.searching') : t('opt.now')}
              </button>
            </Tip>
            <Tip tipKey="tip.opt.autoJam" fill>
              <div className="toggleline" style={{ marginTop: 10 }}>
                {t('opt.autoJam')}
                <div
                  className={`toggle ${autoOptJam ? 'on' : ''}`}
                  onClick={() => setAutoOptJamPersist(!autoOptJam)}
                  role="switch"
                  aria-checked={autoOptJam}
                >
                  <i />
                </div>
              </div>
            </Tip>
            <p className="hint" style={{ marginTop: 4 }}>
              {t('opt.autoJam.hint')}
            </p>
            {autoOptJam && (
              <p className="hint mono" style={{ marginTop: 4 }}>
                {autoCooldownLeft > 0
                  ? t('opt.auto.cooldown', { s: autoCooldownLeft })
                  : t('opt.auto.idle')}
                {autoOptReason ? ` · ${t('opt.auto.last', { reason: autoOptReason })}` : ''}
              </p>
            )}
            <Tip tipKey="tip.opt.junction" fill>
              <button
                className="btn secondary"
                disabled={optRunning || !canOptJunction}
                onClick={startOptimizeJunction}
                style={{ width: '100%', marginTop: 8 }}
              >
                {optRunning && optScopeRef.current === 'junction' ? t('opt.searching') : t('opt.junction')}
              </button>
            </Tip>
            <p className="hint" style={{ marginTop: 6 }}>
              {canOptJunction ? t('opt.junction.hint') : t('opt.junction.needSelect')}
            </p>
            <div className="progress">
              <i style={{ width: `${Math.round(optProg * 100)}%` }} />
            </div>
            <Tip tipKey="tip.opt.status" fill preferBelow>
              <div className="hint mono">{t(optMsg.key, optMsg.params)}</div>
            </Tip>
            {optBest && (
              <div className="hint" style={{ marginTop: 6 }}>
                {t('opt.best', {
                  wait: optBest.avgWait.toFixed(1),
                  thr: Math.round(optBest.throughput),
                  cycle:
                    optBest.plan.cycles && node && node.signalized
                      ? optBest.plan.cycles[node.sigId]
                      : optBest.plan.cycle,
                })}
              </div>
            )}
          </div>

          <div className="card">
            <Tip tipKey="tip.ab.section" preferBelow>
              <h3>{t('ab.title')}</h3>
            </Tip>
            <div className="ab">
              <div className="stat">
                <div className="k">{t('ab.wait')}</div>
                <div className="v">{metrics.avgWait.toFixed(1)}s</div>
                <div className={`d ${waitDelta.cls}`}>{waitDelta.txt}</div>
              </div>
              <div className="stat">
                <div className="k">{t('ab.throughput')}</div>
                <div className="v">{Math.round(metrics.throughput)}</div>
                <div className={`d ${thrDelta.cls}`}>{thrDelta.txt}</div>
              </div>
              <div className="stat">
                <div className="k">{t('ab.stops')}</div>
                <div className="v">{metrics.stops.toFixed(2)}</div>
                <div className={`d ${delta(metrics.stops, baseline?.stops).cls}`}>
                  {delta(metrics.stops, baseline?.stops).txt}
                </div>
              </div>
              <div className="stat">
                <div className="k">{t('ab.p95')}</div>
                <div className="v">{metrics.p95Wait.toFixed(1)}s</div>
                <div className={`d ${delta(metrics.p95Wait, baseline?.p95Wait).cls}`}>
                  {delta(metrics.p95Wait, baseline?.p95Wait).txt}
                </div>
              </div>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              {t('ab.hint')}
            </p>
          </div>
        </aside>

        <div className="stage">
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
            onDoubleClick={() => rendererRef.current?.fit()}
          />
          <div className="watermark">LÊ DUẨN × LÊ LỢI  ·  CẦU SÔNG HÀN  ·  {NODE_COUNT} ĐÈN</div>
          <div className="zoombar">
            <Tip tipKey="tip.zoom.in">
              <button type="button" aria-label={t('zoom.in')} onClick={() => zoomBy(1.2)}>
                +
              </button>
            </Tip>
            <Tip tipKey="tip.zoom.fit">
              <button type="button" aria-label={t('zoom.fit')} onClick={() => rendererRef.current?.fit()}>
                {t('zoom.fitLabel')}
              </button>
            </Tip>
            <Tip tipKey="tip.zoom.out">
              <button type="button" aria-label={t('zoom.out')} onClick={() => zoomBy(1 / 1.2)}>
                −
              </button>
            </Tip>
          </div>
        </div>

        <aside className="rail right">
          <div className="card">
            <h3>{t('hud.title')}</h3>
            <div className="metrics-grid">
              <Hud tipKey="tip.hud.avgWait" k={t('hud.avgWait')} v={`${metrics.avgWait.toFixed(1)} s`} s={t('hud.avgWait.sub')} />
              <Hud tipKey="tip.hud.p95" k={t('hud.p95')} v={`${metrics.p95Wait.toFixed(1)} s`} s={t('hud.p95.sub')} />
              <Hud tipKey="tip.hud.throughput" k={t('hud.throughput')} v={`${Math.round(metrics.throughput)}`} s={t('hud.throughput.sub')} />
              <Hud tipKey="tip.hud.queue" k={t('hud.queue')} v={metrics.queued.toFixed(0)} s={t('hud.queue.sub')} />
              <Hud tipKey="tip.hud.speed" k={t('hud.speed')} v={`${metrics.avgSpeed.toFixed(0)} km/h`} s={t('hud.speed.sub')} />
              <Hud tipKey="tip.hud.done" k={t('hud.done')} v={`${metrics.completed}`} s={t('hud.done.sub')} />
            </div>
          </div>

          <div className="card">
            <h3>{t('chart.title')}</h3>
            <Chart history={sim.history} />
          </div>

          <div className="card inspector">
            <h3>{t('ix.title')}</h3>
            {node && ix ? (
              <>
                <div className="name">{node.name}</div>
                <div className="sub">
                  {node.district} · {node.arterial ? t('ix.arterial') : t('ix.local')} ·{' '}
                  {ix.phase === 0 ? 'N–S' : 'E–W'} {phaseWord} · {sim.phaseRemaining(selected).toFixed(1)}s
                </div>
                <div className="phases">
                  {(['N', 'E', 'S', 'W'] as const).map((dir, i) => {
                    const lit = sim.approachLit(selected, i as 0 | 1 | 2 | 3);
                    const q = [ix.qN, ix.qE, ix.qS, ix.qW][i];
                    const pr = [ix.pN, ix.pE, ix.pS, ix.pW][i];
                    return (
                      <div className="qbox" key={dir}>
                        <div className="dir">
                          <span className={`lamp ${lit}`} />
                          {dir}
                        </div>
                        <div className="n">{q.toFixed(0)}</div>
                        {(mode === 'adaptive' || mode === 'coord') && (
                          <div className="s">p {pr.toFixed(1)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {(mode === 'adaptive' || mode === 'coord') && (
                  <p className="hint" style={{ marginTop: -2, marginBottom: 8 }}>
                    {t('ix.pressure', {
                      ns: sim.pressureNS(selected).toFixed(1),
                      ew: sim.pressureEW(selected).toFixed(1),
                    })}
                    {mode === 'adaptive' ? t('ix.mpAdapt') : t('ix.mpCoord')}
                  </p>
                )}
                {(() => {
                  const durs = sim.phaseDurations(selected);
                  if (!durs) return null;
                  const live = mode === 'adaptive' || mode === 'coord';
                  return (
                    <Tip tipKey="tip.ix.durations" preferBelow>
                      <div className="phase-durs">
                        <div className="phase-durs-hd">{t('ix.durations')}</div>
                        <div className="phase-durs-grid">
                          <div className="pd g">
                            <span className="pd-l">{t('ix.gNS')}</span>
                            <b>{Math.round(durs.gNS)}s</b>
                          </div>
                          <div className="pd y">
                            <span className="pd-l">{t('ix.yellowSec')}</span>
                            <b>{Math.round(durs.yellow)}s</b>
                          </div>
                          <div className="pd ar">
                            <span className="pd-l">{t('ix.allRedSec')}</span>
                            <b>{Math.round(durs.allRed)}s</b>
                          </div>
                          <div className="pd g">
                            <span className="pd-l">{t('ix.gEW')}</span>
                            <b>{Math.round(durs.gEW)}s</b>
                          </div>
                          <div className="pd y">
                            <span className="pd-l">{t('ix.yellowSec')}</span>
                            <b>{Math.round(durs.yellow)}s</b>
                          </div>
                          <div className="pd ar">
                            <span className="pd-l">{t('ix.allRedSec')}</span>
                            <b>{Math.round(durs.allRed)}s</b>
                          </div>
                        </div>
                        <p className="hint phase-durs-hint">
                          {live ? t('ix.durations.hintLive') : t('ix.durations.hintFixed')}
                        </p>
                      </div>
                    </Tip>
                  );
                })()}
                <Slider
                  tipKey="tip.ix.cycle"
                  label={t('ix.cycle')}
                  value={ix.cycle}
                  min={48}
                  max={140}
                  step={1}
                  fmt={(v) => `${v.toFixed(0)}s`}
                  onChange={(cycle) => {
                    sim.setIntersectionTiming(selected, { cycle });
                    setTick((n) => n + 1);
                  }}
                />
                <Slider
                  tipKey="tip.ix.split"
                  label={t('ix.split')}
                  value={ix.splitNS}
                  min={0.22}
                  max={0.78}
                  step={0.01}
                  fmt={(v) => `${Math.round(v * 100)} / ${Math.round((1 - v) * 100)}`}
                  onChange={(splitNS) => {
                    sim.setIntersectionTiming(selected, { splitNS });
                    setTick((n) => n + 1);
                  }}
                />
                <Slider
                  tipKey="tip.ix.offset"
                  label={t('ix.offset')}
                  value={ix.offset}
                  min={0}
                  max={ix.cycle}
                  step={1}
                  fmt={(v) => `${v.toFixed(0)}s`}
                  onChange={(offset) => {
                    sim.setIntersectionTiming(selected, { offset });
                    setTick((n) => n + 1);
                  }}
                />
                <p className="hint">{t('ix.hint')}</p>
                <Tip tipKey="tip.opt.junction" fill>
                  <button
                    className="btn secondary"
                    disabled={optRunning || !canOptJunction}
                    onClick={startOptimizeJunction}
                    style={{ width: '100%', marginTop: 8 }}
                  >
                    {optRunning && optScopeRef.current === 'junction' ? t('opt.searching') : t('opt.junction')}
                  </button>
                </Tip>
                <p className="hint" style={{ marginTop: 6 }}>
                  {t('opt.junction.hint')}
                </p>
              </>
            ) : (
              <p className="empty-ix">{t('ix.empty')}</p>
            )}
          </div>

          <div className="card">
            <h3>{t('net.title')}</h3>
            <Tip tipKey="tip.net.blurb" params={{ n: NODE_COUNT }} preferBelow>
              <div className="hint">
                {t('net.blurb', { n: NODE_COUNT, links: sim.net.links.length, seed })}
              </div>
            </Tip>
            <PhaseStrip sim={sim} selected={selected} tick={tick} />
          </div>
        </aside>
      </div>

      <footer className="foot">
        <Tip tipKey="tip.foot.tag" params={{ n: NODE_COUNT }} preferBelow>
          <span>{t('foot.tag', { n: NODE_COUNT })}</span>
        </Tip>
        <span>
          <button type="button" className="foot-link" onClick={() => setShowTutorial(true)}>
            {t('foot.tutorial')}
          </button>
          &nbsp;·&nbsp;
          <kbd>space</kbd> {t('hotkey.play')} &nbsp; <kbd>1–5</kbd> {t('hotkey.speed')} &nbsp;{' '}
          <kbd>+</kbd>/<kbd>-</kbd> {t('hotkey.zoom')} &nbsp; <kbd>0</kbd> {t('hotkey.fit')} &nbsp;{' '}
          <kbd>R</kbd> {t('hotkey.reset')}
        </span>
      </footer>
      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}
    </div>
  );
}

function Hud({ k, v, s, tipKey }: { k: string; v: string; s: string; tipKey: MsgKey }) {
  return (
    <Tip tipKey={tipKey} fill>
      <div className="metric">
        <div className="k">{k}</div>
        <div className="v">{v}</div>
        <div className="s">{s}</div>
      </div>
    </Tip>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
  tipKey,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
  tipKey?: MsgKey;
}) {
  const body = (
    <label className="slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <b>{fmt(value)}</b>
    </label>
  );
  if (!tipKey) return body;
  return (
    <Tip tipKey={tipKey} fill preferBelow>
      {body}
    </Tip>
  );
}

function Chart({
  history,
}: {
  history: { t: number; avgWait: number; throughput: number; queued: number }[];
}) {
  const { t } = useI18n();
  const w = 280;
  const h = 84;
  const path = useMemo(() => {
    if (history.length < 2) return { wait: '', flow: '' };
    const maxW = Math.max(8, ...history.map((s) => s.avgWait));
    const maxF = Math.max(80, ...history.map((s) => s.throughput));
    const n = history.length;
    const toWait = history
      .map((s, i) => {
        const x = (i / (n - 1)) * (w - 8) + 4;
        const y = h - 8 - (s.avgWait / maxW) * (h - 16);
        return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const toFlow = history
      .map((s, i) => {
        const x = (i / (n - 1)) * (w - 8) + 4;
        const y = h - 8 - (s.throughput / maxF) * (h - 16);
        return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return { wait: toWait, flow: toFlow };
  }, [history.length, history.length ? history[history.length - 1].t : 0]);

  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={path.flow} fill="none" stroke="rgba(108,224,255,0.7)" strokeWidth="1.6" />
      <path d={path.wait} fill="none" stroke="rgba(62,224,176,0.95)" strokeWidth="1.8" />
      <text x="8" y="12" fill="#7d90a0" fontSize="9" fontFamily="IBM Plex Mono, monospace">
        {t('chart.wait')}
      </text>
      <text x="40" y="12" fill="#5aa" fontSize="9" fontFamily="IBM Plex Mono, monospace">
        {t('chart.flow')}
      </text>
    </svg>
  );
}

function PhaseStrip({ sim, selected, tick }: { sim: TrafficSim; selected: number; tick: number }) {
  const { t } = useI18n();
  void tick;
  return (
    <div className="bars" title={t('net.splitTitle')}>
      {sim.ix.map((x, i) => (
        <span
          key={i}
          className={i === selected ? 'fill' : ''}
          style={{
            height: `${18 + x.splitNS * 18}px`,
            background:
              i === selected
                ? undefined
                : `linear-gradient(180deg, rgba(62,224,176,${0.2 + x.splitNS * 0.5}), rgba(20,40,50,0.4))`,
          }}
        />
      ))}
    </div>
  );
}

function formatSimClock(t: number) {
  const s = Math.floor(t);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
