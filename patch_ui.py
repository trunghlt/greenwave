from pathlib import Path

root = Path('/workspace/greenwave')

# --- renderer.ts ---
rpath = root / 'src' / 'render' / 'renderer.ts'
r = rpath.read_text()

old = """  cam: Camera = { x: 0, y: 0, scale: 1 };
  w = 0;
  h = 0;
  dpr = 1;
"""
new = """  cam: Camera = { x: 0, y: 0, scale: 1 };
  fitScale = 1;
  userCam = false;
  w = 0;
  h = 0;
  dpr = 1;
"""
if old not in r:
    raise SystemExit('renderer cam fields not found')
r = r.replace(old, new, 1)

old = """  resize() {
    const parent = this.canvas.parentElement;
    const w = parent ? parent.clientWidth : 800;
    const h = parent ? parent.clientHeight : 600;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cam = fitCamera(w, h);
  }
"""
new = """  resize() {
    const parent = this.canvas.parentElement;
    const w = parent ? parent.clientWidth : 800;
    const h = parent ? parent.clientHeight : 600;
    const oldW = this.w;
    const oldH = this.h;
    const oldCam = { ...this.cam };
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const fitted = fitCamera(w, h);
    this.fitScale = fitted.scale;
    if (!this.userCam || oldW === 0) {
      this.cam = fitted;
    } else {
      const worldX = (oldW / 2 - oldCam.x) / oldCam.scale;
      const worldY = (oldH / 2 - oldCam.y) / oldCam.scale;
      this.cam.scale = oldCam.scale;
      this.cam.x = w / 2 - worldX * this.cam.scale;
      this.cam.y = h / 2 - worldY * this.cam.scale;
    }
  }
"""
if old not in r:
    raise SystemExit('renderer resize not found')
r = r.replace(old, new, 1)

old = """  worldFromScreen(sx: number, sy: number) {
    return {
      x: (sx - this.cam.x) / this.cam.scale,
      y: (sy - this.cam.y) / this.cam.scale,
    };
  }
"""
new = """  worldFromScreen(sx: number, sy: number) {
    return {
      x: (sx - this.cam.x) / this.cam.scale,
      y: (sy - this.cam.y) / this.cam.scale,
    };
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const world = this.worldFromScreen(sx, sy);
    const min = this.fitScale * 0.55;
    const max = this.fitScale * 8;
    const next = Math.min(max, Math.max(min, this.cam.scale * factor));
    this.cam.scale = next;
    this.cam.x = sx - world.x * next;
    this.cam.y = sy - world.y * next;
    this.userCam = true;
  }

  pan(dx: number, dy: number) {
    this.cam.x += dx;
    this.cam.y += dy;
    this.userCam = true;
  }

  fit() {
    this.cam = fitCamera(this.w, this.h);
    this.fitScale = this.cam.scale;
    this.userCam = false;
  }
"""
if old not in r:
    raise SystemExit('worldFromScreen not found')
r = r.replace(old, new, 1)
rpath.write_text(r)
print('renderer.ts ok')

# --- App.tsx ---
apath = root / 'src' / 'App.tsx'
a = apath.read_text()

old = "import {\n  NODE_COUNT,\n  type ControlMode,\n  type CustomDemand,\n  type Metrics,\n  type ScenarioId,\n} from './sim/types';\n"
new = old + "import { Tutorial } from './Tutorial';\n"
if old not in a:
    raise SystemExit('App import not found')
a = a.replace(old, new, 1)

old = "  const [seed, setSeed] = useState(2026);\n"
new = "  const [seed, setSeed] = useState(2026);\n  const [showTutorial, setShowTutorial] = useState(false);\n"
if old not in a:
    raise SystemExit('seed state not found')
a = a.replace(old, new, 1)

old = """    renderer.resize();
    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);
"""
new = """    renderer.resize();
    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      renderer.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY > 0 ? 0.9 : 1.12);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
"""
if old not in a:
    raise SystemExit('resize hook not found')
a = a.replace(old, new, 1)

old = """      window.removeEventListener('resize', onResize);
    };
  }, []);
"""
new = """      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);
"""
if old not in a:
    raise SystemExit('effect cleanup not found')
a = a.replace(old, new, 1)

old = """      if (e.key === 'r' || e.key === 'R') reset();
    };
"""
new = """      if (e.key === 'r' || e.key === 'R') reset();
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
"""
if old not in a:
    raise SystemExit('key handler not found')
a = a.replace(old, new, 1)

old = """        <div className="top-actions">
          <button className="btn secondary" onClick={captureBaseline}>
            Capture baseline
          </button>
        </div>
"""
new = """        <div className="top-actions">
          <button type="button" className="btn ghost-link" onClick={() => setShowTutorial(true)}>
            Tutorial
          </button>
          <button className="btn secondary" onClick={captureBaseline}>
            Capture baseline
          </button>
        </div>
"""
if old not in a:
    raise SystemExit('top-actions not found')
a = a.replace(old, new, 1)

