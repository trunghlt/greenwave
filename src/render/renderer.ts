import { TrafficSim, vehiclePos, type Vehicle } from '../sim/engine';
import { N, E, S, W, STOP_PAD, type Approach } from '../sim/types';
import { WORLD_H, WORLD_W, type Node } from '../sim/network';

const MOTO_PAL = ['#d7e6f5', '#9fd7c8', '#f0d39a', '#e8a0b0', '#b7c4ff', '#f4c7a1'];
const CAR_PAL = ['#8aa0b8', '#6d8ea8', '#c9b08a', '#7a9088', '#9aa4be'];

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export function fitCamera(w: number, h: number): Camera {
  const pad = 16;
  const sx = (w - pad * 2) / WORLD_W;
  const sy = (h - pad * 2) / WORLD_H;
  const scale = Math.min(sx, sy);
  return {
    scale,
    x: (w - WORLD_W * scale) / 2,
    y: (h - WORLD_H * scale) / 2 + 4,
  };
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cam: Camera = { x: 0, y: 0, scale: 1 };
  fitScale = 1;
  userCam = false;
  w = 0;
  h = 0;
  dpr = 1;
  time = 0;
  congestion = true;
  asphalt?: CanvasPattern | null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('canvas');
    this.ctx = ctx;
    this.asphalt = this.makeAsphalt();
  }

  private makeAsphalt() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#12171e';
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 180; i++) {
      const x = Math.random() * 64;
      const y = Math.random() * 64;
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
      g.fillRect(x, y, 1, 1);
    }
    return this.ctx.createPattern(c, 'repeat');
  }

  resize() {
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

  worldFromScreen(sx: number, sy: number) {
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

  private applyCam() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.translate(this.cam.x, this.cam.y);
    this.ctx.scale(this.cam.scale, this.cam.scale);
  }

  render(sim: TrafficSim, selected: number, hover: number, showCongestion: boolean) {
    this.time = sim.t;
    this.congestion = showCongestion;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#07090d';
    ctx.fillRect(0, 0, this.w, this.h);

    this.drawBackdrop();
    this.applyCam();
    this.drawCoast();
    this.drawRiver(sim);
    this.drawContext(sim);
    this.drawRoads(sim);
    this.drawJunctions(sim, selected, hover);
    this.drawVehicles(sim);
    this.drawSignals(sim, selected);
    this.drawLabels(sim, selected);
  }

  private drawBackdrop() {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(this.w * 0.72, this.h * 0.2, 20, this.w * 0.55, this.h * 0.4, this.w * 0.8);
    g.addColorStop(0, 'rgba(18, 70, 92, 0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    const g2 = ctx.createRadialGradient(this.w * 0.15, this.h * 0.85, 10, this.w * 0.2, this.h * 0.8, this.w * 0.5);
    g2.addColorStop(0, 'rgba(20, 90, 70, 0.08)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, this.w, this.h);
  }


  private strokePoly(pts: { x: number; y: number }[]) {
    if (pts.length < 2) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  private drawCoast() {
    // Beach/east-sea wash is for the full Hải Châu–Sơn Trà map only.
    if (WORLD_W < 4000) return;
    const ctx = this.ctx;
    const x = WORLD_W - 160;
    const g = ctx.createLinearGradient(x - 80, 0, WORLD_W + 40, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.35, 'rgba(40, 120, 140, 0.07)');
    g.addColorStop(0.7, 'rgba(70, 180, 190, 0.18)');
    g.addColorStop(1, 'rgba(160, 220, 210, 0.14)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 90, -40, 320, WORLD_H + 80);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = 'rgba(120, 230, 220, 0.35)';
    ctx.lineWidth = Math.max(2, 1.4 / this.cam.scale);
    ctx.beginPath();
    for (let y = 0; y < WORLD_H; y += 8) {
      const ox = Math.sin(y * 0.008 + this.time * 0.8) * 10 + Math.sin(y * 0.002) * 18;
      if (y === 0) ctx.moveTo(x + 40 + ox, y);
      else ctx.lineTo(x + 40 + ox, y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(186, 230, 220, 0.32)';
    const fs = Math.max(11, 9 / this.cam.scale);
    ctx.font = `600 ${fs}px Syne, sans-serif`;
    ctx.save();
    ctx.translate(WORLD_W - 36, WORLD_H * 0.42);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('EAST SEA  ·  BIỂN ĐÔNG', 0, 0);
    ctx.restore();
  }

  private drawRiver(sim: TrafficSim) {
    const ctx = this.ctx;
    const river = sim.net.river;
    if (!river || river.length < 2) return;
    const w = Math.max(70, 14 / this.cam.scale);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(20, 70, 90, 0.55)';
    ctx.lineWidth = w + 18;
    this.strokePoly(river);
    const g = ctx.createLinearGradient(sim.net.riverX - 80, 0, sim.net.riverX + 80, 0);
    g.addColorStop(0, 'rgba(20, 70, 90, 0.5)');
    g.addColorStop(0.5, 'rgba(40, 160, 170, 0.42)');
    g.addColorStop(1, 'rgba(20, 70, 90, 0.5)');
    ctx.strokeStyle = g;
    ctx.lineWidth = w;
    this.strokePoly(river);
    ctx.strokeStyle = 'rgba(80, 220, 210, 0.16)';
    ctx.lineWidth = 2.2;
    this.strokePoly(river);
    ctx.restore();

    const mid = river[Math.floor(river.length * 0.45)];
    ctx.fillStyle = 'rgba(130, 220, 210, 0.4)';
    const fs = Math.max(10, 8 / this.cam.scale);
    ctx.font = `600 ${fs}px Syne, sans-serif`;
    ctx.save();
    ctx.translate(mid.x - w * 0.7, mid.y);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('SÔNG HÀN', 0, 0);
    ctx.restore();
  }

  private drawContext(sim: TrafficSim) {
    const ways = sim.net.context;
    if (!ways || !ways.length) return;
    const ctx = this.ctx;
    const px = 1 / Math.max(1e-6, this.cam.scale);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const ordered = ways.slice().sort((a, b) => a.rank - b.rank);
    for (const w of ordered) {
      const pts = w.poly;
      if (!pts || pts.length < 2) continue;
      const rank = w.rank || 0;
      // Widths are in screen pixels (× px) so the fabric stays readable at fit-zoom.
      let screen: number;
      let stroke: string;
      if (rank >= 4 || w.bridge) {
        screen = 5.4;
        stroke = 'rgba(92, 122, 150, 0.72)';
      } else if (rank >= 3) {
        screen = 4.4;
        stroke = 'rgba(78, 106, 132, 0.62)';
      } else if (rank >= 2) {
        screen = 2.9;
        stroke = 'rgba(62, 86, 108, 0.48)';
      } else {
        screen = 1.8;
        stroke = 'rgba(48, 68, 86, 0.36)';
      }
      ctx.strokeStyle = 'rgba(8, 12, 16, 0.55)';
      ctx.lineWidth = (screen + 1.6) * px;
      this.strokePoly(pts);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = screen * px;
      this.strokePoly(pts);
    }
    ctx.restore();
  }

  private drawRoads(sim: TrafficSim) {
    const ctx = this.ctx;
    const drawn = new Set<string>();
    const minPx = 3.2 / this.cam.scale;
    for (const l of sim.net.links) {
      const key = l.from < l.to ? `${l.from}-${l.to}` : `${l.to}-${l.from}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const pts = l.polyline && l.polyline.length >= 2 ? l.polyline : [
        { x: l.x1, y: l.y1 },
        { x: l.x2, y: l.y2 },
      ];
      let lanesHere = Math.max(1, l.lanes || 1);
      for (const o of sim.net.links) {
        if (o.from === l.to && o.to === l.from) {
          lanesHere += Math.max(1, o.lanes || 1);
          break;
        }
      }
      const width = Math.max(minPx * 1.15, lanesHere * 4.15 + 5);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0b0e12';
      ctx.lineWidth = width + 5;
      this.strokePoly(pts);

      if (this.congestion) {
        const dens = occupancy(sim, l.id, l.length);
        const heat = Math.min(1, dens * 1.6);
        ctx.strokeStyle = lerpColor('#1a222c', '#c45a2a', heat);
        if (heat > 0.08) ctx.globalAlpha = 0.35 + heat * 0.45;
      } else {
        ctx.strokeStyle = l.arterial ? '#1c2430' : '#181f28';
      }
      ctx.lineWidth = width;
      this.strokePoly(pts);
      ctx.globalAlpha = 1;

      ctx.save();
      ctx.strokeStyle = l.bridge ? 'rgba(210, 190, 140, 0.28)' : 'rgba(210, 230, 240, 0.12)';
      ctx.lineWidth = Math.max(0.7, 0.6 / this.cam.scale);
      ctx.setLineDash([5.5, 6.5]);
      this.strokePoly(pts);
      ctx.setLineDash([]);
      ctx.restore();
      if (l.oneway) this.drawChevrons(pts, width);
    }
  }

  private drawChevrons(pts: { x: number; y: number }[], width: number) {
    if (pts.length < 2) return;
    const ctx = this.ctx;
    const spacing = Math.max(26, 16 / this.cam.scale);
    const arm = Math.max(3.4, Math.min(8, width * 0.32));
    let acc = 0;
    let next = spacing * 0.45;
    ctx.save();
    ctx.strokeStyle = 'rgba(220, 236, 244, 0.62)';
    ctx.lineWidth = Math.max(1.15, 0.95 / this.cam.scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      const x0 = pts[i - 1].x;
      const y0 = pts[i - 1].y;
      const x1 = pts[i].x;
      const y1 = pts[i].y;
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (seg < 1e-6) continue;
      const ux = (x1 - x0) / seg;
      const uy = (y1 - y0) / seg;
      const px = -uy;
      const py = ux;
      while (next <= acc + seg) {
        const t = (next - acc) / seg;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        const bx = x - ux * arm * 0.15;
        const by = y - uy * arm * 0.15;
        ctx.beginPath();
        ctx.moveTo(bx + px * arm * 0.72, by + py * arm * 0.72);
        ctx.lineTo(x + ux * arm * 0.62, y + uy * arm * 0.62);
        ctx.lineTo(bx - px * arm * 0.72, by - py * arm * 0.72);
        ctx.stroke();
        next += spacing;
      }
      acc += seg;
    }
    ctx.restore();
  }

  private drawJunctions(sim: TrafficSim, selected: number, hover: number) {
    const ctx = this.ctx;
    const r0 = Math.max(12, 5.5 / this.cam.scale);
    const px = 1 / Math.max(1e-6, this.cam.scale);
    const tick = 3.6 * px;
    for (const n of sim.net.nodes) {
      if (n.signalized) continue;
      ctx.fillStyle = '#3d5364';
      ctx.strokeStyle = 'rgba(186, 214, 226, 0.7)';
      ctx.lineWidth = 1.15 * px;
      ctx.beginPath();
      ctx.arc(n.x, n.y, tick, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(200, 224, 232, 0.45)';
      ctx.lineWidth = 1.35 * px;
      ctx.beginPath();
      ctx.moveTo(n.x - tick * 1.85, n.y);
      ctx.lineTo(n.x + tick * 1.85, n.y);
      ctx.moveTo(n.x, n.y - tick * 1.85);
      ctx.lineTo(n.x, n.y + tick * 1.85);
      ctx.stroke();
    }
    for (const n of sim.net.nodes) {
      if (!n.signalized) continue;
      const r = n.arterial ? r0 * 1.12 : r0;
      const active = n.id === selected || n.id === hover;
      ctx.fillStyle = active ? '#1a2834' : '#141b24';
      ctx.strokeStyle = n.id === selected ? '#3ee0b0' : n.id === hover ? '#7aa0c0' : '#243140';
      ctx.lineWidth = n.id === selected ? 2.2 : 1.1;
      roundRect(ctx, n.x - r, n.y - r, r * 2, r * 2, 4);
      ctx.fill();
      ctx.stroke();
      if (n.id === selected) {
        ctx.strokeStyle = 'rgba(62, 224, 176, 0.28)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawVehicles(sim: TrafficSim) {
    const ctx = this.ctx;
    const vis = Math.max(1, 3.2 / this.cam.scale);
    for (const v of sim.vehicles) {
      if (!v.alive) continue;
      const p = vehiclePos(sim, v);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.h);
      const specL = (v.kind === 'moto' ? 1.85 : 4.5) * vis;
      const specW = (v.kind === 'moto' ? 0.72 : 1.85) * vis;
      const col = v.kind === 'moto' ? MOTO_PAL[v.color % MOTO_PAL.length] : CAR_PAL[v.color % CAR_PAL.length];
      ctx.fillStyle = col;
      ctx.shadowColor = v.v < 0.8 ? 'rgba(255, 140, 70, 0.35)' : 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = v.v < 0.8 ? 6 : 2;
      roundRect(ctx, -specL * 0.5, -specW * 0.5, specL, specW, v.kind === 'moto' ? 0.25 : 0.45);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(specL * 0.18, -specW * 0.28, specL * 0.22, specW * 0.56);
      ctx.restore();
    }
  }

  private drawSignals(sim: TrafficSim, selected: number) {
    const ctx = this.ctx;
    const d = Math.max(16, 7 / this.cam.scale);
    for (const n of sim.net.nodes) {
      if (!n.signalized) continue;
      this.lamp(sim, n, N, 0, -d);
      this.lamp(sim, n, E, d, 0);
      this.lamp(sim, n, S, 0, d);
      this.lamp(sim, n, W, -d, 0);
      if (n.id === selected) {
        const rem = sim.phaseRemaining(n.id).toFixed(1);
        ctx.fillStyle = 'rgba(200, 230, 220, 0.85)';
        ctx.font = `600 ${Math.max(8, 7 / this.cam.scale)}px IBM Plex Mono, monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(rem + 's', n.x, n.y + 2);
        ctx.textAlign = 'start';
      }
    }
  }

  private lamp(sim: TrafficSim, n: Node, a: Approach, dx: number, dy: number) {
    if (n.incoming[a] < 0 && !(n.allIncoming || []).some((id) => sim.net.links[id]?.approachOfTo === a)) return;
    const lit = sim.approachLit(n.id, a);
    const ctx = this.ctx;
    const x = n.x + dx;
    const y = n.y + dy;
    const col = lit === 'G' ? '#22e38a' : lit === 'Y' ? '#ffd24a' : '#ff4d5a';
    const r = Math.max(2.15, 1.1 / this.cam.scale);
    ctx.save();
    ctx.fillStyle = '#0b0d10';
    ctx.beginPath();
    ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = lit === 'R' ? 6 : 12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawLabels(sim: TrafficSim, selected: number) {
    const ctx = this.ctx;
    const fs = Math.max(8, 6.5 / this.cam.scale);
    ctx.font = `600 ${fs}px Syne, sans-serif`;
    ctx.textAlign = 'center';
    const lift = Math.max(22, 10 / this.cam.scale);
    for (const n of sim.net.nodes) {
      if (!n.signalized) continue;
      const on = n.id === selected || n.arterial;
      ctx.fillStyle = on ? 'rgba(220, 235, 240, 0.86)' : 'rgba(170, 190, 200, 0.5)';
      ctx.fillText(n.name.toUpperCase(), n.x, n.y - lift);
    }
    ctx.textAlign = 'start';

    ctx.font = `600 ${Math.max(9, 8 / this.cam.scale)}px Syne, sans-serif`;
    ctx.fillStyle = 'rgba(160, 200, 190, 0.45)';
    const seen = new Set<string>();
    const want = ['Cầu Sông Hàn', 'Lê Duẩn', 'Lê Lợi', 'Ngô Quyền', 'Phạm Văn Đồng', 'Ngô Gia Tự'];
    for (const l of sim.net.links) {
      const hit = want.find((w) => l.name.includes(w));
      if (!hit || seen.has(hit)) continue;
      seen.add(hit);
      const mid = l.polyline[Math.floor(l.polyline.length / 2)] || { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 };
      ctx.fillText(hit.toUpperCase(), mid.x + 8, mid.y - 8);
    }
  }
}

function occupancy(sim: TrafficSim, linkId: number, length: number) {
  const arr = sim.onLink[linkId];
  if (!arr.length) return 0;
  let used = 0;
  for (const vi of arr) {
    const v = sim.vehicles[vi] as Vehicle;
    used += v.kind === 'car' ? 6.5 : 3.2;
  }
  const lanes = Math.max(1, (sim.net.links[linkId]?.lanes || 1));
  return used / Math.max(40, (length - STOP_PAD) * lanes);
}

function lerpColor(a: string, b: string, t: number) {
  t = Math.max(0, Math.min(1, t));
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ra = (pa >> 16) & 255, ga = (pa >> 8) & 255, ba = pa & 255;
  const rb = (pb >> 16) & 255, gb = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ra + (rb - ra) * t);
  const g = Math.round(ga + (gb - ga) * t);
  const bl = Math.round(ba + (bb - ba) * t);
  return `rgb(${r},${g},${bl})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