old = """          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            onMouseMove={onCanvasMove}
            onMouseLeave={() => setHover(-1)}
          />
          <div className="watermark">HẢI CHÂU  ·  SƠN TRÀ  ·  20 JUNCTIONS</div>
"""
new = """          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
            onDoubleClick={() => rendererRef.current?.fit()}
          />
          <div className="watermark">HẢI CHÂU  ·  SƠN TRÀ  ·  20 JUNCTIONS</div>
          <div className="zoombar">
            <button type="button" title="Zoom in (+)" onClick={() => zoomBy(1.2)}>
              +
            </button>
            <button type="button" title="Fit network (0)" onClick={() => rendererRef.current?.fit()}>
              Fit
            </button>
            <button type="button" title="Zoom out (-)" onClick={() => zoomBy(1 / 1.2)}>
              −
            </button>
          </div>
"""
if old not in a:
    raise SystemExit('canvas block not found')
a = a.replace(old, new, 1)

old = """      <footer className="foot">
        <span>GREENWAVE  ·  microscopic timing lab  ·  client-side only</span>
        <span>
          <kbd>space</kbd> play/pause &nbsp; <kbd>1–5</kbd> speed &nbsp; <kbd>R</kbd> reset
        </span>
      </footer>
    </div>
  );
}
"""
new = """      <footer className="foot">
        <span>GREENWAVE  ·  microscopic timing lab  ·  client-side only</span>
        <span>
          <button type="button" className="foot-link" onClick={() => setShowTutorial(true)}>
            How to use
          </button>
          &nbsp;·&nbsp;
          <kbd>space</kbd> play/pause &nbsp; <kbd>1–5</kbd> speed &nbsp; <kbd>+</kbd>/<kbd>-</kbd> zoom &nbsp;{' '}
          <kbd>0</kbd> fit &nbsp; <kbd>R</kbd> reset
        </span>
      </footer>
      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}
    </div>
  );
}
"""
if old not in a:
    raise SystemExit('footer not found')
a = a.replace(old, new, 1)

old = """  const onCanvasClick = (e: React.MouseEvent) => {
"""
new = """  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

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
"""
if old not in a:
    raise SystemExit('onCanvasClick not found')
a = a.replace(old, new, 1)

apath.write_text(a)
print('App.tsx ok')

# --- Tutorial zoom section ---
tpath = root / 'src' / 'Tutorial.tsx'
t = tpath.read_text()
old = """          <section>
            <h3>Demand and keys</h3>
"""
new = """          <section>
            <h3>Zoom the map</h3>
            <p>
              Scroll to zoom toward the cursor. Drag to pan. Buttons at the bottom-right of the map are{' '}
              <b>+</b> / <b>Fit</b> / <b>−</b>. Double-click the canvas or press <kbd>0</kbd> to fit the
              whole network. <kbd>+</kbd> and <kbd>-</kbd> zoom from the center.
            </p>
          </section>

          <section>
            <h3>Demand and keys</h3>
"""
if old not in t:
    raise SystemExit('tutorial section not found')
t = t.replace(old, new, 1)
tpath.write_text(t)
print('Tutorial.tsx ok')

# --- CSS ---
cpath = root / 'src' / 'index.css'
c = cpath.read_text()
if '.tutorial-backdrop' not in c:
    c += """
.btn.ghost-link {
  background: transparent;
  color: var(--teal);
  box-shadow: none;
  border: 1px solid rgba(62, 224, 176, 0.28);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 10.5px;
}
.btn.ghost-link:hover { background: var(--teal-dim); }

.foot-link {
  background: none;
  border: 0;
  color: var(--teal);
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.06em;
  padding: 0;
}
.foot-link:hover { text-decoration: underline; }

.zoombar {
  position: absolute;
  right: 14px;
  bottom: 14px;
  display: flex;
  gap: 4px;
  z-index: 2;
}
.zoombar button {
  min-width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: rgba(12, 16, 22, 0.88);
  color: var(--text);
  cursor: pointer;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 14px;
  backdrop-filter: blur(10px);
}
.zoombar button:hover { border-color: var(--teal); color: var(--teal); }
.stage canvas:active { cursor: grabbing; }

.tutorial-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(4, 7, 10, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 18px;
  backdrop-filter: blur(8px);
}
.tutorial {
  width: min(720px, 100%);
  max-height: min(86vh, 820px);
  overflow: auto;
  background: var(--panel-solid);
  border: 1px solid var(--line-strong);
  border-radius: 16px;
  box-shadow: var(--shadow);
}
.tutorial-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  background: var(--panel-solid);
}
.tutorial-head h2 {
  font-family: Syne, sans-serif;
  font-size: 20px;
  letter-spacing: 0.04em;
}
.tutorial-head p { color: var(--muted); font-size: 12px; margin-top: 4px; }
.tutorial-body { padding: 8px 20px 22px; }
.tutorial-body section { margin-top: 16px; }
.tutorial-body h3 {
  font-family: Syne, sans-serif;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--teal);
  margin-bottom: 8px;
}
.tutorial-body p, .tutorial-body li {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text);
}
.tutorial-body ol, .tutorial-body ul {
  margin: 8px 0 0 18px;
  color: var(--text);
}
.tutorial-body li { margin: 6px 0; }
.tutorial-body kbd {
  font-family: 'IBM Plex Mono', monospace;
  border: 1px solid var(--line);
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--muted);
  font-size: 11px;
}
"""
    cpath.write_text(c)
    print('index.css ok')
else:
    print('index.css already had tutorial styles')
